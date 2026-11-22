'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CL = require('../public/credits-ledger');
const Charges = require('../public/charges-logic');
const Revenue = require('../public/monthly-revenue');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { failWrite } = require('../test-support/renewal-journal-fixture.cjs');

const CLIENT = { id: 'ordinary-fixture', name: 'Synthetic', status: 'פעיל', serviceType: 'פרטני',
  sessionsPerWeek: '{"פרטני":1}', pricePerSession: 600, startDate: '2026-09-01', billingDay: 1,
  nextBillingDate: '2026-11-01', paymentDate: '2026-09-30' };
function setup(patch = {}, now = '2026-12-31') {
  const sb = sandbox([], [{ ...CLIENT, ...patch }]); sb.ctx._todayISODate = () => now; return sb;
}
function request(sb, paid, extra = {}) {
  const state = sb.post({ action: 'getRenewalState', clientId: CLIENT.id });
  assert.equal(state.ok, true, JSON.stringify(state)); assert.equal(state.coveragePolicy, 'payment-date-v2');
  const period = CL.paymentDateCoverage(paid);
  return { action: 'reserveRenewal', opId: 'ordinary-operation-0001', clientId: CLIENT.id,
    snapshot: state.snapshot, cycleDate: state.cycleDate, coverageIntent: 'ordinary',
    patch: { pricePerSession: 600, paymentDate: paid, nextBillingDate: period.next },
    payment: { ...Charges.basePaymentPaidOn(CLIENT, state.cycleDate, 600, paid, ''), id: state.paymentId,
      coverageStart: period.start, coverageEnd: period.end }, ...extra };
}
function complete(sb, req) {
  const reserved = sb.post(req); assert.equal(reserved.ok, true, JSON.stringify(reserved));
  assert.equal(sb.post({ action: 'applyRenewal', opId: req.opId }).operation.state, 'done');
  assert.equal(sb.post({ action: 'acknowledgeRenewal', opId: req.opId }).operation.state, 'acknowledged');
}

for (const [paid, due, end, next] of [
  ['2026-10-25', '2026-11-01', '2026-11-24', '2026-11-25'],
  ['2026-10-15', '2026-10-23', '2026-11-14', '2026-11-15'],
  ['2026-01-31', '2026-02-10', '2026-02-27', '2026-02-28'],
  ['2028-01-31', '2028-02-10', '2028-02-28', '2028-02-29'],
  ['2026-12-31', '2026-12-01', '2027-01-30', '2027-01-31'],
]) test(`ordinary ${paid}: source, persisted coverage, card and next collection agree`, () => {
  const sb = setup({ nextBillingDate: due, paymentDate: '' }, paid), req = request(sb, paid);
  complete(sb, req);
  const c = sb.rows('Clients')[0], p = sb.rows('Payments')[0];
  assert.equal(p.id, 'pay::ordinary-fixture::base::' + due);
  assert.equal(p.dueDate, due, 'the original scheduled cycle remains audit evidence');
  assert.equal(p.coverageStart, paid); assert.equal(p.coverageEnd, end); assert.equal(c.nextBillingDate, next);
  const read = CL.paidThroughReview(c, [p], paid);
  assert.equal(read.state, 'confirmed'); assert.equal(read.confirmedEnd, end); assert.equal(read.nextCollection, next);
  assert.equal(CL.isoFromLocalDate(Revenue.coverageWindowFor(p).start), paid);
  assert.equal(CL.isoFromLocalDate(Revenue.coverageWindowFor(p).end), end);
  const credit = CL.suggestCredits(c, CL.isoFromLocalDate(CL.addDays(CL.localDateFromISO(end), -2)), [p])[0];
  assert.equal(credit.basis.coverageEnd, end); assert.equal(credit.basis.unusedDays, 2);
});

test('ordinary early payment allows another exact due cycle in the same calendar month without collision', () => {
  const sb = setup(), first = request(sb, '2026-10-28'); complete(sb, first);
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2026-11-28');
  const second = request(sb, '2026-11-28', { opId: 'ordinary-operation-0002' }); complete(sb, second);
  assert.deepEqual(sb.rows('Payments').map(p => p.id), ['pay::ordinary-fixture::base::2026-11-01', 'pay::ordinary-fixture::base::2026-11-28']);
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2026-12-28');
  assert.equal(sb.post(first).operation.state, 'acknowledged', 'late original retry cannot reserve a different cycle');
  assert.equal(sb.rows('Payments').length, 2);
});

