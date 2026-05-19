/**
 * E-ZONE Outpatient — Apps Script backend
 *
 * Setup:
 *  1. Create a new Google Sheet named "E-ZONE Outpatient".
 *  2. Extensions → Apps Script → paste this file as Code.gs.
 *  3. Deploy → New deployment → Web app
 *       - Execute as: Me
 *       - Who has access: Anyone (with link)
 *  4. Copy the /exec URL and set it as SHEETS_URL in the Node server env.
 */

var LEADS_HEADERS = [
  'id', 'name', 'phone', 'serviceType', 'location', 'note',
  'stage', 'sessionsPerWeek', 'pricePerSession', 'startDate', 'created', 'introDateTime',
  'house_of_origin'
];

/* Extra columns (source, notes, billingType, billingDay, bundleSize,
 * bundlePrice, sessionsUsed, bundlePaid) added after launch. _ensureSheet
 * non-destructively extends existing sheets on next read so no migration
 * is needed — old rows get blank values for the new columns and default
 * to billingType='monthly' on the client. */
var CLIENTS_HEADERS = [
  'id', 'name', 'serviceType', 'location', 'sessionsPerWeek',
  'pricePerSession', 'startDate', 'status', 'exitDate', 'fromLead',
  'source', 'notes', 'billingType', 'billingDay',
  'bundleSize', 'bundlePrice', 'sessionsUsed', 'bundlePaid',
  'house_of_origin',
  'responsiblePerson', 'serviceScope',
  'treatmentContactPhone', 'payerName', 'payerPhone', 'paymentLink'
];

/* Settings sheet: one row per setting, key/value style.
 * Currently used for bank transfer details. */
var SETTINGS_HEADERS = ['key', 'value'];

var PAYMENTS_HEADERS = [
  'id', 'clientId', 'clientName', 'billingType', 'dueDate',
  'amountDue', 'amountPaid', 'status', 'paymentDate', 'method',
  'notes', 'bundleSize', 'sessionsUsed'
];

function _ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _ensureSheet(name, headers) {
  var ss = _ss();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), headers.length);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var needsHeader = false;
  for (var i = 0; i < headers.length; i++) {
    if (existing[i] !== headers[i]) { needsHeader = true; break; }
  }
  if (needsHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _readAll(sh, headers) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = row[c];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
      }
      obj[headers[c]] = v;
    }
    out.push(obj);
  }
  return out;
}

function _writeAll(sh, headers, rows) {
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }
  if (!rows || !rows.length) return;
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      if (v === undefined || v === null) return '';
      return v;
    });
  });
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

function _getData() {
  var leadsSh = _ensureSheet('Leads', LEADS_HEADERS);
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  return {
    ok: true,
    leads: _readAll(leadsSh, LEADS_HEADERS),
    clients: _readAll(clientsSh, CLIENTS_HEADERS)
  };
}

function _saveAll(payload) {
  var leadsSh = _ensureSheet('Leads', LEADS_HEADERS);
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var leads = (payload && payload.leads) || [];
  var clients = (payload && payload.clients) || [];
  _writeAll(leadsSh, LEADS_HEADERS, leads);
  _writeAll(clientsSh, CLIENTS_HEADERS, clients);
  return { ok: true, savedLeads: leads.length, savedClients: clients.length };
}

/* ===== Payments =====
 * id is deterministic (built on the client) so the same monthly /
 * single / bundle bill always upserts into the same row. */
function _getPayments() {
  var sh = _ensureSheet('Payments', PAYMENTS_HEADERS);
  return { ok: true, payments: _readAll(sh, PAYMENTS_HEADERS) };
}

