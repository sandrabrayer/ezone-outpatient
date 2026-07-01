'use strict';

/**
 * Coverage for the מטופלים card urgency sort in public/charges-logic.js
 * (urgencyTier + compareCardUrgency). public/app.js keeps an inline mirror —
 * any rule change must update both. Run with:  npm test
 *
 * Sort contract (most urgent first):
 *   tier 0  red / overdue (עצור טיפול — לא שולם)   -> ascending daysLeft (most overdue first)
 *   tier 1  due_soon (חידוש היום / בעוד N ימים)     -> ascending daysLeft (soonest first)
 *   tier 2  everyone else (ok / unknown)            -> stable (incoming order)
 * A card that is BOTH overdue AND renewal-due is tier 0 (renewalInfo already
 * resolves such a card's status to 'overdue', so it enters here as tier 0).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { urgencyTier, compareCardUrgency } = require('../public/charges-logic.js');

// Decorate like renderClients does: { client, tier, daysLeft, index }.
function decorate(cards) {
  return cards.map((c, i) => ({
    client: c,
    tier: urgencyTier(c.status),
    daysLeft: c.daysLeft,
    index: i
  }));
}
function sortedNames(cards) {
  return decorate(cards).sort(compareCardUrgency).map((d) => d.client.name);
}

test('urgencyTier maps renewalInfo status to tiers', () => {
  assert.equal(urgencyTier('overdue'), 0);
  assert.equal(urgencyTier('due_soon'), 1);
  assert.equal(urgencyTier('ok'), 2);
  assert.equal(urgencyTier('unknown'), 2);
});

test('tier precedence: red before due_soon before other', () => {
  const cards = [
    { name: 'ok', status: 'ok', daysLeft: 3 },
    { name: 'soon', status: 'due_soon', daysLeft: 2 },
    { name: 'red', status: 'overdue', daysLeft: -1 }
  ];
  assert.deepEqual(sortedNames(cards), ['red', 'soon', 'ok']);
});

test('both overdue AND renewal-due sorts as red (tier 0), above due_soon', () => {
  // renewalInfo resolves such a card to status 'overdue', so it arrives tier 0.
  const cards = [
    { name: 'dueSoon', status: 'due_soon', daysLeft: 0 },
    { name: 'redAndDue', status: 'overdue', daysLeft: 0 }
  ];
  assert.deepEqual(sortedNames(cards), ['redAndDue', 'dueSoon']);
});

test('red tier sorts ascending by daysLeft (most overdue first)', () => {
  const cards = [
    { name: 'r-1', status: 'overdue', daysLeft: -1 },
    { name: 'r-5', status: 'overdue', daysLeft: -5 },
    { name: 'r-3', status: 'overdue', daysLeft: -3 }
  ];
  assert.deepEqual(sortedNames(cards), ['r-5', 'r-3', 'r-1']);
});

test('due_soon tier sorts ascending by daysLeft (today=0 before "in N days")', () => {
  const cards = [
    { name: 'd4', status: 'due_soon', daysLeft: 4 },
    { name: 'd0', status: 'due_soon', daysLeft: 0 },
    { name: 'd2', status: 'due_soon', daysLeft: 2 }
  ];
  assert.deepEqual(sortedNames(cards), ['d0', 'd2', 'd4']);
});

test('null daysLeft sinks to the end of its tier', () => {
  const cards = [
    { name: 'dNull', status: 'due_soon', daysLeft: null },
    { name: 'd1', status: 'due_soon', daysLeft: 1 }
  ];
  assert.deepEqual(sortedNames(cards), ['d1', 'dNull']);
});

test('tier 2 keeps incoming order (stable) — no reordering among non-urgent', () => {
  const cards = [
    { name: 'a', status: 'ok', daysLeft: 30 },
    { name: 'b', status: 'unknown', daysLeft: null },
    { name: 'c', status: 'ok', daysLeft: 12 }
  ];
  assert.deepEqual(sortedNames(cards), ['a', 'b', 'c']);
});

test('same tier + same daysLeft is stable (index tiebreak)', () => {
  const cards = [
    { name: 'first', status: 'due_soon', daysLeft: 2 },
    { name: 'second', status: 'due_soon', daysLeft: 2 },
    { name: 'third', status: 'due_soon', daysLeft: 2 }
  ];
  assert.deepEqual(sortedNames(cards), ['first', 'second', 'third']);
});

test('full mixed list orders across all tiers correctly', () => {
  const cards = [
    { name: 'ok1', status: 'ok', daysLeft: 20 },
    { name: 'soon2', status: 'due_soon', daysLeft: 2 },
    { name: 'red-1', status: 'overdue', daysLeft: -1 },
    { name: 'ok2', status: 'ok', daysLeft: 5 },
    { name: 'today', status: 'due_soon', daysLeft: 0 },
    { name: 'red-4', status: 'overdue', daysLeft: -4 }
  ];
  assert.deepEqual(sortedNames(cards), ['red-4', 'red-1', 'today', 'soon2', 'ok1', 'ok2']);
});
