/**
 * Tests for the extra-charges payment-id scheme and clientsDueOn logic.
 *
 * Run with:  npm test     (Node's built-in test runner, Node >= 18)
 *
 * These tests cover the pure helpers in public/charges-logic.js. The browser
 * (public/app.js) carries an inline copy of the same rules; any change to
 * the rules must update both places.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  paymentId,
  isLegacyBasePaymentId,
  legacyBasePaymentId,
  paymentKindFromId,
  dueItemsOn
} = require('../public/charges-logic');

test('paymentId scheme: base / extra-monthly / one-time-extra produce distinct ids', () => {
  const baseId    = paymentId('abc', '2026-05-15', 'base');
  const extraMon  = paymentId('abc', '2026-05-15', 'extra', 'chg1', 'monthly');
  const extraOnce = paymentId('abc', '2026-05-15', 'extra', 'chg1', 'one_time');

  assert.equal(baseId,    'pay::abc::base::2026-05');
  assert.equal(extraMon,  'pay::abc::chg-chg1::2026-05');
  assert.equal(extraOnce, 'pay::abc::chg-chg1::once');

  // All three are pairwise distinct so they upsert into separate rows.
  assert.notEqual(baseId, extraMon);
  assert.notEqual(baseId, extraOnce);
  assert.notEqual(extraMon, extraOnce);
});

test('paymentId throws if extra is requested without a chargeId', () => {
  assert.throws(function () { paymentId('abc', '2026-05-15', 'extra'); });
});

test('legacy id pay::<clientId>::<YYYY-MM> is recognized as base-monthly on read', () => {
  // Constructor produces exactly the pre-PR shape.
  assert.equal(legacyBasePaymentId('abc', '2026-05-15'), 'pay::abc::2026-05');

  // Detector: only the 3-segment YYYY-MM shape is legacy.
  assert.equal(isLegacyBasePaymentId('pay::abc::2026-05'), true);
  assert.equal(isLegacyBasePaymentId('pay::abc::base::2026-05'), false);
  assert.equal(isLegacyBasePaymentId('pay::abc::chg-x::2026-05'), false);
  assert.equal(isLegacyBasePaymentId('pay::abc::chg-x::once'), false);
  assert.equal(isLegacyBasePaymentId(''), false);
  assert.equal(isLegacyBasePaymentId(null), false);

  // Classifier treats a legacy id as base-monthly (no '::chg-' segment).
  assert.deepEqual(paymentKindFromId('pay::abc::2026-05'), { kind: 'base' });
});

test('paymentKindFromId distinguishes extra vs base for the new shapes', () => {
  assert.deepEqual(paymentKindFromId('pay::abc::base::2026-05'), { kind: 'base' });
  assert.deepEqual(paymentKindFromId('pay::abc::chg-chg1::2026-05'), { kind: 'extra', chargeId: 'chg1' });
  assert.deepEqual(paymentKindFromId('pay::abc::chg-chg1::once'),    { kind: 'extra', chargeId: 'chg1' });
});

test('clientsDueOn returns base + extras on a date that hits both', () => {
  const clients = [{
    id: 'abc', name: 'Test', status: 'פעיל',
    billingDay: 15, startDate: '2026-01-15', pricePerSession: 2000
  }];
  const charges = [
    {
      id: 'c1', clientId: 'abc', active: true,
      billingType: 'monthly', billingDay: 15, chargeDate: '2026-01-15',
      amount: 500
    },
    {
      id: 'c2', clientId: 'abc', active: true,
      billingType: 'one_time', chargeDate: '2026-05-15',
      amount: 300
    }
  ];

  const due = dueItemsOn(clients, charges, '2026-05-15');
  assert.equal(due.length, 3);

  const base = due.filter(d => d.kind === 'base');
  assert.equal(base.length, 1);
  assert.equal(base[0].amount, 2000);
  assert.equal(base[0].clientId, 'abc');

  const extras = due.filter(d => d.kind === 'extra');
  assert.equal(extras.length, 2);
  const extraIds = extras.map(e => e.chargeId).sort();
  assert.deepEqual(extraIds, ['c1', 'c2']);
});

test('clientsDueOn skips monthly extras before their start month', () => {
  const clients = [{
    id: 'abc', status: 'פעיל',
    billingDay: 10, pricePerSession: 1000
  }];
  const charges = [{
    id: 'c1', clientId: 'abc', active: true,
    billingType: 'monthly', billingDay: 10,
    chargeDate: '2026-06-10', amount: 500
  }];

  // Selected date is BEFORE the charge's start month: no extra row.
  const before = dueItemsOn(clients, charges, '2026-05-10');
  assert.equal(before.filter(d => d.kind === 'extra').length, 0);

  // Same month as charge start: extra row appears.
  const sameMonth = dueItemsOn(clients, charges, '2026-06-10');
  const extras = sameMonth.filter(d => d.kind === 'extra');
  assert.equal(extras.length, 1);
  assert.equal(extras[0].chargeId, 'c1');
  assert.equal(extras[0].amount, 500);

  // A later month also matches.
  const later = dueItemsOn(clients, charges, '2026-08-10');
  assert.equal(later.filter(d => d.kind === 'extra').length, 1);
});

test('clientsDueOn skips inactive charges and ignores discharged clients', () => {
  const clients = [
    { id: 'abc', status: 'פעיל',     billingDay: 5, pricePerSession: 1000 },
    { id: 'xyz', status: 'סיים טיפול', billingDay: 5, pricePerSession: 1000 }
  ];
  const charges = [
    {
      id: 'c1', clientId: 'abc', active: false,
      billingType: 'one_time', chargeDate: '2026-05-05', amount: 500
    },
    {
      id: 'c2', clientId: 'xyz', active: true,
      billingType: 'one_time', chargeDate: '2026-05-05', amount: 500
    }
  ];
  const due = dueItemsOn(clients, charges, '2026-05-05');
  // abc emits its base only (inactive charge skipped); xyz emits nothing.
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, 'base');
  assert.equal(due[0].clientId, 'abc');
});
