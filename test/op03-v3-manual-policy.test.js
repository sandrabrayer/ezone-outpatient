'use strict';
// OP-03 task 2(a): manual-tab (Sheet1 / Copy of Clients) recovery policy on the
// v3 TWO-STAGE certified path. Real Code.gs, synthetic Google services only.
// Never opens a live workbook, never changes the shipped blank production pin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { harness } = require('../test-support/backup-sandbox.cjs');

const dayOf = h => h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
const event = { sessionId: 'v3-policy-session-001', phone: '0500000101', patientName: 'בדיקת מדיניות',
  clinicalTreatmentType: 'פרטני CBT', date: '2026-11-23', outcome: 'therapist_cancelled', therapist: 'synthetic' };

function world() {
  const s = sandbox([], [{ id: 'synthetic-client', name: 'active name', phone: event.phone, creditsOwed: 0, sessionsPerWeek: '1' }]);
  s.props.SESSION_OUTCOME_SECRET = 'synthetic-outcome-secret';
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, []);
  s.seed('TherapistRates', s.ctx.THERAPIST_RATES_HEADERS, [{ name: Object.keys(s.ctx.THERAPIST_FLAT_RATES)[0], flatRate: 777 }]);
  s.seed('Settings', s.ctx.SETTINGS_HEADERS, [{ key: 'synthetic-setting', value: 'fixture' }]);
  assert.equal(s.post({ action: 'recordSessionOutcome', secret: s.props.SESSION_OUTCOME_SECRET, ...event }).ok, true);
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
  return s;
}

// Two-stage A -> B in staged mode (synthetic properties only).
function certified(s) {
  const h = harness(Object.fromEntries(Object.entries(s.sheets).map(([n, sh]) => [n, sh.grid])));
  h.props.FINANCIAL_OPS_CREATED = '1';
  h.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  h.ctx.nightlyIntegrityJob();
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().state, 'verified');
  return h;
}

function restored(h) {
  const s = world();
  for (const n of Object.keys(s.sheets)) delete s.sheets[n];
  for (const x of h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h), false)) {
    if (x.absent || x.source === '__RecoveryMetadata') continue;
    s.seed(x.source, x.grid[0], x.grid.slice(1).map(row => Object.fromEntries(x.grid[0].map((key, i) => [key, row[i]]))));
  }
  for (const name of ['Sheet1', 'Copy of Clients']) {
    const sh = s.sheets[name], range = sh.getDataRange;
    sh.getMaxColumns = () => 33;
    sh.getDataRange = () => ({ ...range(), getFormulas: () => sh.grid.map(row => row.map(() => '')) });
  }
  return s;
}
const target = s => ({ ...s.ctx.SpreadsheetApp.getActiveSpreadsheet(), getId: () => 'isolated-target' });

// Operator completes the code-computed draft with reviewed attestations.
function complete(h, draft) {
  const meta = h.ctx._integrityRecoveryMetadata(h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h), false));
  const stamp = new Date(meta.capturedAt), policy = JSON.parse(JSON.stringify(draft.policy));
  Object.assign(policy.evidence, { recordPath: 'docs/evidence/op03-manual-tabs-2026-11-23-v3.md', sha256: 'a'.repeat(64),
    operator: 'synthetic operator', captureStartedAt: new Date(stamp.getTime() - 1000).toISOString(),
    captureEndedAt: new Date(stamp.getTime() + 1000).toISOString(), beforeInventorySha256: 'b'.repeat(64),
    afterInventorySha256: 'b'.repeat(64), nativeCopyId: 'private-native-fixture', directWritesPaused: true,
    formulasAbsent: true, nativePropertiesVerified: true, targetCreatedAt: stamp.toISOString(),
    targetInitiallyEmpty: true, targetOwnerOnly: true });
  policy.tabs.forEach((tab, i) => { tab.sheetId = i; tab.role = tab.source === 'Sheet1' ? 'structural-empty' : 'retained-archive'; });
  return policy;
}

function v3World() {
  const h = certified(world()), r = restored(h);
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
  h.ctx.CacheService = { getScriptCache: () => ({ remove() {} }) };
  const draft = h.ctx.draftOutpatientManualPolicy('backup', dayOf(h));
  const policy = complete(h, draft);
  const pin = (p = policy) => { h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256 = h.ctx._integrityFingerprint(h.ctx._integrityManualPolicyRows(p)); };
  h.props.OUTPATIENT_RECOVERY_HOLD = '1';
  const finish = (p = policy) => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true, p);
  return { h, r, draft, policy, pin, finish };
}

test('production state: blank pin refuses a CERTIFIED v3 set with Sheet1/Copy of Clients and keeps the hold', () => {
  const { h, policy } = v3World();
  assert.equal(h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256, '');
  for (const p of [undefined, policy]) {
    assert.throws(() => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true, p), /Unclassified sheets require a separately reviewed recovery plan/);
    assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
  }
});

