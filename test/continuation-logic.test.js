'use strict';

/**
 * Unit tests for public/continuation-logic.js — the pure logic behind the
 * "מסלול המשך" tab: the roster/workflow join key, whole-months tenure, its
 * emphasis bucket, and the outcome whitelist. Imported directly in Node.
 *
 * Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const CL = require('../public/continuation-logic');

// --- buildKey ---------------------------------------------------------------
test('buildKey joins name|house|entryDate and trims each part', () => {
  assert.equal(CL.buildKey('דנה', 'asher', '2026-01-10'), 'דנה|asher|2026-01-10');
  assert.equal(CL.buildKey('  דנה  ', ' asher ', ' 2026-01-10 '), 'דנה|asher|2026-01-10');
});

test('buildKey tolerates blanks / null / undefined without throwing', () => {
  assert.equal(CL.buildKey('', '', ''), '||');
  assert.equal(CL.buildKey(null, undefined, null), '||');
  assert.equal(CL.buildKey('דנה', '', ''), 'דנה||');
});

test('buildKey is stable — the same inputs always produce the same key', () => {
  const a = CL.buildKey('רון לוי', 'ramot', '2025-12-01');
  const b = CL.buildKey('רון לוי', 'ramot', '2025-12-01');
  assert.equal(a, b);
});

// --- monthsSince ------------------------------------------------------------
test('monthsSince: same day is 0', () => {
  assert.equal(CL.monthsSince('2026-07-05', '2026-07-05'), 0);
});

test('monthsSince: counts whole months, gated by day-of-month', () => {
  assert.equal(CL.monthsSince('2026-01-15', '2026-03-15'), 2); // exactly 2 months
  assert.equal(CL.monthsSince('2026-01-15', '2026-03-14'), 1); // 1 day short of 2
  assert.equal(CL.monthsSince('2026-01-15', '2026-02-15'), 1);
  assert.equal(CL.monthsSince('2026-01-15', '2026-02-14'), 0); // 1 day short of 1
});

test('monthsSince: crosses a year boundary', () => {
  assert.equal(CL.monthsSince('2025-11-10', '2026-02-10'), 3);
  assert.equal(CL.monthsSince('2025-11-10', '2026-02-09'), 2);
});

test('monthsSince: a future entryDate never goes negative', () => {
  assert.equal(CL.monthsSince('2026-08-01', '2026-07-05'), 0);
});

test('monthsSince: invalid / blank entryDate → null', () => {
  assert.equal(CL.monthsSince('', '2026-07-05'), null);
  assert.equal(CL.monthsSince('nonsense', '2026-07-05'), null);
  assert.equal(CL.monthsSince('2026-13-01', '2026-07-05'), null); // bad month
  assert.equal(CL.monthsSince('2026-01-40', '2026-07-05'), null); // bad day
  assert.equal(CL.monthsSince('07/05/2026', '2026-07-05'), null); // wrong format
  assert.equal(CL.monthsSince(null, '2026-07-05'), null);
});

test('monthsSince: invalid today → null', () => {
  assert.equal(CL.monthsSince('2026-01-01', ''), null);
});

// --- bucketOf ---------------------------------------------------------------
test('bucketOf: 3+ → 3, 2 → 2, 0/1 → 1, null/NaN → 0', () => {
  assert.equal(CL.bucketOf(0), 1);
  assert.equal(CL.bucketOf(1), 1);
  assert.equal(CL.bucketOf(2), 2);
  assert.equal(CL.bucketOf(3), 3);
  assert.equal(CL.bucketOf(10), 3);
  assert.equal(CL.bucketOf(null), 0);
  assert.equal(CL.bucketOf(NaN), 0);
});

// --- isValidOutcome / VALID_OUTCOMES ---------------------------------------
test('the outcome whitelist is exactly the four stable keys', () => {
  assert.deepEqual(CL.VALID_OUTCOMES, ['', 'continuing', 'to_outpatient', 'stopping']);
});

test('isValidOutcome accepts only whitelisted keys', () => {
  assert.equal(CL.isValidOutcome(''), true);
  assert.equal(CL.isValidOutcome('continuing'), true);
  assert.equal(CL.isValidOutcome('to_outpatient'), true);
  assert.equal(CL.isValidOutcome('stopping'), true);
  assert.equal(CL.isValidOutcome('ממשיך באשפוז'), false); // Hebrew label is never stored
  assert.equal(CL.isValidOutcome('done'), false);
  assert.equal(CL.isValidOutcome(null), false);
  assert.equal(CL.isValidOutcome(undefined), false);
});

// --- houseToOrigin ----------------------------------------------------------
test('houseToOrigin maps the dashboard houseIds to outpatient house_of_origin keys', () => {
  assert.equal(CL.houseToOrigin('arfoni'), 'efroni');
  assert.equal(CL.houseToOrigin('asher'), 'raanana');
  assert.equal(CL.houseToOrigin('pardes'), 'raanana_pardes');
  assert.equal(CL.houseToOrigin('ramot'), 'ramot');
  assert.equal(CL.houseToOrigin('rehab'), 'rehab');
  assert.equal(CL.houseToOrigin(' asher '), 'raanana'); // trims
});

test('houseToOrigin returns "" for unknown / blank ids', () => {
  assert.equal(CL.houseToOrigin('sde'), '');      // no outpatient equivalent
  assert.equal(CL.houseToOrigin('unknown'), '');
  assert.equal(CL.houseToOrigin(''), '');
  assert.equal(CL.houseToOrigin(null), '');
  assert.equal(CL.houseToOrigin(undefined), '');
});
