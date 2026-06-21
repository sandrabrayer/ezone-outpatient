'use strict';

/**
 * Coverage for patient-phone display/edit on OUT client cards.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * The real logic lives inside the browser IIFE in public/app.js. As with
 * test/phone.test.js, it cannot be imported in Node, so the pure helpers below
 * mirror the app exactly. Any change to `clientPhone` / `recoverPhone` /
 * `acceptPhone` in app.js must be mirrored here.
 *
 * Contract being locked (the bug this fixes):
 *   - the patient's phone lives in the `phone` column (populated by create /
 *     activate flows); treatmentContactPhone is the usually-empty legacy field
 *   - client cards display the patient phone: read `phone`, fall back to
 *     treatmentContactPhone, with leading-zero recovery
 *   - the edit modal reads/writes `phone` (not the empty treatmentContactPhone),
 *     while treatmentContactPhone stays intact for WhatsApp / cross-app matching
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
function acceptPhone(raw, required) {
  const norm = normalizePhone(raw);
  if (!norm) return required ? false : '';
  return isValidMobile(norm) ? norm : false;
}
// the helper under test (public/app.js clientPhone)
function clientPhone(c) {
  return recoverPhone(c && c.phone) || recoverPhone(c && c.treatmentContactPhone);
}
// ---------------------------------------------------------------------------

test('card shows the patient phone when the `phone` column is populated', () => {
  assert.equal(clientPhone({ phone: '0501234567', treatmentContactPhone: '' }), '0501234567');
});

test('card applies leading-zero recovery to a Sheets-coerced 9-digit phone', () => {
  // Google Sheets dropped the leading zero on a numeric-looking phone.
  assert.equal(clientPhone({ phone: '501234567' }), '0501234567');
  assert.equal(clientPhone({ phone: 501234567 }), '0501234567'); // numeric from Sheets
});

test('card falls back to treatmentContactPhone when `phone` is empty', () => {
  assert.equal(clientPhone({ phone: '', treatmentContactPhone: '0527654321' }), '0527654321');
  assert.equal(clientPhone({ treatmentContactPhone: '527654321' }), '0527654321'); // + recovery
});

test('card prefers the patient `phone` over treatmentContactPhone', () => {
  assert.equal(
    clientPhone({ phone: '0501111111', treatmentContactPhone: '0502222222' }),
    '0501111111'
  );
});

test('card shows nothing when no phone is stored anywhere', () => {
  assert.equal(clientPhone({}), '');
  assert.equal(clientPhone({ phone: '', treatmentContactPhone: '' }), '');
  assert.equal(clientPhone(null), '');
});

test('edit modal round-trips the patient phone via the `phone` field', () => {
  const client = { phone: '0501234567', treatmentContactPhone: '0509999999' };

  // open: the form's patient-phone field is populated from clientPhone(client)
  const formPhone = clientPhone(client);
  assert.equal(formPhone, '0501234567');

  // user edits to a new valid mobile; save accepts and writes to client.phone
  const accepted = acceptPhone('052-765 4321', false);
  assert.notEqual(accepted, false);
  client.phone = accepted;

  assert.equal(client.phone, '0527654321');
  // treatmentContactPhone is left intact (WhatsApp / cross-app matching key)
  assert.equal(client.treatmentContactPhone, '0509999999');
});

test('edit modal rejects an invalid patient phone (save aborts)', () => {
  assert.equal(acceptPhone('12345', false), false);        // not a 10-digit mobile
  assert.equal(acceptPhone('031234567', false), false);    // 9-digit landline not a mobile
  assert.equal(acceptPhone('', false), '');                // empty is allowed (optional)
});
