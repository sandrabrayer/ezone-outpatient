/**
 * debt-status.js
 * -----------------------------------------------------------------------------
 * Canonical, framework-free definition of "who owes money, and how much".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A sibling app (ezone-therapists) needs to block / warn on a patient who has
 * an open balance in outpatient. The debt itself is NOT stored on a single
 * field — it is spread across per-month rows in the `Payments` sheet, keyed to
 * a client by `clientId`. Phone lives on the `Clients` sheet
 * (`treatmentContactPhone`), not on the payment rows. So "does this person
 * owe?" is a join + a reduction, and that rule must be identical on both ends.
 *
 * THE RULE (mirrors billing-status.js)
 * ------------------------------------
 * For a single payment row, the amount still owed is:
 *   - status 'paid'            -> 0                (settled)
 *   - status '' / null / legacy-> 0                (legacy row, assumed paid)
 *   - status 'partial'|'unpaid'-> max(0, amountDue - amountPaid)
 * A client owes when the sum of per-row owed amounts across all their payment
 * rows is > 0. This deliberately matches billing-status.js: only an EXPLICIT
 * partial/unpaid row counts; an empty status is treated as paid so legacy rows
 * never produce phantom debt.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * `apps-script/Code.gs` (`_getDebtStatus`) implements the SAME rule inline (it
 * cannot import this module in the Apps Script runtime). The tests in
 * `test/debt-status.test.js` verify this module; any change to the rule MUST
 * update both places together.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.DebtStatus = api;           // browser global (optional use)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Same alias table as billing-status.js — a payment row's status may be a
  // Hebrew label or an english id.
  var PAYMENT_STATUS_ALIASES = {
    'שולם': 'paid', paid: 'paid',
    'שולם חלקית': 'partial', partial: 'partial',
    'לא שולם': 'unpaid', unpaid: 'unpaid'
  };

  function resolvePaymentStatus(v) {
    var raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    return PAYMENT_STATUS_ALIASES[raw] ||
           PAYMENT_STATUS_ALIASES[raw.toLowerCase()] ||
           '';
  }

  function toNum(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /**
   * Amount still owed for a single payment row.
   * @param {{status?:*, amountDue?:*, amountPaid?:*}} row
   * @returns {number} >= 0
   */
  function rowOwed(row) {
    if (!row) return 0;
    var status = resolvePaymentStatus(row.status);
    if (status === 'paid' || status === '') return 0; // settled or legacy=paid
    var owed = toNum(row.amountDue) - toNum(row.amountPaid);
    return owed > 0 ? owed : 0;
  }

  /**
   * Sum the open balance for one client across all their payment rows.
   * @param {Array} payments rows for THIS client only
   * @returns {number} total amount owed (>= 0)
   */
  function amountOwedForRows(payments) {
    if (!Array.isArray(payments)) return 0;
    var sum = 0;
    for (var i = 0; i < payments.length; i++) sum += rowOwed(payments[i]);
    // Avoid floating-point dust (e.g. 0.0000001) tripping the > 0 test.
    return Math.round(sum * 100) / 100;
  }

  /**
   * Build the projected debtor list the cross-app endpoint exposes.
   *
   * Matching contract (decided with the product owner): a patient is matched on
   * NAME + the phone registered in the system. On the outpatient side that
   * phone is `treatmentContactPhone` (the patient/treatment contact), NOT the
   * payer phone. Only the fields needed for the block are projected — no
   * prices, payer details, payment links, etc.
   *
   * Debtors are included regardless of client `status`: an open balance still
   * matters after discharge.
   *
   * @param {Array} clients  rows from the Clients sheet
   * @param {Array} payments rows from the Payments sheet
   * @returns {Array<{clientId:string,name:string,phone:string,amountOwed:number}>}
   */
  function computeDebtors(clients, payments) {
    if (!Array.isArray(clients)) return [];
    var byClient = {};
    if (Array.isArray(payments)) {
      for (var i = 0; i < payments.length; i++) {
        var p = payments[i];
        var cid = p && p.clientId != null ? String(p.clientId) : '';
        if (!cid) continue;
        (byClient[cid] = byClient[cid] || []).push(p);
      }
    }
    var out = [];
    for (var c = 0; c < clients.length; c++) {
      var cl = clients[c];
      if (!cl) continue;
      var id = cl.id != null ? String(cl.id) : '';
      if (!id) continue;
      var amountOwed = amountOwedForRows(byClient[id] || []);
      if (amountOwed <= 0) continue; // only debtors
      out.push({
        clientId: id,
        name: cl.name || '',
        phone: cl.treatmentContactPhone || '',
        amountOwed: amountOwed
      });
    }
    return out;
  }

  return {
    PAYMENT_STATUS_ALIASES: PAYMENT_STATUS_ALIASES,
    resolvePaymentStatus: resolvePaymentStatus,
    rowOwed: rowOwed,
    amountOwedForRows: amountOwedForRows,
    computeDebtors: computeDebtors
  };
});
