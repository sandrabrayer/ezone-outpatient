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
 * (debt, stop-flow). It is appended LAST per the append-only rule: _readAll/
 * _writeAll map columns positionally to this array, so a new column may only be
 * added at the end — inserting it mid-array would shift every later column on
 * existing rows. Old rows get a blank `phone` until re-saved; the client
 * backfills it in memory from the originating lead. It is a PHONE_COLUMN, so it
 * gets the same Sheets leading-zero text-format/recovery as the other phones. */
var CLIENTS_HEADERS = [
  'id', 'name', 'serviceType', 'location', 'sessionsPerWeek',
  'pricePerSession', 'startDate', 'status', 'exitDate', 'fromLead',
  'source', 'notes', 'billingType', 'billingDay',
  'bundleSize', 'bundlePrice', 'sessionsUsed', 'bundlePaid',
  'house_of_origin',
  // RESERVED / DEAD (task 4.4): the אחראי concept (responsiblePerson + its
  // serviceScope role) was removed from the app. These two slots are kept ONLY
  // to preserve column positions — _readAll/_writeAll are positional and
  // _ensureSheet does not migrate data, so dropping mid-array headers would
  // shift/corrupt every column after this point (incl. the `phone` join key).
  // The app no longer reads or writes them; existing cells blank on next save.
  'responsiblePerson', 'serviceScope',
  'treatmentContactPhone', 'payerName', 'payerPhone', 'paymentLink',
  'phone',
  // APPEND-ONLY (task 4.5a): clinical treatment type as recorded by the E-Zone
  // Therapists app. When present on save, _deriveClientServiceType() runs it
  // through the clinical→billing map and overwrites `serviceType` (clinical is
  // the source of truth). Appended at the END so existing rows are untouched
  // and positional mapping is preserved (same lesson as `phone` / the reserved
  // slots). Absent/empty -> serviceType left as-is (back-compat).
  'clinicalTreatmentType'
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
 * header row, so future writes preserve leading zeros. */
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
  _formatPhoneColumns(sh, headers);
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

/* ===== Clinical → billing derive (task 4.5a receiver) =====
 *
 * MIRROR of public/treatment-map.js `CLINICAL_TO_BILLING`. The Apps Script
 * runtime cannot import that module, so the map is duplicated here, exactly as
 * the debt/phone rules are. test/clinical-derive.test.js parses this literal and
 * asserts it deep-equals the module — any drift fails the suite. Keep in sync.
 *
 * One-to-one over 12 clinical keys; two renames are pinned (פרטני כללי→פרטני and
 * מרכז יום→ליווי יומי בקהילה, here keyed under the NEW name); the five
 * newly-billable types map to their own names.
 */
var CLINICAL_TO_BILLING = {
  'פרטני כללי':             'פרטני',
  'פרטני CBT':              'פרטני CBT',
  'פרטני EMDR':             'פרטני EMDR',
  'קבוצה':                  'קבוצה',
  'טיפול משפחתי':           'טיפול משפחתי',
  'מעקב פסיכיאטרי':         'מעקב פסיכיאטרי',
  'ליווי יומי בקהילה':      'ליווי יומי בקהילה',
  'פסיכודינמי':             'פסיכודינמי',
  'פסיכותרפי ממוקד טראומה': 'פסיכותרפי ממוקד טראומה',
  'עיסוי טיפולי':           'עיסוי טיפולי',
  'טיפול ממוקד התמכרויות':  'טיפול ממוקד התמכרויות',
  'טיפול אינטגרטיבי':       'טיפול אינטגרטיבי'
};

function _clinicalToBilling(clinicalType) {
  var key = String(clinicalType == null ? '' : clinicalType).trim();
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_TO_BILLING, key)) {
    throw new Error('Unknown clinical treatment type: "' + key + '"');
  }
  return CLINICAL_TO_BILLING[key];
}

/* If a client row carries a clinicalTreatmentType, derive serviceType from it
 * (clinical is authoritative) and overwrite. Absent/empty -> leave serviceType
 * untouched (back-compat for legacy / not-yet-migrated rows). Throws on an
 * unknown clinical value rather than silently blanking. Mutates + returns. */
