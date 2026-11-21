'use strict';
// Exact real Code.gs sandbox tests for the OUT/THR contract handoff.
// Synthetic data only. Source is not deployed by these tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const SECRET = 'synthetic-session-secret-v2';
const EXTRA = 'synthetic-extra-session-secret-v2';
function seed() {
  const clients = [
    { id: 'client-a', name: 'Patient A', phone: '0501234567', status: 'פעיל', serviceType: 'קבוצה', clinicalTreatmentType: 'קבוצה', sessionsPerWeek: '1', creditsOwed: 0 },
    { id: 'client-b', name: 'Patient B', phone: '0502222222', status: 'פעיל', serviceType: 'קבוצה', clinicalTreatmentType: 'קבוצה', sessionsPerWeek: '1', creditsOwed: 0 }
  ];
  const s = sandbox([], clients);
  s.props.SESSION_OUTCOME_SECRET = SECRET;
  s.props.EXTRA_SESSION_SECRET = EXTRA;
  s.props.OUTPATIENT_PROXY_SECRET = 'synthetic-proxy-secret-0123456789012345';
  const snapshot = () => JSON.stringify({ log: s.rows('SessionLog'), clients: s.rows('Clients'), requests: s.rows('ExtraSessionRequests') });
  return { s, snapshot };
}
function group(treatmentId, phone, outcome, revision) {
  return { action: 'recordSessionOutcome', secret: SECRET, sessionId: 'shared-group-100', treatmentId, phone,
    therapist: 'Synthetic Group Therapist', clinicalTreatmentType: 'קבוצה', date: '2026-11-10', outcome: outcome || 'happened',
    reportRevision: revision || '2026-11-10T10:00:00.000Z' };
}
function request(bookingRowId, patch) {
  return Object.assign({ action: 'requestExtraSession', secret: EXTRA, bookingRowId, phone: '0501234567',
    patientName: 'Patient A', treatmentType: 'פרטני', therapist: 'Therapist A',
    monthKey: '2026-11', quota: 4, used: 5, requestedBy: 'Coordinator', note: '' }, patch || {});
}
test('a group outcome is keyed by shared sessionId AND immutable participant treatmentId', () => {
  const { s } = seed();
  const a = s.post(group('treatment-a-100', '0501234567'));
  const b = s.post(group('treatment-b-100', '0502222222', 'patient_no_show'));
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(a.treatmentId, 'treatment-a-100');
  assert.equal(b.treatmentId, 'treatment-b-100');
  assert.equal(a.reportRevision, '2026-11-10T10:00:00.000Z');
  assert.equal(b.reportRevision, '2026-11-10T10:00:00.000Z');
  const rows = s.rows('SessionLog').filter(r => r.sessionId === 'shared-group-100');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.treatmentId, r.clientId, r.outcome]).sort(), [
    ['treatment-a-100', 'client-a', 'happened'],
    ['treatment-b-100', 'client-b', 'patient_no_show']
  ]);
  assert.deepEqual(rows.map(r => Number(r.therapistPay)), [0, 0], 'group outcomes do not multiply pay');
  const before = JSON.stringify(s.rows('SessionLog'));
  const replay = s.post(group('treatment-a-100', '0501234567'));
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(JSON.stringify(s.rows('SessionLog')), before);
  const corrected = s.post(group('treatment-b-100', '0502222222', 'therapist_cancelled', '2026-11-10T10:01:00.000Z'));
  assert.equal(corrected.ok, true, JSON.stringify(corrected));
  const after = s.rows('SessionLog');
  assert.equal(after.find(r => r.treatmentId === 'treatment-a-100').outcome, 'happened');
  assert.equal(after.find(r => r.treatmentId === 'treatment-b-100').outcome, 'therapist_cancelled');
  assert.equal(after.length, 2);
});
test('group identity missing, legacy ambiguous row, duplicate patient or changed same-revision event fail closed', () => {
  const { s, snapshot } = seed();
  assert.equal(s.post(group('', '0501234567')).reason, 'missing_treatment_id');
  assert.equal(s.rows('SessionLog').length, 0);
  assert.equal(s.post(group('treatment-a-100', '0501234567')).ok, true);
  const before = snapshot();
  const duplicate = s.post(group('treatment-c-100', '0501234567'));
  assert.equal(duplicate.reason, 'duplicate_group_participant');
  assert.equal(snapshot(), before);
  const conflict = s.post(group('treatment-a-100', '0501234567', 'patient_no_show'));
  assert.equal(conflict.reason, 'source_outcome_conflict');
  assert.equal(snapshot(), before);
  const legacy = seed();
  legacy.s.seed('SessionLog', legacy.s.ctx.SESSION_LOG_HEADERS, [{
    sessionId: 'shared-group-100', phone: '0501234567', patientName: 'Patient A', clientId: 'client-a',
    therapist: 'Synthetic Group Therapist', clinicalTreatmentType: 'קבוצה', billingType: 'קבוצה',
    date: '2026-11-10', outcome: 'happened', therapistPay: 0, clientSessionValue: 0,
    sessionStatus: 'consumed', matchStatus: 'matched'
  }]);
  const old = legacy.snapshot();
  assert.equal(legacy.s.post(group('treatment-a-100', '0501234567')).reason, 'legacy_group_identity_review');
  assert.equal(legacy.snapshot(), old);
});
test('one extra-session request per immutable booking, including lost response and after approval', () => {
  const { s } = seed();
  const first = s.post(request('booking-row-123'));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.status, 'pending');
  assert.equal(first.bookingRowId, 'booking-row-123');
  assert.match(first.requestId, /^esr_\S+$/, 'synthetic UUID fixture is stable but not RFC4122');
  const before = s.rows('ExtraSessionRequests');
  assert.equal(before.length, 1);
  const retry = s.post(request('booking-row-123'));
  assert.equal(retry.ok, true);
  assert.equal(retry.replayed, true);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.bookingRowId, 'booking-row-123');
  assert.deepEqual(s.rows('ExtraSessionRequests'), before);
  assert.equal(s.ctx._approveExtraSession({ id: first.requestId, approvedBy: 'Vered' }).ok, true);
  const approved = JSON.stringify(s.rows('ExtraSessionRequests'));
  const after = s.post(request('booking-row-123'));
  assert.equal(after.ok, true);
  assert.equal(after.status, 'approved');
  assert.equal(after.bookingRowId, 'booking-row-123');
  assert.equal(after.requestId, first.requestId);
  assert.equal(JSON.stringify(s.rows('ExtraSessionRequests')), approved, 'an approved request is never reset');
  assert.equal(s.post(request('booking-row-123', { phone: '0502222222' })).error, 'booking_row_conflict');
  assert.equal(JSON.stringify(s.rows('ExtraSessionRequests')), approved);
  const second = s.post(request('booking-row-456'));
  assert.equal(second.ok, true);
  assert.notEqual(second.requestId, first.requestId);
  assert.equal(s.rows('ExtraSessionRequests').length, 2);
});
test('missing/invalid booking ID never appends or guesses from phone/month', () => {
  const { s } = seed();
  assert.equal(s.post(request('')).error, 'missing_booking_row_id');
  assert.equal(s.post(request('bad id')).error, 'invalid_booking_row_id');
  assert.equal(s.rows('ExtraSessionRequests').length, 0);
});

