'use strict';

/**
 * Unit coverage for the getTreatmentPlans cross-app projection.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * `_getTreatmentPlans` in apps-script/Code.gs cannot be imported in the Node
 * runtime, so `projectPlans` below is a pure mirror of that projection. Any
 * change to the projected shape must update both. The point of the test is to
 * lock the minimal contract: phone is the populated canonical patient phone
 * (the `phone` column, falling back to `treatmentContactPhone`), recovered to
 * the leading-zero 10-digit form, and NO payer / billing fields ever leak.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const chargesLogic = require('../public/charges-logic.js');

// Mirror of _recoverPhone in apps-script/Code.gs — restore a dropped leading
// zero and normalize to the canonical leading-zero form. Idempotent.
function recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  else if (s.charAt(0) !== '0') s = '0' + s;
  return s;
}

// Mirror of _addMonthIso in apps-script/Code.gs — add 1 calendar month to a
// 'yyyy-MM-dd' string, clamping to the last day of the target month. Must
// behave identically to addMonth in public/charges-logic.js (asserted below).
function addMonthIso(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (isNaN(d)) return '';
  const origDay = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== origDay) d.setDate(0);
  return d.getFullYear() +
    '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
    '-' + ('0' + d.getDate()).slice(-2);
}

// Mirror of _renewalDueDate in apps-script/Code.gs — stored nextBillingDate,
// else anchor (packageChangeDate → paymentDate → startDate) + 1 month, '' when
// no anchor. Same rule as nextRenewalDueDate in public/charges-logic.js.
function renewalDueDate(cl) {
  if (!cl) return '';
  if (cl.nextBillingDate) return cl.nextBillingDate;
  const anchor = cl.packageChangeDate || cl.paymentDate || cl.startDate || '';
  if (!anchor) return '';
  return addMonthIso(anchor);
}

// Pure projection mirror of _getTreatmentPlans for unit coverage. The cross-app
// phone is the canonical patient phone: `phone` column, falling back to
// `treatmentContactPhone`, recovered either way.
function projectPlans(clients) {
  return (clients || []).filter(c => c && c.id != null && String(c.id)).map(cl => ({
    sourceApp: 'ezone-outpatient', clientId: String(cl.id), name: cl.name || '',
    phone: recoverPhone(cl.phone) || recoverPhone(cl.treatmentContactPhone),
    serviceType: cl.serviceType || '',
    sessions: cl.sessionsPerWeek || '', status: cl.status || '',
    // Treatment period — consumed by the therapists app's patient card. Blank
    // (esp. exitDate for active patients) defaults to ''.
    startDate: cl.startDate || '', exitDate: cl.exitDate || '',
    // Renewal/package-end date (date ONLY — the value of nextBillingDate may
    // feed it, but the key itself is never projected, nor any payment rows).
    renewalDate: renewalDueDate(cl)
  }));
}

test('treatment plans expose only the plan projection, never payer/billing', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'אורי', phone: '050-1234567',
      payerPhone: '03-0000000', paymentLink: 'https://x', pricePerSession: 300,
      payerName: 'הורה', bundlePrice: 1000,
      serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', status: 'פעיל' }
  ]);
  assert.equal(rows[0].phone, '0501234567');
  assert.equal(rows[0].serviceType, 'פרטני');
  assert.equal(rows[0].sessions, '{"פרטני":1}');
  assert.equal(rows[0].status, 'פעיל');
  assert.equal('payerPhone' in rows[0], false);
  assert.equal('payerName' in rows[0], false);
  assert.equal('paymentLink' in rows[0], false);
  assert.equal('pricePerSession' in rows[0], false);
  assert.equal('bundlePrice' in rows[0], false);
});

test('treatment plans: rows without an id are skipped; blanks default to empty strings', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'דנה' },                 // missing optional fields
    { name: 'no id here' },                    // no id → skipped
    { id: '', name: 'empty id' }               // empty id → skipped
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    sourceApp: 'ezone-outpatient', clientId: 'c1', name: 'דנה',
    phone: '', serviceType: '', sessions: '', status: '',
    startDate: '', exitDate: '', renewalDate: ''
  });
});

test('treatment plans: project the treatment period (startDate + exitDate)', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'אורי', phone: '0501234567',
      startDate: '2026-01-15', exitDate: '2026-06-30', status: 'סיים טיפול' }
  ]);
  assert.equal(rows[0].startDate, '2026-01-15');
  assert.equal(rows[0].exitDate, '2026-06-30');
});

test('treatment plans: an active patient projects an empty exitDate, never undefined', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'דנה', phone: '0501234567', startDate: '2026-01-15', status: 'פעיל' }
  ]);
  assert.equal(rows[0].startDate, '2026-01-15');
  assert.equal(rows[0].exitDate, '');           // blank while still in treatment
  assert.equal('exitDate' in rows[0], true);     // present as '', not missing
});

test('treatment plans: phone comes from the populated `phone` column (the live-data case)', () => {
  // Regression for the bug: live clients have an empty treatmentContactPhone and
  // the real number in `phone`. The projection must NOT return a blank phone.
  const rows = projectPlans([
    { id: 'c1', name: 'ליעם', phone: '0543123276', treatmentContactPhone: '' }
  ]);
  assert.equal(rows[0].phone, '0543123276');
  assert.notEqual(rows[0].phone, '');
});

test('treatment plans: phone falls back to treatmentContactPhone when `phone` is blank', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'דנה', phone: '', treatmentContactPhone: '052-7654321' }
  ]);
  assert.equal(rows[0].phone, '0527654321'); // recovered to canonical
});

test('treatment plans: leading-zero recovery is applied to the projected phone', () => {
  // Sheets coerced a numeric-looking phone and dropped the leading zero.
  const rows = projectPlans([
    { id: 'c1', name: 'אורי', phone: 543123276 },          // numeric, zero dropped
    { id: 'c2', name: 'נועם', phone: '972527654321' }      // intl form
  ]);
  assert.equal(rows[0].phone, '0543123276');
  assert.equal(rows[1].phone, '0527654321');
});

test('treatment plans: a client with a phone always projects a non-blank canonical join key', () => {
  // The phone is the cross-app join key for the therapists app — it must not be
  // blank for any client that has a number on either column.
  const rows = projectPlans([
    { id: 'c1', name: 'a', phone: '0501234567' },
    { id: 'c2', name: 'b', treatmentContactPhone: '0527654321' },
    { id: 'c3', name: 'c', phone: 543123276 }
  ]);
  rows.forEach((r) => {
    assert.notEqual(r.phone, '');
    assert.match(r.phone, /^0\d{8,9}$/); // canonical leading-zero form
  });
});

test('treatment plans: a client with no number on either column projects an empty phone', () => {
  const rows = projectPlans([{ id: 'c1', name: 'דנה' }]);
  assert.equal(rows[0].phone, '');
});

test('treatment plans: tolerates null / empty input', () => {
  assert.deepEqual(projectPlans(null), []);
  assert.deepEqual(projectPlans([]), []);
});

/* ===== renewalDate — the therapists app's "renew next week" date ===== */

