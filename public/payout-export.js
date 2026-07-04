/**
 * payout-export.js
 * -----------------------------------------------------------------------------
 * Pure CSV builder for the monthly therapist-payout spreadsheet מורן hands to
 * חשבת שכר (payroll). Input is the summary object produced by
 * TherapistPayout.monthlyPayoutSummary; output is plain CSV text (Excel opens it
 * directly — UTF-8 BOM is prepended by the download step, NOT here, so the pure
 * string stays clean for tests).
 *
 * Layout:
 *   title row              תשלומי מטפלים · <month>
 *   (blank)
 *   header                 מטפל · סשנים משולמים · לפני מע״מ · מע״מ · כולל מע״מ
 *   one row per therapist  name · paidCount · preVat · vat · total(incl VAT)
 *   totals                 סה״כ · …
 *   (blank)
 *   הפרשים section (only when differences exist): a sub-header naming the late
 *   prior-month sessions, a header row WITH a חודש column, one row per therapist
 *   (the month(s) the carried-over sessions came from), and a הפרשים total.
 *
 * The VAT column is the DIFFERENCE total - pre-VAT total (so it round-trips to the
 * incl-VAT total), never re-derived per row. Build is deterministic and
 * side-effect-free.
 *
 * SCOPE: standalone module. Consumed by the dashboard export button; no I/O.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.PayoutExport = api;         // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round(n * 100) / 100; }
  // VAT portion = incl-VAT total minus the pre-VAT total (keeps the columns
  // internally consistent: preVat + vat === total).
  function vatPortion(preVat, total) { return round2(num(total) - num(preVat)); }

  var HEADER = ['מטפל', 'סשנים משולמים', 'לפני מע״מ', 'מע״מ', 'כולל מע״מ'];
  var DIFF_HEADER = ['מטפל', 'חודש', 'סשנים משולמים', 'לפני מע״מ', 'מע״מ', 'כולל מע״מ'];

  /**
   * buildPayoutRows(summary) -> Array<Array<string|number>>
   * The full spreadsheet as a row matrix (handy for tests + for any non-CSV
   * renderer). Tolerates a missing/empty summary -> just the title + header.
   */
  function buildPayoutRows(summary) {
    summary = summary || {};
    var month = summary.month || '';
    var therapists = (summary.therapists) || [];
    var totals = summary.totals || { paidCount: 0, preVatTotal: 0, vatTotal: 0 };
    var diffs = (summary.differences && summary.differences.therapists) || [];
    var diffTotals = (summary.differences && summary.differences.totals) ||
      { paidCount: 0, preVatTotal: 0, vatTotal: 0 };

    var rows = [];
    rows.push(['תשלומי מטפלים', month]);
    rows.push([]);
    rows.push(HEADER.slice());

    therapists.forEach(function (t) {
      rows.push([
        t.therapist || '',
        num(t.paidCount),
        round2(num(t.preVatTotal)),
        vatPortion(t.preVatTotal, t.vatTotal),
        round2(num(t.vatTotal))
      ]);
    });
    rows.push([
      'סה״כ',
      num(totals.paidCount),
      round2(num(totals.preVatTotal)),
      vatPortion(totals.preVatTotal, totals.vatTotal),
      round2(num(totals.vatTotal))
    ]);

    // הפרשים — late sessions for already-forwarded prior months (only if any).
    if (diffs.length) {
      rows.push([]);
      rows.push(['הפרשים (סשנים מחודשים קודמים שכבר הועברו)']);
      rows.push(DIFF_HEADER.slice());
      diffs.forEach(function (t) {
        rows.push([
          t.therapist || '',
          (t.months || []).join(', '),
          num(t.paidCount),
          round2(num(t.preVatTotal)),
          vatPortion(t.preVatTotal, t.vatTotal),
          round2(num(t.vatTotal))
        ]);
      });
      rows.push([
        'סה״כ הפרשים',
        '',
        num(diffTotals.paidCount),
        round2(num(diffTotals.preVatTotal)),
        vatPortion(diffTotals.preVatTotal, diffTotals.vatTotal),
        round2(num(diffTotals.vatTotal))
      ]);
    }

    return rows;
  }

  // RFC-4180 cell quoting: wrap in double quotes (and double any embedded quote)
  // only when the cell contains a comma, quote, CR, or LF.
  function csvCell(v) {
    var s = (v === undefined || v === null) ? '' : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * buildPayoutCsv(summary) -> CSV text (CRLF line endings, no BOM).
   */
  function buildPayoutCsv(summary) {
    return buildPayoutRows(summary).map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
  }

  return {
    HEADER: HEADER,
    DIFF_HEADER: DIFF_HEADER,
    buildPayoutRows: buildPayoutRows,
    buildPayoutCsv: buildPayoutCsv
  };
});
