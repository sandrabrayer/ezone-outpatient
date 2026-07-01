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
 * to billingType='monthly' on the client.
 *
 * `phone` is the patient's own number, carried from the lead on activation.
 * It is the durable home for the patient phone used by cross-app matching
 * (debt, stop-flow). It is a PHONE_COLUMN, so it gets the same Sheets
 * leading-zero text-format/recovery as the other phones.
 *
 * The append-only rule: _readAll/_writeAll map columns positionally to this
 * array, so a new column may only be added at the end — inserting it mid-array
 * would shift every later column on existing rows. Old rows get blank values
 * for the new columns until re-saved.
 *
 * `paymentStatus`, `paymentDate`, `nextBillingDate` were appended after launch.
 * Before this, clientForSheet wrote them but they were silently dropped on every
 * save (absent from this header array); the renewal alert then fell back to
 * startDate after each reload. They are now persisted so the alert anchors on
 * the stored nextBillingDate. No backfill — existing rows stay blank until the
 * next save of that client. */
var CLIENTS_HEADERS = [
  'id', 'name', 'serviceType', 'location', 'sessionsPerWeek',
  'pricePerSession', 'startDate', 'status', 'exitDate', 'fromLead',
  'source', 'notes', 'billingType', 'billingDay',
  'bundleSize', 'bundlePrice', 'sessionsUsed', 'bundlePaid',
  'house_of_origin',
  'responsiblePerson', 'serviceScope',
  'treatmentContactPhone', 'payerName', 'payerPhone', 'paymentLink',
  'phone',
  'paymentStatus', 'paymentDate', 'nextBillingDate'
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

/* Stop-treatment flags (StopFlags tab): the E-Zone Therapists app flags that a
 * patient appears to have stopped treatment. Append-only; surfaced to Vered for
 * manual confirmation. This receiver NEVER modifies Clients — Vered remains the
 * sole authority on actual discharge. */
var STOP_FLAGS_HEADERS = [
  'id', 'phone', 'name', 'clientId',
  'reportedBy', 'reportedAt', 'note',
  'status', 'resolvedBy', 'resolvedAt'
];

/* Columns that hold phone numbers. Forced to plain-text ('@') format on write
 * so Google Sheets does not coerce a numeric-looking phone to a number and drop
 * the leading zero, and recovered on read for already-corrupted rows. */
var PHONE_COLUMNS = { phone: true, treatmentContactPhone: true, payerPhone: true };

/* Mirror of recoverPhone() in public/app.js — keep both in sync. Normalizes to
 * the leading-zero canonical form and restores a leading zero that Sheets
 * dropped by coercing the phone to a number. Idempotent. */
function _recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  var s = String(raw).replace(/[\s\-\(\)]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);   // intl -> local
  else if (s.charAt(0) !== '0') s = '0' + s;          // Sheets dropped the leading 0
  return s;
}

/* Force '@' (plain text) format on any phone columns in this sheet, below the
 * header row, so future writes preserve leading zeros. Number format is a
 * PERSISTENT cell property, so this only needs to run ONCE at sheet creation
 * (it formats the full row allocation so appendRow-based writers land in
 * already-'@' cells). It is intentionally NOT called on every save anymore —
 * _writeAll re-asserts the format over the actual data rows on each write. */
