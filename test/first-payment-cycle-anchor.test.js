'use strict';

/**
 * First-payment cycle anchor (עוז קורסיה fix, 2026-11-09).
 *
 * Root cause of the live 25.12 billing-date bug: a new client's billingDay was
 * derived from startDate (dayOfMonth(startDate)) and a paid intake was anchored
 * on the startDate cycle — so a patient who pays on the 25th but starts on the
 * 1st got 1st-of-month cycles (25.10 payment → cycles 01.11 / 01.12 → anchor
 * 01.01) instead of the requested payment-date cycles (25.10 → 25.11 → 25.12).
 * OP-BILL-01's requested rule ("ONE ordinary monthly payment covers a calendar
 * month FROM paymentDate") now applies to the FIRST payment at every creation
 * path:
 *   A. arithmetic: paymentDateCoverage(payDate, payDate) anchors on payDate;
 *   B. עוז end-to-end: 25.10 → next 25.11; advance renewal of cycle 25.11 →
 *      next 25.12 (the exact figure Vered expects);
 *   C. source contracts: all three creation paths (direct intake, activation,
 *      agreement) anchor billingDay + first cycle on the payment date, and the
 *      pay-before-start refusal is gone (advance payment is the normal case);
 *   D. the one-off עוז repair re-keys his two rows + client safely (dry-run,
 *      exact-state verification, collision-free order, refuses on drift and on
 *      a second run), and is NOT routed through doGet/doPost.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CL = require('../public/credits-ledger');
const { sandbox } = require('../test-support/apps-script-sandbox');

const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const GS_SRC = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');

/* ============================ A. arithmetic ============================ */

test('A: paymentDateCoverage anchored on the payment date — 25.10 covers 25.10-24.11, next 25.11', () => {
  assert.deepEqual(CL.paymentDateCoverage('2026-10-25', '2026-10-25'),
    { start: '2026-10-25', end: '2026-11-24', next: '2026-11-25' });
});

test('A: calendar month with short-month clamp — 31.01 covers through 27.02/28.02', () => {
  assert.deepEqual(CL.paymentDateCoverage('2026-01-31', '2026-01-31'),
    { start: '2026-01-31', end: '2026-02-27', next: '2026-02-28' });
  assert.deepEqual(CL.paymentDateCoverage('2028-01-31', '2028-01-31'),
    { start: '2028-01-31', end: '2028-02-28', next: '2028-02-29' });
});

/* ======================= B. עוז end-to-end figures ====================== */

test('B: עוז — first payment 25.10 → collection 25.11; advance renewal of cycle 25.11 → collection 25.12', () => {
  const { ctx } = sandbox();
  // First payment defines the cycle.
  const first = ctx._finPaidDateCoverage('2026-10-25', '2026-10-25');
  assert.deepEqual(JSON.parse(JSON.stringify(first)),
    { start: '2026-10-25', end: '2026-11-24', next: '2026-11-25' });
  // Second month paid in advance on the same 25.10 (Oren's renewal): the due
  // cycle 25.11 is the anchor → the next collection is 2026-12-25, exactly
  // the figure Vered expects on the card.
  const second = ctx._finPaidDateCoverage('2026-10-25', '2026-11-25');
  assert.deepEqual(JSON.parse(JSON.stringify(second)),
    { start: '2026-11-25', end: '2026-12-24', next: '2026-12-25' });
});

/* ========================= C. source contracts ========================= */

test('C: direct intake + activation anchor the paid first cycle on the payment date itself', () => {
  const anchored = APP_SRC.match(/CL\.paymentDateCoverage\(payDate, payDate\)/g) || [];
  assert.equal(anchored.length, 2, 'both creation paths (direct intake + activation) anchor on payDate');
  assert.doesNotMatch(APP_SRC, /CL\.paymentDateCoverage\(payDate, startDate\)/,
    'no creation path anchors the paid first cycle on startDate any more');
});

test('C: billingDay of a new client follows the first payment day (startDate day only as fallback)', () => {
  const m = APP_SRC.match(/payDate && dayOfMonth\(payDate\)\) \|\|\s*\n?\s*dayOfMonth\(startDate\)/g) || [];
  assert.ok(m.length >= 2, 'activation and direct intake derive billingDay from payDate first');
});

test('C: the pay-before-start refusal is gone from the creation paths (advance payment is normal)', () => {
  assert.doesNotMatch(APP_SRC, /payDate < startDate/);
  assert.doesNotMatch(APP_SRC, /תשלום לפני תחילת טיפול/);
  // a future payment date is still refused
  assert.match(APP_SRC, /payDate > today\(\)/);
});

test('C: the agreement payment sets the next collection to payDate + 1 month, never the startDate cycle', () => {
  assert.match(APP_SRC, /lead\.nextBillingDate = addMonth\(agPayDate\)/);
  assert.doesNotMatch(APP_SRC, /nextCycleDueDateAfter\(lead, agPayDate\)/);
});

test('C: the paid intake row records its covered window explicitly', () => {
  assert.match(APP_SRC, /intakePayment\.coverageStart = activateCoverage\.start/);
  assert.match(APP_SRC, /directIntakePayment\.coverageStart = intakeCoverage\.start/);
});

/* ========================= D. the עוז one-off repair ==================== */

