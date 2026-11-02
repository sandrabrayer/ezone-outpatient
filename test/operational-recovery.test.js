'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { harness } = require('../test-support/backup-sandbox.cjs');
const { signAssertion } = require('../lib/catalog-admin');
const { randomUUID } = require('node:crypto');
const dayOf = h => h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
const event = { sessionId: 'synthetic-session-001', phone: '0500000001', patientName: 'בדיקת שחזור',
  clinicalTreatmentType: 'פרטני CBT', date: '2026-10-19', outcome: 'therapist_cancelled', therapist: 'synthetic' };

function world() {
  const s = sandbox([], [{ id: 'synthetic-client', name: event.patientName, phone: event.phone, creditsOwed: 0, sessionsPerWeek: '1' }]);
  s.props.SESSION_OUTCOME_SECRET = 'synthetic-outcome-secret';
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, []);
  s.seed('TherapistRates', s.ctx.THERAPIST_RATES_HEADERS, [{ name: Object.keys(s.ctx.THERAPIST_FLAT_RATES)[0], flatRate: 777 }]);
  s.seed('Settings', s.ctx.SETTINGS_HEADERS, [{ key: 'synthetic-setting', value: 'fixture' }]);
  return s;
}
const send = (s, e = event) => s.post({ action: 'recordSessionOutcome', secret: s.props.SESSION_OUTCOME_SECRET, ...e });
function snapshot(s) {
  const h = harness(Object.fromEntries(Object.entries(s.sheets).map(([n, sh]) => [n, sh.grid])));
  if (s.props.FINANCIAL_OPS_CREATED) h.props.FINANCIAL_OPS_CREATED = s.props.FINANCIAL_OPS_CREATED;
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.logs.some(l => l.includes('INTEGRITY ALERT')), false, h.logs.join('\n'));
  return h;
}
function restored(h) {
  const s = world();
  for (const n of Object.keys(s.sheets)) delete s.sheets[n];
  for (const x of h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h), false)) {
    if (x.absent || x.source === '__RecoveryMetadata') continue;
    s.seed(x.source, x.grid[0], x.grid.slice(1).map(row => Object.fromEntries(x.grid[0].map((key, i) => [key, row[i]]))));
  }
  return s;
}
const target = s => ({ ...s.ctx.SpreadsheetApp.getActiveSpreadsheet(), getId: () => 'isolated-target' });
const preflight = (h, s, config = true) => h.ctx._integrityVerifyRecoveredWorkbook(h.backup, dayOf(h), target(s), config);

for (const timing of ['before-admission', 'while-queued', 'lock-busy']) {
  test('preferred-house writer preserves cells and headers when ' + timing, () => {
    const s = world();
    // A queued old-width sheet would be extended by _ensureSheet before the
    // cell write. The hold must prevent that mutation as well as the value.
    s.sheets.Clients.grid.forEach(row => row.pop());
    const before = JSON.stringify(s.sheets);
    if (timing === 'before-admission') s.props.OUTPATIENT_RECOVERY_HOLD = '1';
    if (timing === 'while-queued') {
      const acquire = s.lock.tryLock;
      s.lock.tryLock = () => { const ok = acquire(); s.props.OUTPATIENT_RECOVERY_HOLD = '1'; return ok; };
    }
    if (timing === 'lock-busy') s.lock.tryLock = () => false;
    const reply = s.post({ action: 'setPreferredHouse', clientId: 'synthetic-client', preferredHouse: 'רמות השבים' });
    assert.equal(reply.ok, false);
    assert.match(reply.error, timing === 'lock-busy' ? /busy/ : /recovery_pending/);
    assert.equal(JSON.stringify(s.sheets), before);
    assert.equal(s.isLocked(), false);
  });
}

const preferredSchemas = [
  ['Clients', 'CLIENTS_HEADERS'], ['Leads', 'LEADS_HEADERS'],
  ['Clients-removed', 'CLIENTS_REMOVED_HEADERS'], ['לידים שהוסרו', 'REMOVED_LEADS_HEADERS']
];
test('preferred house survives typed capture and isolated recovery in all four appended schemas', () => {
  const s = world();
  for (const [name, header] of preferredSchemas) {
    s.seed(name, s.ctx[header], [{ id: 'synthetic-' + name, preferredHouse: 'רמות השבים' }]);
  }
  const h = snapshot(s), r = restored(h);
  assert.equal(preflight(h, r).ok, true);
  for (const [name] of preferredSchemas) {
    assert.equal(r.rows(name)[0].preferredHouse, 'רמות השבים');
    assert.deepEqual(Array.from(r.sheets[name].grid, row => Array.from(row)),
      Array.from(s.sheets[name].grid, row => Array.from(row)));
  }
});

for (const [name, header] of preferredSchemas) {
  test('old-width ' + name + ' backup stays inspection-only and cannot release recovery', () => {
    const s = world();
    const oldHeader = Array.from(s.ctx[header]).slice(0, -1);
    assert.equal(s.ctx[header][oldHeader.length], 'preferredHouse');
    s.seed(name, oldHeader, [{ id: 'synthetic-old-schema' }]);
    const h = snapshot(s), r = restored(h);
    assert.ok(h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h)).length);
    const before = JSON.stringify(r.sheets);
    assert.throws(() => preflight(h, r), /Recovery schema mismatch/);
    h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
    h.props.OUTPATIENT_RECOVERY_HOLD = '1';
    assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true), /Recovery schema mismatch/);
    assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
    assert.equal(JSON.stringify(r.sheets), before, 'no invented blank tail or header repair');
    assert.deepEqual(h.locks(), [false, false]);
  });
}

function configurePackages(s) {
  Object.assign(s.props, {
    PACKAGE_CATALOG_SECRET: 'synthetic-catalog-secret-0123456789-A',
    PACKAGE_REQUEST_SECRET: 'synthetic-request-secret-0123456789-B',
    CATALOG_ADMIN_ASSERTION_SECRET: 'synthetic-admin-assertion-0123456789-C'
  });
}
function packageAdmin(s, action, fields = {}) {
  const body = { user: 'ורד', ...fields };
  return s.post({ action, ...body, adminAssertion: signAssertion(action, body, s.props.CATALOG_ADMIN_ASSERTION_SECRET) });
}

