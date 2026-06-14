'use strict';

/**
 * Unit coverage for phone normalize / validate / recovery.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * The helpers live inside the browser IIFE in public/app.js (and `_recoverPhone`
 * mirrors `recoverPhone` in apps-script/Code.gs); neither can be imported in the
 * Node runtime, so the pure logic below is a mirror. Any change to the phone
 * helpers in app.js / Code.gs must be mirrored here. Contract being locked:
 *   - canonical STORE form is leading-zero, no separators
 *   - normalize: strip separators, +972/972/00972 -> leading 0
 *   - recover: also restore a leading zero Sheets dropped (idempotent)
 *   - mobile keys (phone, treatmentContactPhone) = exactly 10 digits
 *   - payerPhone = 9-digit landline OR 10-digit mobile
 *   - wa.me links use the 972 form
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- pure mirror of public/app.js phone helpers ----------------------------
function phoneDigits(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  return s.replace(/\D/g, '');
}
function normalizePhone(raw) {
  let s = phoneDigits(raw);
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  return s;
}
function recoverPhone(raw) {
  let s = normalizePhone(raw);
  if (s && s.charAt(0) !== '0') s = '0' + s;
  return s;
}
function isValidMobile(p) { return /^0\d{9}$/.test(p); }
function isValidPayerPhone(p) { return /^0\d{8,9}$/.test(p); }
function phoneToWa(phone) {
  const p = normalizePhone(phone);
  return p ? '972' + p.slice(1) : '';
}
// ---------------------------------------------------------------------------

test('normalizePhone strips separators to leading-zero canonical', () => {
  assert.equal(normalizePhone('050-123 4567'), '0501234567');
  assert.equal(normalizePhone('(052) 765-4321'), '0527654321');
  assert.equal(normalizePhone('0501234567'), '0501234567');
});

test('normalizePhone converts 972 / +972 / 00972 to leading zero', () => {
  assert.equal(normalizePhone('+972-50-1234567'), '0501234567');
  assert.equal(normalizePhone('972501234567'), '0501234567');
  assert.equal(normalizePhone('00972 50 123 4567'), '0501234567');
  assert.equal(normalizePhone('+972 3 123 4567'), '031234567'); // landline
});

test('normalizePhone leaves empty as empty and does NOT invent a leading zero', () => {
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone('501234567'), '501234567'); // stays invalid -> rejected by validator
});

test('recoverPhone restores a leading zero dropped by Sheets coercion', () => {
  assert.equal(recoverPhone('501234567'), '0501234567');  // 10-digit mobile, zero dropped
  assert.equal(recoverPhone('30000000'), '030000000');    // 9-digit landline, zero dropped
  assert.equal(recoverPhone(501234567), '0501234567');    // numeric input from Sheets
  assert.equal(recoverPhone('972501234567'), '0501234567');
  assert.equal(recoverPhone('0501234567'), '0501234567'); // already canonical
});

test('recoverPhone is idempotent', () => {
  ['501234567', '30000000', '972501234567', '0501234567', ''].forEach((v) => {
    assert.equal(recoverPhone(recoverPhone(v)), recoverPhone(v));
  });
});

test('isValidMobile accepts only 10-digit leading-zero numbers', () => {
  assert.equal(isValidMobile('0501234567'), true);
  assert.equal(isValidMobile('031234567'), false);  // 9-digit landline rejected
  assert.equal(isValidMobile('050123456'), false);  // 9 digits
  assert.equal(isValidMobile('05012345678'), false); // 11 digits
  assert.equal(isValidMobile('501234567'), false);  // no leading zero
});

test('isValidPayerPhone accepts 9-digit landline OR 10-digit mobile', () => {
  assert.equal(isValidPayerPhone('031234567'), true);   // landline (9)
  assert.equal(isValidPayerPhone('0501234567'), true);  // mobile (10)
  assert.equal(isValidPayerPhone('0312345'), false);    // too short
  assert.equal(isValidPayerPhone('501234567'), false);  // no leading zero
});

test('the 9-digit landline is accepted for payer but rejected for mobile-only fields', () => {
  assert.equal(isValidPayerPhone('031234567'), true);
  assert.equal(isValidMobile('031234567'), false);
});

test('phoneToWa builds the 972 international form from the canonical phone', () => {
  assert.equal(phoneToWa('0501234567'), '972501234567');
  assert.equal(phoneToWa('050-123 4567'), '972501234567');
  assert.equal(phoneToWa('031234567'), '97231234567'); // landline keeps working
  assert.equal(phoneToWa(''), '');
});
