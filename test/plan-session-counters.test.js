'use strict';

/**
 * 2026-11-05 (CHANGELOG-plan-session-counters.md), against the REAL Code.gs:
 *   - getTreatmentPlans carries this month's session COUNTER per client (monthQuota /
 *     monthUsed / monthRemaining, from the plan + SessionLog «happened» rows) and the
 *     make-up sessions owed (makeupSessions = Clients.creditsOwed) — counts, never amounts;
 *   - the monthly quota honours `_units` («1 / חודש» is 1 per month, not 4) in the plan
 *     projection AND in the credit engine of recordSessionOutcome;
 *   - אינטייק is a clinical session type (a psychiatrist's intake reaches SessionLog / pay).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const TM = require('../public/treatment-map.js');

const plain = (x) => JSON.parse(JSON.stringify(x));
const pad = (n) => (n < 10 ? '0' : '') + n;
const now = new Date();
const MONTH = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1);
const prevMonth = (() => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); })();
const SECRET = 'outcome-secret-for-tests';

const client = (over) => Object.assign({ id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני', clinicalTreatmentType: 'פרטני כללי',
  sessionsPerWeek: '{"פרטני":1}', status: 'פעיל', startDate: '2026-09-01', creditsOwed: 0 }, over || {});
const log = (over) => Object.assign({ sessionId: 's', phone: '0501234567', patientName: 'אורי', clientId: 'c1', therapist: 'מעיין דלומי',
  clinicalTreatmentType: 'פרטני כללי', billingType: 'פרטני', date: MONTH + '-03', outcome: 'happened', therapistPay: 250, clientSessionValue: 500,
  sessionStatus: 'consumed', matchStatus: 'matched', recordedAt: '', creditStatus: 'within_quota', forwardedToPayroll: '' }, over || {});

function box(clients, logRows) {
  const s = sandbox([], clients);
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, logRows || []);
  s.props.SESSION_OUTCOME_SECRET = SECRET;
  return s;
}
const plans = (s) => Object.fromEntries(plain(s.ctx._getTreatmentPlans()).clients.map((r) => [r.clientId, r]));

test('monthQuota / monthUsed / monthRemaining from the plan and this month\'s happened rows; other months and other outcomes do not count', () => {
  const s = box([client(), client({ id: 'c2', phone: '0502222222', sessionsPerWeek: '{"פרטני":2}' })], [
    log({ sessionId: 'a' }), log({ sessionId: 'b', date: MONTH + '-10' }),
    log({ sessionId: 'old', date: prevMonth + '-20' }),
    log({ sessionId: 'ns', outcome: 'patient_no_show', date: MONTH + '-12' }),
    log({ sessionId: 'tc', outcome: 'therapist_cancelled', date: MONTH + '-13' }),
    log({ sessionId: 'other', clientId: 'c2', date: MONTH + '-05' })
  ]);
  const p = plans(s);
  assert.deepEqual([p.c1.monthQuota, p.c1.monthUsed, p.c1.monthRemaining], [4, 2, 2]);
  assert.deepEqual([p.c2.monthQuota, p.c2.monthUsed, p.c2.monthRemaining], [8, 1, 7]);
  assert.equal(p.c1.makeupSessions, 0);
});

test('remaining never goes below 0; no countable plan → quota 0, remaining null; credits projected as a count', () => {
  const s = box([client({ creditsOwed: 2 }), client({ id: 'c3', phone: '0503333333', sessionsPerWeek: '' })],
    [log({ sessionId: '1' }), log({ sessionId: '2' }), log({ sessionId: '3' }), log({ sessionId: '4' }), log({ sessionId: '5' })]);
  const p = plans(s);
  assert.deepEqual([p.c1.monthQuota, p.c1.monthUsed, p.c1.monthRemaining, p.c1.makeupSessions], [4, 5, 0, 2]);
  assert.deepEqual([p.c3.monthQuota, p.c3.monthUsed, p.c3.monthRemaining], [0, 0, null]);
});

test('monthly units: «1 / חודש» counts 1 per month (was 4); mixed plans add up; bare numbers stay weekly', () => {
  const { ctx } = box([]);
  const q = (v) => ctx._planMonthlyQuota({ sessionsPerWeek: v });
  assert.equal(q('{"מעקב פסיכיאטרי":1,"_units":{"מעקב פסיכיאטרי":"חודש"}}'), 1);
  assert.equal(q('{"פרטני":1,"מעקב פסיכיאטרי":1,"_units":{"מעקב פסיכיאטרי":"חודש"}}'), 5);
  assert.equal(q('{"פרטני":1,"_units":{"פרטני":"שבוע"}}'), 4);
  assert.equal(q('{"פרטני":2}'), 8);
  assert.equal(q('2'), 8);
  assert.equal(q(''), 0);
  assert.equal(q('{bad'), 0);
  assert.equal(q('{"_units":{"x":"חודש"}}'), 0, '_units alone is not a service');
});

test('credit engine: a monthly psychiatric plan is beyond quota on the 2nd session (draws a credit), not on the 5th', () => {
  const s = box([client({ sessionsPerWeek: '{"מעקב פסיכיאטרי":1,"_units":{"מעקב פסיכיאטרי":"חודש"}}', clinicalTreatmentType: 'מעקב פסיכיאטרי', creditsOwed: 1 })],
    [log({ sessionId: 'first', clinicalTreatmentType: 'מעקב פסיכיאטרי', billingType: 'מעקב פסיכיאטרי' })]);
  const r = s.post({ action: 'recordSessionOutcome', secret: SECRET, sessionId: 'second', phone: '0501234567', therapist: 'ד״ר שפרינץ',
    clinicalTreatmentType: 'מעקב פסיכיאטרי', date: MONTH + '-20', outcome: 'happened' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = s.rows('SessionLog').find((x) => x.sessionId === 'second');
  assert.equal(row.creditStatus, 'covered', 'beyond the 1/month quota → the credit covers it');
  assert.equal(Number(row.clientSessionValue), 0);
  assert.equal(plans(s).c1.makeupSessions, 0, 'the credit was drawn');
});

test('אינטייק is a clinical session type: mapped in Code.gs and the mirror, accepted by recordSessionOutcome, paid at the psychiatrist intake rate', () => {
  assert.equal(TM.CLINICAL_TO_BILLING['אינטייק'], 'אינטייק');
  const s = box([client({ clinicalTreatmentType: 'אינטייק' })]);
  assert.equal(s.ctx._clinicalToBilling('אינטייק'), 'אינטייק');
  const r = s.post({ action: 'recordSessionOutcome', secret: SECRET, sessionId: 'in1', phone: '0501234567', therapist: 'ד״ר שפרינץ',
    clinicalTreatmentType: 'אינטייק', date: MONTH + '-02', outcome: 'happened' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = s.rows('SessionLog').find((x) => x.sessionId === 'in1');
  assert.equal(Number(row.therapistPay), 900);
  assert.equal(Number(row.clientSessionValue), 2300);
  const bad = s.post({ action: 'recordSessionOutcome', secret: SECRET, sessionId: 'in2', phone: '0501234567', therapist: 'ד״ר שפרינץ',
    clinicalTreatmentType: 'סוג לא קיים', date: MONTH + '-02', outcome: 'happened' });
  assert.deepEqual(bad, { ok: false, reason: 'unknown_type' }, 'unknown types still fail closed');
});

test('the projection stays money-free: no key or value smells of amounts, and the counters are plain numbers', () => {
  const s = box([client({ creditsOwed: 3, pricePerSession: 500, bundlePrice: 9000, nextBillingDate: '2026-12-01' })], [log({ sessionId: 'x' })]);
  const out = plain(s.ctx._getTreatmentPlans());
  for (const k of Object.keys(out.clients[0])) assert.doesNotMatch(k, /pay|amount|price|charge|billing|credit/i, k);
  assert.ok(!JSON.stringify(out).includes('9000') && !JSON.stringify(out).includes('500'), 'no amounts cross');
  assert.equal(typeof out.clients[0].monthQuota, 'number');
  assert.equal(typeof out.clients[0].makeupSessions, 'number');
});