test('real package catalog and approved request survive operational restore and exact retry without duplicate rows', () => {
  const s = world(); configurePackages(s);
  assert.equal(packageAdmin(s, 'adminSeedPackageCatalog').ok, true);
  const request = { action: 'createPackageRequest', secret: s.props.PACKAGE_REQUEST_SECRET,
    requestId: randomUUID(), requesterKey: 'oren', patientName: event.patientName,
    patientPhone: event.phone, packageKey: 'emdr_core', months: 0,
    catalogEpoch: packageAdmin(s, 'adminGetPackageCatalog').catalogEpoch };
  assert.equal(s.post(request).ok, true);
  assert.equal(packageAdmin(s, 'adminApprovePackageRequest', {
    requestId: request.requestId, expectedRevision: 1, opId: randomUUID()
  }).ok, true);
  const expectedCatalog = s.rows('PackageCatalog'), expectedRequests = s.rows('PackageRequests');
  const h = snapshot(s), r = restored(h);
  assert.equal(preflight(h, r).ok, true);
  configurePackages(r); // Operator-supplied fixture config; never restored from backup.
  const replay = r.post(request);
  assert.equal(replay.ok, true);
  assert.equal(replay.status, 'priced');
  assert.equal(r.rows('PackageRequests').length, 1);
  assert.deepEqual(r.rows('PackageRequests'), expectedRequests);
  assert.deepEqual(r.rows('PackageCatalog'), expectedCatalog);
  assert.equal(r.rows('ClientCharges').length, 0);
  assert.equal(r.rows('Payments').length, 0);
});

for (const action of ['adminSeedPackageCatalog', 'createPackageRequest']) {
  test('queued package writer ' + action + ' refuses a hold acquired while waiting for its lock', () => {
    const s = world(); configurePackages(s);
    assert.equal(packageAdmin(s, 'adminSeedPackageCatalog').ok, true);
    const epoch = packageAdmin(s, 'adminGetPackageCatalog').catalogEpoch;
    const before = JSON.stringify(s.sheets);
    const wait = s.lock.waitLock;
    s.lock.waitLock = () => { wait(); s.props.OUTPATIENT_RECOVERY_HOLD = '1'; };
    const reply = action === 'adminSeedPackageCatalog' ? packageAdmin(s, action) : s.post({
      action, secret: s.props.PACKAGE_REQUEST_SECRET, requestId: randomUUID(), requesterKey: 'oren',
      patientName: event.patientName, patientPhone: event.phone, packageKey: 'emdr_core', months: 0, catalogEpoch: epoch
    });
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'busy');
    assert.equal(s.isLocked(), false, 'the acquired lock is released');
    assert.equal(JSON.stringify(s.sheets), before, 'no sheet is created or changed');
  });
}

test('snapshot -> manifest -> isolated restore -> cancellation retry keeps one credit; correction reverses it once', () => {
  const s = world(); assert.equal(send(s).ok, true); assert.equal(Number(s.rows('Clients')[0].creditsOwed), 1);
  const h = snapshot(s), r = restored(h);
  assert.equal(preflight(h, r).ok, true);
  for (let i = 0; i < 2; i++) assert.equal(send(r).ok, true);
  assert.equal(Number(r.rows('Clients')[0].creditsOwed), 1);
  const changed = { ...event, outcome: 'happened', therapist: Object.keys(s.ctx.THERAPIST_FLAT_RATES)[0] };
  for (let i = 0; i < 2; i++) assert.equal(send(r, changed).ok, true);
  assert.equal(Number(r.rows('Clients')[0].creditsOwed), 0);
  assert.equal(r.rows('SessionLog').length, 1);
});

test('snapshot -> restore preserves payroll-forwarded stamp and frozen pay on replay', () => {
  const s = world(), e = { ...event, outcome: 'happened', therapist: Object.keys(s.ctx.THERAPIST_FLAT_RATES)[0] };
  assert.equal(send(s, e).ok, true);
  const row = s.rows('SessionLog')[0]; row.forwardedToPayroll = '2026-10';
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, [row]);
  const h = snapshot(s), r = restored(h); assert.equal(preflight(h, r).ok, true);
  assert.equal(send(r, e).ok, true);
  assert.equal(r.rows('SessionLog')[0].forwardedToPayroll, '2026-10');
  assert.equal(r.rows('SessionLog')[0].therapistPay, 777);
  assert.equal(r.rows('SessionLog').length, 1);
});

test('snapshot -> restore -> new session uses the configured 777 rate, not hardcoded defaults', () => {
  const s = world(), h = snapshot(s), r = restored(h); assert.equal(preflight(h, r).ok, true);
  const e = { ...event, outcome: 'happened', therapist: Object.keys(s.ctx.THERAPIST_FLAT_RATES)[0] };
  assert.notEqual(s.ctx.THERAPIST_FLAT_RATES[e.therapist], 777);
  assert.equal(send(r, e).therapistPay, 777);
  assert.equal(r.rows('Settings')[0].value, 'fixture');
});

test('all nine operational sheets capture under the same script lock; append-only columns and scalar types survive', () => {
  const s = world();
  for (const spec of s.ctx._integritySourceSpecs().slice(8)) {
    if (s.sheets[spec.source]) continue;
    s.seed(spec.source, spec.headers, []);
  }
  s.seed('AuditLog', [...s.ctx.AUDIT_LOG_HEADERS, 'futureColumn'], [{ timestamp: '2026-10-19', action: 'synthetic', futureColumn: '=literal-not-formula' }]);
  s.seed('RepairPlan', s.ctx.REPAIR_PLAN_HEADERS, [{ sheet: 'Clients', row: 2, column: 'name', newValue: 'never applied', approved: true }]);
  const h = snapshot(s), set = h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h));
  assert.equal(set.length, 20);
  for (const spec of s.ctx._integritySourceSpecs().slice(8)) assert.equal(set.find(x => x.source === spec.source).absent, false);
  const reads = h.events.filter(e => e[0] === 'read' && e[1] === 'live' && ['SessionLog','TherapistRates','Settings','AuditLog','RepairPlan'].includes(e[2]));
  assert.ok(reads.length >= 5); assert.ok(reads.every(e => e[3] === true));
  const r = restored(h); assert.equal(preflight(h, r).ok, true);
  assert.equal(r.rows('Clients')[0].name, event.patientName, 'restore never executes RepairPlan');
  assert.equal(r.rows('AuditLog')[0].futureColumn, '=literal-not-formula');
  assert.equal(r.rows('RepairPlan')[0].approved, true);
});

