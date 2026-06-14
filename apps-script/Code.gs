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
  'house_of_origin',
  'not_relevant_reason',
  'not_relevant_note'
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

/* Extra charges per client (חיובים נוספים). One row per ad-hoc treatment,
 * layered on top of the base monthly subscription. billingType is either
 * 'one_time' (chargeDate is the single due date) or 'monthly' (chargeDate
 * is the start date; billingDay overrides dayOfMonth(chargeDate) for the
 * recurring day). active='false' soft-disables a charge without delete. */
var CHARGES_HEADERS = [
  'id', 'clientId', 'description', 'amount',
  'billingType',
  'chargeDate',
  'billingDay',
  'active',
  'notes', 'created'
];

/* Removed leads sheet: soft-deleted leads moved out of Leads.
 * Same columns as LEADS_HEADERS plus removedAt timestamp and
 * originSheet for restore-by-hand. New headers added at the end
 * per the _ensureSheet append-only rule. */
var REMOVED_LEADS_HEADERS = [
  'id', 'name', 'phone', 'serviceType', 'location', 'note',
  'stage', 'sessionsPerWeek', 'pricePerSession', 'startDate', 'created', 'introDateTime',
  'house_of_origin',
  'not_relevant_reason',
  'not_relevant_note',
  'removedAt',
  'originSheet'
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

/* ===== Client charges ===== */
function _getCharges() {
  var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
  return { ok: true, charges: _readAll(sh, CHARGES_HEADERS) };
}

function _upsertCharge(charge) {
  if (!charge || typeof charge !== 'object') {
    return { ok: false, error: 'missing_charge' };
  }
  if (!charge.id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var idIdx = CHARGES_HEADERS.indexOf('id');
    var lastRow = sh.getLastRow();
    var row = CHARGES_HEADERS.map(function (h) {
      var v = charge[h];
      return (v === undefined || v === null) ? '' : v;
    });
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(charge.id)) {
          sh.getRange(i + 2, 1, 1, CHARGES_HEADERS.length).setValues([row]);
          return { ok: true, charge: charge, updated: true };
        }
      }
    }
    sh.appendRow(row);
    return { ok: true, charge: charge, created: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removeCharge(chargeId) {
  if (!chargeId) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = CHARGES_HEADERS.indexOf('id');
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(chargeId)) {
        sh.deleteRow(i + 2);
        return { ok: true, removed: true, id: chargeId };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removeLead(lead) {
  if (!lead || typeof lead !== 'object') return { ok: false, error: 'missing_lead' };
  if (!lead.id) return { ok: false, error: 'missing_id' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = _ss();
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) return { ok: false, error: 'not_found' };

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: false, error: 'not_found' };
    var headers = data[0];
    var idCol = headers.indexOf('id');
    if (idCol === -1) return { ok: false, error: 'not_found' };

    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(lead.id)) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex === -1) return { ok: false, error: 'not_found' };

    var sourceRow = data[rowIndex];
    var rowObj = {};
    for (var j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = sourceRow[j];
    }
    rowObj.removedAt = new Date().toISOString();
    rowObj.originSheet = 'Leads';

    var removedSheet = _ensureSheet('לידים שהוסרו', REMOVED_LEADS_HEADERS);
    var newRow = REMOVED_LEADS_HEADERS.map(function(h) {
      return rowObj[h] !== undefined ? rowObj[h] : '';
    });
    removedSheet.appendRow(newRow);

    sheet.deleteRow(rowIndex + 1);

    return { ok: true, lead: lead, removed: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
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

/* ===== Debt status (read-only cross-app endpoint) =====
 *
 * Consumed by the E-Zone Therapists app to gate patient intake on outpatient
 * debt. Returns EVERY client with a tri-state debt status, so the consumer can
 * tell "confirmed no debt" apart from "couldn't determine":
 *   clientId, name, phone (treatmentContactPhone), debtStatus, amountOwed
 *
 * Never-fail-open: three outcomes, not two.
 *   - has payment rows, open balance > 0 -> 'debt'    (consumer: block+approval)
 *   - has payment rows, nothing owing     -> 'clear'   (consumer: allow)
 *   - ZERO payment rows                   -> 'unknown' (consumer: FLAG — no data
 *                                                       is NOT proof of payment)
 * The consumer adds: phone matches no client -> flag; matches >1 -> flag.
 *
 * Matching contract: the consumer matches on NAME + the phone registered in
 * the system (treatmentContactPhone). payerPhone, paymentLink, prices, bundle*
 * and every other billing/payer field are deliberately NOT included.
 *
 * Per-row rule (lockstep with public/debt-status.js and billing-status.js):
 * for a row that EXISTS, owed = (status paid or blank) ? 0 :
 * max(0, amountDue - amountPaid). "Don't assume paid" applies at the CLIENT
 * level (zero rows = 'unknown'), not by reinterpreting an existing blank row.
 * Included regardless of client status (debt survives discharge).
 *
 * Auth: optional shared secret, same model as getWinbackSource. If a Script
 * Property named 'DEBT_STATUS_SECRET' exists, the request must pass
 * ?secret=<value> that matches. If the property is absent the endpoint is open
 * (URL-only obscurity — same level as every other action on this script).
 */
function _debtAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('DEBT_STATUS_SECRET');
  if (!expected) return true; // not configured → open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

var DEBT_PAYMENT_STATUS_ALIASES = {
  'שולם': 'paid', 'paid': 'paid',
  'שולם חלקית': 'partial', 'partial': 'partial',
  'לא שולם': 'unpaid', 'unpaid': 'unpaid'
};

function _resolvePaymentStatus(v) {
  var raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  return DEBT_PAYMENT_STATUS_ALIASES[raw] ||
         DEBT_PAYMENT_STATUS_ALIASES[raw.toLowerCase()] || '';
}

function _rowOwed(row) {
  if (!row) return 0;
  var status = _resolvePaymentStatus(row.status);
  if (status === 'paid' || status === '') return 0;
  var due = Number(row.amountDue); if (!isFinite(due)) due = 0;
  var paid = Number(row.amountPaid); if (!isFinite(paid)) paid = 0;
  var owed = due - paid;
  return owed > 0 ? owed : 0;
}

function _getDebtStatus() {
  var clientsSh  = _ensureSheet('Clients',  CLIENTS_HEADERS);
  var paymentsSh = _ensureSheet('Payments', PAYMENTS_HEADERS);
  var clients    = _readAll(clientsSh,  CLIENTS_HEADERS);
  var payments   = _readAll(paymentsSh, PAYMENTS_HEADERS);

  var byClient = {};
  for (var i = 0; i < payments.length; i++) {
    var p = payments[i];
    var cid = (p && p.clientId != null) ? String(p.clientId) : '';
    if (!cid) continue;
    (byClient[cid] = byClient[cid] || []).push(p);
  }

  var out = [];
  for (var c = 0; c < clients.length; c++) {
    var cl = clients[c];
    var id = (cl && cl.id != null) ? String(cl.id) : '';
    if (!id) continue;
    var rows = byClient[id] || [];
    var debtStatus, amountOwed;
    if (rows.length === 0) {
      debtStatus = 'unknown'; amountOwed = 0; // no billing record → flag
    } else {
      var sum = 0;
      for (var r = 0; r < rows.length; r++) sum += _rowOwed(rows[r]);
      sum = Math.round(sum * 100) / 100;
      debtStatus = sum > 0 ? 'debt' : 'clear';
      amountOwed = sum > 0 ? sum : 0;
    }
    out.push({
      sourceApp:  'ezone-outpatient',
      clientId:   id,
      name:       cl.name || '',
      phone:      cl.treatmentContactPhone || '',
      debtStatus: debtStatus,
      amountOwed: amountOwed
    });
  }

  return { ok: true, clients: out };
}

/* ===== Treatment plans (read-only cross-app endpoint) =====
 *
 * Consumed by E-Zone Therapists to show each outpatient's treatment plan.
 * Minimal projection: clientId, name, phone (treatmentContactPhone),
 * serviceType, sessions (sessionsPerWeek), status. NO billing/payer data.
 *
 * Auth: optional shared secret 'TREATMENT_PLANS_SECRET', same model as
 * getWinbackSource / getDebtStatus.
 */
function _treatmentPlansAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('TREATMENT_PLANS_SECRET');
  if (!expected) return true; // not configured -> open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

function _getTreatmentPlans() {
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var clients   = _readAll(clientsSh, CLIENTS_HEADERS);
  var out = [];
  for (var c = 0; c < clients.length; c++) {
    var cl = clients[c];
    var id = (cl && cl.id != null) ? String(cl.id) : '';
    if (!id) continue;
    out.push({
      sourceApp:   'ezone-outpatient',
      clientId:    id,
      name:        cl.name || '',
      phone:       cl.treatmentContactPhone || '',
      serviceType: cl.serviceType || '',
      sessions:    cl.sessionsPerWeek || '',
      status:      cl.status || ''
    });
  }
  return { ok: true, clients: out };
}

/* ===== Stop-treatment flags (inbound cross-app WRITE) =====
 *
 * The E-Zone Therapists app reports "a therapist says patient X stopped". This
 * is a PENDING note only — it NEVER changes Clients.status. Vered confirms (or
 * dismisses) it in the outpatient UI and performs the actual discharge exactly
 * as today; she remains the sole discharge authority.
 *
 * Matching a flag to a client is done in the outpatient UI by name + the
 * normalized phone (same contract as the read endpoints) — the flag stores the
 * reported name/phone as-sent; clientId is optional and only a hint.
 *
 * Auth: FAIL-CLOSED. Unlike the read endpoints (getWinbackSource /
 * getDebtStatus / getTreatmentPlans), which fall open when unconfigured, this
 * is an external WRITE, so a shared secret is REQUIRED. If the Script Property
 * 'STOP_FLAG_SECRET' is not set, flagStop is refused outright — never open.
 *
 * The companion reads (getStopFlags) and the resolve write (resolveStopFlag)
 * are internal dashboard calls and stay unauthenticated, like getData /
 * savePayment — same trust level as the rest of the dashboard surface.
 */
var STOP_FLAGS_HEADERS = [
  'id', 'phone', 'name', 'clientId',
  'reportedBy', 'reportedAt', 'note',
  'status', 'resolvedBy', 'resolvedAt'
];

function _stopFlagAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('STOP_FLAG_SECRET');
  if (!expected) return false; // fail-closed: not configured → refuse the write
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

function _nowIso() {
  return Utilities.formatDate(
    new Date(), Session.getScriptTimeZone() || 'Asia/Jerusalem', "yyyy-MM-dd'T'HH:mm:ss"
  );
}

function _flagStop(payload) {
  payload = payload || {};
  var phone = payload.phone != null ? String(payload.phone).trim() : '';
  var name  = payload.name  != null ? String(payload.name).trim()  : '';
  // Need at least one identifier to match on later; otherwise the note is noise.
  if (!phone && !name) return { ok: false, error: 'missing_phone_and_name' };

  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
    var rec = {
      id:         payload.id ? String(payload.id)
                             : ('sf_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
      phone:      phone,
      name:       name,
      clientId:   payload.clientId != null ? String(payload.clientId) : '',
      reportedBy: payload.reportedBy != null ? String(payload.reportedBy) : '',
      reportedAt: payload.reportedAt ? String(payload.reportedAt) : _nowIso(),
      note:       payload.note != null ? String(payload.note) : '',
      status:     'pending',
      resolvedBy: '',
      resolvedAt: ''
    };
    var row = STOP_FLAGS_HEADERS.map(function (h) {
      var v = rec[h];
      return (v === undefined || v === null) ? '' : v;
    });
    sh.appendRow(row);
    return { ok: true, flag: rec };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _getStopFlags() {
  var sh  = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
  var all = _readAll(sh, STOP_FLAGS_HEADERS);
  var pending = [];
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].status || '') === 'pending') pending.push(all[i]);
  }
  return { ok: true, flags: pending };
}

