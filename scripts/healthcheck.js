'use strict';

/**
 * Weekly automated healthcheck for the E-ZONE Outpatient app.
 *
 * Standalone Node script (built-ins only, global fetch, Node 20+). Run by
 * .github/workflows/weekly-healthcheck.yml every Saturday evening (Israel time)
 * and on demand via workflow_dispatch.
 *
 * Env:
 *   APP_URL  — base URL of the deployed app
 *              (default https://ezone-outpatient.up.railway.app)
 *   APP_PIN  — the app PIN (required; NEVER printed)
 *
 * CRITICAL checks (any failure -> exit 1, workflow goes red):
 *   a. GET APP_URL           -> 200 + HTML shell marker ("E-ZONE Outpatient").
 *   b. POST /api/verify-pin  -> 200 { ok:true }. This app is STATELESS: the PIN
 *      gate stores the role in the browser's sessionStorage and no session
 *      cookie is issued — any Set-Cookie is still captured and replayed
 *      defensively.
 *   c. Every read the frontend's loadAll() fires in parallel (Promise.all in
 *      public/app.js): getData, getPayments, getCharges, getStopFlags,
 *      getExtraSessionRequests, getSettings, getMyStopAlerts
 *      -> 200, parseable JSON (a body starting with '<' is Google's HTML error
 *      page = critical), ok:true, expected top-level keys present.
 *   d. Clients schema: CLIENTS_HEADERS is APPEND-ONLY positional mapping — the
 *      most dangerous place for silent drift. The header list is parsed from
 *      apps-script/Code.gs AT RUN TIME (never hardcoded here) and every field
 *      must exist on the sampled client rows returned by getData. There is no
 *      live endpoint that reports the sheet's raw header row without a secret
 *      (scanClientColumns is secret-gated), so header count/order is enforced
 *      by the existing guard test (test/clients-column-order.test.js) while
 *      this check verifies the LIVE data exposes every field by name.
 *
 * WARNING checks (reported, run stays green):
 *   - Blank/missing client ids.
 *   - Non-empty *Date fields not matching /^\d{4}-\d{2}-\d{2}$/ across
 *     clients / payments / charges (date columns derived from the header
 *     arrays in Code.gs).
 *   - SessionLog rows with matchStatus:"no_match" (known open issue — the
 *     weekly count is the value).
 *   - TherapistRates blank rates: SKIPPED — no existing read endpoint exposes
 *     the TherapistRates sheet and this healthcheck must not add backend code.
 *
 * Privacy/security: APP_PIN and any cookie value are never logged. CI output
 * contains ids/counts only — never client or patient names, and never raw
 * response bodies.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_APP_URL = 'https://ezone-outpatient.up.railway.app';
const HTML_SHELL_MARKER = 'E-ZONE Outpatient';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FETCH_TIMEOUT_MS = 45000;
const FETCH_TRIES = 2;

/* The reads loadAll() fires in parallel (public/app.js). `keys` = top-level
 * keys the frontend consumes from each payload. All carry ok:true. */
const ENDPOINTS = [
  { name: 'getData', query: '', keys: ['leads', 'clients'] },
  { name: 'getPayments', query: '?action=getPayments', keys: ['payments'] },
  { name: 'getCharges', query: '?action=getCharges', keys: ['charges'] },
  { name: 'getStopFlags', query: '?action=getStopFlags', keys: ['stopFlags'] },
  { name: 'getExtraSessionRequests', query: '?action=getExtraSessionRequests', keys: ['requests'] },
  { name: 'getSettings', query: '?action=getSettings', keys: ['settings'] },
  { name: 'getMyStopAlerts', query: '?action=getMyStopAlerts', keys: ['myStopAlerts'] }
];

/* ===== pure helpers (exported for tests) ================================= */

/* Classify a response body WITHOUT ever echoing it: a body starting with '<'
 * is Google's HTML error page (the classic Apps Script breakage mode). */
