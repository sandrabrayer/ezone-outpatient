'use strict';

/**
 * Unit coverage for the pure CSV/row builder in public/payout-export.js
 * (step 4 of 4 — the payroll export מורן hands to חשבת שכר).
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Contracts locked:
 *   - a missing/empty summary still yields title + blank + header + totals (no crash)
 *   - one therapist row carries name · paidCount · pre-VAT · VAT · incl-VAT
 *   - the VAT column is the DIFFERENCE (incl-VAT total − pre-VAT), never
 *     re-derived per row, so preVat + vat === total round-trips exactly
 *   - the הפרשים section appears ONLY when late prior-month differences exist,
 *     and then uses the wider DIFF_HEADER (with a חודש column)
 *   - buildPayoutCsv emits CRLF line endings and NO BOM (the download step adds it)
 *   - cells with a comma / quote / newline are RFC-4180 quoted
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const PayoutExport = require('../public/payout-export');

const { HEADER, DIFF_HEADER, buildPayoutRows, buildPayoutCsv } = PayoutExport;

test('empty / missing summary -> title + blank + header + zero totals, no crash', () => {
  const rows = buildPayoutRows();
  assert.deepEqual(rows[0], ['תשלומי מטפלים', '']);
  assert.deepEqual(rows[1], []);
  assert.deepEqual(rows[2], HEADER);
  assert.deepEqual(rows[3], ['סה״כ', 0, 0, 0, 0]);
  // no differences -> nothing after the totals row
  assert.equal(rows.length, 4);
});

test('one therapist row: name, paidCount, pre-VAT, VAT, incl-VAT + totals row', () => {
  const rows = buildPayoutRows({
    month: '2026-06',
    therapists: [{ therapist: 'דנה', paidCount: 3, preVatTotal: 750, vatTotal: 877.5 }],
    totals: { paidCount: 3, preVatTotal: 750, vatTotal: 877.5 }
  });
  assert.deepEqual(rows[0], ['תשלומי מטפלים', '2026-06']);
  assert.deepEqual(rows[3], ['דנה', 3, 750, 127.5, 877.5]); // VAT = 877.5 − 750
  assert.deepEqual(rows[4], ['סה״כ', 3, 750, 127.5, 877.5]);
});

test('VAT column is (incl-VAT total − pre-VAT), NOT a per-row re-derivation', () => {
  // 118.5 − 100 = 18.5, which is deliberately NOT 100 * 0.17 (= 17).
  const rows = buildPayoutRows({
    month: '2026-06',
    therapists: [{ therapist: 'רון', paidCount: 1, preVatTotal: 100, vatTotal: 118.5 }],
    totals: { paidCount: 1, preVatTotal: 100, vatTotal: 118.5 }
  });
  assert.equal(rows[3][3], 18.5);
  // and it round-trips: preVat + vat === total
  assert.equal(rows[3][2] + rows[3][3], rows[3][4]);
});

test('הפרשים section appears only when differences exist, with the wider DIFF_HEADER', () => {
  const noDiff = buildPayoutRows({
    month: '2026-06',
    therapists: [{ therapist: 'דנה', paidCount: 1, preVatTotal: 250, vatTotal: 292.5 }],
    totals: { paidCount: 1, preVatTotal: 250, vatTotal: 292.5 }
  });
  assert.ok(!noDiff.some(r => r[0] === 'הפרשים (סשנים מחודשים קודמים שכבר הועברו)'));

  const withDiff = buildPayoutRows({
    month: '2026-06',
    therapists: [{ therapist: 'דנה', paidCount: 1, preVatTotal: 250, vatTotal: 292.5 }],
    totals: { paidCount: 1, preVatTotal: 250, vatTotal: 292.5 },
    differences: {
      therapists: [{ therapist: 'רון', months: ['2026-04', '2026-05'], paidCount: 2, preVatTotal: 500, vatTotal: 585 }],
      totals: { paidCount: 2, preVatTotal: 500, vatTotal: 585 }
    }
  });
  const sub = withDiff.findIndex(r => r[0] === 'הפרשים (סשנים מחודשים קודמים שכבר הועברו)');
  assert.ok(sub > -1);
  assert.deepEqual(withDiff[sub + 1], DIFF_HEADER);
  assert.deepEqual(withDiff[sub + 2], ['רון', '2026-04, 2026-05', 2, 500, 85, 585]);
  assert.deepEqual(withDiff[sub + 3], ['סה״כ הפרשים', '', 2, 500, 85, 585]);
});

test('buildPayoutCsv emits CRLF line endings and no leading BOM', () => {
  const csv = buildPayoutCsv({
    month: '2026-06',
    therapists: [{ therapist: 'דנה', paidCount: 3, preVatTotal: 750, vatTotal: 877.5 }],
    totals: { paidCount: 3, preVatTotal: 750, vatTotal: 877.5 }
  });
  assert.ok(csv.includes('\r\n'));
  assert.ok(!csv.startsWith('﻿'));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'תשלומי מטפלים,2026-06');
  assert.equal(lines[1], '');
  assert.equal(lines[2], HEADER.join(','));
  assert.equal(lines[3], 'דנה,3,750,127.5,877.5');
});

test('RFC-4180: cells with a comma or quote are wrapped and embedded quotes doubled', () => {
  const csv = buildPayoutCsv({
    month: '2026-06',
    therapists: [
      { therapist: 'לוי, יוסי', paidCount: 1, preVatTotal: 250, vatTotal: 292.5 },
      { therapist: 'ד"ר כהן', paidCount: 1, preVatTotal: 100, vatTotal: 117 }
    ],
    totals: { paidCount: 2, preVatTotal: 350, vatTotal: 409.5 }
  });
  const lines = csv.split('\r\n');
  assert.equal(lines[3], '"לוי, יוסי",1,250,42.5,292.5');
  assert.equal(lines[4], '"ד""ר כהן",1,100,17,117');
});
