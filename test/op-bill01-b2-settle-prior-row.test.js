'use strict';

/** OP-BILL-01 review fix B2 on PR #162.
 *  An existing unpaid/partial base row of the same cycle is settled by a
 *  guarded in-place update (source-pinned prior row), not refused as
 *  renewal_payment_exists; the quick chip settles overdue cycles again and the
 *  billing editor routes due-cycle vs. older arrears correctly.
 *  All fixtures are synthetic; the Apps Script source runs in the sandbox. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const CL = require('../public/credits-ledger');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { fixture: journalFixture } = require('../test-support/renewal-journal-fixture.cjs');
const { fixture: uiFixture, settled, named, source } = require('../test-support/financial-ui-fixture.cjs');

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
  const recorded = extra.priorPayment && st.priorPayment && CL.recordedCoverage(st.priorPayment);
  const win = recorded ? { start: CL.isoFromLocalDate(recorded.start), end: CL.isoFromLocalDate(recorded.end),
    next: CL.isoFromLocalDate(CL.addDays(recorded.end, 1)) } : CL.paymentDateCoverage(paidDate);
  const request = { action: 'reserveRenewal', opId, clientId: client.id, snapshot: st.snapshot, cycleDate: cycle,
    coverageIntent: recorded ? 'advance' : 'ordinary',
    patch: { pricePerSession: 500, paymentDate: paidDate, nextBillingDate: win.next },
    payment: { id: extra.priorPayment ? st.paymentId : 'pay::C1::base::' + cycle, clientId: client.id, clientName: client.name,
      billingType: 'monthly', dueDate: cycle, amountDue: 500, amountPaid: 500, status: 'paid',
      paymentDate: paidDate, coverageStart: win.start, coverageEnd: win.end, notes: '' }, ...extra };
  return { cycle, win, request, reserve: () => sb.post(request), apply: () => sb.post({ action: 'applyRenewal', opId }) };
}

function seedPrior(sb, row) {
  const r = sb.post({ action: 'savePayment', payment: { id: 'pay::C1::base::2026-11', clientId: 'C1', clientName: 'Synthetic',
    billingType: 'monthly', dueDate: '2026-11-01', amountDue: 500, amountPaid: 0, status: 'unpaid', paymentDate: '',
    coverageStart: '2026-11-01', coverageEnd: '2026-11-30', method: '', notes: 'arrears', ...row } });
  assert.equal(r.ok, true, JSON.stringify(r));
}

test('B2: an existing PARTIAL row of the due cycle is settled in place by the renewal (one row, no duplicate id)', () => {
  const sb = mk();
  seedPrior(sb, { status: 'partial', amountPaid: 200, paymentDate: '2026-11-02' });
  const r = renewal(sb, 'renew-b2-partial-0001', '2026-11-10',
    { priorPayment: { id: 'pay::C1::base::2026-11', status: 'partial', amountPaid: 200 } });
  const reserved = r.reserve();
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  assert.equal(r.reserve().operation.state, 'prepared', 'retry is idempotent');
  assert.equal(r.apply().operation.state, 'done');
  assert.equal(r.apply().operation.state, 'done');
  const rows = sb.rows('Payments');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'paid');
  assert.equal(String(rows[0].amountPaid), '500');
  assert.equal(rows[0].coverageStart, '2026-11-01', 'the partial receipt already allocated this period');
  assert.equal(rows[0].coverageEnd, '2026-11-30');
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2026-12-01');
  const op = JSON.parse(sb.rows('FinancialOps')[0].intent);
  assert.deepEqual(op.priorExpected, { id: 'pay::C1::base::2026-11', status: 'partial', amountPaid: '200' });
  assert.equal(Array.isArray(op.prior), true, 'the observed row is pinned in the journal');
});

test('B2: an existing UNPAID overdue row is settled in place without replacing its recorded period', () => {
  const sb = sandbox([], [{ ...client }]);
  seedPrior(sb, {});
  sb.ctx._todayISODate = () => '2026-11-12';
  const r = renewal(sb, 'renew-b2-unpaid-00001', '2026-11-12',
    { priorPayment: { id: 'pay::C1::base::2026-11', status: 'unpaid', amountPaid: 0 } });
  assert.equal(r.reserve().ok, true);
  assert.equal(r.apply().operation.state, 'done');
  assert.equal(sb.rows('Payments').length, 1);
  assert.equal(sb.rows('Payments')[0].status, 'paid');
  assert.equal(sb.rows('Payments')[0].notes, '');
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2026-12-01');
  assert.deepEqual([sb.rows('Payments')[0].coverageStart, sb.rows('Payments')[0].coverageEnd], ['2026-11-01', '2026-11-30']);
});

test('B2: a prior row with no recorded period can use the selected ordinary paid-date window', () => {
  const sb = mk();
  seedPrior(sb, { coverageStart: '', coverageEnd: '', status: 'partial', amountPaid: 200 });
  const r = renewal(sb, 'renew-b2-blank-000001', '2026-11-10',
    { priorPayment: { id: 'pay::C1::base::2026-11', status: 'partial', amountPaid: 200 } });
  assert.equal(r.request.coverageIntent, 'ordinary');
  assert.equal(r.reserve().ok, true);
  assert.equal(r.apply().operation.state, 'done');
  assert.equal(sb.rows('Payments').length, 1);
  assert.deepEqual([sb.rows('Payments')[0].coverageStart, sb.rows('Payments')[0].coverageEnd], ['2026-11-10', '2026-12-09']);
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2026-12-10');
});

test('B2: changing the recorded period while settling a prior row is refused before a journal write', () => {
  const sb = mk(); seedPrior(sb, { status: 'partial', amountPaid: 200 });
  const r = renewal(sb, 'renew-b2-period-00001', '2026-11-10',
    { priorPayment: { id: 'pay::C1::base::2026-11', status: 'partial', amountPaid: 200 } });
  r.request.coverageIntent = 'ordinary';
  r.request.payment.coverageStart = '2026-11-10';
  r.request.payment.coverageEnd = '2026-12-09';
  r.request.patch.nextBillingDate = '2026-12-10';
  assert.equal(r.reserve().error, 'renewal_recorded_coverage_changed');
  assert.equal(sb.rows('FinancialOps').length, 0);
  assert.equal(sb.rows('Payments')[0].coverageStart, '2026-11-01');
});

test('B2: without a prior expectation an existing row is still refused; a stale or paid expectation is refused with no journal write', () => {
  const sb = mk();
  seedPrior(sb, { status: 'partial', amountPaid: 200 });
  assert.equal(renewal(sb, 'renew-b2-noprior-0001', '2026-11-10').reserve().error, 'renewal_payment_exists');
  assert.equal(renewal(sb, 'renew-b2-stale-000001', '2026-11-10',
    { priorPayment: { id: 'pay::C1::base::2026-11', status: 'partial', amountPaid: 100 } }).reserve().error, 'prior_payment_changed');
  assert.equal(renewal(sb, 'renew-b2-wrongid-0001', '2026-11-10',
    { priorPayment: { id: 'pay::C1::base::2026-10', status: 'partial', amountPaid: 200 } }).reserve().error, 'invalid_renewal_payment');
  assert.equal(sb.rows('FinancialOps').length, 0);

  const paidSb = mk();
  seedPrior(paidSb, { status: 'paid', amountPaid: 500, paymentDate: '2026-11-01' });
  assert.equal(renewal(paidSb, 'renew-b2-paid-0000001', '2026-11-10',
    { priorPayment: { id: 'pay::C1::base::2026-11', status: 'paid', amountPaid: 500 } }).reserve().error, 'invalid_renewal_payment');
  assert.equal(paidSb.rows('FinancialOps').length, 0);
  assert.equal(paidSb.rows('Payments')[0].status, 'paid');

  // A browser-supplied pinned row is ignored: only the source pins, under the lock.
  const forged = mk();
  seedPrior(forged, { status: 'paid', amountPaid: 500, paymentDate: '2026-11-01' });
  const f = renewal(forged, 'renew-b2-forged-00001', '2026-11-10', { prior: new Array(forged.ctx.PAYMENTS_HEADERS.length).fill('') });
  assert.equal(f.reserve().error, 'renewal_payment_exists');
  assert.equal(forged.rows('FinancialOps').length, 0);
});

test('B2: a prior row changed between reserve and apply sends the operation to review, nothing written', () => {
  const sb = mk();
  seedPrior(sb, { status: 'partial', amountPaid: 200 });
  const r = renewal(sb, 'renew-b2-midflight-001', '2026-11-10',
    { priorPayment: { id: 'pay::C1::base::2026-11', status: 'partial', amountPaid: 200 } });
  assert.equal(r.reserve().ok, true);
  // savePayment is already fenced by the pending operation (_finGuard); a hand
  // edit of the sheet is not — replay it directly on the grid.
  assert.equal(sb.post({ action: 'savePayment', payment: { ...sb.rows('Payments')[0], amountPaid: 300 } }).ok, false);
  sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [{ ...sb.rows('Payments')[0], amountPaid: 300 }]);
  const clientsBefore = JSON.stringify(sb.rows('Clients'));
  const applied = r.apply();
  assert.equal(applied.operation.state, 'review');
  assert.equal(applied.operation.resolution, 'source_changed_before_apply');
  assert.equal(JSON.stringify(sb.rows('Clients')), clientsBefore);
  assert.equal(String(sb.rows('Payments')[0].amountPaid), '300');
  assert.equal(sb.rows('Payments')[0].status, 'partial');
});

test('B2: the shared journal fixture (early payment) still round-trips through capture of the stored intent', () => {
  const f = journalFixture();
  assert.equal(f.reserve().operation.state, 'prepared');
  assert.equal(f.apply().operation.state, 'done');
  const intent = JSON.parse(f.sb.rows('FinancialOps')[0].intent);
  assert.equal(intent.priorExpected, undefined);
  assert.equal(intent.prior, undefined);
  assert.equal(f.sb.rows('Payments')[0].coverageStart, '2026-02-28');
  assert.equal(f.sb.rows('Clients')[0].nextBillingDate, '2026-03-28');
});

/* ---- browser paths (real app.js functions in a vm context) ---------------- */

