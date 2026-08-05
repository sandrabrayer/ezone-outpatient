/* E-ZONE Outpatient — shared name-search helper.
 *
 * A tiny, pure module so every list tab filters names the SAME way and the
 * behaviour is unit-testable in Node (the per-tab filters historically lived
 * inline inside the app.js IIFE, where they could not be imported).
 *
 * Contract:
 *   - Match is a CASE-INSENSITIVE SUBSTRING of the query inside the name.
 *   - The query is trimmed; an empty / whitespace-only query matches
 *     everything (i.e. "empty query = current behavior exactly").
 *   - filterByName returns a NEW array and never mutates its input, so the
 *     unfiltered source list (and its order) is preserved.
 *
 * UMD: module.exports under Node (tests), window.NameSearch in the browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();            // Node / tests
  } else {
    root.NameSearch = factory();           // Browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Canonical query form: trimmed + lower-cased. Whitespace-only -> ''.
  function normalizeQuery(q) {
    return String(q == null ? '' : q).trim().toLowerCase();
  }

  // True when `query` is a case-insensitive substring of `name`.
  // An empty / whitespace-only query matches every name.
  function matchesName(name, query) {
    var q = normalizeQuery(query);
    if (!q) return true;
    return String(name == null ? '' : name).toLowerCase().indexOf(q) !== -1;
  }

  // Filter `list` by name. `nameOf` maps an item to its name string; it
  // defaults to reading `.name` (or the item itself when it is a bare string).
  // An empty / whitespace-only query returns a shallow copy of the whole list.
  function filterByName(list, query, nameOf) {
    var items = Array.isArray(list) ? list : [];
    if (!normalizeQuery(query)) return items.slice();
    var pick = typeof nameOf === 'function'
      ? nameOf
      : function (item) { return item && typeof item === 'object' ? item.name : item; };
    return items.filter(function (item) { return matchesName(pick(item), query); });
  }

  return {
    normalizeQuery: normalizeQuery,
    matchesName: matchesName,
    filterByName: filterByName
  };
});
