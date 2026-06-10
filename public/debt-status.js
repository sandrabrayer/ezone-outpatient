/**
 * debt-status.js
 * -----------------------------------------------------------------------------
 * Canonical, framework-free definition of "who owes money, and how much" —
 * AND, just as important, "when we cannot tell".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A sibling app (ezone-therapists) gates patient intake on outpatient debt.
 * The answer is NOT a single field: it is a join of the `Payments` sheet
 * (`status`, `amountDue`, `amountPaid`, keyed by `clientId`) onto `Clients`
 * (where the phone lives, as `treatmentContactPhone`). So the rule must be
 * identical on both ends, and it must NEVER fail open: a missing record is not
 * "no debt", it is "couldn't determine → flag for a human".
 *
 * THREE OUTCOMES, NOT TWO (never-fail-open for matching)
 * ------------------------------------------------------
 * Per client, from that client's payment rows:
 *   - has rows, open balance > 0   -> 'debt'    (block + approval)
 *   - has rows, nothing owing      -> 'clear'   (confirmed no debt → allow)
 *   - ZERO payment rows            -> 'unknown' (no billing record → FLAG)
 * The consumer adds two more flag cases from the phone match itself:
 *   - phone matches no client      -> flag (no record)
 *   - phone matches >1 client      -> flag (ambiguous)
 * 'unknown' deliberately does NOT collapse to 'clear': absence of a payment
 * row is absence of evidence, not evidence of payment.
 *
 * PER-ROW RULE (mirrors billing-status.js)
 * ----------------------------------------
 * The amount still owed on one row that EXISTS is:
 *   - status 'paid'            -> 0
 *   - status '' / null         -> 0  (a billed month with a blank status cell
 *                                     is treated as settled; this is about a
 *                                     row that exists, not a missing row)
 *   - status 'partial'|'unpaid'-> max(0, amountDue - amountPaid)
 * The "don't assume paid" rule applies at the CLIENT level (zero rows =
 * 'unknown'), not by reinterpreting an existing blank row as a debt.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * `apps-script/Code.gs` (`_getDebtStatus`) implements the SAME rule inline (it
 * cannot import this module in the Apps Script runtime). `test/debt-status.test.js`
 * verifies this module; any change to the rule MUST update both places.
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
   * Amount still owed for a single payment row that EXISTS.
   * @param {{status?:*, amountDue?:*, amountPaid?:*}} row
   * @returns {number} >= 0
   */
  function rowOwed(row) {
    if (!row) return 0;
    var status = resolvePaymentStatus(row.status);
    if (status === 'paid' || status === '') return 0; // settled (or blank cell on a billed month)
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
   * Tri-state debt status for one client, from that client's payment rows.
   * @param {Array} rows payment rows for THIS client only
   * @returns {{debtStatus:'debt'|'clear'|'unknown', amountOwed:number}}
   */
  function clientDebtStatus(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { debtStatus: 'unknown', amountOwed: 0 }; // no billing record → flag
    }
    var owed = amountOwedForRows(rows);
    return owed > 0
      ? { debtStatus: 'debt', amountOwed: owed }
      : { debtStatus: 'clear', amountOwed: 0 };
  }

  /**
   * Build the projected roster the cross-app endpoint exposes — EVERY client,
   * each with its tri-state debt status, so the consumer can tell "confirmed
   * no debt" (clear) apart from "couldn't determine" (unknown / no match).
   *
   * Matching contract (decided with the product owner): a patient is matched on
   * NAME + the phone registered in the system, which on the outpatient side is
   * `treatmentContactPhone` (the patient treated), NOT the payer phone. Only the
   * fields needed for the gate are projected — no prices, payer details, links.
   *
   * Included regardless of client `status`: an open balance still matters after
   * discharge, and a discharged client with no rows is still 'unknown'.
   *
   * @param {Array} clients  rows from the Clients sheet
   * @param {Array} payments rows from the Payments sheet
   * @returns {Array<{clientId:string,name:string,phone:string,debtStatus:string,amountOwed:number}>}
   */
  function computeClientDebt(clients, payments) {
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
      var st = clientDebtStatus(byClient[id] || []);
      out.push({
        clientId: id,
        name: cl.name || '',
        phone: cl.treatmentContactPhone || '',
        debtStatus: st.debtStatus,
        amountOwed: st.amountOwed
      });
    }
    return out;
  }

  return {
    PAYMENT_STATUS_ALIASES: PAYMENT_STATUS_ALIASES,
    resolvePaymentStatus: resolvePaymentStatus,
    rowOwed: rowOwed,
    amountOwedForRows: amountOwedForRows,
    clientDebtStatus: clientDebtStatus,
    computeClientDebt: computeClientDebt
  };
});
