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
   * Sort comparator for continuation rows within a house.
   *   - tenure DESC — longest-admitted first (largest `months`), i.e. the
   *     patients closest to finishing their stay float to the top;
   *   - a row with a missing/invalid entryDate (`months == null`) always sorts
   *     last, regardless of the other row's tenure;
   *   - ties (equal tenure, or two missing-date rows) break alphabetically by
   *     name using Hebrew collation.
   * Pure: reads only `months` and `name` off each row, mutates nothing.
   * @param {{months:(number|null), name:string}} a
   * @param {{months:(number|null), name:string}} b
   * @returns {number} <0, 0, or >0 for Array.prototype.sort
   */
  function compareByTenure(a, b) {
    var am = (a && a.months != null) ? a.months : null;
    var bm = (b && b.months != null) ? b.months : null;
    var an = String(a && a.name != null ? a.name : '');
    var bn = String(b && b.name != null ? b.name : '');
    if (am == null && bm == null) return an.localeCompare(bn, 'he');
    if (am == null) return 1;   // a missing -> a after b
    if (bm == null) return -1;  // b missing -> a before b
    if (bm !== am) return bm - am; // tenure DESC (longest-admitted first)
    return an.localeCompare(bn, 'he'); // tiebreak: Hebrew alphabetical
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

  /* ===== Continuation milestones (CRM, 2026-11-03) ===================================
   *
   * BUSINESS RULE: continuation treatment is offered BEFORE the patient reaches one, two
   * and three months of stay — counted from the ACTUAL entry date into the house, never
   * from an exit date, a meeting date or the row's creation. A contact task opens 14 days
   * before each milestone. Example: entry 15/09 → milestones 15/10, 15/11, 15/12 → contact
   * dates 01/10, 01/11, 01/12.
   *
   * Calendar months with end-of-month clamping (31/01 → 28/02 or 29/02 in a leap year), pure
   * ISO-date arithmetic (no Date-object time zones, so the result is the same in the browser
   * and in Apps Script). "Today" is supplied by the caller in Asia/Jerusalem.
   *
   * The SAME algorithm lives in apps-script/Code.gs (_contAddMonths / _contMilestones);
   * test/continuation-milestones.test.js runs both on one vector table and fails on drift.
   * ============================================================================== */
  var MILESTONE_MONTHS = [1, 2, 3];
  var CONTACT_LEAD_DAYS = 14;
  // Stable CRM status keys of a continuation patient; Hebrew labels are render-time only (app.js).
  var CRM_STATUSES = ['not_contacted', 'in_progress', 'interested', 'postponed', 'declined', 'converted', 'closed'];
  var CRM_TERMINAL = ['declined', 'converted', 'closed'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, mo) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]; }
  function toISO(y, mo, d) { return y + '-' + pad2(mo) + '-' + pad2(d); }

  /** entryDate + n calendar months, day clamped to the target month's length. null on a bad date. */
  function addCalendarMonths(iso, n) {
    var a = _parseISO(iso);
    if (!a || a.d > daysInMonth(a.y, a.mo)) return null;
    var total = a.mo - 1 + n;
    var y = a.y + Math.floor(total / 12), mo = (total % 12 + 12) % 12 + 1;
    return toISO(y, mo, Math.min(a.d, daysInMonth(y, mo)));
  }
  /** iso ± n days (pure civil arithmetic). null on a bad date. */
  function addDays(iso, n) {
    var a = _parseISO(iso);
    if (!a || a.d > daysInMonth(a.y, a.mo)) return null;
    var y = a.y, mo = a.mo, d = a.d + n;
    while (d > daysInMonth(y, mo)) { d -= daysInMonth(y, mo); mo++; if (mo > 12) { mo = 1; y++; } }
    while (d < 1) { mo--; if (mo < 1) { mo = 12; y--; } d += daysInMonth(y, mo); }
    return toISO(y, mo, d);
  }
  /**
   * The three milestones of an entry date, or null when there is no valid entry date
   * (then NO task is created and the UI says «חסר תאריך כניסה»).
   * [{ n: 1, suffix: 'm1', milestoneDate, contactDate }, …]
   */
  function milestones(entryDate) {
    if (!_parseISO(entryDate) || addCalendarMonths(entryDate, 0) === null) return null;
    return MILESTONE_MONTHS.map(function (n) {
      var md = addCalendarMonths(entryDate, n);
      return { n: n, suffix: 'm' + n, milestoneDate: md, contactDate: addDays(md, -CONTACT_LEAD_DAYS) };
    });
  }
  /** Stable task id: cont::<ref>::<entryDate>::m1|m2|m3 */
  function milestoneTaskId(ref, entryDate, n) { return 'cont::' + ref + '::' + entryDate + '::m' + n; }
  /** Parse a milestone task id back into its parts, or null. */
  function parseMilestoneTaskId(id) {
    var m = /^cont::(.+)::(\d{4}-\d{2}-\d{2})::m([123])$/.exec(String(id == null ? '' : id));
    return m ? { ref: m[1], entryDate: m[2], n: +m[3] } : null;
  }
  /** Normalize an Israeli phone to 0XXXXXXXXX; '' when it is not one. */
  function normalizePhone(v) {
    var digits = String(v == null ? '' : v).replace(/\D/g, '');
    if (/^972\d{9}$/.test(digits)) digits = '0' + digits.slice(3);
    return /^0\d{9}$/.test(digits) ? digits : '';
  }
  /**
   * Stable reference of a roster patient — never the name. The Dashboard's own patient id when
   * the roster carries one (id / patientId), else the normalized phone; '' when neither exists
   * (no milestone tasks can be keyed, the UI asks for a manual check).
   */
  function patientRef(p) {
    var id = String((p && (p.id || p.patientId)) || '').trim();
    if (/^[A-Za-z0-9_-]{1,80}$/.test(id)) return 'id:' + id;
    var ph = normalizePhone(p && p.phone);
    return ph ? 'phone:' + ph : '';
  }
  /** The CRM subject id milestone tasks / contacts are filed under. */
  function subjectId(ref) { return ref ? 'cont:' + ref : ''; }
  /**
   * Link a roster patient to the outpatient records by NORMALIZED PHONE only (never by name).
   * Exactly one client → linked client; else exactly one lead → linked lead; several → ambiguous
   * (manual check); none → none. Removed / not-relevant records are not candidates.
   */
  function linkPatient(p, clients, leads) {
    var ph = normalizePhone(p && p.phone);
    if (!ph) return { state: 'none', clientId: '', leadId: '', reason: 'no_phone' };
    var cs = (clients || []).filter(function (c) { return c && normalizePhone(c.phone) === ph; });
    var ls = (leads || []).filter(function (l) { return l && l.stage !== 'removed' && normalizePhone(l.phone) === ph; });
    if (cs.length + ls.length === 0) return { state: 'none', clientId: '', leadId: '', reason: 'no_match' };
    if (cs.length === 1 && ls.length === 0) return { state: 'linked', clientId: String(cs[0].id), leadId: '', reason: 'client' };
    if (cs.length === 0 && ls.length === 1) return { state: 'linked', clientId: '', leadId: String(ls[0].id), reason: 'lead' };
    return { state: 'ambiguous', clientId: '', leadId: '', reason: 'multiple', matches: cs.length + ls.length };
  }
  function isCrmStatus(v) { return CRM_STATUSES.indexOf(String(v == null ? '' : v)) >= 0; }
  function isTerminalStatus(v) { return CRM_TERMINAL.indexOf(String(v == null ? '' : v)) >= 0; }

  return {
    VALID_OUTCOMES: VALID_OUTCOMES,
    HOUSE_TO_ORIGIN: HOUSE_TO_ORIGIN,
    buildKey: buildKey,
    monthsSince: monthsSince,
    bucketOf: bucketOf,
    isValidOutcome: isValidOutcome,
    compareByTenure: compareByTenure,
    houseToOrigin: houseToOrigin,
    MILESTONE_MONTHS: MILESTONE_MONTHS,
    CONTACT_LEAD_DAYS: CONTACT_LEAD_DAYS,
    CRM_STATUSES: CRM_STATUSES,
    CRM_TERMINAL: CRM_TERMINAL,
    addCalendarMonths: addCalendarMonths,
    addDays: addDays,
    milestones: milestones,
    milestoneTaskId: milestoneTaskId,
    parseMilestoneTaskId: parseMilestoneTaskId,
    normalizePhone: normalizePhone,
    patientRef: patientRef,
    subjectId: subjectId,
    linkPatient: linkPatient,
    isCrmStatus: isCrmStatus,
    isTerminalStatus: isTerminalStatus
  };
});
