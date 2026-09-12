'use strict';

/**
 * The "working" indicator (spinner).
 *
 * Locked contracts:
 *   A. public/busy.js createTracker — the TIMING rules, driven by injected
 *      timers so every assertion is deterministic: nothing shows before
 *      150 ms; once shown it stays at least 300 ms; 20 s of continuous work
 *      adds the Hebrew "slow" notice; success, error and slow all end with
 *      the spinner gone. Reference-counted, and end() is idempotent, so the
 *      spinner can never get stuck.
 *   B. public/busy.js createControlGuard — the double-activation guard: the
 *      button is disabled at once, a second activation is REFUSED (this is
 *      the duplicate-row guard, not decoration), and release() restores the
 *      control exactly as it was found.
 *   C. The Hebrew labels, in one place.
 *   D. public/app.js wiring — every call to the server goes through the one
 *      apiFetch funnel (so no action can be missed), and the funnel always
 *      ends its indicator in a finally.
 *   E. Markup + CSS — the header status region, the per-field spinners, RTL
 *      via logical properties, the app's existing accent, and the
 *      prefers-reduced-motion pulse instead of a rotation.
 *   F. public/sw.js — cache bumped v5 -> v6 (the frontend changed).
 *
 * No DOM library and no new dependency: the timing and guard rules are pure,
 * and the wiring is pinned by reading the shipped sources.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Busy = require('../public/busy');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
const BUSY_SRC = fs.readFileSync(path.join(ROOT, 'public', 'busy.js'), 'utf8');

/* A deterministic clock: nothing happens until the test advances it. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    /* Run every timer due within `ms`, in due order, moving `now` with them. */
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) {
          if (t.at <= until && (next === null || t.at < next.t.at)) next = { id, t };
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.t.at;
        next.t.fn();
      }
      now = until;
    },
    pending: () => timers.size
  };
}

function makeTracker(clock, log) {
  return Busy.createTracker({
    onShow: function () { log.push('show'); },
    onHide: function () { log.push('hide'); },
    onSlow: function (isSlow) { log.push(isSlow ? 'slow' : 'unslow'); },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now
  });
}

/* ================= A. timing ================= */

test('A: a fast action never shows a spinner at all', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const end = tr.begin();
  clock.advance(149);
  assert.deepEqual(log, [], 'nothing before 150 ms');
  end();
  clock.advance(10000);
  assert.deepEqual(log, [], 'and nothing after, either — it was never shown');
  assert.equal(tr.isVisible(), false);
  assert.equal(clock.pending(), 0, 'no timer left behind');
});

test('A: a slow-enough action shows at exactly 150 ms', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  tr.begin();
  clock.advance(149);
  assert.deepEqual(log, []);
  clock.advance(1);
  assert.deepEqual(log, ['show'], 'shown at 150 ms, not before');
  assert.equal(tr.isVisible(), true);
});

test('A: once shown it stays at least 300 ms — no flicker', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const end = tr.begin();
  clock.advance(150);
  assert.deepEqual(log, ['show']);
  clock.advance(10);           // the action finishes 10 ms after the spinner appeared
  end();
  assert.deepEqual(log, ['show'], 'not hidden immediately');
  clock.advance(289);
  assert.deepEqual(log, ['show'], 'still up at 299 ms of visibility');
  clock.advance(1);
  assert.deepEqual(log, ['show', 'hide'], 'hidden at exactly 300 ms visible');
  assert.equal(tr.isVisible(), false);
});

test('A: an action that outlasts the minimum hides the moment it ends', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const end = tr.begin();
  clock.advance(150 + 300 + 5);
  assert.deepEqual(log, ['show']);
  end();
  assert.deepEqual(log, ['show', 'hide'], 'no extra hold — it already had its 300 ms');
});

test('A: after 20 s the slow notice appears, and clears when the action ends', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const end = tr.begin();
  clock.advance(19999);
  assert.deepEqual(log, ['show'], 'no notice before 20 s');
  assert.equal(tr.isSlow(), false);
  clock.advance(1);
  assert.deepEqual(log, ['show', 'slow'], 'the notice at exactly 20 s');
  assert.equal(tr.isSlow(), true);
  end();
  assert.deepEqual(log, ['show', 'slow', 'unslow', 'hide'], 'the notice always goes before the spinner');
  assert.equal(tr.isSlow(), false);
  assert.equal(tr.isVisible(), false);
});

