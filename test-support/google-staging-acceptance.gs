/** @OnlyCurrentDoc */
// STAGING ONLY. Keep outside apps-script/ so production clasp never uploads it.
// Calls the unmodified Code.gs handlers with real Google Sheets/Lock/Properties
// services. Sequential stale snapshots are tested, not overlapping HTTP calls.
var STAGING_SHEET_ID = '1MdBzX6eDJIi9m7JXNuz-Z5OUh8e1dS6FjTGiw71D6n0';
var STAGING_SCRIPT_ID = '1IMz_TagTQBCsoK84TNHL5kBnBslH5W7jaZ20RFKA4dqkqfrbDHN42oE_';
var STAGING_SOURCE_COMMIT = 'ce3ec62a9c83dcc5c0e4a672b4653a11e095a159';
var STAGING_SOURCE_SHA256 = 'd1f030c3aec035a2fed69fa2f577a41ab1ba8edee54fcebacdbfda55b7971f56';

function stagingAssert_(condition, label) {
  if (!condition) throw new Error('STAGING ASSERTION: ' + label);
}

function stagingGuard_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  stagingAssert_(ss && ss.getId() === STAGING_SHEET_ID, 'wrong spreadsheet; no writes allowed');
  stagingAssert_(ScriptApp.getScriptId() === STAGING_SCRIPT_ID, 'wrong script; no writes allowed');
  stagingAssert_(Session.getScriptTimeZone() === 'Asia/Jerusalem', 'wrong script timezone');
  // Validate every row BEFORE any fixture reset. Never clear non-fixture data.
  ['Leads', 'Clients', 'לידים שהוסרו', 'Clients-removed'].forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var grid = sh.getDataRange().getValues();
    stagingAssert_(grid[0][0] === 'id', 'unexpected ID column in ' + name);
    grid.slice(1).forEach(function(row) {
      if (row.some(function(v) { return v !== '' && v !== null; })) {
        stagingAssert_(/^fixture-/.test(String(row[0])), 'non-fixture record in ' + name);
      }
    });
  });
  return ss;
}

function stagingLead_(id, name, phone) {
  return { id: id, name: name, phone: phone, serviceType: 'פרטני',
    location: 'רעננה הפרדס', note: 'נתוני דמה בלבד', stage: 'פרטים אישיים',
    created: '2026-10-01', house_of_origin: 'raanana', assignedTo: 'ורד',
    updatedAt: '2026-10-09T00:00:00.000Z', updatedBy: 'fixture-user' };
}

function stagingReset_() {
  var ss = stagingGuard_();
  var lead = stagingLead_('fixture-a', 'פניית בדיקה א', '0500000001');
  var removed = stagingLead_('fixture-removed', 'פניית בדיקה שהוסרה', '0500000003');
  removed.removedAt = '2026-10-08T00:00:00.000Z';
  removed.originSheet = 'Leads';
  var specs = [
    ['Leads', LEADS_HEADERS, [lead]],
    ['Clients', CLIENTS_HEADERS, []],
    ['לידים שהוסרו', REMOVED_LEADS_HEADERS.slice(0, 18), [removed]]
  ];
  specs.forEach(function(spec) {
    var sh = ss.getSheetByName(spec[0]);
    stagingAssert_(!!sh, 'required staging tab missing: ' + spec[0]);
    sh.clearContents();
    var rows = [spec[1]].concat(spec[2].map(function(row) {
      return spec[1].map(function(h) { return row[h] == null ? '' : row[h]; });
    }));
    sh.getRange(1, 1, rows.length, spec[1].length).setNumberFormat('@').setValues(rows);
  });
  PropertiesService.getScriptProperties().setProperty(CLIENTS_DATA_VERSION_PROP, '0');
  SpreadsheetApp.flush();
  return stagingGet_();
}

function stagingPost_(payload) {
  stagingGuard_();
  var response = JSON.parse(doPost({ parameter: {}, postData: { contents: JSON.stringify(payload) } }).getContent());
  stagingAssert_(response.ok === true, 'handler failed: ' + JSON.stringify(response));
  SpreadsheetApp.flush();
  return response;
}

function stagingGet_() {
  stagingGuard_();
  var data = JSON.parse(doGet({ parameter: { action: 'getData' } }).getContent());
  stagingAssert_(data.ok === true, 'getData failed');
  return data;
}

function stagingSave_(data, user) {
  return stagingPost_({ action: 'saveAll', leads: data.leads, clients: data.clients,
    dataVersion: data.dataVersion, user: user });
}

function stagingNewLead_() {
  return stagingLead_('fixture-b', 'פניית בדיקה ב', '0500000002');
}