function _formatPhoneColumns(sh, headers) {
  var maxRows = sh.getMaxRows();
  if (maxRows < 2) return;
  for (var i = 0; i < headers.length; i++) {
    if (PHONE_COLUMNS[headers[i]]) {
      sh.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat('@');
    }
  }
}

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
    _formatPhoneColumns(sh, headers);
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
  // Phone-column '@' formatting is applied once at creation (above) and persists
  // as a cell property, so it is NOT re-applied here on every ensure/save.
  // _writeAll re-asserts it over the actual data rows (values.length) on each
  // write — that is where the save-path leading-zero guarantee lives. Dropping
  // the per-save full-allocation (~1000-row) setNumberFormat pass on both sheets
  // is the bulk of the save-perf win. See _writeAll / CHANGELOG-save-perf.
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
      } else if (PHONE_COLUMNS[headers[c]]) {
        v = _recoverPhone(v);   // restore leading zero dropped by Sheets coercion
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
  // Force phone columns to plain text BEFORE writing so leading zeros survive
  // (Sheets would otherwise coerce a numeric-looking phone to a number).
  for (var c = 0; c < headers.length; c++) {
    if (PHONE_COLUMNS[headers[c]]) {
      sh.getRange(2, c + 1, values.length, 1).setNumberFormat('@');
    }
  }
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
  // Serialize full-sheet rewrites so two overlapping saves can't clobber each
  // other (every other writer already takes this lock). If the lock can't be
  // acquired we return an error rather than writing lock-less — no write path
  // bypasses the lock, and it is always released in finally.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Could not acquire lock (another save in progress) — try again' };
  }
  try {
    var leadsSh = _ensureSheet('Leads', LEADS_HEADERS);
    var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var leads = (payload && payload.leads) || [];
    var clients = (payload && payload.clients) || [];
    _writeAll(leadsSh, LEADS_HEADERS, leads);
    _writeAll(clientsSh, CLIENTS_HEADERS, clients);
    return { ok: true, savedLeads: leads.length, savedClients: clients.length };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
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

// Bulk-delete every ClientCharges row belonging to a deleted patient. Called
// from the dashboard's patient-delete flow so charge rows never outlive their
// patient as orphans. Safe and idempotent: a clientId with no rows returns
// { ok:true, removed:0 }. Deletes bottom-up so row indices stay valid, and
// logs each removed row for an audit trail in the Apps Script execution log.
function _removeChargesForClient(clientId) {
  var cid = String(clientId == null ? '' : clientId).trim();
  if (!cid) return { ok: false, error: 'missing_clientId' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, removed: 0, clientId: cid };
    var cidIdx = CHARGES_HEADERS.indexOf('clientId');
    var idIdx  = CHARGES_HEADERS.indexOf('id');
    var rows = sh.getRange(2, 1, lastRow - 1, CHARGES_HEADERS.length).getValues();
    var removed = 0;
    // Iterate bottom-up: deleting a lower row never shifts a higher index.
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][cidIdx]).trim() === cid) {
        Logger.log('removeChargesForClient: clientId=%s chargeId=%s', cid, String(rows[i][idIdx]));
        sh.deleteRow(i + 2);
        removed++;
      }
    }
    return { ok: true, removed: removed, clientId: cid };
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
 *   clientId, name, phone (canonical patient phone), debtStatus, amountOwed
 *
 * Never-fail-open: three outcomes, not two.
 *   - has payment rows, open balance > 0 -> 'debt'    (consumer: block+approval)
 *   - has payment rows, nothing owing     -> 'clear'   (consumer: allow)
 *   - ZERO payment rows                   -> 'unknown' (consumer: FLAG — no data
 *                                                       is NOT proof of payment)
 * The consumer adds: phone matches no client -> flag; matches >1 -> flag.
 *
 * Matching contract: the consumer matches on NAME + the canonical patient
 * phone (the `phone` column, falling back to `treatmentContactPhone`, leading-
 * zero recovered). payerPhone, paymentLink, prices, bundle* and every other
 * billing/payer field are deliberately NOT included.
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
      phone:      _recoverPhone(cl.phone) || _recoverPhone(cl.treatmentContactPhone),
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
    // Cross-app join key for the therapists app — must be the populated
    // canonical patient phone. The patient number lives in the `phone` column
    // (added in the stop-flow work); the legacy `treatmentContactPhone` column
    // is empty for every live client, so projecting it returned "phone":"" for
    // all. Prefer `phone`, fall back to `treatmentContactPhone`, and recover the
    // leading zero either way so consumers get the canonical 10-digit form.
    var phone = _recoverPhone(cl.phone) || _recoverPhone(cl.treatmentContactPhone);
    out.push({
      sourceApp:   'ezone-outpatient',
      clientId:    id,
      name:        cl.name || '',
      phone:       phone,
      serviceType: cl.serviceType || '',
      sessions:    cl.sessionsPerWeek || '',
      status:      cl.status || ''
    });
  }
  return { ok: true, clients: out };
}

