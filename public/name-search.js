/**
 * name-search.js
 * -----------------------------------------------------------------------------
 * Canonical, framework-free helper for the per-tab name search boxes.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every list tab (Leads, Clients, Billing, Retention, Continuation, Payouts)
 * carries its OWN search box and its OWN query string in `state` — searching in
 * one tab must never affect another. The matching rule itself, though, is the
 * same everywhere: a trimmed, case-insensitive substring match against a name,
 * where an empty query means "show everything". This module is the single
 * source of truth for that rule so it can be unit-tested in isolation and
 * reused without copy-pasting the `.trim().toLowerCase().indexOf(...) === -1`
 * idiom into yet another render function.
 *
 * PURITY
 * ------
 * These functions hold no state between calls — the result of every call
 * depends only on its arguments. That is exactly what makes per-tab
 * independence possible: each tab passes its own query, and no call can leak
 * into another.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.NameSearch = api;           // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Trim + lowercase a raw query. null/undefined -> ''. */
  function normalizeQuery(query) {
    return String(query == null ? '' : query).trim().toLowerCase();
  }

  /**
   * Does `name` match `query` (case-insensitive substring)?
   * An empty / whitespace-only query matches EVERYTHING (returns true).
   * @param {*} name  the value to test (coerced to string; null/undefined -> '')
   * @param {*} query the raw user query
   * @returns {boolean}
   */
  function matchesName(name, query) {
    var q = normalizeQuery(query);
    if (!q) return true;
    return String(name == null ? '' : name).toLowerCase().indexOf(q) !== -1;
  }

  /**
   * Filter a list by name. Empty query returns a shallow copy of the whole
   * list (current behavior exactly); no match returns an empty array.
   * @param {Array} items
   * @param {*} query raw user query
   * @param {(item:*)=>*} [getName] pluck the name off each item (default: identity)
   * @returns {Array} a new array (never mutates `items`)
   */
  function filterByName(items, query, getName) {
    var list = items || [];
    var q = normalizeQuery(query);
    if (!q) return list.slice();
    var get = typeof getName === 'function' ? getName : function (x) { return x; };
    return list.filter(function (item) { return matchesName(get(item), query); });
  }

  return {
    normalizeQuery: normalizeQuery,
    matchesName: matchesName,
    filterByName: filterByName
  };
});
