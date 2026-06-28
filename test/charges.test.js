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
  dueItemsOn,
  chargeStatusFor,
  nextRenewalDueDate,
  basePaymentPaidOn,
  addDays,
  deriveNextBillingDate
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

/* ===== chargeStatusFor ===== */

test('chargeStatusFor returns paid when state.payments has a paid row', () => {
  const client = { id: 'abc' };
  const charge = { id: 'c1', billingType: 'one_time' };
  const payId = paymentId('abc', '2026-05-15', 'extra', 'c1', 'one_time');
  const payments = [{ id: payId, status: 'paid' }];
  assert.equal(chargeStatusFor(payments, client, charge, '2026-05-15'), 'paid');
});

test('chargeStatusFor returns partial when state.payments has a partial row', () => {
  const client = { id: 'abc' };
  const charge = { id: 'c1', billingType: 'one_time' };
  const payId = paymentId('abc', '2026-05-15', 'extra', 'c1', 'one_time');
  const payments = [{ id: payId, status: 'partial' }];
  assert.equal(chargeStatusFor(payments, client, charge, '2026-05-15'), 'partial');
});

test('chargeStatusFor returns unpaid when no payment row exists yet (newly added charge)', () => {
  const client = { id: 'abc' };
  const charge = { id: 'c1', billingType: 'one_time' };
  // payments array is empty: Vered just added the charge.
  assert.equal(chargeStatusFor([], client, charge, '2026-05-15'), 'unpaid');
});

test('chargeStatusFor returns unpaid when payment row exists with status:unpaid', () => {
  const client = { id: 'abc' };
  const charge = { id: 'c1', billingType: 'one_time' };
  const payId = paymentId('abc', '2026-05-15', 'extra', 'c1', 'one_time');
  const payments = [{ id: payId, status: 'unpaid' }];
  assert.equal(chargeStatusFor(payments, client, charge, '2026-05-15'), 'unpaid');
});

test('chargeStatusFor for monthly charge: status comes from the CURRENT month, not chargeDate.month', () => {
  const client = { id: 'abc' };
  const charge = { id: 'c1', billingType: 'monthly', chargeDate: '2026-01-15' };
  // Today is May; we want May's status, not January's.
  const mayId = paymentId('abc', '2026-05-15', 'extra', 'c1', 'monthly');
  const janId = paymentId('abc', '2026-01-15', 'extra', 'c1', 'monthly');
  // Sanity: the two ids are different — the test would be meaningless otherwise.
  assert.notEqual(mayId, janId);
  // January is paid, May is unpaid. The badge should reflect May (today).
  const payments = [
    { id: janId, status: 'paid' },
    { id: mayId, status: 'unpaid' }
  ];
  assert.equal(chargeStatusFor(payments, client, charge, '2026-05-15'), 'unpaid');
  // Flip it: May paid, January unpaid -> badge reads paid.
  payments[0].status = 'unpaid';
  payments[1].status = 'paid';
  assert.equal(chargeStatusFor(payments, client, charge, '2026-05-15'), 'paid');
});

/* ===== nextRenewalDueDate + renewal base paymentId (חידוש ותשלום) ===== */

test('nextRenewalDueDate anchors on paymentDate when present, else startDate', () => {
  // paymentDate wins over startDate.
  assert.equal(
    nextRenewalDueDate({ id: 'abc', paymentDate: '2026-05-15', startDate: '2026-01-10' }),
    '2026-06-15'
  );
  // No paymentDate: fall back to startDate.
  assert.equal(
    nextRenewalDueDate({ id: 'abc', startDate: '2026-01-10' }),
    '2026-02-10'
  );
  // Neither: empty string.
  assert.equal(nextRenewalDueDate({ id: 'abc' }), '');
});

test('nextRenewalDueDate adds 1 month with short-month clamp (Jan 31 -> Feb 28)', () => {
  assert.equal(nextRenewalDueDate({ id: 'abc', paymentDate: '2026-01-31' }), '2026-02-28');
  // Leap year: Jan 31 -> Feb 29.
  assert.equal(nextRenewalDueDate({ id: 'abc', paymentDate: '2028-01-31' }), '2028-02-29');
});