/* ===== Stop-treatment flags =====
 *
 * Inbound: the E-Zone Therapists app POSTs { action:'flagStop', secret, phone,
 * name, reportedBy?, note? } directly to this /exec. FAIL-CLOSED auth: the
 * shared secret 'STOP_FLAG_SECRET' Script Property MUST exist and match — unlike
 * the read endpoints, an unset secret REJECTS (this is an external write).
 *
 * _flagStop validates input, normalizes the phone to canonical leading-zero
 * (reusing _recoverPhone), tries to match an existing client by normalized phone
 * (vs client.phone OR treatmentContactPhone) + exact trimmed name to fill
 * clientId, and appends ONE row with status='pending'. Clients is never touched.
 *
 * getStopFlags / resolveStopFlag are INTERNAL (Vered's dashboard via the Node
 * proxy) — open, same trust level as getData/saveAll. resolveStopFlag marks a
 * flag resolved when Vered completes the discharge; it does not discharge.
 */
function _stopFlagAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('STOP_FLAG_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _matchStopFlagClient(clients, phone, name) {
  if (!phone) return '';
  var nm = String(name == null ? '' : name).trim();
  // A phone match alone is sufficient — match the reported phone against ANY of
  // the client's phone fields (patient phone / treatment-contact / payer). Name
  // is only a soft tiebreaker when more than one client shares the phone, never
  // a hard gate (Hebrew names drift on spacing/RTL/spelling). 0 or still-
  // ambiguous → leave clientId empty and let the dashboard panel resolve/ask.
  var hits = [];
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i];
    if (_recoverPhone(c.phone) === phone ||
        _recoverPhone(c.treatmentContactPhone) === phone ||
        _recoverPhone(c.payerPhone) === phone) {
      hits.push(c);
    }
  }
  if (hits.length === 1) return String(hits[0].id);
  if (hits.length > 1 && nm) {
    var narrowed = hits.filter(function (c) {
      return String(c.name == null ? '' : c.name).trim() === nm;
    });
    if (narrowed.length === 1) return String(narrowed[0].id);
  }
  return '';
}