test('two group participants appear separately but do not multiply paid sessions or money', () => {
  const { s } = seed();
  assert.equal(s.post(group('treatment-a-100', '0501234567', 'happened')).ok, true);
  assert.equal(s.post(group('treatment-b-100', '0502222222', 'patient_no_show')).ok, true);
  const rows = s.rows('SessionLog');
  const Payout = require('../public/therapist-payout');
  const report = Payout.monthlyPayoutSummary(rows, '2026-11');
  assert.equal(report.therapists.length, 1);
  assert.equal(report.totals.paidCount, 0);
  assert.equal(report.totals.preVatTotal, 0);
  assert.equal(report.therapists[0].sessions.length, 2);
  assert.deepEqual(report.therapists[0].sessions.map(x => x.treatmentId).sort(), [
    'treatment-a-100', 'treatment-b-100'
  ]);
  const native = JSON.parse(JSON.stringify(s.ctx._payrollGroup(rows)));
  assert.equal(native.totals.paidCount, 0, 'Apps Script payroll report matches the UI');
  assert.equal(native.totals.preVatTotal, 0);
  const csv = require('../public/payout-export').buildPayoutCsv(report);
  assert.match(csv, /Synthetic Group Therapist,0,0,0,0/);
});
test('manual correction addresses only one group participant and rejects stale result', () => {
  const { s } = seed();
  assert.equal(s.post(group('treatment-a-100', '0501234567', 'happened')).ok, true);
  assert.equal(s.post(group('treatment-b-100', '0502222222', 'patient_no_show')).ok, true);
  const manual = Object.assign({}, group('treatment-b-100', '0502222222', 'therapist_cancelled'), {
    action: 'correctSessionOutcome', proxySecret: 'synthetic-proxy-secret-0123456789012345',
    user: 'Synthetic Billing Reviewer', moneyScope: 'full'
  });
  delete manual.secret;
  const res = s.post(manual);
  assert.equal(res.ok, true, JSON.stringify(res));
  const rows = s.rows('SessionLog').filter(r => r.sessionId === 'shared-group-100');
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.treatmentId === 'treatment-a-100').outcome, 'happened');
  assert.equal(rows.find(r => r.treatmentId === 'treatment-b-100').outcome, 'therapist_cancelled');
  const before = JSON.stringify(rows);
  const stale = s.post(group('treatment-b-100', '0502222222', 'patient_no_show'));
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'source_outcome_conflict');
  assert.equal(JSON.stringify(s.rows('SessionLog').filter(r => r.sessionId === 'shared-group-100')), before);
});
test('payout UI preserves group participant identity through correction dialog', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public/app.js'), 'utf8');
  assert.match(src, /sessionId: s\.sessionId, treatmentId: s\.treatmentId/);
  assert.match(src, /form\.dataset\.treatmentId = prefill\.treatmentId \|\| ''/);
  assert.match(src, /treatmentId: treatmentId/);
  assert.match(src, /clinical === 'קבוצה' && !treatmentId/);
});
