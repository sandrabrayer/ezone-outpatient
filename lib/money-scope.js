'use strict';

/* Server-side money scope (OP-CRM-3A, CHANGELOG-crm-money-scope.md).
 *
 * Business decision (CRM spec §2, recorded in docs/crm/OUTPATIENT-STAGE0.md):
 * דנה is OPERATIONAL — every lead / client / meeting / task / continuation
 * action, but NO financial information from the server: prices, payments,
 * collection amounts, debts, balances, revenue, therapist pay, bank details,
 * exports. ורד keeps everything (incl. pricing, gated separately by
 * CATALOG_ADMIN_USERS); אורן keeps his current authorized functionality.
 *
 * The scope is decided ONLY from the session name the Node proxy read out of
 * the signed cookie (never from a browser field) and it FAILS CLOSED: an
 * unknown, blank or retired name is operational (no money). Pure: no I/O. */

const { SESSION_USERS } = require('./users');

/* Names whose sessions never receive or write money. Append here only. */
const OPS_USERS = Object.freeze(['דנה']);

const SCOPE_FULL = 'full';
const SCOPE_OPS = 'ops';

function scopeOf(user) {
  const u = String(user == null ? '' : user).trim();
  if (!u || SESSION_USERS.indexOf(u) < 0) return SCOPE_OPS; // fail closed
  return OPS_USERS.indexOf(u) >= 0 ? SCOPE_OPS : SCOPE_FULL;
}
function moneyAllowed(user) { return scopeOf(user) === SCOPE_FULL; }

/* /api/sheets actions an operational session may not call at all. GET and
 * POST are listed separately because a few names exist on both verbs. */
const MONEY_GET_ACTIONS = Object.freeze([
  'getPayments', 'getCharges', 'getCredits', 'getSessionLog', 'getSettings',
  'getRenewalState', 'getExtraChargeState', 'reserveRenewal', 'applyRenewal',
  'getDebtStatus', 'getWinbackSource', 'scanClientColumns'
]);
const MONEY_POST_ACTIONS = Object.freeze([
  'savePayment', 'updatePayment', 'removePayment', 'removePaymentsForClient',
  'saveCharge', 'updateCharge', 'removeCharge', 'removeChargesForClient',
  'saveCredit', 'savePaymentAmountOverride', 'markForwarded', 'correctSessionOutcome',
  'saveSettings', 'repairStaleNextBilling', 'mergeClients',
  'reserveRenewal', 'applyRenewal', 'cancelRenewal', 'acknowledgeRenewal', 'resolveRenewalReview',
  'reserveExtraCharge', 'applyExtraCharge', 'acknowledgeExtraCharge', 'cancelExtraCharge', 'resolveExtraChargeReview',
  'getPayments', 'getCharges', 'getCredits', 'getSessionLog', 'getSettings', 'getRenewalState', 'getExtraChargeState'
]);
function isMoneyAction(method, action) {
  const a = String(action == null ? '' : action);
  return (String(method).toUpperCase() === 'GET' ? MONEY_GET_ACTIONS : MONEY_POST_ACTIONS).indexOf(a) >= 0;
}

/* Keys that carry money on ANY row/object the proxy returns to an operational
 * session (deep). Clients: price, billing arrangement, payment state, credits,
 * overrides, payment link. Leads: price. Sessions/payouts: pay and value.
 * Cross-app/debt: amounts. Mirrored by OPS_MONEY_KEYS in apps-script/Code.gs
 * (saveAll preservation). Append-only. */
const MONEY_KEYS = Object.freeze([
  'pricePerSession', 'billingType', 'billingDay', 'bundleSize', 'bundlePrice', 'bundlePaid',
  'paymentStatus', 'paymentDate', 'nextBillingDate', 'creditsOwed', 'paymentAmountOverrides', 'paymentLink',
  'therapistPay', 'clientSessionValue', 'amountDue', 'amountPaid', 'amount', 'rate',
  'amountOwed', 'debtStatus', 'price', 'bankName', 'bankBranch', 'bankAccount', 'bankHolder'
]);
const MONEY_KEY_SET = new Set(MONEY_KEYS);

/* Deep copy with every money key removed (objects and arrays, any depth).
 * Keys named in `keep` survive at the TOP level only (e.g. `ok`, `error`). */
function stripMoney(value) {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach((k) => {
    if (MONEY_KEY_SET.has(k)) return;
    out[k] = stripMoney(value[k]);
  });
  return out;
}

/* Static files an operational session may not download (price / pay
 * constants). treatment-map.js stays available: it maps clinical types to
 * billing categories and carries no amounts. */
const MONEY_STATIC = Object.freeze(['therapist-pay.js']);

module.exports = {
  OPS_USERS, SCOPE_FULL, SCOPE_OPS, scopeOf, moneyAllowed,
  MONEY_GET_ACTIONS, MONEY_POST_ACTIONS, isMoneyAction,
  MONEY_KEYS, stripMoney, MONEY_STATIC
};
