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

  // Session-frequency unit for a treatment type. Psychiatric follow-up
  // (מעקב פסיכיאטרי) is scheduled MONTHLY; every other treatment type is weekly.
  // Mirrors sessionFrequencyUnit in public/app.js — keep both in sync.
  function sessionFrequencyUnit(serviceType) {
    return serviceType === 'מעקב פסיכיאטרי' ? 'חודש' : 'שבוע';
  }

  // Resolve the frequency unit for a service: an explicit, valid per-patient
  // override wins; otherwise fall back to the by-type default in
  // sessionFrequencyUnit. `units` is a { service: 'שבוע'|'חודש' } map and may be
  // empty/undefined (legacy records). Mirrors sessionUnitFor in public/app.js —
  // keep both in sync.
  function sessionUnitFor(serviceType, units) {
    var u = units && units[serviceType];
    return (u === 'שבוע' || u === 'חודש') ? u : sessionFrequencyUnit(serviceType);
  }

  // Extract per-service unit overrides from a stored sessionsPerWeek value
  // (object or JSON string). Overrides live under the reserved `_units` key
  // inside the SAME blob as the service→count entries, so no schema/column
  // change is needed. Invalid/unknown units are dropped. Returns a
  // { service: 'שבוע'|'חודש' } map. Mirrors parseSessionsUnits in
  // public/app.js — keep both in sync.
  function parseSessionsUnits(v) {
    var out = {};
    if (!v) return out;
    var obj = null;
    if (typeof v === 'object' && !Array.isArray(v)) obj = v;
    else {
      var s = String(v).trim();
      if (s && s.charAt(0) === '{') { try { obj = JSON.parse(s); } catch (_) {} }
    }
    if (obj && obj._units && typeof obj._units === 'object') {
      Object.keys(obj._units).forEach(function (k) {
        var u = String(obj._units[k] == null ? '' : obj._units[k]).trim();
        if (u === 'שבוע' || u === 'חודש') out[k] = u;
      });
    }
    return out;
  }

  // Build the serializable sessionsPerWeek object: the service→count entries
  // plus a reserved `_units` map of any VALID per-service overrides. Invalid
  // units are dropped and `_units` is omitted entirely when none apply, so
  // records without overrides serialize byte-for-byte as before. Mirrors
  // attachSessionsUnits in public/app.js — keep both in sync.
  function attachSessionsUnits(breakdown, units) {
    var obj = {};
    Object.keys(breakdown || {}).forEach(function (k) {
      if (k !== '_units') obj[k] = breakdown[k];
    });
    var u = {};
    Object.keys(units || {}).forEach(function (k) {
      var val = String(units[k] == null ? '' : units[k]).trim();
      if (val === 'שבוע' || val === 'חודש') u[k] = val;
    });
    if (Object.keys(u).length) obj._units = u;
    return obj;
  }

  // Urgency tier for a card, from a renewalInfo() status:
  //   0 = overdue / red (עצור טיפול — לא שולם)   [top]
  //   1 = due_soon (חידוש היום / בעוד N ימים)
  //   2 = everyone else (ok / unknown)
  // Reuses the status renewalInfo already computed — no independent recompute.
  // Mirrors urgencyTier in public/app.js — keep both in sync.
  function urgencyTier(status) {
    if (status === 'overdue') return 0;
    if (status === 'due_soon') return 1;
    return 2;
  }

  // Stable comparator over decorated card entries { tier, daysLeft, index }:
  //   - lower tier first (red -> due_soon -> other)
  //   - within the red and due_soon tiers, ascending daysLeft so the most
  //     overdue / soonest renewal floats up (today=0 before "in 2 days";
  //     -3 before -1); null daysLeft sinks to the end of its tier
  //   - same tier (and same daysLeft) -> original index, an explicit stable
  //     tiebreak so tier 2 (and any ties) keep their incoming order
  // Mirrors compareCardUrgency in public/app.js — keep both in sync.
  function compareCardUrgency(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier !== 2) {
      var da = a.daysLeft == null ? Infinity : a.daysLeft;
      var db = b.daysLeft == null ? Infinity : b.daysLeft;
      if (da !== db) return da - db;
    }
    return a.index - b.index;
  }

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
    var anchor = client.packageChangeDate || client.paymentDate || client.startDate || '';
    if (!anchor) return '';
    return addMonth(anchor);
  }

  // 'yyyy-MM-dd' for (year, month 1-12, day), day clamped to the month's last
  // day — the same clamp currentMonthBaseDueDate applies in public/app.js.
  function clampedCycleIso(y, m, day) {
    var last = new Date(y, m, 0).getDate();
    var d = day > last ? last : day;
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  // Next cycle due date ON OR AFTER fromIso: the client's billing day (numeric
  // billingDay, else the startDate day-of-month; neither -> '') in fromIso's
  // month, clamped to the month's last day; a candidate before fromIso rolls to
  // the same day next month (clamped again). Mirrors _nextCycleDueDate in
  // apps-script/Code.gs and nextCycleDueDate in public/app.js — keep all three
  // in sync.
  function nextCycleDueDate(client, fromIso) {
    var bd = null;
    var raw = client && client.billingDay;
    if (raw !== '' && raw != null && isFinite(Number(raw)) && Number(raw) >= 1) {
      bd = Math.floor(Number(raw));
    }
    if (!bd) {
      var d = dayOfMonth(client && client.startDate);
      if (d && d >= 1) bd = d;
    }
    if (!bd) return '';
    var t = String(fromIso || '').slice(0, 10).split('-');
    var y = parseInt(t[0], 10);
    var m = parseInt(t[1], 10);
    if (!isFinite(y) || !isFinite(m)) return '';
    var candidate = clampedCycleIso(y, m, bd);
    if (candidate < fromIso) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      candidate = clampedCycleIso(y, m, bd);
    }
    return candidate;
  }

  // The next cycle due date AFTER the cycle billed at cycleDueIso: the billing
  // day in the month AFTER cycleDueIso's month, clamped. Anchors on the DUE
  // date being paid, NEVER on the paid date, so the billing day stops drifting
  // (paying the 04/09 cycle on 30/08 advances to 04/10, not 29/09). A client
  // with no billing-day anchor falls back to due date + 1 calendar month
  // (keeps its day-of-month, short-month clamp). Mirrors nextCycleDueDateAfter
  // in public/app.js — keep both in sync.
  function nextCycleDueDateAfter(client, cycleDueIso) {
    var due = String(cycleDueIso || '').slice(0, 10);
    var p = due.split('-');
    if (p.length < 3) return '';
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    if (!isFinite(y) || !isFinite(m)) return '';
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return nextCycleDueDate(client, y + '-' + ('0' + m).slice(-2) + '-01') || addMonth(due);
  }

  // Add N days to an ISO date string. Mirrors addDays in public/app.js — keep
  // both in sync.
  function addDays(isoDate, days) {
    if (!isoDate) return '';
    var d = new Date(isoDate);
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + days);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // Reconstruct a client's next-billing date for legacy rows saved before the
  // nextBillingDate column existed (it comes back blank). Take the latest PAID
  // base payment row and advance to the next cycle after the DUE date it
  // settled (nextCycleDueDateAfter — anchored on the due date, never the paid
  // date, so the billing day doesn't drift). NEVER overwrites a populated
  // nextBillingDate. Returns '' when nothing can be derived. Mirrors
  // deriveNextBillingDates in public/app.js — keep both in sync.
  function deriveNextBillingDate(client, payments) {
    if (!client) return '';
    if (client.nextBillingDate) return client.nextBillingDate;
    if (!Array.isArray(payments)) return '';
    var latest = '';
    for (var i = 0; i < payments.length; i++) {
      var p = payments[i];
      if (!p || p.clientId !== client.id || p.status !== 'paid') continue;
      if (paymentKindFromId(p.id).kind !== 'base') continue;
      var anchor = p.dueDate || p.paymentDate || '';
      if (anchor && anchor > latest) latest = anchor;
    }
    return latest ? nextCycleDueDateAfter(client, latest) : '';
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

  // Build a fully-paid base monthly payment row for dueDateISO, stamped with an
  // explicit paidDateISO (NOT today) so a backdated payment round-trips unchanged.
  // Mirrors basePaymentPaidOn in public/app.js — keep both in sync. Used by the
  // edit-modal paid-date propagation (Bug A) and renew-and-pay (Bug C).
  function basePaymentPaidOn(client, dueDateISO, amount, paidDateISO, notes) {
    return {
      id: paymentId(client.id, dueDateISO, 'base'),
      clientId: client.id, clientName: client.name || '',
      billingType: 'monthly', dueDate: dueDateISO,
      amountDue: amount, amountPaid: amount, status: 'paid',
      paymentDate: paidDateISO || '', method: '', notes: notes || '',
      bundleSize: '', sessionsUsed: ''
    };
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

  // Build the updated payment row for a plain paid/unpaid toggle from the client
  // card (base package OR extra charge). Mirrors the גבייה recompute() paid/unpaid
  // rules and setCurrentMonthPaid, so the card and the גבייה tab produce identical
  // rows through the same single persist path:
  //   makePaid=true  -> status 'paid',   amountPaid = amount, paymentDate = todayISO
  //   makePaid=false -> status 'unpaid', amountPaid = 0,      paymentDate kept
  // `existing` is the current/derived payment row (id, clientId, dueDate, notes…).
  // No 'partial' is ever produced here — partial stays a גבייה-only state.
  // Mirrors togglePaymentRow in public/app.js — keep both in sync.
  function togglePaymentRow(existing, makePaid, amount, todayISO) {
    var amt = Number(amount) || 0;
    return {
      id: existing.id,
      clientId: existing.clientId,
      clientName: existing.clientName || '',
      billingType: existing.billingType || 'monthly',
      dueDate: existing.dueDate,
      amountDue: amt,
      amountPaid: makePaid ? amt : 0,
      status: makePaid ? 'paid' : 'unpaid',
      paymentDate: makePaid ? todayISO : (existing.paymentDate || ''),
      method: existing.method || '',
      notes: existing.notes || '',
      bundleSize: 0,
      sessionsUsed: 0
    };
  }

  return {
    monthKey: monthKey,
    sessionFrequencyUnit: sessionFrequencyUnit,
    sessionUnitFor: sessionUnitFor,
    parseSessionsUnits: parseSessionsUnits,
    attachSessionsUnits: attachSessionsUnits,
    urgencyTier: urgencyTier,
    compareCardUrgency: compareCardUrgency,
    addMonth: addMonth,
    addDays: addDays,
    nextCycleDueDate: nextCycleDueDate,
    nextCycleDueDateAfter: nextCycleDueDateAfter,
    deriveNextBillingDate: deriveNextBillingDate,
    nextRenewalDueDate: nextRenewalDueDate,
    dayOfMonth: dayOfMonth,
    lastDayOfMonth: lastDayOfMonth,
    paymentId: paymentId,
    basePaymentPaidOn: basePaymentPaidOn,
    legacyBasePaymentId: legacyBasePaymentId,
    isLegacyBasePaymentId: isLegacyBasePaymentId,
    paymentKindFromId: paymentKindFromId,
    dueItemsOn: dueItemsOn,
    excludeOrphanCharges: excludeOrphanCharges,
    chargeStatusFor: chargeStatusFor,
    togglePaymentRow: togglePaymentRow
  };
});
