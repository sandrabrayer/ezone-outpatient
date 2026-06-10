'use strict';

/**
 * Unit tests for the canonical debt rule in public/debt-status.js.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Covers the never-fail-open tri-state: debt / clear / unknown.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const DebtStatus = require('../public/debt-status');

test('rowOwed: paid and blank rows that EXIST owe nothing', () => {
  assert.equal(DebtStatus.rowOwed({ status: 'paid', amountDue: 500, amountPaid: 0 }), 0);
  assert.equal(DebtStatus.rowOwed({ status: 'שולם', amountDue: 500, amountPaid: 0 }), 0);
  assert.equal(DebtStatus.rowOwed({ status: '', amountDue: 500, amountPaid: 0 }), 0);
  assert.equal(DebtStatus.rowOwed({ amountDue: 500, amountPaid: 0 }), 0); // no status field
  assert.equal(DebtStatus.rowOwed(null), 0);
});

test('rowOwed: unpaid owes the full remaining amount', () => {
  assert.equal(DebtStatus.rowOwed({ status: 'unpaid', amountDue: 500, amountPaid: 0 }), 500);
  assert.equal(DebtStatus.rowOwed({ status: 'לא שולם', amountDue: 500, amountPaid: 0 }), 500);
});

test('rowOwed: partial owes only the remainder, never negative', () => {
  assert.equal(DebtStatus.rowOwed({ status: 'partial', amountDue: 500, amountPaid: 200 }), 300);
  assert.equal(DebtStatus.rowOwed({ status: 'שולם חלקית', amountDue: 500, amountPaid: 200 }), 300);
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

test('clientDebtStatus: tri-state — debt / clear / unknown', () => {
  // open balance → debt
  assert.deepEqual(
    DebtStatus.clientDebtStatus([{ status: 'unpaid', amountDue: 400, amountPaid: 0 }]),
    { debtStatus: 'debt', amountOwed: 400 }
  );
  // has rows, all settled → clear
  assert.deepEqual(
    DebtStatus.clientDebtStatus([{ status: 'paid', amountDue: 400, amountPaid: 400 }]),
    { debtStatus: 'clear', amountOwed: 0 }
  );
  // ZERO rows → unknown (never silently "clear")
  assert.deepEqual(
    DebtStatus.clientDebtStatus([]),
    { debtStatus: 'unknown', amountOwed: 0 }
  );
  assert.deepEqual(
    DebtStatus.clientDebtStatus(null),
    { debtStatus: 'unknown', amountOwed: 0 }
  );
});

test('computeClientDebt: returns the FULL roster with tri-state, minimal projection', () => {
  const clients = [
    { id: 'c1', name: 'אורי', treatmentContactPhone: '050-1234567', payerPhone: '03-0000000', pricePerSession: 300 },
    { id: 'c2', name: 'דנה', treatmentContactPhone: '052-7654321' },
    { id: 'c3', name: 'מאיה', treatmentContactPhone: '054-1111111' } // no payment rows
  ];
  const payments = [
    { clientId: 'c1', status: 'unpaid', amountDue: 400, amountPaid: 0 },
    { clientId: 'c1', status: 'paid', amountDue: 400, amountPaid: 400 },
    { clientId: 'c2', status: 'paid', amountDue: 400, amountPaid: 400 }
  ];

  const rows = DebtStatus.computeClientDebt(clients, payments);
  assert.equal(rows.length, 3, 'every client is returned, not only debtors');

  const byId = Object.fromEntries(rows.map((r) => [r.clientId, r]));
  assert.deepEqual(byId.c1, { clientId: 'c1', name: 'אורי', phone: '050-1234567', debtStatus: 'debt', amountOwed: 400 });
  assert.deepEqual(byId.c2, { clientId: 'c2', name: 'דנה', phone: '052-7654321', debtStatus: 'clear', amountOwed: 0 });
  assert.deepEqual(byId.c3, { clientId: 'c3', name: 'מאיה', phone: '054-1111111', debtStatus: 'unknown', amountOwed: 0 });

  // phone is treatmentContactPhone; payer/billing fields must not leak
  assert.ok(!('payerPhone' in byId.c1));
  assert.ok(!('pricePerSession' in byId.c1));
});

test('computeClientDebt: a debtor is included even after discharge', () => {
  const clients = [{ id: 'c1', name: 'אורי', treatmentContactPhone: '050-1', status: 'סיים טיפול' }];
  const payments = [{ clientId: 'c1', status: 'unpaid', amountDue: 200, amountPaid: 0 }];
  const rows = DebtStatus.computeClientDebt(clients, payments);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].debtStatus, 'debt');
  assert.equal(rows[0].amountOwed, 200);
});

test('computeClientDebt: tolerates missing/empty inputs; no payments → all unknown', () => {
  assert.deepEqual(DebtStatus.computeClientDebt(null, null), []);
  assert.deepEqual(DebtStatus.computeClientDebt([], []), []);
  const rows = DebtStatus.computeClientDebt([{ id: 'c1', name: 'x', treatmentContactPhone: '1' }], null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].debtStatus, 'unknown');
});
