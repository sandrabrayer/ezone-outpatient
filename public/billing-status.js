/**
 * billing-status.js
 * -----------------------------------------------------------------------------
 * Canonical, framework-free definition of "when is a patient a billing problem".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The bug: every patient who started treatment has, in reality, paid. Patient
 * records created before the `paymentStatus` field existed carry an empty
 * value ('').  The previous logic in app.js used `paymentStatus === 'paid'`,
 * so an empty status was treated as NOT paid, and therefore every legacy
 * patient triggered the "🛑 stop treatment" alert and card banner.
 *
 * THE RULE
 * --------
 *   - 'paid'                -> NOT a problem
 *   - '' / null / unknown   -> NOT a problem  (legacy record, assumed paid)
 *   - 'partial' / 'unpaid'  -> IS a problem   (explicitly selected by a user)
 *
 * This file is the single source of truth for that rule. `public/app.js`
 * implements the same logic inline (it cannot import this in the browser
 * without a build step); the tests in `test/billing-status.test.js` verify
 * this module, and any change to the rule must update both places together.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.BillingStatus = api;        // browser global (optional use)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PAYMENT_STATUS_ALIASES = {
    'שולם': 'paid', paid: 'paid',
    'שולם חלקית': 'partial', partial: 'partial',
    'לא שולם': 'unpaid', unpaid: 'unpaid'
  };

  /**
   * Resolve any raw value to a canonical status id, or '' if unknown/empty.
   * @param {*} v raw payment status (Hebrew label, english id, '', null...)
   * @returns {'paid'|'partial'|'unpaid'|''}
   */
  function resolvePaymentStatus(v) {
    var raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    return PAYMENT_STATUS_ALIASES[raw] ||
           PAYMENT_STATUS_ALIASES[raw.toLowerCase()] ||
           '';
  }

  /**
   * Should this patient trigger a stop-treatment / overdue alert purely on
   * the basis of payment status? Only an EXPLICIT partial/unpaid counts.
   * @param {{paymentStatus?: *}} client
   * @returns {boolean}
   */
  function hasBillingProblem(client) {
    if (!client) return false;
    var s = resolvePaymentStatus(client.paymentStatus);
    return s === 'partial' || s === 'unpaid';
  }

  return {
    PAYMENT_STATUS_ALIASES: PAYMENT_STATUS_ALIASES,
    resolvePaymentStatus: resolvePaymentStatus,
    hasBillingProblem: hasBillingProblem
  };
});