function classifyBody(text) {
  const t = String(text == null ? '' : text).trim();
  if (t.charAt(0) === '<') return { kind: 'html' };
  try {
    return { kind: 'json', data: JSON.parse(t) };
  } catch (_) {
    return { kind: 'invalid', firstChar: t.charAt(0) || '(empty)', length: t.length };
  }
}

function checkHtmlShell(status, text) {
  const criticals = [];
  if (status !== 200) {
    criticals.push('app shell: HTTP ' + status + ' (expected 200)');
  } else if (String(text || '').indexOf(HTML_SHELL_MARKER) === -1) {
    criticals.push('app shell: 200 but the "' + HTML_SHELL_MARKER + '" marker is missing — wrong page served?');
  }
  return criticals;
}

/* Validate one data endpoint response. Returns { criticals, data }.
 * Never includes body content in messages (bodies can carry patient data). */
function checkEndpointResponse(name, status, text, expectedKeys) {
  const criticals = [];
  if (status !== 200) {
    criticals.push(name + ': HTTP ' + status + ' (expected 200)');
    return { criticals, data: null };
  }
  const body = classifyBody(text);
  if (body.kind === 'html') {
    criticals.push(name + ': response is HTML, not JSON — Google Apps Script error page (deployment/access breakage)');
    return { criticals, data: null };
  }
  if (body.kind === 'invalid') {
    criticals.push(name + ': unparseable response (first char "' + body.firstChar + '", ' + body.length + ' bytes) — body not echoed');
    return { criticals, data: null };
  }
  const data = body.data;
  if (data && data.ok === false) {
    const err = String(data.error || 'no error message').slice(0, 200);
    criticals.push(name + ': ok:false — ' + err);
    return { criticals, data: null };
  }
  const missing = (expectedKeys || []).filter(function (k) {
    return !data || !Object.prototype.hasOwnProperty.call(data, k);
  });
  if (missing.length) {
    criticals.push(name + ': missing expected top-level key(s): ' + missing.join(', '));
  }
  return { criticals, data };
}

/* Parse a header array literal (e.g. CLIENTS_HEADERS) out of Code.gs source —
 * same extraction the column-order guard test uses. */
function parseHeadersFromSource(src, name) {
  const m = String(src).match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  if (!m) return null;
  const quoted = m[1]
    .split('\n').map(function (l) { return l.replace(/\/\/.*$/, ''); }).join('\n')
    .match(/'[^']*'/g);
  return quoted ? quoted.map(function (s) { return s.slice(1, -1); }) : null;
}

/* Clients schema check: every CLIENTS_HEADERS field must exist (by name) on
 * every sampled client. Empty dataset -> skip with a note, never fail. */
function checkClientSchema(clients, headers) {
  if (!Array.isArray(clients) || clients.length === 0) {
    return { criticals: [], skipped: true, note: 'clients schema check skipped: empty clients dataset' };
  }
  const sample = clients.slice(0, 25);
  const missing = headers.filter(function (h) {
    return sample.some(function (c) {
      return !c || typeof c !== 'object' || !Object.prototype.hasOwnProperty.call(c, h);
    });
  });
  const criticals = missing.length
    ? ['clients schema: field(s) missing on sampled clients (positional CLIENTS_HEADERS drift?): ' + missing.join(', ')]
    : [];
  return { criticals, skipped: false, checked: sample.length, headerCount: headers.length };
}

/* WARNING: blank/missing client ids. Reports row positions only (no names). */
function warnBlankClientIds(clients) {
  const rows = [];
  (Array.isArray(clients) ? clients : []).forEach(function (c, i) {
    const id = c && c.id != null ? String(c.id).trim() : '';
    if (!id) rows.push(i + 1); // 1-based data-row position
  });
  if (!rows.length) return null;
  return 'blank/missing client id on ' + rows.length + ' row(s) (data-row position ' + rows.slice(0, 10).join(', ') + (rows.length > 10 ? ', …' : '') + ')';
}