test('unclassified and future tabs are preserved as values and inventory; never silently certify them', () => {
  const s = world();
  s.seed('Sheet1', ['manual'], [{ manual: 'keep' }]);
  s.seed('Copy of Clients', ['legacy'], [{ legacy: 'keep too' }]);
  const h = snapshot(s), set = h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h));
  assert.equal(set.length, 22);
  for (const name of ['Sheet1','Copy of Clients']) {
    const item = set.find(x => x.source === name);
    assert.match(item.prefix, /^other-[a-f0-9]{64}-$/);
    assert.equal(item.absent, false);
    assert.equal(h.ctx._integrityIsExpiredSnapshot('outpatient-' + item.prefix + '2020-01-01', 'outpatient-2026-10-19', 30), true);
  }
  assert.throws(() => preflight(h, restored(h)), /Unclassified sheets/);
});

// Only this synthetic VM receives a pin. The shipped source and generated Google
// runner MUST stay disabled; no real evidence or approval is simulated here.
function manualWorld() {
  const s = world(); assert.equal(send(s).ok, true);
  const journals = ['renewal-journal-fixture.cjs', 'extra-charge-journal-fixture.cjs'].flatMap(file => {
    const f = require('../test-support/' + file).fixture();
    assert.equal(f.reserve().ok, true); assert.equal(f.apply().ok, true); assert.equal(f.ack().ok, true);
    return f.sb.rows('FinancialOps');
  });
  s.seed('FinancialOps', s.ctx.FINANCIAL_OP_HEADERS, journals); s.props.FINANCIAL_OPS_CREATED = '1';
  s.seed('Sheet1', [''], []);
  s.seed('Copy of Clients', ['id', 'name', 'count', 'flag', 'instant'], [
    { id: 'synthetic-client', name: 'historical name', count: 7, flag: true, instant: new Date('2026-10-20T10:11:12.000Z') },
    { id: 'other-archive-row', name: '=literal', count: 0, flag: false, instant: '' }
  ]);
  const h = snapshot(s), r = restored(h), set = h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h));
  const meta = h.ctx._integrityRecoveryMetadata(set), stamp = new Date(meta.capturedAt);
  const policy = { version: 1, sourceId: 'live', backupId: 'backup', day: dayOf(h), targetId: 'isolated-target',
    manifestSha256: h.ctx._integrityFingerprint(h.backup.getSheetByName('outpatient-manifest-' + dayOf(h)).getDataRange().getValues()),
    metadataSha256: h.ctx._integrityFingerprint(set.find(x => x.source === '__RecoveryMetadata').grid),
    evidence: { recordPath: 'docs/evidence/op03-manual-tabs-2026-10-25.md', sha256: 'a'.repeat(64), operator: 'synthetic operator',
      captureStartedAt: new Date(stamp.getTime() - 1000).toISOString(), captureEndedAt: new Date(stamp.getTime() + 1000).toISOString(),
      beforeInventorySha256: 'b'.repeat(64), afterInventorySha256: 'b'.repeat(64), nativeCopyId: 'private-native-fixture',
      directWritesPaused: true, formulasAbsent: true, nativePropertiesVerified: true,
      targetCreatedAt: stamp.toISOString(), targetInitiallyEmpty: true, targetOwnerOnly: true },
    tabs: ['Sheet1', 'Copy of Clients'].map((name, i) => {
      const item = set.find(x => x.source === name), sh = r.sheets[name], range = sh.getDataRange;
      sh.getMaxColumns = () => 33;
      sh.getDataRange = () => ({ ...range(), getFormulas: () => sh.grid.map(row => row.map(() => '')) });
      return { source: name, sheetId: i, prefix: item.prefix, absent: false,
        role: i ? 'retained-archive' : 'structural-empty', sha256: h.ctx._integrityFingerprint(item.grid),
        rows: item.grid.length, columns: item.grid[0].length, allocatedRows: sh.getMaxRows(), allocatedColumns: sh.getMaxColumns() };
    }) };
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
  h.ctx.CacheService = { getScriptCache: () => ({ remove() {} }) };
  h.props.OUTPATIENT_RECOVERY_HOLD = '1';
  const pin = () => { h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256 = h.ctx._integrityFingerprint(h.ctx._integrityManualPolicyRows(policy)); };
  const finish = (config = true) => h.ctx.finishOutpatientRecovery('backup', dayOf(h), config, policy);
  return { h, r, policy, pin, finish };
}

test('shipped blank manual pin refuses missing, blank and complete policies; malformed pins also refuse', () => {
  const { h, policy } = manualWorld();
  assert.equal(h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256, '');
  for (const pin of ['', undefined, 'x'.repeat(64), 'a'.repeat(63)]) {
    h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256 = pin;
    for (const p of [undefined, '', policy]) {
      assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true, p), /Unclassified sheets/);
      assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
    }
  }
});