function runStagingLeadAcceptance() {
  var ss = stagingGuard_();
  var runId = new Date().toISOString();
  var results = [];
  var cases = [
    ['stale_create_edit', function() {
      var first = stagingReset_();
      var second = stagingGet_();
      second.leads.push(stagingNewLead_());
      stagingSave_(second, 'fixture-user-b');
      var addedBefore = stagingGet_().leads.filter(function(l) { return l.id === 'fixture-b'; })[0];
      first.leads[0].note = 'הערת בדיקה מעותק ישן';
      var response = stagingSave_(first, 'fixture-user-a');
      var after = stagingGet_();
      stagingAssert_(response.preservedLeads === 1 && response.staleSave === true, 'preservation response');
      stagingAssert_(after.leads.length === 2 && after.clients.length === 0, 'both leads retained');
      var addedAfter = after.leads.filter(function(l) { return l.id === 'fixture-b'; })[0];
      stagingAssert_(JSON.stringify(addedAfter) === JSON.stringify(addedBefore), 'new lead fields/stamps retained');
      stagingAssert_(after.leads[0].phone === '0500000001' && addedAfter.phone === '0500000002', 'phone strings');
      return 'Two stale snapshots retained both leads, fields and timestamps.';
    }],
    ['removal_and_archive_upgrade', function() {
      var data = stagingReset_();
      data.leads.push(stagingNewLead_());
      stagingSave_(data, 'fixture-user-b');
      var stale = stagingGet_();
      stagingPost_({ action: 'removeLead', lead: stale.leads[0], user: 'fixture-remover' });
      stale.leads[1].note = 'עריכה לאחר הסרה';
      var response = stagingSave_(stale, 'fixture-user-a');
      var after = stagingGet_();
      stagingAssert_(response.staleSave === true && after.leads.length === 1 && after.leads[0].id === 'fixture-b', 'removed lead stays absent');
      var archive = ss.getSheetByName('לידים שהוסרו');
      stagingAssert_(JSON.stringify(archive.getRange(1, 1, 1, 20).getValues()[0]) === JSON.stringify(REMOVED_LEADS_HEADERS), 'append-only header upgrade');
      var rows = _readAll(archive, REMOVED_LEADS_HEADERS);
      stagingAssert_(rows.length === 2, 'single new tombstone');
      var prior = rows.filter(function(r) { return r.id === 'fixture-removed'; })[0];
      stagingAssert_(prior.phone === '0500000003' && prior.originSheet === 'Leads' && prior.assignedTo === 'ורד', 'old archive columns retained');
      var removed = rows.filter(function(r) { return r.id === 'fixture-a'; })[0];
      stagingAssert_(removed.updatedBy === 'fixture-remover' && /^\d{4}-\d{2}-\d{2}T/.test(removed.updatedAt), 'removal stamps');
      return 'Removed lead stayed absent; 18-column archive upgraded without shifting old data.';
    }],
    ['conversion_and_stale_resurrection', function() {
      var first = stagingReset_();
      var second = stagingGet_();
      second.leads.push(stagingNewLead_());
      stagingSave_(second, 'fixture-user-b');
      second = stagingGet_();
      first.clients = [{ id: 'fixture-client-a', name: 'מטופל בדיקה א', fromLead: 'fixture-a',
        phone: '0500000001', serviceType: 'פרטני', location: 'רעננה הפרדס',
        status: 'פעיל', source: 'lead', sessionsPerWeek: '{"פרטני":1}',
        pricePerSession: 1200, startDate: '2026-10-09', billingType: 'monthly',
        paymentStatus: 'unpaid', nextBillingDate: '2026-11-09' }];
      first.leads = [];
      var converted = stagingSave_(first, 'fixture-user-a');
      stagingAssert_(converted.preservedLeads === 1, 'conversion preserves unseen lead');
      second.leads.filter(function(l) { return l.id === 'fixture-b'; })[0].note = 'עריכה מעותק לפני המרה';
      var stale = stagingSave_(second, 'fixture-user-b');
      var after = stagingGet_();
      stagingAssert_(stale.staleSave === true && after.leads.length === 1 && after.leads[0].id === 'fixture-b', 'converted lead not resurrected');
      stagingAssert_(after.clients.length === 1 && after.clients[0].fromLead === 'fixture-a', 'converted client retained');
      stagingAssert_(Number(after.clients[0].pricePerSession) === 1200 && after.clients[0].nextBillingDate === '2026-11-09', 'existing price/date retained');
      return 'Conversion and the added lead survived a stale save; submitted price/date retained.';
    }],
    ['legacy_archive_read', function() {
      var stale = stagingReset_();
      var archive = ss.getSheetByName('לידים שהוסרו');
      var before = JSON.stringify(archive.getDataRange().getValues());
      stale.leads.push(stagingLead_('fixture-removed', 'פניית בדיקה שהוסרה', '0500000003'));
      var response = stagingSave_(stale, 'fixture-user-a');
      var after = stagingGet_();
      stagingAssert_(response.staleSave === true && after.leads.length === 1 && after.leads[0].id === 'fixture-a', 'legacy archived ID rejected');
      stagingAssert_(JSON.stringify(archive.getDataRange().getValues()) === before, 'save does not rewrite archive');
      return 'Legacy 18-column archive prevented resurrection and was unchanged.';
    }]
  ];
  cases.forEach(function(item) {
    var started = Date.now();
    var result = { scenario: item[0], status: 'PASS', detail: '' };
    try { result.detail = item[1](); }
    catch (error) { result.status = 'FAIL'; result.detail = String(error); }
    result.durationMs = Date.now() - started;
    results.push(result);
    console.log(JSON.stringify(result));
    stagingGuard_();
    var report = ss.getSheetByName('_Acceptance') || ss.insertSheet('_Acceptance');
    if (report.getLastRow() === 0) {
      report.appendRow(['runId', 'scenario', 'status', 'durationMs', 'detail', 'sourceCommit', 'sourceSHA256']);
      report.setFrozenRows(1);
    }
    report.appendRow([runId, result.scenario, result.status, result.durationMs, result.detail,
      STAGING_SOURCE_COMMIT, STAGING_SOURCE_SHA256]);
  });
  SpreadsheetApp.flush();
  var summary = { runId: runId, spreadsheetId: STAGING_SHEET_ID, scriptId: STAGING_SCRIPT_ID,
    sourceCommit: STAGING_SOURCE_COMMIT, sourceSHA256: STAGING_SOURCE_SHA256,
    passed: results.filter(function(r) { return r.status === 'PASS'; }).length,
    failed: results.filter(function(r) { return r.status === 'FAIL'; }).length };
  console.log('STAGING_SUMMARY ' + JSON.stringify(summary));
  stagingAssert_(summary.failed === 0, summary.failed + ' Google-runtime scenarios failed; inspect _Acceptance');
  return summary;
}