function _deriveClientServiceType(client) {
  if (!client) return client;
  var clinical = String(client.clinicalTreatmentType == null ? '' : client.clinicalTreatmentType).trim();
  if (!clinical) return client;
  client.serviceType = _clinicalToBilling(clinical);
  return client;
}

/* ===== Pay + price mirrors (task 4.8-step3-out) =============================
 *
 * MIRRORS of public/therapist-pay.js (the PAY side) and the price half of
 * public/treatment-map.js (the client-facing BILLING side). The Apps Script
 * runtime cannot import those modules, so — exactly like CLINICAL_TO_BILLING
 * above — the tables are duplicated here. test/session-outcome.test.js parses
 * each literal out of Code.gs and asserts it deep-equals the canonical module,
 * so the mirror can never silently drift. Keep in sync; ALL RATES ARE PRE-VAT on
 * the pay side and INCL. VAT on the billing side, untouched here.
 */

// --- Pay: flat per-therapist (pre-VAT). Mirror of FLAT_RATES. ----------------
var THERAPIST_FLAT_RATES = {
  'מעיין דלומי': 250,
  'ניר אורן':    250,
  'תמר גנץ':     250,
  'דליה מלמד':   230,
  'אלה שפירא':   230,
  'ליאת חגאבי':  230,
  'נועה דואק':   230,
  'חנן וייל':    230,
  'יפעת רומנו':  220,
  'כנרת זיידן':  220,
  'איתן דשה':    210,
  'נועה זיפמן':  210,
  'רעות חוצה':   200,
  'דניאל סייג':  200,
  'אסתר':        180
};

// --- Pay: psychiatrists by treatment type (pre-VAT). Mirror of PSYCHIATRIST_RATES.
var PSYCHIATRIST_RATES = {
  'ד״ר שפרינץ': { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 },
  'ד״ר דנגור':  { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 }
};

// --- Billing: flat client-facing prices (incl. VAT). Mirror of BILLING_PRICES.
// 0 is a DECIDED price (קבוצה intentionally free), not a "no price" flag.
var BILLING_PRICES = {
  'פרטני':                  500,
  'פרטני CBT':              500,
  'פרטני EMDR':             500,
  'פסיכודינמי':             500,
  'פסיכותרפי ממוקד טראומה': 500,
  'עיסוי טיפולי':           500,
  'טיפול ממוקד התמכרויות':  500,
  'טיפול אינטגרטיבי':       500,
  'מעקב פסיכיאטרי':         1100,
  'אינטייק':                2300,
  'קבוצה':                  0,
  'טיפול משפחתי':           600
};

// Day-center is priced by weekly frequency, not in BILLING_PRICES. Mirror of
// DAY_CENTER_BILLING / DAY_CENTER_MONTHLY_BY_FREQ.
var DAY_CENTER_BILLING = 'ליווי יומי בקהילה';
var DAY_CENTER_MONTHLY_BY_FREQ = { 3: 15000, 5: 18000 };
var GROUP_BILLING = 'קבוצה';

