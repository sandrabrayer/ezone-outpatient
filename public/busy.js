/**
 * busy.js
 * -----------------------------------------------------------------------------
 * The timing state machine behind the app's "working" indicator (spinner).
 *
 * WHY A MODULE
 * ------------
 * The rules that make a spinner feel calm instead of flickery are all about
 * TIME, and time is exactly what is hard to test through the DOM. So the rules
 * live here as a pure state machine with INJECTABLE timers, unit-tested in
 * test/busy-indicator.test.js, and app.js supplies the DOM callbacks.
 *
 * THE RULES
 * ---------
 *   1. Show only if the action is still running after SHOW_DELAY_MS (150 ms).
 *      A fast action never flashes a spinner at all.
 *   2. Once shown, stay visible at least MIN_VISIBLE_MS (300 ms), so a spinner
 *      that did appear cannot blink out instantly.
 *   3. After SLOW_AFTER_MS (20 s) of continuous work, surface SLOW_TEXT
 *      ("זה לוקח יותר מהרגיל…") alongside the spinner.
 *   4. Reference-counted: several overlapping actions on one region share a
 *      single spinner, which hides only when the LAST of them finishes.
 *
 * NEVER STUCK
 * -----------
 * begin() hands back an end() that is idempotent (a double call cannot
 * unbalance the count) and the count never drops below zero. Callers invoke it
 * from a finally block, so an error, a rejection and a success all end the same
 * way. reset() is the hard stop for teardown.
 *
 * The Hebrew labels live here too, so the wording exists in exactly one place
 * and the tests can assert on the same constants the UI renders.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;          // Node / tests
  } else {
    root.EzoneBusy = api;          // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Show only after this long — below it, the action is "instant" and no
   * spinner should ever appear. */
  var SHOW_DELAY_MS = 150;
  /* ...but once it HAS appeared, keep it up at least this long. */
  var MIN_VISIBLE_MS = 300;
  /* ...and after this long, say so. */
  var SLOW_AFTER_MS = 20000;

  var SLOW_TEXT = 'זה לוקח יותר מהרגיל…';

  /* One label per kind of action. `load` is the fallback for anything that
   * does not name its kind, because "טוען…" is the one that is never wrong. */
  var LABELS = {
    save: 'שומר…',
    search: 'מחפש…',
    send: 'שולח…',
    load: 'טוען…',
    'export': 'מייצא…'
  };

  function labelFor(kind) {
    return Object.prototype.hasOwnProperty.call(LABELS, kind) ? LABELS[kind] : LABELS.load;
  }

  /**
   * createTracker({ onShow, onHide, onSlow, setTimeout, clearTimeout, now })
   *
   * onShow()        — render the spinner.
   * onHide()        — remove it.
   * onSlow(isSlow)  — true when SLOW_TEXT should appear, false when it should
   *                   go away again (always called with false before onHide,
   *                   so the caller never has to clean it up itself).
   *
   * The timer/clock functions are injected so tests drive them deterministically.
   */
  function createTracker(opts) {
    opts = opts || {};
    var onShow = opts.onShow || function () {};
    var onHide = opts.onHide || function () {};
    var onSlow = opts.onSlow || function () {};
    var setT = opts.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var clearT = opts.clearTimeout || function (id) { return clearTimeout(id); };
    var now = opts.now || function () { return Date.now(); };

    var count = 0;         // how many actions are in flight on this region
    var visible = false;   // is the spinner rendered right now
    var slow = false;      // is SLOW_TEXT rendered right now
    var shownAt = 0;
    var showTimer = null;
    var hideTimer = null;
    var slowTimer = null;

    function cancel(id) { if (id !== null && id !== undefined) clearT(id); return null; }

    function doShow() {
      showTimer = null;
      if (visible) return;
      visible = true;
      shownAt = now();
      onShow();
    }

    function doHide() {
      hideTimer = null;
      if (!visible) return;
      visible = false;
      onHide();
    }

    function clearSlow() {
      slowTimer = cancel(slowTimer);
      if (slow) { slow = false; onSlow(false); }
    }

    /* Settle back to idle: drop SLOW_TEXT, then hide — immediately if the
     * spinner has already had its MIN_VISIBLE_MS, otherwise once it has. */
    function settle() {
      clearSlow();
      if (!visible) { showTimer = cancel(showTimer); return; }
      var elapsed = now() - shownAt;
      if (elapsed >= MIN_VISIBLE_MS) doHide();
      else if (hideTimer === null) hideTimer = setT(doHide, MIN_VISIBLE_MS - elapsed);
    }

    /**
     * Mark one action as started. Returns the end() to call in a finally
     * block. end() is idempotent: calling it twice is a no-op, so a caller
     * that ends in both a .then and a .catch cannot corrupt the count.
     */
    function begin() {
      count++;
      if (count === 1) {
        // A new action during the min-visible hold cancels the pending hide,
        // so back-to-back saves show one continuous spinner, not a stutter.
        hideTimer = cancel(hideTimer);
        if (!visible) showTimer = setT(doShow, SHOW_DELAY_MS);
        // The 20 s clock runs from when the region STARTED working, not from
        // when the spinner appeared.
        slowTimer = setT(function () {
          slowTimer = null;
          if (slow) return;
          slow = true;
          onSlow(true);
        }, SLOW_AFTER_MS);
      }
      var ended = false;
      return function end() {
        if (ended) return;
        ended = true;
        count = count > 0 ? count - 1 : 0;
        if (count === 0) settle();
      };
    }

    /* Hard stop — drop every timer and hide at once, whatever the count.
     * For teardown and for the "this can never get stuck" escape hatch. */
    function reset() {
      showTimer = cancel(showTimer);
      hideTimer = cancel(hideTimer);
      clearSlow();
      count = 0;
      if (visible) { visible = false; onHide(); }
    }

    return {
      begin: begin,
      reset: reset,
      isVisible: function () { return visible; },
      isSlow: function () { return slow; },
      activeCount: function () { return count; }
    };
  }

  /**
   * createControlGuard(el) — the double-activation guard for one control.
   *
   * This is the half of the indicator that is about CORRECTNESS rather than
   * looks: a second click on a save button has created duplicate rows in this
   * app before. It touches nothing but `el.disabled`, so it is unit-tested
   * against a plain object and needs no DOM.
   *
   *   begin() -> null        the control is ALREADY working; the caller must
   *                          do nothing at all (swallow the click).
   *   begin() -> release()   the control is now disabled; release() puts it
   *                          back EXACTLY as it was found (a control that was
   *                          already disabled for its own reasons stays
   *                          disabled) and is idempotent.
   */
  function createControlGuard(el) {
    if (!el) return { begin: function () { return function () {}; }, isBusy: function () { return false; } };
    return {
      begin: function () {
        if (el.__ezBusyActive) return null;
        el.__ezBusyActive = true;
        el.__ezBusyPrevDisabled = !!el.disabled;
        el.disabled = true;
        var released = false;
        return function release() {
          if (released) return;
          released = true;
          el.__ezBusyActive = false;
          el.disabled = !!el.__ezBusyPrevDisabled;
        };
      },
      isBusy: function () { return !!el.__ezBusyActive; }
    };
  }

  return {
    SHOW_DELAY_MS: SHOW_DELAY_MS,
    MIN_VISIBLE_MS: MIN_VISIBLE_MS,
    SLOW_AFTER_MS: SLOW_AFTER_MS,
    SLOW_TEXT: SLOW_TEXT,
    LABELS: LABELS,
    labelFor: labelFor,
    createTracker: createTracker,
    createControlGuard: createControlGuard
  };
});
