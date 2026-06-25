'use strict';

/**
 * Issue A — patient phone displays in the patient card.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * The card never rendered the patient's own `phone`, and a value Sheets had
 * coerced to a number (dropping the leading zero) must be recovered on read.
 * `recoverPhone` and the card's phone-cell builder live inside the browser IIFE
 * in public/app.js and cannot be imported in Node, so the pure logic below is a
 * mirror — keep it in sync with public/app.js. Contract being locked:
 *   - read-side recovery restores a leading zero Sheets stripped (idempotent)
 *   - the card shows a tap-to-call chip with the canonical 10-digit number
 *   - a patient with no stored number shows no phone chip
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- mirror of public/app.js phone + card-cell logic -----------------------
function normalizePhone(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  return s;
}
function recoverPhone(raw) {
  let s = normalizePhone(raw);
  if (s && s.charAt(0) !== '0') s = '0' + s;
  return s;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
// Mirror of the phoneHtml block in clientCard() (public/app.js).
function phoneHtml(client) {
  const phoneDisp = recoverPhone(client.phone);
  return phoneDisp
    ? '<div class="client-meta"><a class="chip chip-phone" href="tel:' + escapeHtml(phoneDisp) + '">📞 ' + escapeHtml(phoneDisp) + '</a></div>'
    : '';
}
// ---------------------------------------------------------------------------

test('a stripped (leading-zero-dropped) phone normalizes to canonical 10 digits', () => {
  // Sheets coerced "0501234567" to the number 501234567 — recover it.
  assert.equal(recoverPhone(501234567), '0501234567');
  assert.equal(recoverPhone('501234567'), '0501234567');
});

test('an already-canonical phone is unchanged (idempotent)', () => {
  assert.equal(recoverPhone('0501234567'), '0501234567');
  assert.equal(recoverPhone(recoverPhone('501234567')), '0501234567');
});

test('international / separator forms recover to canonical', () => {
  assert.equal(recoverPhone('+972-50-123-4567'), '0501234567');
  assert.equal(recoverPhone('050 123 4567'), '0501234567');
});

test('card renders a tap-to-call chip with the canonical number', () => {
  const html = phoneHtml({ phone: 501234567 });   // stored without leading zero
  assert.match(html, /href="tel:0501234567"/);
  assert.match(html, /chip-phone/);
  assert.match(html, /0501234567/);
});

test('card omits the phone chip when the patient has no stored number', () => {
  assert.equal(phoneHtml({ phone: '' }), '');
  assert.equal(phoneHtml({ phone: null }), '');
  assert.equal(phoneHtml({}), '');
});
