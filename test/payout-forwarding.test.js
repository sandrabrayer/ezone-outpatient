'use strict';

/**
 * Coverage for payout forwarding (mark-as-forwarded) — the third payout
 * capability. Two layers:
 *
 *   1. The WRITE (`_markForwarded` in apps-script/Code.gs): stamp every
 *      still-unforwarded SessionLog row for a (therapist, month) with
 *      forwardedToPayroll = month. Code.gs cannot be imported in Node, so the
 *      stamper is mirrored below as a pure function over an in-memory rows array,
 *      with a source-scan guard asserting the real pieces exist so the mirror
 *      can't drift.
 *
 *   2. The VIEW (`TherapistPayout.monthlyPayoutSummary`, imported directly):
 *      forwarded rows drop out of the view forever; a session logged LATE for an
 *      already-forwarded month surfaces as a הפרש (difference). Forwarding is
 *      per-therapist AND per-month independent.
 *
 * Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Payout = require('../public/therapist-payout');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// --- pure mirror of _payoutMonthOf / _markForwarded (sheet I/O -> rows array) --
function payoutMonthOf(dateCell) {
  const s = String(dateCell == null ? '' : dateCell).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
function markForwarded(payload, rows) {
  const therapist = String((payload && payload.therapist) || '').trim();
  if (!therapist) return { res: { ok: false, reason: 'missing_therapist' }, rows };
  const month = payoutMonthOf((payload && payload.month) || '');
  if (!month) return { res: { ok: false, reason: 'invalid_month' }, rows };
  let forwarded = 0;
  rows.forEach((row) => {
    if (String(row.therapist || '').trim() !== therapist) return;
    if (payoutMonthOf(row.date) !== month) return;
    if (String(row.forwardedToPayroll || '').trim() !== '') return;
    row.forwardedToPayroll = month;
    forwarded++;
  });
  return { res: { ok: true, therapist, month, forwarded }, rows };
}

// ============================================================================
// Source-scan guards — the Code.gs implementation can't silently disappear.
// ============================================================================
test('Code.gs wires the forwarding write + the internal correction path', () => {
  assert.ok(/function _markForwarded\(/.test(GS), '_markForwarded missing');
  assert.ok(/function _payoutMonthOf\(/.test(GS), '_payoutMonthOf missing');
  assert.ok(/forwardedToPayroll/.test(GS), 'forwardedToPayroll column missing');
  assert.ok(/action === 'markForwarded'/.test(GS), 'markForwarded dispatch missing');
  assert.ok(/action === 'correctSessionOutcome'/.test(GS), 'correctSessionOutcome dispatch missing');
});

test('_payoutMonthOf mirror handles both ISO and raw JS Date.toString() dates', () => {
  assert.equal(payoutMonthOf('2026-06-18'), '2026-06');
  assert.equal(payoutMonthOf('Thu Jun 18 2026 00:00:00 GMT+0300'), '2026-06');
  assert.equal(payoutMonthOf(''), '');
  assert.equal(payoutMonthOf('nonsense'), '');
});

// ============================================================================
// The WRITE: stamp the right rows only.
// ============================================================================
function baseRows() {
  return [
    { sessionId: 'a1', therapist: 'מעיין דלומי', date: '2026-06-03', outcome: 'happened', therapistPay: 250, forwardedToPayroll: '' },
    { sessionId: 'a2', therapist: 'מעיין דלומי', date: '2026-06-10', outcome: 'patient_no_show', therapistPay: 250, forwardedToPayroll: '' },
    { sessionId: 'b1', therapist: 'דליה מלמד', date: '2026-06-05', outcome: 'happened', therapistPay: 230, forwardedToPayroll: '' },
    { sessionId: 'a3', therapist: 'מעיין דלומי', date: '2026-07-02', outcome: 'happened', therapistPay: 250, forwardedToPayroll: '' }
  ];
}

test('mark-forwarded stamps exactly the (therapist, month) rows and counts them', () => {
  const rows = baseRows();
  const { res } = markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows);
  assert.equal(res.ok, true);
  assert.equal(res.forwarded, 2);                         // a1 + a2
  assert.equal(rows.find((r) => r.sessionId === 'a1').forwardedToPayroll, '2026-06');
  assert.equal(rows.find((r) => r.sessionId === 'a2').forwardedToPayroll, '2026-06');
  // NOT דליה's June row, NOT מעיין's July row
  assert.equal(rows.find((r) => r.sessionId === 'b1').forwardedToPayroll, '');
  assert.equal(rows.find((r) => r.sessionId === 'a3').forwardedToPayroll, '');
});

test('forwarding is per-therapist independent', () => {
  const rows = baseRows();
  markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows);
  // דליה's June is untouched by מעיין's forward
  assert.equal(rows.find((r) => r.sessionId === 'b1').forwardedToPayroll, '');
  // now forward דליה independently
  const { res } = markForwarded({ therapist: 'דליה מלמד', month: '2026-06' }, rows);
  assert.equal(res.forwarded, 1);
  assert.equal(rows.find((r) => r.sessionId === 'b1').forwardedToPayroll, '2026-06');
});

test('mark-forwarded is idempotent: a second call stamps 0 (already settled)', () => {
  const rows = baseRows();
  assert.equal(markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows).res.forwarded, 2);
  assert.equal(markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows).res.forwarded, 0);
});

test('mark-forwarded rejects a missing therapist / invalid month', () => {
  assert.equal(markForwarded({ month: '2026-06' }, []).res.reason, 'missing_therapist');
  assert.equal(markForwarded({ therapist: 'רמי', month: '' }, []).res.reason, 'invalid_month');
});

test('mark-forwarded matches a raw JS Date.toString() session date (production shape)', () => {
  const rows = [
    { sessionId: 'p1', therapist: 'דליה מלמד', date: 'Thu Jun 18 2026 00:00:00 GMT+0300', outcome: 'happened', therapistPay: 230, forwardedToPayroll: '' }
  ];
  const { res } = markForwarded({ therapist: 'דליה מלמד', month: '2026-06' }, rows);
  assert.equal(res.forwarded, 1);
  assert.equal(rows[0].forwardedToPayroll, '2026-06');
});

// ============================================================================
// The VIEW: forwarded rows excluded; late session -> הפרש; per-therapist.
// ============================================================================
test('mark-forwarded flips state -> those sessions are excluded from the next view', () => {
  const rows = baseRows();
  // before forwarding: מעיין has 2 paid in June
  let s = Payout.monthlyPayoutSummary(rows, '2026-06');
  assert.equal(s.therapists.find((t) => t.therapist === 'מעיין דלומי').paidCount, 2);

  markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows);

  // after: מעיין is gone from June entirely (settled), דליה remains
  s = Payout.monthlyPayoutSummary(rows, '2026-06');
  assert.ok(!s.therapists.some((t) => t.therapist === 'מעיין דלומי'), 'forwarded therapist excluded');
  assert.ok(s.therapists.some((t) => t.therapist === 'דליה מלמד'), 'non-forwarded therapist stays');
  assert.deepEqual(s.differences.therapists, []);          // nothing late yet
});

test('a late session for an already-forwarded month surfaces as a הפרש next cycle', () => {
  const rows = baseRows();
  markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows);

  // a session logged LATE for June (after the forward) — still unstamped
  rows.push({ sessionId: 'late1', therapist: 'מעיין דלומי', patientName: 'יעל',
    clinicalTreatmentType: 'פרטני CBT', date: '2026-06-28', outcome: 'happened',
    therapistPay: 250, forwardedToPayroll: '' });

  // viewing July: it is NOT a live-July session; it is a הפרש from June
  const jul = Payout.monthlyPayoutSummary(rows, '2026-07');
  assert.ok(!jul.therapists.some((t) => t.therapist === 'מעיין דלומי' &&
    t.sessions.some((x) => x.sessionId === 'late1')), 'late June row is not live July');
  const diff = jul.differences.therapists.find((t) => t.therapist === 'מעיין דלומי');
  assert.ok(diff, 'late session surfaces as a הפרש');
  assert.equal(diff.paidCount, 1);
  assert.equal(diff.preVatTotal, 250);
  assert.equal(diff.sessions[0].month, '2026-06');         // originating month carried

  // re-forwarding June settles the late session -> the הפרש clears
  const re = markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows);
  assert.equal(re.res.forwarded, 1, 'only the new late row is stamped');
  const after = Payout.monthlyPayoutSummary(rows, '2026-07');
  assert.deepEqual(after.differences.therapists, []);
});

test('per-therapist independence in the view: one forwarded, the other still live', () => {
  const rows = baseRows();
  markForwarded({ therapist: 'מעיין דלומי', month: '2026-06' }, rows);
  const s = Payout.monthlyPayoutSummary(rows, '2026-06');
  // מעיין settled (excluded), דליה still showing her June session
  assert.ok(!s.therapists.some((t) => t.therapist === 'מעיין דלומי'));
  const dalia = s.therapists.find((t) => t.therapist === 'דליה מלמד');
  assert.equal(dalia.paidCount, 1);
});