function chipFixture(payments, clientOverrides) {
  const f = uiFixture();
  const { ctx } = f;
  Object.assign(f.client, { nextBillingDate: '2026-10-01', paymentDate: '2026-09-01' }, clientOverrides || {});
  ctx.state.role = 'editor';
  ctx.state.payments = payments;
  ctx.monthPaidPrevClient = {};
  ctx.openRenewModal = c => { f.out.closed.push({ modal: 'renew', id: c.id }); };
  ctx.persist = async () => { f.out.writes.push({ kind: 'persist', client: JSON.parse(JSON.stringify(f.client)) }); };
  for (const name of ['paymentKindFromId', 'findPaymentById', 'paymentForClientOn', 'legacyBasePaymentId',
    'latestPaidBaseDueDate', 'prevCycleDueDateBefore', 'addDays', 'setCurrentMonthPaid']) vm.runInContext(named(name), ctx);
  return f;
}

test('B2 UI: the quick chip opens the journalled intent form without writing an overdue payment optimistically', async () => {
  const f = chipFixture([{ id: 'pay::fixture-client::base::2026-10', clientId: 'fixture-client', billingType: 'monthly',
    dueDate: '2026-10-01', amountDue: 500, amountPaid: 0, status: 'unpaid', paymentDate: '',
    coverageStart: '2026-10-01', coverageEnd: '2026-10-31' }]);
  f.ctx.setCurrentMonthPaid(f.client, true);
  await settled(); await settled(); await settled();
  assert.deepEqual(f.out.writes, []);
  assert.deepEqual(f.out.closed, [{ modal: 'renew', id: f.client.id }]);
  assert.equal(f.client.nextBillingDate, '2026-10-01');
  assert.equal(f.ctx.state.payments[0].status, 'unpaid');
  assert.ok(!f.out.notices.some((n) => n.error), JSON.stringify(f.out.notices));
});

