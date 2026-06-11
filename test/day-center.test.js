'use strict';

/**
 * Unit coverage for the day-center alias matching (treatment-type rename
 * "מרכז יום" → "ליווי יומי בקהילה").
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * `hasDayCenter` lives inside the browser IIFE in public/app.js and cannot be
 * imported in the Node runtime, so the constants + helper below are a pure
 * mirror of that logic. Any change to DAY_CENTER_ALIASES / hasDayCenter in
 * app.js must be mirrored here. The point of the test is to lock the contract:
 * the stable key, the legacy label, and the new display label all match.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- pure mirror of app.js -------------------------------------------------
const DAY_CENTER_KEY = 'day_center';
const DAY_CENTER_LABEL = 'ליווי יומי בקהילה';
const DAY_CENTER_ALIASES = ['מרכז יום', DAY_CENTER_LABEL, DAY_CENTER_KEY];

function parseServices(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}
function hasDayCenter(arr) {
  const svcs = parseServices(arr);
  for (let i = 0; i < svcs.length; i++) {
    if (DAY_CENTER_ALIASES.indexOf(svcs[i]) !== -1) return true;
  }
  return false;
}
// Mirror of populateServiceGroup's checked test (public/app.js): the
// day-center option is alias-aware; every other service type stays strict.
function isServiceChecked(s, picked) {
  return s === DAY_CENTER_LABEL ? hasDayCenter(picked) : picked.indexOf(s) !== -1;
}
// ---------------------------------------------------------------------------

test('hasDayCenter matches the legacy label "מרכז יום"', () => {
  assert.equal(hasDayCenter('מרכז יום'), true);
  assert.equal(hasDayCenter(['פרטני', 'מרכז יום']), true);
});

test('hasDayCenter matches the new display label "ליווי יומי בקהילה"', () => {
  assert.equal(hasDayCenter('ליווי יומי בקהילה'), true);
  assert.equal(hasDayCenter('פרטני, ליווי יומי בקהילה'), true);
});

test('hasDayCenter matches the stable key "day_center"', () => {
  assert.equal(hasDayCenter('day_center'), true);
  assert.equal(hasDayCenter(['day_center']), true);
});

test('hasDayCenter is false for non-day-center services (negative case)', () => {
  assert.equal(hasDayCenter('פרטני'), false);
  assert.equal(hasDayCenter(['קבוצה', 'מעקב פסיכיאטרי']), false);
  assert.equal(hasDayCenter(''), false);
  assert.equal(hasDayCenter(null), false);
});

test('edit-modal: legacy "מרכז יום" checks the day-center option (alias-aware)', () => {
  assert.equal(isServiceChecked(DAY_CENTER_LABEL, ['מרכז יום']), true);
  assert.equal(isServiceChecked(DAY_CENTER_LABEL, [DAY_CENTER_LABEL]), true);
  assert.equal(isServiceChecked(DAY_CENTER_LABEL, [DAY_CENTER_KEY]), true);
  assert.equal(isServiceChecked(DAY_CENTER_LABEL, ['פרטני', 'מרכז יום']), true);
});

test('edit-modal: day-center option unchecked when no day-center service is stored', () => {
  assert.equal(isServiceChecked(DAY_CENTER_LABEL, ['פרטני']), false);
  assert.equal(isServiceChecked(DAY_CENTER_LABEL, []), false);
});

test('edit-modal: non-day-center options stay strict (matching not broadened)', () => {
  assert.equal(isServiceChecked('פרטני', ['פרטני']), true);
  // legacy day-center value must NOT check unrelated options
  assert.equal(isServiceChecked('פרטני', ['מרכז יום']), false);
  assert.equal(isServiceChecked('קבוצה', ['מרכז יום']), false);
});