test('explicit multi-month advance follows its chosen period; same operation replay is immutable', () => {
  const sb = setup(), req = request(sb, '2026-10-25', { coverageIntent: 'advance' });
  req.payment.coverageStart = '2026-12-01'; req.payment.coverageEnd = '2027-01-31'; req.patch.nextBillingDate = '2027-02-01';
  complete(sb, req);
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2027-02-01');
  const original = JSON.stringify(sb.rows('FinancialOps'));
  assert.equal(sb.post(req).ok, true);
  const changed = structuredClone(req); changed.coverageIntent = 'ordinary';
  assert.equal(sb.post(changed).error, 'operation_payload_mismatch');
  assert.equal(JSON.stringify(sb.rows('FinancialOps')), original);
  assert.equal(sb.rows('Payments').length, 1);
});

test('new unversioned requests fail closed, and explicit invalid future coverage writes nothing', () => {
  const sb = setup(), req = request(sb, '2026-10-25');
  delete req.coverageIntent;
  assert.equal(sb.post(req).error, 'renewal_coverage_intent_required');
  req.coverageIntent = 'advance'; req.payment.coverageStart = '2026-10-01'; req.payment.coverageEnd = '2026-10-31'; req.patch.nextBillingDate = '2026-11-01';
  assert.equal(sb.post(req).error, 'renewal_period_changed');
  assert.equal(sb.rows('FinancialOps').length, 0); assert.equal(sb.rows('Payments').length, 0);
  assert.equal(sb.rows('Clients')[0].nextBillingDate, CLIENT.nextBillingDate);
});

test('exact existing legacy cycle keeps its ID and recorded period; another same-month row is not selected', () => {
  const sb = setup();
  sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [
    { id: 'pay::ordinary-fixture::base::2026-11', clientId: CLIENT.id, billingType: 'monthly', dueDate: '2026-11-01',
      amountDue: 600, amountPaid: 200, status: 'partial', paymentDate: '2026-10-25', coverageStart: '2026-11-01', coverageEnd: '2026-12-15' },
    { id: 'pay::ordinary-fixture::base::2026-11-28', clientId: CLIENT.id, billingType: 'monthly', dueDate: '2026-11-28', amountDue: 600, amountPaid: 0, status: 'unpaid' },
  ]);
  const state = sb.post({ action: 'getRenewalState', clientId: CLIENT.id });
  assert.equal(state.paymentId, 'pay::ordinary-fixture::base::2026-11');
  const req = request(sb, '2026-11-10');
  req.priorPayment = { id: state.priorPayment.id, status: 'partial', amountPaid: 200 };
  assert.equal(sb.post(req).error, 'renewal_recorded_coverage_changed');
  req.coverageIntent = 'advance'; req.payment.coverageStart = '2026-11-01'; req.payment.coverageEnd = '2026-12-15'; req.patch.nextBillingDate = '2026-12-16';
  complete(sb, req);
  assert.equal(sb.rows('Payments').length, 2);
  assert.equal(sb.rows('Payments')[0].id, 'pay::ordinary-fixture::base::2026-11');
  assert.equal(sb.rows('Payments')[0].coverageEnd, '2026-12-15');
  assert.equal(sb.rows('Payments')[1].status, 'unpaid');
});

test('duplicate exact due cycles fail before a choice or financial mutation', () => {
  const sb = setup();
  sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, ['pay::ordinary-fixture::base::2026-11', 'pay::ordinary-fixture::base::2026-11-01'].map(id => ({
    id, clientId: CLIENT.id, dueDate: '2026-11-01', billingType: 'monthly', status: 'unpaid', amountDue: 600,
  })));
  assert.equal(sb.post({ action: 'getRenewalState', clientId: CLIENT.id }).error, 'renewal_duplicate_cycle');
  assert.equal(sb.rows('FinancialOps').length, 0);
});

