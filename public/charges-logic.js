/**
 * charges-logic.js
 * -----------------------------------------------------------------------------
 * Pure, framework-free helpers for extra-charges and the layered payment-id
 * scheme. Same UMD pattern as billing-status.js: Node tests `require()` this
 * module; `public/app.js` keeps an inline copy of the same logic because the
 * browser cannot import without a build step. Any rule change must update
 * BOTH places together.
 *
 * Payment-id scheme:
 *   base monthly:    pay::<clientId>::base::<YYYY-MM>
 *   extra monthly:   pay::<clientId>::chg-<chargeId>::<YYYY-MM>
 *   one-time extra:  pay::<clientId>::chg-<chargeId>::once
 *   legacy:          pay::<clientId>::<YYYY-MM>          (pre-PR base monthly)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ChargesLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function monthKey(iso) { return String(iso || '').slice(0, 7); }

  // Add 1 calendar month to an ISO date string, clamping to the last day of
  // the target month (Jan 31 + 1mo -> Feb 28). Mirrors addMonth in
  // public/app.js — keep both in sync.
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

  // The ISO due-date of a client's next monthly renewal. Prefers the stored
  // nextBillingDate — the SAME value the גבייה הבאה chip shows — so the renewal
  // alert/button never diverge from the chip. Falls back to the last payment
  // date (else start date) + 1 calendar month (short-month clamp via addMonth)
  // only for legacy rows saved before nextBillingDate was persisted. Mirrors
  // nextRenewalDueDate in public/app.js — keep both in sync. This is the single
  // source the "renewal banner" and the "חידוש ותשלום" button share.
  function nextRenewalDueDate(client) {
    if (!client) return '';
    if (client.nextBillingDate) return client.nextBillingDate;
    var anchor = client.paymentDate || client.startDate || '';
    if (!anchor) return '';
    return addMonth(anchor);
  }

  function dayOfMonth(iso) {
    if (!iso) return null;
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length < 3) return null;
    var d = parseInt(parts[2], 10);
    return isFinite(d) ? d : null;
  }

  function lastDayOfMonth(iso) {
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length < 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!isFinite(y) || !isFinite(m)) return null;
    return new Date(y, m, 0).getDate();
  }

  function paymentId(clientId, dueDateISO, kind, chargeId, chargeBillingType) {
    if (kind === 'extra') {
      if (!chargeId) throw new Error('paymentId: chargeId required for kind=extra');
      var suffix = chargeBillingType === 'one_time' ? 'once' : monthKey(dueDateISO);
      return 'pay::' + clientId + '::chg-' + chargeId + '::' + suffix;
    }
    return 'pay::' + clientId + '::base::' + monthKey(dueDateISO);
  }

  function legacyBasePaymentId(clientId, dueDateISO) {
    return 'pay::' + clientId + '::' + monthKey(dueDateISO);
  }

  // Legacy = exactly 3 '::'-separated segments, ending in YYYY-MM.
  function isLegacyBasePaymentId(id) {
    if (!id) return false;
    var parts = String(id).split('::');
    if (parts.length !== 3) return false;
    if (parts[0] !== 'pay') return false;
    return /^\d{4}-\d{2}$/.test(parts[2]);
  }

  // Classify a payment id by inspecting it. Legacy ids classify as base.
  function paymentKindFromId(id) {
    var s = String(id || '');
    var m = s.match(/::chg-([^:]+)::/);
    if (m) return { kind: 'extra', chargeId: m[1] };
    return { kind: 'base' };
  }

  // Returns due items on a given ISO date:
  //   [{ clientId, kind: 'base'|'extra', chargeId?, dueDate, amount }]
  // Pure: takes clients + charges arrays, no shared state.
  function dueItemsOn(clients, charges, dateISO) {
    var d = dayOfMonth(dateISO);
    var last = lastDayOfMonth(dateISO);
    var selectedMonth = monthKey(dateISO);
    var out = [];
    (clients || []).forEach(function (c) {
      if (c.status === 'סיים טיפול') return;
      var bd = c.billingDay ? Number(c.billingDay) : dayOfMonth(c.startDate);
      if (bd) {
        var effective = (last && bd > last) ? last : bd;
        if (effective === d) {
          out.push({
            clientId: c.id, kind: 'base', dueDate: dateISO,
            amount: Number(c.pricePerSession) || 0
          });
        }
      }
      (charges || []).forEach(function (charge) {
        if (charge.clientId !== c.id) return;
        if (charge.active === false) return;
        if (charge.billingType === 'monthly') {
          var day = charge.billingDay ? Number(charge.billingDay) : dayOfMonth(charge.chargeDate);
          if (!day) return;
          var eff = (last && day > last) ? last : day;
          if (eff !== d) return;
          if (selectedMonth < monthKey(charge.chargeDate)) return;
          out.push({
            clientId: c.id, kind: 'extra', chargeId: charge.id,
            dueDate: dateISO, amount: Number(charge.amount) || 0
          });
        } else if (charge.billingType === 'one_time') {
          if (charge.chargeDate === dateISO) {
            out.push({
              clientId: c.id, kind: 'extra', chargeId: charge.id,
              dueDate: dateISO, amount: Number(charge.amount) || 0
            });
          }
        }
      });
    });
    return out;
  }

  // Drop "orphan" charges — rows whose clientId no longer matches any patient
  // in `clients` (the patient was deleted, the charge row survived). Such rows
  // must never surface on the dashboard. clientId is compared as a string on
  // both sides (Sheets may return a numeric id). Pure: no shared state.
  // Mirrors excludeOrphanCharges in public/app.js — keep both in sync.
  function excludeOrphanCharges(charges, clients) {
    var live = {};
    (clients || []).forEach(function (c) {
      if (c && c.id != null && String(c.id) !== '') live[String(c.id)] = true;
    });
    return (charges || []).filter(function (ch) {
      return ch && ch.clientId != null && live[String(ch.clientId)] === true;
    });
  }

  // Status of a charge for display on the client card, lookup-only.
  //   one_time charge: status of the ::once payment row.
  //   monthly charge:  status of the CURRENT month's payment row
  //                    (todayISO determines the month; older unpaid months
  //                    show up in גבייה's יתרות פתוחות, not here).
  // Returns 'paid' | 'partial' | 'unpaid'. Default when no row exists is
  // 'unpaid' — Vered just added the charge and hasn't collected yet.
  function chargeStatusFor(payments, client, charge, todayISO) {
    if (!client || !charge) return 'unpaid';
    var billingType = charge.billingType === 'one_time' ? 'one_time' : 'monthly';
    var id = paymentId(client.id, todayISO, 'extra', charge.id, billingType);
    var found = null;
    for (var i = 0; i < (payments || []).length; i++) {
      if (payments[i] && payments[i].id === id) { found = payments[i]; break; }
    }
    if (!found) return 'unpaid';
    if (found.status === 'paid') return 'paid';
    if (found.status === 'partial') return 'partial';
    return 'unpaid';
  }

  return {
    monthKey: monthKey,
    addMonth: addMonth,
    nextRenewalDueDate: nextRenewalDueDate,
    dayOfMonth: dayOfMonth,
    lastDayOfMonth: lastDayOfMonth,
    paymentId: paymentId,
    legacyBasePaymentId: legacyBasePaymentId,
    isLegacyBasePaymentId: isLegacyBasePaymentId,
    paymentKindFromId: paymentKindFromId,
    dueItemsOn: dueItemsOn,
    excludeOrphanCharges: excludeOrphanCharges,
    chargeStatusFor: chargeStatusFor
  };
});