test('review-pinned synthetic policy preserves separate archive and active Clients, journal, cache and hold-last order', () => {
  const { h, r, policy, pin, finish } = manualWorld(); pin();
  const before = JSON.stringify(r.sheets), journal = h.ctx._finJournal, seen = [];
  h.ctx._finJournal = () => { seen.push('journal'); const result = journal(); assert.equal(result.ops.length, 2); return result; };
  h.ctx.CacheService = { getScriptCache: () => ({ remove() { seen.push('cache'); assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1'); } }) };
  const props = h.ctx.PropertiesService.getScriptProperties;
  h.ctx.PropertiesService.getScriptProperties = () => ({ ...props(), deleteProperty(key) {
    assert.equal(key, 'OUTPATIENT_RECOVERY_HOLD'); assert.deepEqual(seen, ['journal', 'cache']);
    assert.equal(h.props.FINANCIAL_OPS_CREATED, '1');
    assert.ok(JSON.parse(h.props.INTEGRITY_REQUIRED_SOURCES).includes('Copy of Clients'));
    props().deleteProperty(key);
  } });
  assert.equal(finish().ok, true);
  assert.equal(JSON.stringify(r.sheets), before);
  assert.notEqual(r.rows('Clients')[0].name, r.rows('Copy of Clients')[0].name);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, undefined);
  assert.equal(policy.tabs.length, 2);
});

test('manual policy canonical digest ignores object insertion/tab entry order, never captured cell order', () => {
  const { h, policy, pin } = manualWorld(); pin();
  const reverse = value => Array.isArray(value) ? value.map(reverse).reverse() : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reverse(v)])) : value;
  const reordered = reverse(policy);
  assert.equal(h.ctx._integrityFingerprint(h.ctx._integrityManualPolicyRows(reordered)), h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256);
  assert.equal(h.ctx.finishOutpatientRecovery('backup', dayOf(h), true, reordered).ok, true);
});

const manualTargetFaults = {
  'changed archive cell': ({ r }) => { r.sheets['Copy of Clients'].grid[1][1] = 'new name'; },
  'number changed to string': ({ r }) => { r.sheets['Copy of Clients'].grid[1][2] = '7'; },
  'boolean changed to string': ({ r }) => { r.sheets['Copy of Clients'].grid[1][3] = 'true'; },
  'Date changed to ISO string': ({ r }) => { r.sheets['Copy of Clients'].grid[1][4] = '2026-10-20T10:11:12.000Z'; },
  'reordered archive headers': ({ r }) => { r.sheets['Copy of Clients'].grid[0].reverse(); },
  'reordered archive rows': ({ r }) => { [r.sheets['Copy of Clients'].grid[1], r.sheets['Copy of Clients'].grid[2]] = [r.sheets['Copy of Clients'].grid[2], r.sheets['Copy of Clients'].grid[1]]; },
  'changed empty structural tab': ({ r }) => { r.sheets.Sheet1.grid[0][0] = 'new content'; },
  'missing archive': ({ r }) => { delete r.sheets['Copy of Clients']; },
  'renamed archive': ({ r }) => { r.sheets['renamed archive'] = r.sheets['Copy of Clients']; delete r.sheets['Copy of Clients']; },
  'preexisting unexpected target tab': ({ r }) => r.seed('Unrelated', ['id'], []),
  'changed allocated bounds': ({ r }) => { r.sheets.Sheet1.getMaxColumns = () => 34; },
  'changed allocated rows': ({ r }) => { r.sheets.Sheet1.getMaxRows = () => 101; },
  'formula with identical value': ({ r }) => {
    const sh = r.sheets['Copy of Clients'], get = sh.getDataRange;
    sh.getDataRange = () => ({ ...get(), getFormulas: () => sh.grid.map((row, i) => row.map((_, j) => i === 1 && j === 2 ? '=7' : '')) });
  },
  'missing known header': ({ r }) => { r.sheets.Settings.grid[0][0] = 'bad-key'; },
  'corrupt real journal': ({ r }) => { r.sheets.FinancialOps.grid[1][r.sheets.FinancialOps.grid[0].indexOf('intent')] = '{broken'; },
  'rate cache error': ({ h }) => { h.ctx.CacheService = { getScriptCache: () => ({ remove() { throw Error('cache failure'); } }) }; },
  'edit during rate invalidation': ({ h, r }) => { h.ctx.CacheService = { getScriptCache: () => ({ remove() { r.sheets.Sheet1.grid[0][0] = 'late edit'; } }) }; }
};
for (const [name, fault] of Object.entries(manualTargetFaults)) test('pinned manual recovery holds on ' + name, () => {
  const f = manualWorld(); f.pin(); fault(f);
  const backupBefore = JSON.stringify(f.h.ctx._integrityValidateRestoreSet(f.h.backup, dayOf(f.h)));
  assert.throws(f.finish);
  assert.equal(f.h.props.OUTPATIENT_RECOVERY_HOLD, '1');
  assert.equal(JSON.stringify(f.h.ctx._integrityValidateRestoreSet(f.h.backup, dayOf(f.h))), backupBefore);
  assert.deepEqual(f.h.locks(), [false, false]);
});

const manualPolicyFaults = {
  'wrong source': p => { p.sourceId = 'another-source'; },
  'wrong backup': p => { p.backupId = 'another-backup'; },
  'wrong day': p => { p.day = '2020-01-01'; },
  'replay to another target': p => { p.targetId = 'another-target'; },
  'wrong manifest hash': p => { p.manifestSha256 = 'c'.repeat(64); },
  'wrong metadata hash': p => { p.metadataSha256 = 'c'.repeat(64); },
  'wrong grid hash': p => { p.tabs[0].sha256 = 'c'.repeat(64); },
  'changed absent flag': p => { p.tabs[0].absent = true; },
  'changed prefix': p => { p.tabs[0].prefix = 'clients-'; },
  'known source in manual policy': p => { p.tabs[0].source = 'Clients'; },
  'duplicate tab': p => { p.tabs[0] = p.tabs[1]; },
  'missing tab': p => { p.tabs.pop(); },
  'extra tab': p => { p.tabs.push({ ...p.tabs[0], source: 'future-manual' }); },
  'missing formula attestation': p => { p.evidence.formulasAbsent = false; },
  'missing native evidence': p => { p.evidence.nativePropertiesVerified = false; },
  'missing evidence digest': p => { p.evidence.sha256 = ''; },
  'no direct-writer pause': p => { p.evidence.directWritesPaused = false; },
  'no empty-target evidence': p => { p.evidence.targetInitiallyEmpty = false; },
  'no private-target evidence': p => { p.evidence.targetOwnerOnly = false; },
  'postdated capture evidence': p => { p.evidence.captureStartedAt = p.evidence.captureEndedAt; },
  'capture evidence ending too early': p => { p.evidence.captureEndedAt = p.evidence.captureStartedAt; },
  'concurrent source edit': p => { p.evidence.afterInventorySha256 = 'c'.repeat(64); },
  'native copy is source': p => { p.evidence.nativeCopyId = p.sourceId; },
  'native copy is backup': p => { p.evidence.nativeCopyId = p.backupId; },
  'native copy is target': p => { p.evidence.nativeCopyId = p.targetId; },
  'row count as string': p => { p.tabs[0].rows = String(p.tabs[0].rows); },
  'column count as string': p => { p.tabs[0].columns = String(p.tabs[0].columns); },
  'duplicate source sheet ID': p => { p.tabs[1].sheetId = p.tabs[0].sheetId; },
  'archive labelled empty': p => { p.tabs[1].role = 'structural-empty'; }
};
for (const [name, fault] of Object.entries(manualPolicyFaults)) test('manual policy rejects ' + name + ' even with a matching synthetic pin', () => {
  const f = manualWorld(); fault(f.policy); f.pin();
  const before = JSON.stringify(f.r.sheets);
  assert.throws(f.finish, /Manual recovery/);
  assert.equal(f.h.props.OUTPATIENT_RECOVERY_HOLD, '1');
  assert.equal(JSON.stringify(f.r.sheets), before);
});