/* WARNING: non-empty date fields that are not strict YYYY-MM-DD.
 * `fields` derived from the schema header arrays; ids only in output. */
function warnDateFields(rows, fields, idKey, label) {
  const warnings = [];
  fields.forEach(function (field) {
    const bad = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r, i) {
      const v = r ? r[field] : undefined;
      if (v == null || String(v).trim() === '') return;
      if (!DATE_RE.test(String(v).trim())) {
        bad.push(r && r[idKey] ? String(r[idKey]) : '#' + (i + 1));
      }
    });
    if (bad.length) {
      warnings.push(label + '.' + field + ': ' + bad.length + ' non-empty value(s) not matching YYYY-MM-DD (ids: ' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? ', …' : '') + ')');
    }
  });
  return warnings;
}

/* WARNING: SessionLog rows with matchStatus:"no_match" (known open issue). */
function countNoMatchRows(sessionLog) {
  return (Array.isArray(sessionLog) ? sessionLog : []).filter(function (r) {
    return r && r.matchStatus === 'no_match';
  }).length;
}

/* Date columns = headers ending in "date" (case-insensitive): startDate,
 * exitDate, paymentDate, nextBillingDate, packageChangeDate, dueDate,
 * chargeDate — derived, not remembered. */
function dateFieldsOf(headers) {
  return (headers || []).filter(function (h) { return /date$/i.test(h); });
}

/* ===== networked runner ================================================== */

async function fetchWithRetry(fetchImpl, url, init) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_TRIES; attempt++) {
    try {
      const res = await fetchImpl(url, Object.assign({
        redirect: 'follow',
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined
      }, init));
      const text = await res.text();
      return { status: res.status, text, headers: res.headers };
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_TRIES) await new Promise(function (r) { setTimeout(r, 2000); });
    }
  }
  throw lastErr;
}

function extractCookies(headers) {
  try {
    if (headers && typeof headers.getSetCookie === 'function') {
      return headers.getSetCookie().map(function (c) { return String(c).split(';')[0]; });
    }
  } catch (_) { /* no cookies — this app is stateless */ }
  return [];
}

/**
 * Run every check against `appUrl`. Pure of process side effects: returns
 * { criticals, warnings, notes, stats } and NEVER calls process.exit or
 * prints secrets. `fetchImpl` is injectable so tests never hit a live URL.
 */
