/**
 * therapist-payout.js
 * -----------------------------------------------------------------------------
 * Pure, READ-ONLY monthly therapist-payout summary computed from SessionLog rows
 * (the tab written by recordSessionOutcome). Step 1 of 4: display only — no
 * corrections, no export, no forward-marking. Those are later steps.
 *
 * Input: SessionLog rows + a target month 'YYYY-MM'. The month is matched on each
 * row's `date` — the SESSION (treatment) date — NOT `recordedAt` (the write
 * timestamp).
 *
 * PAY RULE (mirrors the pay side): only outcomes that PAY are summed —
 *   `happened` and `patient_no_show` (the therapist showed up, so a no-show still
 *   pays). `therapist_cancelled` is EXCLUDED from the total, but its count is
 *   surfaced (pay 0) for trust/visibility.
 *
 * Pre-VAT totals come straight from each row's stored `therapistPay` (already
 * pre-VAT, and already 0 for therapist_cancelled / group). The +VAT (gross) total
 * is derived via TherapistPay.withVat — never re-applied to the individual rows.
 *
 * SCOPE: standalone module. Consumed by the dashboard payout view; never writes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./therapist-pay'));   // Node / tests
  } else {
    root.TherapistPayout = factory(root.TherapistPay);       // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (TherapistPay) {
  'use strict';

  // Outcomes that pay (therapist showed up). therapist_cancelled is excluded.
  var PAID_OUTCOMES = { happened: true, patient_no_show: true };
  var EXCLUDED_OUTCOME = 'therapist_cancelled';

  function str(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round(n * 100) / 100; }

  // +VAT (gross) via the canonical helper; defensive 0.18 fallback if the pay
  // module isn't present (e.g. a stripped browser bundle).
  function withVat(amount) {
    if (TherapistPay && typeof TherapistPay.withVat === 'function') {
      return TherapistPay.withVat(amount);
    }
    return Number(amount) * 1.18;
  }

  // Extract 'YYYY-MM' from a date cell ('YYYY-MM-DD' as Sheets normalizes dates,
  // or a longer ISO string). Returns '' when there is no parseable year-month.
  function monthOf(dateCell) {
    var s = str(dateCell);
    var m = s.match(/^(\d{4})-(\d{2})/);
    return m ? (m[1] + '-' + m[2]) : '';
  }

  /**
   * monthlyPayoutSummary(rows, month) -> {
   *   month,                              // the resolved 'YYYY-MM'
   *   therapists: [{
   *     therapist, paidCount, sessionCount, excludedCancelledCount,
   *     preVatTotal, vatTotal,
   *     sessions: [{ sessionId, date, patient, type, outcome, pay, paid }]
   *   }],
   *   totals: { paidCount, excludedCancelledCount, preVatTotal, vatTotal }
   * }
   *
   * Rows whose `date` is not in `month` are ignored. The month arg accepts either
   * 'YYYY-MM' or a full 'YYYY-MM-DD'. An empty/whitespace month, a non-array
   * input, or no matching rows -> empty therapists list (no crash).
   */
  function monthlyPayoutSummary(rows, month) {
    var target = monthOf(month);
    var out = {
      month: target,
      therapists: [],
      totals: { paidCount: 0, excludedCancelledCount: 0, preVatTotal: 0, vatTotal: 0 }
    };
    if (!Array.isArray(rows) || !target) return out;

    var byTherapist = {};
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      if (monthOf(row.date) !== target) continue;

      var name = str(row.therapist);
      if (!byTherapist[name]) {
        byTherapist[name] = {
          therapist: name, paidCount: 0, sessionCount: 0,
          excludedCancelledCount: 0, preVatTotal: 0, sessions: []
        };
        order.push(name);
      }
      var t = byTherapist[name];
      var outcome = str(row.outcome);
      var isPaid = PAID_OUTCOMES[outcome] === true;
      var pay = num(row.therapistPay);

      t.sessionCount++;
      if (isPaid) { t.paidCount++; t.preVatTotal += pay; }
      else if (outcome === EXCLUDED_OUTCOME) { t.excludedCancelledCount++; }

      t.sessions.push({
        sessionId: str(row.sessionId),
        date: str(row.date),
        patient: str(row.patientName),
        type: str(row.clinicalTreatmentType),
        outcome: outcome,
        pay: isPaid ? pay : 0,   // non-paying outcomes show 0 for visibility
        paid: isPaid
      });
    }

    order.sort(function (a, b) { return a.localeCompare(b, 'he'); });
    for (var k = 0; k < order.length; k++) {
      var th = byTherapist[order[k]];
      th.sessions.sort(function (a, b) {
        return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
      });
      th.preVatTotal = round2(th.preVatTotal);
      th.vatTotal = round2(withVat(th.preVatTotal));
      out.therapists.push(th);
      out.totals.paidCount += th.paidCount;
      out.totals.excludedCancelledCount += th.excludedCancelledCount;
      out.totals.preVatTotal += th.preVatTotal;
    }
    out.totals.preVatTotal = round2(out.totals.preVatTotal);
    out.totals.vatTotal = round2(withVat(out.totals.preVatTotal));
    return out;
  }

  return {
    PAID_OUTCOMES: PAID_OUTCOMES,
    EXCLUDED_OUTCOME: EXCLUDED_OUTCOME,
    monthOf: monthOf,
    monthlyPayoutSummary: monthlyPayoutSummary
  };
});