test('a policy edited after review, unknown fields, missing evidence fields and config false all retain hold', () => {
  const f = manualWorld(); f.pin();
  assert.throws(() => f.h.ctx.finishOutpatientRecovery('backup', dayOf(f.h), true), /Invalid manual recovery policy fields/);
  f.policy.evidence.operator = 'someone else'; assert.throws(f.finish, /digest mismatch/);
  f.pin(); assert.throws(() => f.finish(false), /configuration verification/);
  f.policy.approved = true; assert.throws(f.finish, /Invalid manual recovery policy fields/);
  delete f.policy.approved; delete f.policy.evidence.formulasAbsent;
  assert.throws(f.finish, /Invalid manual recovery policy fields/);
  assert.equal(f.h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('an unrelated manual policy is refused for a restore with no unknown tabs', () => {
  const f = manualWorld(); f.pin();
  const h = snapshot(world()), r = restored(h);
  h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256 = f.h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256;
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
  h.props.OUTPATIENT_RECOVERY_HOLD = '1';
  assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true, f.policy), /without unclassified sheets/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('late-proof failure retains hold and already-written markers for investigation', () => {
  const f = manualWorld(); f.pin();
  const service = f.h.ctx.PropertiesService.getScriptProperties;
  f.h.ctx.PropertiesService.getScriptProperties = () => ({ ...service(), setProperty(key, value) {
    service().setProperty(key, value);
    if (key === 'INTEGRITY_REQUIRED_SOURCES') f.r.sheets.Sheet1.grid[0][0] = 'late direct write';
  } });
  assert.throws(f.finish, /Backup value mismatch/);
  assert.equal(f.h.props.OUTPATIENT_RECOVERY_HOLD, '1');
  assert.equal(f.h.props.FINANCIAL_OPS_CREATED, '1');
  assert.ok(JSON.parse(f.h.props.INTEGRITY_REQUIRED_SOURCES).includes('Copy of Clients'));
  assert.equal(f.h.ctx.nightlyIntegrityJob().error, 'recovery_pending');
});

test('self-consistently rehashed backup/target cannot reuse a policy for the previous snapshot', () => {
  const f = manualWorld(); f.pin();
  const name = 'outpatient-' + f.policy.tabs[1].prefix + dayOf(f.h);
  const snap = f.h.backup.getSheetByName(name), grid = snap.getDataRange().getValues();
  grid[1][1] = 'unreviewed replacement'; snap.getDataRange().setValues(grid);
  f.r.sheets['Copy of Clients'].grid[1][1] = grid[1][1];
  const manifest = f.h.backup.getSheetByName('outpatient-manifest-' + dayOf(f.h)), rows = manifest.getDataRange().getValues();
  rows.find(row => row[1] === 'Copy of Clients')[4] = f.h.ctx._integrityFingerprint(grid);
  manifest.getDataRange().setValues(rows);
  assert.ok(f.h.ctx._integrityValidateRestoreSet(f.h.backup, dayOf(f.h)));
  assert.throws(f.finish, /policy scope mismatch/);
  assert.equal(f.h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('matching manual policy never substitutes for the real financial-journal validator', () => {
  const f = manualWorld();
  const item = f.h.ctx._integrityValidateRestoreSet(f.h.backup, dayOf(f.h)).find(x => x.source === 'FinancialOps');
  item.grid[1][item.grid[0].indexOf('intent')] = '{broken';
  f.h.backup.getSheetByName('outpatient-' + item.prefix + dayOf(f.h)).getDataRange().setValues(item.grid);
  f.r.sheets.FinancialOps.grid[1][item.grid[0].indexOf('intent')] = '{broken';
  const manifest = f.h.backup.getSheetByName('outpatient-manifest-' + dayOf(f.h)), rows = manifest.getDataRange().getValues();
  rows.find(row => row[1] === 'FinancialOps')[4] = f.h.ctx._integrityFingerprint(item.grid);
  manifest.getDataRange().setValues(rows);
  f.policy.manifestSha256 = f.h.ctx._integrityFingerprint(rows); f.pin();
  assert.equal(f.h.ctx._integrityVerifyRecoveredWorkbook(f.h.backup, dayOf(f.h), target(f.r), true, f.policy).ok, true);
  assert.throws(f.finish, /financial_journal_corrupt/);
  assert.equal(f.h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

for (const name of ['SessionLog','TherapistRates','Settings']) {
  test('operational recovery rejects a missing ' + name + ' in target or captured absence', () => {
    const s = world(), h = snapshot(s), r = restored(h);
    delete r.sheets[name]; assert.throws(() => preflight(h, r), /Recovered sheet missing/);
    delete s.sheets[name]; const absent = snapshot(s);
    assert.throws(() => preflight(absent, restored(absent)), /Operational recovery state missing/);
  });
}

test('duplicate session IDs and reordered operational headers are preserved for inspection but refuse resumption', () => {
  const s = world(); assert.equal(send(s).ok, true);
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, [s.rows('SessionLog')[0], s.rows('SessionLog')[0]]);
  let h = snapshot(s); assert.throws(() => preflight(h, restored(h)), /Recovery key invalid: SessionLog/);
  const headers = [...s.ctx.SETTINGS_HEADERS].reverse(); s.seed('Settings', headers, [{ key: 'x', value: 'y' }]);
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, []);
  h = snapshot(s); assert.throws(() => preflight(h, restored(h)), /Recovery schema mismatch: Settings/);
});

test('empty rates cannot silently seed defaults after operational recovery', () => {
  const s = world(); s.seed('TherapistRates', s.ctx.THERAPIST_RATES_HEADERS, []);
  const h = snapshot(s); assert.throws(() => preflight(h, restored(h)), /rates empty/);
});

test('target mismatch, unverified configuration and original workbook are refused without writes', () => {
  const h = snapshot(world()), r = restored(h);
  assert.throws(() => preflight(h, r, false), /configuration verification/);
  assert.throws(() => h.ctx._integrityVerifyRecoveredWorkbook(h.backup, dayOf(h), h.live, true), /isolated target/);
  r.sheets.Settings.grid[1][1] = 'changed';
  assert.throws(() => preflight(h, r), /Backup value mismatch/);
  assert.equal(h.events.some(e => e[0] === 'write' && e[1] !== 'backup'), false);
});

function publishLegacy(h, withPackages) {
  const specs = h.ctx._integritySourceSpecs().slice(0, 8);
  if (withPackages) specs.push({ source: 'PackageCatalog', prefix: 'package-catalog-', headers: ['id'] }, { source: 'PackageRequests', prefix: 'package-requests-', headers: ['id'] });
  const manifest = [['id','source','snapshot','absent','sha256']];
  for (const spec of specs) {
    const grid = [spec.headers], name = 'outpatient-' + spec.prefix + dayOf(h);
    h.ctx._integrityWriteSnapshot(h.backup, name, grid);
    manifest.push([spec.source, spec.source, name, '1', h.ctx._integrityFingerprint(grid)]);
  }
  h.ctx._integrityWriteSnapshot(h.backup, 'outpatient-manifest-' + dayOf(h), manifest);
}
for (const packages of [false, true]) test('legacy ' + (packages ? 10 : 8) + '-dataset manifests remain inspectable but never operationally approved', () => {
  const h = harness(); publishLegacy(h, packages);
  assert.equal(h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h)).length, packages ? 10 : 8);
  assert.throws(() => preflight(h, world()), /Legacy backup/);
});

test('a removed operational manifest row cannot be hidden by retaining a valid recovery-metadata hash', () => {
  const h = snapshot(world()), manifest = h.backup.getSheetByName('outpatient-manifest-' + dayOf(h));
  const rows = manifest.getDataRange().getValues().filter(r => r[1] !== 'SessionLog');
  manifest.getRange(1,1,rows.length,5).setValues(rows);
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h)), /Incomplete recovery inventory/);
});

test('financial activation marker is snapshotted without credentials and cannot be discarded', () => {
  const s = world(); s.seed('FinancialOps', s.ctx.FINANCIAL_OP_HEADERS, []); s.props.FINANCIAL_OPS_CREATED = '1';
  const h = snapshot(s); h.props.OUTPATIENT_PROXY_SECRET = 'never-copy-me';
  const set = h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h)), meta = h.ctx._integrityRecoveryMetadata(set);
  assert.equal(meta.financialOpsCreated, '1'); assert.doesNotMatch(JSON.stringify(set), /never-copy-me/);
  const r = restored(h); assert.equal(preflight(h, r).journalRequired, true);
  delete r.sheets.FinancialOps; assert.throws(() => preflight(h, r), /Recovered sheet missing/);
});

test('recovery hold blocks authenticated source reads/writes and nightly backup; no HTTP action clears it', () => {
  const s = world(); assert.equal(s.ctx.beginOutpatientRecovery().ok, true);
  const before = JSON.stringify(s.sheets);
  assert.equal(send(s).error, 'recovery_pending');
  assert.equal(s.post({ action: 'finishOutpatientRecovery' }).error, 'recovery_pending');
  assert.equal(JSON.parse(s.ctx.doGet({ parameter: { action: 'getData', proxySecret: s.props.OUTPATIENT_PROXY_SECRET } }).getContent()).error, 'recovery_pending');
  assert.equal(s.ctx.nightlyIntegrityJob().error, 'recovery_pending');
  assert.equal(JSON.stringify(s.sheets), before);
  assert.equal(s.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('editor finish keeps hold on failure and clears it only after target, config, journal and cache verification', () => {
  const h = snapshot(world()), r = restored(h);
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
  h.ctx.CacheService = { getScriptCache: () => ({ remove: key => assert.equal(key, 'therapistRates_v1') }) };
  h.props.OUTPATIENT_RECOVERY_HOLD = '1';
  assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), false), /configuration/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
  assert.equal(h.ctx.finishOutpatientRecovery('backup', dayOf(h), true).ok, true);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, undefined);
  assert.deepEqual(h.locks(), [false,false]);
});

for (const phase of ['after-capture', 'after-manifest']) {
  test('recovery cannot finish while a previously admitted backup drains ' + phase, () => {
    const h = snapshot(world()), r = restored(h);
    h.ctx.CacheService = { getScriptCache: () => ({ remove() {} }) };
    let exercised = false;
    function overlap() {
      if (exercised) return; exercised = true;
      assert.ok(h.props.INTEGRITY_ACTIVE_BACKUP);
      assert.equal(h.ctx.beginOutpatientRecovery().error, 'backup_draining');
      h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
      assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true), /backup still running/);
      assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
      assert.equal(h.ctx.nightlyIntegrityJob().error, 'recovery_pending');
    }
    if (phase === 'after-capture') {
      const capture = h.ctx._integrityCaptureData;
      h.ctx._integrityCaptureData = ss => { const rows = capture(ss); overlap(); return rows; };
    } else {
      const write = h.ctx._integrityWriteSnapshot;
      h.ctx._integrityWriteSnapshot = (...args) => {
        const sh = write(...args); if (args[1].includes('-manifest-')) overlap(); return sh;
      };
    }
    h.ctx.nightlyIntegrityJob();
    assert.equal(exercised, true);
    assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
    assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
    assert.equal(h.ctx.beginOutpatientRecovery().ok, true, 'cutover becomes eligible only after all backup/sentinel writes finish');
    assert.equal(h.ctx.finishOutpatientRecovery('backup', dayOf(h), true).ok, true);
    assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, undefined);
  });
}

