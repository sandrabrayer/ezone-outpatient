'use strict';

/**
 * Unit tests for public/busy.js — the shared "working…" (spinner) wrapper used
 * by every action button that writes or reloads.
 *
 * The module is deliberately DOM-defensive, so these tests drive it with plain
 * fake elements instead of a browser.
 *
 * Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Busy = require('../public/busy');

/** Minimal stand-in for a <button>: the exact surface busy.js touches. */
function fakeButton(opts) {
  const o = opts || {};
  const attrs = Object.create(null);
  const classes = new Set();
  return {
    tagName: o.tagName || 'BUTTON',
    innerHTML: 'innerHTML' in o ? o.innerHTML : 'שמירה',
    disabled: !!o.disabled,
    offsetWidth: 'offsetWidth' in o ? o.offsetWidth : 96,
    offsetHeight: 'offsetHeight' in o ? o.offsetHeight : 32,
    style: { minWidth: '', minHeight: '' },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    _classes: classes
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// --- setBusy / clearBusy ----------------------------------------------------

test('setBusy disables the button, marks aria-busy and swaps the label for the spinner', () => {
  const b = fakeButton();
  assert.equal(Busy.setBusy(b), true);
  assert.equal(b.disabled, true);
  assert.equal(b.getAttribute('aria-busy'), 'true');
  assert.equal(b.innerHTML, Busy.SPINNER_HTML);
  assert.ok(b._classes.has('is-busy'));
  assert.equal(Busy.isBusy(b), true);
});

test('setBusy pins the measured box so the layout cannot jump', () => {
  const b = fakeButton({ offsetWidth: 140, offsetHeight: 36 });
  Busy.setBusy(b);
  assert.equal(b.style.minWidth, '140px');
  assert.equal(b.style.minHeight, '36px');
  Busy.clearBusy(b);
  assert.equal(b.style.minWidth, '');
  assert.equal(b.style.minHeight, '');
});

test('setBusy on an unmeasured (hidden) element does not invent a width', () => {
  const b = fakeButton({ offsetWidth: 0, offsetHeight: 0 });
  Busy.setBusy(b);
  assert.equal(b.style.minWidth, '');
  assert.equal(b.style.minHeight, '');
  assert.equal(b.getAttribute('aria-busy'), 'true');
});

test('clearBusy restores the original label, enabled state and attributes', () => {
  const b = fakeButton({ innerHTML: 'חידוש ותשלום' });
  Busy.setBusy(b);
  Busy.clearBusy(b);
  assert.equal(b.innerHTML, 'חידוש ותשלום');
  assert.equal(b.disabled, false);
  assert.equal(b.getAttribute('aria-busy'), null);
  assert.equal(b._classes.has('is-busy'), false);
  assert.equal(Busy.isBusy(b), false);
});

test('clearBusy restores a button that was already disabled before the action', () => {
  const b = fakeButton({ disabled: true });
  Busy.setBusy(b);
  Busy.clearBusy(b);
  assert.equal(b.disabled, true, 'a pre-disabled control must stay disabled');
});

test('setBusy is a no-op on an already-busy element and on nothing at all', () => {
  const b = fakeButton();
  Busy.setBusy(b);
  assert.equal(Busy.setBusy(b), false);
  assert.equal(Busy.setBusy(null), false);
  assert.equal(Busy.setBusy(undefined), false);
});

test('a <select> keeps its content (options survive) and only gets the busy class', () => {
  const s = fakeButton({ tagName: 'SELECT', innerHTML: '<option>פעיל</option>' });
  Busy.setBusy(s);
  assert.equal(s.innerHTML, '<option>פעיל</option>');
  assert.equal(s.disabled, true);
  assert.equal(s.getAttribute('aria-busy'), 'true');
  assert.ok(s._classes.has('is-busy'));
  Busy.clearBusy(s);
  assert.equal(s.innerHTML, '<option>פעיל</option>');
  assert.equal(s.disabled, false);
});

test('isBusy trusts an aria-busy="true" element even without stored state', () => {
  const b = fakeButton();
  b.setAttribute('aria-busy', 'true');
  assert.equal(Busy.isBusy(b), true);
  assert.equal(Busy.isBusy(fakeButton()), false);
  assert.equal(Busy.isBusy(null), false);
});

// --- withBusy: success ------------------------------------------------------

test('withBusy holds the busy state for the whole async action and resolves with its value', async () => {
  const b = fakeButton();
  const d = deferred();
  const p = Busy.withBusy(b, () => d.promise);
  assert.equal(b.disabled, true, 'busy while in flight');
  assert.equal(b.innerHTML, Busy.SPINNER_HTML);
  d.resolve('saved');
  assert.equal(await p, 'saved');
  assert.equal(b.disabled, false, 'restored after success');
  assert.equal(b.innerHTML, 'שמירה');
});

test('withBusy also works for a synchronous action', async () => {
  const b = fakeButton();
  assert.equal(await Busy.withBusy(b, () => 7), 7);
  assert.equal(Busy.isBusy(b), false);
});

// --- withBusy: failure ------------------------------------------------------

test('withBusy clears the busy state when the action rejects, and rethrows', async () => {
  const b = fakeButton();
  await assert.rejects(
    Busy.withBusy(b, () => Promise.reject(new Error('500 מהשרת'))),
    /500 מהשרת/
  );
  assert.equal(b.disabled, false);
  assert.equal(b.innerHTML, 'שמירה');
  assert.equal(b.getAttribute('aria-busy'), null);
});

test('withBusy clears the busy state when the action throws synchronously', async () => {
  const b = fakeButton();
  await assert.rejects(Busy.withBusy(b, () => { throw new Error('boom'); }), /boom/);
  assert.equal(b.disabled, false);
  assert.equal(b.innerHTML, 'שמירה');
});

test('withBusy rejects a non-function action without touching the button', async () => {
  const b = fakeButton();
  await assert.rejects(Busy.withBusy(b, null), TypeError);
  assert.equal(b.disabled, false);
  assert.equal(Busy.isBusy(b), false);
});

// --- withBusy: re-entrancy (the double-submit this feature exists to stop) ---

test('a second withBusy while busy does NOT run the action again', async () => {
  const b = fakeButton();
  const d = deferred();
  let calls = 0;
  const first = Busy.withBusy(b, () => { calls += 1; return d.promise; });
  const second = Busy.withBusy(b, () => { calls += 1; return Promise.resolve('nope'); });
  assert.equal(calls, 1, 'the blocked click must not fire a second request');
  assert.equal(await second, Busy.BLOCKED);
  d.resolve('ok');
  await first;
  assert.equal(calls, 1);
  assert.equal(b.disabled, false);
});

test('after the first action settles the button accepts a new action', async () => {
  const b = fakeButton();
  let calls = 0;
  await Busy.withBusy(b, () => { calls += 1; });
  await Busy.withBusy(b, () => { calls += 1; });
  assert.equal(calls, 2);
});

test('withBusy still runs the action when there is no button to mark', async () => {
  let ran = false;
  const v = await Busy.withBusy(null, () => { ran = true; return 'done'; });
  assert.equal(ran, true);
  assert.equal(v, 'done');
});

// --- fromEvent / withBusyEvent (delegated handlers) -------------------------

test('fromEvent resolves the nearest matching control from a delegated event', () => {
  const btn = fakeButton();
  const target = { closest: (sel) => (sel.indexOf('button') >= 0 ? btn : null) };
  assert.equal(Busy.fromEvent({ target }), btn);
});

test('fromEvent falls back to currentTarget when nothing matches', () => {
  const ct = fakeButton();
  const target = { closest: () => null };
  assert.equal(Busy.fromEvent({ target, currentTarget: ct }), ct);
  assert.equal(Busy.fromEvent(null), null);
});

test('withBusyEvent marks the resolved control busy for the action', async () => {
  const btn = fakeButton();
  const d = deferred();
  const p = Busy.withBusyEvent({ target: { closest: () => btn } }, () => d.promise);
  assert.equal(btn.disabled, true);
  d.resolve();
  await p;
  assert.equal(btn.disabled, false);
});
