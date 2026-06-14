'use strict';

/**
 * Coverage for the stop-flag → client matching fix (the ליעם בריאר "no match"
 * bug). The real logic lives in two un-importable homes:
 *   - server write-time match: _matchStopFlagClient in apps-script/Code.gs,
 *   - client render-time resolve: resolveStopFlagClient in public/app.js,
 * plus the in-memory backfillClientPhones and the new Clients `phone` column.
 * All are mirrored here; any change must update both. The contract under test:
 * a phone match against ANY client phone field is sufficient, name is only a
 * soft tiebreaker (never a hard gate), and an existing client recovers its
 * phone from the originating lead.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// --- mirrors of the canonical phone helpers in public/app.js ---
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

// --- mirror of resolveStopFlagClient (public/app.js) ---
function resolveStopFlagClient(flag, clients) {
  if (flag && flag.clientId) {
    const byId = clients.find(c => c.id === flag.clientId);
    if (byId) return { client: byId, ambiguous: false };
  }
  const key = recoverPhone(flag && flag.phone);
  const byPhone = key
    ? clients.filter(c => [c.treatmentContactPhone, c.payerPhone, c.phone].some(p => recoverPhone(p) === key))
    : [];
  if (byPhone.length === 1) return { client: byPhone[0], ambiguous: false };
  const nameQ = ((flag && flag.name) || '').trim().toLowerCase();
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

// --- mirror of _matchStopFlagClient (apps-script/Code.gs) ---
function matchStopFlagClient(clients, phone, name) {
  if (!phone) return '';
  const nm = String(name == null ? '' : name).trim();
  const hits = clients.filter(c =>
    recoverPhone(c.phone) === phone ||
    recoverPhone(c.treatmentContactPhone) === phone ||
    recoverPhone(c.payerPhone) === phone);
  if (hits.length === 1) return String(hits[0].id);
  if (hits.length > 1 && nm) {
    const narrowed = hits.filter(c => String(c.name == null ? '' : c.name).trim() === nm);
    if (narrowed.length === 1) return String(narrowed[0].id);
  }
  return '';
}

test('resolveStopFlagClient: the ליעם בריאר bug — phone in patient `phone`, name drifts, still matches', () => {
  const clients = [{ id: 'liam', name: 'ליעם בריאר', phone: '0543123276' }];
  const res = resolveStopFlagClient({ phone: '0543123276', name: 'ליעם  בריאר ', clientId: '' }, clients);
  assert.equal(res.client.id, 'liam');
  assert.equal(res.ambiguous, false);
});

test('resolveStopFlagClient: matches on ANY phone field, any format', () => {
  const clients = [
    { id: 'tc', name: 'A', treatmentContactPhone: '0541111111' },
    { id: 'pp', name: 'B', payerPhone: '0542222222' },
    { id: 'pat', name: 'C', phone: '0543123276' }
  ];
  assert.equal(resolveStopFlagClient({ phone: '054-111-1111' }, clients).client.id, 'tc');
  assert.equal(resolveStopFlagClient({ phone: '+972542222222' }, clients).client.id, 'pp');
  assert.equal(resolveStopFlagClient({ phone: '543123276' }, clients).client.id, 'pat'); // dropped-zero
});

test('resolveStopFlagClient: explicit clientId wins; name only breaks a phone tie', () => {
  const clients = [
    { id: 'c1', name: 'אורי כהן', phone: '0543123276' },
    { id: 'c2', name: 'אורי לוי', treatmentContactPhone: '0543123276' }
  ];
  assert.equal(resolveStopFlagClient({ clientId: 'c2', phone: 'x' }, clients).client.id, 'c2');
  assert.equal(resolveStopFlagClient({ phone: '0543123276', name: 'אורי לוי' }, clients).client.id, 'c2');
  const amb = resolveStopFlagClient({ phone: '0543123276', name: 'מישהו' }, clients);
  assert.equal(amb.client, null);
  assert.equal(amb.ambiguous, true);
});

test('_matchStopFlagClient: phone alone fills clientId; no exact-name gate', () => {
  const clients = [{ id: 'liam', name: 'ליעם בריאר', phone: '0543123276' }];
  // Name omitted entirely — a single phone hit is still sufficient now.
  assert.equal(matchStopFlagClient(clients, '0543123276', ''), 'liam');
  // payerPhone is now also checked.
  const c2 = [{ id: 'p', name: 'X', payerPhone: '0549999999' }];
  assert.equal(matchStopFlagClient(c2, '0549999999', 'unused'), 'p');
  // Ambiguous phone with non-matching name → empty (panel resolves/asks).
  const dup = [
    { id: 'a', name: 'A', phone: '0543123276' },
    { id: 'b', name: 'B', treatmentContactPhone: '0543123276' }
  ];
  assert.equal(matchStopFlagClient(dup, '0543123276', 'C'), '');
});

test('backfill: existing client with no stored phone inherits it from its lead', () => {
  const leads = [{ id: 'L1', phone: '0543123276' }];
  const clients = [{ id: 'C1', fromLead: 'L1', phone: '' }];
  const leadById = Object.fromEntries(leads.map(l => [l.id, l]));
  clients.forEach(c => {
    const own = recoverPhone(c.phone);
    if (own) { c.phone = own; return; }
    const lead = c.fromLead ? leadById[c.fromLead] : null;
    if (lead) c.phone = recoverPhone(lead.phone);
  });
  assert.equal(clients[0].phone, '0543123276');
  // ...and is now matchable
  assert.equal(resolveStopFlagClient({ phone: '0543123276' }, clients).client.id, 'C1');
});

test('schema guard: Clients `phone` column exists and is appended LAST', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const m = src.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CLIENTS_HEADERS not found');
  const cols = m[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  assert.ok(cols.includes('phone'), 'phone column missing');
  assert.equal(cols[cols.length - 1], 'phone', 'phone must be LAST (append-only)');
  assert.equal(cols[cols.length - 2], 'paymentLink');
});
