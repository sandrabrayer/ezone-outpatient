/**
 * Tests for the per-tab name search helper (public/name-search.js).
 *
 * Run with:  npm test     (Node's built-in test runner, Node >= 18)
 *
 * These guard the rule shared by every list tab's search box:
 *   - case-insensitive substring match against a name
 *   - an empty (or whitespace-only) query returns EVERYTHING
 *   - a query with no matches returns an EMPTY list
 *   - the helper is pure, so per-tab search states never cross-contaminate
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesName, filterByName, normalizeQuery } = require('../public/name-search');

test('matchesName: plain substring match', () => {
  assert.equal(matchesName('דנה כהן', 'דנה'), true);
  assert.equal(matchesName('דנה כהן', 'כהן'), true);
  assert.equal(matchesName('דנה כהן', 'לוי'), false);
});

test('matchesName: case-insensitive', () => {
  assert.equal(matchesName('Dana Cohen', 'dana'), true);
  assert.equal(matchesName('Dana Cohen', 'COHEN'), true);
  assert.equal(matchesName('dana cohen', 'Dana'), true);
});

test('matchesName: empty / whitespace query matches everything', () => {
  assert.equal(matchesName('anyone', ''), true);
  assert.equal(matchesName('anyone', '   '), true);
  assert.equal(matchesName('anyone', null), true);
  assert.equal(matchesName('anyone', undefined), true);
});

test('matchesName: query is trimmed before matching', () => {
  assert.equal(matchesName('דנה כהן', '  דנה  '), true);
});

test('matchesName: null/undefined name never throws, only matches empty query', () => {
  assert.equal(matchesName(null, 'x'), false);
  assert.equal(matchesName(undefined, 'x'), false);
  assert.equal(matchesName(null, ''), true);
});

const PEOPLE = [
  { name: 'דנה כהן' },
  { name: 'יוסי לוי' },
  { name: 'Dana Levi' },
  { name: 'משה כהן' }
];

test('filterByName: empty query returns ALL items (a copy)', () => {
  const out = filterByName(PEOPLE, '', (p) => p.name);
  assert.equal(out.length, PEOPLE.length);
  assert.deepEqual(out, PEOPLE);
  assert.notEqual(out, PEOPLE); // new array, original not mutated
});

test('filterByName: substring match, case-insensitive', () => {
  const out = filterByName(PEOPLE, 'כהן', (p) => p.name);
  assert.deepEqual(out.map((p) => p.name), ['דנה כהן', 'משה כהן']);

  const out2 = filterByName(PEOPLE, 'levi', (p) => p.name);
  assert.deepEqual(out2.map((p) => p.name), ['Dana Levi']);
});

test('filterByName: no match returns an empty array', () => {
  assert.deepEqual(filterByName(PEOPLE, 'זזזז', (p) => p.name), []);
});

test('filterByName: default getName is identity (list of strings)', () => {
  assert.deepEqual(filterByName(['abc', 'abd', 'xyz'], 'ab'), ['abc', 'abd']);
});

test('filterByName: null/empty list is safe', () => {
  assert.deepEqual(filterByName(null, 'x'), []);
  assert.deepEqual(filterByName(undefined, ''), []);
});

test('filterByName: does not mutate the source array', () => {
  const src = [{ name: 'a' }, { name: 'b' }];
  filterByName(src, 'a', (p) => p.name);
  assert.equal(src.length, 2);
});

// --- Per-tab independence -------------------------------------------------
// Each tab holds its own query string and calls the pure helper with it. The
// helper keeps no state between calls, so filtering one tab can never affect
// another. This models two tabs (e.g. Clients and Payouts) searching at once.
test('per-tab independence: two tabs with distinct queries filter independently', () => {
  const clients = [{ name: 'דנה כהן' }, { name: 'יוסי לוי' }];
  const therapists = [{ therapist: 'דנה כהן' }, { therapist: 'ורד שמש' }];

  // Simulate independent per-tab search state.
  const tabState = { clientSearch: '', payoutSearch: '' };

  // Type in the Clients tab only.
  tabState.clientSearch = 'לוי';
  let clientView = filterByName(clients, tabState.clientSearch, (c) => c.name);
  let payoutView = filterByName(therapists, tabState.payoutSearch, (t) => t.therapist);
  assert.deepEqual(clientView.map((c) => c.name), ['יוסי לוי']);
  assert.deepEqual(payoutView.map((t) => t.therapist), ['דנה כהן', 'ורד שמש']); // untouched

  // Now type in the Payouts tab; the Clients query is unchanged and still applies.
  tabState.payoutSearch = 'ורד';
  clientView = filterByName(clients, tabState.clientSearch, (c) => c.name);
  payoutView = filterByName(therapists, tabState.payoutSearch, (t) => t.therapist);
  assert.deepEqual(clientView.map((c) => c.name), ['יוסי לוי']); // still just לוי
  assert.deepEqual(payoutView.map((t) => t.therapist), ['ורד שמש']);

  // Clearing one tab restores its full list without touching the other.
  tabState.clientSearch = '';
  clientView = filterByName(clients, tabState.clientSearch, (c) => c.name);
  payoutView = filterByName(therapists, tabState.payoutSearch, (t) => t.therapist);
  assert.equal(clientView.length, 2);
  assert.deepEqual(payoutView.map((t) => t.therapist), ['ורד שמש']); // still filtered
});

test('normalizeQuery: trims and lowercases', () => {
  assert.equal(normalizeQuery('  Hello  '), 'hello');
  assert.equal(normalizeQuery(null), '');
  assert.equal(normalizeQuery(undefined), '');
});
