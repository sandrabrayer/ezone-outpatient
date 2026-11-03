'use strict';

/** OP-BILL-01 review fix B1 on PR #162.
 *  Coverage starts on max(paymentDate, cycleDate), so an early payment's next
 *  collection never lands in the same month key as the cycle it settled (which
 *  made the following renewal impossible: renewal_payment_exists forever).
 *  All fixtures are synthetic; the Apps Script source runs in the sandbox. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const CL = require('../public/credits-ledger');
const { sandbox } = require('../test-support/apps-script-sandbox');

const client = { id: 'C1', name: 'Synthetic', phone: '0500000001', status: 'פעיל', serviceType: 'פרטני',
  sessionsPerWeek: '{"פרטני":1}', billingDay: 1, startDate: '2026-09-01', nextBillingDate: '2026-11-01',
  pricePerSession: 500, paymentDate: '2026-10-01' };

// Synthetic clock: the fixtures' payment dates must not be "in the future".
function mk(today = '2026-12-20') {
  const sb = sandbox([], [{ ...client }]);
  sb.ctx._todayISODate = () => today;
  return sb;
}

function renewal(sb, opId, paidDate, extra = {}) {
  const st = sb.post({ action: 'getRenewalState', clientId: client.id });
  assert.equal(st.ok, true, JSON.stringify(st));
  const cycle = st.cycleDate;
  const win = CL.paymentDateCoverage(paidDate, cycle);
  const request = { action: 'reserveRenewal', opId, clientId: client.id, snapshot: st.snapshot, cycleDate: cycle,
    patch: { pricePerSession: 500, paymentDate: paidDate, nextBillingDate: win.next },
    payment: { id: 'pay::C1::base::' + cycle.slice(0, 7), clientId: client.id, clientName: client.name,
      billingType: 'monthly', dueDate: cycle, amountDue: 500, amountPaid: 500, status: 'paid',
      paymentDate: paidDate, coverageStart: win.start, coverageEnd: win.end, notes: '' }, ...extra };
  return { cycle, win, request, reserve: () => sb.post(request), apply: () => sb.post({ action: 'applyRenewal', opId }) };
}

test('B1 rule: browser and Apps Script agree — early = advance from the due cycle, late = month from payment, clamp kept', () => {
  const gs = sandbox().ctx;
  const cases = [
    // [paymentDate, cycleDate, start, end, next]
    ['2026-10-25', '2026-10-25', '2026-10-25', '2026-11-24', '2026-11-25'], // Sandra's example
    ['2026-10-28', '2026-11-01', '2026-11-01', '2026-11-30', '2026-12-01'], // early: advance from due
    ['2026-11-10', '2026-11-01', '2026-11-10', '2026-12-09', '2026-12-10'], // late: from payment
    ['2026-10-25', '', '2026-10-25', '2026-11-24', '2026-11-25'],           // no cycle: payment date
    ['2026-01-15', '2026-01-31', '2026-01-31', '2026-02-27', '2026-02-28'], // clamp on the due cycle
    ['2028-01-31', '2028-01-15', '2028-01-31', '2028-02-28', '2028-02-29'], // leap clamp on late payment
    ['2026-12-31', '2026-12-05', '2026-12-31', '2027-01-30', '2027-01-31']
  ];
  for (const [paid, cycle, start, end, next] of cases) {
    const expected = { start, end, next };
    assert.deepEqual(CL.paymentDateCoverage(paid, cycle), expected, paid + '/' + cycle);
    assert.deepEqual(JSON.parse(JSON.stringify(gs._finPaidDateCoverage(paid, cycle))), expected, paid + '/' + cycle);
    // The start month key is always strictly before the next collection's key.
    assert.ok(next.slice(0, 7) > start.slice(0, 7), 'next collection moves to a later month key');
  }
  // An invalid cycle never breaks a valid payment date (falls back), an
  // invalid payment date still fails closed.
  assert.deepEqual(CL.paymentDateCoverage('2026-10-25', '2026-02-30'), { start: '2026-10-25', end: '2026-11-24', next: '2026-11-25' });
  assert.equal(CL.paymentDateCoverage('2026-02-30', '2026-03-01'), null);
  assert.equal(gs._finPaidDateCoverage('2026-02-30', '2026-03-01'), null);
  assert.equal(gs._finPaidDateCoverage('2026-10-25T00:00:00Z', '2026-11-01'), null);
});

test('B1: two consecutive renewals succeed when the first payment is in an earlier month than its cycle', () => {
  const sb = mk();
  const first = renewal(sb, 'renew-b1-first-000001', '2026-10-28');
  assert.equal(first.cycle, '2026-11-01');
  assert.equal(first.reserve().ok, true);
  assert.equal(first.apply().operation.state, 'done');
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2026-12-01');
  assert.equal(sb.post({ action: 'acknowledgeRenewal', opId: first.request.opId }).ok, true);

  const second = renewal(sb, 'renew-b1-second-00001', '2026-12-03');
  assert.equal(second.cycle, '2026-12-01');
  const reserved = second.reserve();
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  assert.equal(second.apply().operation.state, 'done');
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2027-01-03');
  const ids = sb.rows('Payments').map((p) => p.id + '|' + p.coverageStart + '|' + p.coverageEnd);
  assert.deepEqual(ids, ['pay::C1::base::2026-11|2026-11-01|2026-11-30', 'pay::C1::base::2026-12|2026-12-03|2027-01-02']);
});

test('B1: the source refuses a new renewal that still uses the pure paid-date window for an early payment', () => {
  const sb = mk();
  const r = renewal(sb, 'renew-b1-oldwin-00001', '2026-10-28');
  r.request.payment.coverageStart = '2026-10-28';
  r.request.payment.coverageEnd = '2026-11-27';
  r.request.patch.nextBillingDate = '2026-11-28';
  assert.equal(r.reserve().error, 'renewal_period_changed');
  assert.equal(sb.rows('FinancialOps').length, 0);
});

test('B1: an early payment is accepted even though its covered window starts after today', () => {
  const sb = sandbox([], [{ ...client }]);
  sb.ctx._todayISODate = () => '2026-10-28';
  const r = renewal(sb, 'renew-b1-early-000001', '2026-10-28');
  assert.equal(r.win.start, '2026-11-01');
  assert.equal(r.reserve().ok, true);
  assert.equal(r.apply().operation.state, 'done');
  // A payment dated in the future is still refused.
  const sb2 = sandbox([], [{ ...client }]);
  sb2.ctx._todayISODate = () => '2026-10-27';
  assert.equal(renewal(sb2, 'renew-b1-future-00001', '2026-10-28').reserve().error, 'invalid_renewal_payment');
});