test('B2 UI: the chip never overwrites an explicitly recorded different period, and never re-dates a PAID row', async () => {
  const explicit = chipFixture([{ id: 'pay::fixture-client::base::2026-10', clientId: 'fixture-client', billingType: 'monthly',
    dueDate: '2026-10-01', amountDue: 500, amountPaid: 0, status: 'unpaid', paymentDate: '',
    coverageStart: '2026-10-01', coverageEnd: '2026-11-30' }]);
  explicit.ctx.setCurrentMonthPaid(explicit.client, true);
  await settled();
  assert.equal(explicit.out.writes.length, 0);
  assert.deepEqual(explicit.out.closed, [{ modal: 'renew', id: explicit.client.id }]);
  assert.equal(explicit.ctx.state.payments[0].coverageEnd, '2026-11-30');

  const paid = chipFixture([{ id: 'pay::fixture-client::base::2026-10', clientId: 'fixture-client', billingType: 'monthly',
    dueDate: '2026-10-01', amountDue: 500, amountPaid: 500, status: 'paid', paymentDate: '2026-10-01' }]);
  paid.ctx.setCurrentMonthPaid(paid.client, true);
  await settled();
  assert.equal(paid.out.writes.length, 0);
  assert.deepEqual(paid.out.closed, [{ modal: 'renew', id: paid.client.id }]);
  assert.equal(paid.ctx.state.payments[0].paymentDate, '2026-10-01');
});