test('A: the 20 s clock runs from when the work started, not from when the spinner appeared', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  tr.begin();
  clock.advance(20000);
  assert.deepEqual(log, ['show', 'slow'], 'slow at 20 s of WORK (the spinner appeared at 150 ms)');
});

test('A: an ERROR path ends exactly like a success — the spinner always stops', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const end = tr.begin();
  clock.advance(500);
  assert.deepEqual(log, ['show']);
  // however the caller's promise settled, the finally calls end() once
  end();
  assert.deepEqual(log, ['show', 'hide']);
  assert.equal(tr.isVisible(), false);
  assert.equal(tr.activeCount(), 0);
});

test('A: end() is idempotent and the count never goes negative — no stuck spinner', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const endA = tr.begin();
  const endB = tr.begin();
  assert.equal(tr.activeCount(), 2);
  endA(); endA(); endA();          // a caller that ends in both .then and .catch
  assert.equal(tr.activeCount(), 1, 'a double end cannot unbalance the count');
  clock.advance(150);
  assert.deepEqual(log, ['show'], 'still working — one action is left');
  endB(); endB();
  assert.equal(tr.activeCount(), 0);
  clock.advance(300);
  assert.deepEqual(log, ['show', 'hide']);
});

test('A: overlapping actions share ONE spinner, which hides only when the last ends', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const endA = tr.begin();
  clock.advance(150);
  const endB = tr.begin();          // a second action starts while the first runs
  assert.deepEqual(log, ['show'], 'one spinner, not two');
  clock.advance(400);
  endA();
  assert.deepEqual(log, ['show'], 'the second action is still running');
  endB();
  assert.deepEqual(log, ['show', 'hide']);
});

test('A: a new action during the 300 ms hold keeps ONE continuous spinner', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  const endA = tr.begin();
  clock.advance(150);
  endA();                            // hide is now pending (300 ms hold)
  clock.advance(100);
  const endB = tr.begin();           // ...and a new action arrives inside it
  clock.advance(1000);
  assert.deepEqual(log, ['show'], 'never hidden in between — no stutter');
  endB();
  clock.advance(300);
  assert.deepEqual(log, ['show', 'hide']);
});

test('A: reset() is a hard stop that leaves nothing running', () => {
  const clock = fakeClock(); const log = [];
  const tr = makeTracker(clock, log);
  tr.begin(); tr.begin();
  clock.advance(20000);
  assert.deepEqual(log, ['show', 'slow']);
  tr.reset();
  assert.deepEqual(log, ['show', 'slow', 'unslow', 'hide']);
  assert.equal(tr.activeCount(), 0);
  assert.equal(tr.isVisible(), false);
  clock.advance(60000);
  assert.equal(clock.pending(), 0, 'no orphan timer survives a reset');
});

test('A: a tracker with no handlers and real timers still cannot throw', () => {
  const tr = Busy.createTracker();
  const end = tr.begin();
  end(); end();
  tr.reset();
  assert.equal(tr.activeCount(), 0);
});

/* ================= B. the double-click guard ================= */

test('B: the control is disabled immediately and restored on release', () => {
  const btn = { disabled: false };
  const guard = Busy.createControlGuard(btn);
  const release = guard.begin();
  assert.equal(btn.disabled, true, 'disabled at once — not after 150 ms');
  assert.equal(guard.isBusy(), true);
  release();
  assert.equal(btn.disabled, false, 'the button re-enables when done');
  assert.equal(guard.isBusy(), false);
});

test('B: a SECOND activation during a save does nothing at all', () => {
  const btn = { disabled: false };
  const first = Busy.createControlGuard(btn).begin();
  assert.notEqual(first, null, 'the first click is accepted');
  // The second click — a different guard object over the same element, which
  // is what a second event handler run really does.
  const second = Busy.createControlGuard(btn).begin();
  assert.equal(second, null, 'the second click is REFUSED — this is the duplicate-row guard');
  assert.equal(btn.disabled, true, 'and it did not disturb the first');
  first();
  assert.equal(btn.disabled, false);
  // once finished, the button accepts a fresh click again
  const third = Busy.createControlGuard(btn).begin();
  assert.notEqual(third, null, 'a later click works normally');
  third();
});

