/**
 * Tests for Vered's two OUT-dashboard alerts (pure logic):
 *   (a) credit alert  — lists ONLY active patients with creditsOwed > 0.
 *   (b) renewal alert — fires within RENEWAL_WINDOW_DAYS of the cycle end,
 *                       not outside; a patient with no cycle date is flagged
 *                       ('missing'), never crashes.
 *
 * Run with:  npm test     (Node's built-in test runner, Node >= 18)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RENEWAL_WINDOW_DAYS,
  creditAlerts,
  renewalAlerts,
  cycleEndDate
} = require('../public/vered-alerts');

const FINISHED = 'סיים טיפול';

// --- credit alert ----------------------------------------------------------

test('credit alert lists only patients with creditsOwed > 0', () => {
  const clients = [
    { id: 'a', name: 'אורי', creditsOwed: 2 },
    { id: 'b', name: 'בני', creditsOwed: 0 },
    { id: 'c', name: 'גל', creditsOwed: 1 },
    { id: 'd', name: 'דנה' },                 // no field -> 0
    { id: 'e', name: 'הדר', creditsOwed: '' } // legacy blank -> 0
  ];
  const out = creditAlerts(clients);
  assert.deepEqual(out.map((r) => r.id), ['a', 'c']); // sorted by credits desc
  assert.deepEqual(out.map((r) => r.credits), [2, 1]);
  assert.equal(out[0].name, 'אורי');
});

test('credit alert excludes finished patients even if they owe credits', () => {
  const clients = [
    { id: 'a', name: 'אקטיב', creditsOwed: 3 },
    { id: 'z', name: 'סיים', creditsOwed: 5, status: FINISHED }
  ];
  assert.deepEqual(creditAlerts(clients).map((r) => r.id), ['a']);
});

test('credit alert treats junk / negative credit values as 0', () => {
  const clients = [
    { id: 'a', name: 'x', creditsOwed: -2 },
    { id: 'b', name: 'y', creditsOwed: 'abc' },
    { id: 'c', name: 'z', creditsOwed: 2.9 } // floored to 2, still > 0
  ];
  const out = creditAlerts(clients);
  assert.deepEqual(out.map((r) => r.id), ['c']);
  assert.equal(out[0].credits, 2);
});

test('credit alert handles empty / null input without crashing', () => {
  assert.deepEqual(creditAlerts([]), []);
  assert.deepEqual(creditAlerts(null), []);
  assert.deepEqual(creditAlerts(undefined), []);
});

// --- renewal alert ---------------------------------------------------------

test('the renewal window constant is 7 days', () => {
  assert.equal(RENEWAL_WINDOW_DAYS, 7);
});

test('renewal alert fires within 7 days of cycle end, not outside', () => {
  // Anchor = startDate; cycle end = startDate + 1 month.
  // startDate 2026-05-10 -> cycle end 2026-06-10.
  const c = { id: 'a', name: 'אורי', startDate: '2026-05-10' };

  // 7 days before end (2026-06-03): inside the window -> fires.
  let out = renewalAlerts([c], '2026-06-03');
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'due');
  assert.equal(out[0].daysLeft, 7);
  assert.equal(out[0].cycleEnd, '2026-06-10');

  // Exactly on the end date (0 days left): still fires.
  out = renewalAlerts([c], '2026-06-10');
  assert.equal(out.length, 1);
  assert.equal(out[0].daysLeft, 0);

  // 8 days before end (2026-06-02): outside the window -> does NOT fire.
  assert.deepEqual(renewalAlerts([c], '2026-06-02'), []);

  // Already past the cycle end (overdue territory): does NOT fire here.
  assert.deepEqual(renewalAlerts([c], '2026-06-11'), []);
});

test('renewal alert anchors on paymentDate over startDate when present', () => {
  // paymentDate wins: 2026-06-05 -> cycle end 2026-07-05.
  const c = { id: 'a', name: 'x', paymentDate: '2026-06-05', startDate: '2026-01-01' };
  assert.equal(cycleEndDate(c), '2026-07-05');
  const out = renewalAlerts([c], '2026-07-01'); // 4 days before end
  assert.equal(out.length, 1);
  assert.equal(out[0].daysLeft, 4);
});

test('patient with no cycle date is flagged, not crashed', () => {
  const clients = [
    { id: 'a', name: 'ללא תאריך' },                       // no paymentDate/startDate
    { id: 'b', name: 'תאריך פגום', startDate: 'not-a-date' } // unparseable
  ];
  const out = renewalAlerts(clients, '2026-06-01');
  assert.equal(out.length, 2);
  out.forEach((r) => {
    assert.equal(r.status, 'missing');
    assert.equal(r.daysLeft, null);
  });
});

test('renewal alert excludes finished patients and handles empty input', () => {
  const finished = { id: 'z', name: 'סיים', startDate: '2026-06-01', status: FINISHED };
  assert.deepEqual(renewalAlerts([finished], '2026-06-01'), []);
  assert.deepEqual(renewalAlerts([], '2026-06-01'), []);
  assert.deepEqual(renewalAlerts(null, '2026-06-01'), []);
});

test('renewal window is overridable for callers that need a different span', () => {
  const c = { id: 'a', name: 'x', startDate: '2026-05-10' }; // cycle end 2026-06-10
  // 8 days out is outside the default 7-day window but inside a 10-day one.
  assert.deepEqual(renewalAlerts([c], '2026-06-02'), []);
  assert.equal(renewalAlerts([c], '2026-06-02', 10).length, 1);
});