test('B2 UI: the billing editor routes the DUE cycle to renewal and preserves recorded OLDER arrears coverage', async () => {
  const f = uiFixture();
  const { ctx } = f;
  ctx.state.role = 'editor';
  ctx.openRenewModal = (c) => { f.out.writes.push({ kind: 'renew', id: c.id }); };
  ctx.renderBilling = () => {}; ctx.renderBillingMonthlySummary = () => {};
  for (const name of ['paymentKindFromId', 'saveBillingRow']) vm.runInContext(named(name), ctx);
  const due = { id: 'pay::fixture-client::base::2026-10', clientId: 'fixture-client', billingType: 'monthly', dueDate: '2026-10-01',
    amountDue: 500, amountPaid: 0, status: 'unpaid', paymentDate: '', coverageStart: '2026-10-01', coverageEnd: '2026-10-31' };
  const arrears = { ...due, id: 'pay::fixture-client::base::2026-08', dueDate: '2026-08-01', coverageStart: '2026-08-01', coverageEnd: '2026-08-31' };
  ctx.state.payments = [due, arrears];
  // due cycle (2026-10, cyclePaymentDueDate stub = 2026-10-01) -> journalled renewal
  ctx.saveBillingRow({ ...due, status: 'paid', amountPaid: 500, paymentDate: '2026-10-18' });
  await settled();
  assert.deepEqual(f.out.writes, [{ kind: 'renew', id: 'fixture-client' }]);
  // older arrears -> direct row update; the anchor is not touched
  ctx.saveBillingRow({ ...arrears, status: 'paid', amountPaid: 500, paymentDate: '2026-10-18' });
  await settled();
  const pay = f.out.writes.find((w) => w.kind === 'payment');
  assert.ok(pay);
  assert.equal(pay.row.id, 'pay::fixture-client::base::2026-08');
  assert.deepEqual([pay.row.coverageStart, pay.row.coverageEnd], ['2026-08-01', '2026-08-31']);
  assert.equal(f.client.nextBillingDate, '2026-10-01');
  // a brand-new row (no prior) still goes to the renewal
  ctx.saveBillingRow({ ...due, id: 'pay::fixture-client::base::2026-11', dueDate: '2026-11-01', status: 'paid', amountPaid: 500, paymentDate: '2026-10-18' });
  assert.equal(f.out.writes.filter((w) => w.kind === 'renew').length, 2);
});

test('B1/B2 UI wiring: renewal uses an explicit coverage selection and source prior row; first-payment paths remain paid-date based', () => {
  const renew = named('submitDurableRenewal');
  assert.match(renew, /renewalCoverageSelection\(form\)/);
  assert.match(renew, /var priorRow = renewSourceState\.priorPayment/);
  assert.match(renew, /renewRow\.coverageStart = paidCoverage\.start/);
  assert.match(renew, /request\.priorPayment = \{ id: priorRow\.id, status: priorRow\.status, amountPaid: priorRow\.amountPaid \}/);
  assert.match(source, /CL\.paymentDateCoverage\(client\.paymentDate, cycleDueISO\)/);
  // First-payment rule (2026-11-09): the intake / activation first cycle is
  // anchored on the payment date itself — see test/first-payment-cycle-anchor.test.js.
  assert.match(source, /CL\.paymentDateCoverage\(payDate, payDate\)/);
  assert.equal((source.match(/CL\.paymentDateCoverage\(payDate, payDate\)/g) || []).length, 2);
});