test('one backup execution is admitted across the whole run; a competing caller cannot clear its marker', () => {
  const h = harness(), capture = h.ctx._integrityCaptureData;
  let tested = false;
  h.ctx._integrityCaptureData = ss => {
    if (!tested) {
      tested = true; const marker = h.props.INTEGRITY_ACTIVE_BACKUP;
      assert.ok(JSON.parse(marker).startedAt);
      assert.equal(h.ctx.nightlyIntegrityJob().error, 'backup_busy');
      assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, marker);
    }
    return capture(ss);
  };
  h.ctx.nightlyIntegrityJob();
  assert.equal(tested, true);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h)).length, 20);
});

test('a failed backup clears its own execution marker in finally and keeps recovery held', () => {
  const h = harness();
  h.ctx._integrityCaptureData = () => { h.ctx.beginOutpatientRecovery(); throw Error('synthetic capture crash'); };
  h.ctx._integritySendAlert = () => { throw Error('synthetic unexpected reporting crash'); };
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /unexpected reporting crash/);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
  assert.deepEqual(h.locks(), [false, false]);
});

test('an abandoned execution marker is never expired or removed automatically to bypass the drain gate', () => {
  const h = snapshot(world()), r = restored(h);
  h.props.INTEGRITY_ACTIVE_BACKUP = '{"id":"stale-synthetic-run","startedAt":"2000-01-01T00:00:00Z"}';
  const marker = h.props.INTEGRITY_ACTIVE_BACKUP;
  assert.equal(h.ctx.nightlyIntegrityJob().error, 'backup_busy');
  assert.equal(h.ctx.beginOutpatientRecovery().error, 'backup_draining');
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
  assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true), /backup still running/);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, marker);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('an admission lock timeout reports the missed backup without writing or claiming another execution marker', () => {
  const h = harness(); h.faults.captureLock = true;
  assert.equal(h.ctx.nightlyIntegrityJob().error, 'backup_busy');
  assert.ok(h.logs.some(l => l.includes('script lock unavailable')));
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.events.some(e => e[0] === 'write'), false);
  assert.deepEqual(h.locks(), [false, false]);
});

