'use strict';

/**
 * Unit coverage for the server-side PIN check (lib/pin.js).
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPin } = require('../lib/pin');

test('checkPin returns true when submitted matches configured', () => {
  assert.equal(checkPin('4913', '4913'), true);
});

test('checkPin returns false on mismatch', () => {
  assert.equal(checkPin('4913', '5827'), false);
});

test('checkPin returns false when lengths differ', () => {
  assert.equal(checkPin('491', '4913'), false);
  assert.equal(checkPin('49135', '4913'), false);
});

test('checkPin fails closed when configured PIN is unset or empty', () => {
  assert.equal(checkPin('4913', ''), false);
  assert.equal(checkPin('4913', undefined), false);
  assert.equal(checkPin('4913', null), false);
});

test('checkPin fails closed when submitted PIN is empty', () => {
  assert.equal(checkPin('', '4913'), false);
});

test('checkPin fails closed on non-string inputs', () => {
  assert.equal(checkPin(4913, '4913'), false);
  assert.equal(checkPin('4913', 4913), false);
  assert.equal(checkPin(null, '4913'), false);
  assert.equal(checkPin(undefined, '4913'), false);
  assert.equal(checkPin({}, '4913'), false);
  assert.equal(checkPin(['4913'], '4913'), false);
});
