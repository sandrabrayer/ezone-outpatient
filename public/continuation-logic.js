/**
 * continuation-logic.js
 * -----------------------------------------------------------------------------
 * Pure, framework-free logic for the "מסלול המשך" (continuation-track) tab.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The continuation tab joins a live roster of currently-admitted DASHBOARD
 * patients to workflow rows persisted in the OUTPATIENT spreadsheet. The join
 * key, the tenure (whole-months-since-entry) computation, its emphasis bucket,
 * and the outcome whitelist are all small, order-sensitive rules that MUST agree
 * between the browser (public/app.js) and the tests (test/continuation-logic).
 * They live here as the single source of truth — same pattern as
 * public/billing-status.js — so a change updates both places at once.
 *
 * STABLE KEYS
 * -----------
 * Outcomes are stored as stable English keys (continuing / to_outpatient /
 * stopping); the Hebrew labels are render-time only and live in app.js, not
 * here. The empty string '' is a valid (unset) outcome.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;               // Node / tests
  } else {
    root.ContinuationLogic = api;       // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Stable outcome keys. '' = not yet decided. The Hebrew display labels are
  // render-time only (app.js) — never stored.
  var VALID_OUTCOMES = ['', 'continuing', 'to_outpatient', 'stopping'];

  // Dashboard houseId -> outpatient house_of_origin key. The roster reports the
  // DASHBOARD's houseIds, which differ from the outpatient app's own
  // house_of_origin scheme; this maps the overlapping houses so a lead created
  // from the continuation tab lands with a house_of_origin the לידים tab can
  // label. An unmapped id (e.g. 'sde') resolves to '' — the caller then keeps
  // the raw id in the lead note rather than storing an unrecognizable key.
  var HOUSE_TO_ORIGIN = {
    arfoni: 'efroni',
    asher:  'raanana',
    pardes: 'raanana_pardes',
    ramot:  'ramot',
    rehab:  'rehab'
  };

  /**
   * Build the stable join key for a roster patient / workflow row.
   * key = trimmed(name) + '|' + trimmed(house) + '|' + trimmed(entryDate).
   * Trimming keeps the browser-computed roster key and the stored row key in
   * lock-step regardless of stray whitespace.
   * @returns {string}
   */
  function buildKey(name, house, entryDate) {
    var n = String(name == null ? '' : name).trim();
    var h = String(house == null ? '' : house).trim();
    var d = String(entryDate == null ? '' : entryDate).trim();
    return n + '|' + h + '|' + d;
  }

  // Accept only a strict ISO calendar date 'YYYY-MM-DD'.
  function _parseISO(entryDate) {
    var s = String(entryDate == null ? '' : entryDate).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, mo: mo, d: d };
  }

  /**
   * Whole calendar months elapsed from entryDate to todayISO.
   *   - same day                      -> 0
   *   - one day before the month turns -> the earlier count (day-of-month gates)
   *   - invalid / blank entryDate      -> null  (caller renders '—', sorts last)
   *   - a future entryDate             -> 0     (never negative)
   * @param {string} entryDate 'YYYY-MM-DD'
   * @param {string} todayISO  'YYYY-MM-DD'
   * @returns {number|null}
   */
  function monthsSince(entryDate, todayISO) {
    var a = _parseISO(entryDate);
    var b = _parseISO(todayISO);
    if (!a || !b) return null;
    var months = (b.y - a.y) * 12 + (b.mo - a.mo);
    // Not a full month until the day-of-month is reached.
    if (b.d < a.d) months -= 1;
    return months < 0 ? 0 : months;
  }

  /**
   * Emphasis bucket for a tenure in whole months.
   *   3+ months -> 3 (strongest)
   *   2  months -> 2
   *   0-1 month -> 1
   *   null/NaN  -> 0 (no emphasis — missing entryDate)
   * @param {number|null} months
   * @returns {0|1|2|3}
   */
  function bucketOf(months) {
    if (months == null || isNaN(months)) return 0;
    if (months >= 3) return 3;
    if (months >= 2) return 2;
    return 1;
  }

  /** Is this a value the outcome column is allowed to hold? */
  function isValidOutcome(v) {
    return VALID_OUTCOMES.indexOf(v) !== -1;
  }

  /**
   * Map a dashboard houseId to the outpatient house_of_origin key, or '' when
   * the house has no outpatient equivalent (the caller then keeps the raw id in
   * the note instead of persisting an unrecognizable value).
   * @param {string} houseId
   * @returns {string}
   */
  function houseToOrigin(houseId) {
    var s = String(houseId == null ? '' : houseId).trim();
    return HOUSE_TO_ORIGIN[s] || '';
  }

  return {
    VALID_OUTCOMES: VALID_OUTCOMES,
    HOUSE_TO_ORIGIN: HOUSE_TO_ORIGIN,
    buildKey: buildKey,
    monthsSince: monthsSince,
    bucketOf: bucketOf,
    isValidOutcome: isValidOutcome,
    houseToOrigin: houseToOrigin
  };
});