test('a completion lock timeout leaves the marker fail-closed and logs an actionable investigation message', () => {
  const h = harness(), getLock = h.ctx.LockService.getScriptLock;
  let calls = 0;
  h.ctx.LockService.getScriptLock = () => {
    const lock = getLock();
    if (++calls === 3) lock.waitLock = () => { throw Error('synthetic completion timeout'); };
    return lock;
  };
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /synthetic completion timeout/);
  assert.ok(h.props.INTEGRITY_ACTIVE_BACKUP);
  assert.ok(h.logs.some(l => l.includes('marker stranded')));
  assert.equal(h.ctx.nightlyIntegrityJob().error, 'backup_busy');
  assert.deepEqual(h.locks(), [false, false]);
});

for (const fault of ['cache', 'journal', 'activation-marker']) {
  test('editor finish leaves recovery held after a real ' + fault + ' failure', () => {
    const s = world();
    if (fault === 'journal') s.seed('FinancialOps', s.ctx.FINANCIAL_OP_HEADERS,
      [{ id: 'synthetic-bad-intent', intent: '{invalid-json' }]);
    const h = snapshot(s), r = restored(h);
    assert.equal(preflight(h, r).ok, true, 'snapshot/schema preflight succeeds before finish validation');
    h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
    h.ctx.CacheService = { getScriptCache: () => ({ remove() {
      if (fault === 'cache') throw Error('synthetic cache unavailable');
    } }) };
    h.props.OUTPATIENT_RECOVERY_HOLD = '1';
    if (fault === 'activation-marker') h.props.FINANCIAL_OPS_CREATED = '1';
    const before = JSON.stringify(r.sheets), properties = JSON.stringify(h.props);
    const errors = { cache: /cache invalidation failed/, journal: /financial_journal_corrupt/,
      'activation-marker': /Restore journal required/ };
    assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true), errors[fault]);
    assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
    assert.equal(JSON.stringify(r.sheets), before);
    assert.equal(JSON.stringify(h.props), properties);
    assert.deepEqual(h.locks(), [false, false]);
  });
}

test('editor finish persists journal marker and source inventory under lock before deleting the hold', () => {
  const s = world(); s.seed('FinancialOps', s.ctx.FINANCIAL_OP_HEADERS, []);
  s.props.FINANCIAL_OPS_CREATED = '1';
  const h = snapshot(s), r = restored(h), writes = [];
  delete h.props.FINANCIAL_OPS_CREATED; // New runtime has not yet restored the activation marker.
  h.props.OUTPATIENT_RECOVERY_HOLD = '1';
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
  h.ctx.CacheService = { getScriptCache: () => ({ remove() {
    assert.equal(h.locks()[0], true); writes.push('cache');
  } }) };
  h.ctx.PropertiesService.getScriptProperties = () => ({
    getProperty: k => h.props[k] ?? null,
    setProperty(k, v) { assert.equal(h.locks()[0], true); writes.push('set:' + k); h.props[k] = v; },
    deleteProperty(k) { assert.equal(h.locks()[0], true); writes.push('delete:' + k); delete h.props[k]; }
  });
  assert.equal(h.ctx.finishOutpatientRecovery('backup', dayOf(h), true).ok, true);
  assert.deepEqual(writes, ['cache', 'set:FINANCIAL_OPS_CREATED', 'set:INTEGRITY_REQUIRED_SOURCES', 'delete:OUTPATIENT_RECOVERY_HOLD']);
  assert.equal(h.props.FINANCIAL_OPS_CREATED, '1');
  assert.deepEqual(JSON.parse(h.props.INTEGRITY_REQUIRED_SOURCES).sort(), Object.keys(r.sheets).sort());
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, undefined);
});

