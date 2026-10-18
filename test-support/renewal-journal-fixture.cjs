'use strict';
const assert = require('node:assert/strict');
const { sandbox } = require('./apps-script-sandbox');
const copy = v => JSON.parse(JSON.stringify(v));
const client = { id: 'journal-client', name: 'בדיקת חידוש', phone: '0500000001', status: 'פעיל',
  serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', billingDay: 31,
  startDate: '2026-01-31', nextBillingDate: '2026-02-28', pricePerSession: 500, paymentDate: '2026-01-31' };
function fixture() {
  const sb = sandbox([], [copy(client)]);
  const state = sb.post({ action: 'getRenewalState', clientId: client.id });
  assert.equal(state.ok, true);
  const request = { action: 'reserveRenewal', opId: 'renewal-fixture-0001', clientId: client.id,
    snapshot: state.snapshot, cycleDate: state.cycleDate,
    patch: { pricePerSession: 600, paymentDate: '2026-02-25', nextBillingDate: '2026-03-31' },
    payment: { id: 'pay::journal-client::base::2026-02', clientId: client.id, clientName: client.name,
      billingType: 'monthly', dueDate: '2026-02-28', amountDue: 600, amountPaid: 600,
      status: 'paid', paymentDate: '2026-02-25', coverageStart: '2026-02-28', coverageEnd: '2026-03-27',
      notes: 'תשלום לבדיקה' } };
  const reserve = () => sb.post(request);
  const apply = () => sb.post({ action: 'applyRenewal', opId: request.opId });
  const discover = () => sb.post({ action: 'getRenewalState', clientId: client.id });
  const ack = () => sb.post({ action: 'acknowledgeRenewal', opId: request.opId });
  return { sb, request, reserve, apply, discover, ack };
}
function failWrite(sb, sheetName, state, when) {
  let armed = true;
  const original = sb.ctx.SpreadsheetApp.getActiveSpreadsheet;
  const patched = new Set();
  function patch(sh) {
    if (!sh || patched.has(sh)) return sh;
    patched.add(sh); const range = sh.getRange;
    sh.getRange = function (...args) {
      const r = range(...args), write = r.setValues;
      r.setValues = values => {
        const match = armed && sh.getName() === sheetName && args[0] > 1 &&
          (state == null || values[0][sb.ctx.FINANCIAL_OP_HEADERS.indexOf('state')] === state);
        if (match && when === 'before') { armed = false; throw Error('fixture interruption before write'); }
        const out = write(values);
        if (match && when === 'after') { armed = false; throw Error('fixture interruption after write'); }
        return out;
      };
      return r;
    };
    return sh;
  }
  sb.ctx.SpreadsheetApp.getActiveSpreadsheet = () => {
    const book = original();
    return { getSheetByName: n => patch(book.getSheetByName(n)), insertSheet: n => patch(book.insertSheet(n)) };
  };
}

module.exports = { fixture, failWrite, client };