async function runHealthcheck(opts) {
  opts = opts || {};
  const appUrl = String(opts.appUrl || process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
  const appPin = opts.appPin !== undefined ? opts.appPin : process.env.APP_PIN;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const codeGsPath = opts.codeGsPath || path.join(__dirname, '..', 'apps-script', 'Code.gs');

  const criticals = [];
  const warnings = [];
  const notes = [];
  const stats = {};

  if (!appPin) {
    criticals.push('APP_PIN environment variable is not set. Add the APP_PIN secret to this repository (Settings → Secrets and variables → Actions) — the value itself is never printed by this script.');
    return { criticals, warnings, notes, stats };
  }

  // ---- a. HTML shell -------------------------------------------------------
  try {
    const shell = await fetchWithRetry(fetchImpl, appUrl + '/', {});
    checkHtmlShell(shell.status, shell.text).forEach(function (c) { criticals.push(c); });
  } catch (err) {
    criticals.push('app shell: request failed — ' + (err && err.message ? err.message : String(err)));
  }

  // ---- b. PIN login --------------------------------------------------------
  let cookieHeader = '';
  try {
    const login = await fetchWithRetry(fetchImpl, appUrl + '/api/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: appPin })
    });
    const body = classifyBody(login.text);
    if (login.status === 200 && body.kind === 'json' && body.data && body.data.ok === true) {
      const cookies = extractCookies(login.headers);
      if (cookies.length) {
        cookieHeader = cookies.join('; ');
        notes.push('login: session cookie captured (' + cookies.length + ' cookie(s); values not logged)');
      } else {
        notes.push('login: PIN accepted; no session cookie issued — this app is stateless by design (role lives in browser sessionStorage)');
      }
    } else if (login.status === 401) {
      criticals.push('login: PIN rejected (401) — the APP_PIN secret does not match the deployed APP_PIN');
    } else if (login.status === 429) {
      criticals.push('login: rate-limited (429) — too many PIN attempts from this runner IP');
    } else {
      criticals.push('login: unexpected response (HTTP ' + login.status + ', body kind: ' + body.kind + ')');
    }
  } catch (err) {
    criticals.push('login: request failed — ' + (err && err.message ? err.message : String(err)));
  }

  // ---- c+d. loadAll data endpoints ----------------------------------------
  const datasets = {};
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetchWithRetry(fetchImpl, appUrl + '/api/sheets' + ep.query, {
        headers: cookieHeader ? { Cookie: cookieHeader } : {}
      });
      const checked = checkEndpointResponse(ep.name, res.status, res.text, ep.keys);
      checked.criticals.forEach(function (c) { criticals.push(c); });
      if (checked.data) {
        datasets[ep.name] = checked.data;
        ep.keys.forEach(function (k) {
          const v = checked.data[k];
          if (Array.isArray(v)) stats[ep.name + '.' + k] = v.length + ' rows';
          else if (v && typeof v === 'object') stats[ep.name + '.' + k] = Object.keys(v).length + ' keys';
        });
      }
    } catch (err) {
      criticals.push(ep.name + ': request failed — ' + (err && err.message ? err.message : String(err)));
    }
  }

  // ---- e. Clients schema (positional CLIENTS_HEADERS — drift check) --------
  let clientsHeaders = null;
  let paymentsHeaders = null;
  let chargesHeaders = null;
  try {
    const gs = fs.readFileSync(codeGsPath, 'utf8');
    clientsHeaders = parseHeadersFromSource(gs, 'CLIENTS_HEADERS');
    paymentsHeaders = parseHeadersFromSource(gs, 'PAYMENTS_HEADERS');
    chargesHeaders = parseHeadersFromSource(gs, 'CHARGES_HEADERS');
  } catch (err) {
    criticals.push('schema: could not read apps-script/Code.gs to derive CLIENTS_HEADERS — ' + (err && err.message ? err.message : String(err)));
  }
  if (clientsHeaders && !criticals.some(function (c) { return c.indexOf('schema:') === 0; })) {
    const clients = datasets.getData && Array.isArray(datasets.getData.clients) ? datasets.getData.clients : null;
    if (clients) {
      const schema = checkClientSchema(clients, clientsHeaders);
      schema.criticals.forEach(function (c) { criticals.push(c); });
      if (schema.skipped) notes.push(schema.note);
      else notes.push('clients schema: all ' + schema.headerCount + ' CLIENTS_HEADERS fields present on ' + schema.checked + ' sampled client(s). Header COUNT/ORDER on the live sheet is not verifiable without a secret-gated endpoint (scanClientColumns); order is enforced in CI by test/clients-column-order.test.js.');
    }
  }

  // ---- warnings ------------------------------------------------------------
  const clients = datasets.getData && Array.isArray(datasets.getData.clients) ? datasets.getData.clients : [];
  const payments = datasets.getPayments && Array.isArray(datasets.getPayments.payments) ? datasets.getPayments.payments : [];
  const charges = datasets.getCharges && Array.isArray(datasets.getCharges.charges) ? datasets.getCharges.charges : [];

  const blankIds = warnBlankClientIds(clients);
  if (blankIds) warnings.push(blankIds);

  if (clientsHeaders) warnDateFields(clients, dateFieldsOf(clientsHeaders), 'id', 'clients').forEach(function (w) { warnings.push(w); });
  if (paymentsHeaders) warnDateFields(payments, dateFieldsOf(paymentsHeaders), 'id', 'payments').forEach(function (w) { warnings.push(w); });
  if (chargesHeaders) warnDateFields(charges, dateFieldsOf(chargesHeaders), 'id', 'charges').forEach(function (w) { warnings.push(w); });

  // SessionLog no_match count — getSessionLog is NOT part of loadAll, so a
  // failure here is a warning, never a critical.
  try {
    const res = await fetchWithRetry(fetchImpl, appUrl + '/api/sheets?action=getSessionLog', {
      headers: cookieHeader ? { Cookie: cookieHeader } : {}
    });
    const checked = checkEndpointResponse('getSessionLog', res.status, res.text, ['sessionLog']);
    if (checked.data) {
      const log = Array.isArray(checked.data.sessionLog) ? checked.data.sessionLog : [];
      stats['getSessionLog.sessionLog'] = log.length + ' rows';
      const noMatch = countNoMatchRows(log);
      if (noMatch > 0) {
        warnings.push('SessionLog: ' + noMatch + ' row(s) with matchStatus:"no_match" (known open issue — unmatched sessions cannot touch a patient balance)');
      } else {
        notes.push('SessionLog: 0 no_match rows');
      }
    } else {
      warnings.push('SessionLog: could not read getSessionLog for the no_match count — ' + checked.criticals.join('; '));
    }
  } catch (err) {
    warnings.push('SessionLog: getSessionLog request failed — ' + (err && err.message ? err.message : String(err)));
  }

  notes.push('TherapistRates blank-rate check SKIPPED: no existing read endpoint exposes the TherapistRates sheet, and this healthcheck must not add backend code (Code.gs untouched).');

  return { criticals, warnings, notes, stats };
}

