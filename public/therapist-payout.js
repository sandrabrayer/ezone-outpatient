/**
 * therapist-payout.js
 * -----------------------------------------------------------------------------
 * Pure monthly therapist-payout summary computed from SessionLog rows (the tab
 * written by recordSessionOutcome). The summary is the data behind the payout
 * screen's read view, its Excel export, and its mark-forwarded action.
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
 * FORWARDING + הפרשים (differences): once מורן forwards a therapist's month to
 * payroll, every SessionLog row for that (therapist, month) is stamped with a
 * non-empty `forwardedToPayroll` (the closed 'YYYY-MM'). Stamped rows are SETTLED
 * — excluded from every view so they never appear again. But a session logged
 * LATE for an already-forwarded month (its own row still unstamped, while sibling
 * rows of that month ARE stamped) surfaces as a הפרש: a catch-up line carried into
 * the current cycle. Differences are reported in their own `differences` block so
 * payroll can pay them alongside the live month.
 *
 * SCOPE: standalone, side-effect-free module. Consumed by the dashboard payout
 * view + export; it computes, it never writes.
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

  // Extract 'YYYY-MM' from a date cell. Handles BOTH formats seen in real data:
  //   1. ISO 'YYYY-MM-DD' (or longer ISO) — how Sheets normalizes dates, and what
  //      the month picker / tests pass.
  //   2. A raw JS Date.toString() like 'Thu Jun 18 2026 00:00:00 GMT+0300' — what
  //      recordSessionOutcome actually stores from the Therapists app payload.
  // Try the cheap ISO regex first; otherwise fall back to new Date(s) and read the
  // LOCAL year/month. Returns '' for empty / unparseable input (Invalid Date).
  function monthOf(dateCell) {
    var s = str(dateCell);
    if (!s) return '';
    var m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return m[1] + '-' + m[2];
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // A row is SETTLED once it carries a non-empty forwardedToPayroll stamp — it has
  // already gone to payroll and must never appear in any view again.
  function isForwarded(row) { return str(row.forwardedToPayroll) !== ''; }

  // Group an arbitrary subset of SessionLog rows into the per-therapist payout
  // shape (the same shape for the live month and for the הפרשים block). Pure.
  function groupSummary(subset) {
    var byTherapist = {};
    var order = [];
    for (var i = 0; i < subset.length; i++) {
      var row = subset[i] || {};
      var name = str(row.therapist);
      if (!byTherapist[name]) {
        byTherapist[name] = {
          therapist: name, paidCount: 0, sessionCount: 0,
          excludedCancelledCount: 0, preVatTotal: 0, sessions: [], months: []
        };
        order.push(name);
      }
      var t = byTherapist[name];
      var outcome = str(row.outcome);
      var isPaid = PAID_OUTCOMES[outcome] === true;
      var pay = num(row.therapistPay);
      var rowMonth = monthOf(row.date);

      t.sessionCount++;
      if (isPaid) { t.paidCount++; t.preVatTotal += pay; }
      else if (outcome === EXCLUDED_OUTCOME) { t.excludedCancelledCount++; }
      if (rowMonth && t.months.indexOf(rowMonth) === -1) t.months.push(rowMonth);

      t.sessions.push({
        sessionId: str(row.sessionId),
        date: str(row.date),
        month: rowMonth,
        phone: str(row.phone),          // carried for the correction path (credit re-run)
        patient: str(row.patientName),
        type: str(row.clinicalTreatmentType),
        outcome: outcome,
        pay: isPaid ? pay : 0,          // non-paying outcomes show 0 for visibility
        paid: isPaid
      });
    }

    order.sort(function (a, b) { return a.localeCompare(b, 'he'); });
    var result = {
      therapists: [],
      totals: { paidCount: 0, excludedCancelledCount: 0, preVatTotal: 0, vatTotal: 0 }
    };
    for (var k = 0; k < order.length; k++) {
      var th = byTherapist[order[k]];
      th.sessions.sort(function (a, b) {
        return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
      });
      th.months.sort();
      th.preVatTotal = round2(th.preVatTotal);
      th.vatTotal = round2(withVat(th.preVatTotal));
      result.therapists.push(th);
      result.totals.paidCount += th.paidCount;
      result.totals.excludedCancelledCount += th.excludedCancelledCount;
      result.totals.preVatTotal += th.preVatTotal;
    }
    result.totals.preVatTotal = round2(result.totals.preVatTotal);
    result.totals.vatTotal = round2(withVat(result.totals.preVatTotal));
    return result;
  }

  /**
   * monthlyPayoutSummary(rows, month) -> {
   *   month,                              // the resolved 'YYYY-MM'
   *   therapists: [{
   *     therapist, paidCount, sessionCount, excludedCancelledCount,
   *     preVatTotal, vatTotal, months,
   *     sessions: [{ sessionId, date, month, phone, patient, type, outcome, pay, paid }]
   *   }],
   *   totals: { paidCount, excludedCancelledCount, preVatTotal, vatTotal },
   *   differences: { therapists: [ …same shape… ], totals: {…} }  // הפרשים
   * }
   *
   * Settled rows (forwardedToPayroll set) are excluded everywhere. A row whose own
   * month is CLOSED for its therapist (a sibling row of that month is settled) but
   * which is itself still unsettled is a הפרש — reported under `differences`
   * (capped at months <= the viewed month; never a future leak). Everything else
   * unsettled in the viewed month, whose month is NOT yet closed, is the live
   * payout.
   *
   * The month arg accepts 'YYYY-MM' or a full 'YYYY-MM-DD'. An empty/whitespace
   * month, a non-array input, or no matching rows -> empty lists (no crash).
   */
  function monthlyPayoutSummary(rows, month) {
    var target = monthOf(month);
    var empty = { therapists: [], totals: { paidCount: 0, excludedCancelledCount: 0, preVatTotal: 0, vatTotal: 0 } };
    var out = {
      month: target,
      therapists: empty.therapists,
      totals: empty.totals,
      differences: { therapists: [], totals: { paidCount: 0, excludedCancelledCount: 0, preVatTotal: 0, vatTotal: 0 } }
    };
    if (!Array.isArray(rows) || !target) return out;

    // 1) Which (therapist, month) pairs are CLOSED? A month is closed for a
    //    therapist as soon as ANY of that therapist's rows in it is settled.
    var closed = {};   // therapist -> { 'YYYY-MM': true }
    for (var i = 0; i < rows.length; i++) {
      var fr = rows[i] || {};
      if (!isForwarded(fr)) continue;
      var fName = str(fr.therapist);
      var fMonth = monthOf(fr.forwardedToPayroll) || monthOf(fr.date);
      if (!fMonth) continue;
      if (!closed[fName]) closed[fName] = {};
      closed[fName][fMonth] = true;
    }

    // 2) Partition the UNsettled rows into the live month vs. carried-over הפרשים.
    var currentRows = [];
    var diffRows = [];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j] || {};
      if (isForwarded(row)) continue;                 // settled -> never shown
      var rm = monthOf(row.date);
      if (!rm) continue;
      var name = str(row.therapist);
      var isClosed = !!(closed[name] && closed[name][rm]);
      if (rm === target && !isClosed) {
        currentRows.push(row);                        // live, still-open month
      } else if (isClosed && rm <= target) {
        diffRows.push(row);                           // late row in a closed month
      }
      // else: a different, still-open month -> belongs to its own cycle, not here.
    }

    var current = groupSummary(currentRows);
    out.therapists = current.therapists;
    out.totals = current.totals;
    out.differences = groupSummary(diffRows);
    return out;
  }

  return {
    PAID_OUTCOMES: PAID_OUTCOMES,
    EXCLUDED_OUTCOME: EXCLUDED_OUTCOME,
    monthOf: monthOf,
    isForwarded: isForwarded,
    monthlyPayoutSummary: monthlyPayoutSummary
  };
});
