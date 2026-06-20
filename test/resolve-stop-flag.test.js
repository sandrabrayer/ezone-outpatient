'use strict';

/**
 * Unit coverage for the SECURED phone-based stop-flag resolver
 * (`_resolveStopFlagByPhone`) in apps-script/Code.gs — the therapists-app
 * receiver that clears a flag it previously raised.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Code.gs cannot be imported in the Node runtime, so the pure logic below mirrors
 * `_recoverPhone`, `_stopFlagAuthOk`, and the `_resolveStopFlagByPhone` transform.
 * Any change to those in Code.gs must be mirrored here. Contract being locked:
 *   - auth is FAIL-CLOSED, reusing STOP_FLAG_SECRET (unset/empty/wrong rejected)
 *   - matches a StopFlags row by canonical phone ALONE — NO Clients join — so an
 *     orphaned flag (no client) still resolves
 *   - canonicalization recovers a leading zero Sheets dropped (dropped-0 matches)
 *   - every still-pending matching row -> status='resolved' + resolvedBy/resolvedAt
 *   - already-resolved rows are skipped (idempotent)
 *   - returns { ok:true, resolved:N }; N=0 is a successful no-match, not an error
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- pure mirror of Code.gs --------------------------------------------------
function recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  else if (s.charAt(0) !== '0') s = '0' + s;
  return s;
}

function stopFlagAuthOk(expected, got) {
  if (!expected) return false; // fail-closed
  const g = (got != null) ? String(got) : '';
  return g !== '' && g === expected;
}

// Mirror of _resolveStopFlagByPhone operating on an in-memory StopFlags array.
// `expectedSecret` is the configured STOP_FLAG_SECRET Script Property.
function resolveByPhone(rows, payload, expectedSecret, now) {
  if (!stopFlagAuthOk(expectedSecret, payload && payload.secret)) {
    return { ok: false, reason: 'unauthorized' };
  }
  const phone = recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, reason: 'invalid_phone' };
  const resolvedBy = String((payload && payload.resolvedBy) || 'therapists-app').trim();
  const resolvedAt = now || '2026-06-20T00:00:00.000Z';
  let resolved = 0;
  for (const row of rows) {
    if (recoverPhone(row.phone) !== phone) continue;
    if (String(row.status) === 'resolved') continue; // already cleared
    row.status = 'resolved';
    row.resolvedBy = resolvedBy;
    row.resolvedAt = resolvedAt;
    resolved++;
  }
  return { ok: true, resolved };
}
// ---------------------------------------------------------------------------

const SECRET = 's3cret';

function seed() {
  return [
    // stored canonical
    { id: 'f1', phone: '0501234567', name: 'אורי', clientId: 'c1', status: 'pending', resolvedBy: '', resolvedAt: '' },
    // orphaned: no client ever matched this phone (clientId blank)
    { id: 'f2', phone: '0539876543', name: 'יעל', clientId: '', status: 'pending', resolvedBy: '', resolvedAt: '' },
    // leading zero dropped by Sheets numeric coercion ('501112222' instead of '0501112222')
    { id: 'f3', phone: '501112222', name: 'דנה', clientId: 'c3', status: 'pending', resolvedBy: '', resolvedAt: '' },
    // unrelated, must stay pending
    { id: 'f4', phone: '0544444444', name: 'מאיה', clientId: 'c4', status: 'pending', resolvedBy: '', resolvedAt: '' }
  ];
}

test('resolves a matching flag by phone (status -> resolved + resolvedBy/resolvedAt)', () => {
  const rows = seed();
  const res = resolveByPhone(rows, { secret: SECRET, phone: '0501234567', resolvedBy: 'therapists-app' }, SECRET);
  assert.deepEqual(res, { ok: true, resolved: 1 });
  const f1 = rows.find(r => r.id === 'f1');
  assert.equal(f1.status, 'resolved');
  assert.equal(f1.resolvedBy, 'therapists-app');
  assert.ok(f1.resolvedAt);
  // unrelated row untouched
  assert.equal(rows.find(r => r.id === 'f4').status, 'pending');
});

test('orphaned flag (no client match, blank clientId) still resolves by phone alone', () => {
  const rows = seed();
  const res = resolveByPhone(rows, { secret: SECRET, phone: '0539876543' }, SECRET);
  assert.equal(res.resolved, 1);
  const f2 = rows.find(r => r.id === 'f2');
  assert.equal(f2.status, 'resolved');
  assert.equal(f2.clientId, ''); // Clients never joined / touched
});

test('phone with dropped leading zero matches the canonicalized stored phone', () => {
  const rows = seed();
  // incoming canonical, stored mangled -> still matches
  let res = resolveByPhone(rows, { secret: SECRET, phone: '0501112222' }, SECRET);
  assert.equal(res.resolved, 1);
  assert.equal(rows.find(r => r.id === 'f3').status, 'resolved');

  // and the reverse: incoming mangled (972 / no leading 0) resolves canonical f1
  const rows2 = seed();
  res = resolveByPhone(rows2, { secret: SECRET, phone: '972501234567' }, SECRET);
  assert.equal(res.resolved, 1);
  assert.equal(rows2.find(r => r.id === 'f1').status, 'resolved');
});

test('auth is fail-closed: unset / empty / wrong secret are rejected (no rows changed)', () => {
  const wrong = resolveByPhone(seed(), { secret: 'nope', phone: '0501234567' }, SECRET);
  assert.deepEqual(wrong, { ok: false, reason: 'unauthorized' });

  const missing = resolveByPhone(seed(), { phone: '0501234567' }, SECRET);
  assert.deepEqual(missing, { ok: false, reason: 'unauthorized' });

  const empty = resolveByPhone(seed(), { secret: '', phone: '0501234567' }, SECRET);
  assert.deepEqual(empty, { ok: false, reason: 'unauthorized' });

  const unset = resolveByPhone(seed(), { secret: 'anything', phone: '0501234567' }, ''); // property unset
  assert.deepEqual(unset, { ok: false, reason: 'unauthorized' });
});

test('no matching phone -> resolved:0 (success, not an error)', () => {
  const rows = seed();
  const res = resolveByPhone(rows, { secret: SECRET, phone: '0500000000' }, SECRET);
  assert.deepEqual(res, { ok: true, resolved: 0 });
  // nothing changed
  assert.ok(rows.every(r => r.status === 'pending'));
});

test('invalid / empty phone is rejected before touching rows', () => {
  assert.equal(resolveByPhone(seed(), { secret: SECRET, phone: '12345' }, SECRET).reason, 'invalid_phone');
  assert.equal(resolveByPhone(seed(), { secret: SECRET, phone: '' }, SECRET).reason, 'invalid_phone');
});

test('resolving multiple flags for the same phone clears them all; rerun is idempotent', () => {
  const rows = seed();
  rows.push({ id: 'f5', phone: '0501234567', name: 'אורי', clientId: 'c1', status: 'pending', resolvedBy: '', resolvedAt: '' });
  const first = resolveByPhone(rows, { secret: SECRET, phone: '0501234567' }, SECRET);
  assert.equal(first.resolved, 2); // f1 + f5
  const second = resolveByPhone(rows, { secret: SECRET, phone: '0501234567' }, SECRET);
  assert.equal(second.resolved, 0); // already resolved -> skipped
});
