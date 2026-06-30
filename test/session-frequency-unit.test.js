'use strict';

/**
 * Coverage for the per-service session-frequency UNIT logic in
 * public/charges-logic.js. public/app.js keeps an inline mirror of these
 * helpers (sessionUnitFor / parseSessionsUnits / attachSessionsUnits) — any
 * rule change must update both. Run with:  npm test
 *
 * Contract:
 *  - The unit defaults BY TYPE (מעקב פסיכיאטרי -> חודש, all others -> שבוע).
 *  - A valid per-patient override ('שבוע'|'חודש') wins over the default.
 *  - Overrides persist inside the existing sessionsPerWeek JSON blob under the
 *    reserved `_units` key — no new column. Records without overrides are
 *    serialized exactly as before (no `_units` key).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/charges-logic.js');

test('sessionFrequencyUnit: by-type default', () => {
  assert.equal(C.sessionFrequencyUnit('מעקב פסיכיאטרי'), 'חודש');
  assert.equal(C.sessionFrequencyUnit('פרטני'), 'שבוע');
  assert.equal(C.sessionFrequencyUnit('פרטני CBT'), 'שבוע');
});

test('sessionUnitFor: falls back to the by-type default when no override', () => {
  assert.equal(C.sessionUnitFor('מעקב פסיכיאטרי', {}), 'חודש');
  assert.equal(C.sessionUnitFor('פרטני', {}), 'שבוע');
  assert.equal(C.sessionUnitFor('פרטני', undefined), 'שבוע');
});

test('sessionUnitFor: a valid override wins over the default', () => {
  // psychiatric forced weekly
  assert.equal(C.sessionUnitFor('מעקב פסיכיאטרי', { 'מעקב פסיכיאטרי': 'שבוע' }), 'שבוע');
  // a normally-weekly type forced monthly
  assert.equal(C.sessionUnitFor('פרטני', { 'פרטני': 'חודש' }), 'חודש');
});

test('sessionUnitFor: an invalid/garbage override is ignored (falls back)', () => {
  assert.equal(C.sessionUnitFor('פרטני', { 'פרטני': 'yearly' }), 'שבוע');
  assert.equal(C.sessionUnitFor('פרטני', { 'פרטני': '' }), 'שבוע');
  assert.equal(C.sessionUnitFor('מעקב פסיכיאטרי', { 'מעקב פסיכיאטרי': 'xx' }), 'חודש');
});

test('parseSessionsUnits: reads overrides from a JSON-string blob', () => {
  const raw = JSON.stringify({ 'פרטני': 2, 'מעקב פסיכיאטרי': 1, _units: { 'מעקב פסיכיאטרי': 'חודש' } });
  assert.deepEqual(C.parseSessionsUnits(raw), { 'מעקב פסיכיאטרי': 'חודש' });
});

test('parseSessionsUnits: reads overrides from an object blob', () => {
  const obj = { 'פרטני': 2, _units: { 'פרטני': 'חודש' } };
  assert.deepEqual(C.parseSessionsUnits(obj), { 'פרטני': 'חודש' });
});

test('parseSessionsUnits: no _units / empty / invalid -> {}', () => {
  assert.deepEqual(C.parseSessionsUnits(JSON.stringify({ 'פרטני': 2 })), {});
  assert.deepEqual(C.parseSessionsUnits(''), {});
  assert.deepEqual(C.parseSessionsUnits(null), {});
  // invalid unit values are dropped
  assert.deepEqual(C.parseSessionsUnits({ 'פרטני': 1, _units: { 'פרטני': 'bogus' } }), {});
});

test('attachSessionsUnits: round-trips counts + valid units', () => {
  const out = C.attachSessionsUnits({ 'פרטני': 2, 'מעקב פסיכיאטרי': 1 }, { 'מעקב פסיכיאטרי': 'חודש' });
  assert.deepEqual(out, { 'פרטני': 2, 'מעקב פסיכיאטרי': 1, _units: { 'מעקב פסיכיאטרי': 'חודש' } });
  // re-parsing the serialized blob recovers the override
  assert.deepEqual(C.parseSessionsUnits(JSON.stringify(out)), { 'מעקב פסיכיאטרי': 'חודש' });
});

test('attachSessionsUnits: no override -> NO _units key (records unchanged)', () => {
  const out = C.attachSessionsUnits({ 'פרטני': 2 }, {});
  assert.deepEqual(out, { 'פרטני': 2 });
  assert.equal(Object.prototype.hasOwnProperty.call(out, '_units'), false);
});

test('attachSessionsUnits: drops invalid units and never re-nests an existing _units key', () => {
  // an incoming breakdown that already carries _units must not duplicate it
  const out = C.attachSessionsUnits({ 'פרטני': 2, _units: { 'פרטני': 'שבוע' } }, { 'פרטני': 'גיבריש' });
  assert.deepEqual(out, { 'פרטני': 2 });
});
