/**
 * conflicts.js
 * -----------------------------------------------------------------------------
 * Pure helper for the stale-save CONFLICT REFUSAL banner (Outpatient PR 2, the
 * port of E-Zone-Dashboard PR #114).
 *
 * WHAT A CONFLICT IS
 * ------------------
 * Every Clients / Leads row carries server-owned `updatedAt` / `updatedBy`
 * stamps (PR 1). A tab echoes the `updatedAt` it LOADED back on saveAll; when
 * the sheet's stamp for that id has moved on since (someone else saved a real
 * change in between) AND this tab is trying to change content, the Apps Script
 * REFUSES that one row — it keeps the sheet's row byte-for-byte and returns
 * the refusal in an additive `conflicts` array:
 *
 *   { id, name, sheetUpdatedAt, sheetUpdatedBy, changed: [column, ...] }
 *
 * The rest of the save proceeds. The client then shows ONE Hebrew banner built
 * here and reloads, so the tab shows the sheet's version. It never retries.
 *
 * PURITY
 * ------
 * conflictsMessage(res) depends only on its argument and touches no DOM, so it
 * is unit-tested in isolation (test/name-picker-conflicts.test.js) and the
 * banner wording lives in exactly one place. Names are joined into plain text;
 * the caller renders it with textContent (never innerHTML).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.EzoneConflicts = api;       // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Fallback for a refusal whose sheet row was stamped WHEN but not by whom
   * (a legacy user-less cookie, or a cross-app receiver). */
  var UNKNOWN_EDITOR = 'מישהו/י';

  /** The `conflicts` array of a saveAll response, or [] for anything else. */
  function conflictsOf(res) {
    var list = res && Array.isArray(res.conflicts) ? res.conflicts : [];
    return list.filter(function (c) { return c && typeof c === 'object'; });
  }

  /* Unique, order-preserving, blanks dropped. */
  function uniqueNonBlank(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      var s = String(v == null ? '' : v).trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out;
  }

  /**
   * The Hebrew banner text for a saveAll response that carries conflicts:
   *
   *   השינוי ל־<names> לא נשמר — <updatedBy> עדכן/ה קודם. הנתונים רועננו.
   *
   * <names>     = the refused rows' names ("id" when a row has no name),
   *               unique, joined with ", ".
   * <updatedBy> = the unique non-blank sheetUpdatedBy values joined with " / ",
   *               or מישהו/י when none of the refused rows names an editor.
   *
   * Returns '' when the response carries no conflicts, so callers can use the
   * result as the "show a banner?" test itself.
   */
  function conflictsMessage(res) {
    var list = conflictsOf(res);
    if (!list.length) return '';
    var names = uniqueNonBlank(list.map(function (c) {
      var n = String(c.name == null ? '' : c.name).trim();
      return n || String(c.id == null ? '' : c.id).trim();
    }));
    var editors = uniqueNonBlank(list.map(function (c) { return c.sheetUpdatedBy; }));
    var who = editors.length ? editors.join(' / ') : UNKNOWN_EDITOR;
    return 'השינוי ל־' + names.join(', ') + ' לא נשמר — ' + who + ' עדכן/ה קודם. הנתונים רועננו.';
  }

  return {
    UNKNOWN_EDITOR: UNKNOWN_EDITOR,
    conflictsOf: conflictsOf,
    conflictsMessage: conflictsMessage
  };
});
