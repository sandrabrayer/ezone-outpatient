'use strict';

/**
 * Unit coverage for the shared per-tab name-search helper in
 * public/name-search.js.
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Contracts locked:
 *   - matchesName: case-insensitive substring; empty / whitespace query matches
 *     everything; null/undefined name is treated as ''
 *   - filterByName: empty query returns ALL items (order preserved, input not
 *     mutated); a real query narrows to case-insensitive substring matches; a
 *     no-match query returns []
 *   - nameOf accessor lets non-.name cards (e.g. payout therapist cards keyed on
 *     `therapist`) be filtered
 *   - PER-TAB INDEPENDENCE: the helper is pure — filtering one tab's list with
 *     one query has no effect on another tab's list filtered with a different
 *     query (no shared/global state between calls)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const NS = require('../public/name-search');

// Hebrew + English names so the case-fold path is exercised on Latin letters
// (Hebrew has no case) while staying representative of the real data.
const CLIENTS = [
  { name: 'דנה כהן' },
  { name: 'Avi Levi' },
  { name: 'דנה לוי' },
  { name: 'Yossi COHEN' },
];

test('matchesName: case-insensitive substring match', () => {
  assert.equal(NS.matchesName('Avi Levi', 'avi'), true);
  assert.equal(NS.matchesName('Avi Levi', 'LEVI'), true);
  assert.equal(NS.matchesName('דנה כהן', 'כהן'), true);
  assert.equal(NS.matchesName('Avi Levi', 'xyz'), false);
});

test('matchesName: empty / whitespace query matches everything', () => {
  assert.equal(NS.matchesName('anything', ''), true);
  assert.equal(NS.matchesName('anything', '   '), true);
  assert.equal(NS.matchesName('anything', null), true);
  assert.equal(NS.matchesName('anything', undefined), true);
});

test('matchesName: null / undefined name never throws and does not match a real query', () => {
  assert.equal(NS.matchesName(null, 'a'), false);
  assert.equal(NS.matchesName(undefined, 'a'), false);
  assert.equal(NS.matchesName(null, ''), true); // empty query still matches all
});

test('filterByName: empty query returns ALL items, order preserved, no mutation', () => {
  const out = NS.filterByName(CLIENTS, '');
  assert.deepEqual(out.map((c) => c.name), CLIENTS.map((c) => c.name));
  assert.notEqual(out, CLIENTS, 'returns a NEW array (copy), not the input');
  assert.equal(CLIENTS.length, 4, 'input list is not mutated');

  // Whitespace-only is equivalent to empty.
  assert.equal(NS.filterByName(CLIENTS, '   ').length, 4);
});

test('filterByName: name match is case-insensitive substring', () => {
  assert.deepEqual(
    NS.filterByName(CLIENTS, 'דנה').map((c) => c.name),
    ['דנה כהן', 'דנה לוי']
  );
  // "cohen" matches both the lower- and upper-case Latin spellings.
  assert.deepEqual(
    NS.filterByName(CLIENTS, 'cohen').map((c) => c.name),
    ['Yossi COHEN']
  );
  // Latin "levi" matches only the Latin-spelled card, not the Hebrew "לוי".
  assert.deepEqual(
    NS.filterByName(CLIENTS, 'levi').map((c) => c.name),
    ['Avi Levi']
  );
});

test('filterByName: no-match query returns an empty list', () => {
  assert.deepEqual(NS.filterByName(CLIENTS, 'zzz-nobody'), []);
});

test('filterByName: nameOf accessor filters cards keyed on a non-.name field', () => {
  // Mirrors the payout tab, whose cards are therapist-keyed (t.therapist).
  const therapists = [
    { therapist: 'ורד שרון', paidCount: 3 },
    { therapist: 'Michael Adler', paidCount: 1 },
    { therapist: 'ורד כהן', paidCount: 2 },
  ];
  const nameOf = (t) => t.therapist;
  assert.deepEqual(
    NS.filterByName(therapists, 'ורד', nameOf).map((t) => t.therapist),
    ['ורד שרון', 'ורד כהן']
  );
  assert.deepEqual(
    NS.filterByName(therapists, 'adler', nameOf).map((t) => t.therapist),
    ['Michael Adler']
  );
});

test('filterByName: bare-string lists filter without a nameOf', () => {
  assert.deepEqual(NS.filterByName(['Alpha', 'Beta', 'alphabet'], 'alph'), ['Alpha', 'alphabet']);
});

test('filterByName: non-array input is handled gracefully', () => {
  assert.deepEqual(NS.filterByName(null, 'x'), []);
  assert.deepEqual(NS.filterByName(undefined, ''), []);
});

test('per-tab independence: filtering one tab does not affect another', () => {
  // Simulate two tabs holding their OWN list + OWN query, exactly like the app
  // keeps state.payoutSearch separate from state.clientSearch. Because the
  // helper is pure, each call is isolated: searching one tab cannot leak into
  // the other's result.
  const clientsTab = [{ name: 'דנה כהן' }, { name: 'רון לוי' }];
  const payoutsTab = [{ therapist: 'ורד שרון' }, { therapist: 'דנה מור' }];

  const clientsResult = NS.filterByName(clientsTab, 'דנה');
  const payoutsResult = NS.filterByName(payoutsTab, 'ורד', (t) => t.therapist);

  assert.deepEqual(clientsResult.map((c) => c.name), ['דנה כהן']);
  assert.deepEqual(payoutsResult.map((t) => t.therapist), ['ורד שרון']);

  // Re-running the clients filter with a DIFFERENT query yields a fresh,
  // independent result — the earlier payouts search left no residue.
  const clientsResult2 = NS.filterByName(clientsTab, 'רון');
  assert.deepEqual(clientsResult2.map((c) => c.name), ['רון לוי']);

  // And the payouts result computed earlier is unchanged by the later calls.
  assert.deepEqual(payoutsResult.map((t) => t.therapist), ['ורד שרון']);

  // Source lists are untouched throughout.
  assert.equal(clientsTab.length, 2);
  assert.equal(payoutsTab.length, 2);
});
