'use strict';

/**
 * Unit coverage for the pure CSV export in public/payout-export.js — the monthly
 * payout spreadsheet מורן hands to חשבת שכר. It is built straight from a
 * TherapistPayout.monthlyPayoutSummary object, so this test drives the two
 * together (real summary -> rows/CSV) rather than hand-rolling a summary.
 *
 * Run with:  npm test
 *
 * Contracts locked:
 *   - one row per therapist: name, paid session count, pre-VAT, VAT, total incl VAT
 *   - the VAT column = total - preVat (preVat + vat round-trips to total)
 *   - a סה״כ totals row across therapists
 *   - a הפרשים section appears ONLY when late prior-month differences exist, with
 *     its own header (incl. a חודש column) + its own total
 *   - CSV quotes cells containing commas (the months list)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Payout = require('../public/therapist-payout');
const PE = require('../public/payout-export');

// June log: מעיין (2 paid @250 + 1 cancelled) and דליה (1 paid @230).
const JUNE = [
  { sessionId: 's1', therapist: 'מעיין דלומי', patientName: 'אורי', clinicalTreatmentType: 'פרטני CBT',
    date: '2026-06-03', outcome: 'happened', therapistPay: 250 },
  { sessionId: 's2', therapist: 'מעיין דלומי', patientName: 'דנה', clinicalTreatmentType: 'פרטני CBT',
    date: '2026-06-10', outcome: 'patient_no_show', therapistPay: 250 },
  { sessionId: 's3', therapist: 'מעיין דלומי', patientName: 'רון', clinicalTreatmentType: 'פרטני CBT',
    date: '2026-06-12', outcome: 'therapist_cancelled', therapistPay: 0 },
  { sessionId: 's4', therapist: 'דליה מלמד', patientName: 'מאיה', clinicalTreatmentType: 'פרטני כללי',
    date: '2026-06-05', outcome: 'happened', therapistPay: 230 }
];

test('one row per therapist: name, paid count, preVat, VAT, total incl VAT', () => {
  const summary = Payout.monthlyPayoutSummary(JUNE, '2026-06');
  const rows = PE.buildPayoutRows(summary);

  // title + blank + header up top
  assert.deepEqual(rows[0], ['תשלומי מטפלים', '2026-06']);
  assert.deepEqual(rows[2], PE.HEADER);

  const maayan = rows.find((r) => r[0] === 'מעיין דלומי');
  // [name, paidCount, preVat, vat, total]
  assert.equal(maayan[1], 2);
  assert.equal(maayan[2], 500);          // pre-VAT
  assert.equal(maayan[4], 590);          // 500 * 1.18 incl VAT
  assert.equal(maayan[3], 90);           // VAT portion = total - preVat
  assert.equal(maayan[2] + maayan[3], maayan[4]);

  const dalia = rows.find((r) => r[0] === 'דליה מלמד');
  assert.equal(dalia[1], 1);
  assert.equal(dalia[2], 230);
  assert.equal(dalia[4], 271.4);         // 230 * 1.18
});

test('a סה״כ totals row across therapists', () => {
  const summary = Payout.monthlyPayoutSummary(JUNE, '2026-06');
  const rows = PE.buildPayoutRows(summary);
  const total = rows.find((r) => r[0] === 'סה״כ');
  assert.ok(total, 'totals row present');
  assert.equal(total[1], 3);             // 2 + 1 paid
  assert.equal(total[2], 730);           // 500 + 230 pre-VAT
  assert.equal(total[4], 861.4);         // 730 * 1.18
  assert.equal(total[3], 131.4);         // VAT portion
});

test('NO הפרשים section when there are no late differences', () => {
  const summary = Payout.monthlyPayoutSummary(JUNE, '2026-06');
  const csv = PE.buildPayoutCsv(summary);
  assert.ok(!csv.includes('הפרשים'), 'no diff section without late sessions');
});

test('הפרשים section appears with its own header + total when a late forwarded-month session exists', () => {
  // May was forwarded for דליה (s_may stamped). A late May session (s_late) was
  // logged afterwards — it carries over as a הפרש into the July view.
  const rows = [
    { sessionId: 's_may', therapist: 'דליה מלמד', clinicalTreatmentType: 'פרטני כללי',
      date: '2026-05-04', outcome: 'happened', therapistPay: 230, forwardedToPayroll: '2026-05' },
    { sessionId: 's_late', therapist: 'דליה מלמד', patientName: 'נועה', clinicalTreatmentType: 'פרטני כללי',
      date: '2026-05-28', outcome: 'happened', therapistPay: 230, forwardedToPayroll: '' },
    { sessionId: 's_jul', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT',
      date: '2026-07-02', outcome: 'happened', therapistPay: 250 }
  ];
  const summary = Payout.monthlyPayoutSummary(rows, '2026-07');
  const matrix = PE.buildPayoutRows(summary);

  // live month: only מעיין's July session
  assert.ok(matrix.find((r) => r[0] === 'מעיין דלומי'));

  // diff section header + the diff therapist row + a diff total
  const diffHeaderIdx = matrix.findIndex((r) => r[0] && r[0].indexOf('הפרשים') === 0);
  assert.ok(diffHeaderIdx !== -1, 'הפרשים sub-header present');
  assert.deepEqual(matrix[diffHeaderIdx + 1], PE.DIFF_HEADER);
  const diffRow = matrix.find((r) => r[0] === 'דליה מלמד' && r.length === PE.DIFF_HEADER.length);
  assert.ok(diffRow, 'diff therapist row present');
  assert.equal(diffRow[1], '2026-05');   // originating month
  assert.equal(diffRow[2], 1);           // one late paid session
  assert.equal(diffRow[3], 230);         // pre-VAT
  assert.equal(diffRow[5], 271.4);       // incl VAT
  const diffTotal = matrix.find((r) => r[0] === 'סה״כ הפרשים');
  assert.ok(diffTotal, 'diff total present');
  assert.equal(diffTotal[3], 230);
});

test('CSV quotes cells containing commas (multi-month diff list)', () => {
  const rows = [
    { sessionId: 'a', therapist: 'רמי', clinicalTreatmentType: 'פרטני CBT', date: '2026-04-04',
      outcome: 'happened', therapistPay: 250, forwardedToPayroll: '2026-04' },
    { sessionId: 'b', therapist: 'רמי', clinicalTreatmentType: 'פרטני CBT', date: '2026-04-20',
      outcome: 'happened', therapistPay: 250, forwardedToPayroll: '' },
    { sessionId: 'c', therapist: 'רמי', clinicalTreatmentType: 'פרטני CBT', date: '2026-05-05',
      outcome: 'happened', therapistPay: 250, forwardedToPayroll: '2026-05' },
    { sessionId: 'd', therapist: 'רמי', clinicalTreatmentType: 'פרטני CBT', date: '2026-05-22',
      outcome: 'happened', therapistPay: 250, forwardedToPayroll: '' }
  ];
  const summary = Payout.monthlyPayoutSummary(rows, '2026-06');
  const csv = PE.buildPayoutCsv(summary);
  // both late months listed, comma-joined, so the cell must be quoted
  assert.ok(csv.includes('"2026-04, 2026-05"'), 'multi-month list is CSV-quoted');
});

test('empty / missing summary -> just title + header rows, no crash', () => {
  assert.deepEqual(PE.buildPayoutRows(null)[2], PE.HEADER);
  assert.deepEqual(PE.buildPayoutRows({})[0], ['תשלומי מטפלים', '']);
  assert.ok(typeof PE.buildPayoutCsv(undefined) === 'string');
});
