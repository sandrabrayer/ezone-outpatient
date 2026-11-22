'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/backup-sandbox.cjs');

test('backup retention uses a single Google inventory while keeping manual tabs and the last sheet', () => {
  const h = harness();
  const day = '2026-11-22';
  h.backup.insertSheet('outpatient-leads-' + day, [['id'], ['retain']]);
  h.backup.insertSheet('Copy of Clients', [['manual']]);
  for (let i = 1; i <= 30; i++) {
    h.backup.insertSheet('outpatient-leads-2026-10-' + String(i).padStart(2, '0'), [['id']]);
  }
  let reads = 0;
  const original = h.backup.getSheets.bind(h.backup);
  h.backup.getSheets = function () { reads++; return original(); };
  const removed = h.ctx._integrityApplyRetention(h.backup, 'outpatient-' + day, 7);
  assert.equal(reads, 1, 'list all tabs only once, not once per deleted/retained tab');
  assert.ok(removed.length >= 20);
  assert.ok(h.backup.getSheetByName('outpatient-leads-' + day));
  assert.ok(h.backup.getSheetByName('Copy of Clients'));
});

test('full live-Google-independent backup post-publication scan is still mandatory', () => {
  const h = harness();
  h.ctx.nightlyIntegrityJob();
  const day = h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  assert.ok(h.backup.getSheetByName('outpatient-manifest-' + day));
  const seenPublishedReads = h.events.some(e =>
    e[0] === 'read' && e[1] === 'backup' &&
    e[2].startsWith('outpatient-') &&
    !e[2].startsWith('outpatient-pending-') &&
    !e[2].startsWith('outpatient-manifest-'));
  assert.equal(seenPublishedReads, true,
    'never replace independent readback with unchecked in-memory attestation');
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.deepEqual(h.locks(), [false, false]);
});
