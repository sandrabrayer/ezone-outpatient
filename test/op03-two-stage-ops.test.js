'use strict';
// OP-03 release readiness: interrupted-run recovery and failure monitoring for
// the two-stage backup. Real Code.gs, synthetic Google services only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/backup-sandbox.cjs');

function staged() {
  const h = harness();
  h.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  return h;
}
const dayOf = h => h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
const alerts = h => h.logs.filter(l => l.includes('INTEGRITY ALERT'));
const pendingId = h => JSON.parse(h.props.INTEGRITY_PENDING_BACKUP).id;
const sheetNames = h => h.backup.getSheets().map(s => s.getName()).sort();

function interrupted() {
  // Phase A recorded its durable pending marker, then died before the staged
  // manifest (same state a hard 360 s kill leaves, minus the stranded ACTIVE).
  const h = staged(), day = dayOf(h);
  h.faults.publish = 'outpatient-pending-manifest-' + day;
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /nightly_backup_not_published/);
  h.faults.publish = '';
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /pending_manifest_missing/);
  return h;
}

test('abandon requires a real reason, an existing pending run and its EXACT run ID', () => {
  const h = interrupted(), id = pendingId(h), before = h.props.INTEGRITY_PENDING_BACKUP;
  assert.throws(() => h.ctx.abandonPendingIntegrityBackup(id, 'short'), /abandon_reason_required/);
  assert.throws(() => h.ctx.abandonPendingIntegrityBackup(id, 'x'.repeat(501)), /abandon_reason_required/);
  assert.throws(() => h.ctx.abandonPendingIntegrityBackup('', 'phase A was killed at 360 s'), /pending_run_mismatch/);
  assert.throws(() => h.ctx.abandonPendingIntegrityBackup('wrong-id', 'phase A was killed at 360 s'), /pending_run_mismatch/);
  assert.equal(h.props.INTEGRITY_PENDING_BACKUP, before);
  const fresh = staged();
  assert.throws(() => fresh.ctx.abandonPendingIntegrityBackup('1', 'nothing is pending here'), /no_pending_backup/);
});

test('abandon refuses while any execution is active (never races a running phase)', () => {
  const h = interrupted(), id = pendingId(h);
  h.props.INTEGRITY_ACTIVE_BACKUP = JSON.stringify({ id: 'other', startedAt: new Date().toISOString() });
  assert.throws(() => h.ctx.abandonPendingIntegrityBackup(id, 'phase A was killed at 360 s'), /backup_busy/);
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
});

test('abandon refuses a day that already has a certificate: finalize again instead', () => {
  const h = staged(), day = dayOf(h);
  h.ctx.nightlyIntegrityJob();
  // Certificate written, but retention failed: pending is kept for retry.
  const apply = h.ctx._integrityApplyRetention;
  h.ctx._integrityApplyRetention = () => { throw Error('retention outage'); };
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /retention outage/);
  h.ctx._integrityApplyRetention = apply;
  assert.ok(h.backup.getSheetByName('outpatient-verified-' + day));
  assert.throws(() => h.ctx.abandonPendingIntegrityBackup(pendingId(h), 'retention outage after cert'), /pending_set_certified/);
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().ok, true);
});

test('abandon clears ONLY the pending marker: no sheet deleted, no sentinel or inventory advanced, audited + alerted', () => {
  const h = interrupted(), id = pendingId(h), names = sheetNames(h);
  const keep = ['INTEGRITY_LAST_COUNT', 'INTEGRITY_LAST_IDS', 'INTEGRITY_LAST_RUN', 'INTEGRITY_REQUIRED_SOURCES']
    .map(k => [k, h.props[k]]);
  const before = alerts(h).length;
  const out = h.ctx.abandonPendingIntegrityBackup(id, 'phase A was killed at 360 s; owner decision');
  assert.equal(JSON.stringify(out), JSON.stringify({ ok: true, state: 'abandoned', day: dayOf(h), certified: false }));
  assert.equal(h.props.INTEGRITY_PENDING_BACKUP, undefined);
  assert.deepEqual(sheetNames(h), names, 'partial snapshots stay as evidence');
  for (const [k, v] of keep) assert.equal(h.props[k], v, k + ' must not advance');
  const record = JSON.parse(h.props.INTEGRITY_LAST_ABANDONED_BACKUP);
  assert.equal(record.id, id); assert.equal(record.day, dayOf(h)); assert.match(record.reason, /owner decision/);
  assert.equal(alerts(h).length, before + 1);
  assert.match(alerts(h).at(-1), /ABANDONED/);
  // The abandoned set is never a recovery point.
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h), false), /manifest missing/);
  assert.deepEqual(h.locks(), [false, false]);
});

test('after abandon, the next capture runs and is independently certified', () => {
  const h = interrupted();
  h.ctx.abandonPendingIntegrityBackup(pendingId(h), 'phase A was killed at 360 s; owner decision');
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().state, 'verified');
  assert.ok(h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h), false).length > 0);
});

test('finalizer refusal is ALERTED (missing Phase A, stranded marker, leftover trigger), never silent', () => {
  const cases = [
    ['no_pending_backup', h => {}],
    ['backup_busy', h => { h.props.INTEGRITY_ACTIVE_BACKUP = 'stranded'; }],
    ['two_stage_not_enabled', h => { delete h.props.INTEGRITY_TWO_STAGE_ENABLED; }],
    ['invalid_pending_backup', h => { h.props.INTEGRITY_PENDING_BACKUP = '{not json'; }],
    ['backup_busy', h => { h.faults.captureLock = true; }]
  ];
  for (const [error, setup] of cases) {
    const h = staged(); setup(h);
    const markers = [h.props.INTEGRITY_ACTIVE_BACKUP, h.props.INTEGRITY_PENDING_BACKUP];
    assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), new RegExp(error));
    assert.equal(alerts(h).length, 1, error + ' must alert');
    assert.match(alerts(h)[0], /finalizer/);
    assert.deepEqual([h.props.INTEGRITY_ACTIVE_BACKUP, h.props.INTEGRITY_PENDING_BACKUP], markers, 'nothing auto-cleared');
  }
});

test('an intentional recovery hold keeps the finalizer silent and untouched', () => {
  const h = staged();
  h.ctx.nightlyIntegrityJob();
  h.props.OUTPATIENT_RECOVERY_HOLD = '1';
  const marker = h.props.INTEGRITY_PENDING_BACKUP;
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /recovery_pending/);
  assert.equal(alerts(h).length, 0);
  assert.equal(h.props.INTEGRITY_PENDING_BACKUP, marker);
});

test('new operator tools are editor-only: no HTTP route can reach them', () => {
  const fs = require('node:fs');
  const code = fs.readFileSync(require('node:path').join(__dirname, '../apps-script/Code.gs'), 'utf8');
  const calls = name => code.split(name + '(').length - 1;
  // Exactly one occurrence each: the definition itself.
  assert.equal(calls('abandonPendingIntegrityBackup'), 1);
  assert.equal(calls('draftOutpatientManualPolicy'), 1);
  assert.equal(/case\s+'abandon/.test(code), false);
});
