'use strict';
// OP-03 v3: actual Apps Script source exercised through synthetic Google services.
// Never opens a live spreadsheet, changes production properties, or installs triggers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/backup-sandbox.cjs');

function staged(extra) {
  const h = harness(extra);
  h.props.INTEGRITY_TWO_STAGE_ENABLED = '1'; // synthetic-only activation
  return h;
}
function dayOf(h) {
  return h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
}
function names(h, day) {
  return {
    snapshot: 'outpatient-' + day,
    pending: 'outpatient-pending-manifest-' + day,
    manifest: 'outpatient-manifest-' + day,
    certificate: 'outpatient-verified-' + day
  };
}

test('phase A publishes a pending-only set; phase B independently verifies, certifies, and updates sentinel', () => {
  const h = staged(), day = dayOf(h), n = names(h, day);
  assert.equal(h.ctx.nightlyIntegrityJob() === undefined || typeof h.ctx.nightlyIntegrityJob === 'function', true);
  // A duplicate request must not acquire the source or mutate a second set.
  assert.ok(h.backup.getSheetByName(n.pending));
  assert.equal(h.backup.getSheetByName(n.manifest), null);
  assert.equal(h.backup.getSheetByName(n.certificate), null);
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_LAST_COUNT, undefined);
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, day, false), /manifest missing/);
  const writeCount = h.events.filter(e => e[0] === 'write').length;
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /backup_busy/);
  assert.equal(h.events.filter(e => e[0] === 'write').length, writeCount);
  const proof = h.ctx.finalizeNightlyIntegrityJob();
  assert.equal(proof.ok, true);
  assert.equal(proof.state, 'verified');
  assert.ok(h.backup.getSheetByName(n.manifest));
  assert.ok(h.backup.getSheetByName(n.certificate));
  assert.equal(h.props.INTEGRITY_PENDING_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_LAST_COUNT, '1');
  assert.deepEqual(JSON.parse(h.props.INTEGRITY_LAST_IDS), ['client-a']);
  assert.ok(h.ctx._integrityValidateRestoreSet(h.backup, day, false).length > 0);
  assert.deepEqual(h.locks(), [false, false]);
});

test('phase A interrupted before staged manifest cannot be certified or silently retried', () => {
  const h = staged(), day = dayOf(h), n = names(h, day);
  h.faults.publish = n.pending;
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /nightly_backup_not_published/);
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP, 'pending marker survives failed publication');
  assert.equal(h.backup.getSheetByName(n.manifest), null);
  assert.equal(h.backup.getSheetByName(n.certificate), null);
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /pending_manifest_missing/);
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /backup_busy/);
  assert.equal(h.props.INTEGRITY_LAST_COUNT, undefined);
});

test('tampering with a published snapshot between phases is caught before certificate', () => {
  const h = staged(), day = dayOf(h), n = names(h, day);
  h.ctx.nightlyIntegrityJob();
  h.backup.getSheetByName(n.snapshot).getRange(1, 1, 2, 3)
    .setValues([['id', 'name', 'phone'], ['forged-client', 'Changed', '0500000001']]);
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /Restore snapshot mismatch/);
  assert.equal(h.backup.getSheetByName(n.certificate), null);
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, day, false), /mismatch/);
});

test('failure after final manifest but before certificate remains UNVERIFIED, then safe retry succeeds', () => {
  const h = staged(), day = dayOf(h), n = names(h, day);
  h.ctx.nightlyIntegrityJob();
  h.faults.publish = n.certificate;
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /publish failed/);
  assert.ok(h.backup.getSheetByName(n.manifest));
  assert.equal(h.backup.getSheetByName(n.certificate), null);
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  // Restore preflight cannot accept the seemingly complete final manifest.
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, day, false), /not certified/);
  h.faults.publish = '';
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().ok, true);
  assert.ok(h.ctx._integrityValidateRestoreSet(h.backup, day, false).length);
  assert.equal(h.props.INTEGRITY_PENDING_BACKUP, undefined);
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /no_pending_backup/);
});

test('duplicate or stalled writer fails closed; no active/pending marker is auto-cleared', () => {
  const h = staged(), day = dayOf(h), n = names(h, day);
  h.props.INTEGRITY_ACTIVE_BACKUP = 'busy-by-other-execution';
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /backup_busy/);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, 'busy-by-other-execution');
  delete h.props.INTEGRITY_ACTIVE_BACKUP; // synthetic fixture reset only
  h.ctx.nightlyIntegrityJob();
  h.faults.captureLock = true;
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /backup_busy/);
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
  h.faults.captureLock = false;
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().ok, true);
  const certificate = h.backup.getSheetByName(n.certificate);
  assert.ok(certificate);
  // Same-day second run is refused, preserving the first certified image.
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /nightly_backup_not_published/);
  assert.strictEqual(h.backup.getSheetByName(n.certificate), certificate);
});

test('certificate is tied to exact manifest contents and cannot hide later corruption', () => {
  const h = staged(), day = dayOf(h), n = names(h, day);
  h.ctx.nightlyIntegrityJob();
  h.ctx.finalizeNightlyIntegrityJob();
  const cert = h.backup.getSheetByName(n.certificate);
  cert.getRange(1, 1, 4, 2)
    .setValues([['key','value'], ['day',day], ['backupRunId','wrong-run'], ['manifestSha256','bad']]);
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, day, false), /Backup value mismatch/);
});

test('unknown manual tabs remain in the captured inventory and do not become an auto-approved restore', () => {
  const h = staged();
  h.faults.forbidLiveWrites = false; // fixture setup, before invocation only
  h.live.insertSheet('Sheet1', [['manual'], ['synthetic note']]);
  h.live.insertSheet('Copy of Clients', [['id','note'], ['archive','literal']]);
  h.faults.forbidLiveWrites = true;
  const day = dayOf(h);
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().ok, true);
  const data = h.ctx._integrityValidateRestoreSet(h.backup, day, false);
  const a = data.find(x => x.source === 'Sheet1');
  const b = data.find(x => x.source === 'Copy of Clients');
  assert.ok(a && b);
  assert.equal(a.grid[1][0], 'synthetic note');
  assert.equal(b.grid[1][0], 'archive');
  assert.ok(!h.backup.getSheetByName('outpatient-Sheet1-' + day));
  assert.ok(JSON.parse(h.props.INTEGRITY_REQUIRED_SOURCES).includes('Copy of Clients'));
});

test('legacy v2 backup remains valid without certificate when two-stage is not enabled', () => {
  const h = harness(), day = dayOf(h);
  h.ctx.nightlyIntegrityJob();
  assert.ok(h.ctx._integrityValidateRestoreSet(h.backup, day, false).length);
  assert.equal(h.backup.getSheetByName('outpatient-verified-' + day), null);
});
