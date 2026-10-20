'use strict';

// Build a standalone, non-deployed Google drill from the candidate's exact
// helper bodies. No production URL, workbook ID, credential or HTTP route.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { sandbox } = require('./apps-script-sandbox');
const renewal = require('./renewal-journal-fixture.cjs');
const extra = require('./extra-charge-journal-fixture.cjs');
const { signAssertion } = require('../lib/catalog-admin');
const root = path.join(__dirname, '..');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const PLACEHOLDER = 'ISOLATED_SCRIPT_ID_REQUIRED';
const entries = ['_integrityCaptureData', '_integrityWriteSnapshot',
  '_integrityValidateRestoreSet', '_integrityVerifyRecoveredWorkbook',
  '_integrityVerifyGrid', '_integrityFingerprint', 'beginOutpatientRecovery',
  'finishOutpatientRecovery', '_finJournal', '_recordSessionOutcome',
  '_applyRenewal', '_applyExtraCharge'];

function fixture() {
  const r = renewal.fixture(), e = extra.fixture();
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-20T10:00:00.000Z'])); }
    static now() { return Date.parse('2026-10-20T10:00:00.000Z'); }
  }
  for (const f of [r, e]) {
    f.sb.ctx.Date = FixtureDate;
    assert.equal(f.reserve().ok, true); assert.equal(f.apply().ok, true);
    assert.equal(f.ack().ok, true);
  }
  const s = r.sb;
  s.seed('FinancialOps', s.ctx.FINANCIAL_OP_HEADERS,
    [...s.rows('FinancialOps'), ...e.sb.rows('FinancialOps')]);
  s.seed('Payments', s.ctx.PAYMENTS_HEADERS,
    [...s.rows('Payments'), ...e.sb.rows('Payments')]);
  s.seed('ClientCharges', s.ctx.CHARGES_HEADERS, e.sb.rows('ClientCharges'));
  s.seed('Settings', s.ctx.SETTINGS_HEADERS, [{ key: 'drill', value: 'synthetic-only' }]);
  const therapist = Object.keys(s.ctx.THERAPIST_FLAT_RATES)[0];
  s.seed('TherapistRates', s.ctx.THERAPIST_RATES_HEADERS, [{ name: therapist, flatRate: 777 }]);
  s.seed('Clients', s.ctx.CLIENTS_HEADERS, [...s.rows('Clients'), {
    id: 'drill-session-client', name: 'בדיקת שחזור סינתטית', phone: '0500000099',
    status: 'פעיל', sessionsPerWeek: '1', creditsOwed: 0
  }]);
  const secret = 'synthetic-drill-session-secret-not-a-credential';
  s.props.SESSION_OUTCOME_SECRET = secret;
  const event = { sessionId: 'drill-cancelled-session', phone: '0500000099',
    patientName: 'בדיקת שחזור סינתטית', therapist, clinicalTreatmentType: 'פרטני CBT',
    date: '2026-10-19', outcome: 'therapist_cancelled', secret };
  assert.equal(s.post({ action: 'recordSessionOutcome', ...event }).ok, true);
  const paidEvent = { ...event, sessionId: 'drill-forwarded-session', outcome: 'happened' };
  assert.equal(s.post({ action: 'recordSessionOutcome', ...paidEvent }).ok, true);
  const sessions = s.rows('SessionLog');
  sessions.find(x => x.sessionId === paidEvent.sessionId).forwardedToPayroll = '2026-10';
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, sessions);
  assert.equal(s.ctx._finJournal().ops.length, 2);
  Object.assign(s.props, {
    PACKAGE_CATALOG_SECRET: 'synthetic-drill-catalog-secret-0123456789',
    PACKAGE_REQUEST_SECRET: 'synthetic-drill-request-secret-0123456789',
    CATALOG_ADMIN_ASSERTION_SECRET: 'synthetic-drill-assertion-secret-0123456789'
  });
  function admin(action, fields = {}) {
    const body = { user: 'ורד', ...fields };
    return s.post({ action, ...body, adminAssertion: signAssertion(action, body,
      s.props.CATALOG_ADMIN_ASSERTION_SECRET, { nowSec: FixtureDate.now() / 1000, nonce: 'drill-' + action }) });
  }
  assert.equal(admin('adminSeedPackageCatalog').ok, true);
  const requestId = '11111111-2222-4333-8444-555555555555';
  assert.equal(s.post({ action: 'createPackageRequest', requestId,
    secret: s.props.PACKAGE_REQUEST_SECRET, requesterKey: 'oren', patientName: event.patientName,
    patientPhone: event.phone, packageKey: 'emdr_core', months: 0,
    catalogEpoch: admin('adminGetPackageCatalog').catalogEpoch }).ok, true);
  assert.equal(admin('adminApprovePackageRequest', { requestId, expectedRevision: 1,
    opId: '99999999-2222-4333-8444-555555555555' }).ok, true);
  const grids = Object.fromEntries(Object.entries(s.sheets).map(([name, sh]) => [name, sh.grid]));
  grids.AuditLog = [[...s.ctx.AUDIT_LOG_HEADERS, 'literal', 'leadingZero', 'flag', 'amount', 'instant'],
    ['2026-10-20', 'drill', 'fixture', 'synthetic', 'synthetic', 'not production',
      '=1+1', '000123', true, 777.25, { drillDate: '2026-10-20T10:11:12.000Z' }]];
  return { grids, event, paidEvent, renewalId: r.request.opId, extraId: e.request.opId };
}

