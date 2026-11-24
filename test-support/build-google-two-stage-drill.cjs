'use strict';

// OP-03 Gate 0: an entirely separate *native* test harness. The historical
// five-phase operational drill remains unchanged. Never deploy this artifact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sandbox } = require('./apps-script-sandbox');
const { fixture, PLACEHOLDER } = require('./build-google-operational-drill.cjs');
const root = path.join(__dirname, '..');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

// These are the REAL product entrypoints. A helper-only drill is inadequate:
// it cannot measure the two independent Google execution time budgets.
const ENTRYPOINTS = Object.freeze([
  'nightlyIntegrityJob', 'finalizeNightlyIntegrityJob',
  '_integrityValidateRestoreSet', '_integrityVerifyRecoveredWorkbook',
  '_integrityWriteSnapshot', '_integrityCaptureData', '_integrityVerifyGrid',
  '_integrityFingerprint', '_integrityRecoveryMetadata'
]);

// Combined OUT #195 source only: the REAL group-credit journal reader and
// resume path, so the native restore can prove a pending intent resumes once.
// Absent on a #199-only source, where the closure stays byte-identical.
const GROUP_ENTRYPOINTS = Object.freeze(['_soJournalRows', '_soResumeOp']);

function extract() {
  const source = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
  const ctx = sandbox().ctx;
  const selected = new Set();
  const unavailable = new Set([
    'Date', 'SpreadsheetApp', 'PropertiesService', 'LockService', 'Logger',
    'Session', 'Utilities', 'ContentService', 'MailApp', 'ScriptApp',
    'DriveApp', 'UrlFetchApp', 'GmailApp', 'CacheService'
  ]);
  const available = Object.keys(ctx).filter(name => !unavailable.has(name));
  function include(name) {
    if (selected.has(name)) return;
    if (!(name in ctx)) throw Error('Missing real Apps Script source symbol: ' + name);
    selected.add(name);
    if (typeof ctx[name] !== 'function') return;
    const body = ctx[name].toString();
    if (!source.includes(body)) throw Error('Source helper is not verbatim: ' + name);
    const tokens = new Set(body.match(/[A-Za-z_$][\w$]*/g) || []);
    for (const dep of available) if (tokens.has(dep)) include(dep);
  }
  ENTRYPOINTS.forEach(include);
  if (ctx.SESSION_OUTCOME_OP_SHEET === 'SessionOutcomeOps') GROUP_ENTRYPOINTS.forEach(include);
  const names = [...selected].sort();
  function literal(v) {
    if (Object.prototype.toString.call(v) === '[object RegExp]') return v.toString();
    const json = JSON.stringify(v);
    if (json === undefined) throw Error('Unsupported source constant');
    return json;
  }
  const helpers = names.map(name => typeof ctx[name] === 'function'
    ? ctx[name].toString() : 'var ' + name + ' = ' + literal(ctx[name]) + ';').join('\n\n');
  // Only the explicitly sandboxed native services may be referenced. MailApp
  // is always injected as a no-send facade, even on a failing capture.
  if (/\b(?:UrlFetchApp|DriveApp|GmailApp|ScriptApp|doGet|doPost|XmlService)\b/.test(helpers))
    throw Error('Unapproved service or HTTP handler in native Gate 0 closure');
  return { source, helpers, names };
}
// Combined OUT #195 source only: add ONE committed group-credit journal row
// (SessionOutcomeOps) so native Gate 0 on the release candidate covers a
// NONEMPTY group journal. The shared historical fixture is NOT changed: its
// bytes are pinned by the frozen Oct 2026 drill evidence. On a source without
// the journal this returns the fixture unchanged (identical definition hash).
function withGroupJournal(base) {
  if (sandbox().ctx.SESSION_OUTCOME_OP_SHEET !== 'SessionOutcomeOps') return base;
  const s = sandbox([], [{ id: 'native-group-client', name: 'Synthetic group participant', phone: '0500000098',
    clinicalTreatmentType: 'קבוצה', serviceType: 'קבוצה', status: 'פעיל', sessionsPerWeek: '1', creditsOwed: 0 }]);
  // Deterministic build: the same fixed clock as the shared fixture.
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-20T10:00:00.000Z'])); }
    static now() { return Date.parse('2026-10-20T10:00:00.000Z'); }
  }
  s.ctx.Date = FixtureDate;
  s.props.SESSION_OUTCOME_SECRET = 'synthetic-native-group-secret-not-a-credential';
  const groupEvent = { sessionId: 'native-group-session', treatmentId: 'native-group-booking', phone: '0500000098',
    therapist: 'Synthetic Group Therapist', clinicalTreatmentType: 'קבוצה', date: '2026-10-19',
    outcome: 'patient_cancelled_notice', reportRevision: '2026-10-19T12:00:00.000Z' };
  const reply = s.post({ action: 'recordSessionOutcome', secret: s.props.SESSION_OUTCOME_SECRET, ...groupEvent });
  if (!reply.ok || !s.sheets.SessionOutcomeOps || s.sheets.SessionOutcomeOps.grid.length !== 2)
    throw Error('Synthetic group journal fixture failed');
  // A second participant whose report was interrupted after the credit write
  // and before the SessionLog row: its journal row stays PENDING. The native
  // restore must refuse cutover on it and resume it exactly once.
  s.seed('Clients', s.ctx.CLIENTS_HEADERS, [...s.rows('Clients'), { id: 'native-group-pending-client',
    name: 'Synthetic pending participant', phone: '0500000097', clinicalTreatmentType: 'קבוצה',
    serviceType: 'קבוצה', status: 'פעיל', sessionsPerWeek: '1', creditsOwed: 0 }]);
  const pendingEvent = { ...groupEvent, sessionId: 'native-group-session-pending',
    treatmentId: 'native-group-booking-pending', phone: '0500000097' };
  const log = s.sheets.SessionLog, append = log.appendRow; let armed = true;
  log.appendRow = function (...args) { if (armed) { armed = false; throw Error('synthetic interrupted write'); } return append.apply(this, args); };
  const interrupted = s.post({ action: 'recordSessionOutcome', secret: s.props.SESSION_OUTCOME_SECRET, ...pendingEvent });
  log.appendRow = append;
  const states = s.rows('SessionOutcomeOps').map(r => r.state);
  if (interrupted.ok || JSON.stringify(states) !== JSON.stringify(['committed', 'pending']) ||
      Number(s.rows('Clients').find(r => r.id === 'native-group-pending-client').creditsOwed) !== 1)
    throw Error('Synthetic pending group intent fixture failed');
  const out = JSON.parse(JSON.stringify(base));
  for (const name of ['Clients', 'SessionLog']) {
    const grid = s.sheets[name].grid;
    if (JSON.stringify(out.grids[name][0]) !== JSON.stringify(grid[0])) throw Error('Group fixture header drift: ' + name);
    out.grids[name] = out.grids[name].concat(JSON.parse(JSON.stringify(grid.slice(1))));
  }
  out.grids.SessionOutcomeOps = JSON.parse(JSON.stringify(s.sheets.SessionOutcomeOps.grid));
  out.groupEvent = groupEvent;
  out.pendingGroupEvent = pendingEvent;
  return out;
}
function build({ scriptId = PLACEHOLDER } = {}) {
  const productionId = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8')).scriptId;
  if (scriptId !== PLACEHOLDER &&
      (!/^[A-Za-z0-9_-]{30,150}$/.test(scriptId) || scriptId === productionId))
    throw Error('Use a NEW standalone isolated Apps Script project ID, never production');
  const { source, helpers, names } = extract();
  const template = fs.readFileSync(path.join(__dirname, 'google-two-stage-drill-template.txt'), 'utf8');
  const fixtures = JSON.stringify(withGroupJournal(fixture())); // source-derived synthetic data only
  const metadata = {
    sourceCodeSHA256: sha(source), helperSHA256: sha(helpers),
    drillDefinitionSHA256: sha(JSON.stringify([template, fixtures, helpers, scriptId])),
    helperNames: names, realEntrypoints: ['nightlyIntegrityJob', 'finalizeNightlyIntegrityJob'],
    nativeOnly: true, productionCertified: false
  };
  let output = template;
  for (const [token, value] of Object.entries({
    __SCRIPT_ID_JSON__: JSON.stringify(scriptId),
    __METADATA_JSON__: JSON.stringify(metadata),
    __FIXTURE_JSON__: fixtures,
    __HELPERS__: helpers
  })) {
    if (output.split(token).length !== 2) throw Error('Invalid Gate 0 template token: ' + token);
    output = output.replace(token, value);
  }
  if (!output.includes('function nightlyIntegrityJob(') ||
      !output.includes('function finalizeNightlyIntegrityJob('))
    throw Error('REAL phase A/B source bodies absent: never certify a helper-only drill');
  return { output, metadata };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--script-id'))
    throw Error('Usage: build-google-two-stage-drill.cjs [--script-id ISOLATED_ID]');
  const result = build({ scriptId: args[1] || PLACEHOLDER });
  fs.writeFileSync(path.join(__dirname, 'google-two-stage-drill-candidate.gs'), result.output);
  console.log(JSON.stringify({
    ...result.metadata, bytes: Buffer.byteLength(result.output), runnable: Boolean(args[1])
  }));
}
module.exports = { build, extract, withGroupJournal, ENTRYPOINTS, GROUP_ENTRYPOINTS, PLACEHOLDER };
