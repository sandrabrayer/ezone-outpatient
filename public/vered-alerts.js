/**
 * vered-alerts.js
 * -----------------------------------------------------------------------------
 * Pure, framework-free helpers for Vered's two OUT-dashboard alerts:
 *
 *   (a) credit alert  — active patients who owe a make-up session
 *                       (Clients.creditsOwed > 0), so Vered knows a make-up
 *                       is owed.
 *   (b) renewal alert — active patients whose treatment-month ends within
 *                       RENEWAL_WINDOW_DAYS days (≈ 1 week before the cycle
 *                       ends — time to collect the next monthly payment).
 *
 * Same UMD pattern as charges-logic.js / billing-status.js: Node tests
 * `require()` this module; `public/app.js` keeps an inline mirror of the same
 * rules because the browser has no build step. Any rule change must update
 * BOTH places together.
 *
 * Billing cycle (see CHANGELOG-vered-alerts.md / Step A): the treatment-month
 * end date is the renewal anchor + 1 calendar month, where the anchor is the
 * last monthly payment date (`paymentDate`) when present, else the treatment
 * start date (`startDate`). When neither exists there is no cycle date — such
 * a patient is FLAGGED ('missing'), never crashed.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VeredAlerts = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Collect the next monthly payment when the treatment-month ends within this
  // many days. Named constant so the renewal banner and these alerts agree.
  var RENEWAL_WINDOW_DAYS = 7;

  var FINISHED_STATUS = 'סיים טיפול';

  // Normalize a credit balance to a non-negative integer count. Blank/legacy
  // cells and junk values read as 0 (no make-up owed).
  function toCredits(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  // "Active" = any patient who has not finished treatment.
  function isActive(c) { return !!c && c.status !== FINISHED_STATUS; }

  // Add 1 calendar month to an ISO date string, clamping to the last day of the
  // target month (Jan 31 + 1mo -> Feb 28). Mirrors addMonth in public/app.js
  // and public/charges-logic.js — keep in sync.
  function addMonth(isoDate) {
    if (!isoDate) return '';
    var d = new Date(isoDate);
    if (isNaN(d)) return '';
    var origDay = d.getDate();
    d.setMonth(d.getMonth() + 1);
    if (d.getDate() !== origDay) d.setDate(0);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // The ISO date on which a client's treatment-month ends (next renewal /
  // billing due). Anchor precedence: packageChangeDate (a שינוי חבילה re-anchors
  // the cycle), else last payment date, else start date, + 1 month. Kept in
  // lockstep with nextRenewalDueDate / renewalInfo so alerts never diverge from
  // the card's גבייה הבאה. Returns '' when there is no cycle date.
  function cycleEndDate(client) {
    if (!client) return '';
    var anchor = client.packageChangeDate || client.paymentDate || client.startDate || '';
    if (!anchor) return '';
    return addMonth(anchor);
  }

  // Whole days from aIso to bIso (b - a). null when either date is unparseable.
  function daysBetween(aIso, bIso) {
    if (!aIso || !bIso) return null;
    var a = new Date(aIso);
    var b = new Date(bIso);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  // Credit alert: active patients who owe a make-up (creditsOwed > 0), most
  // owed first. -> [{ id, name, credits }]
  function creditAlerts(clients) {
    return (clients || [])
      .filter(isActive)
      .map(function (c) {
        return { id: c.id, name: c.name, credits: toCredits(c.creditsOwed) };
      })
      .filter(function (r) { return r.credits > 0; })
      .sort(function (a, b) { return b.credits - a.credits; });
  }

  // Renewal alert: active patients to collect from. Each row carries a status:
  //   'due'     — treatment-month ends within [0, windowDays] days from today
  //               (collect the next monthly payment now).
  //   'missing' — no cycle date (no paymentDate/startDate, or an unparseable
  //               one) — FLAGGED for manual attention, never crashed.
  // Patients whose cycle ends outside the window (or already passed) are
  // omitted — the existing overdue banner owns the past-due case.
  // Soonest-ending first within the 'due' group.
  function renewalAlerts(clients, todayIso, windowDays) {
    var win = windowDays == null ? RENEWAL_WINDOW_DAYS : windowDays;
    var out = [];
    (clients || []).filter(isActive).forEach(function (c) {
      var end = cycleEndDate(c);
      if (!end) {
        out.push({ id: c.id, name: c.name, cycleEnd: '', daysLeft: null, status: 'missing' });
        return;
      }
      var d = daysBetween(todayIso, end);
      if (d === null) {
        out.push({ id: c.id, name: c.name, cycleEnd: end, daysLeft: null, status: 'missing' });
        return;
      }
      if (d >= 0 && d <= win) {
        out.push({ id: c.id, name: c.name, cycleEnd: end, daysLeft: d, status: 'due' });
      }
    });
    out.sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'due' ? -1 : 1;
      return (a.daysLeft == null ? 0 : a.daysLeft) - (b.daysLeft == null ? 0 : b.daysLeft);
    });
    return out;
  }

  return {
    RENEWAL_WINDOW_DAYS: RENEWAL_WINDOW_DAYS,
    FINISHED_STATUS: FINISHED_STATUS,
    toCredits: toCredits,
    isActive: isActive,
    addMonth: addMonth,
    cycleEndDate: cycleEndDate,
    daysBetween: daysBetween,
    creditAlerts: creditAlerts,
    renewalAlerts: renewalAlerts
  };
});