function _hasOwn(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

/* _therapistPay(name, treatmentType?) -> pre-VAT rate. Mirror of therapistPay():
 * flat therapist ignores type; psychiatrist REQUIRES a valid type; unknown
 * therapist / bad psych type throws. */
function _therapistPay(therapistName, treatmentType) {
  var name = String(therapistName == null ? '' : therapistName).trim();
  if (_hasOwn(THERAPIST_FLAT_RATES, name)) return THERAPIST_FLAT_RATES[name];
  if (_hasOwn(PSYCHIATRIST_RATES, name)) {
    var type = String(treatmentType == null ? '' : treatmentType).trim();
    var table = PSYCHIATRIST_RATES[name];
    if (!type || !_hasOwn(table, type)) {
      throw new Error('Psychiatrist "' + name + '" requires a valid treatmentType (אינטייק or מעקב פסיכיאטרי)');
    }
    return table[type];
  }
  throw new Error('Unknown therapist: "' + name + '"');
}

function _isDayCenterBilling(billingType) {
  return String(billingType == null ? '' : billingType).trim() === DAY_CENTER_BILLING;
}

/* _billingPrice(billingType, freqPerWeek?) -> price. Mirror of billingPrice():
 * day-center REQUIRES a valid frequency (3/5); flat types return the number;
 * unknown billing type throws. */
function _billingPrice(billingType, freqPerWeek) {
  var key = String(billingType == null ? '' : billingType).trim();
  if (_isDayCenterBilling(key)) {
    if (freqPerWeek === undefined || freqPerWeek === null || freqPerWeek === '') {
      throw new Error('ליווי יומי בקהילה requires frequencyPerWeek (3 or 5)');
    }
    var freq = Number(freqPerWeek);
    if (!_hasOwn(DAY_CENTER_MONTHLY_BY_FREQ, freq)) {
      throw new Error('Unsupported ליווי יומי בקהילה frequency: ' + freqPerWeek + ' (expected 3 or 5)');
    }
    return DAY_CENTER_MONTHLY_BY_FREQ[freq];
  }
  if (!_hasOwn(BILLING_PRICES, key)) {
    throw new Error('Unknown billing type: "' + key + '"');
  }
  return BILLING_PRICES[key];
}

function _saveAll(payload) {
  var leadsSh = _ensureSheet('Leads', LEADS_HEADERS);
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var leads = (payload && payload.leads) || [];
  var clients = (payload && payload.clients) || [];
  for (var i = 0; i < clients.length; i++) _deriveClientServiceType(clients[i]);
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

/* ===== Set clinical treatment type (secured cross-app write) =====
 *
 * Inbound: the E-Zone Therapists app POSTs { action:'setClinicalType', secret,
 * phone, clinicalTreatmentType } directly to this /exec. FAIL-CLOSED auth: the
 * shared secret 'CLINICAL_TYPE_SECRET' Script Property MUST exist and match —
 * same model as flagStop, NOT the fail-open read pattern. An unset/empty/wrong
 * secret REJECTS (this is an external write to Clients).
 *
 * Behaviour (never fail-open, never guess):
 *   single phone match   -> set that client's clinicalTreatmentType, derive +
 *                           overwrite serviceType via the SAME _clinicalToBilling
 *                           / _deriveClientServiceType used on save, write the
 *                           row, return { ok:true, matched:1 }.
 *   no match             -> { ok:false, reason:'no_match' },    write nothing.
 *   multiple matches     -> { ok:false, reason:'multi_match' }, write nothing.
 *   unknown clinical type-> { ok:false, reason:'unknown_type' },write nothing.
 *
 * Only the two fields (clinicalTreatmentType + derived serviceType) change on the
 * matched row; every other cell is written back exactly as read. _writeAll maps
 * positionally so the full Clients array is rewritten — untouched rows are
 * byte-identical, preserving the append-only column layout.
 */
function _clinicalTypeAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('CLINICAL_TYPE_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _setClinicalType(payload) {
  var phone = _recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, reason: 'invalid_phone' };

  var clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!clinical) return { ok: false, reason: 'unknown_type' };
  // Validate against the SAME map used on save — reject (write nothing) before
  // touching the sheet rather than letting the derive throw mid-write.
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_TO_BILLING, clinical)) {
    return { ok: false, reason: 'unknown_type' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var clients = _readAll(sh, CLIENTS_HEADERS);

    // Match by canonical phone across the same phone fields _matchStopFlagClient
    // checks (patient phone / treatment-contact / payer). Never guess: a single
    // hit writes, anything else writes nothing.
    var hits = [];
    for (var i = 0; i < clients.length; i++) {
      var c = clients[i];
      if (_recoverPhone(c.phone) === phone ||
          _recoverPhone(c.treatmentContactPhone) === phone ||
          _recoverPhone(c.payerPhone) === phone) {
        hits.push(c);
      }
    }
    if (hits.length === 0) return { ok: false, reason: 'no_match' };
    if (hits.length > 1) return { ok: false, reason: 'multi_match' };

    var client = hits[0];
    client.clinicalTreatmentType = clinical;
    _deriveClientServiceType(client); // overwrites serviceType via _clinicalToBilling

    _writeAll(sh, CLIENTS_HEADERS, clients);
    return { ok: true, matched: 1 };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Record session outcome (secured cross-app write — task 4.8-step3-out) =
 *
 * Inbound: the E-Zone Therapists app POSTs a session-outcome event:
 *   { action:'recordSessionOutcome', secret, sessionId, phone, therapist,
 *     clinicalTreatmentType, date, outcome, patientName?, freqPerWeek? }
 * FAIL-CLOSED auth ('SESSION_OUTCOME_SECRET' Script Property must exist + match —
 * same model as flagStop / setClinicalType, NOT the fail-open read pattern).
 *
 * Computes the therapist pay + client session value for the session and logs ONE
 * reconciliation row to the SessionLog tab, UPSERTED by sessionId (a corrected
 * outcome re-sent with the same sessionId overwrites the row and recomputes pay —
 * never a duplicate, never stale pay). Clients is NEVER modified.
 *
 *   outcome:        happened | therapist_cancelled | patient_no_show (any other
 *                   value rejects, writes nothing)
 *   sessionStatus:  happened->consumed, therapist_cancelled->credited,
 *                   patient_no_show->forfeited
 *   therapistPay:   happened / patient_no_show -> _therapistPay (therapist showed
 *                   up, so a no-show still pays); therapist_cancelled -> 0 (never
 *                   delivered); group (קבוצה) -> 0
 *   clientSessionValue: _billingPrice(billingType, freq). קבוצה -> 0 (decided
 *                   free). ליווי with NO freq in the event -> null (blank cell —
 *                   flagged, never guessed; distinct from a real 0).
 *
 * Unknown clinical type / unknown outcome / (for paid non-group outcomes) unknown
 * therapist all REJECT and write nothing. The log is keyed by session, so it
 * always writes regardless of client match: matchStatus records matched (single
 * phone hit, fills clientId+patientName) / no_match / multi_match.
 */
var SESSION_LOG_HEADERS = [
  'sessionId', 'phone', 'patientName', 'clientId',
  'therapist', 'clinicalTreatmentType', 'billingType', 'date',
  'outcome', 'therapistPay', 'clientSessionValue', 'sessionStatus',
  'matchStatus', 'recordedAt'
];

var SESSION_STATUS_BY_OUTCOME = {
  happened:            'consumed',
  therapist_cancelled: 'credited',
  patient_no_show:     'forfeited'
};

function _sessionOutcomeAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('SESSION_OUTCOME_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

/* Pay rule by outcome. therapist_cancelled and group never call _therapistPay,
 * so they log fine even for an unknown therapist; only a PAID non-group outcome
 * (happened / patient_no_show) looks up the therapist and may throw. */
function _computeSessionPay(outcome, therapist, clinicalTreatmentType, billingType) {
  if (outcome === 'therapist_cancelled') return 0; // never delivered -> never paid
  if (billingType === GROUP_BILLING) return 0;      // group -> 0 pay
  return _therapistPay(therapist, clinicalTreatmentType); // showed up -> paid
}

/* Value rule. Day-center needs a frequency; if the event carries none, return
 * null (flag) rather than guessing. Everything else (incl. group -> 0) prices
 * straight from the billing table. */
function _computeSessionValue(billingType, freqPerWeek) {
  if (_isDayCenterBilling(billingType) &&
      (freqPerWeek === undefined || freqPerWeek === null || freqPerWeek === '')) {
    return null;
  }
  return _billingPrice(billingType, freqPerWeek);
}

function _recordSessionOutcome(payload) {
  var sessionId = String((payload && payload.sessionId) || '').trim();
  if (!sessionId) return { ok: false, reason: 'missing_session_id' };

  var outcome = String((payload && payload.outcome) || '').trim();
  if (!_hasOwn(SESSION_STATUS_BY_OUTCOME, outcome)) {
    return { ok: false, reason: 'unknown_outcome' };
  }

  var clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!clinical || !_hasOwn(CLINICAL_TO_BILLING, clinical)) {
    return { ok: false, reason: 'unknown_type' };
  }
  var billingType = _clinicalToBilling(clinical);
  var therapist = String((payload && payload.therapist) || '').trim();

  // Frequency only matters for ליווי; absent everywhere else. Accept either key.
  var freq;
  if (payload && payload.freqPerWeek != null && payload.freqPerWeek !== '') freq = payload.freqPerWeek;
  else if (payload && payload.frequencyPerWeek != null && payload.frequencyPerWeek !== '') freq = payload.frequencyPerWeek;

  var therapistPay, clientSessionValue;
  try {
    therapistPay = _computeSessionPay(outcome, therapist, clinical, billingType);
  } catch (err) {
    return { ok: false, reason: 'unknown_therapist' };
  }
  try {
    clientSessionValue = _computeSessionValue(billingType, freq);
  } catch (err) {
    return { ok: false, reason: 'invalid_frequency' };
  }

  var sessionStatus = SESSION_STATUS_BY_OUTCOME[outcome];
  var phone = _recoverPhone(payload && payload.phone);
  var patientName = String((payload && payload.patientName) || '').trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Optional client match for enrichment — never gates the log (keyed by session).
    var clientId = '', matchStatus = 'no_match';
    if (phone && /^0\d{8,9}$/.test(phone)) {
      var clients = _readAll(_ensureSheet('Clients', CLIENTS_HEADERS), CLIENTS_HEADERS);
      var hits = [];
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (_recoverPhone(c.phone) === phone ||
            _recoverPhone(c.treatmentContactPhone) === phone ||
            _recoverPhone(c.payerPhone) === phone) {
          hits.push(c);
        }
      }
      if (hits.length === 1) {
        clientId = String(hits[0].id);
        matchStatus = 'matched';
        if (!patientName) patientName = String(hits[0].name == null ? '' : hits[0].name).trim();
      } else if (hits.length > 1) {
        matchStatus = 'multi_match';
      }
    }

    var rowObj = {
      sessionId:          sessionId,
      phone:              phone,
      patientName:        patientName,
      clientId:           clientId,
      therapist:          therapist,
      clinicalTreatmentType: clinical,
      billingType:        billingType,
      date:               String((payload && payload.date) || '').trim(),
      outcome:            outcome,
      therapistPay:       therapistPay,
      clientSessionValue: clientSessionValue,   // null -> blank cell (flag)
      sessionStatus:      sessionStatus,
      matchStatus:        matchStatus,
      recordedAt:         new Date().toISOString()
    };

    var sh = _ensureSheet('SessionLog', SESSION_LOG_HEADERS);
    var rowArr = SESSION_LOG_HEADERS.map(function (h) {
      var v = rowObj[h];
      return (v === undefined || v === null) ? '' : v;
    });
    var idIdx = SESSION_LOG_HEADERS.indexOf('sessionId');
    var lastRow = sh.getLastRow();
    var upserted = false;
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var r = 0; r < ids.length; r++) {
        if (String(ids[r][0]) === sessionId) {
          sh.getRange(r + 2, 1, 1, SESSION_LOG_HEADERS.length).setValues([rowArr]);
          upserted = true;
          break;
        }
      }
    }
    if (!upserted) sh.appendRow(rowArr);

    var result = {
      ok: true,
      sessionId: sessionId,
      therapistPay: therapistPay,
      clientSessionValue: clientSessionValue,
      sessionStatus: sessionStatus
    };
    if (upserted) result.upserted = true; else result.appended = true;
    return result;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
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
    if (action === 'setClinicalType') {
      var ctParams = (e && e.parameter) || {};
      if (payload && payload.secret) ctParams.secret = payload.secret;
      if (!_clinicalTypeAuthOk(ctParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_setClinicalType(payload));
    }
    if (action === 'recordSessionOutcome') {
      var soParams = (e && e.parameter) || {};
      if (payload && payload.secret) soParams.secret = payload.secret;
      if (!_sessionOutcomeAuthOk(soParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_recordSessionOutcome(payload));
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
    if (action === 'removeLead') return _json(_removeLead(payload.lead));
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