test('unresolved month-key history cannot be bypassed by a new date-specific ID', () => {
  for (const suffix of ['base::2026-11', '2026-11']) for (const dueDate of ['', 'not-a-date']) {
    const sb = setup({ nextBillingDate: '2026-11-28' });
    const before = request(sb, '2026-11-28');
    sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [{ id: 'pay::ordinary-fixture::' + suffix, clientId: CLIENT.id,
      billingType: 'monthly', dueDate, status: 'partial', amountDue: 600, amountPaid: 200 }]);
    assert.equal(sb.post({ action: 'getRenewalState', clientId: CLIENT.id }).error, 'renewal_cycle_requires_review');
    assert.equal(sb.post(before).error, 'renewal_payment_exists');
    assert.equal(sb.rows('FinancialOps').length, 0);
    assert.equal(sb.post({ action: 'savePayment', payment: before.payment }).error, 'duplicate_monthly_cycle');
    assert.equal(sb.rows('Payments').length, 1);
  }
});

test('malformed nonblank recorded period is refused rather than silently replaced', () => {
  const sb = setup();
  sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [{ id: 'pay::ordinary-fixture::base::2026-11', clientId: CLIENT.id,
    billingType: 'monthly', dueDate: '2026-11-01', status: 'partial', amountDue: 600, amountPaid: 200,
    coverageStart: 'not-a-date', coverageEnd: 'not-an-end' }]);
  const req = request(sb, '2026-11-10'); req.priorPayment = { id: req.payment.id, status: 'partial', amountPaid: 200 };
  assert.equal(sb.post(req).error, 'renewal_recorded_coverage_changed');
  assert.equal(sb.rows('FinancialOps').length, 0);
  assert.equal(sb.rows('Payments')[0].coverageStart, 'not-a-date');
});

test('stale month IDs and new date IDs cannot duplicate the same cycle in any payment status', () => {
  const old = 'pay::ordinary-fixture::base::2026-11', fresh = old + '-01';
  for (const [storedId, submittedId] of [[old, fresh], [fresh, old]]) for (const status of ['paid', 'partial', 'unpaid']) {
    const sb = setup();
    const row = { id: storedId, clientId: CLIENT.id, billingType: 'monthly', dueDate: '2026-11-01', status: 'paid',
      amountDue: 600, amountPaid: 600, paymentDate: '2026-10-28', coverageStart: '2026-10-28', coverageEnd: '2026-11-27' };
    sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [row]);
    const before = JSON.stringify(sb.rows('Payments'));
    const result = sb.post({ action: 'savePayment', payment: { ...row, id: submittedId, status, amountPaid: status === 'paid' ? 600 : 0 } });
    assert.equal(result.error, 'duplicate_monthly_cycle');
    assert.equal(JSON.stringify(sb.rows('Payments')), before);
  }
});

test('prepared settlement can cancel against the unchanged prior row, but changed prior still requires review', () => {
  for (const changed of [false, true]) {
    const sb = setup();
    sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [{ id: 'pay::ordinary-fixture::base::2026-11', clientId: CLIENT.id,
      billingType: 'monthly', dueDate: '2026-11-01', status: 'partial', amountDue: 600, amountPaid: 200 }]);
    const req = request(sb, '2026-11-10'); req.priorPayment = { id: req.payment.id, status: 'partial', amountPaid: 200 };
    assert.equal(sb.post(req).ok, true);
    if (changed) sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [{ ...sb.rows('Payments')[0], amountPaid: 300 }]);
    const before = JSON.stringify([sb.rows('Clients'), sb.rows('Payments')]);
    assert.equal(sb.post({ action: 'cancelRenewal', opId: req.opId }).operation.state, changed ? 'review' : 'cancelled');
    assert.equal(JSON.stringify([sb.rows('Clients'), sb.rows('Payments')]), before);
  }
});

test('editing an existing partial or unpaid payment cannot append a new receipt or move the client anchor', async () => {
  const vm = require('node:vm');
  const { fixture, named, settled } = require('../test-support/financial-ui-fixture.cjs');
  for (const status of ['partial', 'unpaid']) {
    const f = fixture({ phone: '0500000001', paymentStatus: 'paid', paymentDate: '2026-10-16' });
    f.client.paymentStatus = status;
    f.ctx.state.payments = [{ id: 'pay::fixture-client::base::2026-10', clientId: f.client.id, status,
      amountDue: 500, amountPaid: status === 'partial' ? 100 : 0, dueDate: '2026-10-01', billingType: 'monthly',
      coverageStart: '2026-10-01', coverageEnd: '2026-10-31' }];
    vm.runInContext(named('paymentKindFromId'), f.ctx);
    const before = JSON.stringify([f.client, f.ctx.state.payments]);
    f.submit('editForm'); await settled();
    assert.deepEqual(f.out.writes, []);
    assert.equal(JSON.stringify([f.client, f.ctx.state.payments]), before);
    assert.match(f.out.notices[0].message, /חידוש ותשלום/);
  }
});

