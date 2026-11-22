'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/backup-sandbox.cjs');

test('scheduled nightly backup does not reread 25+ published snapshot tabs', () => {
  const h = harness();
  h.backup.insertSheet('Sheet1', [['manual backup workbook tab']]);
  h.ctx.nightlyIntegrityJob();
  const date = h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  const manifests = h.backup.getSheets().filter(s => s.getName() === 'outpatient-manifest-' + date);
  assert.equal(manifests.length, 1);
  const reads = h.events.filter(e => e[0] === 'read' && e[1] === 'backup');
  // Every data tab was read and compared while TEMPORARY, before renaming.
  const sourceSnapshotReads = reads.filter(e => /^outpatient-(?!manifest|pending)/.test(e[2]));
  assert.equal(sourceSnapshotReads.length, 0,
    'The scheduled job must not reread all remote published sheets after each was already verified');
  const manifestReads = reads.filter(e => e[2] === 'outpatient-manifest-' + date);
  assert.equal(manifestReads.length, 1, 'the final manifest must be independently read back from the actual workbook');
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined, 'successful run clears only its own marker');
  assert.deepEqual(h.locks(), [false, false]);
});

test('published-manifest tamper fails the same full-grid admission gate', () => {
  const h = harness();
  const day = '2026-11-22';
  const captured = h.ctx._integrityCaptureData(h.live);
  const prefix = 'outpatient-';
  const manifest = [['id','source','snapshot','absent','sha256']];
  captured.forEach(item => {
    const name = prefix + item.prefix + day;
    h.ctx._integrityWriteSnapshot(h.backup, name, item.grid, item.formats);
    manifest.push([item.source, item.source, name, item.absent ? '1' : '0', h.ctx._integrityFingerprint(item.grid)]);
  });
  const manifestName = prefix + 'manifest-' + day;
  h.ctx._integrityWriteSnapshot(h.backup, manifestName, manifest);
  assert.equal(h.ctx._integrityValidateJustPublishedSet_(h.backup, day, manifest, captured, false).length, captured.length);
  const sheet = h.backup.getSheetByName(manifestName);
  sheet.getRange(2, 4).setValues([['1']]); // forged absence bit after publication
  assert.throws(() => h.ctx._integrityValidateJustPublishedSet_(h.backup, day, manifest, captured, false),
    /Backup value mismatch/);
});

test('retention scans existing tabs ONCE; preserves unknown tabs and last worksheet', () => {
  const h = harness();
  const date = '2026-11-22';
  const original = 'outpatient-leads-' + date;
  h.backup.insertSheet(original, [['id'],['retain']]);
  h.backup.insertSheet('Copy of Clients', [['manual']]);
  for (let i = 1; i <= 30; i++) h.backup.insertSheet('outpatient-leads-2026-10-' + String(i).padStart(2, '0'), [['id']]);
  let calls = 0;
  const saved = h.backup.getSheets.bind(h.backup);
  h.backup.getSheets = function () { calls++; return saved(); };
  const removed = h.ctx._integrityApplyRetention(h.backup, 'outpatient-' + date, 7);
  assert.equal(calls, 1, 'no remote getSheets per worksheet');
  assert.ok(removed.length >= 20);
  assert.ok(h.backup.getSheetByName(original));
  assert.ok(h.backup.getSheetByName('Copy of Clients'));
});
