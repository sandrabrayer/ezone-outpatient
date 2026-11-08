'use strict';

/* OP-BILL-01: a lost confirmation must not silently turn the next button click
 * into payment for a different (future) month. Real Code.gs runs in memory;
 * no Google project, customer, receipt or production data is touched. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CL = require('../public/credits-ledger');
const { sandbox } = require('../test-support/apps-script-sandbox');
const vm = require('node:vm');
const { fixture, named, copy } = require('../test-support/financial-ui-fixture.cjs');

const customer = {
  id: 'fixture-client', name: 'Synthetic', status: 'פעיל', serviceType: 'פרטני',
  sessionsPerWeek: '{"פרטני":1}', billingDay: 1,
  startDate: '2026-09-01', nextBillingDate: '2026-11-01',
  pricePerSession: 15000, paymentDate: '2026-09-15'
};

function mk() {
  const sb = sandbox([], [{ ...customer }]);
  sb.ctx._todayISODate = () => '2026-11-01';
  return sb;
}
function renewal(sb, opId, paidDate, explicitAdvance) {
  const state = sb.post({ action: 'getRenewalState', clientId: customer.id });
  assert.equal(state.ok, true, JSON.stringify(state));
  assert.equal(state.operation, undefined, 'only fully closed operations permit a new renewal');
  const cycle = state.cycleDate;
  const window = CL.paymentDateCoverage(paidDate, cycle);
  const request = {
    action: 'reserveRenewal', opId, clientId: customer.id,
    snapshot: state.snapshot, cycleDate: cycle,
    patch: { pricePerSession: 15000, paymentDate: paidDate, nextBillingDate: window.next },
    payment: {
      id: 'pay::fixture-client::base::' + cycle.slice(0, 7),
      clientId: customer.id, clientName: 'Synthetic', billingType: 'monthly',
      dueDate: cycle, amountDue: 15000, amountPaid: 15000, status: 'paid',
      paymentDate: paidDate, coverageStart: window.start, coverageEnd: window.end
    }
  };
  if (explicitAdvance !== undefined) request.advanceConfirmed = explicitAdvance;
  return { cycle, request, reserve: () => sb.post(request),
    apply: () => sb.post({ action: 'applyRenewal', opId }) };
}
function firstReceipt(sb) {
  const first = renewal(sb, 'renew-first-nov-synthetic', '2026-10-25');
  assert.equal(first.cycle, '2026-11-01');
  assert.equal(first.reserve().ok, true);
  assert.equal(first.apply().operation.state, 'done');
  assert.equal(sb.post({ action: 'acknowledgeRenewal', opId: first.request.opId }).operation.state, 'acknowledged');
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2026-12-01');
  assert.equal(sb.rows('Clients')[0].paymentDate, '2026-10-25');
  return first;
}

// Execute the REAL submit handler against the existing in-memory Code.gs
// sandbox. Native dialog and DOM are adapters, not a real-browser claim.
async function submitFutureRenewal(confirmResult, paidDate = '2026-10-25') {
  const sb = mk();
  firstReceipt(sb);
  const f = fixture({ renewAmount: '15000', renewDate: paidDate, renewNotes: '' });
  const confirmations = [], actions = [];
  Object.assign(f.ctx, {
    today: () => '2026-11-01', renewLoadToken: 1,
    renewSourceState: sb.post({ action: 'getRenewalState', clientId: customer.id }),
    normalizeClientFromSheet: copy, findPaymentById: () => null, paymentForSheet: copy,
    monthLabel: cycle => cycle.slice(0, 7),
    confirm(message) { confirmations.push(message); return confirmResult; },
    async apiPostAction(action, body) { actions.push({ action, body: copy(body) }); return sb.post({ action, ...copy(body) }); },
    showRenewalOperation(op) { f.ctx.renewSourceState.operation = op; },
    renewalErrorMessage: err => String(err),
    async refreshRenewalState() { assert.fail('unexpected recovery path'); }
  });
  vm.runInContext(named('submitDurableRenewal'), f.ctx);
  const before = JSON.stringify([sb.rows('Clients'), sb.rows('Payments'), sb.rows('FinancialOps')]);
  await f.ctx.submitDurableRenewal({ querySelectorAll: () => [] });
  return { sb, f, before, actions, confirmations };
}

test('UI/source: cancelling the second-payment dialog sends no reserve/apply and changes no financial row', async () => {
  const r = await submitFutureRenewal(false);
  assert.equal(r.confirmations.length, 1);
  assert.match(r.confirmations[0], /2026-12/);
  assert.deepEqual(r.actions, []);
  assert.equal(JSON.stringify([r.sb.rows('Clients'), r.sb.rows('Payments'), r.sb.rows('FinancialOps')]), r.before);
  assert.equal(r.f.button.disabled, false);
});

test('UI/source: deliberate second payment passes strict confirmation into the existing journal', async () => {
  const r = await submitFutureRenewal(true);
  assert.equal(r.confirmations.length, 1);
  assert.deepEqual(r.actions.map(x => x.action), ['reserveRenewal', 'applyRenewal']);
  assert.equal(r.actions[0].body.advanceConfirmed, true);
  assert.equal(r.sb.rows('Payments').length, 2);
  assert.equal(JSON.parse(r.sb.rows('FinancialOps')[1].intent).advanceConfirmed, true);
});

test('UI/source: another paid date follows the usual path without a spurious dialog', async () => {
  const r = await submitFutureRenewal(false, '2026-11-01');
  assert.equal(r.confirmations.length, 0);
  assert.equal(r.actions[0].body.advanceConfirmed, undefined);
  assert.equal(r.sb.rows('Payments').length, 2);
});

test('source: a second future month on the SAME paid date is refused without explicit advance', () => {
  const sb = mk();
  const first = firstReceipt(sb);
  const again = renewal(sb, 'renew-repeat-dec-synthetic', '2026-10-25');
  assert.equal(again.cycle, '2026-12-01');
  const before = JSON.stringify([sb.rows('Clients'), sb.rows('Payments'), sb.rows('FinancialOps')]);
  const refused = again.reserve();
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'renewal_advance_confirmation_required');
  assert.equal(JSON.stringify([sb.rows('Clients'), sb.rows('Payments'), sb.rows('FinancialOps')]), before,
    'no new journal, payment or cycle advance occurs on an ambiguous retry');
  assert.equal(sb.rows('Payments').length, 1);
  assert.equal(sb.rows('Payments')[0].id, first.request.payment.id);
});

test('source: a genuinely separate paid-in-advance future month can be explicitly confirmed', () => {
  const sb = mk();
  firstReceipt(sb);
  const second = renewal(sb, 'renew-confirmed-dec-synthetic', '2026-10-25', true);
  assert.equal(second.cycle, '2026-12-01');
  assert.equal(second.reserve().ok, true);
  assert.equal(second.reserve().operation.state, 'prepared', 'same op ID may be retried safely');
  assert.equal(second.apply().operation.state, 'done');
  const payments = sb.rows('Payments');
  assert.equal(payments.length, 2);
  assert.deepEqual(payments.map(p => p.coverageStart), ['2026-11-01', '2026-12-01']);
  assert.deepEqual(payments.map(p => p.coverageEnd), ['2026-11-30', '2026-12-31']);
  assert.equal(sb.rows('Clients')[0].nextBillingDate, '2027-01-01');
  assert.equal(JSON.parse(sb.rows('FinancialOps')[1].intent).advanceConfirmed, true,
    'the explicit separate-payment decision is stored in the existing journal');
});

test('source: different payment date does not require a same-date advance confirmation', () => {
  const sb = mk();
  firstReceipt(sb);
  const second = renewal(sb, 'renew-newpaid-dec-synthetic', '2026-11-01');
  assert.equal(second.cycle, '2026-12-01');
  assert.equal(second.reserve().ok, true);
  assert.equal(second.apply().operation.state, 'done');
  assert.equal(sb.rows('Payments').length, 2);
});

test('source: fake string confirmation cannot bypass the guard', () => {
  const sb = mk(); firstReceipt(sb);
  const request = renewal(sb, 'renew-fakeflag-dec-synthetic', '2026-10-25', 'true');
  const refused = request.reserve();
  assert.equal(refused.ok, false);
  assert.match(refused.error, /invalid_renewal_advance_confirmation$/, 'source rejects a forged string marker');
  assert.equal(sb.rows('Payments').length, 1);
  assert.equal(sb.rows('FinancialOps').length, 1);
});

test('UI: warns with exact cycle and sends the advance marker only after confirmation', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
  assert.match(app, /var sameDateFutureAdvance = !!fmtDate\(c\.paymentDate\)/);
  assert.match(app, /renewSourceState\.cycleDate > today\(\) && paidDate < renewSourceState\.cycleDate/);
  assert.match(app, /advanceConfirmed = confirm\(/);
  assert.match(app, /if \(!advanceConfirmed\) \{ toast\('לא נוצר תשלום נוסף/);
  assert.match(app, /if \(advanceConfirmed\) request\.advanceConfirmed = true/);
  assert.match(source, /intent\.advanceConfirmed !== true\) return 'renewal_advance_confirmation_required'/);
  assert.match(source, /if \(!stored && c\.paymentDate/);
});