test('B: only ONE save runs when a button is clicked twice in a row', () => {
  const btn = { disabled: false };
  let saves = 0;
  function click() {
    const release = Busy.createControlGuard(btn).begin();
    if (release === null) return null;   // swallowed — exactly what withBusy does
    saves++;
    return release;
  }
  const r = click();
  click(); click(); click();
  assert.equal(saves, 1, 'three extra clicks during the save added no second save');
  r();
  click();
  assert.equal(saves, 2, 'and the button still works afterwards');
});

test('B: release() is idempotent, so an error path cannot double-restore', () => {
  const btn = { disabled: false };
  const release = Busy.createControlGuard(btn).begin();
  release();
  btn.disabled = true;                 // something else disabled it afterwards
  release();                           // a stray second release must not undo that
  assert.equal(btn.disabled, true, 'the second release is a no-op');
});

test('B: a control that was ALREADY disabled comes back disabled', () => {
  // #stopAlertSubmit opens disabled until a reason is picked — restoring it to
  // "enabled" would quietly break that gate.
  const btn = { disabled: true };
  const release = Busy.createControlGuard(btn).begin();
  assert.equal(btn.disabled, true);
  release();
  assert.equal(btn.disabled, true, 'restored as FOUND, not as enabled');
});

test('B: a missing control is handled without throwing', () => {
  const guard = Busy.createControlGuard(null);
  const release = guard.begin();
  assert.equal(typeof release, 'function');
  release();
  assert.equal(guard.isBusy(), false);
});

/* ================= C. the Hebrew labels ================= */

test('C: one label per kind of action, and an unknown kind falls back to טוען…', () => {
  assert.deepEqual(Busy.LABELS, {
    save: 'שומר…', search: 'מחפש…', send: 'שולח…', load: 'טוען…', 'export': 'מייצא…'
  });
  assert.equal(Busy.labelFor('save'), 'שומר…');
  assert.equal(Busy.labelFor('search'), 'מחפש…');
  assert.equal(Busy.labelFor('send'), 'שולח…');
  assert.equal(Busy.labelFor('load'), 'טוען…');
  assert.equal(Busy.labelFor('export'), 'מייצא…');
  assert.equal(Busy.labelFor('nonsense'), 'טוען…', 'never undefined in the UI');
  assert.equal(Busy.labelFor(undefined), 'טוען…');
  // not fooled by inherited object properties
  assert.equal(Busy.labelFor('constructor'), 'טוען…');
  assert.equal(Busy.SLOW_TEXT, 'זה לוקח יותר מהרגיל…');
});

test('C: the timing constants are the documented ones', () => {
  assert.equal(Busy.SHOW_DELAY_MS, 150);
  assert.equal(Busy.MIN_VISIBLE_MS, 300);
  assert.equal(Busy.SLOW_AFTER_MS, 20000);
});

/* ================= D. app.js wiring ================= */