test('legacy cycle IDs with missing or foreign ownership require review before offering a new payment', () => {
  for (const clientId of ['', 'foreign-client']) {
    const sb = setup();
    sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [{ id: 'pay::ordinary-fixture::base::2026-11', clientId,
      billingType: 'monthly', dueDate: '2026-11-01', status: 'partial', amountDue: 600, amountPaid: 200 }]);
    assert.equal(sb.post({ action: 'getRenewalState', clientId: CLIENT.id }).error, 'renewal_cycle_requires_review');
    assert.equal(sb.rows('FinancialOps').length, 0);
  }
});

test('previous-cycle paid evidence still grants grace for billing days other than the first', () => {
  const vm = require('node:vm');
  const { fixture, named } = require('../test-support/financial-ui-fixture.cjs');
  const f = fixture();
  Object.assign(f.client, { billingDay: 26, startDate: '2026-09-26', nextBillingDate: '2026-10-26', status: 'פעיל' });
  Object.assign(f.ctx, { today: () => '2026-11-02', isOpsScope: () => false, isPerSession: () => false, hasBillingProblem: () => false });
  f.ctx.state.payments = [{ id: 'pay::fixture-client::base::2026-10', clientId: f.client.id, billingType: 'monthly', dueDate: '2026-10-26', status: 'paid' }];
  for (const name of ['paymentKindFromId', 'findPaymentById', 'paymentForClientOn', 'prevMonthBasePaid', 'daysBetween', 'renewalInfo']) vm.runInContext(named(name), f.ctx);
  assert.equal(f.ctx.prevMonthBasePaid(f.client), true);
  assert.equal(f.ctx.renewalInfo(f.client).status, 'due_soon');
  assert.equal(f.ctx.renewalInfo(f.client).renewalDate, '2026-11-26');
  f.ctx.state.payments[0].status = 'partial';
  assert.equal(f.ctx.renewalInfo(f.client).status, 'overdue');
});

test('lost write reply resumes the same stored intent and never creates a second payment', () => {
  const sb = setup(), req = request(sb, '2026-10-28'); assert.equal(sb.post(req).ok, true);
  failWrite(sb, 'Payments', null, 'after');
  assert.equal(sb.post({ action: 'applyRenewal', opId: req.opId }).ok, false);
  const original = sb.rows('FinancialOps')[0].intent;
  assert.equal(sb.post({ action: 'getRenewalState', clientId: CLIENT.id }).operation.id, req.opId);
  assert.equal(sb.post({ action: 'applyRenewal', opId: req.opId }).operation.state, 'done');
  assert.equal(sb.rows('FinancialOps')[0].intent, original); assert.equal(sb.rows('Payments').length, 1);
});

test('history read, explicit older periods, partial and unpaid rows retain their original meaning', () => {
  const rows = [
    { id: 'pay::ordinary-fixture::2026-09', clientId: CLIENT.id, billingType: 'monthly', dueDate: '2026-09-23', paymentDate: '2026-09-15', status: 'paid', amountDue: 600, amountPaid: 600 },
    { id: 'pay::ordinary-fixture::base::2026-10', clientId: CLIENT.id, billingType: 'monthly', dueDate: '2026-10-23', paymentDate: '2026-10-15', status: 'partial', amountDue: 600, amountPaid: 100, coverageStart: '2026-10-01', coverageEnd: '2026-12-31' },
    { id: 'pay::ordinary-fixture::base::2026-12', clientId: CLIENT.id, billingType: 'monthly', dueDate: '2026-12-01', status: 'unpaid', amountDue: 600, amountPaid: 0 },
  ];
  const before = JSON.stringify(rows);
  assert.equal(CL.isoFromLocalDate(CL.paymentCoverage(rows[0]).start), '2026-09-23');
  assert.equal(CL.withDefaultCoverage(rows[1], { newPaidMonthly: true }).coverageEnd, '2026-12-31');
  assert.equal(CL.withDefaultCoverage(rows[2], { newPaidMonthly: true }).coverageStart, '2026-12-01');
  CL.paidThroughReview(CLIENT, rows, '2026-11-01'); Revenue.paymentMonthSplit(rows[0]);
  assert.equal(JSON.stringify(rows), before);
});
