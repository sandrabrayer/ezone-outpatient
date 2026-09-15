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
 * PAY RULE (mirrors the pay side). A row pays only if BOTH its outcome and its
 * `payStatus` allow it — the outcome alone is no longer enough:
 *   `happened`            -> pays (the gate never applies to it).
 *   `patient_no_show`     -> now an APPROVAL GATE rather than automatic pay. A
 *                            'pending_decision' row pays 0 and is NOT summed; a
 *                            'declined' row pays 0 forever; an 'approved' row
 *                            pays the ordinary rate.
 *   `therapist_cancelled` -> EXCLUDED from the total, count surfaced (pay 0).
 *
 * The check WITHHOLDS on an explicit pending/declined rather than requiring an
 * explicit 'approved' — see paysFor() for why a blank payStatus must keep
 * paying (group no-shows, and every row written before the column existed).
 *
 * PENDING ROWS ARE SHOWN, NOT HIDDEN. They appear in the per-session breakdown
 * with pay 0 and `pending: true`, and are counted in `pendingCount`, so מורן can
 * see that a session exists and why it is not in the total. They are excluded
 * from every money figure, and `_markForwarded` refuses to send them to payroll.
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

  // Outcomes that CAN pay (the therapist showed up). Necessary, no longer
  // sufficient: patient_no_show also needs an approved payStatus — see paysFor.
  // therapist_cancelled is excluded outright.
  var PAID_OUTCOMES = { happened: true, patient_no_show: true };
  var EXCLUDED_OUTCOME = 'therapist_cancelled';

  // Outcomes whose pay a person must approve before it counts.
  var GATED_OUTCOMES = { patient_no_show: true };
  var PAY_STATUS_PENDING  = 'pending_decision';
  var PAY_STATUS_APPROVED = 'approved';
  var PAY_STATUS_DECLINED = 'declined';

  /* Is this row still waiting on a person? Only a gated outcome can be. */
  function isPending(row) {
    row = row || {};
    return GATED_OUTCOMES[str(row.outcome)] === true &&
           str(row.payStatus) === PAY_STATUS_PENDING;
  }
  /* Was this row's pay decided and refused? */
  function isDeclined(row) {
    row = row || {};
    return GATED_OUTCOMES[str(row.outcome)] === true &&
           str(row.payStatus) === PAY_STATUS_DECLINED;
  }
  /* Does this row contribute its therapistPay to the payout total?
   *
   * The rule is WITHHOLDING, not allow-listing: a paying outcome pays unless
   * its payStatus explicitly withholds it ('pending_decision' or 'declined').
   * That direction is deliberate, and the alternative ("pays only on an
   * explicit 'approved'") would be wrong here, because a BLANK payStatus has
   * three legitimate meanings and none of them is "unpaid":
   *
   *   1. `happened` / `therapist_cancelled` — the gate never applied.
   *   2. A GROUP no-show — group pay is a decided 0 that no approval could
   *      change, so it is never queued and never carries a status.
   *   3. A no-show row written BEFORE this column existed. Every historical
   *      row reads '' with its real, already-paid rate still in therapistPay.
   *
   * Requiring 'approved' would silently drop case 3 out of the payout totals —
   * retroactively rewriting past months' pay for rows nobody decided about,
   * which is exactly the kind of unannounced money change this gate exists to
   * prevent. Withholding keeps history intact: only rows this feature actually
   * wrote as pending or declined are held back, and those already carry
   * therapistPay 0, so the money total agrees with the count either way.
   * PAY_STATUS_APPROVED is still meaningful — it is what a decided row carries,
   * and what the UI reads to show who approved it. */
  function paysFor(row) {
    row = row || {};
    var outcome = str(row.outcome);
    if (PAID_OUTCOMES[outcome] !== true) return false;
    return !isPending(row) && !isDeclined(row);
  }

  function str(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* What a PENDING row would pay if approved. A pending row stores
   * therapistPay 0, so the figure has to be looked up from the rate table —
   * the client-side mirror of the same table the server approval uses. It is
   * EXPOSURE, never money owed: it is reported separately and is never folded
   * into preVatTotal. Fail-soft: an unknown therapist or a rate lookup that
   * throws contributes 0 rather than breaking the whole view. */
  function rateIfApproved(row) {
    row = row || {};
    if (num(row.rateIfApproved) > 0) return num(row.rateIfApproved);  // server-supplied, if present
    if (!TherapistPay || typeof TherapistPay.therapistPay !== 'function') return 0;
    try {
      return num(TherapistPay.therapistPay(str(row.therapist), str(row.clinicalTreatmentType)));
    } catch (_) {
      return 0;
    }
  }

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
          excludedCancelledCount: 0, pendingCount: 0, declinedCount: 0,
          pendingRate: 0, preVatTotal: 0, sessions: [], months: []
        };
        order.push(name);
      }
      var t = byTherapist[name];
      var outcome = str(row.outcome);
      var pending = isPending(row);
      var declined = isDeclined(row);
      var isPaid = paysFor(row);
      var pay = num(row.therapistPay);
      var rowMonth = monthOf(row.date);

      t.sessionCount++;
      if (isPaid) { t.paidCount++; t.preVatTotal += pay; }
      else if (pending) { t.pendingCount++; t.pendingRate += rateIfApproved(row); }
      else if (declined) { t.declinedCount++; }
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
        paid: isPaid,
        // What approving this pending row would pay (0 for any other row).
        // Exposure only — never part of any total.
        rateIfApproved: pending ? rateIfApproved(row) : 0,
        // Pay-decision surface. A pending row is SHOWN (never hidden) with pay 0
        // so מורן can see the session exists and why it is not in the total.
        payStatus: str(row.payStatus),
        pending: pending,
        declined: declined,
        approvedBy: str(row.approvedBy),
        declineReason: str(row.declineReason),
        decidedAt: str(row.decidedAt)
      });
    }

    order.sort(function (a, b) { return a.localeCompare(b, 'he'); });
    var result = {
      therapists: [],
      totals: {
        paidCount: 0, excludedCancelledCount: 0,
        pendingCount: 0, declinedCount: 0, pendingRate: 0,
        preVatTotal: 0, vatTotal: 0
      }
    };
    for (var k = 0; k < order.length; k++) {
      var th = byTherapist[order[k]];
      th.sessions.sort(function (a, b) {
        return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
      });
      th.months.sort();
      th.preVatTotal = round2(th.preVatTotal);
      th.vatTotal = round2(withVat(th.preVatTotal));
      th.pendingRate = round2(th.pendingRate);
      result.therapists.push(th);
      result.totals.paidCount += th.paidCount;
      result.totals.excludedCancelledCount += th.excludedCancelledCount;
      result.totals.pendingCount += th.pendingCount;
      result.totals.declinedCount += th.declinedCount;
      result.totals.pendingRate += th.pendingRate;
      result.totals.preVatTotal += th.preVatTotal;
    }
    // pendingRate is NOT money owed — it is what the pending rows WOULD add if
    // every one were approved. It is never folded into preVatTotal/vatTotal.
    result.totals.pendingRate = round2(result.totals.pendingRate);
    result.totals.preVatTotal = round2(result.totals.preVatTotal);
    result.totals.vatTotal = round2(withVat(result.totals.preVatTotal));
    return result;
  }

  /**
   * monthlyPayoutSummary(rows, month) -> {
   *   month,                              // the resolved 'YYYY-MM'
   *   therapists: [{
   *     therapist, paidCount, sessionCount, excludedCancelledCount,
   *     pendingCount, declinedCount, pendingRate, preVatTotal, vatTotal, months,
   *     sessions: [{ sessionId, date, month, phone, patient, type, outcome, pay,
   *                  paid, payStatus, pending, declined, approvedBy,
   *                  declineReason, decidedAt }]
   *   }],
   *   totals: { paidCount, excludedCancelledCount, pendingCount, declinedCount,
   *             pendingRate, preVatTotal, vatTotal },
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
    GATED_OUTCOMES: GATED_OUTCOMES,
    PAY_STATUS_PENDING: PAY_STATUS_PENDING,
    PAY_STATUS_APPROVED: PAY_STATUS_APPROVED,
    PAY_STATUS_DECLINED: PAY_STATUS_DECLINED,
    isPending: isPending,
    isDeclined: isDeclined,
    paysFor: paysFor,
    monthOf: monthOf,
    isForwarded: isForwarded,
    monthlyPayoutSummary: monthlyPayoutSummary
  };
});
