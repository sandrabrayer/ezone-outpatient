'use strict';

/**
 * Issue C — deleting a patient cleans up their extra-charge rows
 * ("בקשות לטיפול נוסף"), and a charge with no active patient is excluded.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * `excludeOrphanCharges` is the pure helper exported from public/charges-logic.js
 * (mirrored inline in public/app.js). `removeChargesForClient` models the
 * Apps Script `_removeChargesForClient` row deletion (apps-script/Code.gs):
 * every CHARGES row whose clientId matches is removed, others survive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { excludeOrphanCharges } = require('../public/charges-logic.js');

// Pure model of apps-script/Code.gs _removeChargesForClient: drop every row
// whose clientId matches; return { rows, removed }.
function removeChargesForClient(rows, clientId) {
  if (!clientId) return { rows: rows.slice(), removed: 0 };
  const kept = rows.filter((r) => String(r.clientId) !== String(clientId));
  return { rows: kept, removed: rows.length - kept.length };
}

const CLIENTS = [{ id: 'c1', name: 'אורי' }, { id: 'c2', name: 'נועה' }];
const CHARGES = [
  { id: 'ch1', clientId: 'c1', description: 'טיפול CBT נוסף', amount: 200 },
  { id: 'ch2', clientId: 'c1', description: 'אבחון', amount: 350 },
  { id: 'ch3', clientId: 'c2', description: 'טיפול נוסף', amount: 150 },
];

test('deleting a patient removes all of their additional-treatment requests', () => {
  const { rows, removed } = removeChargesForClient(CHARGES, 'c1');
  assert.equal(removed, 2);
  assert.deepEqual(rows.map((r) => r.id), ['ch3']);   // only c2's charge survives
});

test('deleting a patient leaves other patients\' requests untouched', () => {
  const { rows } = removeChargesForClient(CHARGES, 'c1');
  assert.ok(rows.every((r) => r.clientId !== 'c1'));
  assert.equal(rows.filter((r) => r.clientId === 'c2').length, 1);
});

test('deleting a patient with no requests is a no-op', () => {
  const { rows, removed } = removeChargesForClient(CHARGES, 'cX');
  assert.equal(removed, 0);
  assert.equal(rows.length, CHARGES.length);
});

test('excludeOrphanCharges drops a request whose patient no longer exists', () => {
  // c1 was deleted from CLIENTS but ch1/ch2 still reference it (an old orphan).
  const clientsAfterDelete = CLIENTS.filter((c) => c.id !== 'c1');
  const live = excludeOrphanCharges(CHARGES, clientsAfterDelete);
  assert.deepEqual(live.map((r) => r.id), ['ch3']);
});

test('excludeOrphanCharges keeps every request that has an active patient', () => {
  const live = excludeOrphanCharges(CHARGES, CLIENTS);
  assert.equal(live.length, 3);
});

test('excludeOrphanCharges tolerates empty / missing inputs', () => {
  assert.deepEqual(excludeOrphanCharges([], CLIENTS), []);
  assert.deepEqual(excludeOrphanCharges(CHARGES, []), []);
  assert.deepEqual(excludeOrphanCharges(undefined, undefined), []);
});

test('post-delete invariant: cleanup + orphan filter leave no dangling request', () => {
  // Simulate the full delete flow: remove client c1, hard-delete its charge
  // rows, then load with the orphan filter. Nothing should reference c1.
  const clientsAfter = CLIENTS.filter((c) => c.id !== 'c1');
  const { rows: sheetAfter } = removeChargesForClient(CHARGES, 'c1');
  const inMemory = excludeOrphanCharges(sheetAfter, clientsAfter);
  assert.ok(inMemory.every((r) => r.clientId !== 'c1'));
});
