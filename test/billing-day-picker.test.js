'use strict';

/**
 * Coverage for the edit-client monthly collection-day picker (public/app.js).
 * The field is a calendar (type="date") but only the day-of-month integer is
 * stored — renewal/billing logic is unchanged. Mirrors of `dayOfMonth`,
 * `lastDayOfMonth`, and `billingDayInputValue` (keep in sync with app.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

function dayOfMonth(iso) {
  if (!iso) return null;
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length < 3) return null;
  const d = parseInt(parts[2], 10);
  return isFinite(d) ? d : null;
}
function lastDayOfMonth(dateISO) {
  const parts = String(dateISO).slice(0, 10).split('-');
  if (parts.length < 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!isFinite(y) || !isFinite(m)) return null;
  return new Date(y, m, 0).getDate();
}
// Mirror of billingDayInputValue, with `today` injected for determinism.
function billingDayInputValue(billingDay, todayISO) {
  const bd = billingDay ? Number(billingDay) : 0;
  if (!bd) return '';
  const last = lastDayOfMonth(todayISO);
  const eff = (last && bd > last) ? last : bd;
  return todayISO.slice(0, 7) + '-' + String(eff).padStart(2, '0');
}
// Mirror of the edit-submit read: a date input → stored day-of-month integer.
function readBillingDay(dateInputValue) {
  return dateInputValue ? (dayOfMonth(dateInputValue) || '') : '';
}

test('read: a picked date stores only its day-of-month; empty clears it', () => {
  assert.equal(readBillingDay('2026-06-15'), 15);
  assert.equal(readBillingDay('2026-02-28'), 28);
  assert.equal(readBillingDay(''), '');       // cleared → fall back to start-date day
  assert.equal(readBillingDay(null), '');
});

test('prefill: stored day → this-month date value, blank when unset', () => {
  assert.equal(billingDayInputValue(15, '2026-06-10'), '2026-06-15');
  assert.equal(billingDayInputValue('5', '2026-06-10'), '2026-06-05'); // string tolerated
  assert.equal(billingDayInputValue('', '2026-06-10'), '');
  assert.equal(billingDayInputValue(0, '2026-06-10'), '');
});

test('prefill: day is clamped to the current month length (29-31 safe)', () => {
  assert.equal(billingDayInputValue(31, '2026-02-10'), '2026-02-28'); // Feb (non-leap)
  assert.equal(billingDayInputValue(31, '2024-02-10'), '2024-02-29'); // Feb (leap)
  assert.equal(billingDayInputValue(31, '2026-04-10'), '2026-04-30'); // 30-day month
  assert.equal(billingDayInputValue(31, '2026-01-10'), '2026-01-31'); // 31-day month: unchanged
});

test('round-trip: prefill then re-read returns the same day for days that exist in the month', () => {
  assert.equal(readBillingDay(billingDayInputValue(15, '2026-06-10')), 15);
  // A 31 prefilled in a short month re-reads as the clamped day (inherent to a
  // calendar input); billing consumption clamps anyway, so it never over-bills.
  assert.equal(readBillingDay(billingDayInputValue(31, '2026-02-10')), 28);
});