test('draft helper is read-only, recomputes only verifiable facts and leaves attestations/roles null', () => {
  const h = certified(world()), r = restored(h);
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => target(r);
  const writesBefore = h.events.filter(e => e[0] === 'write' || e[0] === 'delete' || e[0] === 'rename').length;
  const targetBefore = JSON.stringify(r.sheets);
  const draft = h.ctx.draftOutpatientManualPolicy('backup', dayOf(h));
  assert.equal(h.events.filter(e => e[0] === 'write' || e[0] === 'delete' || e[0] === 'rename').length, writesBefore);
  assert.equal(JSON.stringify(r.sheets), targetBefore);
  assert.equal(draft.approved, false);
  assert.equal(draft.schemaVersion, '3');
  assert.equal(draft.policy.targetId, 'isolated-target');
  assert.equal(JSON.stringify(draft.policy.tabs.map(t => t.source).sort()), JSON.stringify(['Copy of Clients', 'Sheet1']));
  for (const tab of draft.policy.tabs) {
    assert.equal(tab.role, null); assert.equal(tab.sheetId, null); assert.match(tab.sha256, /^[a-f0-9]{64}$/);
  }
  assert.ok(Object.values(draft.policy.evidence).every(v => v === null));
  assert.equal(h.ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256, '');
});

test('an unreviewed draft can never pass, even if someone pins its exact digest', () => {
  const { h, draft, pin, finish } = v3World();
  pin(draft.policy);
  assert.throws(() => finish(draft.policy), /Manual recovery evidence incomplete/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('reviewed + pinned policy restores a certified v3 set: archive kept separate from active Clients, hold cleared last', () => {
  const { h, r, pin, finish } = v3World(); pin();
  const before = JSON.stringify(r.sheets);
  assert.equal(JSON.stringify(finish()), JSON.stringify({ ok: true, state: 'verified' }));
  assert.equal(JSON.stringify(r.sheets), before, 'recovery verification never rewrites the target');
  assert.equal(r.rows('Clients')[0].name, 'active name');
  assert.equal(r.rows('Copy of Clients')[0].name, 'historical name');
  assert.equal(r.rows('Copy of Clients').length, 2, 'archive history is preserved, not merged or trimmed');
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, undefined);
  assert.ok(JSON.parse(h.props.INTEGRITY_REQUIRED_SOURCES).includes('Copy of Clients'));
  assert.ok(JSON.parse(h.props.INTEGRITY_REQUIRED_SOURCES).includes('Sheet1'));
});

test('a pinned policy never substitutes for the v3 certificate', () => {
  const { h, pin, finish } = v3World(); pin();
  h.backup.deleteSheet(h.backup.getSheetByName('outpatient-verified-' + dayOf(h)));
  assert.throws(finish, /not certified/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('a tampered certificate refuses the pinned v3 policy', () => {
  const { h, pin, finish } = v3World(); pin();
  h.backup.getSheetByName('outpatient-verified-' + dayOf(h)).getRange(1, 1, 4, 2)
    .setValues([['key', 'value'], ['day', dayOf(h)], ['backupRunId', 'forged-run'], ['manifestSha256', 'f'.repeat(64)]]);
  assert.throws(finish, /Backup value mismatch/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('a pending two-stage run blocks policy-based cutover (drain first)', () => {
  const { h, pin, finish } = v3World(); pin();
  h.props.INTEGRITY_PENDING_BACKUP = JSON.stringify({ id: 'later-run', day: dayOf(h), backupId: 'backup' });
  assert.throws(finish, /Recovery backup still running/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('archive history overwritten in the target (e.g. by active Clients rows) is refused', () => {
  const { h, r, pin, finish } = v3World(); pin();
  const archive = r.sheets['Copy of Clients'].grid;
  archive[1][1] = r.rows('Clients')[0].name; // "refresh" the archive from active data
  assert.throws(finish, /Backup value mismatch/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('dropping an archive tab from the target to make recovery pass is refused', () => {
  const { h, r, pin, finish } = v3World(); pin();
  delete r.sheets['Copy of Clients'];
  assert.throws(finish, /Recovered sheet missing: Copy of Clients/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('draft refuses an uncertified (Phase A only / failed finalizer) set and a non-isolated target', () => {
  const h = harness(Object.fromEntries(Object.entries(world().sheets).map(([n, sh]) => [n, sh.grid])));
  h.props.FINANCIAL_OPS_CREATED = '1';
  h.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  h.ctx.nightlyIntegrityJob();
  assert.throws(() => h.ctx.draftOutpatientManualPolicy('backup', dayOf(h)), /manifest missing/);
  h.faults.publish = 'outpatient-verified-' + dayOf(h);
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /publish failed/);
  assert.throws(() => h.ctx.draftOutpatientManualPolicy('backup', dayOf(h)), /not certified/);
  h.faults.publish = '';
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().ok, true);
  // _ss() is still the live source workbook: the helper must refuse it.
  assert.throws(() => h.ctx.draftOutpatientManualPolicy('backup', dayOf(h)), /isolated target/);
});
