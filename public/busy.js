/*
 * busy.js — one shared "this button is working" indicator for every action in
 * the app.
 *
 * Why: several actions (saves, renewals, quote creation, list refreshes) gave
 * no visual feedback at all, so users clicked twice and risked duplicate
 * writes. Instead of ad-hoc `btn.disabled = true` at every call site, every
 * write/reload action is wrapped once with `Busy.withBusy(button, fn)`:
 *
 *   - the pressed control is disabled and gets `aria-busy="true"`;
 *   - a button's label is replaced by a pure-CSS inline spinner while its
 *     measured width/height are pinned, so the layout never jumps;
 *   - a second click while busy is a no-op — `fn` is NOT called again;
 *   - the control is restored on success AND on failure.
 *
 * The module holds no app logic and touches no payloads: it only wraps. It is
 * loaded as a browser global (`window.Busy`) and as a CommonJS module so the
 * pure logic is unit-testable without a browser (the tests drive it with plain
 * fake elements — every DOM access below is therefore defensive).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.Busy = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  var SPINNER_HTML = '<span class="busy-spinner" aria-hidden="true"></span>';
  var BUSY_CLASS = 'is-busy';

  // Previous visual state per element. WeakMap where available so detached
  // nodes are collectable; a small array fallback keeps the module usable in
  // minimal test environments.
  var store = (typeof WeakMap === 'function') ? new WeakMap() : (function () {
    var keys = [], vals = [];
    return {
      get: function (k) { var i = keys.indexOf(k); return i < 0 ? undefined : vals[i]; },
      set: function (k, v) { var i = keys.indexOf(k); if (i < 0) { keys.push(k); vals.push(v); } else vals[i] = v; },
      has: function (k) { return keys.indexOf(k) >= 0; },
      'delete': function (k) { var i = keys.indexOf(k); if (i >= 0) { keys.splice(i, 1); vals.splice(i, 1); } return i >= 0; }
    };
  })();

  function tag(el) {
    return (el && typeof el.tagName === 'string') ? el.tagName.toUpperCase() : '';
  }

  // Only real buttons get their label swapped for the spinner. A <select> or
  // <input> keeps its content (swapping it would destroy the options / value);
  // those get the busy class + aria-busy, and CSS renders a moving sheen.
  function labelIsSwappable(el) {
    if (!el || typeof el.innerHTML !== 'string') return false;
    var t = tag(el);
    return t === 'BUTTON' || t === 'A' || t === 'SPAN' || t === 'DIV' || t === 'LABEL' || t === '';
  }

  function isBusy(el) {
    if (!el) return false;
    if (store.has(el)) return true;
    return !!(el.getAttribute && el.getAttribute('aria-busy') === 'true');
  }

  /**
   * Put `el` into the busy state. Returns true if this call is the one that
   * made it busy (so the matching clearBusy is this caller's responsibility),
   * false if it was busy already or there is nothing to do.
   */
  function setBusy(el) {
    if (!el || isBusy(el)) return false;
    var prev = {
      html: labelIsSwappable(el) ? el.innerHTML : null,
      disabled: !!el.disabled,
      minWidth: (el.style && typeof el.style.minWidth === 'string') ? el.style.minWidth : null,
      minHeight: (el.style && typeof el.style.minHeight === 'string') ? el.style.minHeight : null
    };
    // Pin the current box BEFORE the label is replaced, so the row keeps its
    // geometry in both LTR and RTL.
    var w = Number(el.offsetWidth) || 0;
    var h = Number(el.offsetHeight) || 0;
    if (el.style) {
      if (w > 0) el.style.minWidth = w + 'px';
      if (h > 0) el.style.minHeight = h + 'px';
    }
    store.set(el, prev);
    if (el.setAttribute) el.setAttribute('aria-busy', 'true');
    if (el.classList && el.classList.add) el.classList.add(BUSY_CLASS);
    if (prev.html !== null) el.innerHTML = SPINNER_HTML;
    el.disabled = true;
    return true;
  }

  /** Restore whatever setBusy changed. Safe to call on a non-busy element. */
  function clearBusy(el) {
    if (!el) return false;
    var prev = store.get(el);
    store['delete'](el);
    if (el.removeAttribute) el.removeAttribute('aria-busy');
    else if (el.setAttribute) el.setAttribute('aria-busy', 'false');
    if (el.classList && el.classList.remove) el.classList.remove(BUSY_CLASS);
    if (!prev) { if (el.disabled) el.disabled = false; return false; }
    if (prev.html !== null && typeof el.innerHTML === 'string') el.innerHTML = prev.html;
    if (el.style) {
      if (typeof prev.minWidth === 'string') el.style.minWidth = prev.minWidth;
      if (typeof prev.minHeight === 'string') el.style.minHeight = prev.minHeight;
    }
    el.disabled = prev.disabled;
    return true;
  }

  /**
   * Run `fn` with `el` busy for the whole time it takes.
   *
   * `fn` may return a promise (the usual case: a POST plus the list reload
   * that follows it — resolve it only when the refresh is done, so the
   * spinner outlives the request) or a plain value.
   *
   * Returns a promise that settles exactly like `fn`'s result. When `el` is
   * already busy the call is dropped: `fn` is never invoked and the promise
   * resolves with `Busy.BLOCKED`.
   */
  function withBusy(el, fn) {
    if (typeof fn !== 'function') return Promise.reject(new TypeError('Busy.withBusy: fn must be a function'));
    if (isBusy(el)) return Promise.resolve(BLOCKED);
    var owned = setBusy(el);
    var out;
    try {
      out = fn();
    } catch (err) {
      if (owned) clearBusy(el);
      return Promise.reject(err);
    }
    return Promise.resolve(out).then(function (v) {
      if (owned) clearBusy(el);
      return v;
    }, function (err) {
      if (owned) clearBusy(el);
      throw err;
    });
  }

  var BLOCKED = { blocked: true };

  /**
   * Convenience for delegated click handlers: resolve the nearest actionable
   * element from an event and wrap it. Falls back to currentTarget/target.
   */
  function fromEvent(e, selector) {
    if (!e) return null;
    var t = e.target || null;
    if (t && typeof t.closest === 'function') {
      var hit = t.closest(selector || 'button, [role="button"], .btn');
      if (hit) return hit;
    }
    return e.currentTarget || t;
  }

  function withBusyEvent(e, fn, selector) {
    return withBusy(fromEvent(e, selector), fn);
  }

  return {
    BLOCKED: BLOCKED,
    SPINNER_HTML: SPINNER_HTML,
    isBusy: isBusy,
    setBusy: setBusy,
    clearBusy: clearBusy,
    withBusy: withBusy,
    fromEvent: fromEvent,
    withBusyEvent: withBusyEvent
  };
});
