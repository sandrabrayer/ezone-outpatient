/**
 * Tests for public/continuation-bonus.js  (STEP 1 of the bonus project).
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Basis is the contracted monthly package, charged upfront (5% earned at
 * collection). There is no "treatments received" mode — carry-over sessions
 * are operational and have zero bonus implication.
 *
 * Covers: normal case, multiple patients per house, missing/zero package,
 * unmapped / external house, status handling (finished / paused / active /
 * legacy-empty), month-window boundaries, configurable rate, window
 * roll-up, preview text, input-immutability, non-array safety.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CB = require('../public/continuation-bonus.js');

function client(over) {
  return Object.assign({
    id: 'c' + Math.random().toString(36).slice(2, 7),
    name: 'Pat',
    house_of_origin: 'raanana',
    status: 'פעיל',
    billingType: 'monthly',
    pricePerSession: 1000,      // monthly package amount
    sessionsPerWeek: '',
    bundlePrice: '',
    bundleSize: '',
    startDate: '',
    exitDate: ''
  }, over || {});
}

test('normal case: 5% of monthly package for one continuing patient', () => {
  const r = CB.computeMonth([client({ pricePerSession: 2000 })], '2026-05');
  assert.equal(r.ok, true);
  assert.equal(r.ratePct, 5);
  assert.equal(r.byHouse.raanana, 100);   // 5% of 2000
  assert.equal(r.total, 100);
  const inc = r.lines.filter((l) => l.included);
  assert.equal(inc.length, 1);
  assert.equal(inc[0].bonus, 100);
  assert.equal(inc[0].packageAmount, 2000);
});

test('multiple patients across multiple houses sum per house', () => {
  const r = CB.computeMonth([
    client({ house_of_origin: 'raanana', pricePerSession: 1000 }),
    client({ house_of_origin: 'raanana', pricePerSession: 3000 }),
    client({ house_of_origin: 'ramot', pricePerSession: 2000 }),
    client({ house_of_origin: 'efroni', pricePerSession: 500 })
  ], '2026-05');
  assert.equal(r.byHouse.raanana, 200);   // 5% of 4000
  assert.equal(r.byHouse.ramot, 100);     // 5% of 2000
  assert.equal(r.byHouse.efroni, 25);     // 5% of 500
  assert.equal(r.byHouse.rehab, 0);
  assert.equal(r.total, 325);
});

test('external house is excluded (not a payable house)', () => {
  const r = CB.computeMonth([
    client({ house_of_origin: 'external', pricePerSession: 9999 })
  ], '2026-05');
  assert.equal(r.total, 0);
  assert.equal(r.lines[0].included, false);
  assert.match(r.lines[0].reason, /external/);
});

test('missing / unknown house_of_origin is excluded', () => {
  const r = CB.computeMonth([
    client({ house_of_origin: '', pricePerSession: 1000 }),
    client({ house_of_origin: 'nope', pricePerSession: 1000 })
  ], '2026-05');
  assert.equal(r.total, 0);
  assert.equal(r.lines.every((l) => !l.included), true);
});

test('zero / missing package contributes nothing but is still continuing', () => {
  const r = CB.computeMonth([
    client({ pricePerSession: 0 }),
    client({ pricePerSession: '' })
  ], '2026-05');
  assert.equal(r.total, 0);
  assert.equal(r.lines.filter((l) => l.included).length, 2);
});

test('bundlePrice is a defensive fallback when no monthly figure', () => {
  const r = CB.computeMonth([
    client({ pricePerSession: '', bundlePrice: 2000 })
  ], '2026-05');
  assert.equal(r.total, 100);   // 5% of 2000 fallback
});

test("status 'סיים טיפול' never accrues", () => {
  const r = CB.computeMonth([
    client({ status: 'סיים טיפול', pricePerSession: 1000 })
  ], '2026-05');
  assert.equal(r.total, 0);
  assert.match(r.lines[0].reason, /not continuing/);
});

test('legacy empty status is treated as continuing', () => {
  const r = CB.computeMonth([
    client({ status: '', pricePerSession: 1000 })
  ], '2026-05');
  assert.equal(r.total, 50);
});

test('paused status excluded by default, included when configured', () => {
  const rows = [client({ status: 'הפסקה זמנית', pricePerSession: 1000 })];
  assert.equal(CB.computeMonth(rows, '2026-05').total, 0);
  assert.equal(CB.computeMonth(rows, '2026-05', { countPausedStatus: true }).total, 50);
});

test('month window boundaries: before start and after exit are excluded', () => {
  const c = client({
    pricePerSession: 1000,
    startDate: '2026-03-15',
    exitDate: '2026-06-10'
  });
  assert.equal(CB.computeMonth([c], '2026-02').total, 0);  // before start
  assert.equal(CB.computeMonth([c], '2026-03').total, 50); // start month
  assert.equal(CB.computeMonth([c], '2026-05').total, 50); // mid
  assert.equal(CB.computeMonth([c], '2026-06').total, 50); // exit month
  assert.equal(CB.computeMonth([c], '2026-07').total, 0);  // after exit
});

test('missing startDate => ongoing; missing exitDate => open-ended', () => {
  const c = client({ pricePerSession: 1000, startDate: '', exitDate: '' });
  assert.equal(CB.computeMonth([c], '2020-01').total, 50);
  assert.equal(CB.computeMonth([c], '2030-12').total, 50);
});

test('configurable rate (e.g. 10%) is honoured', () => {
  const r = CB.computeMonth([client({ pricePerSession: 1000 })], '2026-05', { ratePct: 10 });
  assert.equal(r.ratePct, 10);
  assert.equal(r.total, 100);
});

test('invalid ratePct throws (fail fast, no silent wrong money)', () => {
  assert.throws(
    () => CB.computeMonth([client()], '2026-05', { ratePct: -1 }),
    /ratePct must be/
  );
});

test('invalid month is reported, not thrown', () => {
  const r = CB.computeMonth([client()], 'not-a-month');
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid month/);
});

test('monthsInWindow enumerates inclusive range in order', () => {
  const ms = CB.monthsInWindow('2026-11', '2027-02').map((m) => m.key);
  assert.deepEqual(ms, ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(CB.monthsInWindow('2026-05', '2026-04'), []); // reversed
});

test('computeWindow rolls up per house across months', () => {
  const rows = [
    client({ house_of_origin: 'ramot', pricePerSession: 1000,
             startDate: '2026-01-01', exitDate: '2026-03-31' })
  ];
  const w = CB.computeWindow(rows, '2026-01', '2026-04', {});
  assert.equal(w.months.length, 4);
  assert.equal(w.byHouse.ramot, 150);   // Jan,Feb,Mar @50; Apr after exit
  assert.equal(w.total, 150);
});

test('previewText is a non-empty human-readable string with the total', () => {
  const w = CB.computeWindow([client({ pricePerSession: 1000 })], '2026-05', '2026-05', {});
  const txt = CB.previewText(w);
  assert.equal(typeof txt, 'string');
  assert.match(txt, /money preview/);
  assert.match(txt, /charged upfront/);
  assert.match(txt, /GRAND TOTAL: ₪50/);
});

test('input is never mutated', () => {
  const rows = [client({ pricePerSession: 1000 })];
  const snapshot = JSON.parse(JSON.stringify(rows));
  CB.computeMonth(rows, '2026-05');
  assert.deepEqual(rows, snapshot);
});

test('non-array clients input is handled safely', () => {
  assert.equal(CB.computeMonth(null, '2026-05').total, 0);
  assert.equal(CB.computeMonth(undefined, '2026-05').total, 0);
});
