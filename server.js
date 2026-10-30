const express = require('express');
const fs = require('fs');
const path = require('path');
const { checkPin } = require('./lib/pin');
const { createLoginToken, verifySessionToken, readSessionUser, readSessionJti } = require('./lib/session');
const { SESSION_USERS, RETIRED_SESSION_USERS } = require('./lib/users');
const { CATALOG_ADMIN_USERS, resolveUserPins } = require('./lib/users');
const catalogAdmin = require('./lib/catalog-admin');
const continuationIdentity = require('./lib/continuation-identity');
const { sourceAuthConfigured } = require('./lib/source-auth');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEETS_URL = process.env.SHEETS_URL || '';
const OUTPATIENT_PROXY_SECRET = process.env.OUTPATIENT_PROXY_SECRET || '';
const APP_PIN = process.env.APP_PIN || '';
/* Session-cookie signing secret (who/when stamping — port of the Dashboard's
 * PR #113 design). A correct PIN mints an HttpOnly session cookie; every
 * browser-only data route (/api/sheets, /api/continuation-roster, /api/me,
 * /api/debug/*) requires a valid cookie. FAIL-CLOSED: if SESSION_SECRET is
 * unset the server still boots and serves the static app, but
 * /api/verify-pin answers 500 (no cookie can be minted) and the gated routes
 * answer 401 — never open. Set it on the Railway service BEFORE this deploys
 * (Railway variables apply only to deployments started after saving). */
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  console.error('[config] SESSION_SECRET is not set — /api/verify-pin will return 500 and the data routes (/api/sheets, /api/continuation-roster, /api/me, /api/debug/*) will return 401 until it is configured (fail-closed).');
}
/* Vered-only package catalog (quotes / pricing requests). ONE extra secret, set
 * on Railway by the operator — never in code, never logged:
 *   CATALOG_ADMIN_ASSERTION_SECRET   — >=32 chars, shared with the Apps Script property
 *                                      of the same name, distinct from every other key.
 * Access = the signed-in NAME (lib/users.js CATALOG_ADMIN_USERS); there is no second code
 * (owner decision 2026-10-19). FAIL-CLOSED: if the secret is missing/invalid every
 * /api/catalog-admin route that needs it answers 503 and nothing price-related is reachable. */
const CATALOG_ADMIN_ASSERTION_SECRET = process.env.CATALOG_ADMIN_ASSERTION_SECRET || '';
const SESSION_COOKIE = 'ezone_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 604800 seconds (7 days), matches the token TTL
const PREAUTH_MAX_AGE = 10 * 60;          // the name-less PIN-stage session only lives long enough to pick a name
// Continuation-track roster proxy: the currently-admitted patient roster is owned
// by the E-Zone DASHBOARD Apps Script (action=getAdmittedRoster) and served
// behind a fail-closed shared secret. We proxy it server-side so the browser
// never sees the dashboard URL or secret. Empty-string defaults → fail closed.
const DASHBOARD_SHEETS_URL = process.env.DASHBOARD_SHEETS_URL || '';
const OCCUPANCY_SECRET = process.env.OCCUPANCY_SECRET || '';
const BUILD = String(Date.now());
// Fixed once per process: GET /api/version reports the commit + this start time.
const VERSION_INFO = require('./lib/version').buildVersion(process.env, Number(BUILD));

if (!APP_PIN) {
  console.warn('APP_PIN env var is not set — ורד cannot sign in (/api/verify-pin rejects the shared PIN).');
}

/* PIN per allow-listed name (lib/users.js resolveUserPins): ורד = APP_PIN, every other name has ITS OWN
 * Railway variable (USER_PIN_OREN, USER_PIN_DANA). Only the variable NAMES are ever logged, never a value. */
const USER_PINS = (function () {
  const r = resolveUserPins(process.env);
  r.problems.forEach((msg) => console.warn('[config] personal PIN not usable — ' + msg + ' (that name cannot sign in until fixed).'));
  return r.pins;
})();

/* Does `submitted` equal THIS name's PIN? A name with no usable PIN never matches (fail-closed). */
function pinMatchesUser(submitted, user) {
  const pin = Object.prototype.hasOwnProperty.call(USER_PINS, user) ? USER_PINS[user] : '';
  return !!pin && checkPin(submitted, pin);
}

/* Does `submitted` equal ANY configured PIN? Only used for the name-less PIN stage (it reaches nothing but the
 * name picker); the named login is always checked against the chosen name's own PIN. Every PIN is compared
 * (no early exit) so timing does not reveal which one matched. */
function pinMatchesAnyUser(submitted) {
  let ok = false;
  Object.keys(USER_PINS).forEach((u) => { if (checkPin(submitted, USER_PINS[u])) ok = true; });
  return ok;
}

// --- PIN verification rate limiting ------------------------------------
// In-memory per-IP window: 10 attempts / 15 minutes. Resets on a match.
const PIN_RATE_LIMIT_MAX = 10;
const PIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const pinAttempts = new Map(); // ip -> { count, windowStart }

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
// ---------------------------------------------------------------------------

// --- Session auth ------------------------------------------------------------
// A correct PIN (POST /api/verify-pin) mints a signed HttpOnly cookie; every
// browser-only data route requires it. No cookie-parser dependency — the one
// cookie we read is pulled from the raw header. Cross-app consumers
// (therapists / dashboard) never call this server: they POST/GET the Apps
// Script /exec URL directly with their shared secrets, so nothing here needs
// an ungated bypass (verified in Phase 1 — see CHANGELOG-session-who-when.md).

