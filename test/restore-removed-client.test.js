'use strict';

/**
 * Coverage for the Clients-removed admin restore surface:
 * apps-script/Code.gs `_getRemovedClients` / `_restoreRemovedClient`
 * (mirrored here) and the מטופלים שנמחקו section of the inactive tab
 * (public/app.js).
 *
 * Contract: restore copies the LATEST un-restored tombstone for an id back to
 * Clients and stamps that tombstone's restoredAt — tombstones are append-only
 * (never deleted or otherwise rewritten), a live id is never duplicated
 * ('already_active'), and a missing or already-restored tombstone is
 * 'not_found'.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of _restoreRemovedClient
// ─────────────────────────────────────────────────────────────────────────────

// clients: live rows; tombs: Clients-removed rows in sheet order. Returns the
// mutated structures on success (restoredAt stamped in place, client appended)
// so tests can assert the exact side effects.
function restoreRemovedClient(clients, tombs, id, nowISO) {
  id = String(id == null ? '' : id).trim();
  if (!id) return { ok: false, error: 'missing_id' };
  if (clients.some((c) => String(c.id) === id)) return { ok: false, error: 'already_active' };
  let rowIdx = -1;
  for (let r = tombs.length - 1; r >= 0; r--) {
    if (String(tombs[r].id) === id && !tombs[r].restoredAt) { rowIdx = r; break; }
  }
  if (rowIdx === -1) return { ok: false, error: 'not_found' };
  const tomb = tombs[rowIdx];
  const client = {};
  Object.keys(tomb).forEach((k) => {
    if (k !== 'removedAt' && k !== 'removedVia' && k !== 'restoredAt') client[k] = tomb[k];
  });
  clients.push(client);
  tomb.restoredAt = nowISO;
  return { ok: true, restored: true, id, name: String(tomb.name || '') };
}

const NOW = '2026-08-26T10:00:00.000Z';

function fixtures() {
  const clients = [{ id: 'live1', name: 'דנה', status: 'פעיל' }];
  const tombs = [
    { id: 'gone1', name: 'מנשה וקנין', status: 'פעיל', removedAt: '2026-08-26T07:50:00.000Z', removedVia: 'saveAll-diff', restoredAt: '' },
    { id: 'gone2', name: 'בדיקה', status: 'פעיל', removedAt: '2026-08-01T00:00:00.000Z', removedVia: 'explicit-delete', restoredAt: '2026-08-02T00:00:00.000Z' },
    { id: 'gone1', name: 'מנשה וקנין', status: 'הפסקה זמנית', removedAt: '2026-08-26T08:10:00.000Z', removedVia: 'saveAll-diff', restoredAt: '' }
  ];
  return { clients, tombs };
}

test('restore brings back the LATEST un-restored tombstone, exactly as removed, and stamps only restoredAt', () => {
  const { clients, tombs } = fixtures();
  const res = restoreRemovedClient(clients, tombs, 'gone1', NOW);
  assert.equal(res.ok, true);
  assert.equal(res.name, 'מנשה וקנין');
  // the newer tombstone (index 2) wins and its status travels back verbatim
  const restored = clients.find((c) => c.id === 'gone1');
  assert.equal(restored.status, 'הפסקה זמנית');
  assert.ok(!('removedAt' in restored) && !('removedVia' in restored) && !('restoredAt' in restored),
    'tombstone meta columns must not leak onto the restored client');
  assert.equal(tombs[2].restoredAt, NOW);
  assert.equal(tombs[0].restoredAt, '', 'older tombstone stays un-restored (audit trail intact)');
  assert.equal(tombs.length, 3, 'tombstones are append-only — never deleted');
});

test('a live id is never duplicated: already_active, no mutation', () => {
  const { clients, tombs } = fixtures();
  tombs.push({ id: 'live1', name: 'דנה', removedAt: NOW, removedVia: 'saveAll-diff', restoredAt: '' });
  const res = restoreRemovedClient(clients, tombs, 'live1', NOW);
  assert.deepEqual(res, { ok: false, error: 'already_active' });
  assert.equal(clients.length, 1);
});

test('missing id / already-restored tombstone → not_found; blank id → missing_id', () => {
  const { clients, tombs } = fixtures();
  assert.deepEqual(restoreRemovedClient(clients, tombs, 'ghost', NOW), { ok: false, error: 'not_found' });
  assert.deepEqual(restoreRemovedClient(clients, tombs, 'gone2', NOW), { ok: false, error: 'not_found' });
  assert.deepEqual(restoreRemovedClient(clients, tombs, '', NOW), { ok: false, error: 'missing_id' });
  assert.equal(clients.length, 1);
});

test('double restore is blocked: the second call finds no un-restored tombstone left… unless removed again', () => {
  const { clients, tombs } = fixtures();
  restoreRemovedClient(clients, tombs, 'gone1', NOW);
  // still already_active while the row lives
  assert.deepEqual(restoreRemovedClient(clients, tombs, 'gone1', NOW), { ok: false, error: 'already_active' });
  // removed again → the OLDER un-restored tombstone is still reachable
  clients.splice(clients.findIndex((c) => c.id === 'gone1'), 1);
  const res = restoreRemovedClient(clients, tombs, 'gone1', NOW);
  assert.equal(res.ok, true);
  assert.equal(tombs[0].restoredAt, NOW);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards
// ─────────────────────────────────────────────────────────────────────────────

test('Code.gs: _getRemovedClients returns only un-restored tombstones', () => {
  const m = GS.match(/function _getRemovedClients[\s\S]*?\n}/);
  assert.ok(m, '_getRemovedClients not found');
  assert.match(m[0], /CLIENTS_REMOVED_HEADERS/);
  assert.match(m[0], /restoredAt/, 'must filter on restoredAt');
});

test('Code.gs: _restoreRemovedClient guards, restores bottom-up, stamps restoredAt, never deletes a tombstone', () => {
  const m = GS.match(/function _restoreRemovedClient[\s\S]*?\n}/);
  assert.ok(m, '_restoreRemovedClient not found');
  const body = m[0];
  assert.match(body, /'already_active'/);
  assert.match(body, /'not_found'/);
  assert.match(body, /for \(var r = vals\.length - 1; r >= 0; r--\)/, 'latest un-restored tombstone wins (bottom-up scan)');
  assert.match(body, /CLIENTS_HEADERS\.map/, 'restored row is written under the Clients headers only');
  assert.match(body, /setValue\(new Date\(\)\.toISOString\(\)\)/, 'restore stamps restoredAt');
  assert.ok(!/deleteRow/.test(body), 'tombstones are append-only — restore must never delete one');
  assert.match(body, /LockService/, 'restore runs under the script lock');
});

test('Code.gs: routes — getRemovedClients on doGet + doPost, restoreRemovedClient on doPost', () => {
  assert.match(GS, /action === 'getRemovedClients'\) return _json\(_getRemovedClients\(\)\);/);
  assert.match(GS, /action === 'restoreRemovedClient'\) return _json\(_restoreRemovedClient\(payload\)\);/);
});

test('app.js: the inactive tab renders the מטופלים שנמחקו section with an editor-only restore', () => {
  const idx = APP.indexOf("rh.textContent = 'מטופלים שנמחקו'");
  assert.ok(idx !== -1, 'removed-patients section not found');
  const renderInactiveIdx = APP.indexOf('function renderInactive(');
  assert.ok(renderInactiveIdx !== -1 && renderInactiveIdx < idx, 'section must live inside renderInactive');
  const after = APP.slice(idx, idx + 2500);
  assert.match(after, /state\.role === 'editor'/, 'restore button must be editor-only');
  assert.match(after, /performRestoreRemovedClient/, 'restore must go through the tombstone restore flow');
  assert.match(APP, /!finished\.length && !deactivated\.length && !removedRows\.length/,
    'empty-state must account for the removed section');
});

test('app.js: restore flow confirms, posts restoreRemovedClient, reloads, and refetches tombstones', () => {
  const m = APP.match(/function performRestoreRemovedClient[\s\S]*?\n  \}/);
  assert.ok(m, 'performRestoreRemovedClient not found');
  const body = m[0];
  assert.match(body, /confirm\(/);
  assert.match(body, /apiPostAction\('restoreRemovedClient', \{ id: id \}\)/);
  assert.match(body, /state\.removedClients = null/, 'tombstone cache must be invalidated');
  assert.match(body, /loadAll\(\)/, 'a successful restore reloads so the card appears everywhere');
});