test('renewalDate equals the stored nextBillingDate when one is persisted', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'אורי', nextBillingDate: '2026-09-15',
      packageChangeDate: '2026-07-01', paymentDate: '2026-06-20',
      startDate: '2026-01-15' }
  ]);
  assert.equal(rows[0].renewalDate, '2026-09-15');
});

test('renewalDate falls back to anchor + 1 month: packageChangeDate, then paymentDate, then startDate', () => {
  // packageChangeDate wins over paymentDate and startDate
  let rows = projectPlans([
    { id: 'c1', packageChangeDate: '2026-07-10', paymentDate: '2026-06-20', startDate: '2026-01-15' }
  ]);
  assert.equal(rows[0].renewalDate, '2026-08-10');
  // no packageChangeDate → paymentDate wins over startDate
  rows = projectPlans([
    { id: 'c1', paymentDate: '2026-06-20', startDate: '2026-01-15' }
  ]);
  assert.equal(rows[0].renewalDate, '2026-07-20');
  // only startDate → startDate + 1 month
  rows = projectPlans([
    { id: 'c1', startDate: '2026-01-15' }
  ]);
  assert.equal(rows[0].renewalDate, '2026-02-15');
});

test('renewalDate short-month clamp matches the REAL charges-logic addMonth', () => {
  // The backend month-add must produce the SAME date the גבייה הבאה chip
  // computes — assert equality against the actual public/charges-logic.js
  // function, not a hard-coded expectation.
  for (const iso of ['2026-01-31', '2026-08-31']) {
    const rows = projectPlans([{ id: 'c1', startDate: iso }]);
    assert.equal(rows[0].renewalDate, chargesLogic.addMonth(iso));
  }
  // And the fallback rule as a whole matches the chip's nextRenewalDueDate.
  const cl = { nextBillingDate: '', packageChangeDate: '2026-01-31',
    paymentDate: '2026-01-05', startDate: '2025-12-01' };
  assert.equal(renewalDueDate(cl), chargesLogic.nextRenewalDueDate(cl));
});

test('renewalDate is the empty string when the client has no anchor at all', () => {
  const rows = projectPlans([{ id: 'c1', name: 'דנה', status: 'פעיל' }]);
  assert.equal(rows[0].renewalDate, '');
  assert.equal('renewalDate' in rows[0], true); // present as '', not missing
});

test('contract guard: key set is exactly the previous projection + renewalDate; no billing keys, no payment rows', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני',
      sessionsPerWeek: '{"פרטני":1}', status: 'פעיל',
      startDate: '2026-01-15', exitDate: '',
      // billing-side columns that must NOT leak as keys:
      nextBillingDate: '2026-09-15', packageChangeDate: '2026-07-01',
      paymentDate: '2026-06-20', paymentStatus: 'paid', creditsOwed: 2,
      pricePerSession: 300, bundlePrice: 1000, paymentLink: 'https://x',
      payerName: 'הורה', payerPhone: '03-0000000',
      paymentAmountOverrides: '{"2026-08":100}' }
  ]);
  const expectedKeys = [
    'sourceApp', 'clientId', 'name', 'phone', 'serviceType', 'sessions',
    'status', 'startDate', 'exitDate', 'renewalDate'
  ];
  assert.deepEqual(Object.keys(rows[0]).sort(), expectedKeys.slice().sort());
  // No key smells of money: nextBillingDate itself is NOT projected — only its
  // VALUE crosses, under the date-only renewalDate key.
  for (const k of Object.keys(rows[0])) {
    assert.doesNotMatch(k, /pay|amount|price|charge|billing/i);
  }
  // The serialized response carries no payment rows / amounts anywhere.
  const serialized = JSON.stringify({ ok: true, clients: rows });
  assert.doesNotMatch(serialized, /payments|amountDue|amountPaid|pricePerSession|bundlePrice|paymentLink|payerName|payerPhone|paymentStatus|creditsOwed/);
  assert.equal(rows[0].renewalDate, '2026-09-15'); // value still crosses, date only
});