test('paymentId(client.id, nextRenewalDueDate(client), base) is pay::<id>::base::<YYYY-MM>', () => {
  const client = { id: 'abc', paymentDate: '2026-05-15' };
  const due = nextRenewalDueDate(client); // 2026-06-15
  assert.equal(paymentId(client.id, due, 'base'), 'pay::abc::base::2026-06');
});

test('renewal base paymentId is idempotent: same client+month -> identical id', () => {
  const client = { id: 'abc', paymentDate: '2026-05-15' };
  const a = paymentId(client.id, nextRenewalDueDate(client), 'base');
  const b = paymentId(client.id, nextRenewalDueDate(client), 'base');
  assert.equal(a, b);
  assert.equal(a, 'pay::abc::base::2026-06');
});

/* ===== chip-vs-alert anchor parity (renewal alert reads גבייה הבאה) =====
 * The renewal alert (חידוש בעוד X ימים) and the גבייה הבאה chip must read ONE
 * source. The chip renders client.nextBillingDate; the alert anchors on
 * nextRenewalDueDate(client). With nextBillingDate persisted they resolve to the
 * exact same date — same anchor in, same date out — so they can never diverge. */

test('nextRenewalDueDate prefers stored nextBillingDate over paymentDate/startDate', () => {
  // nextBillingDate (the chip's source) wins over both paymentDate and startDate.
  assert.equal(
    nextRenewalDueDate({
      id: 'abc',
      nextBillingDate: '2026-06-14',
      paymentDate: '2026-05-15',
      startDate: '2026-01-10'
    }),
    '2026-06-14'
  );
});

test('renewal alert anchor === גבייה הבאה chip source (no divergence)', () => {
  const client = {
    id: 'abc',
    nextBillingDate: '2026-06-14', // what the chip renders (e.g. addDays(payDate,30))
    paymentDate: '2026-05-15',
    startDate: '2026-01-10'
  };
  const chipDate = client.nextBillingDate;        // chip source
  const alertAnchor = nextRenewalDueDate(client); // alert anchor
  assert.equal(alertAnchor, chipDate);
});

test('nextRenewalDueDate falls back to legacy calc when nextBillingDate is blank', () => {
  // Legacy rows saved before nextBillingDate was persisted: an empty string is
  // not a stored value, so the paymentDate/startDate + 1mo calc still applies.
  assert.equal(
    nextRenewalDueDate({ id: 'abc', nextBillingDate: '', paymentDate: '2026-05-15' }),
    '2026-06-15'
  );
});

/* ===== Bug B: derive-on-load nextBillingDate for legacy clients ===== */

test('deriveNextBillingDate = latest paid base payment paymentDate + 30 days', () => {
  const client = { id: 'abc' }; // no nextBillingDate (legacy)
  const payments = [
    { id: 'pay::abc::base::2026-04', clientId: 'abc', status: 'paid', paymentDate: '2026-04-10' },
    { id: 'pay::abc::base::2026-06', clientId: 'abc', status: 'paid', paymentDate: '2026-06-22' },
    { id: 'pay::abc::base::2026-05', clientId: 'abc', status: 'paid', paymentDate: '2026-05-15' }
  ];
  // Latest paid base is 2026-06-22 -> + 30 days = 2026-07-22 (same formula as
  // the גבייה הבאה chip and the activate/renew path).
  assert.equal(deriveNextBillingDate(client, payments), '2026-07-22');
});

test('deriveNextBillingDate never overwrites a populated nextBillingDate', () => {
  const client = { id: 'abc', nextBillingDate: '2026-09-01' };
  const payments = [{ id: 'pay::abc::base::2026-06', clientId: 'abc', status: 'paid', paymentDate: '2026-06-22' }];
  assert.equal(deriveNextBillingDate(client, payments), '2026-09-01');
});

test('deriveNextBillingDate ignores unpaid rows, extra charges, and other clients', () => {
  const client = { id: 'abc' };
  const payments = [
    { id: 'pay::abc::base::2026-06', clientId: 'abc', status: 'unpaid', paymentDate: '2026-06-22' }, // unpaid
    { id: 'pay::abc::chg-c1::2026-06', clientId: 'abc', status: 'paid', paymentDate: '2026-06-25' }, // extra
    { id: 'pay::zzz::base::2026-06', clientId: 'zzz', status: 'paid', paymentDate: '2026-06-28' }    // other client
  ];
  assert.equal(deriveNextBillingDate(client, payments), '');
});

