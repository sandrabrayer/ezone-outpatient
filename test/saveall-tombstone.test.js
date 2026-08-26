'use strict';

/**
 * Coverage for the _saveAll row-loss guard + Clients-removed tombstone
 * (apps-script/Code.gs) and its explicit-delete wiring (public/app.js).
 *
 * Incident this locks (2026-08-26): _saveAll is a clear-and-rewrite of the
 * whole Clients sheet from whatever client list the browser sent. A tab
 * holding a stale list silently erased a patient row (id_mslqqp14_…) while
 * their Payments rows survived as orphans. The guard diffs the on-sheet ids
 * against the incoming array and appends every dropped row IN FULL to the
 * "Clients-removed" tombstone sheet BEFORE writing, so no drop is ever
 * silent or unrecoverable.
 *
 * Two styles, matching the passing tests in this suite: a pure MIRROR of the
 * diff/attribution logic, and SOURCE-SCAN guards over Code.gs + app.js
 * locking the real wiring to the contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function namedArray(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of the _saveAll diff + removedVia attribution
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors the row-loss guard inside _saveAll: which existing rows are dropped,
// and how each drop is attributed.
function diffDroppedClients(existing, incoming, explicitRemovedIds) {
  const incomingIds = {};
  incoming.forEach((c) => {
    const id = c && c.id != null ? String(c.id) : '';
    if (id) incomingIds[id] = true;
  });
  const explicitSet = {};
  (explicitRemovedIds || []).forEach((id) => {
    if (id != null && String(id) !== '') explicitSet[String(id)] = true;
  });
  const dropped = [];
  existing.forEach((row) => {
    const id = row && row.id != null ? String(row.id) : '';
    if (id && !incomingIds[id]) {
      dropped.push({ row, removedVia: explicitSet[id] ? 'explicit-delete' : 'saveAll-diff' });
    }
  });
  return dropped;
}

const EXISTING = [
  { id: 'a', name: 'דנה' },
  { id: 'b', name: 'מנשה' },
  { id: 'c', name: 'יוסי' },
  { id: '', name: 'שורה בלי מזהה' }
];

test('no rows missing → nothing tombstoned', () => {
  assert.deepEqual(diffDroppedClients(EXISTING, EXISTING, []), []);
});

test('a row missing without explicit declaration → saveAll-diff (the clobber signature)', () => {
  const dropped = diffDroppedClients(EXISTING, [EXISTING[0], EXISTING[2]], []);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].row.id, 'b');
  assert.equal(dropped[0].removedVia, 'saveAll-diff');
});

test('a declared id → explicit-delete; an undeclared one in the SAME save stays saveAll-diff', () => {
  const dropped = diffDroppedClients(EXISTING, [EXISTING[0]], ['c']);
  const byId = {};
  dropped.forEach((d) => { byId[d.row.id] = d.removedVia; });
  assert.deepEqual(byId, { b: 'saveAll-diff', c: 'explicit-delete' });
});

test('an empty incoming list tombstones EVERY id-carrying row (full wipe stays recoverable)', () => {
  const dropped = diffDroppedClients(EXISTING, [], []);
  assert.deepEqual(dropped.map((d) => d.row.id), ['a', 'b', 'c']);
});

test('blank-id rows cannot be diffed and are never tombstoned', () => {
  const dropped = diffDroppedClients(EXISTING, EXISTING.slice(0, 3), []);
  assert.deepEqual(dropped, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards
// ─────────────────────────────────────────────────────────────────────────────

test('CLIENTS_REMOVED_HEADERS = every CLIENTS_HEADERS column + removedAt/removedVia/restoredAt, as its OWN literal', () => {
  const clients = namedArray('CLIENTS_HEADERS');
  const removed = namedArray('CLIENTS_REMOVED_HEADERS');
  assert.deepEqual(removed, clients.concat(['removedAt', 'removedVia', 'restoredAt']));
  // Decoupling guard: the tombstone array must be a full literal, never
  // derived from CLIENTS_HEADERS at runtime (a concat would let a future
  // Clients append shift the meta columns under existing tombstone rows).
  assert.ok(!/CLIENTS_REMOVED_HEADERS = CLIENTS_HEADERS/.test(GS),
    'CLIENTS_REMOVED_HEADERS must not be derived from CLIENTS_HEADERS');
});

test('Code.gs: _saveAll diffs on-sheet ids and tombstones dropped rows BEFORE the clear-and-rewrite', () => {
  const m = GS.match(/function _saveAll[\s\S]*?\n}/);
  assert.ok(m, '_saveAll not found');
  const body = m[0];
  assert.match(body, /incomingIds/, '_saveAll must index the incoming ids');
  assert.match(body, /explicitRemovedIds/, '_saveAll must read the explicit-delete declarations');
  assert.match(body, /_appendClientTombstones/, '_saveAll must tombstone dropped rows');
  const tombstoneAt = body.indexOf('_appendClientTombstones');
  const writeAt = body.indexOf("_writeAll(clientsSh, CLIENTS_HEADERS");
  assert.ok(tombstoneAt !== -1 && writeAt !== -1 && tombstoneAt < writeAt,
    'tombstones must be appended BEFORE the Clients clear-and-rewrite');
});

test('Code.gs: _appendClientTombstones writes to "Clients-removed", stamping removedAt/removedVia and a blank restoredAt', () => {
  const m = GS.match(/function _appendClientTombstones[\s\S]*?\n}/);
  assert.ok(m, '_appendClientTombstones not found');
  const body = m[0];
  assert.match(body, /'Clients-removed'/);
  assert.match(body, /CLIENTS_REMOVED_HEADERS/);
  assert.match(body, /'explicit-delete'/);
  assert.match(body, /'saveAll-diff'/);
  assert.match(body, /appendRow/, 'tombstones are append-only rows (the לידים שהוסרו pattern)');
});

test('Code.gs: doPost threads explicitRemovedIds through the saveAll branch', () => {
  assert.match(GS, /explicitRemovedIds: Array\.isArray\(payload\.explicitRemovedIds\) \? payload\.explicitRemovedIds : \[\]/,
    'doPost must forward explicitRemovedIds to _saveAll (its saveAll branch rebuilds the payload)');
});

test('app.js: the ✕ permanent-delete declares its id, and persist() forwards the declaration', () => {
  assert.match(APP, /persist\(\{ explicitRemovedIds: \[deletedId\] \}\)/,
    'the permanent-delete flow must declare the removed id');
  const m = APP.match(/async function persist\([\s\S]*?\n  \}/);
  assert.ok(m, 'persist not found in public/app.js');
  assert.match(m[0], /payload\.explicitRemovedIds = opts\.explicitRemovedIds/,
    'persist must forward explicitRemovedIds on the saveAll payload');
});
