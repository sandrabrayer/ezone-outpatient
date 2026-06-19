'use strict';

/**
 * Unit coverage for the pure monthly therapist-payout summary in
 * public/therapist-payout.js (read view, step 1 of 4).
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Contracts locked:
 *   - sums ONLY happened + patient_no_show; therapist_cancelled is excluded from
 *     the total (but its count is surfaced)
 *   - groups by therapist; the month filter keys on the SESSION date, not recordedAt
 *   - pre-VAT total comes from the stored therapistPay; +VAT via TherapistPay.withVat
 *   - a therapist with mixed outcomes totals correctly
 *   - empty / non-matching month -> empty summary, no crash
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const TP = require('../public/therapist-pay');
const Payout = require('../public/therapist-payout');

// +VAT total, rounded to 2 decimals exactly as the module does (avoids binary
// float noise like 180 * 1.18 = 212.39999999999998).
const vat = (n) => Math.round(TP.withVat(n) * 100) / 100;

// A small SessionLog fixture spanning two months and two therapists. `date` is
// the session date; `recordedAt` is deliberately a DIFFERENT month to prove the
// filter keys on `date`.
const ROWS = [
  // --- מעיין דלומי, 2026-06 ---
  { sessionId: 's1', therapist: 'מעיין דלומי', patientName: 'אורי', clinicalTreatmentType: 'פרטני CBT',
    date: '2026-06-03', outcome: 'happened', therapistPay: 250, recordedAt: '2026-07-01T00:00:00.000Z' },
  { sessionId: 's2', therapist: 'מעיין דלומי', patientName: 'דנה', clinicalTreatmentType: 'פרטני CBT',
    date: '2026-06-10', outcome: 'patient_no_show', therapistPay: 250, recordedAt: '2026-06-10T00:00:00.000Z' },
  { sessionId: 's3', therapist: 'מעיין דלומי', patientName: 'רון', clinicalTreatmentType: 'פרטני CBT',
    date: '2026-06-12', outcome: 'therapist_cancelled', therapistPay: 0, recordedAt: '2026-06-12T00:00:00.000Z' },
  // --- דליה מלמד, 2026-06 ---
  { sessionId: 's4', therapist: 'דליה מלמד', patientName: 'מאיה', clinicalTreatmentType: 'פרטני כללי',
    date: '2026-06-05', outcome: 'happened', therapistPay: 230, recordedAt: '2026-06-05T00:00:00.000Z' },
  // --- מעיין דלומי, 2026-07 (different month, must NOT count for June) ---
  { sessionId: 's5', therapist: 'מעיין דלומי', patientName: 'יעל', clinicalTreatmentType: 'פרטני CBT',
    date: '2026-07-02', outcome: 'happened', therapistPay: 250, recordedAt: '2026-07-02T00:00:00.000Z' }
];

test('sums only happened + patient_no_show; therapist_cancelled excluded from total', () => {
  const s = Payout.monthlyPayoutSummary(ROWS, '2026-06');
  const maayan = s.therapists.find((t) => t.therapist === 'מעיין דלומי');
  // s1 happened + s2 no_show pay; s3 cancelled excluded
  assert.equal(maayan.paidCount, 2);
  assert.equal(maayan.excludedCancelledCount, 1);
  assert.equal(maayan.sessionCount, 3);
  assert.equal(maayan.preVatTotal, 500);            // 250 + 250, NOT 500+0cancelled
});

test('groups by therapist; month filter uses session date (not recordedAt)', () => {
  const s = Payout.monthlyPayoutSummary(ROWS, '2026-06');
  const names = s.therapists.map((t) => t.therapist).sort();
  assert.deepEqual(names, ['דליה מלמד', 'מעיין דלומי'].sort());
  // s1 has recordedAt in July but date in June -> counts for June
  const maayan = s.therapists.find((t) => t.therapist === 'מעיין דלומי');
  assert.ok(maayan.sessions.some((x) => x.sessionId === 's1'));
  // s5 (July session) must NOT appear in June
  assert.ok(!maayan.sessions.some((x) => x.sessionId === 's5'));
  // July view: only s5
  const july = Payout.monthlyPayoutSummary(ROWS, '2026-07');
  const maayanJul = july.therapists.find((t) => t.therapist === 'מעיין דלומי');
  assert.equal(maayanJul.paidCount, 1);
  assert.equal(maayanJul.preVatTotal, 250);
});

test('pre-VAT and +VAT totals correct (via TherapistPay.withVat)', () => {
  const s = Payout.monthlyPayoutSummary(ROWS, '2026-06');
  const maayan = s.therapists.find((t) => t.therapist === 'מעיין דלומי');
  assert.equal(maayan.preVatTotal, 500);
  assert.equal(maayan.vatTotal, vat(500));   // 500 * 1.18 = 590
  assert.equal(maayan.vatTotal, 590);
  // grand totals across therapists: 500 (מעיין) + 230 (דליה) = 730 pre-VAT
  assert.equal(s.totals.preVatTotal, 730);
  assert.equal(s.totals.vatTotal, vat(730)); // 861.4
  assert.equal(s.totals.excludedCancelledCount, 1);
});

test('a therapist with mixed outcomes totals correctly + per-session breakdown', () => {
  const rows = [
    { sessionId: 'a', therapist: 'רמי', date: '2026-06-01', outcome: 'happened', therapistPay: 250,
      patientName: 'פ', clinicalTreatmentType: 'פרטני' },
    { sessionId: 'b', therapist: 'רמי', date: '2026-06-09', outcome: 'patient_no_show', therapistPay: 250,
      patientName: 'ק', clinicalTreatmentType: 'פרטני' },
    { sessionId: 'c', therapist: 'רמי', date: '2026-06-15', outcome: 'therapist_cancelled', therapistPay: 0,
      patientName: 'ר', clinicalTreatmentType: 'פרטני' }
  ];
  const s = Payout.monthlyPayoutSummary(rows, '2026-06');
  const rami = s.therapists[0];
  assert.equal(rami.therapist, 'רמי');
  assert.equal(rami.paidCount, 2);
  assert.equal(rami.excludedCancelledCount, 1);
  assert.equal(rami.preVatTotal, 500);
  assert.equal(rami.vatTotal, 590);
  // breakdown carries every session, sorted by date, cancelled shown with pay 0
  assert.equal(rami.sessions.length, 3);
  assert.deepEqual(rami.sessions.map((x) => x.sessionId), ['a', 'b', 'c']);
  const cancelled = rami.sessions.find((x) => x.outcome === 'therapist_cancelled');
  assert.equal(cancelled.pay, 0);
  assert.equal(cancelled.paid, false);
  const noShow = rami.sessions.find((x) => x.outcome === 'patient_no_show');
  assert.equal(noShow.pay, 250);
  assert.equal(noShow.paid, true);
  assert.equal(noShow.patient, 'ק');
  assert.equal(noShow.type, 'פרטני');
});

test('empty / non-matching month -> empty summary, no crash', () => {
  // a month with no rows
  const none = Payout.monthlyPayoutSummary(ROWS, '2025-01');
  assert.deepEqual(none.therapists, []);
  assert.equal(none.totals.preVatTotal, 0);
  assert.equal(none.totals.vatTotal, 0);
  // empty / missing / junk month args
  assert.deepEqual(Payout.monthlyPayoutSummary(ROWS, '').therapists, []);
  assert.deepEqual(Payout.monthlyPayoutSummary(ROWS, '   ').therapists, []);
  assert.deepEqual(Payout.monthlyPayoutSummary(ROWS, null).therapists, []);
  // empty / non-array rows
  assert.deepEqual(Payout.monthlyPayoutSummary([], '2026-06').therapists, []);
  assert.deepEqual(Payout.monthlyPayoutSummary(null, '2026-06').therapists, []);
  assert.deepEqual(Payout.monthlyPayoutSummary(undefined, undefined).therapists, []);
});

test('month arg accepts a full YYYY-MM-DD as well as YYYY-MM', () => {
  const a = Payout.monthlyPayoutSummary(ROWS, '2026-06');
  const b = Payout.monthlyPayoutSummary(ROWS, '2026-06-30');
  assert.equal(b.month, '2026-06');
  assert.deepEqual(b.totals, a.totals);
});

test('therapistPay stored as a numeric string is coerced (Sheets cell safety)', () => {
  const rows = [
    { sessionId: 'x', therapist: 'אסתר', date: '2026-06-01', outcome: 'happened', therapistPay: '180' }
  ];
  const s = Payout.monthlyPayoutSummary(rows, '2026-06');
  assert.equal(s.therapists[0].preVatTotal, 180);
  assert.equal(s.therapists[0].vatTotal, vat(180));
});
