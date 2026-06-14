'use strict';

/**
 * Unit coverage for the stop-flag receiver (StopFlags) in apps-script/Code.gs.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Code.gs cannot be imported in the Node runtime, so the pure logic below
 * mirrors `_stopFlagAuthOk`, `_recoverPhone`, `_matchStopFlagClient`, the
 * `_flagStop` validation/shape, and the `_resolveStopFlag` transform. Any change
 * to those in Code.gs must be mirrored here. Contract being locked:
 *   - flagStop auth is FAIL-CLOSED (unset/empty/wrong secret all rejected)
 *   - incoming phone is normalized to canonical leading-zero before store/match
 *   - a flag matches a client by normalized phone (phone OR treatmentContactPhone)
 *     + exact trimmed name, else clientId stays ''
 *   - a valid flag is appended as status='pending'; Clients is never touched
 *   - resolve sets status='resolved' + resolvedBy/resolvedAt
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

function matchStopFlagClient(clients, phone, name) {
  const nm = String(name == null ? '' : name).trim();
  if (!nm || !phone) return '';
  for (const c of clients) {
    const phoneHit = recoverPhone(c.phone) === phone ||
                     recoverPhone(c.treatmentContactPhone) === phone;
    if (phoneHit && String(c.name == null ? '' : c.name).trim() === nm) {
      return String(c.id);
    }
  }
  return '';
}

// Mirror of _flagStop minus the sheet append (returns the row object or error).
function buildFlag(payload, clients, uuid) {
  const phone = recoverPhone(payload && payload.phone);
  const name = String((payload && payload.name) || '').trim();
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, error: 'invalid_phone' };
  if (!name) return { ok: false, error: 'missing_name' };
  return {
    ok: true,
    flag: {
      id: uuid,
      phone,
      name,
      clientId: matchStopFlagClient(clients, phone, name),
      reportedBy: String((payload && payload.reportedBy) || '').trim(),
      reportedAt: '2026-06-14T00:00:00.000Z',
      note: String((payload && payload.note) || '').trim().slice(0, 1000),
      status: 'pending',
      resolvedBy: '',
      resolvedAt: ''
    }
  };
}

function resolveFlag(flag, resolvedBy) {
  return Object.assign({}, flag, {
    status: 'resolved',
    resolvedBy: String(resolvedBy || '').trim(),
    resolvedAt: '2026-06-14T01:00:00.000Z'
  });
}
// ---------------------------------------------------------------------------

const CLIENTS = [
  { id: 'c1', name: 'אורי', phone: '0501234567', treatmentContactPhone: '0501234567' },
  { id: 'c2', name: 'דנה', phone: '', treatmentContactPhone: '0527654321' },
  { id: 'c3', name: 'מאיה', phone: '0541111111', treatmentContactPhone: '' }
];

test('flagStop auth is fail-closed: unset / empty / wrong secret are rejected', () => {
  assert.equal(stopFlagAuthOk('', 'anything'), false);     // property unset -> reject
  assert.equal(stopFlagAuthOk(null, 'anything'), false);
  assert.equal(stopFlagAuthOk('s3cret', ''), false);       // empty provided
  assert.equal(stopFlagAuthOk('s3cret', null), false);
  assert.equal(stopFlagAuthOk('s3cret', 'wrong'), false);  // mismatch
});

test('flagStop auth accepts the exact configured secret', () => {
  assert.equal(stopFlagAuthOk('s3cret', 's3cret'), true);
});

test('valid flag is appended as a pending row with a matched clientId', () => {
  const res = buildFlag(
    { phone: '0501234567', name: 'אורי', reportedBy: 'therapists-app', note: 'הפסיק להגיע' },
    CLIENTS, 'uuid-1'
  );
  assert.equal(res.ok, true);
  assert.equal(res.flag.status, 'pending');
  assert.equal(res.flag.clientId, 'c1');
  assert.equal(res.flag.phone, '0501234567');
  assert.equal(res.flag.reportedBy, 'therapists-app');
  assert.equal(res.flag.resolvedBy, '');
  assert.equal(res.flag.resolvedAt, '');
});

test('incoming phone is normalized (972 / dashes) before matching', () => {
  assert.equal(buildFlag({ phone: '+972-50-1234567', name: 'אורי' }, CLIENTS, 'u').flag.clientId, 'c1');
  assert.equal(buildFlag({ phone: '050 123 4567', name: 'אורי' }, CLIENTS, 'u').flag.clientId, 'c1');
  // matches against treatmentContactPhone too (c2 has only that)
  assert.equal(buildFlag({ phone: '972527654321', name: 'דנה' }, CLIENTS, 'u').flag.clientId, 'c2');
});

test('flag stays unmatched (clientId="") when phone or name does not line up', () => {
  // right phone, wrong name
  assert.equal(buildFlag({ phone: '0501234567', name: 'מישהו אחר' }, CLIENTS, 'u').flag.clientId, '');
  // right name, unknown phone
  assert.equal(buildFlag({ phone: '0509999999', name: 'אורי' }, CLIENTS, 'u').flag.clientId, '');
});

test('invalid phone and missing name are rejected', () => {
  assert.equal(buildFlag({ phone: '12345', name: 'אורי' }, CLIENTS, 'u').error, 'invalid_phone');
  assert.equal(buildFlag({ phone: '', name: 'אורי' }, CLIENTS, 'u').error, 'invalid_phone');
  assert.equal(buildFlag({ phone: '0501234567', name: '   ' }, CLIENTS, 'u').error, 'missing_name');
});

test('a 9-digit landline is accepted as a valid flag phone', () => {
  assert.equal(buildFlag({ phone: '031234567', name: 'אורי' }, CLIENTS, 'u').ok, true);
});

test('resolve marks the flag resolved with resolvedBy/resolvedAt', () => {
  const { flag } = buildFlag({ phone: '0501234567', name: 'אורי' }, CLIENTS, 'uuid-1');
  const resolved = resolveFlag(flag, 'Vered');
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedBy, 'Vered');
  assert.ok(resolved.resolvedAt);
  assert.equal(resolved.id, 'uuid-1'); // same row identity
});