const OZ_ID = 'id_mvxnplnn_t6w0k6';
function ozClient(over) {
  return Object.assign({
    id: OZ_ID, name: 'עוז קורסיה', serviceType: 'מעקב פסיכיאטרי', location: 'רמות השבים',
    sessionsPerWeek: '{"פרטני":2}', pricePerSession: 15000, startDate: '2026-11-01',
    status: 'פעיל', billingType: 'monthly', billingDay: '1', phone: '0536218819',
    paymentStatus: 'paid', paymentDate: '2026-10-25', nextBillingDate: '2027-01-01'
  }, over);
}
function ozPayments() {
  return [
    { id: 'pay::' + OZ_ID + '::base::2026-11', clientId: OZ_ID, clientName: 'עוז קורסיה',
      billingType: 'monthly', dueDate: '2026-11-01', amountDue: 15000, amountPaid: 15000,
      status: 'paid', paymentDate: '2026-10-25', coverageStart: '2026-11-01', coverageEnd: '2026-11-30' },
    { id: 'pay::' + OZ_ID + '::base::2026-12', clientId: OZ_ID, clientName: 'עוז קורסיה',
      billingType: 'monthly', dueDate: '2026-12-01', amountDue: 15000, amountPaid: 15000,
      status: 'paid', paymentDate: '2026-10-25', coverageStart: '2026-12-01', coverageEnd: '2026-12-31' }
  ];
}

test('D: dry-run verifies and plans, writes NOTHING', () => {
  const h = sandbox([], [ozClient()]);
  h.seed('Payments', h.ctx.PAYMENTS_HEADERS, ozPayments());
  const res = JSON.parse(JSON.stringify(h.ctx._repairOzBillingCycle('0')));
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.equal(res.applied, 0);
  assert.equal(res.plan.length, 3);
  // nothing changed
  assert.equal(h.rows('Clients')[0].nextBillingDate, '2027-01-01');
  assert.equal(h.rows('Payments')[0].id, 'pay::' + OZ_ID + '::base::2026-11');
});

test('D: apply re-keys both rows to the 25th cycles and fixes the client; a second run refuses', () => {
  const h = sandbox([], [ozClient()]);
  h.seed('Payments', h.ctx.PAYMENTS_HEADERS, ozPayments());
  const res = JSON.parse(JSON.stringify(h.ctx._repairOzBillingCycle('1')));
  assert.equal(res.ok, true);
  assert.equal(res.applied, 3);
  const c = h.rows('Clients')[0];
  assert.equal(String(c.billingDay), '25');
  assert.equal(c.nextBillingDate, '2026-12-25');
  const p = h.rows('Payments');
  assert.deepEqual(
    p.map((r) => [r.id, r.dueDate, r.coverageStart, r.coverageEnd, r.status, r.paymentDate]),
    [
      ['pay::' + OZ_ID + '::base::2026-10', '2026-10-25', '2026-10-25', '2026-11-24', 'paid', '2026-10-25'],
      ['pay::' + OZ_ID + '::base::2026-11', '2026-11-25', '2026-11-25', '2026-12-24', 'paid', '2026-10-25']
    ]
  );
  // the December month key is now FREE: the 25.12 renewal (cycle 2026-12-25,
  // id base::2026-12) has no colliding row.
  assert.ok(!p.some((r) => r.id === 'pay::' + OZ_ID + '::base::2026-12'));
  // idempotence: a second apply finds none of the expected state and refuses.
  const again = JSON.parse(JSON.stringify(h.ctx._repairOzBillingCycle('1')));
  assert.equal(again.ok, false);
  assert.equal(again.error, 'state_mismatch');
  assert.equal(h.rows('Clients')[0].nextBillingDate, '2026-12-25', 'refusal writes nothing');
});

test('D: any drift from the expected live state refuses with a report and writes nothing', () => {
  const h = sandbox([], [ozClient({ nextBillingDate: '2026-12-01' })]); // already different
  h.seed('Payments', h.ctx.PAYMENTS_HEADERS, ozPayments());
  const res = JSON.parse(JSON.stringify(h.ctx._repairOzBillingCycle('1')));
  assert.equal(res.ok, false);
  assert.equal(res.error, 'state_mismatch');
  assert.ok(res.mismatches.some((m) => m.indexOf('client.nextBillingDate') === 0));
  assert.equal(h.rows('Payments')[0].dueDate, '2026-11-01', 'nothing written');
});

test('D: the repair also refuses when the TARGET id already exists (no silent duplicate)', () => {
  const h = sandbox([], [ozClient()]);
  const extra = { id: 'pay::' + OZ_ID + '::base::2026-10', clientId: OZ_ID, billingType: 'monthly',
    dueDate: '2026-10-25', amountDue: 1, amountPaid: 1, status: 'paid', paymentDate: '2026-10-25' };
  h.seed('Payments', h.ctx.PAYMENTS_HEADERS, [...ozPayments(), extra]);
  const res = JSON.parse(JSON.stringify(h.ctx._repairOzBillingCycle('1')));
  assert.equal(res.ok, false);
  assert.ok(res.mismatches.some((m) => m.indexOf('target id already exists') === 0));
});

test('D: the repair is editor-run only — never routed through doGet/doPost', () => {
  // The only occurrences are the function definitions and their editor helpers;
  // no `action === '...'` route dispatches to it.
  assert.doesNotMatch(GS_SRC, /action === '.*[Rr]epairOz/);
  const h = sandbox([], [ozClient()]);
  const viaPost = h.post({ action: 'repairOzBillingCycle', apply: '1' });
  assert.notEqual(viaPost.ok, true, 'unknown action never applies the repair');
  assert.equal(h.rows('Clients')[0].nextBillingDate, '2027-01-01');
});
