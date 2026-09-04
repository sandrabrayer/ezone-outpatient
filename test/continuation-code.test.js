'use strict';

/**
 * Source-scan guards for the continuation-track backend in apps-script/Code.gs.
 * Code.gs cannot be imported in Node, so — like the other Code.gs guard tests —
 * these regex the real file to lock the contract:
 *   - CONTINUATION_SHEET name + exact header order,
 *   - saveContinuation upserts under a LockService lock, validates fail-closed,
 *   - the actions are routed, and
 *   - CLIENTS_HEADERS is NOT touched by this feature (append-only, 33 cols).
 *
 * Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// Parse a `var NAME = [ ... ];` string array out of Code.gs, comments stripped.
function headers(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .match(/'[^']*'/g)
    .map((s) => s.slice(1, -1));
}

test('CONTINUATION_SHEET is named מסלול המשך', () => {
  assert.match(GS, /var CONTINUATION_SHEET = 'מסלול המשך';/);
});

test('CONTINUATION_HEADERS has the exact order', () => {
  assert.deepEqual(headers('CONTINUATION_HEADERS'), [
    'key', 'name', 'house', 'entryDate',
    'meetingDate', 'outcome', 'outcomeDate', 'note', 'updatedAt'
  ]);
});

test('CONTINUATION_OUTCOMES is the stable-key whitelist', () => {
  assert.deepEqual(headers('CONTINUATION_OUTCOMES'), ['', 'continuing', 'to_outpatient', 'stopping']);
});

test('getContinuation reads via _ensureSheet and returns rows', () => {
  assert.ok(/function _getContinuation\(\)/.test(GS), '_getContinuation missing');
  assert.ok(/_ensureSheet\(CONTINUATION_SHEET, CONTINUATION_HEADERS\)/.test(GS),
    'continuation sheet is not auto-created via _ensureSheet');
});

test('saveContinuation upserts under a LockService lock and validates fail-closed', () => {
  const m = GS.match(/function _saveContinuation\(payload\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, '_saveContinuation missing');
  const body = m[1];
  assert.ok(/LockService\.getScriptLock\(\)/.test(body), 'no LockService lock');
  assert.ok(/tryLock\(30000\)/.test(body), 'lock is not a 30s tryLock');
  assert.ok(/missing_key/.test(body), 'missing key is not rejected');
  assert.ok(/CONTINUATION_OUTCOMES\.indexOf\(outcome\) === -1/.test(body), 'outcome is not whitelisted');
  assert.ok(/invalid_date/.test(body), 'dates are not validated');
  assert.ok(/_writeAll\(sh, CONTINUATION_HEADERS, rows\)/.test(body), 'rows are not written back positionally');
});

test('both continuation actions are routed', () => {
  assert.ok(/action === 'getContinuation'/.test(GS), 'getContinuation not dispatched');
  assert.ok(/action === 'saveContinuation'/.test(GS), 'saveContinuation not dispatched');
});

test('CLIENTS_HEADERS is untouched: append-only tail intact, phone join key preserved', () => {
  const CLIENTS_H = headers('CLIENTS_HEADERS');
  // Physical order: the volta-only columns, followed by the appended
  // paymentAmountOverrides, are the exact tail.
  assert.deepEqual(CLIENTS_H.slice(-6), ['clinicalTreatmentType', 'packageChangeDate', 'assignedTo', 'paymentAmountOverrides', 'updatedAt', 'updatedBy']);
  // The continuation sheet is separate — CLIENTS_HEADERS must never mention it.
  assert.ok(CLIENTS_H.indexOf('meetingDate') === -1, 'continuation column leaked into CLIENTS_HEADERS');
  assert.ok(CLIENTS_H.indexOf('outcome') === -1, 'continuation column leaked into CLIENTS_HEADERS');
});