/* ===== reporting ========================================================== */

function buildSummary(result) {
  const lines = [];
  lines.push('# E-ZONE Outpatient weekly healthcheck');
  lines.push('');
  lines.push(result.criticals.length === 0
    ? '**Status: PASS** ✅' + (result.warnings.length ? ' (with ' + result.warnings.length + ' warning(s))' : '')
    : '**Status: FAIL** ❌ — ' + result.criticals.length + ' critical failure(s)');
  lines.push('');
  if (result.criticals.length) {
    lines.push('## Critical failures');
    result.criticals.forEach(function (c) { lines.push('- ❌ ' + c); });
    lines.push('');
  }
  if (result.warnings.length) {
    lines.push('## Warnings (run stays green)');
    result.warnings.forEach(function (w) { lines.push('- ⚠️ ' + w); });
    lines.push('');
  }
  if (result.notes.length) {
    lines.push('## Notes');
    result.notes.forEach(function (n) { lines.push('- ' + n); });
    lines.push('');
  }
  const statKeys = Object.keys(result.stats || {});
  if (statKeys.length) {
    lines.push('## Dataset sizes');
    lines.push('');
    lines.push('| Endpoint.key | Size |');
    lines.push('|---|---|');
    statKeys.forEach(function (k) { lines.push('| ' + k + ' | ' + result.stats[k] + ' |'); });
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const result = await runHealthcheck({});
  const summary = buildSummary(result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    } catch (err) {
      console.error('could not write GITHUB_STEP_SUMMARY:', err.message);
    }
  }
  if (result.criticals.length) {
    console.error('\nHEALTHCHECK FAILED: ' + result.criticals.length + ' critical failure(s).');
    process.exit(1);
  }
  console.log('\nHealthcheck passed.' + (result.warnings.length ? ' ' + result.warnings.length + ' warning(s) — see summary.' : ''));
}

module.exports = {
  DEFAULT_APP_URL,
  HTML_SHELL_MARKER,
  DATE_RE,
  ENDPOINTS,
  classifyBody,
  checkHtmlShell,
  checkEndpointResponse,
  parseHeadersFromSource,
  checkClientSchema,
  warnBlankClientIds,
  warnDateFields,
  countNoMatchRows,
  dateFieldsOf,
  runHealthcheck,
  buildSummary
};

if (require.main === module) {
  main().catch(function (err) {
    console.error('healthcheck crashed:', err && err.message ? err.message : String(err));
    process.exit(1);
  });
}
