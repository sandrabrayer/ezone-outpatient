/**
 * phone-issue.js
 * -----------------------------------------------------------------------------
 * The ONE rule for "which phone does a sibling app use to find this patient —
 * and when there is none, why not".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * getTreatmentPlans and getDebtStatus (apps-script/Code.gs) are the two base
 * sources of the E-Zone Therapists patient roster, and that roster is keyed by
 * phone: a row whose phone yields no match key is DROPPED without a trace
 * (ezone-therapists public/roster.js). Both feeds used to project
 *
 *     recoverPhone(phone) || recoverPhone(treatmentContactPhone)
 *
 * with NO validation, so
 *   - a client with no number at all simply vanished from the therapists app,
 *     and nobody on either side could see why;
 *   - a malformed non-empty `phone` (9 or 11 digits, two numbers in one cell)
 *     short-circuited the `||` and hid a valid treatmentContactPhone behind it.
 *
 * THE RULE
 * --------
 * Candidates, in this order (CROSS_APP_PHONE_SOURCES):
 *   1. `phone`                 — the patient's own number, the documented
 *                                cross-app join key (debt gate, stop-flow);
 *   2. `treatmentContactPhone` — the legacy contact column, fallback only.
 * Each candidate is normalized with recoverPhone — strip separators,
 * +972 / 972 / 00972 → 0, restore a leading zero Google Sheets dropped — and is
 * ACCEPTED only when the result is exactly canonical: /^0\d{9}$/ (the same
 * CANONICAL_RE the therapists app enforces). The first accepted candidate wins.
 * When none is accepted, phone is '' and phoneIssue says why:
 *   'missing' — no candidate carries a single digit;
 *   'invalid' — a candidate carries digits that are not a canonical mobile
 *               number (someone has to correct it).
 *
 * NEVER GUESSES. An invalid value is never truncated, padded, split or
 * reinterpreted, and payerPhone (a parent / an institution, legitimately shared
 * by siblings) is never a candidate. Normalization is exactly recoverPhone, the
 * same function every inbound receiver (flagStop, recordSessionOutcome, …)
 * applies to these cells — so a phone this rule emits always matches back.
 *
 * Mirrored by _canonicalPhone / _crossAppPhone in apps-script/Code.gs (Apps
 * Script cannot import this file). test/treatment-plans-phone.test.js runs the
 * REAL Code.gs in a sandbox and asserts the two agree on every case.
 *
 * Framework-free: runs in the browser (window.EzonePhoneIssue — the patient-card
 * chip) and under `node --test`.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.EzonePhoneIssue = api;      // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Canonical cross-app phone: a leading zero + 9 more digits. */
  var CANONICAL_PHONE_RE = /^0\d{9}$/;

  /* Candidate columns, in priority order. payerPhone is deliberately absent. */
  var CROSS_APP_PHONE_SOURCES = ['phone', 'treatmentContactPhone'];

  var PHONE_ISSUE_MISSING = 'missing';
  var PHONE_ISSUE_INVALID = 'invalid';

  /* Patient-card chip wording (Hebrew is render-time only; the feed carries the
   * stable English keys). */
  var PHONE_ISSUE_LABELS = {
    missing: 'חסר טלפון',
    invalid: 'טלפון לא תקין'
  };
  var PHONE_ISSUE_HINT =
    'לא יופיע/תופיע באפליקציית המטפלים — יש להזין בעריכה מספר נייד תקין: 10 ספרות שמתחילות ב־0';

  /* Status of a client the therapists app deleted (Code.gs
   * DEACTIVATED_CLIENT_STATUS_HE). Such a client is not in either feed at all,
   * so its phone cannot hide it from anything — no chip. */
  var DEACTIVATED_STATUS = 'לא פעיל';

  /* Mirror of _recoverPhone in apps-script/Code.gs (and recoverPhone in
   * public/app.js / public/debt-status.js). Idempotent. */
  function recoverPhone(raw) {
    if (raw === null || raw === undefined) return '';
    var s = String(raw).replace(/[\s\-()]/g, '');
    if (s.indexOf('+') === 0) s = s.slice(1);
    if (s.indexOf('00') === 0) s = s.slice(2);
    s = s.replace(/\D/g, '');
    if (!s) return '';
    if (s.indexOf('972') === 0) s = '0' + s.slice(3);   // intl -> local
    else if (s.charAt(0) !== '0') s = '0' + s;          // Sheets dropped the leading 0
    return s;
  }

  /**
   * Normalize ONE raw cell and validate it.
   *   { phone: '0501234567', issue: '' }         canonical
   *   { phone: '',           issue: 'missing' }  blank / no digits at all
   *   { phone: '',           issue: 'invalid' }  digits, but not canonical
   * @param {*} raw
   * @returns {{phone: string, issue: string}}
   */
  function canonicalPhone(raw) {
    var s = recoverPhone(raw);
    if (!s) return { phone: '', issue: PHONE_ISSUE_MISSING };
    if (CANONICAL_PHONE_RE.test(s)) return { phone: s, issue: '' };
    return { phone: '', issue: PHONE_ISSUE_INVALID };
  }

  /**
   * The cross-app join phone for a client row: the first canonical candidate.
   * phoneIssue is '' exactly when phone is non-empty.
   * @param {object} client a Clients row (sheet or in-memory shape)
   * @returns {{phone: string, phoneIssue: string}}
   */
  function crossAppPhone(client) {
    var sawInvalid = false;
    for (var i = 0; i < CROSS_APP_PHONE_SOURCES.length; i++) {
      var r = canonicalPhone(client ? client[CROSS_APP_PHONE_SOURCES[i]] : '');
      if (r.phone) return { phone: r.phone, phoneIssue: '' };
      if (r.issue === PHONE_ISSUE_INVALID) sawInvalid = true;
    }
    return { phone: '', phoneIssue: sawInvalid ? PHONE_ISSUE_INVALID : PHONE_ISSUE_MISSING };
  }

  /**
   * The chip the patient card shows: the feed's phoneIssue for this client, or
   * '' when there is nothing to fix (a valid phone, or a client the feeds do
   * not carry at all).
   * @param {object} client
   * @returns {string} '' | 'missing' | 'invalid'
   */
  function cardPhoneIssue(client) {
    if (!client || client.status === DEACTIVATED_STATUS) return '';
    return crossAppPhone(client).phoneIssue;
  }

  return {
    CANONICAL_PHONE_RE: CANONICAL_PHONE_RE,
    CROSS_APP_PHONE_SOURCES: CROSS_APP_PHONE_SOURCES,
    PHONE_ISSUE_MISSING: PHONE_ISSUE_MISSING,
    PHONE_ISSUE_INVALID: PHONE_ISSUE_INVALID,
    PHONE_ISSUE_LABELS: PHONE_ISSUE_LABELS,
    PHONE_ISSUE_HINT: PHONE_ISSUE_HINT,
    DEACTIVATED_STATUS: DEACTIVATED_STATUS,
    recoverPhone: recoverPhone,
    canonicalPhone: canonicalPhone,
    crossAppPhone: crossAppPhone,
    cardPhoneIssue: cardPhoneIssue
  };
});