test('a source absent at capture may not be silently materialized during recovery', () => {
  const h = snapshot(world()), r = restored(h);
  r.seed('Credits', r.ctx.CREDIT_COLUMNS, []);
  assert.throws(() => preflight(h, r), /Absent source recreated: Credits/);
});

for (const fault of ['absent', 'prefix', 'overlap', 'duplicate']) {
  test('self-consistently rehashed metadata still refuses ' + fault + ' inventory tampering', () => {
    const h = snapshot(world()), day = dayOf(h);
    const sh = h.backup.getSheetByName('outpatient-recovery-meta-' + day);
    const grid = sh.getDataRange().getValues();
    const entry = key => grid.find(r => r[0] === key);
    const inventory = JSON.parse(entry('inventory')[1]);
    if (fault === 'absent') inventory[0][2] = '1';
    if (fault === 'prefix') inventory[0][1] = 'wrong-prefix-';
    if (fault === 'duplicate') inventory[1] = inventory[0];
    if (fault === 'overlap') entry('unclassifiedSources')[1] = '["Clients"]';
    entry('inventory')[1] = JSON.stringify(inventory);
    sh.getRange(1, 1, grid.length, 2).setValues(grid);
    const manifest = h.backup.getSheetByName('outpatient-manifest-' + day);
    const rows = manifest.getDataRange().getValues();
    rows.find(r => r[1] === '__RecoveryMetadata')[4] = h.ctx._integrityFingerprint(grid);
    manifest.getRange(1, 1, rows.length, 5).setValues(rows);
    assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, day), /[Ii]nventory/);
  });
}

test('retention failure is surfaced without deleting the newly verified operational set', () => {
  const h = harness(); h.backup.insertSheet('outpatient-session-log-2000-01-01', [['sessionId']]);
  const remove = h.backup.deleteSheet;
  h.backup.deleteSheet = sh => { if (sh.getName().includes('2000')) throw Error('synthetic retention failure'); return remove(sh); };
  h.ctx.nightlyIntegrityJob();
  assert.ok(h.logs.some(l => l.includes('synthetic retention failure')));
  assert.equal(h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h)).length, 20);
  assert.ok(h.backup.getSheetByName('outpatient-session-log-2000-01-01'));
});

test('snapshots trim unused cells to actual data size before publication', () => {
  const h = harness(), sh = h.ctx._integrityWriteSnapshot(h.backup, 'outpatient-settings-2026-10-19', [['key','value']]);
  assert.equal(sh.getMaxRows(), 1); assert.equal(sh.getMaxColumns(), 2);
});

test('a request that passed HTTP admission before the hold must recheck after acquiring its writer lock', () => {
  const s = world(), before = JSON.stringify(s.sheets);
  s.lock.waitLock = () => { s.props.OUTPATIENT_RECOVERY_HOLD = '1'; };
  const result = send(s);
  assert.equal(result.ok, false); assert.match(result.error, /recovery_pending/);
  assert.equal(JSON.stringify(s.sheets), before);
});

test('settings writes share the capture lock and refuse during recovery or lock contention', () => {
  const s = world(), before = JSON.stringify(s.sheets);
  s.lock.tryLock = () => false;
  assert.equal(s.post({ action: 'saveSettings', settings: { x: 'y' } }).error, 'busy');
  assert.equal(JSON.stringify(s.sheets), before);
  s.lock.tryLock = () => { s.props.OUTPATIENT_RECOVERY_HOLD = '1'; return true; };
  assert.match(s.post({ action: 'saveSettings', settings: { x: 'y' } }).error, /recovery_pending/);
  assert.equal(JSON.stringify(s.sheets), before);
});

test('package schemas join the registry and both nonempty datasets are restored without changing their rows', () => {
  const h = harness();
  h.ctx.PACKAGE_CATALOG_HEADERS = ['id','key','priceTotalAgorot'];
  h.ctx.PACKAGE_REQUEST_HEADERS = ['id','status','quoteSnapshot'];
  h.faults.forbidLiveWrites = false;
  h.live.insertSheet('PackageCatalog', [h.ctx.PACKAGE_CATALOG_HEADERS, ['fixture@v1','fixture',340000]]);
  h.live.insertSheet('PackageRequests', [h.ctx.PACKAGE_REQUEST_HEADERS, ['request-fixture','priced','{"grossAgorot":340000}']]);
  h.faults.forbidLiveWrites = true;
  h.ctx.nightlyIntegrityJob();
  const set = h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h));
  assert.equal(set.length, 20);
  for (const n of ['PackageCatalog','PackageRequests']) {
    const item = set.find(x => x.source === n);
    assert.equal(item.absent, false);
    assert.deepEqual(item.grid, h.live.getSheetByName(n).getDataRange().getValues());
  }
  assert.equal(h.ctx._integrityRecoveryMetadata(set).unclassifiedSources, '[]');
});

test('a previously captured operational sheet cannot disappear silently and age out good backups', () => {
  const h = snapshot(world()), before = h.events.filter(e => ['write','delete'].includes(e[0])).length;
  assert.ok(JSON.parse(h.props.INTEGRITY_REQUIRED_SOURCES).includes('SessionLog'));
  const get = h.live.getSheetByName;
  h.live.getSheetByName = name => name === 'SessionLog' ? null : get(name);
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.events.filter(e => ['write','delete'].includes(e[0])).length, before);
  assert.ok(h.logs.some(l => l.includes('Previously captured source missing: SessionLog')));
  assert.equal(h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h)).find(x => x.source === 'SessionLog').absent, false);
});

test('a nightly capture queued before recovery rechecks the hold after acquiring its lock', () => {
  const h = harness();
  const getLock = h.ctx.LockService.getScriptLock;
  let acquisitions = 0;
  h.ctx.LockService.getScriptLock = () => {
    const lock = getLock(), acquire = lock.tryLock;
    lock.tryLock = () => { if (++acquisitions === 2) h.props.OUTPATIENT_RECOVERY_HOLD = '1'; return acquire(); };
    return lock;
  };
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.events.some(e => e[0] === 'write' || e[0] === 'delete'), false);
  assert.ok(h.logs.some(l => l.includes('recovery_pending')));
  assert.deepEqual(h.locks(), [false,false]);
});