test('D: EVERY call to the server goes through the ONE apiFetch funnel', () => {
  // The whole "nothing is missed" guarantee rests on this: the only bare
  // fetch( in app.js is the one INSIDE apiFetch.
  const bare = APP.split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter((x) => !/^\s*(\/\/|\*|\/\*)/.test(x.l))          // prose, not code
    .filter((x) => /(^|[^a-zA-Z.])fetch\s*\(/.test(x.l))
    .filter((x) => !/apiFetch/.test(x.l));
  assert.equal(bare.length, 1, 'expected exactly one bare fetch( — got: ' +
    JSON.stringify(bare.map((x) => x.n + ': ' + x.l.trim())));
  assert.match(bare[0].l, /var r = await fetch\(url, opts\);/, 'and it is the one inside apiFetch');
});

test('D: apiFetch starts the indicator and ALWAYS ends it in a finally', () => {
  const m = APP.match(/async function apiFetch\(url, opts, cfg\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'apiFetch not found');
  const body = m[0];
  assert.match(body, /var endBusy = beginGlobalBusy\(cfg\.kind \|\| 'load'\);/);
  assert.match(body, /\} finally \{[\s\S]*endBusy\(\);[\s\S]*\}/, 'ended in a finally, so an error cannot strand it');
  assert.match(body, /r\.status === 401 && !cfg\.allow401/, 'the 401 bounce is still there');
});

test('D: the login and logout calls were moved onto the funnel too', () => {
  assert.match(APP, /apiFetch\('\/api\/verify-pin',[\s\S]{0,200}?allow401: true/);
  assert.match(APP, /apiFetch\('\/api\/logout',[\s\S]{0,120}?allow401: true/);
});

test('D: withBusy claims the control BEFORE any await — the duplicate-row guard', () => {
  const m = APP.match(/function withBusy\(target, kind, fn\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'withBusy not found');
  const body = m[0];
  assert.match(body, /claimBusyControl\(target\) === null\) return Promise\.resolve\(undefined\);/,
    'a refused claim must abandon the action entirely');
  assert.match(body, /return p\.finally\(function \(\) \{/, 'and it always unwinds in a finally');
  // the claim must come before fn() is ever called
  assert.ok(body.indexOf('claimBusyControl') < body.indexOf('fn()'), 'claim first, then run');
});

test('D: busyAttach releases idempotently, so every exit path is safe', () => {
  const m = APP.match(/function busyAttach\(el, kind\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'busyAttach not found');
  assert.match(m[0], /if \(released\) return;\s*\n\s*released = true;/, 'release() is idempotent');
});

test('D: the guard policy is the one busy.js exports — not a second copy', () => {
  assert.match(APP, /BusyMod\.createControlGuard\(el\)\.begin\(\)/);
  assert.match(APP, /BusyMod\.createTracker\(handlers\)/);
});

test('D: every instrumented action releases — one release per attach', () => {
  const attaches = (APP.match(/var releaseBusy = busyAttach\(/g) || []).length;
  const releases = (APP.match(/releaseBusy\(\);/g) || []).length;
  assert.ok(attaches >= 13, 'expected the modal/action handlers to be instrumented, got ' + attaches);
  assert.ok(releases >= attaches, attaches + ' attaches but only ' + releases + ' releases');
});

test('D: search-as-you-type is NOT swallowed by the double-activation guard', () => {
  // The guard is for controls. A search field's wrapper is a plain <span>, so
  // every keystroke starts a fresh action and the tracker reference-counts
  // them — otherwise typing would be dropped while a lookup was in flight.
  const m = APP.match(/function withBusy\(target, kind, fn\) \{[\s\S]*?\n  \}/);
  assert.match(m[0], /var isControl = !!\(target && \('disabled' in target\)\);/);
  assert.match(m[0], /if \(isControl && claimBusyControl/, 'the guard applies to controls ONLY');
  assert.match(APP, /function wireSearchBox\(sel, apply\)/);
  assert.match(APP, /withBusy\(region, 'search'/);
});

test('D: if busy.js fails to load, actions still run (the indicator degrades, nothing breaks)', () => {
  assert.match(APP, /var BusyMod = \(typeof self !== 'undefined' && self\.EzoneBusy\) \|\| null;/);
  const m = APP.match(/function makeBusyTracker\(handlers\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'makeBusyTracker not found');
  assert.match(m[0], /if \(BusyMod\) return BusyMod\.createTracker\(handlers\);/);
  assert.match(m[0], /begin: function \(\) \{ return function \(\) \{\}; \}/, 'a no-op tracker fallback');
});

/* ================= E. markup + CSS ================= */

test('E: busy.js is loaded before app.js', () => {
  const b = INDEX.indexOf('busy.js?v=__BUILD__');
  const a = INDEX.indexOf('app.js?v=__BUILD__');
  assert.ok(b > 0, 'busy.js script tag missing');
  assert.ok(a > 0 && b < a, 'busy.js must load before app.js');
});

test('E: the header carries role="status" with the Hebrew label and the 20 s notice', () => {
  const m = INDEX.match(/<span id="globalBusy"[\s\S]*?<\/span>\s*\n\s*<span id="sessionUser"/);
  assert.ok(m, '#globalBusy not found in the topbar');
  const box = m[0];
  assert.match(box, /role="status"/, 'role=status announces the label');
  assert.match(box, /id="globalBusy"[^>]*hidden/, 'hidden until something is working');
  assert.match(box, /<span class="busy-spinner" aria-hidden="true"><\/span>/,
    'the spinner itself is decorative — the label carries the meaning');
  assert.match(box, /id="globalBusyLabel" class="sr-only"/);
  assert.match(box, /id="globalBusySlow"[^>]*hidden>זה לוקח יותר מהרגיל…<\/span>/);
});

test('E: aria-busy marks the region whose content is in flux', () => {
  assert.match(APP, /app\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(APP, /app\.removeAttribute\('aria-busy'\)/);
  assert.match(APP, /el\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(APP, /el\.removeAttribute\('aria-busy'\)/);
});

test('E: every search field can host its own spinner', () => {
  const wraps = INDEX.match(/<span class="search-wrap">/g) || [];
  const inputs = INDEX.match(/<input id="[a-zA-Z]+[Ss]earch" class="search"/g) || [];
  assert.equal(inputs.length, 8, 'the app has eight search boxes');
  assert.equal(wraps.length, 8, 'each one is wrapped so a spinner can sit in the field');
  const spinners = INDEX.match(/<span class="busy-spinner search-spinner" aria-hidden="true" hidden><\/span>/g) || [];
  assert.equal(spinners.length, 8, 'and each has its own hidden spinner');
});

test('E: the spinner uses the app\'s existing accent — no new colour', () => {
  const block = CSS.slice(CSS.indexOf('.busy-spinner {'));
  assert.match(block, /border-top-color: var\(--green\);/, 'the existing accent token, not a literal');
  assert.doesNotMatch(CSS.slice(CSS.indexOf('/* ===== Working indicator')), /#[0-9a-fA-F]{3,6}\b/,
    'no hard-coded colour anywhere in the indicator CSS');
  assert.match(CSS, /:root \{[\s\S]*--green: #29d488;/, 'the accent token still exists');
});

test('E: RTL comes from logical properties, not direction-specific rules', () => {
  const block = CSS.slice(CSS.indexOf('/* ===== Working indicator'));
  assert.match(block, /inset-inline-end: 10px;/, 'the field spinner sits at the inline end (left in RTL)');
  assert.match(block, /margin-inline-end: 4px;/);
  assert.doesNotMatch(block, /\b(left|right):\s/, 'no physical left/right offsets');
  assert.doesNotMatch(block, /margin-(left|right):/);
  assert.doesNotMatch(block, /\[dir=/, 'no direction-specific overrides needed');
});

test('E: prefers-reduced-motion replaces the rotation with a pulsing dot', () => {
  const block = CSS.slice(CSS.indexOf('/* ===== Working indicator'));
  assert.match(block, /@keyframes busy-spin \{ to \{ transform: rotate\(360deg\); \} \}/);
  const rm = block.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
  assert.ok(rm, 'no prefers-reduced-motion block');
  assert.match(rm[0], /animation: busy-pulse/, 'a pulse instead');
  assert.match(rm[0], /@keyframes busy-pulse/);
  assert.doesNotMatch(rm[0], /rotate\(/, 'and definitely no rotation');
  assert.match(rm[0], /border: 0;[\s\S]*background: var\(--green\);/, 'a filled dot, not a ring');
});

test('E: a busy button stays legible and shows the working cursor', () => {
  const block = CSS.slice(CSS.indexOf('/* ===== Working indicator'));
  assert.match(block, /button\.is-busy\[disabled\] \{ opacity: 1; cursor: progress; \}/);
  assert.match(block, /\.sr-only \{/, 'the screen-reader-only helper exists');
});

test('E: the button label is swapped with textContent — never innerHTML', () => {
  const m = APP.match(/function paintBusy\(el, kind\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'paintBusy not found');
  assert.doesNotMatch(m[0], /innerHTML/, 'no innerHTML in the busy painting');
  assert.match(m[0], /el\.dataset\.busyPrevLabel = el\.textContent;/, 'the real label is remembered...');
  const u = APP.match(/function unpaintBusy\(el\) \{[\s\S]*?\n  \}/);
  assert.match(u[0], /el\.textContent = el\.dataset\.busyPrevLabel;/, '...and restored verbatim');
});

test('E: the page-load behaviour of the app shell is untouched', () => {
  // There were no page-load skeletons to keep — this pins that the indicator
  // did not introduce one, or hide the shell behind itself.
  assert.match(INDEX, /<div id="app" class="app" hidden>/, 'the shell still starts hidden as before');
  assert.equal((INDEX.match(/class="skeleton/g) || []).length, 0);
  assert.equal((CSS.match(/\.skeleton\b/g) || []).length, 0);
});

/* ================= F. service worker ================= */

test('F: sw.js cache bumped v5 -> v6 and the bump is documented', () => {
  assert.match(SW, /var CACHE = 'ezone-outpatient-v6';/);
  assert.doesNotMatch(SW, /var CACHE = 'ezone-outpatient-v5';/, 'only one live CACHE version');
  assert.match(SW, /v6 \(2026-09-12\)/, 'documented in the header history');
  const live = Number((SW.match(/var CACHE = 'ezone-outpatient-v(\d+)';/) || [])[1]);
  const mentioned = Array.from(SW.matchAll(/^ \* - v(\d+) \(/gm)).map((x) => Number(x[1]));
  assert.equal(live, Math.max.apply(null, mentioned), 'the live cache is the newest documented version');
});

test('F: busy.js is a UMD module like the app\'s other shared helpers', () => {
  assert.match(BUSY_SRC, /if \(typeof module === 'object' && module\.exports\) \{/);
  assert.match(BUSY_SRC, /root\.EzoneBusy = api;/);
  assert.doesNotMatch(BUSY_SRC, /require\(/, 'no dependency — it must run in the browser as-is');
  assert.doesNotMatch(BUSY_SRC, /document\.|window\./, 'pure: no DOM, so it stays unit-testable');
});

/* ================= G. the real app.js busy layer, executed ================= */

/**
 * The sections above pin the WIRING by reading app.js. This one RUNS it: the
 * busy layer is sliced out of the shipped file and executed in a vm against a
 * tiny fake DOM and the fake clock — the same way the Code.gs tests run the
 * real Apps Script file. So withBusy/busyAttach are covered by execution, not
 * only by regex.
 */
function fakeEl(tagName, opts) {
  opts = opts || {};
  const el = {
    tagName: tagName,
    hidden: opts.hidden !== undefined ? opts.hidden : false,
    dataset: {},
    attrs: {},
    children: [],
    _text: opts.text || '',
    classes: new Set(),
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
    },
    set textContent(v) { this._text = v; this.children = []; },
    // The layer sets `className` on the nodes it creates, so the fake has to
    // keep that in sync with the class set `classList` reads.
    get className() { return Array.from(el.classes).join(' '); },
    set className(v) { el.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(sel) {
      const want = sel.replace(/^\./, '');
      for (const c of this.children) if (c.classes.has(want)) return c;
      return null;
    }
  };
  el.classList = {
    add: (c) => el.classes.add(c),
    remove: (c) => el.classes.delete(c),
    contains: (c) => el.classes.has(c)
  };
  if (opts.control) el.disabled = !!opts.disabled;
  return el;
}

/* Slice the shipped busy layer out of app.js and run it against a fake DOM
 * plus the test clock. Returns the vm context, with the layer's functions on
 * it and its header nodes under ctx.nodes. */
function loadBusyLayer(clock) {
  const start = APP.indexOf('  // --- Working indicator (spinner) ');
  const end = APP.indexOf('  // --- API ------');
  assert.ok(start > 0 && end > start, 'could not slice the busy layer out of app.js');
  const source = APP.slice(start, end);

  const nodes = {
    '#globalBusy': fakeEl('SPAN', { hidden: true }),
    '#globalBusyLabel': fakeEl('SPAN'),
    '#globalBusySlow': fakeEl('SPAN', { hidden: true }),
    '#app': fakeEl('DIV')
  };
  const ctx = {
    nodes: nodes,
    $: function (sel, root) {
      if (root) return root.querySelector(sel);
      return Object.prototype.hasOwnProperty.call(nodes, sel) ? nodes[sel] : null;
    },
    document: { createElement: (t) => fakeEl(t.toUpperCase()) },
    // The REAL busy.js policy, with this test's clock injected.
    self: {
      EzoneBusy: Object.assign({}, Busy, {
        createTracker: (h) => Busy.createTracker(Object.assign({}, h, {
          setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now
        }))
      })
    },
    Promise: Promise,
    console: console
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx;
}

test('G: withBusy disables at once, paints the spinner at 150 ms, and re-enables when done', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const btn = fakeEl('BUTTON', { control: true, text: 'שמירה' });

  let resolveWork;
  const p = ctx.withBusy(btn, 'save', () => new Promise((r) => { resolveWork = r; }));

  assert.equal(btn.disabled, true, 'disabled immediately — before any spinner');
  assert.equal(btn.textContent, 'שמירה', 'the label is untouched for the first 150 ms');
  assert.equal(ctx.nodes['#globalBusy'].hidden, true, 'the header is quiet too');

  clock.advance(150);
  assert.equal(btn.textContent, 'שומר…', 'the Hebrew label appears with the spinner');
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  assert.equal(btn.classes.has('is-busy'), true);
  assert.ok(btn.querySelector('.busy-spinner'), 'and a spinner element');
  assert.equal(ctx.nodes['#globalBusy'].hidden, false, 'the header indicator shows too');
  assert.equal(ctx.nodes['#app'].getAttribute('aria-busy'), 'true', 'aria-busy marks the region');
  assert.equal(ctx.nodes['#globalBusyLabel'].textContent, 'שומר…', 'role=status carries the label');

  resolveWork('done');
  await p;
  clock.advance(300);

  assert.equal(btn.disabled, false, 'the button re-enables');
  assert.equal(btn.textContent, 'שמירה', 'and its real label comes back verbatim');
  assert.equal(btn.getAttribute('aria-busy'), null);
  assert.equal(btn.classes.has('is-busy'), false);
  assert.equal(ctx.nodes['#globalBusy'].hidden, true, 'the header indicator stops');
  assert.equal(ctx.nodes['#app'].getAttribute('aria-busy'), null);
});

test('G: a fast action never paints anything, and still re-enables the button', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const btn = fakeEl('BUTTON', { control: true, text: 'שמירה' });

  await ctx.withBusy(btn, 'save', () => Promise.resolve('quick'));
  clock.advance(5000);

  assert.equal(btn.textContent, 'שמירה', 'no label swap ever happened');
  assert.equal(btn.classes.has('is-busy'), false);
  assert.equal(btn.disabled, false, 'but the button is definitely usable again');
  assert.equal(ctx.nodes['#globalBusy'].hidden, true);
});

test('G: on ERROR the spinner still stops and the button still re-enables', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const btn = fakeEl('BUTTON', { control: true, text: 'שמירה' });

  let rejectWork;
  const p = ctx.withBusy(btn, 'save', () => new Promise((_, rej) => { rejectWork = rej; }));
  clock.advance(150);
  assert.equal(btn.textContent, 'שומר…');

  rejectWork(new Error('נכשל'));
  await assert.rejects(p, /נכשל/, 'the error still reaches the caller, so the app shows its own Hebrew error');
  clock.advance(300);

  assert.equal(btn.disabled, false, 're-enabled on the error path too');
  assert.equal(btn.textContent, 'שמירה');
  assert.equal(ctx.nodes['#globalBusy'].hidden, true, 'never stuck');
});

test('G: a synchronous THROW inside the action is handled like a rejection', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const btn = fakeEl('BUTTON', { control: true, text: 'שמירה' });
  const p = ctx.withBusy(btn, 'save', () => { throw new Error('boom'); });
  await assert.rejects(p, /boom/);
  clock.advance(500);
  assert.equal(btn.disabled, false, 'a thrown handler cannot strand the button');
  assert.equal(ctx.nodes['#globalBusy'].hidden, true);
});

test('G: a SECOND click during a save does nothing — the action never runs twice', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const btn = fakeEl('BUTTON', { control: true, text: 'שמירה' });

  let saves = 0;
  let resolveWork;
  const work = () => { saves++; return new Promise((r) => { resolveWork = r; }); };

  const first = ctx.withBusy(btn, 'save', work);
  clock.advance(150);
  await ctx.withBusy(btn, 'save', work);
  await ctx.withBusy(btn, 'save', work);
  await ctx.withBusy(btn, 'save', work);
  assert.equal(saves, 1, 'only ONE save ran — this is the duplicate-row guard');
  assert.equal(btn.disabled, true, 'and the extra clicks did not re-enable it either');

  resolveWork();
  await first;
  clock.advance(300);
  assert.equal(btn.disabled, false);

  // A later click works normally. Start it, then settle it — `work` only
  // resolves when the test hands it the resolver.
  const later = ctx.withBusy(btn, 'save', work);
  assert.equal(saves, 2, 'a later click works normally');
  resolveWork();
  await later;
  clock.advance(300);
  assert.equal(btn.disabled, false, 'and it cleans up after itself too');
});

test('G: the 20 s notice appears in the header and is cleared when the action ends', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const btn = fakeEl('BUTTON', { control: true, text: 'שמירה' });

  let resolveWork;
  const p = ctx.withBusy(btn, 'save', () => new Promise((r) => { resolveWork = r; }));
  clock.advance(19999);
  assert.equal(ctx.nodes['#globalBusySlow'].hidden, true, 'not before 20 s');
  clock.advance(1);
  assert.equal(ctx.nodes['#globalBusySlow'].hidden, false, 'the notice is revealed at 20 s');

  resolveWork();
  await p;
  clock.advance(300);
  assert.equal(ctx.nodes['#globalBusySlow'].hidden, true, 'and always cleared afterwards');
  assert.equal(ctx.nodes['#globalBusy'].hidden, true);
  assert.equal(btn.disabled, false);
});

test('G: busyAttach releases on every exit path, idempotently', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const btn = fakeEl('BUTTON', { control: true, text: 'שמור' });

  // the modal-form shape: the handler already set disabled = true itself
  btn.disabled = true;
  const release = ctx.busyAttach(btn, 'save');
  clock.advance(150);
  assert.equal(btn.textContent, 'שומר…');
  assert.equal(btn.disabled, true);

  release();
  release();                    // a .catch AND a .finally can both call it
  clock.advance(300);
  assert.equal(btn.disabled, false, 'restored to enabled, as the form handlers expect');
  assert.equal(btn.textContent, 'שמור');
  assert.equal(ctx.nodes['#globalBusy'].hidden, true);
});

test('G: a search REGION spins without being disabled, and every keystroke still runs', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const wrap = fakeEl('SPAN');
  const spinner = fakeEl('SPAN', { hidden: true });
  spinner.classes.add('busy-spinner');
  wrap.appendChild(spinner);

  let runs = 0;
  const pending = [];
  const type = () => ctx.withBusy(wrap, 'search', () => {
    runs++;
    return new Promise((r) => pending.push(r));
  });

  const a = type();
  clock.advance(150);
  assert.equal(spinner.hidden, false, 'the spinner appears inside the field');
  assert.equal(wrap.getAttribute('aria-busy'), 'true');

  const b = type();            // a keystroke WHILE the first lookup is out
  const c = type();
  assert.equal(runs, 3, 'typing is never swallowed — the guard is for controls only');
  assert.equal(wrap.disabled, undefined, 'and the field is never disabled');

  pending.forEach((r) => r());
  await Promise.all([a, b, c]);
  clock.advance(300);
  assert.equal(spinner.hidden, true, 'one shared spinner, hidden when the last lookup ends');
  assert.equal(wrap.getAttribute('aria-busy'), null);
});

test('G: overlapping actions on DIFFERENT buttons each keep their own label', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  const saveBtn = fakeEl('BUTTON', { control: true, text: 'שמירה' });
  const sendBtn = fakeEl('BUTTON', { control: true, text: 'שליחה' });

  let r1, r2;
  const p1 = ctx.withBusy(saveBtn, 'save', () => new Promise((r) => { r1 = r; }));
  const p2 = ctx.withBusy(sendBtn, 'send', () => new Promise((r) => { r2 = r; }));
  clock.advance(150);

  assert.equal(saveBtn.textContent, 'שומר…');
  assert.equal(sendBtn.textContent, 'שולח…');
  assert.equal(ctx.nodes['#globalBusy'].hidden, false, 'one shared header spinner');

  r1(); await p1;
  clock.advance(300);
  assert.equal(saveBtn.disabled, false, 'the finished one is released...');
  assert.equal(sendBtn.disabled, true, '...the other keeps working');
  assert.equal(ctx.nodes['#globalBusy'].hidden, false, 'the header waits for the last action');

  r2(); await p2;
  clock.advance(300);
  assert.equal(sendBtn.disabled, false);
  assert.equal(ctx.nodes['#globalBusy'].hidden, true);
});

test('G: withBusy(null, ...) still drives the header — for actions with no button', async () => {
  const clock = fakeClock();
  const ctx = loadBusyLayer(clock);
  let resolveWork;
  const p = ctx.withBusy(null, 'load', () => new Promise((r) => { resolveWork = r; }));
  clock.advance(150);
  assert.equal(ctx.nodes['#globalBusy'].hidden, false);
  assert.equal(ctx.nodes['#globalBusyLabel'].textContent, 'טוען…');
  resolveWork();
  await p;
  clock.advance(300);
  assert.equal(ctx.nodes['#globalBusy'].hidden, true);
});
