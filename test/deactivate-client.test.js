'use strict';

/**
 * Coverage for the secured `deactivateClient` cross-app receiver in
 * apps-script/Code.gs — the outpatient pair to the E-Zone Therapists
 * delete-propagation sender (ezone-therapists PR #24, `_postDeactivateClient`).
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Code.gs cannot be imported in the Node runtime, so the pure logic below mirrors
 * `_deactivateAuthOk`, `_recoverPhone`, and `_deactivateClient` (minus the sheet
 * I/O — the Clients sheet is an in-memory array, mutated exactly as the real
 * positional write would persist it). To keep the behaviour honest, the
 * `CLIENTS_HEADERS` and the `DEACTIVATED_CLIENT_STATUS_HE` value are PARSED out of
 * Code.gs (not re-typed), like the other receiver tests.
 *
 * Contracts locked (sender contract from PR #24):
 *   - action `deactivateClient`, payload { action, secret, phone }, response
 *     { ok:true, deactivated:N }
 *   - auth is FAIL-CLOSED on a DEDICATED `DEACTIVATE_CLIENT_SECRET` (unset/empty/
 *     wrong rejected) — NOT reused from STOP_FLAG_SECRET
 *   - deactivates by canonical phone (sets status, not a hard delete)
 *   - dropped-leading-zero phone still matches
 *   - no match -> { ok:true, deactivated:0 } (orphan-safe, never a crash)
 *   - a deactivated client is excluded from getTreatmentPlans AND getDebtStatus
 *   - discharged (`סיים טיפול`) clients are NOT excluded (debt survives discharge)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// --- parse CLIENTS_HEADERS out of Code.gs (no re-typed list) -----------------
function clientsHeaders() {
  const m = GS.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CLIENTS_HEADERS not found in Code.gs');
  return m[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

// --- parse the DEACTIVATED status value out of Code.gs -----------------------
function deactivatedStatus() {
  const m = GS.match(/var DEACTIVATED_CLIENT_STATUS_HE = '([^']*)';/);
  assert.ok(m, 'DEACTIVATED_CLIENT_STATUS_HE not found in Code.gs');
  return m[1];
}

const H = clientsHeaders();
const DEACTIVATED = deactivatedStatus();
const DISCHARGED = 'סיים טיפול';

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

function deactivateAuthOk(expected, got) {
  if (!expected) return false; // fail-closed: not configured -> reject
  const g = (got != null) ? String(got) : '';
  return g !== '' && g === expected;
}

// Mirror of _deactivateClient minus the sheet I/O: `clients` is the in-memory
// array (mutated in place exactly as the positional setValue would persist it).
function deactivateClient(payload, clients) {
  const phone = recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, reason: 'invalid_phone' };
  let deactivated = 0;
  for (const c of clients) {
    if (recoverPhone(c.phone) !== phone &&
        recoverPhone(c.treatmentContactPhone) !== phone &&
        recoverPhone(c.payerPhone) !== phone) continue;
    if (String(c.status) === DEACTIVATED) continue; // already -> not re-counted
    c.status = DEACTIVATED;
    deactivated++;
  }
  return { ok: true, deactivated };
}

// Mirror of _getTreatmentPlans projection (with the new deactivation exclusion).
function projectPlans(clients) {
  return (clients || [])
    .filter((c) => c && c.id != null && String(c.id))
    .filter((c) => c.status !== DEACTIVATED)
    .map((cl) => ({
      sourceApp: 'ezone-outpatient', clientId: String(cl.id), name: cl.name || '',
      phone: recoverPhone(cl.phone) || recoverPhone(cl.treatmentContactPhone),
      serviceType: cl.serviceType || '', sessions: cl.sessionsPerWeek || '',
      status: cl.status || ''
    }));
}

// Mirror of the _getDebtStatus client loop's inclusion rule.
function debtClientIds(clients) {
  return (clients || [])
    .filter((c) => c && c.id != null && String(c.id))
    .filter((c) => c.status !== DEACTIVATED)
    .map((c) => String(c.id));
}

function freshClients() {
  return [
    { id: 'c1', name: 'אורי', status: 'פעיל', phone: '0501234567', treatmentContactPhone: '', payerPhone: '' },
    { id: 'c2', name: 'דנה', status: 'פעיל', phone: '', treatmentContactPhone: '0527654321', payerPhone: '' },
    { id: 'c3', name: 'מאיה', status: DISCHARGED, phone: '0541111111', treatmentContactPhone: '', payerPhone: '' }
  ];
}

// --- the receiver uses a dedicated status, distinct from discharge ----------
test('the deactivation status is its own value, not the discharge status', () => {
  assert.equal(DEACTIVATED, 'לא פעיל');
  assert.notEqual(DEACTIVATED, DISCHARGED);
});

// --- auth is fail-closed on a DEDICATED secret ------------------------------
test('auth is fail-closed: unset / empty / wrong DEACTIVATE_CLIENT_SECRET rejected', () => {
  assert.equal(deactivateAuthOk('', 'anything'), false);   // property unset -> reject
  assert.equal(deactivateAuthOk(null, 'anything'), false);
  assert.equal(deactivateAuthOk('d3act', ''), false);      // empty provided
  assert.equal(deactivateAuthOk('d3act', null), false);
  assert.equal(deactivateAuthOk('d3act', 'wrong'), false);
});

test('auth accepts the exact configured secret', () => {
  assert.equal(deactivateAuthOk('d3act', 'd3act'), true);
});

test('the receiver keys off DEACTIVATE_CLIENT_SECRET, never STOP_FLAG_SECRET', () => {
  // The dedicated-secret contract (least authority) must be wired in Code.gs.
  assert.match(GS, /_deactivateAuthOk[\s\S]*?getProperty\('DEACTIVATE_CLIENT_SECRET'\)/);
  // and the deactivate auth fn must NOT read STOP_FLAG_SECRET
  const fn = GS.match(/function _deactivateAuthOk[\s\S]*?\n}/)[0];
  assert.equal(/STOP_FLAG_SECRET/.test(fn), false);
});

// --- deactivates by phone (soft, not hard delete) ---------------------------
test('deactivates the matching client by phone; sets status, returns deactivated:1', () => {
  const clients = freshClients();
  const res = deactivateClient({ phone: '0501234567' }, clients);
  assert.deepEqual(res, { ok: true, deactivated: 1 });
  assert.equal(clients[0].status, DEACTIVATED);
  // soft, not deleted — the row and its fields are still present
  assert.equal(clients[0].id, 'c1');
  assert.equal(clients[0].name, 'אורי');
  assert.equal(clients.length, 3);
  // other rows untouched
  assert.equal(clients[1].status, 'פעיל');
  assert.equal(clients[2].status, DISCHARGED);
});

test('matches via treatmentContactPhone and payerPhone too', () => {
  let clients = freshClients();
  assert.deepEqual(deactivateClient({ phone: '0527654321' }, clients), { ok: true, deactivated: 1 });
  assert.equal(clients[1].status, DEACTIVATED);

  clients = freshClients();
  clients[0].payerPhone = '0539998877';
  assert.deepEqual(deactivateClient({ phone: '0539998877' }, clients), { ok: true, deactivated: 1 });
  assert.equal(clients[0].status, DEACTIVATED);
});

// --- dropped-leading-zero / intl phone still matches ------------------------
test('dropped-leading-zero (numeric) phone still matches', () => {
  const clients = freshClients();
  clients[0].phone = 501234567; // Sheets coerced to a number, dropped the 0
  const res = deactivateClient({ phone: '0501234567' }, clients);
  assert.deepEqual(res, { ok: true, deactivated: 1 });
  assert.equal(clients[0].status, DEACTIVATED);
});

test('normalized inbound phone (+972 / dashes) matches a canonical stored phone', () => {
  const clients = freshClients();
  assert.deepEqual(deactivateClient({ phone: '+972-50-1234567' }, clients), { ok: true, deactivated: 1 });
  assert.equal(clients[0].status, DEACTIVATED);
});

// --- orphan-safe: no match -> deactivated:0, no crash -----------------------
test('no match returns { ok:true, deactivated:0 } (orphan-safe)', () => {
  const clients = freshClients();
  const before = JSON.stringify(clients);
  const res = deactivateClient({ phone: '0509999999' }, clients);
  assert.deepEqual(res, { ok: true, deactivated: 0 });
  assert.equal(JSON.stringify(clients), before); // nothing changed
});

test('empty client list is orphan-safe', () => {
  assert.deepEqual(deactivateClient({ phone: '0501234567' }, []), { ok: true, deactivated: 0 });
});

test('invalid phone is rejected before any scan', () => {
  const clients = freshClients();
  assert.deepEqual(deactivateClient({ phone: '12345' }, clients), { ok: false, reason: 'invalid_phone' });
  assert.deepEqual(deactivateClient({ phone: '' }, clients), { ok: false, reason: 'invalid_phone' });
  assert.equal(clients[0].status, 'פעיל'); // untouched
});

// --- idempotent + multi-row -------------------------------------------------
test('idempotent: re-deactivating an already-deactivated client returns 0', () => {
  const clients = freshClients();
  assert.equal(deactivateClient({ phone: '0501234567' }, clients).deactivated, 1);
  assert.equal(deactivateClient({ phone: '0501234567' }, clients).deactivated, 0); // already
  assert.equal(clients[0].status, DEACTIVATED);
});

test('all rows sharing the phone are deactivated and counted', () => {
  const clients = freshClients();
  clients.push({ id: 'c4', name: 'אורי תאום', status: 'פעיל', phone: '0501234567', treatmentContactPhone: '', payerPhone: '' });
  const res = deactivateClient({ phone: '0501234567' }, clients);
  assert.deepEqual(res, { ok: true, deactivated: 2 });
  assert.equal(clients[0].status, DEACTIVATED);
  assert.equal(clients[3].status, DEACTIVATED);
});

// --- excluded from the cross-app projections --------------------------------
test('a deactivated client is excluded from getTreatmentPlans', () => {
  const clients = freshClients();
  deactivateClient({ phone: '0501234567' }, clients); // c1 -> deactivated
  const rows = projectPlans(clients);
  const ids = rows.map((r) => r.clientId);
  assert.equal(ids.includes('c1'), false);  // gone from the roster source
  assert.equal(ids.includes('c2'), true);
  assert.equal(ids.includes('c3'), true);   // discharged still listed
});

test('a deactivated client is excluded from getDebtStatus', () => {
  const clients = freshClients();
  deactivateClient({ phone: '0501234567' }, clients);
  const ids = debtClientIds(clients);
  assert.equal(ids.includes('c1'), false);
  assert.equal(ids.includes('c3'), true);   // discharged stays — debt survives discharge
});

test('a discharged client is NOT deactivated by a non-matching call and stays in both projections', () => {
  const clients = freshClients();
  deactivateClient({ phone: '0501234567' }, clients); // only c1
  assert.equal(clients[2].status, DISCHARGED);        // c3 unchanged
  assert.equal(projectPlans(clients).some((r) => r.clientId === 'c3'), true);
  assert.equal(debtClientIds(clients).includes('c3'), true);
});
