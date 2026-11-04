/**
 * global-search.js
 * -----------------------------------------------------------------------------
 * Pure matching for the «חיפוש מטופל» box pinned to the top of «היום שלי».
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Vered's day starts on «היום שלי». Finding a patient meant leaving it for the
 * מטופלים tab (or מטופלים לא פעילים, or לידים) and typing the name again. This
 * module answers "which patient / lead does this text mean?" over the lists the
 * app has ALREADY loaded — no new fetch, no new Apps Script action.
 *
 * Distinct from public/patient-search.js: that one is the forensic cross-store
 * locator (tombstones, billing-only orphans, money on the row). This one is the
 * everyday jump-to-patient box, so it carries NO financial field at all and an
 * operational session (דנה) can use it exactly as ורד does.
 *
 * MATCHING RULE
 * -------------
 * - name:  partial match ANYWHERE, case-insensitive, niqqud/diacritics ignored.
 * - phone: digits only on BOTH sides, so «052-378-7911», «0523787911» and
 *          «3787911» all match the same client.
 * - a query with letters never matches a phone; a digits-only query matches
 *   phones and names that contain those digits.
 * - blank query matches NOTHING (a dropdown shows no list at rest).
 *
 * PURITY
 * ------
 * No state, no DOM, no clock: the result depends only on the arguments, like
 * name-search.js. The render layer owns presentation and navigation.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.GlobalSearch = api;         // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DISCHARGED = 'סיים טיפול';
  var DEACTIVATED = 'לא פעיל';
  var MAX_RESULTS = 8;

  /* Hebrew niqqud / cantillation (U+0591–U+05C7) are invisible in a name but
   * break indexOf, so they are stripped from both sides before matching. */
  var MARKS = /[֑-ׇ]/g;

  function s(v) { return String(v == null ? '' : v).trim(); }

  /** Fold a name (or a raw query) for comparison: trim, strip marks, lowercase. */
  function foldName(v) {
    return s(v).replace(MARKS, '').toLowerCase();
  }

  /** Digits only, Western digits; '' when there are none. */
  function digits(v) {
    return s(v).replace(/\D+/g, '');
  }

  /**
   * Normalize a raw query into the two forms the matcher needs.
   * @param {*} query
   * @returns {{text:string, digits:string, empty:boolean}}
   */
  function normalizeQuery(query) {
    var text = foldName(query);
    return { text: text, digits: digits(query), empty: text === '' };
  }

  /**
   * Does this name/phone pair match the query?
   * @param {*} name
   * @param {*} phone
   * @param {{text:string,digits:string,empty:boolean}} q from normalizeQuery
   * @returns {boolean} false for a blank query (never "everything")
   */
  function matches(name, phone, q) {
    if (!q || q.empty) return false;
    if (q.text && foldName(name).indexOf(q.text) !== -1) return true;
    if (q.digits && digits(phone).indexOf(q.digits) !== -1) return true;
    return false;
  }

  function statusOf(client) {
    var st = s(client && client.status);
    if (st === DISCHARGED || st === DEACTIVATED) {
      return { statusKind: 'inactive', statusLabel: 'לא פעיל', tab: 'inactive' };
    }
    return { statusKind: 'active', statusLabel: 'פעיל', tab: 'clients' };
  }

  /** house / service line for a result row — never a money field. */
  function subOf(a, b) {
    return [s(a), s(b)].filter(Boolean).join(' · ');
  }

  /**
   * Rank: active clients first, then inactive, then leads; alphabetical inside
   * each group so the same query always yields the same order.
   */
  var GROUP = { active: 0, inactive: 1, lead: 2 };
  function compare(a, b) {
    var g = GROUP[a.statusKind] - GROUP[b.statusKind];
    if (g) return g;
    var x = foldName(a.name), y = foldName(b.name);   // niqqud must not reorder
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /**
   * Search the already-loaded lists.
   * @param {*} query raw user text; blank → []
   * @param {{clients?:Array, leads?:Array, limit?:number}} data
   *   clients — normalized client rows (any status)
   *   leads   — normalized lead rows; only OPEN leads are offered (a
   *             not_relevant lead lives in שימור לידים, an `active` lead
   *             already has a client card)
   * @returns {Array} at most `limit` (default 8) rows, each
   *   { kind:'client'|'lead', id, name, phone, sub, statusKind, statusLabel, tab }
   *   and NOTHING financial.
   */
  function search(query, data) {
    var q = normalizeQuery(query);
    if (q.empty) return [];   // digits are kept by foldName, so empty text == no query
    var d = data || {};
    var limit = d.limit == null ? MAX_RESULTS : Math.max(0, Number(d.limit) || 0);
    var out = [];

    (Array.isArray(d.clients) ? d.clients : []).forEach(function (c) {
      if (!c || !matches(c.name, c.phone, q)) return;
      var st = statusOf(c);
      out.push({
        kind: 'client', id: s(c.id), name: s(c.name), phone: s(c.phone),
        sub: subOf(c.serviceType, c.location),
        statusKind: st.statusKind, statusLabel: st.statusLabel, tab: st.tab
      });
    });

    (Array.isArray(d.leads) ? d.leads : []).forEach(function (l) {
      if (!l) return;
      var stage = s(l.stage);
      if (stage === 'not_relevant' || stage === 'active') return;
      if (!matches(l.name, l.phone, q)) return;
      out.push({
        kind: 'lead', id: s(l.id), name: s(l.name), phone: s(l.phone),
        sub: subOf(l.serviceType, l.location),
        statusKind: 'lead', statusLabel: 'ליד', tab: 'leads'
      });
    });

    out.sort(compare);
    return out.slice(0, limit);
  }

  return {
    MAX_RESULTS: MAX_RESULTS,
    foldName: foldName,
    digits: digits,
    normalizeQuery: normalizeQuery,
    matches: matches,
    search: search
  };
});
