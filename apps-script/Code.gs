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
  'responsiblePerson', 'serviceScope'
];

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

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getData';
    if (action === 'getData')      return _json(_getData());
    if (action === 'getPayments')  return _json(_getPayments());
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
    if (action === 'savePayment' || action === 'updatePayment') {
      return _json(_upsertPayment(payload.payment));
    }
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