/* Extract a named cookie's value from a Cookie header, or '' if absent. */
function parseCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return '';
  const parts = cookieHeader.split(';');
  const prefix = name + '=';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.indexOf(prefix) === 0) return p.slice(prefix.length);
  }
  return '';
}

/* Extract the session token from a Cookie header, or '' if absent. */
function parseSessionCookie(cookieHeader) {
  return parseCookieValue(cookieHeader, SESSION_COOKIE);
}

/* Pure auth decision, so every branch is unit-testable with an explicit secret:
 *   'not_configured' → SESSION_SECRET unset (fail-closed → 401)
 *   'ok'             → a valid, unexpired, correctly-signed cookie is present
 *   'unauthorized'   → missing / malformed / tampered / expired cookie (→ 401) */
function sessionAuthStatus(cookieHeader, secret, opts) {
  if (typeof secret !== 'string' || secret.length === 0) return 'not_configured';
  const token = parseSessionCookie(cookieHeader);
  if (token && verifySessionToken(token, secret)) {
    const user = readSessionUser(token, secret);
    if (!user) {
      // PIN stage of the two-step login: a valid cookie with NO name. It may reach ONLY the
      // name-selection routes (opts.allowUnnamed); every ordinary data/write route refuses it.
      return opts && opts.allowUnnamed ? 'ok' : 'name_required';
    }
    // A name removed from the user list must not keep working on an old
    // 7-day cookie: retired users are refused, forcing a fresh login. A name that is
    // not (or no longer) on the allow-list is refused the same way.
    if (RETIRED_SESSION_USERS.indexOf(user) >= 0 || SESSION_USERS.indexOf(user) < 0) return 'unauthorized';
    return 'ok';
  }
  return 'unauthorized';
}

/* Normalize the optional user name a login may attach to its session
 * (who/when stamping): trim, strip control characters and angle brackets
 * (defense-in-depth against a name ever being interpolated into HTML), cap
 * at 40 characters. Hebrew names with quotes (ד"ר …) survive. '' (no
 * name) is always allowed — the cookie then keeps the legacy user-less
 * format and everything behaves exactly as before. */
function sanitizeSessionUser(raw) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
}

/* The `user` a login may embed in its session cookie: sanitized, then
 * accepted ONLY if it is one of the fixed SESSION_USERS names (the same
 * three names as the leads assignedTo dropdown). Anything else — unknown
 * name, free text, empty — returns '' and the cookie stays user-less, so
 * updatedBy can never carry an arbitrary string. */
function validateSessionUser(raw) {
  const user = sanitizeSessionUser(raw);
  return SESSION_USERS.indexOf(user) >= 0 ? user : '';
}

/* The user name embedded in the request's VERIFIED session cookie, '' when
 * the cookie is a legacy user-less token (or absent/invalid — callers behind
 * requireSession never see that case). This — never a client-supplied body
 * field — is the only source of the `user` the sheets proxy forwards. */
function sessionUserFromRequest(req) {
  if (!SESSION_SECRET) return '';
  return readSessionUser(parseSessionCookie(req.headers.cookie), SESSION_SECRET);
}

/* Express middleware guarding the browser-only data routes. Fail-closed: an
 * unset SESSION_SECRET and a missing/invalid cookie BOTH yield 401 (the
 * client's one 401 handler sends the user back to the PIN screen either
 * way; the operator sees the boot-time log line). */
function sessionGate(opts) {
  return function (req, res, next) {
    const status = sessionAuthStatus(req.headers.cookie, SESSION_SECRET, opts);
    if (status !== 'ok') {
      return res.status(401).json({
        ok: false,
        error: status === 'not_configured' ? 'session_not_configured' : (status === 'name_required' ? 'name_required' : 'unauthorized')
      });
    }
    return next();
  };
}
/* Every ordinary route: a valid cookie that carries an ALLOW-LISTED, non-retired name. */
const requireSession = sessionGate();
/* ONLY the name-selection step of the two-step login (GET /api/me, GET /api/users): a valid
 * cookie, named or not. */
const requireLoginStage = sessionGate({ allowUnnamed: true });

/* Whether the ORIGINAL client request reached us over HTTPS. Railway terminates
 * TLS and forwards x-forwarded-proto=https; plain-HTTP localhost dev has neither,
 * so the Secure attribute is omitted there (a Secure cookie would never be sent
 * back over http and would break local dev). */
function requestIsHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.secure === true;
}

/* Build the Set-Cookie value for a freshly-minted session token. SameSite=Lax
 * (per the outpatient brief): the cookie rides same-site fetches and
 * top-level navigations, never cross-site POSTs. */
