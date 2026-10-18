'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { fixture, settled, source, copy } = require('../test-support/financial-ui-fixture.cjs');
const flows = [
  { name: 'addChargeForm', first: 'charge', fields: { description: 'טיפול בדיקה', amount: '500', chargeDate: '2026-10-18', billingType: 'one_time', chargePaid: 'on' } },
  { name: 'directForm', first: 'client', fields: { name: 'חדש', phone: '0500000003', monthlyAmount: '500', startDate: '2026-10-01', paymentStatus: 'paid', paymentDate: '2026-10-16' } },
  { name: 'activateForm', first: 'client', fields: { pricePerSession: '500', startDate: '2026-10-01', paymentStatus: 'paid', paymentDate: '2026-10-16' } },
  { name: 'editForm', first: 'client', fields: { name: 'שינוי שם', phone: '0500000001', monthlyAmount: '650', paymentStatus: 'paid', paymentDate: '2026-10-16' } },
  { name: 'renewForm', first: 'client', fields: { renewAmount: '650', renewDate: '2026-10-16' } }
];
for (const flow of flows) {
  test(`${flow.name}: an in-flight payment is not presented as confirmed; double submit is blocked`, async () => {
    const f = fixture(flow.fields);
    let resolve;
    f.ctx.persistPayment = async (row) => {
      f.out.writes.push({ kind: 'payment', row: copy(row) });
      await new Promise((r) => { resolve = r; });
    };
    f.submit(flow.name); await settled();
    assert.equal(f.ctx.state.payments.length, 0);
    assert.equal(f.button.disabled, true);
    f.submit(flow.name); await settled();
    assert.equal(f.out.writes.filter((w) => w.kind === 'payment').length, 1);
    resolve(); await settled();
    assert.equal(f.button.disabled, false);
    assert.equal(f.ctx.state.payments.length, 1);
    assert.equal(f.ctx.state.payments[0].status, 'paid');
    assert.equal(f.warning.hidden, true);
    assert.equal(f.out.notices.at(-1).error, false);
  });
  for (const ambiguous of [false, true]) {
    test(`${flow.name}: ${ambiguous ? 'lost response' : 'payment refusal'} retains the confirmed first step without a false success`, async () => {
      const f = fixture(flow.fields);
      const existing = { id: 'pay::fixture-client::base::2026-10', status: 'partial', amountPaid: 125,
        paymentDate: '2026-10-02', notes: 'confirmed previous record' };
      if (flow.name === 'editForm') f.ctx.state.payments.push(copy(existing));
      const beforePayments = copy(f.ctx.state.payments);
      f.ctx.persistPayment = async (row) => {
        if (ambiguous) f.out.sourcePayment = copy(row);
        throw new Error(ambiguous ? 'response lost' : 'busy');
      };
      f.submit(flow.name); await settled();
      assert.deepEqual(copy(f.ctx.state.payments), beforePayments, 'no unconfirmed row or overwritten confirmed row');
      assert.equal(f.warning.hidden, false);
      assert.match(f.warningText.textContent, /לא התקבל אישור/);
      assert.match(f.warningText.textContent, /לרענן ולבדוק בגבייה/);
      assert.equal(f.out.notices.at(-1).error, true);
      assert.equal(f.out.notices.some((n) => !n.error), false, 'no trailing success toast');
      assert.equal(f.button.disabled, false);
      if (flow.first === 'charge') assert.equal(f.ctx.state.charges.length, 1);
      if (flow.name === 'directForm' || flow.name === 'activateForm') assert.equal(f.ctx.state.clients.length, 2);
      if (flow.name === 'activateForm') assert.equal(f.ctx.state.leads.length, 0);
      if (flow.name === 'editForm' || flow.name === 'renewForm') assert.equal(f.client.pricePerSession, 650, 'confirmed client amount is retained');
      if (flow.name === 'renewForm') assert.equal(f.client.nextBillingDate, '2026-11-01');
    });
  }
  test(`${flow.name}: rejected prerequisite never attempts payment and rolls back only unconfirmed local changes`, async () => {
    const f = fixture(flow.fields);
    if (flow.first === 'charge') f.ctx.persistCharge = async () => { throw new Error('busy'); };
    else f.ctx.apiSave = async () => { throw new Error('busy'); };
    f.submit(flow.name); await settled();
    assert.equal(f.out.writes.filter((w) => w.kind === 'payment').length, 0);
    assert.equal(f.ctx.state.payments.length, 0);
    assert.equal(f.ctx.state.clients.length, 1);
    assert.equal(f.ctx.state.charges.length, 0);
    assert.equal(f.ctx.state.leads.length, 1);
    assert.equal(f.client.pricePerSession, 500);
    assert.equal(f.button.disabled, false);
    assert.equal(f.out.notices.at(-1).error, true);
  });
  if (flow.first === 'client') {
    test(`${flow.name}: real persist conflict stops a dependent payment`, async () => {
      const f = fixture(flow.fields);
      f.ctx.apiSave = async (payload) => ({ ok: true, conflicts: [{ id: payload.clients.at(-1).id }] });
      f.submit(flow.name); await settled();
      assert.equal(f.out.conflict, true);
      assert.equal(f.out.reloads, 1);
      assert.equal(f.out.writes.filter((w) => w.kind === 'payment').length, 0);
      assert.equal(f.ctx.state.payments.length, 0);
      assert.equal(f.out.notices.at(-1).error, true);
    });
    test(`${flow.name}: refusal of another row does not roll back this accepted client`, async () => {
      const f = fixture(flow.fields);
      f.ctx.apiSave = async () => ({ ok: true, conflicts: [{ id: 'unrelated-row' }] });
      f.submit(flow.name); await settled();
      assert.equal(f.out.conflict, true);
      assert.equal(f.ctx.state.payments.length, 1);
      assert.equal(f.button.disabled, false);
    });
  }
}
test('warning uses literal text and remains until dismissed, independently of success toasts', () => {
  const f = fixture();
  f.ctx.showFinancialSaveWarning('החיוב נשמר', '<img src=x onerror=alert(1)>');
  assert.match(f.warningText.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal('innerHTML' in f.warningText, false);
  f.ctx.toast('success elsewhere');
  assert.equal(f.warning.hidden, false);
});
for (const success of [false, true]) {
  test(`orphan removal: local row ${success ? 'is removed after confirmation' : 'survives rejection'}`, async () => {
    const f = fixture();
    const payment = { id: 'orphan', clientId: 'removed' };
    f.ctx.state.payments.push(payment);
    let resolve, reject;
    Object.assign(f.ctx, { rm: { disabled: false }, payment, nameDisplay: 'fixture', confirm: () => true,
      renderBilling() {}, removePayment: () => new Promise((a, b) => { resolve = a; reject = b; }) });
    const start = source.indexOf('      rm.onclick = function () {');
    const end = source.indexOf('\n      };', start);
    vm.runInContext(source.slice(start, end + 9), f.ctx);
    f.ctx.rm.onclick();
    assert.equal(f.ctx.state.payments.length, 1, 'row stays while deletion is in flight');
    if (success) resolve(); else reject(new Error('busy'));
    await settled();
    assert.equal(f.ctx.state.payments.length, success ? 0 : 1);
    if (!success) assert.equal(f.ctx.rm.disabled, false);
  });
}

for (const result of [undefined, {}, { ok: false }]) {
  test('financial client prerequisite requires explicit source confirmation: ' + JSON.stringify(result), async () => {
    const f = fixture();
    f.ctx.apiSave = async () => result;
    await assert.rejects(f.ctx.persistClientChange(f.client), /לא התקבל אישור/);
  });
}
for (const name of ['persistPayment', 'persistCharge', 'removePayment']) {
  test(`${name}: malformed 200 is not a financial acknowledgement`, async () => {
    const { named } = require('../test-support/financial-ui-fixture.cjs');
    const f = fixture();
    Object.assign(f.ctx, { CL: null, paymentForSheet: (p) => p, chargeForSheet: (p) => p,
      apiPostAction: async () => ({}) });
    vm.runInContext(named(name), f.ctx);
    await assert.rejects(f.ctx[name]({ id: 'fixture' }), /לא התקבל אישור/);
    f.ctx.apiPostAction = async () => ({ ok: true });
    await f.ctx[name]({ id: 'fixture' });
  });
}
test('prerequisite waits for stale/conflict reload before a following payment can be confirmed', async () => {
  for (const response of [{ ok: true, staleSave: true }, { ok: true, conflicts: [{ id: 'other-row' }] }]) {
    const f = fixture();
    let release, finished = false;
    f.ctx.apiSave = async () => response;
    f.ctx.loadAll = () => new Promise((r) => { release = r; });
    const pending = f.ctx.persistClientChange(f.client).then(() => { finished = true; });
    await settled(); assert.equal(finished, false);
    release(); await pending; assert.equal(finished, true);
  }
});
