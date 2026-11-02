'use strict';

/**
 * Payment-verify fix (2026-11-02).
 *
 * Bug: a patient set to «שולם» in עריכה (status changed, paid date unchanged)
 * was saved as paid with a future nextBillingDate but NO payment row, so the
 * card showed «נדרש אימות תשלום» — a plain label with no way to resolve it.
 *
 * Locked contracts:
 *   A. missingCyclePayment records exactly the CURRENT cycle's base row
 *      (due = one cycle before the anchor, amount = package amount, paid date =
 *      the stored paymentDate, never in the future) and returns null when the
 *      cycle is already confirmed or the package is not paid-up.
 *   B. The edit form writes that row when the status becomes «שולם» and the
 *      anchor is already ahead — without moving the anchor.
 *   C. The «נדרש אימות תשלום» chip is a confirm button for editors only.
 *
 * Fixture data only — no production names, phones or amounts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { fixture, settled, named, source } = require('../test-support/financial-ui-fixture.cjs');

const HELPERS = ['toNum', 'fmtDate', 'dayOfMonth', 'lastDayOfMonth', 'addMonth', 'monthKey', 'addDays',
  'paymentId', 'legacyBasePaymentId', 'paymentKindFromId', 'findPaymentById', 'basePaymentPaidOn',
  'clampedCycleIso', 'nextCycleDueDate', 'nextCycleDueDateAfter', 'currentMonthBaseDueDate',
  'prevCycleDueDateBefore', 'packagePaidState', 'paymentForClientOn', 'confirmedPackagePayment',
  'clientAmountDue', 'missingCyclePayment'];

function harness(payments = []) {
  const ctx = { state: { clients: [], payments }, CL: null, console };
  vm.createContext(ctx);
  for (const n of HELPERS) vm.runInContext(named(n), ctx);
  return ctx;
}

const STUCK = {
  id: 'fixture-client-9', name: 'Fixture patient', billingType: 'monthly', billingDay: 26,
  startDate: '2026-10-26', nextBillingDate: '2026-11-26', paymentDate: '2026-10-22',
  paymentStatus: 'paid', pricePerSession: 1234, status: 'פעיל'
};
const TODAY = '2026-11-02';

test('A: the stuck card yields the current cycle row, anchor untouched', () => {
  const ctx = harness();
  const c = { ...STUCK };
  const plan = ctx.missingCyclePayment(c, TODAY);
  assert.ok(plan);
  assert.equal(plan.row.id, 'pay::fixture-client-9::base::2026-10');
  assert.equal(plan.row.dueDate, '2026-10-26');
  assert.equal(plan.row.status, 'paid');
  assert.equal(plan.row.amountDue, 1234);
  assert.equal(plan.row.amountPaid, 1234);
  assert.equal(plan.row.paymentDate, '2026-10-22');
  assert.equal(plan.until, '2026-11-26');
  assert.equal(c.nextBillingDate, '2026-11-26', 'never moves the anchor');
});

test('A: nothing to record when the cycle is confirmed or the package is not paid-up', () => {
  const confirmed = { id: 'pay::fixture-client-9::base::2026-10', clientId: STUCK.id, billingType: 'monthly',
    dueDate: '2026-10-26', status: 'paid', amountDue: 1234, amountPaid: 1234, paymentDate: '2026-10-22' };
  assert.equal(harness([confirmed]).missingCyclePayment({ ...STUCK }, TODAY), null);
  assert.equal(harness().missingCyclePayment({ ...STUCK, nextBillingDate: '2026-10-26' }, TODAY), null, 'anchor past → normal unpaid flow');
  assert.equal(harness().missingCyclePayment({ ...STUCK, pricePerSession: 0 }, TODAY), null, 'no amount → no row');
});

test('A: a future paid date is clamped to today', () => {
  const plan = harness().missingCyclePayment({ ...STUCK, paymentDate: '2026-12-01' }, TODAY);
  assert.equal(plan.row.paymentDate, TODAY);
});

test('B: edit form — status set to «שולם» with an anchor already ahead records the cycle row', async () => {
  const f = fixture({ paymentStatus: 'paid', paymentDate: '2026-10-05' });
  // Fixture client: today 2026-10-18; anchor ahead (2026-11-01), status unpaid, no rows.
  Object.assign(f.client, { paymentStatus: 'unpaid', paymentDate: '2026-10-05', nextBillingDate: '2026-11-01' });
  for (const n of ['addDays', 'legacyBasePaymentId', 'paymentKindFromId', 'findPaymentById',
    'prevCycleDueDateBefore', 'paymentForClientOn', 'confirmedPackagePayment']) vm.runInContext(named(n), f.ctx);
  f.ctx.CL = null;
  f.submit('editForm'); await settled(); await settled();
  const pay = f.out.writes.filter((w) => w.kind === 'payment');
  assert.equal(pay.length, 1, 'exactly one payment write');
  assert.equal(pay[0].row.id, 'pay::fixture-client::base::2026-10');
  assert.equal(pay[0].row.status, 'paid');
  assert.equal(pay[0].row.paymentDate, '2026-10-05');
  assert.equal(f.client.nextBillingDate, '2026-11-01', 'anchor unchanged');
});

test('C: the review chip is a confirm button for editors only, wired to confirmCyclePayment', () => {
  assert.match(source, /state\.role === 'editor'\s*\n?\s*\? '<button type="button" class="chip chip-payment-review month-pay-btn" data-action="confirm-cycle-payment"/);
  assert.match(source, /\[data-action="confirm-cycle-payment"\]', card\);\s*\n\s*if \(verifyBtn\) verifyBtn\.addEventListener\('click', function \(\) \{ confirmCyclePayment\(c, verifyBtn\); \}\);/);
  const fn = named('confirmCyclePayment');
  assert.match(fn, /if \(state\.role !== 'editor'\) return;/);
  assert.match(fn, /if \(!confirm\(msg\)\) return;/, 'explicit confirmation before writing');
  assert.ok(fn.indexOf('persistPayment(r)') < fn.indexOf("toast('התשלום נרשם')"), 'success only after the write');
  assert.match(fn, /showFinancialSaveWarning/, 'failure is surfaced, never a false success');
});
