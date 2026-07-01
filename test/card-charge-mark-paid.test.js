'use strict';

/**
 * Coverage for togglePaymentRow in public/charges-logic.js — the paid/unpaid
 * state transition used by the client-card charge toggle (setChargePaid) and,
 * by the same rules, the base-package card toggle. public/app.js keeps an inline
 * mirror in setChargePaid — any rule change must update both. Run:  npm test
 *
 * Contract (a plain toggle; partial is a גבייה-only state, never produced here):
 *   makePaid=true  -> status 'paid',   amountPaid = amount, paymentDate = todayISO
 *   makePaid=false -> status 'unpaid', amountPaid = 0,      paymentDate kept
 * The row id / clientId / dueDate / notes are carried from the existing row so
 * it upserts the SAME payment row through the single savePayment path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { togglePaymentRow } = require('../public/charges-logic.js');

const TODAY = '2026-07-01';

function unpaidExtraRow() {
  return {
    id: 'pay::client-1::chg-abc::2026-07',
    clientId: 'client-1', clientName: 'נועם',
    billingType: 'monthly', dueDate: '2026-07-01',
    amountDue: 500, amountPaid: 0, status: 'unpaid',
    paymentDate: '', method: '', notes: 'עיסוי טיפולי'
  };
}

test('unpaid -> paid: sets paid, amountPaid = amount, paymentDate = today', () => {
  const out = togglePaymentRow(unpaidExtraRow(), true, 500, TODAY);
  assert.equal(out.status, 'paid');
  assert.equal(out.amountPaid, 500);
  assert.equal(out.amountDue, 500);
  assert.equal(out.paymentDate, TODAY);
});

test('paid -> unpaid: clears amountPaid to 0, keeps prior paymentDate', () => {
  const paid = { ...unpaidExtraRow(), status: 'paid', amountPaid: 500, paymentDate: '2026-06-15' };
  const out = togglePaymentRow(paid, false, 500, TODAY);
  assert.equal(out.status, 'unpaid');
  assert.equal(out.amountPaid, 0);
  assert.equal(out.paymentDate, '2026-06-15'); // unpaid keeps the existing date
});

test('partial -> paid: a partial charge marked paid becomes fully paid', () => {
  const partial = { ...unpaidExtraRow(), status: 'partial', amountPaid: 200 };
  const out = togglePaymentRow(partial, true, 500, TODAY);
  assert.equal(out.status, 'paid');
  assert.equal(out.amountPaid, 500);
  assert.equal(out.paymentDate, TODAY);
});

test('never produces a partial status (card is a plain toggle)', () => {
  const partial = { ...unpaidExtraRow(), status: 'partial', amountPaid: 200 };
  assert.equal(togglePaymentRow(partial, true, 500, TODAY).status, 'paid');
  assert.equal(togglePaymentRow(partial, false, 500, TODAY).status, 'unpaid');
});

test('carries id / clientId / dueDate so it upserts the SAME payment row', () => {
  const row = unpaidExtraRow();
  const out = togglePaymentRow(row, true, 500, TODAY);
  assert.equal(out.id, row.id);
  assert.equal(out.clientId, row.clientId);
  assert.equal(out.dueDate, row.dueDate);
  assert.equal(out.notes, row.notes);
});

test('works for the base package row shape too (shared rules)', () => {
  const base = {
    id: 'pay::client-1::base::2026-07', clientId: 'client-1', clientName: 'נועם',
    billingType: 'monthly', dueDate: '2026-07-01',
    amountDue: 1100, amountPaid: 0, status: 'unpaid', paymentDate: '', notes: ''
  };
  const out = togglePaymentRow(base, true, 1100, TODAY);
  assert.equal(out.status, 'paid');
  assert.equal(out.amountPaid, 1100);
  assert.equal(out.paymentDate, TODAY);
});

test('amount is coerced to a number; bundle fields zeroed', () => {
  const out = togglePaymentRow(unpaidExtraRow(), true, '500', TODAY);
  assert.equal(out.amountDue, 500);
  assert.equal(out.amountPaid, 500);
  assert.equal(out.bundleSize, 0);
  assert.equal(out.sessionsUsed, 0);
});