function _upsertPayment(payment) {
  if (!payment || typeof payment !== 'object') {
    return { ok: false, error: 'missing_payment' };
  }
  if (!payment.id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('Payments', PAYMENTS_HEADERS);
    var idIdx = PAYMENTS_HEADERS.indexOf('id');
    var lastRow = sh.getLastRow();
    var row = PAYMENTS_HEADERS.map(function (h) {
      var v = payment[h];
      return (v === undefined || v === null) ? '' : v;
    });
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(payment.id)) {
          sh.getRange(i + 2, 1, 1, PAYMENTS_HEADERS.length).setValues([row]);
          return { ok: true, payment: payment, updated: true };
        }
      }
    }
    sh.appendRow(row);
    return { ok: true, payment: payment, created: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Settings ===== */
function _getSettings() {
  var sh = _ensureSheet('Settings', SETTINGS_HEADERS);
  var rows = _readAll(sh, SETTINGS_HEADERS);
  var settings = {};
  rows.forEach(function (r) {
    if (r.key) settings[r.key] = r.value || '';
  });
  return { ok: true, settings: settings };
}

function _saveSettings(settings) {
  var sh = _ensureSheet('Settings', SETTINGS_HEADERS);
  var rows = [];
  if (settings && typeof settings === 'object') {
    Object.keys(settings).forEach(function (k) {
      rows.push({ key: k, value: settings[k] == null ? '' : String(settings[k]) });
    });
  }
  _writeAll(sh, SETTINGS_HEADERS, rows);
  return { ok: true };
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===== Win-back source (read-only cross-app endpoint) =====
 *
 * Consumed by the E-Zone-Dashboard win-back call list.
 *
 * Returns only the two projections the dashboard is allowed to see:
 *   lostLeads:         rows from Leads where stage === 'לא רלוונטי'
 *   dischargedClients: rows from Clients where status === 'סיים טיפול'
 *
 * Each row is projected to exactly the columns the dashboard renders.
 * Fields like pricePerSession, paymentLink, payerPhone, bundle*, etc.
 * are deliberately NOT included — the dashboard never receives billing
 * or payer data even though it lives in the same sheet.
 *
 * Auth: optional shared secret. If a Script Property named
 * 'WINBACK_SECRET' exists, the request must pass ?secret=<value> that
 * matches. If the property is absent the endpoint is open (URL-only
 * obscurity — same security level as every other action on this script).
 */
var LOST_LEAD_STAGE_HE = 'לא רלוונטי';
var DISCHARGED_CLIENT_STATUS_HE = 'סיים טיפול';

function _winbackAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('WINBACK_SECRET');
  if (!expected) return true; // not configured → open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

function _getWinbackSource() {
  var leadsSh   = _ensureSheet('Leads',   LEADS_HEADERS);
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var leads     = _readAll(leadsSh,   LEADS_HEADERS);
  var clients   = _readAll(clientsSh, CLIENTS_HEADERS);

  var lostLeads = [];
  for (var i = 0; i < leads.length; i++) {
    var l = leads[i];
    if (l.stage !== LOST_LEAD_STAGE_HE) continue;
    lostLeads.push({
      sourceApp:       'ezone-outpatient',
      sourceId:        l.id,
      name:            l.name           || '',
      phone:           l.phone          || '',
      originalService: l.serviceType    || '',
      location:        l.location       || '',
      reasonLeft:      l.note           || '',  // best-available proxy
      dateLeft:        l.created        || '',  // best-available proxy
      kind:            'lost_lead'
    });
  }

  var dischargedClients = [];
  for (var j = 0; j < clients.length; j++) {
    var c = clients[j];
    if (c.status !== DISCHARGED_CLIENT_STATUS_HE) continue;
    dischargedClients.push({
      sourceApp:       'ezone-outpatient',
      sourceId:        c.id,
      name:            c.name           || '',
      phone:           c.phone          || '',
      originalService: c.serviceType    || '',
      location:        c.location       || '',
      reasonLeft:      c.notes          || '',  // best-available proxy
      dateLeft:        c.exitDate       || '',
      kind:            'discharged'
    });
  }

  return { ok: true, lostLeads: lostLeads, dischargedClients: dischargedClients };
}

/* ===== Outpatient-continuation bonus (read-only cross-app endpoint) =====
 *
 * STEP 2 source. Consumed by E-Zone-Dashboard, which passes the figure
 * through (additively) to the MANAGERS app where the bonus is displayed.
 *
 * Returns the CURRENT MONTH per-source-house 5% bonus only. The figure is
 * 5% of the contracted monthly package, which is charged UPFRONT — so the
 * bonus is earned in the billed month, independent of session delivery or
 * carry-overs (those are a separate operational system, NOT a dependency).
 *
 * Projection is deliberately minimal: ONLY { month, ratePct, byHouse,
 * total }. No patient names, no billing/payer fields, no per-patient lines
 * — the dashboard never receives PII or financial detail, exactly as
 * getWinbackSource restricts its own projection.
 *
 * Auth: shared secret REQUIRED. Unlike getWinbackSource (optional secret),
 * this is a money endpoint: if the Script Property 'BONUS_SECRET' is absent
 * OR the passed ?secret= does not match, the request is rejected. Fail
 * closed.
 *
 * IMPORTANT — DUAL IMPLEMENTATION:
 * The canonical, unit-tested logic lives in public/continuation-bonus.js.
 * Apps Script cannot require() that module, so the rules below are a
 * faithful re-implementation of it (same as the billing-status.js <->
 * app.js arrangement already used in this codebase). ANY change to the
 * bonus rule MUST update both places together, and test/continuation-
 * bonus.test.js is the guard for the canonical side. Logic kept 1:1:
 *  - basis: contracted monthly package (pricePerSession; bundlePrice
 *    fallback only when no monthly figure)
 *  - real houses only (external / unknown excluded)
 *  - status 'סיים טיפול' never accrues; 'הפסקה זמנית' excluded by default
 *  - month must be within [startDate month, exitDate month]
 *  - ratePct default 5
 */
var BONUS_REAL_HOUSES = ['raanana', 'ramot', 'efroni', 'rehab'];
var BONUS_STATUS_FINISHED_HE = 'סיים טיפול';
var BONUS_STATUS_PAUSED_HE   = 'הפסקה זמנית';
var BONUS_DEFAULT_RATE_PCT   = 5;

function _bonusAuthOk(params) {
  // Fail closed: secret must be configured AND must match.
  var expected = PropertiesService.getScriptProperties().getProperty('BONUS_SECRET');
  if (!expected) return false;
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

function _bonusNum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function _bonusYmIndex(v) {
  if (v === '' || v === null || v === undefined) return null;
  var s = String(v);
  if (s.indexOf('T') !== -1) s = s.split('T')[0];
  var parts = s.split('-');
  if (parts.length < 2) return null;
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (!isFinite(y) || !isFinite(m) || m < 1 || m > 12) return null;
  return y * 12 + (m - 1);
}

function _bonusPackageAmount(c) {
  var monthly = _bonusNum(c.pricePerSession);
  if (monthly > 0) return monthly;
  var bundlePrice = _bonusNum(c.bundlePrice);
  if (bundlePrice > 0) return bundlePrice;
  return 0;
}

/* monthKey 'YYYY-MM' for "now" in the script timezone. */
function _bonusCurrentMonthKey() {
  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM');
}

function _getContinuationBonus() {
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var clients   = _readAll(clientsSh, CLIENTS_HEADERS);

  var monthKey = _bonusCurrentMonthKey();
  var mi = _bonusYmIndex(monthKey + '-01');

  var byHouse = {};
  for (var h = 0; h < BONUS_REAL_HOUSES.length; h++) {
    byHouse[BONUS_REAL_HOUSES[h]] = 0;
  }
  var total = 0;

  for (var i = 0; i < clients.length; i++) {
    var c = clients[i] || {};
    var house = String(c.house_of_origin == null ? '' : c.house_of_origin).trim();
    if (BONUS_REAL_HOUSES.indexOf(house) === -1) continue; // external/unknown

    var status = String(c.status == null ? '' : c.status).trim();
    if (status === BONUS_STATUS_FINISHED_HE) continue;
    if (status === BONUS_STATUS_PAUSED_HE) continue; // default: not counted

    var si = _bonusYmIndex(c.startDate);
    var ei = _bonusYmIndex(c.exitDate);
    if (si !== null && mi < si) continue; // not started yet
    if (ei !== null && mi > ei) continue; // already exited

    var amount = _bonusPackageAmount(c);
    var bonus = amount * (BONUS_DEFAULT_RATE_PCT / 100);
    byHouse[house] += bonus;
    total += bonus;
  }

  for (var k = 0; k < BONUS_REAL_HOUSES.length; k++) {
    var key = BONUS_REAL_HOUSES[k];
    byHouse[key] = Math.round(byHouse[key]);
  }

  return {
    ok: true,
    sourceApp: 'ezone-outpatient',
    kind: 'continuation_bonus',
    month: monthKey,
    ratePct: BONUS_DEFAULT_RATE_PCT,
    byHouse: byHouse,
    total: Math.round(total)
  };
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getData';
    if (action === 'getData')      return _json(_getData());
    if (action === 'getPayments')  return _json(_getPayments());
    if (action === 'getSettings')  return _json(_getSettings());
    if (action === 'getWinbackSource') {
      if (!_winbackAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getWinbackSource());
    }
    if (action === 'getContinuationBonus') {
      if (!_bonusAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getContinuationBonus());
    }
    if (action === 'saveAll') {
      var payload = { leads: [], clients: [] };
      if (e.parameter.payload) {
        try { payload = JSON.parse(e.parameter.payload); } catch (err) {}
      } else {
        if (e.parameter.leads) try { payload.leads = JSON.parse(e.parameter.leads); } catch (_) {}
        if (e.parameter.clients) try { payload.clients = JSON.parse(e.parameter.clients); } catch (_) {}
      }
      return _json(_saveAll(payload));
    }
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'saveAll';
    var payload = {};
    if (e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) {}
      if (payload && payload.action) action = payload.action;
    }
    if (action === 'saveAll') {
      return _json(_saveAll({
        leads:   Array.isArray(payload.leads)   ? payload.leads   : [],
        clients: Array.isArray(payload.clients) ? payload.clients : []
      }));
    }
    if (action === 'getData')     return _json(_getData());
    if (action === 'getPayments') return _json(_getPayments());
    if (action === 'getSettings') return _json(_getSettings());
    if (action === 'getWinbackSource') {
      var authParams = (e && e.parameter) || {};
      if (payload && payload.secret) authParams.secret = payload.secret;
      if (!_winbackAuthOk(authParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getWinbackSource());
    }
    if (action === 'getContinuationBonus') {
      var bonusAuthParams = (e && e.parameter) || {};
      if (payload && payload.secret) bonusAuthParams.secret = payload.secret;
      if (!_bonusAuthOk(bonusAuthParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getContinuationBonus());
    }
    if (action === 'saveSettings') {
      return _json(_saveSettings(payload.settings || {}));
    }
    if (action === 'savePayment' || action === 'updatePayment') {
      return _json(_upsertPayment(payload.payment));
    }
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
