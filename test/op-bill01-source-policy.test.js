'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const CL = require('../public/credits-ledger');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { fixture } = require('../test-support/renewal-journal-fixture.cjs');

test('new monthly coverage: browser and ACTUAL Apps Script functions agree for month ends', () => {
  const gs = sandbox().ctx;
  const cases = [
    ['2026-10-25', '2026-11-24', '2026-11-25'],
    ['2026-10-15', '2026-11-14', '2026-11-15'],
    ['2026-01-31', '2026-02-27', '2026-02-28'],
    ['2028-01-31', '2028-02-28', '2028-02-29'],
    ['2026-12-31', '2027-01-30', '2027-01-31']
  ];
  for (const [start, end, next] of cases) {
    const expected = {start, end, next};
    assert.deepEqual(CL.paymentDateCoverage(start), expected, start);
    const source = gs._finPaidDateCoverage(start);
    assert.deepEqual(JSON.parse(JSON.stringify(source)), expected, start);
  }
});

test('invalid payment dates fail closed in browser and Apps Script calculations', () => {
  const gs = sandbox().ctx;
  for (const date of ['', '2026-02-30', '2026-13-01', '2026-01-00', 'not-a-date', '2026-02-25T00:00:00Z']) {
    assert.equal(CL.paymentDateCoverage(date), null, date);
    assert.equal(gs._finPaidDateCoverage(date), null, date);
  }
});

test('opt-in stamps a NEW verified monthly receipt, but preserves historical due-date default', () => {
  const row = { id: 'pay::P::base::2026-10', clientId: 'P', status: 'paid',
    billingType: 'monthly', paymentDate: '2026-10-15',
    dueDate: '2026-10-23', amountDue: 500, amountPaid: 500 };
  const source = CL.withDefaultCoverage(row);
  assert.equal(source.coverageStart, '2026-10-23');
  assert.equal(source.coverageEnd, '2026-11-22');
  const fresh = CL.withDefaultCoverage(row, { newPaidMonthly: true });
  assert.equal(fresh.coverageStart, '2026-10-15');
  assert.equal(fresh.coverageEnd, '2026-11-14');
  assert.equal(row.coverageStart, undefined, 'no mutation of source object');
  assert.equal(CL.withDefaultCoverage({ ...row, status:'partial', amountPaid: 100 },
    { newPaidMonthly:true }).coverageStart, '2026-10-23');
});

test('actual source rejects a new renewal using the legacy due-date window', () => {
  const f = fixture();
  f.request.patch.nextBillingDate = '2026-03-31';
  f.request.payment.coverageStart = '2026-02-28';
  f.request.payment.coverageEnd = '2026-03-27';
  const before = JSON.stringify(f.sb.rows('Clients'));
  const result = f.reserve();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'renewal_period_changed');
  assert.equal(JSON.stringify(f.sb.rows('Clients')), before);
  assert.equal(f.sb.rows('FinancialOps').length, 0);
  assert.equal(f.sb.rows('Payments').length, 0);
});

test('source rejects unverified NEW monthly receipts under canonical and legacy base IDs', () => {
  for (const id of ['pay::P::base::2026-10', 'pay::P::2026-10', 'payment::P::2026-10']) {
    const sb = sandbox([], [{ id: 'P', name: 'Synthetic', startDate: '2026-10-01',
      status: 'פעיל', billingDay: 1, nextBillingDate: '2026-10-01' }]);
    const row = { id, clientId: 'P', billingType: 'monthly', dueDate: '2026-10-01',
      amountDue: 500, amountPaid: 500, status: 'paid', paymentDate: '2026-10-16',
      coverageStart: '', coverageEnd: '' };
    const denied = sb.post({ action: 'savePayment', payment: row });
    assert.equal(denied.ok, false, id);
    assert.equal(denied.error, 'invalid_new_monthly_receipt', id);
    assert.equal(sb.rows('Payments').length, 0, id);
  }
});

test('actual source accepts a verified new renewal exactly once, without a duplicate payment', () => {
  const f = fixture();
  assert.equal(f.reserve().ok, true);
  assert.equal(f.reserve().operation.state, 'prepared');
  assert.equal(f.apply().operation.state, 'done');
  assert.equal(f.apply().operation.state, 'done');
  assert.equal(f.sb.rows('Clients')[0].nextBillingDate, '2026-03-25');
  assert.equal(f.sb.rows('Payments').length, 1);
  assert.equal(f.sb.rows('Payments')[0].coverageEnd, '2026-03-24');
});

test('actual source rejects future-paid default and amount mismatch with no journal write', () => {
  const f = fixture();
  f.request.patch.paymentDate = f.request.payment.paymentDate = '2027-01-31';
  f.request.patch.nextBillingDate = '2027-02-28';
  f.request.payment.coverageStart = '2027-01-31';
  f.request.payment.coverageEnd = '2027-02-27';
  assert.equal(f.reserve().ok, false);
  assert.equal(f.sb.rows('FinancialOps').length, 0);

  const g = fixture();
  g.request.payment.amountPaid = 100;
  assert.equal(g.reserve().ok, false);
  assert.equal(g.sb.rows('FinancialOps').length, 0);
});
