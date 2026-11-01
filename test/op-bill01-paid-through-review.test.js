'use strict';

/** OP-BILL-01 read-only card projection — payment/coverage evidence only.
 * All fixtures are synthetic. This suite MUST NOT call live APIs or edit Sheets.
 * Tests a real exported module, not a duplicated implementation.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CL = require('../public/credits-ledger');
const MODEL = CL.paidThroughReview;
const now = '2026-11-01';

const client = (next, id = 'P') => ({ id, nextBillingDate: next, startDate: '2026-08-23', billingDay: 23 });
function paid(id, date, due, coverageStart = '', coverageEnd = '', extra = {}) {
  return Object.assign({
    id: 'pay::P::base::' + id, clientId: 'P', billingType: 'monthly',
    amountDue: 13000, amountPaid: 13000, status: 'paid',
    paymentDate: date, dueDate: due, coverageStart, coverageEnd
  }, extra);
}
function inspect(c, rows, today = now) { return MODEL(c, rows, today); }
const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('A: 25 Oct single payment on Nov 1 legacy cycle is UNCERTAIN, with proposed collection Nov 25, not Jan 1', () => {
  const p = paid('2026-11', '2026-10-25', '2026-11-01', '2026-11-01', '2026-11-30');
  const r = inspect(client('2027-01-01'), [p]);
  assert.equal(r.state, 'review');
  assert.equal(r.reason, 'old_cycle_or_unverified_amount');
  assert.equal(r.candidateEnd, '2026-11-24');
  assert.equal(r.candidateNext, '2026-11-25');
  assert.equal(r.registeredNext, '2027-01-01');
  assert.equal(r.paidDate, '2026-10-25');
});

test('B: 15 Oct payment for old 23rd-day cycle is UNCERTAIN; proposed collection Nov 15', () => {
  const p = paid('2026-10', '2026-10-15', '2026-10-23', '2026-10-23', '2026-11-22');
  const r = inspect(client('2026-11-23'), [p]);
  assert.equal(r.state, 'review');
  assert.equal(r.candidateNext, '2026-11-15');
});

test('Exact payment-date one-month coverage is confirmed, inclusive through Nov 14, next collection Nov 15', () => {
  const p = paid('2026-10', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14');
  const r = inspect(client('2026-11-15'), [p]);
  assert.deepEqual(r, {
    state: 'confirmed', confirmedEnd: '2026-11-14', nextCollection: '2026-11-15',
    registeredNext: '2026-11-15', paidDate: '2026-10-15'
  });
});

test('Recorded two-month advance WINS over suggested one-month-from-paid-date', () => {
  const p = paid('2026-11', '2026-10-25', '2026-11-01', '2026-11-01', '2026-12-31');
  const r = inspect(client('2027-01-01'), [p]);
  assert.equal(r.state, 'confirmed');
  assert.equal(r.confirmedEnd, '2026-12-31');
  assert.equal(r.nextCollection, '2027-01-01');
});

test('Explicit verified coverage disagrees with stored nextBillingDate: show actual covered end, flag due-date mismatch', () => {
  const p = paid('2026-10', '2026-10-15', '2026-10-23', '2026-10-15', '2026-11-14');
  const r = inspect(client('2026-11-23'), [p]);
  assert.equal(r.state, 'review');
  assert.equal(r.reason, 'next_date_conflict');
  assert.equal(r.confirmedEnd, '2026-11-14');
  assert.equal(r.nextCollection, '2026-11-15');
  assert.equal(r.registeredNext, '2026-11-23');
});

test('Contiguous verified payments extend coverage with no phantom new receipt', () => {
  const rows = [
    paid('2026-10', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14'),
    paid('2026-11', '2026-10-31', '2026-11-20', '2026-11-15', '2026-12-14')
  ];
  const r = inspect(client('2026-12-15'), rows);
  assert.equal(r.state, 'confirmed');
  assert.equal(r.confirmedEnd, '2026-12-14');
  assert.equal(r.nextCollection, '2026-12-15');
});

test('Unpaid / partial / one-time additional-charge / another client never prove monthly coverage', () => {
  const rows = [
    paid('2026-10', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14', { status: 'partial', amountPaid: 5000 }),
    paid('2026-11', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14', { status: 'unpaid', amountPaid: 0 }),
    paid('2026-12', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14', { id: 'pay::P::chg-extra::2026-10' }),
    paid('2026-10', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14', { clientId: 'other' })
  ];
  const r = inspect(client('2026-11-15'), rows);
  assert.equal(r.state, 'review');
  assert.equal(r.reason, 'future_anchor_without_receipt');
  assert.ok(!r.confirmedEnd);
});

test('Missing or invalid paid date is not silently accepted as a current month, even if recorded due-date coverage looks paid', () => {
  const p = paid('2026-11', '', '2026-11-01', '2026-11-01', '2026-11-30');
  const r = inspect(client('2026-12-01'), [p]);
  assert.equal(r.state, 'review', 'a missing actual payment date cannot prove a completed receipt');
  assert.equal(r.reason, 'old_cycle_or_unverified_amount');
});

test('Multi-cycle gap is not bridged by adding months to the next collection date', () => {
  const p = paid('2026-11', '2026-10-29', '2026-11-15', '2026-11-20', '2026-12-19');
  const r = inspect(client('2026-12-20'), [p], '2026-11-01');
  assert.equal(r.state, 'review');
  assert.equal(r.reason, 'coverage_gap_or_future_advance');
});

test('Duplicated coverage with two paid IDs is not silently considered two months', () => {
  const p1 = paid('2026-10', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14');
  const p2 = paid('2026-11', '2026-10-16', '2026-10-23', '2026-10-15', '2026-11-14');
  const r = inspect(client('2026-11-15'), [p1, p2]);
  assert.equal(r.state, 'review');
  assert.equal(r.reason, 'duplicate_coverage');
});

test('No current coverage is not positive confirmation just because the client has nextBillingDate', () => {
  assert.equal(inspect(client('2027-01-01'), []).state, 'review');
  assert.equal(inspect(client('2026-10-20'), []).state, 'none');
});

test('Source rows and client are not mutated by the inspection', () => {
  const c = Object.freeze(client('2026-11-15'));
  const p = Object.freeze(paid('2026-10', '2026-10-15', '2026-10-15', '2026-10-15', '2026-11-14'));
  const rows = Object.freeze([p]);
  inspect(c, rows);
  assert.equal(c.nextBillingDate, '2026-11-15');
  assert.equal(p.coverageEnd, '2026-11-14');
});

test('Browser uses canonical CL.paidThroughReview; uncertain rows do not offer dangerous quick toggle', () => {
  const src = ui.slice(ui.indexOf('var paidReview = CL &&'), ui.indexOf('var startRow = c.startDate'));
  assert.match(src, /CL\.paidThroughReview\(c, state\.payments, today\(\)\)/);
  assert.match(src, /state === 'review'/);
  assert.match(src, /גבייה הבאה לפי כיסוי מאומת/);
  assert.doesNotMatch(src, /data-action="mark-month-paid"|data-action="mark-month-unpaid"/);
  assert.match(src, /נדרש בירור תקופת תשלום/);
});
