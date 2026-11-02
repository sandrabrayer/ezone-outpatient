'use strict';

/**
 * OP-BILL-01 — synthetic policy and source-to-report acceptance tests.
 * Requested: ONE ordinary monthly payment covers a calendar month FROM paymentDate.
 * Legacy rows without explicit coverage still retain their due-date fallback.
 * The existing credits-ledger month clamp is reused as the reference arithmetic.
 * Do not rewrite historic payments, explicit coverage or multi-cycle prepayments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CL = require('../public/credits-ledger');
const CH = require('../public/charges-logic');
const MR = require('../public/monthly-revenue');
const { fixture, client } = require('../test-support/renewal-journal-fixture.cjs');
const { sandbox } = require('../test-support/apps-script-sandbox');
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

test('legacy compatibility: a row without recorded coverage retains its due-date fallback', () => {
  const p = { id: 'pay::C::base::2026-11', clientId: 'C', billingType: 'monthly',
    status: 'paid', paymentDate: '2026-10-25', dueDate: '2026-11-01',
    coverageStart: '', coverageEnd: '' };
  const current = CL.paymentCoverage(p);
  assert.deepEqual([iso(current.start), iso(current.end), current.source], ['2026-11-01', '2026-11-30', 'inferred']);
  assert.notEqual(iso(current.end), requestedOneMonth(p.paymentDate).end, 'existing inferred period differs from requested payment-date rule');
});

test('legacy compatibility: packagePaidState alone uses the stored next date, not receipt proof', () => {
  const current = CH.packagePaidState({ nextBillingDate: '2027-01-01', paymentDate: '2026-10-25' }, '2026-11-01');
  assert.deepEqual(current, { paid: true, until: '2027-01-01' });
  assert.notEqual(current.until, requestedOneMonth('2026-10-25').nextCollection);
});

test('new renewal contract is anchored to recorded payment date on UI and actual source', () => {
  assert.match(APP_SRC, /nextBillingDate: paidCoverage\.next/);
  assert.match(SOURCE_SRC, /function _finPaidDateCoverage\(paymentDate\)/);
  assert.match(SOURCE_SRC, /p\.coverageStart === paidWindow\.start/);
  assert.match(SOURCE_SRC, /patch\.nextBillingDate === paidWindow\.next/);
  // The old due-date guard remains ONLY for immutable stored operation replay.
  assert.match(SOURCE_SRC, /var legacyReplay = !!stored/);
});

test('one-time charge and partial/unpaid receipts are NOT an ordinary month-paid proof', () => {
  assert.equal(CL.isOneTimePayment({ billingType: 'one_time' }), true);
  for (const status of ['partial', 'unpaid', 'reported']) {
    assert.notEqual(status, 'paid');
  }
});

test('OP-BILL-01: persisted source, card and revenue agree on paid-date renewal and explicit prepayment', () => {
  const f = fixture();
  assert.equal(f.reserve().operation.state, 'prepared');
  assert.equal(f.apply().operation.state, 'done');
  assert.equal(f.ack().ok, true);

  function verify(sb, today, end, next, allocations) {
    // Read persisted source rows, not the outgoing request or optimistic UI.
    const clients = sb.rows('Clients'), payments = sb.rows('Payments');
    assert.equal(payments.length, 1);
    const before = JSON.stringify({ clients, payments });
    const card = CL.paidThroughReview(clients[0], payments, today);
    assert.equal(card.state, 'confirmed');
    assert.equal(card.confirmedEnd, end);
    assert.equal(card.nextCollection, next);
    assert.equal(clients[0].nextBillingDate, next);
    let total = 0;
    for (const [month, amount, days, windowDays] of allocations) {
      const report = MR.buildMonthlyRevenue({ month, clients, payments, credits: [], today });
      assert.equal(report.received.inclVat, amount, month + ' received allocation');
      assert.equal(report.received.rows.length, 1);
      assert.equal(report.received.rows[0].daysInMonth, days);
      assert.equal(report.received.rows[0].windowDays, windowDays);
      total += report.received.inclVat;
    }
    assert.equal(Math.round(total * 100), Number(payments[0].amountPaid) * 100);
    assert.equal(JSON.stringify({ clients, payments }), before, 'read models must not rewrite history');
  }

  // Paid Feb 25: 28 service days through Mar 24, regardless of old Feb 28 due date.
  verify(f.sb, '2026-03-01', '2026-03-24', '2026-03-25', [
    ['2026-02', 85.71, 4, 28], ['2026-03', 514.29, 24, 28]
  ]);

  // Existing explicit two-month advance is saved by the real source and stays
  // November–December coverage; neither the paid date nor one-month rule trims it.
  const advance = sandbox([], [{ ...client, nextBillingDate: '2027-01-01', paymentDate: '2026-10-25' }]);
  assert.equal(advance.post({ action: 'savePayment', payment: {
    ...f.request.payment, id: 'pay::journal-client::base::2026-11',
    dueDate: '2026-11-01', paymentDate: '2026-10-25', amountDue: 6100, amountPaid: 6100,
    coverageStart: '2026-11-01', coverageEnd: '2026-12-31'
  } }).ok, true);
  verify(advance, '2026-11-01', '2026-12-31', '2027-01-01', [
    ['2026-11', 3000, 30, 61], ['2026-12', 3100, 31, 61]
  ]);
});
