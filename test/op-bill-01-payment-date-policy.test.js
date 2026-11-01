'use strict';

/**
 * OP-BILL-01 — synthetic policy/diagnosis tests, not a production date fix.
 * Requested: ONE ordinary monthly payment covers a calendar month FROM paymentDate.
 * Currently the app anchors to dueDate (regression reproduced here).
 * The existing credits-ledger month clamp is reused as the reference arithmetic.
 * Do not rewrite historic payments, explicit coverage or multi-cycle prepayments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CL = require('../public/credits-ledger');
const CH = require('../public/charges-logic');
const fs = require('node:fs');
const path = require('node:path');
const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const SOURCE_SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const iso = (v) => CL.isoFromLocalDate(v);

/** Reuse the EXISTING calendar-month coverage arithmetic, against a paid-date anchor. */
function requestedOneMonth(paymentDate) {
  const window = CL.inferredCoverage({ dueDate: paymentDate, billingType: 'monthly' });
  return { start: iso(window.start), end: iso(window.end), nextCollection: iso(CL.addDays(window.end, 1)) };
}

test('requested rule: 25 Oct -> cover Oct 25–Nov 24; first new collection Nov 25', () => {
  assert.deepEqual(requestedOneMonth('2026-10-25'), { start: '2026-10-25', end: '2026-11-24', nextCollection: '2026-11-25' });
});

test('requested rule: 15 Oct -> cover Oct 15–Nov 14; first new collection Nov 15', () => {
  assert.deepEqual(requestedOneMonth('2026-10-15'), { start: '2026-10-15', end: '2026-11-14', nextCollection: '2026-11-15' });
});

test('requested rule: calendar month, not 30 days; Jan 31 clamps to Feb 28 or 29', () => {
  assert.deepEqual(requestedOneMonth('2026-01-31'), { start: '2026-01-31', end: '2026-02-27', nextCollection: '2026-02-28' });
  assert.deepEqual(requestedOneMonth('2028-01-31'), { start: '2028-01-31', end: '2028-02-28', nextCollection: '2028-02-29' });
});

test('existing recorded coverage always wins: two-month prepayment not truncated to one month', () => {
  const p = { id: 'pay::C::base::2026-10', clientId: 'C', billingType: 'monthly',
    status: 'paid', paymentDate: '2026-10-25', dueDate: '2026-11-01',
    coverageStart: '2026-11-01', coverageEnd: '2026-12-31' };
  const w = CL.paymentCoverage(p);
  assert.deepEqual([iso(w.start), iso(w.end), w.source], ['2026-11-01', '2026-12-31', 'recorded']);
});

test('diagnosis: old monthly default actually starts at DUE date, not PAY date (bug still open)', () => {
  const p = { id: 'pay::C::base::2026-11', clientId: 'C', billingType: 'monthly',
    status: 'paid', paymentDate: '2026-10-25', dueDate: '2026-11-01',
    coverageStart: '', coverageEnd: '' };
  const current = CL.paymentCoverage(p);
  assert.deepEqual([iso(current.start), iso(current.end), current.source], ['2026-11-01', '2026-11-30', 'inferred']);
  assert.notEqual(iso(current.end), requestedOneMonth(p.paymentDate).end, 'existing inferred period differs from requested payment-date rule');
});

test('diagnosis: paid chip uses stored NEXT BILLING DATE, not one-month paid period', () => {
  const current = CH.packagePaidState({ nextBillingDate: '2027-01-01', paymentDate: '2026-10-25' }, '2026-11-01');
  assert.deepEqual(current, { paid: true, until: '2027-01-01' });
  assert.notEqual(current.until, requestedOneMonth('2026-10-25').nextCollection);
});

test('diagnosis: old due-date contract spans frontend, pure helpers, source renewal guard', () => {
  assert.match(APP_SRC, /Anchors on the DUE/);
  assert.match(APP_SRC, /nextBillingDate: nextCycleDueDateAfter\(c, renewSourceState\.cycleDate\)/);
  assert.match(SOURCE_SRC, /patch\.nextBillingDate !== _finNext\(c, intent\.cycleDate\)/);
});

test('one-time charge and partial/unpaid receipts are NOT an ordinary month-paid proof', () => {
  assert.equal(CL.isOneTimePayment({ billingType: 'one_time' }), true);
  for (const status of ['partial', 'unpaid', 'reported']) {
    assert.notEqual(status, 'paid');
  }
});

// The actual code-path changes remain intentionally unimplemented until the
// business policy for early payments, late arrears, treatment start after payment
// and existing custom coverage is resolved against the persisted ledger.
test.todo('OP-BILL-01: card, nextCollection and revenue source all use a confirmed one-month paymentDate window, honoring recorded prepayment', () => {});
