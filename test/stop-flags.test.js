'use strict';

/**
 * Unit coverage for the inbound stop-flag feature.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Two pieces of logic are mirrored here because their real homes can't be
 * imported in the Node runtime:
 *   - the Apps Script side (`_stopFlagAuthOk`, `_flagStop` validation,
 *     `_getStopFlags` pending filter) lives in apps-script/Code.gs;
 *   - the client-side match (`phoneKey`, `matchClientForFlag`) lives in
 *     public/app.js.
 * Any change to those must update these mirrors. The point is to lock the
 * contract: FAIL-CLOSED auth, pending-only listing, and the name+normalized
 * phone matching that ties a therapist flag to an outpatient client.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/* ---- Apps Script mirrors ---- */

// FAIL-CLOSED: no configured secret → refuse (opposite of the read endpoints).
function stopFlagAuthOk(expected, got) {
  if (!expected) return false;
  return String(got == null ? '' : got) === expected;
}

// Validation + normalization of an inbound flag (mirror of _flagStop's guard).
function buildStopFlag(payload, id, nowIso) {
  payload = payload || {};
  const phone = payload.phone != null ? String(payload.phone).trim() : '';
  const name = payload.name != null ? String(payload.name).trim() : '';
  if (!phone && !name) return { ok: false, error: 'missing_phone_and_name' };
  return {
    ok: true,
    flag: {
      id: payload.id ? String(payload.id) : id,
      phone, name,
      clientId: payload.clientId != null ? String(payload.clientId) : '',
      reportedBy: payload.reportedBy != null ? String(payload.reportedBy) : '',
      reportedAt: payload.reportedAt ? String(payload.reportedAt) : nowIso,
      note: payload.note != null ? String(payload.note) : '',
      status: 'pending', resolvedBy: '', resolvedAt: ''
    }
  };
}

function filterPending(rows) {
  return (rows || []).filter(r => String((r && r.status) || '') === 'pending');
}

/* ---- Client-side match mirrors (public/app.js) ---- */

function phoneKey(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.indexOf('00972') === 0) d = d.slice(5);
  else if (d.indexOf('972') === 0) d = d.slice(3);
  if (d.indexOf('0') === 0) d = d.slice(1);
  return d;
}

// A client is matchable on ANY of its phone fields, not just treatmentContactPhone.
function clientPhoneKeys(c) {
  if (!c) return [];
  return [c.treatmentContactPhone, c.payerPhone, c.phone].map(phoneKey).filter(k => !!k);
}

function matchClientForFlag(flag, clients) {
  const key = phoneKey(flag && flag.phone);
  const nameQ = ((flag && flag.name) || '').trim().toLowerCase();
  const byPhone = key ? clients.filter(c => clientPhoneKeys(c).indexOf(key) !== -1) : [];
  if (byPhone.length === 1) return { client: byPhone[0], ambiguous: false };
  if (byPhone.length > 1) {
    const narrowed = nameQ ? byPhone.filter(c => (c.name || '').trim().toLowerCase() === nameQ) : [];
    if (narrowed.length === 1) return { client: narrowed[0], ambiguous: false };
    return { client: null, ambiguous: true };
  }
  if (nameQ) {
    const byName = clients.filter(c => (c.name || '').trim().toLowerCase() === nameQ);
    if (byName.length === 1) return { client: byName[0], ambiguous: false };
    if (byName.length > 1) return { client: null, ambiguous: true };
  }
  return { client: null, ambiguous: false };
}

/* ---- tests ---- */

test('stopFlag auth is FAIL-CLOSED: refused unless a secret is configured AND matches', () => {
  assert.equal(stopFlagAuthOk('', 'anything'), false);       // not configured → refuse
  assert.equal(stopFlagAuthOk(null, 'anything'), false);
  assert.equal(stopFlagAuthOk('s3cret', ''), false);          // configured, missing → refuse
  assert.equal(stopFlagAuthOk('s3cret', 'wrong'), false);     // configured, wrong → refuse
  assert.equal(stopFlagAuthOk('s3cret', 's3cret'), true);     // configured, match → allow
});

test('buildStopFlag requires at least one identifier and always starts pending', () => {
  assert.deepEqual(buildStopFlag({}, 'sf_1', 'T'), { ok: false, error: 'missing_phone_and_name' });
  assert.deepEqual(buildStopFlag({ phone: '   ', name: '  ' }, 'sf_1', 'T'),
    { ok: false, error: 'missing_phone_and_name' });

  const r = buildStopFlag(
    { phone: '050-1234567', name: 'אורי', reportedBy: 'מטפלת', note: 'הפסיק להגיע' },
    'sf_1', '2026-06-14T08:00:00'
  );
  assert.equal(r.ok, true);
  assert.equal(r.flag.status, 'pending');
  assert.equal(r.flag.phone, '050-1234567');
  assert.equal(r.flag.reportedBy, 'מטפלת');
  assert.equal(r.flag.reportedAt, '2026-06-14T08:00:00'); // defaulted from clock
  assert.equal(r.flag.resolvedAt, '');
});