test('deriveNextBillingDate falls back to dueDate when a paid base row lacks paymentDate', () => {
  const client = { id: 'abc' };
  const payments = [{ id: 'pay::abc::base::2026-06', clientId: 'abc', status: 'paid', paymentDate: '', dueDate: '2026-06-01' }];
  assert.equal(deriveNextBillingDate(client, payments), '2026-07-01');
});

test('deriveNextBillingDate parity: derived value equals the chip formula addDays(anchor,30)', () => {
  const client = { id: 'abc' };
  const payments = [{ id: 'pay::abc::base::2026-06', clientId: 'abc', status: 'paid', paymentDate: '2026-06-22' }];
  assert.equal(deriveNextBillingDate(client, payments), addDays('2026-06-22', 30));
});

/* ===== Bug A: backdated paid-date round-trips (not coerced to today) ===== */

test('basePaymentPaidOn stamps the explicit paid date, not today', () => {
  const client = { id: 'abc', name: 'ליאור' };
  const row = basePaymentPaidOn(client, '2026-06-01', 2000, '2026-06-22', '');
  assert.equal(row.id, 'pay::abc::base::2026-06');
  assert.equal(row.status, 'paid');
  assert.equal(row.amountDue, 2000);
  assert.equal(row.amountPaid, 2000);
  // The backdate survives verbatim — this is the value the chip renders and the
  // value persistPayment writes to the Payments row's paymentDate column.
  assert.equal(row.paymentDate, '2026-06-22');
});

test('basePaymentPaidOn keys the row by due-month so the chip reads the same row', () => {
  const client = { id: 'abc', name: 'ליאור' };
  // Same client+month always upserts the same id (idempotent backdate edits).
  const a = basePaymentPaidOn(client, '2026-06-01', 2000, '2026-06-22', '');
  const b = basePaymentPaidOn(client, '2026-06-28', 2000, '2026-06-10', 'note');
  assert.equal(a.id, b.id);
  assert.equal(b.notes, 'note');
});

/* ===== Bug C: renew modal feeds paid-date + notes; re-anchors nextBillingDate ===== */

test('renew payment carries the modal paid-date + notes, keyed to the renewal month', () => {
  const client = { id: 'abc', name: 'ליאור' };
  const renewalDate = '2026-07-22';
  const paidDate = '2026-06-28';
  const pay = basePaymentPaidOn(client, renewalDate, 1800, paidDate, 'מזומן');
  assert.equal(pay.id, 'pay::abc::base::2026-07'); // billed month = renewal month
  assert.equal(pay.dueDate, renewalDate);
  assert.equal(pay.status, 'paid');
  assert.equal(pay.amountDue, 1800);
  assert.equal(pay.paymentDate, paidDate);         // backdatable, not coerced to today
  assert.equal(pay.notes, 'מזומן');                 // free-text notes persist to the row
});

test('renew re-anchors nextBillingDate from the paid date (+30), backdate-sensitive', () => {
  assert.equal(addDays('2026-06-28', 30), '2026-07-28');
  // A backdated paid date yields a different anchor than a later date would.
  assert.notEqual(addDays('2026-06-10', 30), addDays('2026-06-28', 30));
});

test('chargeStatusFor for one_time charge: status comes from the ::once id, independent of todayISO month', () => {
  const client = { id: 'abc' };
  const charge = { id: 'c1', billingType: 'one_time' };
  const onceId = paymentId('abc', '2026-05-15', 'extra', 'c1', 'one_time');
  // Confirm the id ends in ::once and is therefore not month-keyed.
  assert.equal(onceId, 'pay::abc::chg-c1::once');
  const payments = [{ id: onceId, status: 'paid' }];
  // Same paid status regardless of which date we pass in.
  assert.equal(chargeStatusFor(payments, client, charge, '2026-05-15'), 'paid');
  assert.equal(chargeStatusFor(payments, client, charge, '2027-11-30'), 'paid');
});