function _flagStop(payload) {
  var phone = _recoverPhone(payload && payload.phone);
  var name = String((payload && payload.name) || '').trim();
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, error: 'invalid_phone' };
  if (!name) return { ok: false, error: 'missing_name' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
    var clients = _readAll(_ensureSheet('Clients', CLIENTS_HEADERS), CLIENTS_HEADERS);
    var flag = {
      id: Utilities.getUuid(),
      phone: phone,
      name: name,
      clientId: _matchStopFlagClient(clients, phone, name),
      reportedBy: String((payload && payload.reportedBy) || '').trim(),
      reportedAt: new Date().toISOString(),
      note: String((payload && payload.note) || '').trim().slice(0, 1000),
      status: 'pending',
      resolvedBy: '',
      resolvedAt: ''
    };
    sh.appendRow(STOP_FLAGS_HEADERS.map(function (h) {
      return flag[h] == null ? '' : flag[h];
    }));
    return { ok: true, flag: flag };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _getStopFlags() {
  var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
  return { ok: true, stopFlags: _readAll(sh, STOP_FLAGS_HEADERS) };
}

function _resolveStopFlag(id, resolvedBy) {
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = STOP_FLAGS_HEADERS.indexOf('id');
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        var rowNum = i + 2;
        sh.getRange(rowNum, STOP_FLAGS_HEADERS.indexOf('status') + 1).setValue('resolved');
        sh.getRange(rowNum, STOP_FLAGS_HEADERS.indexOf('resolvedBy') + 1).setValue(String(resolvedBy || '').trim());
        sh.getRange(rowNum, STOP_FLAGS_HEADERS.indexOf('resolvedAt') + 1).setValue(new Date().toISOString());
        return { ok: true, resolved: true, id: id };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Create lead (inbound, fail-closed write) =====
 *
 * Inbound: the E-Zone Dashboard POSTs { action:'createLead', secret, name,
 * phone, house, note } directly to this /exec when a patient is discharged with
 * disposition "released to outpatient care" — pushing that patient in as a new
 * outpatient lead. FAIL-CLOSED auth (mirrors flagStop, an external write): the
 * shared secret 'CREATE_LEAD_SECRET' Script Property MUST exist and match —
 * unlike the read endpoints (open when unset), a missing/empty/wrong secret is
 * rejected. The secret is read ONLY from Script Properties and is never logged.
 *
 * Appends ONE Leads row as a brand-new lead (stage 'new', created = today),
 * mirroring how addLeadFromForm builds a fresh lead in public/app.js: the lead
 * starts in the first kanban stage with empty serviceType/location/sessions/
 * price/startDate. phone MAY be empty (hand-entered patients have no phone);
 * it is normalized through _recoverPhone and stored as-is when blank. note is
 * free text (source + notes combined) and may be empty. Clients is never
 * touched — this only creates a lead for Vered to work.
 */

/* Known Dashboard houseId keys. They are identical to the Outpatient
 * house_of_origin keys (HOUSE_OF_ORIGIN_LABELS in public/app.js), so the
 * mapping is 1:1 / verbatim — no remapping table. Kept only to document the
 * contract; an UNKNOWN key is still stored as-is and never rejected, so an
 * unexpected house never fails the write (the lead must still be created). */
var CREATE_LEAD_HOUSE_KEYS = {
  raanana: true, ramot: true, efroni: true, rehab: true, external: true
};

function _mapLeadHouse(house) {
  // 1:1 with the Outpatient house_of_origin keys; unknown keys pass through
  // verbatim (guarded: never throw, never reject — the lead still writes).
  return String(house == null ? '' : house).trim();
}

/* Trim, strip control characters, and length-cap a free-text field before it
 * is written to the sheet. */
function _sanitizeLeadText(v, maxLen) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/* Mirrors uid() in public/app.js so server-created leads share the in-app id
 * shape (id_<base36 time>_<base36 rand>). */
function _leadUid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function _createLeadAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('CREATE_LEAD_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _createLead(payload) {
  var name = _sanitizeLeadText(payload && payload.name, 200);
  if (!name) return { ok: false, error: 'missing_name' };
  var phone = _recoverPhone(payload && payload.phone); // '' stays '' (valid)
  var note  = _sanitizeLeadText(payload && payload.note, 2000);
  var house = _mapLeadHouse(payload && payload.house);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // _ensureSheet applies the '@' plain-text format to the phone column for
    // the grid rows, so the appended phone keeps its leading zero.
    var sh = _ensureSheet('Leads', LEADS_HEADERS);
    var lead = {
      id: _leadUid(),
      name: name,
      phone: phone,
      serviceType: '',
      location: '',
      note: note,
      stage: 'new',
      sessionsPerWeek: '',
      pricePerSession: '',
      startDate: '',
      created: Utilities.formatDate(
        new Date(), Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd'),
      introDateTime: '',
      house_of_origin: house,
      not_relevant_reason: '',
      not_relevant_note: ''
    };
    sh.appendRow(LEADS_HEADERS.map(function (h) {
      return lead[h] == null ? '' : lead[h];
    }));
    return { ok: true, id: lead.id };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Merge duplicate clients =====
 *
 * Internal dashboard action (open, same trust level as saveAll). Merges one or
 * more duplicate client rows into a survivor:
 *   1. Repoint every Payments.clientId / ClientCharges.clientId from a dup to
 *      the survivor (and refresh Payments.clientName) — done BEFORE removal so
 *      no billing row is ever orphaned.
 *   2. Fill BLANK survivor fields from the dups (first non-blank), excluding
 *      id/status/exitDate/fromLead so the active survivor never inherits a
 *      discharge state.
 *   3. Remove the dup client rows.
 * All under one script lock, written back atomically. Returns counts.
 *
 * NOTE: a repointed payment/charge keeps its original deterministic id (it is a
 * historical record); only the clientId foreign key the dashboard groups on is
 * moved. The caller picks the survivor (default: the active row).
 */
function _isBlankCell(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function _mergeClients(payload) {
  var survivorId = (payload && payload.survivorId != null) ? String(payload.survivorId) : '';
  var dupIds = (payload && Array.isArray(payload.dupIds)) ? payload.dupIds.map(String) : [];
  if (!survivorId) return { ok: false, error: 'missing_survivor' };
  var dupSet = {};
  dupIds.forEach(function (id) { if (id && id !== survivorId) dupSet[id] = true; });
  dupIds = Object.keys(dupSet);
  if (!dupIds.length) return { ok: false, error: 'no_dups' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var clientsSh  = _ensureSheet('Clients', CLIENTS_HEADERS);
    var paymentsSh = _ensureSheet('Payments', PAYMENTS_HEADERS);
    var chargesSh  = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var clients  = _readAll(clientsSh, CLIENTS_HEADERS);
    var payments = _readAll(paymentsSh, PAYMENTS_HEADERS);
    var charges  = _readAll(chargesSh, CHARGES_HEADERS);

    var survivor = null, dups = [];
    for (var i = 0; i < clients.length; i++) {
      var id = String(clients[i].id);
      if (id === survivorId) survivor = clients[i];
      else if (dupSet[id]) dups.push(clients[i]);
    }
    if (!survivor) return { ok: false, error: 'survivor_not_found' };
    if (dups.length !== dupIds.length) return { ok: false, error: 'dup_not_found' };

    // 2. Fill blank survivor fields from dups (first non-blank), skipping fields
    //    we must not import onto the active survivor.
    var SKIP = { id: true, status: true, exitDate: true, fromLead: true };
    for (var h = 0; h < CLIENTS_HEADERS.length; h++) {
      var key = CLIENTS_HEADERS[h];
      if (SKIP[key] || !_isBlankCell(survivor[key])) continue;
      for (var d = 0; d < dups.length; d++) {
        if (!_isBlankCell(dups[d][key])) { survivor[key] = dups[d][key]; break; }
      }
    }

    // 1. Repoint billing rows dup -> survivor (before removal).
    var repPay = 0, repChg = 0;
    for (var p = 0; p < payments.length; p++) {
      if (dupSet[String(payments[p].clientId)]) {
        payments[p].clientId = survivorId;
        payments[p].clientName = survivor.name || payments[p].clientName || '';
        repPay++;
      }
    }
    for (var ch = 0; ch < charges.length; ch++) {
      if (dupSet[String(charges[ch].clientId)]) {
        charges[ch].clientId = survivorId;
        repChg++;
      }
    }

    // 3. Remove dup client rows and write everything back.
    var keptClients = clients.filter(function (c) { return !dupSet[String(c.id)]; });
    _writeAll(clientsSh, CLIENTS_HEADERS, keptClients);
    if (repPay) _writeAll(paymentsSh, PAYMENTS_HEADERS, payments);
    if (repChg) _writeAll(chargesSh, CHARGES_HEADERS, charges);

    return {
      ok: true,
      survivorId: survivorId,
      removed: dupIds,
      repointed: { payments: repPay, charges: repChg }
    };
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
      var sfParams = (e && e.parameter) || {};
      if (payload && payload.secret) sfParams.secret = payload.secret;
      if (!_stopFlagAuthOk(sfParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_flagStop(payload));
    }
    if (action === 'createLead') {
      var clParams = (e && e.parameter) || {};
      if (payload && payload.secret) clParams.secret = payload.secret;
      if (!_createLeadAuthOk(clParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_createLead(payload));
    }
    if (action === 'getStopFlags') return _json(_getStopFlags());
    if (action === 'resolveStopFlag') {
      return _json(_resolveStopFlag(payload.id, payload.resolvedBy));
    }
    if (action === 'mergeClients') {
      return _json(_mergeClients(payload));
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
    if (action === 'removeChargesForClient') {
      return _json(_removeChargesForClient(payload.clientId));
    }
    if (action === 'removeLead') return _json(_removeLead(payload.lead));
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
