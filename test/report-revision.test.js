'use strict';
/**
 * Report order for ordinary (package) sessions — 2026-11-15.
 * The therapists app sends the approved report's server-owned revision (`reportRevision`,
 * ISO time). `recordSessionOutcome` refuses, inside its lock and before any write, a push
 * whose revision is OLDER than the row already holds — so two approved results of one
 * session that cross in flight can no longer leave the older one. Real Code.gs handlers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const SECRET = 'session-outcome-secret-fixture';
const PHONE = '0501234567';
const CLIENT = { id: 'c1', name: 'דנה', phone: PHONE, status: 'פעיל', serviceType: 'פרטני CBT', sessionsPerWeek: '{"פרטני CBT":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, startDate: '2026-10-01', creditsOwed: 0 };
const A = '2026-11-10T10:00:00.000Z', B = '2026-11-10T10:05:00.000Z';

function fixture() {
  const sb = sandbox([], [CLIENT]);
  sb.props.SESSION_OUTCOME_SECRET = SECRET;
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [{ name: 'הילה תבור', flatRate: 300 }]);
  const send = (over) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({
    action: 'recordSessionOutcome', secret: SECRET, sessionId: 's1', phone: PHONE, therapist: 'הילה תבור',
    clinicalTreatmentType: 'פרטני CBT', date: '2026-11-10', outcome: 'happened' }, over || {})) } }).getContent());
  const row = () => sb.rows('SessionLog').filter((r) => String(r.sessionId) === 's1');
  const credits = () => Number(sb.rows('Clients')[0].creditsOwed || 0);
  return { sb, send, row, credits };
}

test('header: reportRevision is appended last', () => {
  const { sb } = fixture();
  const H = JSON.parse(JSON.stringify(sb.ctx.SESSION_LOG_HEADERS));
  assert.equal(H[H.length - 1], 'reportRevision');
  assert.equal(H[H.length - 2], 'oneTimeSessionId');
});

test('newer report B recorded, older A arrives late → refused; row, pay and credits untouched', () => {
  const f = fixture();
  assert.equal(f.send({ outcome: 'therapist_cancelled', reportRevision: B }).ok, true);
  const before = JSON.stringify(f.row()), credits = f.credits();
  assert.equal(credits, 1, 'the cancellation credit');
  const late = f.send({ outcome: 'happened', reportRevision: A });
  assert.deepEqual(late, { ok: false, reason: 'stale_report_revision' });
  assert.equal(JSON.stringify(f.row()), before);
  assert.equal(f.credits(), credits);
  assert.equal(f.row().length, 1);
});

test('in order (A then B) → the correction is applied and the revision advances', () => {
  const f = fixture();
  assert.equal(f.send({ reportRevision: A }).ok, true);
  assert.equal(f.row()[0].reportRevision, A);
  assert.equal(f.send({ outcome: 'therapist_cancelled', reportRevision: B }).ok, true);
  assert.equal(f.row()[0].outcome, 'therapist_cancelled');
  assert.equal(f.row()[0].reportRevision, B);
  assert.equal(Number(f.row()[0].therapistPay), 0);
});

test('the same report re-sent (equal revision) is idempotent', () => {
  const f = fixture();
  f.send({ reportRevision: A });
  const pay = f.row()[0].therapistPay;
  assert.equal(f.send({ reportRevision: A }).ok, true);
  assert.equal(f.row().length, 1);
  assert.equal(f.row()[0].therapistPay, pay);
});

test('no revision (older sender / a correction made here) behaves as before and keeps the stored revision', () => {
  const f = fixture();
  assert.equal(f.send({}).ok, true, 'a row without a revision is recorded');
  assert.equal(f.row()[0].reportRevision, '');
  assert.equal(f.send({ reportRevision: A }).ok, true, 'a first revision on a legacy row is accepted');
  assert.equal(f.send({ outcome: 'patient_no_show' }).ok, true, 'no revision → written as before');
  assert.equal(f.row()[0].outcome, 'patient_no_show');
  assert.equal(f.row()[0].reportRevision, A, 'the stored revision is kept');
  assert.equal(f.send({ outcome: 'happened', reportRevision: '2026-11-10T09:00:00.000Z' }).reason, 'stale_report_revision');
});

test('an unreadable revision is refused before any write; the secret still gates first', () => {
  const f = fixture();
  for (const bad of ['yesterday', 'x'.repeat(41), '2026-13-45T99:00:00Z']) {
    assert.deepEqual(f.send({ reportRevision: bad }), { ok: false, reason: 'invalid_report_revision' });
  }
  assert.equal(f.row().length, 0);
  assert.equal(f.send({ secret: 'wrong', reportRevision: A }).error, 'unauthorized');
});

test('one-time sessions are untouched by the revision (their own writer and conflict rule)', () => {
  const f = fixture();
  const r = f.send({ oneTimeSessionId: '00000000-0000-4000-8000-000000000009', reportRevision: A });
  assert.equal(r.ok, false);
  assert.notEqual(r.reason, 'stale_report_revision');
});
