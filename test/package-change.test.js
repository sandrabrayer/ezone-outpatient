/**
 * Tests for the שינוי חבילה (change package) billing re-anchor.
 *
 * Run with:  npm test     (Node's built-in test runner, Node >= 18)
 *
 * Covers the pure nextRenewalDueDate helper in public/charges-logic.js. The
 * browser (public/app.js) and public/vered-alerts.js (cycleEndDate) carry inline
 * copies of the SAME anchor precedence; any change to the rule must update all of
 * them. The new precedence is:
 *
 *   anchor = packageChangeDate || paymentDate || startDate
 *
 * so a שינוי חבילה re-anchors גבייה הבאה to packageChangeDate + 1 month, taking
 * precedence over both paymentDate and startDate. paymentDate is never touched.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRenewalDueDate } = require('../public/charges-logic');

test('packageChangeDate takes precedence over paymentDate and startDate', () => {
  // All three present: packageChangeDate wins.
  assert.equal(
    nextRenewalDueDate({
      id: 'abc',
      packageChangeDate: '2026-03-20',
      paymentDate: '2026-05-15',
      startDate: '2026-01-10'
    }),
    '2026-04-20'
  );
});

test('packageChangeDate wins even when it is earlier than paymentDate', () => {
  // The re-anchor is unconditional precedence, NOT a max() of the dates — a
  // package change re-bases the cycle on the change date regardless of order.
  assert.equal(
    nextRenewalDueDate({
      id: 'abc',
      packageChangeDate: '2026-02-01',
      paymentDate: '2026-09-15'
    }),
    '2026-03-01'
  );
});

test('falls back to paymentDate when packageChangeDate is absent/blank', () => {
  assert.equal(
    nextRenewalDueDate({ id: 'abc', paymentDate: '2026-05-15', startDate: '2026-01-10' }),
    '2026-06-15'
  );
  // Explicit empty string is treated as absent.
  assert.equal(
    nextRenewalDueDate({ id: 'abc', packageChangeDate: '', paymentDate: '2026-05-15' }),
    '2026-06-15'
  );
});

test('falls back to startDate when neither packageChangeDate nor paymentDate is set', () => {
  assert.equal(
    nextRenewalDueDate({ id: 'abc', startDate: '2026-01-10' }),
    '2026-02-10'
  );
});

test('packageChangeDate re-anchor honors the short-month clamp (Jan 31 -> Feb 28)', () => {
  assert.equal(
    nextRenewalDueDate({ id: 'abc', packageChangeDate: '2026-01-31', paymentDate: '2026-05-15' }),
    '2026-02-28'
  );
});

test('no anchor at all -> empty string', () => {
  assert.equal(nextRenewalDueDate({ id: 'abc' }), '');
});
