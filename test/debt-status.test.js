'use strict';

/**
 * Unit tests for the canonical debt rule in public/debt-status.js.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const DebtStatus = require('../public/debt-status');

test('rowOwed: paid and empty/legacy rows owe nothing', () => {
  assert.equal(DebtStatus.rowOwed({ status: 'paid', amountDue: 500, amountPaid: 0 }), 0);
  assert.equal(DebtStatus.rowOwed({ status: 'שולם', amountDue: 500, amountPaid: 0 }), 0);
  assert.equal(DebtStatus.rowOwed({ status: '', amountDue: 500, amountPaid: 0 }), 0);
  assert.equal(DebtStatus.rowOwed({ amountDue: 500, amountPaid: 0 }), 0); // no status
  assert.equal(DebtStatus.rowOwed(null), 0);
});

test('rowOwed: unpaid owes the full remaining amount', () => {
  assert.equal(DebtStatus.rowOwed({ status: 'unpaid', amountDue: 500, amountPaid: 0 }), 500);
  assert.equal(DebtStatus.rowOwed({ status: 'לא שולם', amountDue: 500, amountPaid: 0 }), 500);
});

test('rowOwed: partial owes only the remainder, never negative', () => {
  assert.equal(DebtStatus.rowOwed({ status: 'partial', amountDue: 500, amountPaid: 200 }), 300);
  assert.equal(DebtStatus.rowOwed({ status: 'שולם חלקית', amountDue: 500, amountPaid: 200 }), 300);
  // overpaid / odd data never produces negative debt
  assert.equal(DebtStatus.rowOwed({ status: 'partial', amountDue: 500, amountPaid: 800 }), 0);
});

test('amountOwedForRows: sums across rows and rounds float dust', () => {
  const rows = [
    { status: 'unpaid', amountDue: 100.1, amountPaid: 0 },
    { status: 'partial', amountDue: 50.2, amountPaid: 0.1 },
    { status: 'paid', amountDue: 999, amountPaid: 0 }
  ];
  assert.equal(DebtStatus.amountOwedForRows(rows), 150.2);
  assert.equal(DebtStatus.amountOwedForRows([]), 0);
  assert.equal(DebtStatus.amountOwedForRows(null), 0);
});

test('computeDebtors: joins Payments to Clients by clientId, projects minimal fields', () => {
  const clients = [
    { id: 'c1', name: 'אורי', treatmentContactPhone: '050-1234567', payerPhone: '03-0000000', pricePerSession: 300 },
    { id: 'c2', name: 'דנה', treatmentContactPhone: '052-7654321' },
    { id: 'c3', name: 'מאיה', treatmentContactPhone: '054-1111111' }
  ];
  const payments = [
    { clientId: 'c1', status: 'unpaid', amountDue: 400, amountPaid: 0 },
    { clientId: 'c1', status: 'paid', amountDue: 400, amountPaid: 400 },
    { clientId: 'c2', status: 'paid', amountDue: 400, amountPaid: 400 },
    { clientId: 'c3', status: '', amountDue: 400, amountPaid: 0 } // legacy = paid
  ];

  const debtors = DebtStatus.computeDebtors(clients, payments);
  assert.equal(debtors.length, 1, 'only c1 owes');
  const d = debtors[0];
  assert.deepEqual(d, {
    clientId: 'c1',
    name: 'אורי',
    phone: '050-1234567',   // treatmentContactPhone, NOT payerPhone
    amountOwed: 400
  });
  // payer/billing fields must not leak into the projection
  assert.ok(!('payerPhone' in d));
  assert.ok(!('pricePerSession' in d));
});

test('computeDebtors: a debtor is included even after discharge', () => {
  const clients = [
    { id: 'c1', name: 'אורי', treatmentContactPhone: '050-1', status: 'סיים טיפול' }
  ];
  const payments = [{ clientId: 'c1', status: 'unpaid', amountDue: 200, amountPaid: 0 }];
  const debtors = DebtStatus.computeDebtors(clients, payments);
  assert.equal(debtors.length, 1);
  assert.equal(debtors[0].amountOwed, 200);
});

test('computeDebtors: tolerates missing/empty inputs', () => {
  assert.deepEqual(DebtStatus.computeDebtors(null, null), []);
  assert.deepEqual(DebtStatus.computeDebtors([], []), []);
  assert.deepEqual(
    DebtStatus.computeDebtors([{ id: 'c1', name: 'x', treatmentContactPhone: '1' }], null),
    []
  );
});