function build({ scriptId = PLACEHOLDER } = {}) {
  const productionId = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8')).scriptId;
  if (scriptId !== PLACEHOLDER && (!/^[A-Za-z0-9_-]{30,150}$/.test(scriptId) || scriptId === productionId)) {
    throw Error('Use a separately authorized isolated Apps Script project ID');
  }
  const code = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
  const ctx = sandbox().ctx, selected = new Set();
  const available = Object.keys(ctx).filter(n => !['Date', 'SpreadsheetApp', 'PropertiesService',
    'LockService', 'Logger', 'Session', 'Utilities', 'ContentService'].includes(n));
  function include(name) {
    if (selected.has(name)) return;
    if (!(name in ctx)) throw Error('Missing production helper: ' + name);
    selected.add(name);
    if (typeof ctx[name] !== 'function') return;
    const body = ctx[name].toString();
    if (!code.includes(body)) throw Error('Helper is not copied verbatim: ' + name);
    const words = new Set(body.match(/[A-Za-z_$][\w$]*/g));
    for (const dep of available) if (words.has(dep)) include(dep);
  }
  entries.forEach(include);
  function literal(v) {
    if (Object.prototype.toString.call(v) === '[object RegExp]') return v.toString();
    const value = JSON.stringify(v);
    if (value === undefined) throw Error('Unsupported helper constant');
    return value;
  }
  const names = [...selected].sort();
  const helpers = names.map(n => typeof ctx[n] === 'function' ? ctx[n].toString() :
    'var ' + n + ' = ' + literal(ctx[n]) + ';').join('\n\n');
  if (/\b(MailApp|GmailApp|UrlFetchApp|DriveApp|ScriptApp|doGet|doPost|nightlyIntegrityJob)\b/.test(helpers)) {
    throw Error('Unexpected external service/entry point in helper closure');
  }
  const template = fs.readFileSync(path.join(__dirname, 'google-operational-drill-template.txt'), 'utf8');
  const fixtures = JSON.stringify(fixture());
  const metadata = { sourceCodeSHA256: sha(code), helperSHA256: sha(helpers),
    drillDefinitionSHA256: sha(JSON.stringify([template, fixtures, helpers, scriptId])), helpers: names };
  const output = template.replace('__SCRIPT_ID_JSON__', JSON.stringify(scriptId))
    .replace('__METADATA_JSON__', JSON.stringify(metadata))
    .replace('__FIXTURE_JSON__', fixtures).replace('__HELPERS__', helpers);
  return { output, metadata };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--script-id')) throw Error('Usage: node test-support/build-google-operational-drill.cjs [--script-id ISOLATED_ID]');
  const result = build({ scriptId: args[1] || PLACEHOLDER });
  fs.writeFileSync(path.join(__dirname, 'google-operational-drill.gs'), result.output);
  console.log(JSON.stringify({ ...result.metadata, bytes: Buffer.byteLength(result.output), runnable: !!args[1] }));
}
module.exports = { build, fixture, PLACEHOLDER };