test('getStopFlags lists only pending rows', () => {
  const rows = [
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'resolved' },
    { id: 'c', status: '' },
    { id: 'd', status: 'pending' }
  ];
  assert.deepEqual(filterPending(rows).map(r => r.id), ['a', 'd']);
});

test('phoneKey collapses 0 / +972 / 00972 and separators to national digits', () => {
  assert.equal(phoneKey('050-1234567'), '501234567');
  assert.equal(phoneKey('0501234567'), '501234567');
  assert.equal(phoneKey('+972-50-123-4567'), '501234567');
  assert.equal(phoneKey('00972501234567'), '501234567');
  assert.equal(phoneKey(''), '');
});

test('matchClientForFlag: single phone match wins regardless of format', () => {
  const clients = [
    { id: 'c1', name: 'אורי', treatmentContactPhone: '0501234567' },
    { id: 'c2', name: 'דנה', treatmentContactPhone: '052-7654321' }
  ];
  const m = matchClientForFlag({ phone: '+972501234567', name: 'whatever' }, clients);
  assert.equal(m.client.id, 'c1');
  assert.equal(m.ambiguous, false);
});

test('matchClientForFlag: duplicate phones disambiguate by exact name, else ambiguous', () => {
  const clients = [
    { id: 'c1', name: 'אורי כהן', treatmentContactPhone: '050-1234567' },
    { id: 'c2', name: 'אורי לוי', treatmentContactPhone: '0501234567' }
  ];
  assert.equal(matchClientForFlag({ phone: '0501234567', name: 'אורי לוי' }, clients).client.id, 'c2');
  const amb = matchClientForFlag({ phone: '0501234567', name: 'מישהו אחר' }, clients);
  assert.equal(amb.client, null);
  assert.equal(amb.ambiguous, true);
});

test('matchClientForFlag: no phone match falls back to unique name; no match → null, not a guess', () => {
  const clients = [{ id: 'c1', name: 'מאיה', treatmentContactPhone: '054-1111111' }];
  assert.equal(matchClientForFlag({ phone: '', name: 'מאיה' }, clients).client.id, 'c1');
  const none = matchClientForFlag({ phone: '03-9999999', name: 'לא קיים' }, clients);
  assert.equal(none.client, null);
  assert.equal(none.ambiguous, false);
});

test('matchClientForFlag: phone matches on ANY field — treatmentContactPhone / payerPhone / phone', () => {
  const clients = [
    { id: 'tc', name: 'A', treatmentContactPhone: '0541111111' },
    { id: 'pp', name: 'B', payerPhone: '0542222222' },
    { id: 'pat', name: 'C', phone: '0543123276' } // patient phone column
  ];
  assert.equal(matchClientForFlag({ phone: '054-111-1111' }, clients).client.id, 'tc');
  assert.equal(matchClientForFlag({ phone: '+972542222222' }, clients).client.id, 'pp');
  assert.equal(matchClientForFlag({ phone: '0543123276' }, clients).client.id, 'pat');
});

test('matchClientForFlag: a phone match alone is sufficient even when the name differs (the ליעם בריאר bug)', () => {
  // Phone lives in the patient `phone` column; the flag name has an extra space
  // / spelling drift that would fail an exact-name gate. Phone match must win.
  const clients = [{ id: 'liam', name: 'ליעם בריאר', phone: '0543123276' }];
  const m = matchClientForFlag({ phone: '0543123276', name: 'ליעם  בריאר ' }, clients);
  assert.equal(m.client.id, 'liam');
  assert.equal(m.ambiguous, false);
});

test('matchClientForFlag: name is only a tiebreaker when two clients share the phone', () => {
  const clients = [
    { id: 'c1', name: 'אורי כהן', phone: '0543123276' },
    { id: 'c2', name: 'אורי לוי', treatmentContactPhone: '0543123276' }
  ];
  assert.equal(matchClientForFlag({ phone: '0543123276', name: 'אורי לוי' }, clients).client.id, 'c2');
  const amb = matchClientForFlag({ phone: '0543123276', name: 'מישהו' }, clients);
  assert.equal(amb.client, null);
  assert.equal(amb.ambiguous, true);
});