function _resolveStopFlag(id, resolvedBy) {
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
    var idIdx = STOP_FLAGS_HEADERS.indexOf('id');
    var lastRow = sh.getLastRow();
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(id)) {
          var rowNum = i + 2;
          var rowVals = sh.getRange(rowNum, 1, 1, STOP_FLAGS_HEADERS.length).getValues()[0];
          rowVals[STOP_FLAGS_HEADERS.indexOf('status')]     = 'resolved';
          rowVals[STOP_FLAGS_HEADERS.indexOf('resolvedBy')] = resolvedBy ? String(resolvedBy) : '';
          rowVals[STOP_FLAGS_HEADERS.indexOf('resolvedAt')] = _nowIso();
          sh.getRange(rowNum, 1, 1, STOP_FLAGS_HEADERS.length).setValues([rowVals]);
          return { ok: true, id: String(id), resolved: true };
        }
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getData';
    if (action === 'getData')      return _json(_getData());
    if (action === 'getPayments')  return _json(_getPayments());
    if (action === 'getCharges')   return _json(_getCharges());
    if (action === 'getSettings')  return _json(_getSettings());
    if (action === 'getWinbackSource') {
      if (!_winbackAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getWinbackSource());
    }
    if (action === 'getDebtStatus') {
      if (!_debtAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getDebtStatus());
    }
    if (action === 'getTreatmentPlans') {
      if (!_treatmentPlansAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getTreatmentPlans());
    }
    if (action === 'getStopFlags') return _json(_getStopFlags());
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
    if (action === 'getCharges')  return _json(_getCharges());
    if (action === 'getSettings') return _json(_getSettings());
    if (action === 'getWinbackSource') {
      var authParams = (e && e.parameter) || {};
      if (payload && payload.secret) authParams.secret = payload.secret;
      if (!_winbackAuthOk(authParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getWinbackSource());
    }
    if (action === 'getDebtStatus') {
      var debtParams = (e && e.parameter) || {};
      if (payload && payload.secret) debtParams.secret = payload.secret;
      if (!_debtAuthOk(debtParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getDebtStatus());
    }
    if (action === 'getTreatmentPlans') {
      var tpParams = (e && e.parameter) || {};
      if (payload && payload.secret) tpParams.secret = payload.secret;
      if (!_treatmentPlansAuthOk(tpParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getTreatmentPlans());
    }
    if (action === 'flagStop') {
      // External write from the therapists app → fail-closed shared secret.
      var sfParams = (e && e.parameter) || {};
      if (payload && payload.secret) sfParams.secret = payload.secret;
      if (!_stopFlagAuthOk(sfParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_flagStop(payload));
    }
    if (action === 'getStopFlags') return _json(_getStopFlags());
    if (action === 'resolveStopFlag') {
      return _json(_resolveStopFlag(payload.id || '', payload.resolvedBy || ''));
    }
    if (action === 'saveSettings') {
      return _json(_saveSettings(payload.settings || {}));
    }
    if (action === 'savePayment' || action === 'updatePayment') {
      return _json(_upsertPayment(payload.payment));
    }
    if (action === 'saveCharge' || action === 'updateCharge') {
      return _json(_upsertCharge(payload.charge));
    }
    if (action === 'removeCharge') {
      var chgId = payload.id || (payload.charge && payload.charge.id) || '';
      return _json(_removeCharge(chgId));
    }
    if (action === 'removeLead') return _json(_removeLead(payload.lead));
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
