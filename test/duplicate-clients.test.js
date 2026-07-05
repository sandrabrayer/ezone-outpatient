'use strict';

/**
 * Coverage for the duplicate-client work (public/app.js):
 *   - resolveStopFlagClient now returns the candidate list (powers the manual
 *     picker for an ambiguous stop flag),
 *   - findClientByPhone / duplicateClientBlock — hard duplicate guard on the
 *     patient IDENTITY phone (the patient's own `phone`); payerPhone is
 *     intentionally excluded so shared family payers aren't false-blocked, and
 *     the אחראי-טיפול contact phone is no longer an identity key (that role was
 *     removed from the product),
 *   - duplicateClientReport — read-only grouping by canonical phone with
 *     payment/charge reference counts.
 * The real homes live in the app.js IIFE; mirrored here, keep in sync.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- canonical phone mirror (public/app.js) ---
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

// --- duplicate-guard mirrors ---
// Identity is the patient's OWN phone only (treatmentContactPhone was dropped
// as an identity key when the אחראי-טיפול role was removed from the product).
function clientIdentityPhones(c) {
  return [c.phone].map(recoverPhone).filter(Boolean);
}
function findClientByPhone(clients, rawPhone, exceptId) {
  const key = recoverPhone(rawPhone);
  if (!key) return null;
  return clients.find(c => c && c.id !== exceptId && clientIdentityPhones(c).indexOf(key) !== -1) || null;
}

// --- report mirror ---
function duplicateClientReport(clients, payments, charges) {
  const byKey = {};
  (clients || []).forEach(c => {
    if (!c) return;
    const keys = {};
    [c.phone].forEach(p => { const k = recoverPhone(p); if (k) keys[k] = true; });
    Object.keys(keys).forEach(k => { (byKey[k] = byKey[k] || []).push(c); });
  });
  const refCount = (rows, id) => (rows || []).filter(r => r && String(r.clientId) === String(id)).length;
  const out = [];
  Object.keys(byKey).forEach(k => {
    const rows = byKey[k];
    if (rows.length < 2) return;
    out.push({
      phone: k,
      rows: rows.map(c => ({
        id: c.id, name: c.name || '', status: c.status || '', phone: k,
        payments: refCount(payments, c.id), charges: refCount(charges, c.id)
      }))
    });
  });
  return out;
}

// --- resolveStopFlagClient candidate mirror (ambiguous path) ---
function clientPhoneMatches(c, key) {
  return [c.treatmentContactPhone, c.payerPhone, c.phone].some(p => recoverPhone(p) === key);
}
function resolveStopFlagClient(flag, clients) {
  if (flag && flag.clientId) {
    const byId = clients.find(c => c.id === flag.clientId);
    if (byId) return { client: byId, ambiguous: false, candidates: [byId] };
  }
  const key = recoverPhone(flag && flag.phone);
  const byPhone = key ? clients.filter(c => clientPhoneMatches(c, key)) : [];
  if (byPhone.length === 1) return { client: byPhone[0], ambiguous: false, candidates: byPhone };
  const nameQ = ((flag && flag.name) || '').trim().toLowerCase();
  if (byPhone.length > 1) {
    const narrowed = nameQ ? byPhone.filter(c => (c.name || '').trim().toLowerCase() === nameQ) : [];
    if (narrowed.length === 1) return { client: narrowed[0], ambiguous: false, candidates: byPhone };
    return { client: null, ambiguous: true, candidates: byPhone };
  }
  return { client: null, ambiguous: false, candidates: [] };
}

test('resolveStopFlagClient: ambiguous result exposes the candidate list for the picker', () => {
  const clients = [
    { id: 'liam1', name: 'ליעם בריאר', phone: '0543123276' },
    { id: 'liam2', name: 'ליעם בריאר', treatmentContactPhone: '0543123276' }
  ];
  const res = resolveStopFlagClient({ phone: '0543123276', name: 'ליעם  בריאר' }, clients);
  assert.equal(res.client, null);
  assert.equal(res.ambiguous, true);
  assert.deepEqual(res.candidates.map(c => c.id), ['liam1', 'liam2']);
});

test('findClientByPhone: matches identity on the patient `phone` (any format); the אחראי-טיפול contact phone is NOT an identity key', () => {
  const clients = [
    { id: 'a', name: 'A', phone: '0543123276' },
    { id: 'b', name: 'B', treatmentContactPhone: '0521111111' } // contact-only, no identity
  ];
  assert.equal(findClientByPhone(clients, '054-312-3276').id, 'a');
  // matching the removed contact phone no longer finds a client (identity = phone)
  assert.equal(findClientByPhone(clients, '+972521111111'), null);
  assert.equal(findClientByPhone(clients, '0500000000'), null);
});

test('findClientByPhone: excludes self (edit), so saving a client over itself is not a duplicate', () => {
  const clients = [{ id: 'a', name: 'A', phone: '0543123276' }];
  assert.equal(findClientByPhone(clients, '0543123276', 'a'), null);
  assert.equal(findClientByPhone(clients, '0543123276', 'other').id, 'a');
});

test('findClientByPhone: payerPhone is NOT a duplicate key (shared family payer is allowed)', () => {
  const clients = [{ id: 'sib', name: 'אח', payerPhone: '0543123276' }];
  // A new patient whose own number equals an existing client's payer phone is
  // NOT blocked — payers are shared across siblings.
  assert.equal(findClientByPhone(clients, '0543123276'), null);
});

test('duplicateClientReport: groups by canonical phone with payment/charge counts', () => {
  const clients = [
    { id: 'liam1', name: 'ליעם בריאר', status: 'פעיל', phone: '0543123276' },
    { id: 'liam2', name: 'ליעם בריאר', status: 'הפסקה זמנית', phone: '054-312-3276' },
    { id: 'solo', name: 'יחיד', phone: '0521111111' }
  ];
  const payments = [{ clientId: 'liam1' }, { clientId: 'liam1' }, { clientId: 'liam2' }];
  const charges = [{ clientId: 'liam2' }];
  const rep = duplicateClientReport(clients, payments, charges);
  assert.equal(rep.length, 1, 'only the shared number is reported');
  assert.equal(rep[0].phone, '0543123276');
  const byId = Object.fromEntries(rep[0].rows.map(r => [r.id, r]));
  assert.deepEqual(byId.liam1, { id: 'liam1', name: 'ליעם בריאר', status: 'פעיל', phone: '0543123276', payments: 2, charges: 0 });
  assert.deepEqual(byId.liam2, { id: 'liam2', name: 'ליעם בריאר', status: 'הפסקה זמנית', phone: '0543123276', payments: 1, charges: 1 });
});

test('duplicateClientReport: no duplicates → empty; tolerates missing inputs', () => {
  assert.deepEqual(duplicateClientReport([{ id: 'a', phone: '0543123276' }], [], []), []);
  assert.deepEqual(duplicateClientReport(null, null, null), []);
});