function buildSessionCookie(token, isHttps, maxAge) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge || SESSION_MAX_AGE}`
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/* Set-Cookie value that expires the session cookie immediately (logout). */
function buildClearedSessionCookie(isHttps) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0'
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}
// ---------------------------------------------------------------------------

// --- Cache config -----------------------------------------------------------
// Caches the slow `getData` bulk read from Apps Script in memory.
// Writes (POST) automatically invalidate the cache so saves are reflected.
// Pass ?fresh=1 to force a live fetch and refresh the cache.
const CACHE_TTL_MS = 60 * 1000;          // 60 seconds
const STALE_FALLBACK_MS = 10 * 60 * 1000; // serve stale up to 10 min if upstream fails
const getDataCache = {
  data: null,
  status: null,
  timestamp: 0
};
function isCacheFresh() {
  return getDataCache.data && (Date.now() - getDataCache.timestamp) < CACHE_TTL_MS;
}
function isCacheStaleButUsable() {
  return getDataCache.data && (Date.now() - getDataCache.timestamp) < STALE_FALLBACK_MS;
}
function invalidateCache() {
  getDataCache.data = null;
  getDataCache.status = null;
  getDataCache.timestamp = 0;
}
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '2mb' }));

const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
function sendIndex(res) {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) return res.status(500).send('index load error');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html.replace(/__BUILD__/g, BUILD));
  });
}
app.get('/', (req, res) => sendIndex(res));
app.get('/index.html', (req, res) => sendIndex(res));

// --- Browser-tab favicons (public, static) ------------------------------------
// Without these the SPA catch-all below answered /favicon.ico with index.html
// (200 text/html), so the tab showed no icon. Exact paths only, each mapped to
// ONE fixed file under public/ (no user input reaches the file path, so no
// traversal and no directory listing), with an explicit image type, nosniff and
// a 1-day cache. Registered before any auth: an icon is never session data.
// Regenerate with `node scripts/gen-favicons.js` (docs/favicons.md).
const FAVICONS = Object.freeze({
  '/favicon.ico': 'image/x-icon',
  '/favicon.svg': 'image/svg+xml',
  '/favicon-16x16.png': 'image/png',
  '/favicon-32x32.png': 'image/png'
});
const FAVICON_MAX_AGE_MS = 24 * 60 * 60 * 1000;
for (const [route, type] of Object.entries(FAVICONS)) {
  const file = path.join(__dirname, 'public', route.slice(1));
  app.get(route, (req, res) => {
    res.type(type);
    res.set('X-Content-Type-Options', 'nosniff');
    // An SVG is a document: forbid it from running script or loading anything.
    if (type === 'image/svg+xml') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.sendFile(file, { maxAge: FAVICON_MAX_AGE_MS, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
}

/* PRICE / PAY CONSTANTS ARE NOT PUBLIC ASSETS. treatment-map.js holds the client price
 * table (incl. VAT) and therapist-pay.js the per-therapist pay rates; before this they were
 * served to anyone who could reach the site, with no PIN. They are now served ONLY to a
 * valid session, `no-store`, and the matching names are classified after URL-decoding
 * (case-insensitively) and ONLY the exact canonical path is served; every alias is a 404, so encoded /
 * dotted / doubled-slash / re-cased spellings neither reach express.static nor create a second cacheable URL. The browser loads them after sign-in
 * (public/app.js loadProtectedScripts) and the service worker never caches them. */
const PROTECTED_STATIC = new Set(['treatment-map.js', 'therapist-pay.js']);
// 'therapist-payout.js' (pure logic, no constants) shares the prefix and stays public: the stem must
// not be followed by another name character.
const PROTECTED_STEM_RE = /(treatment-map|therapist-pay)(?![a-z0-9-])/;
/* '' = not a protected request; 'invalid' = undecodable (400); otherwise the exact file name
 * to serve to a signed-in session; 'blocked' = looks like one of the files but is not the exact
 * name (trailing space/dot, ';x', odd casing tricks ...): never reaches express.static, 404 for
 * everyone. Matching is by SUBSTRING of the decoded (up to 3 levels), lower-cased path, so no
 * spelling that still names the file on disk can slip past an exact-name comparison. */
function protectedStaticName(rawPath) {
  let decoded = String(rawPath || '');
  for (let i = 0; i < 3; i++) { // tolerate double-encoding; stop at a fixed point
    let next;
    try { next = decodeURIComponent(decoded); } catch (_) { return 'invalid'; }
    if (next === decoded) break;
    decoded = next;
  }
  const lower = decoded.toLowerCase();
  if (!PROTECTED_STEM_RE.test(lower)) return '';
  // Only the ONE canonical spelling is ever served. Every alias (encoded, re-cased, dotted,
  // doubled-slash ...) is a 404 for everyone, so no second URL for the same bytes can exist for a
  // cache (service worker or HTTP) to remember.
  const raw = String(rawPath || '');
  for (const name of PROTECTED_STATIC) { if (raw === '/' + name) return name; }
  return 'blocked';
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const name = protectedStaticName(req.path);
  if (!name) return next();
  if (name === 'invalid') return res.status(400).end();
  return requireSession(req, res, () => {
    res.set('Cache-Control', 'no-store');
    if (name === 'blocked') return res.status(404).end();
    res.type('js');
    return res.sendFile(path.join(__dirname, 'public', name), { dotfiles: 'deny' });
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const lastLoad = {
  at: null,
  status: null,
  leads: 0,
  clients: 0,
  error: null
};

function requireSheetsUrl(res) {
  if (!SHEETS_URL) {
    res.status(500).json({
      ok: false,
      error: 'SHEETS_URL env var is not configured on the server.'
    });
    return false;
  }
  if (!sourceAuthConfigured(OUTPATIENT_PROXY_SECRET)) {
    res.status(503).json({ ok: false, error: 'source_auth_not_configured' });
    return false;
  }
  return true;
}

// Fail closed: the roster carries patient names + phones (PII) and the dashboard
// endpoint requires the secret, so refuse unless BOTH the URL and the secret are
// configured. Never leak the secret — the message names only which vars.
function requireContinuationConfig(res) {
  if (!DASHBOARD_SHEETS_URL || !OCCUPANCY_SECRET) {
    res.status(500).json({
      ok: false,
      error: 'Continuation roster proxy is not configured: DASHBOARD_SHEETS_URL and OCCUPANCY_SECRET must both be set.'
    });
    return false;
  }
  return true;
}

// --- Continuation-roster cache ---------------------------------------------
// The roster is a slow cross-app round-trip and changes at most a few times a
// day (admissions/releases). A short in-memory cache (<=60s) keeps the tab
// snappy without going stale; ?fresh=1 forces a live fetch.
const ROSTER_CACHE_TTL_MS = 60 * 1000;
const rosterCache = { data: null, status: null, timestamp: 0 };

app.get('/api/sheets', requireSession, async (req, res) => {
  if (!requireSheetsUrl(res)) return;

  const action = (req.query && req.query.action) || 'getData';
  // A GET must never mutate data, including the obsolete saveAll shortcut.
  if (action === 'saveAll') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  // Package catalog / pricing actions have their own Vered-only route and the
  // manager feeds never go through the browser: refuse them here.
  if (catalogAdmin.isPackageAction(action)) return res.status(403).json({ ok: false, error: 'forbidden_action' });
  const forceFresh = req.query && (req.query.fresh === '1' || req.query.fresh === 'true');

  // Serve from cache when possible: only for the bulk read, and only when
  // the caller hasn't explicitly asked for a fresh fetch.
  if (action === 'getData' && !forceFresh && isCacheFresh()) {
    res.set('X-Cache', 'HIT');
    return res.status(getDataCache.status || 200).json(getDataCache.data);
  }

  try {
    const url = SHEETS_URL
      + (SHEETS_URL.includes('?') ? '&' : '?')
      + 'action=' + encodeURIComponent(action)
      + '&proxySecret=' + encodeURIComponent(OUTPATIENT_PROXY_SECRET)
      + (req.query.secret ? '&secret=' + encodeURIComponent(req.query.secret) : '');
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('upstream_unavailable'); }

    // Track load metrics + populate cache only on the bulk read.
    if (action === 'getData') {
      lastLoad.at = new Date().toISOString();
      lastLoad.status = r.status;
      lastLoad.leads = Array.isArray(data.leads) ? data.leads.length : 0;
      lastLoad.clients = Array.isArray(data.clients) ? data.clients.length : 0;
      lastLoad.error = data.ok === false ? (data.error || 'unknown') : null;

      // Only cache successful responses
      if (r.status >= 200 && r.status < 300 && data.ok !== false) {
        getDataCache.data = data;
        getDataCache.status = r.status;
        getDataCache.timestamp = Date.now();
      }
    }

    res.set('X-Cache', 'MISS');
    res.status(r.status).json(data);
  } catch (err) {
    lastLoad.at = new Date().toISOString();
    lastLoad.status = 'error';
    // Fetch failures can contain the credential-bearing upstream URL or body.
    // Do not return/log it, including diagnostic headers and cached metadata.
    lastLoad.error = 'upstream_unavailable';

    // Graceful degradation: if Apps Script fails on a getData call but we
    // still have a recent-ish cached copy, serve that instead of erroring.
    if (action === 'getData' && isCacheStaleButUsable()) {
      res.set('X-Cache', 'STALE');
      res.set('X-Cache-Error', 'upstream_unavailable');
      return res.status(getDataCache.status || 200).json(getDataCache.data);
    }

    res.status(502).json({ ok: false, error: 'upstream_unavailable' });
  }
});

app.post('/api/sheets', requireSession, async (req, res) => {
  if (!requireSheetsUrl(res)) return;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ ok: false, error: 'invalid_payload' });
  }
  try {
    // Pass through whatever action the client asked for. saveAll is the
    // legacy default (back when the client couldn't pick an action) so
    // requests without an explicit action keep working.
    const body = Object.assign({ action: 'saveAll' }, req.body || {});
    // Package catalog / pricing: dedicated Vered-only route only. Authority
    // fields (actor, role, assertion, requester) are server-owned — a browser
    // that sends one is rejected, never silently trusted.
    if (catalogAdmin.isPackageAction(body.action)) {
      return res.status(403).json({ ok: false, error: 'forbidden_action' });
    }
    for (const k of ['adminAssertion', 'actor', 'actorKey', 'actorRole', 'requesterKey', 'catalogAdmin', 'isAdmin']) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
        return res.status(400).json({ ok: false, error: 'forbidden_field' });
      }
    }
    if (body.action === 'saveAll') {
      body.leads   = Array.isArray(req.body?.leads)   ? req.body.leads   : [];
      body.clients = Array.isArray(req.body?.clients) ? req.body.clients : [];
    }
    // OP-ID-2: createContinuationLead is reachable ONLY through the
    // server-side orchestration (/api/continuation/to-outpatient), which
    // resolves the patient from the server-held roster. A browser cannot name
    // a patient by PII here.
    if (body.action === 'createContinuationLead') {
      return res.status(403).json({ ok: false, error: 'forbidden_action' });
    }
    // OP-ID-2: a continuation save names the patient ONLY by dashboardPatientId.
    // Identity / PII / link / owner / source fields are overwritten from the
    // server-held roster or dropped — never forwarded from the browser.
    if (body.action === 'saveContinuation') {
      if (!requireContinuationConfig(res)) return;
      const resolved = await resolveContinuationIdentity(body.dashboardPatientId);
      if (!resolved.ok) return res.status(resolved.status || 400).json({ ok: false, error: resolved.error });
      for (const k of continuationIdentity.BROWSER_STRIPPED_FIELDS) delete body[k];
      Object.assign(body, continuationIdentity.buildSavePayload(req.body, resolved.identity, null));
    }
    // Who/when stamping: the `user` the Apps Script writes into updatedBy
    // comes ONLY from the signed session cookie. ALWAYS overwritten — a
    // client-supplied body.user is never trusted; '' (legacy user-less
    // cookie) is forwarded as-is and stamps blank, which is allowed by
    // contract.
    body.user = sessionUserFromRequest(req);
    // Separate from `secret`: resolveStopFlag uses that field to select the
    // cross-app phone-based path. A browser cannot supply this credential.
    body.proxySecret = OUTPATIENT_PROXY_SECRET;
    const r = await fetch(SHEETS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('upstream_unavailable'); }

    // Any successful write invalidates the cache so the next read is fresh.
    if (r.status >= 200 && r.status < 300 && data.ok !== false) {
      invalidateCache();
    }

    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'upstream_unavailable' });
  }
});

// Server-held Dashboard admitted-roster fetch (cached <=60s; `fresh` bypasses).
// Shared by GET /api/continuation-roster and by the OP-ID-2 identity resolution
// (saveContinuation / createContinuationLead), which must never trust browser
// patient details. Returns { status, data } or throws.
async function fetchAdmittedRoster(forceFresh) {
  if (!forceFresh && rosterCache.data && (Date.now() - rosterCache.timestamp) < ROSTER_CACHE_TTL_MS) {
    return { status: rosterCache.status || 200, data: rosterCache.data, cache: 'HIT' };
  }
  const url = DASHBOARD_SHEETS_URL
    + (DASHBOARD_SHEETS_URL.includes('?') ? '&' : '?')
    + 'action=getAdmittedRoster'
    + '&secret=' + encodeURIComponent(OCCUPANCY_SECRET);
  const r = await fetch(url, { redirect: 'follow' });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error('Non-JSON from dashboard roster: ' + text.slice(0, 200)); }
  if (r.status >= 200 && r.status < 300 && data.ok !== false) {
    rosterCache.data = data;
    rosterCache.status = r.status;
    rosterCache.timestamp = Date.now();
  }
  return { status: r.status, data, cache: 'MISS' };
}

// Resolve exactly one admitted patient by the Dashboard's stable id. Tries the
// cached roster first and re-fetches once (fresh) before failing closed, so a
// patient admitted in the last minute still resolves. Never looks up by
// phone / name. Returns { ok:true, identity } or { ok:false, status, error }.
async function resolveContinuationIdentity(requestedId) {
  if (!DASHBOARD_SHEETS_URL || !OCCUPANCY_SECRET) {
    return { ok: false, status: 500, error: 'continuation_roster_not_configured' };
  }
  const id = continuationIdentity.careId(requestedId);
  if (!id) return { ok: false, status: 400, error: 'continuation_identity_required' };
  let roster;
  try { roster = await fetchAdmittedRoster(false); }
  catch (_) { return { ok: false, status: 502, error: 'continuation_roster_unavailable' }; }
  let patients = roster && roster.data && Array.isArray(roster.data.patients) ? roster.data.patients : [];
  let res = continuationIdentity.resolveIdentity(patients, id);
  if (!res.ok && res.error !== 'continuation_identity_conflict' && roster.cache === 'HIT') {
    try { roster = await fetchAdmittedRoster(true); }
    catch (_) { return { ok: false, status: 502, error: 'continuation_roster_unavailable' }; }
    patients = roster && roster.data && Array.isArray(roster.data.patients) ? roster.data.patients : [];
    res = continuationIdentity.resolveIdentity(patients, id);
  }
  return res;
}

async function postToSheets(body) {
  const r = await fetch(SHEETS_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error('upstream_unavailable'); }
  return { status: r.status, data };
}

// GET /api/continuation-roster — proxy the dashboard's getAdmittedRoster behind
// the server-held secret. The continuation WORKFLOW rows themselves go through
// the existing /api/sheets path (getContinuation / saveContinuation), NOT here.
app.get('/api/continuation-roster', requireSession, async (req, res) => {
  if (!requireContinuationConfig(res)) return;

  const forceFresh = req.query && (req.query.fresh === '1' || req.query.fresh === 'true');
  try {
    const out = await fetchAdmittedRoster(forceFresh);
    res.set('X-Cache', out.cache);
    res.status(out.status).json(out.data);
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err.message || err) });
  }
});

// POST /api/continuation/to-outpatient — OP-ID-2 orchestration for the
// to_outpatient decision. Body: { dashboardPatientId, meetingDate, note }.
//   1. resolve the patient from the server-held roster by exact id (fail closed);
//   2. Apps Script createContinuationLead (internal, proxy key): link-or-create
//      with the existing _createLead rules — a possible_duplicate /
//      identity_conflict creates nothing and NO outcome is saved;
//   3. only after success, saveContinuation outcome=to_outpatient with the
//      observed downstream id/entity. If that second write fails the lead
//      exists but the row is not linked: continuation_link_save_failed — a
//      retry is safe because step 2 is idempotent by stable identity.
app.post('/api/continuation/to-outpatient', requireSession, async (req, res) => {
  if (!requireSheetsUrl(res)) return;
  if (!requireContinuationConfig(res)) return;
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ ok: false, error: 'invalid_payload' });
  const resolved = await resolveContinuationIdentity(body.dashboardPatientId);
  if (!resolved.ok) return res.status(resolved.status || 400).json({ ok: false, error: resolved.error });
  const identity = resolved.identity;
  const user = sessionUserFromRequest(req);
  try {
    const create = Object.assign(continuationIdentity.buildCreatePayload(body, identity), {
      user, proxySecret: OUTPATIENT_PROXY_SECRET
    });
    const r1 = await postToSheets(create);
    if (!(r1.status >= 200 && r1.status < 300) || !r1.data || r1.data.ok === false) {
      const err = (r1.data && r1.data.error) || 'upstream_error';
      const status = (err === 'possible_duplicate' || err === 'identity_conflict') ? 409 : (r1.status >= 400 ? r1.status : 502);
      return res.status(status).json(Object.assign({ ok: false, error: err }, r1.data && r1.data.possibleDuplicateOf ? { possibleDuplicateOf: r1.data.possibleDuplicateOf } : {}));
    }
    invalidateCache();
    const downstreamId = continuationIdentity.careId(r1.data.id);
    const downstreamEntity = r1.data.entity;
    if (!downstreamId || (downstreamEntity !== 'lead' && downstreamEntity !== 'client')) {
      return res.status(502).json({ ok: false, error: 'continuation_link_create_invalid' });
    }
    const link = { outpatientId: downstreamId, outpatientEntity: downstreamEntity };
    const save = Object.assign(
      continuationIdentity.buildSavePayload({ meetingDate: body.meetingDate, outcome: 'to_outpatient', note: body.note }, identity, link),
      { user, proxySecret: OUTPATIENT_PROXY_SECRET }
    );
    let r2;
    try { r2 = await postToSheets(save); }
    catch (_) { r2 = null; }
    const confirmed = r2 && r2.data && r2.data.row;
    if (!r2 || !(r2.status >= 200 && r2.status < 300) || !r2.data || r2.data.ok === false ||
        !confirmed || String(confirmed.dashboardPatientId || '') !== identity.dashboardPatientId ||
        confirmed.outcome !== 'to_outpatient' ||
        String(confirmed.outpatientId || '') !== link.outpatientId ||
        confirmed.outpatientEntity !== link.outpatientEntity) {
      return res.status(502).json({
        ok: false, error: 'continuation_link_save_failed',
        reason: r2 && r2.data ? (r2.data.reason || r2.data.error || '') : 'upstream_unavailable',
        lead: { id: link.outpatientId, entity: link.outpatientEntity, matched: !!r1.data.matched }
      });
    }
    return res.status(200).json({
      ok: true,
      lead: { id: link.outpatientId, entity: link.outpatientEntity, matched: !!r1.data.matched, matchedBy: r1.data.matchedBy || '', ownerUnmapped: !!r1.data.ownerUnmapped },
      row: r2.data.row || null
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'upstream_unavailable' });
  }
});

app.post('/api/verify-pin', (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();

  let entry = pinAttempts.get(ip);
  if (!entry || now - entry.windowStart >= PIN_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    pinAttempts.set(ip, entry);
  }

  if (entry.count >= PIN_RATE_LIMIT_MAX) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  const submitted = req.body && req.body.pin;
  // Which PIN is required depends on the NAME being claimed: ורד -> APP_PIN, אורן / דנה -> their own personal PIN
  // (APP_PIN does not sign in as them). No name yet (PIN stage) -> any configured PIN.
  const claimedRaw = req.body && req.body.user;
  const claimsUser = typeof claimedRaw === 'string' && claimedRaw.trim() !== '';
  const claimedUser = claimsUser ? validateSessionUser(claimedRaw) : '';
  const pinOk = claimedUser ? pinMatchesUser(submitted, claimedUser) : pinMatchesAnyUser(submitted);
  if (pinOk) {
    pinAttempts.delete(ip);
    /* Mint the session cookie so subsequent data requests are authorized.
     * FAIL-CLOSED: without SESSION_SECRET no cookie can be minted, so the
     * login is refused with a clear 500 (an operator problem, logged
     * server-side) rather than a "success" that leads nowhere. */
    if (!SESSION_SECRET) {
      console.error('[verify-pin] correct PIN but SESSION_SECRET is not set — cannot mint a session cookie (fail-closed). Set SESSION_SECRET on the Railway service and redeploy.');
      return res.status(500).json({ ok: false, error: 'session_not_configured' });
    }
    // TWO-STEP login. Step 1 {pin}: a correct PIN mints only a short-lived, NAME-LESS session
    // (PREAUTH_MAX_AGE) that can reach nothing but the name picker (GET /api/users, GET /api/me).
    // Step 2 {pin, user}: the picker re-posts the PIN with an allow-listed name and receives the
    // real 7-day NAMED session. A `user` that is not on the allow-list (unknown, free text, or a
    // RETIRED name) is refused — it never silently degrades to a session. Every login gets a
    // fresh unique id (lib/session.js jti) and revokes the catalog-admin privilege of the session
    // that presented its cookie (account switch / re-login), server-side.
    const wantsUser = claimsUser;
    const user = claimedUser;
    if (wantsUser && !user) {
      return res.status(403).json({ ok: false, error: 'user_not_allowed' });
    }
    revokeAdminFor(req);
    const token = createLoginToken(SESSION_SECRET, user ? undefined : PREAUTH_MAX_AGE, user);
    res.set('Set-Cookie', [
      buildSessionCookie(token, requestIsHttps(req), user ? SESSION_MAX_AGE : PREAUTH_MAX_AGE),
      catalogAdmin.buildClearedAdminCookie(requestIsHttps(req))
    ]);
    return res.status(200).json({ ok: true, stage: user ? 'named' : 'name_required' });
  }

  entry.count += 1;
  return res.status(401).json({ ok: false, error: 'Incorrect PIN.' });
});

/* ---- Vered-only package catalog (/api/catalog-admin/*) ---------------------
 * Every route needs the normal session AND, except login/logout/status, a valid
 * short-lived admin cookie minted for a signed-in CATALOG_ADMIN_USERS name. The admin
 * cookie is scoped (cannot verify as a session), HttpOnly, SameSite=Strict and
 * Path-limited to this prefix. Authority never comes from the picked display
 * name or from anything the browser stores. */
const catalogAdminSessions = catalogAdmin.createAdminSessions();

function catalogAdminConfig() {
  return catalogAdmin.adminConfigStatus({
    SESSION_SECRET, APP_PIN, OUTPATIENT_PROXY_SECRET,
    CATALOG_ADMIN_ASSERTION_SECRET
  });
}

function adminBinding(req) { return catalogAdmin.sessionBinding(parseSessionCookie(req.headers.cookie)); }
function adminSid(req) { return catalogAdmin.readAdminSid(parseCookieValue(req.headers.cookie, catalogAdmin.ADMIN_COOKIE), SESSION_SECRET); }

/* The admin privilege exists only while ALL hold: a valid, NAMED, non-retired base
 * session; a valid admin cookie; and a live server-side record bound to THAT base
 * session and THAT user. Anything else (other session, other user, logged out,
 * restarted, expired) is "not admin". */
function sessionJtiFromRequest(req) {
  return SESSION_SECRET ? readSessionJti(parseSessionCookie(req.headers.cookie), SESSION_SECRET) : '';
}
function hasAdminCookie(req) {
  const user = sessionUserFromRequest(req);
  if (!user || RETIRED_SESSION_USERS.indexOf(user) >= 0 || SESSION_USERS.indexOf(user) < 0) return false;
  if (!sessionJtiFromRequest(req)) return false;   // needs a unique login id (older cookies must sign in again)
  return catalogAdminSessions.valid(adminSid(req), adminBinding(req), user);
}

function requireCatalogAdmin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!catalogAdminConfig().ok) return res.status(503).json({ ok: false, error: 'catalog_admin_not_configured' });
  if (!sessionUserFromRequest(req)) return res.status(403).json({ ok: false, error: 'named_session_required' });
  if (!hasAdminCookie(req)) return res.status(401).json({ ok: false, error: 'admin_required' });
  return next();
}

app.get('/api/catalog-admin/status', requireSession, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const configured = catalogAdminConfig().ok;
  const user = sessionUserFromRequest(req);
  const eligible = !!user && CATALOG_ADMIN_USERS.indexOf(user) >= 0 && RETIRED_SESSION_USERS.indexOf(user) < 0;
  res.status(200).json({ ok: true, configured, eligible: configured && eligible, admin: configured && hasAdminCookie(req) });
});

app.post('/api/catalog-admin/login', requireSession, (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!catalogAdminConfig().ok) return res.status(503).json({ ok: false, error: 'catalog_admin_not_configured' });
  // Every pricing action is attributable: an unnamed (legacy) session cannot enter.
  const user = sessionUserFromRequest(req);
  if (!user) return res.status(403).json({ ok: false, error: 'named_session_required' });
  if (!sessionJtiFromRequest(req)) return res.status(403).json({ ok: false, error: 'fresh_login_required' });
  // Vered's NAME is the authorization (no second code). Anyone else: refused, nothing minted.
  if (CATALOG_ADMIN_USERS.indexOf(user) < 0 || RETIRED_SESSION_USERS.indexOf(user) >= 0) {
    return res.status(403).json({ ok: false, error: 'vered_only' });
  }
  const binding = adminBinding(req);
  const sid = catalogAdminSessions.create(binding, user);
  if (!sid) return res.status(500).json({ ok: false, error: 'catalog_admin_unavailable' });
  res.set('Set-Cookie', catalogAdmin.buildAdminCookie(catalogAdmin.createAdminToken(SESSION_SECRET, sid), requestIsHttps(req)));
  return res.status(200).json({ ok: true });
});

/* Open like /api/logout (clearing a credential never needs one) — but it now ALSO
 * revokes the privilege SERVER-SIDE: the admin session record for the presented
 * cookie and every record bound to the presented base session are deleted, so a
 * copied cookie stops working immediately instead of living out its 15 minutes. */
function revokeAdminFor(req) {
  catalogAdminSessions.revoke(adminSid(req));
  catalogAdminSessions.revokeByBinding(adminBinding(req));
}
app.post('/api/catalog-admin/logout', (req, res) => {
  revokeAdminFor(req);
  res.set('Set-Cookie', catalogAdmin.buildClearedAdminCookie(requestIsHttps(req)));
  res.status(200).json({ ok: true });
});

/* The ONLY gateway to the private catalog actions. The upstream body is rebuilt
 * from a per-op allowlist (never the raw browser body), the actor comes from
 * the signed session, and Apps Script gets a short-lived HMAC assertion bound
 * to this exact body. */
app.post('/api/catalog-admin/rpc', requireSession, requireCatalogAdmin, async (req, res) => {
  if (!requireSheetsUrl(res)) return;
  const op = req.body && req.body.op;
  const built = catalogAdmin.buildAdminUpstream(op, req.body, sessionUserFromRequest(req));
  if (built.error) return res.status(400).json({ ok: false, error: built.error });
  try {
    const upstream = Object.assign({ action: built.action }, built.body, {
      proxySecret: OUTPATIENT_PROXY_SECRET,
      adminAssertion: catalogAdmin.signAssertion(built.action, built.body, CATALOG_ADMIN_ASSERTION_SECRET)
    });
    const r = await fetch(SHEETS_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstream)
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('upstream_unavailable'); }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'upstream_unavailable' });
  }
});

/* GET /api/me — the display name embedded in this session's signed cookie
 * (who/when stamping). Session-gated like every data route; a legacy
 * user-less cookie answers { user: '' } and everything keeps working. The
 * frontend reads it after the PIN (empty -> name picker) and at load (header
 * "מחובר/ת כ: <name>"). */
app.get('/api/me', requireLoginStage, (req, res) => {
  res.status(200).json({ ok: true, user: sessionUserFromRequest(req) });
});

/* GET /api/users — the fixed list of names the login name picker offers
 * (lib/users.js SESSION_USERS, the same list /api/verify-pin accepts a
 * `user` from), so the client never carries a duplicate that could drift.
 * Public (see the handler): names only, read-only, no input. */
app.get('/api/users', (req, res) => {
  // PUBLIC since 2026-10-20 (one-screen sign-in: the names are shown next to the PIN field, before any session
  // exists). Only the staff FIRST NAMES on the fixed allow-list are exposed — no PIN, no data, nothing else.
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, users: SESSION_USERS.slice() });
});

/* POST /api/logout — expire the session cookie immediately. Open route:
 * clearing a credential never needs one. The existing יציאה button calls it
 * (fire-and-forget) before showing the PIN screen, so a shared device does
 * not keep a live 7-day cookie after logout. */
app.post('/api/logout', (req, res) => {
  revokeAdminFor(req); // the pricing privilege ends with the session, server-side
  res.set('Set-Cookie', [buildClearedSessionCookie(requestIsHttps(req)), catalogAdmin.buildClearedAdminCookie(requestIsHttps(req))]);
  res.status(200).json({ ok: true });
});

// Debug endpoints are browser-only operator surfaces (they reveal config
// flags, row counts and the route table) — session-gated like the data routes.
app.use('/api/debug', requireSession);

app.get('/api/debug/env', (req, res) => {
  res.json({
    ok: true,
    node: process.version,
    port: PORT,
    sheetsUrlConfigured: !!SHEETS_URL,
    sheetsUrlHost: SHEETS_URL ? new URL(SHEETS_URL).host : null
  });
});

app.get('/api/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route) {
      const methods = Object.keys(m.route.methods).map((x) => x.toUpperCase());
      routes.push({ path: m.route.path, methods });
    }
  });
  res.json({ ok: true, routes });
});

app.get('/api/debug/last-load', (req, res) => {
  res.json({ ok: true, lastLoad });
});

app.get('/api/debug/cache', (req, res) => {
  const ageMs = getDataCache.timestamp ? Date.now() - getDataCache.timestamp : null;
  res.json({
    ok: true,
    cached: !!getDataCache.data,
    ageMs,
    ttlMs: CACHE_TTL_MS,
    fresh: isCacheFresh(),
    staleButUsable: !isCacheFresh() && isCacheStaleButUsable(),
    leads: getDataCache.data && Array.isArray(getDataCache.data.leads) ? getDataCache.data.leads.length : 0,
    clients: getDataCache.data && Array.isArray(getDataCache.data.clients) ? getDataCache.data.clients.length : 0
  });
});

// Manually clear the cache (handy for debugging)
app.post('/api/debug/cache/clear', (req, res) => {
  invalidateCache();
  res.json({ ok: true, cleared: true });
});

// Deployment readiness: the source must not be tightened before this server
// can authenticate its requests. No configuration values are exposed.
app.get('/healthz', (req, res) => {
  const ready = sourceAuthConfigured(OUTPATIENT_PROXY_SECRET);
  res.set('Cache-Control', 'no-store');
  res.status(ready ? 200 : 503).json({ ok: ready });
});

// Public deploy-verification endpoint: { commit, builtAt } only, never cached,
// so a poll after a merge sees the live build rather than a stale copy.
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(VERSION_INFO);
});

app.get('*', (req, res) => sendIndex(res));

// Start only when run directly (`node server.js`). When required by a test the
// app is exported instead, so the test owns the server lifecycle and the test
// runner can exit cleanly instead of hanging on a listening socket.
function start(port) {
  return app.listen(port || PORT, () => {
    console.log(`E-ZONE Outpatient listening on :${port || PORT}`);
    console.log(`SHEETS_URL configured: ${!!SHEETS_URL}`);
    console.log(`SESSION_SECRET configured: ${!!SESSION_SECRET}`);
    console.log(`DASHBOARD_SHEETS_URL configured: ${!!DASHBOARD_SHEETS_URL}`);
    console.log(`OCCUPANCY_SECRET configured: ${!!OCCUPANCY_SECRET}`);
    console.log(`Cache TTL: ${CACHE_TTL_MS}ms, stale fallback: ${STALE_FALLBACK_MS}ms`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
// Session-auth helpers, exported for unit tests (pure functions + middleware).
module.exports.parseSessionCookie = parseSessionCookie;
module.exports.sessionAuthStatus = sessionAuthStatus;
module.exports.sanitizeSessionUser = sanitizeSessionUser;
module.exports.validateSessionUser = validateSessionUser;
module.exports.sessionUserFromRequest = sessionUserFromRequest;
module.exports.protectedStaticName = protectedStaticName;
module.exports.requireSession = requireSession;
module.exports.requireLoginStage = requireLoginStage;
module.exports.requestIsHttps = requestIsHttps;
module.exports.buildSessionCookie = buildSessionCookie;
module.exports.buildClearedSessionCookie = buildClearedSessionCookie;
module.exports.SESSION_COOKIE = SESSION_COOKIE;
