'use strict';

/**
 * Coverage for the server-side bulk payment cleanup on patient delete:
 * apps-script/Code.gs `_removePaymentsForClient` (mirrored here, the
 * `_removeChargesForClient` pattern) and the public/app.js rewrite of
 * `removePaymentsForClient` from a per-row, warn-swallowing loop over
 * state.payments to one bulk call.
 *
 * Orphan paths this closes (both part of the 2026-08-26 incident anatomy):
 *  - loadAll falls back to payments:[] when getPayments fails, so a delete in
 *    that session removed ZERO payment rows while erasing the client;
 *  - each per-row removePayment failure was console.warn-swallowed, leaving
 *    partial orphans with a green "נמחק" toast.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of _removePaymentsForClient (bottom-up sheet deletion)
// ─────────────────────────────────────────────────────────────────────────────

function removePaymentsForClient(rows, clientId) {
  const cid = String(clientId == null ? '' : clientId).trim();
  if (!cid) return { ok: false, error: 'missing_clientId' };
  let removed = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].clientId).trim() === cid) {
      rows.splice(i, 1);
      removed++;
    }
  }
  return { ok: true, removed, clientId: cid };
}

test('removes every row for the client, keeps everyone else, idempotent on re-run', () => {
  const rows = [
    { id: 'pay::a::base::2026-07', clientId: 'a' },
    { id: 'pay::b::base::2026-07', clientId: 'b' },
    { id: 'pay::a::base::2026-08', clientId: 'a' },
    { id: 'pay::a::chg-x::once', clientId: 'a' }
  ];
  assert.deepEqual(removePaymentsForClient(rows, 'a'), { ok: true, removed: 3, clientId: 'a' });
  assert.deepEqual(rows.map((r) => r.clientId), ['b']);
  assert.deepEqual(removePaymentsForClient(rows, 'a'), { ok: true, removed: 0, clientId: 'a' });
});

test('blank clientId is rejected — never a mass delete', () => {
  const rows = [{ id: 'p', clientId: 'a' }];
  assert.deepEqual(removePaymentsForClient(rows, ''), { ok: false, error: 'missing_clientId' });
  assert.deepEqual(removePaymentsForClient(rows, '   '), { ok: false, error: 'missing_clientId' });
  assert.equal(rows.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards
// ─────────────────────────────────────────────────────────────────────────────

test('Code.gs: _removePaymentsForClient mirrors _removeChargesForClient (lock, bottom-up, audit log, idempotent)', () => {
  const m = GS.match(/function _removePaymentsForClient[\s\S]*?\n}/);
  assert.ok(m, '_removePaymentsForClient not found');
  const body = m[0];
  assert.match(body, /'missing_clientId'/);
  assert.match(body, /LockService/);
  assert.match(body, /PAYMENTS_HEADERS/);
  assert.match(body, /for \(var i = rows\.length - 1; i >= 0; i--\)/, 'must delete bottom-up so indices stay valid');
  assert.match(body, /Logger\.log/, 'each removed row must be logged (audit trail)');
  assert.match(body, /\{ ok: true, removed: 0, clientId: cid \}/, 'empty sheet → ok/removed:0, not an error');
});

test('Code.gs: doPost routes removePaymentsForClient', () => {
  assert.match(GS, /action === 'removePaymentsForClient'\) \{\s*\n\s*return _json\(_removePaymentsForClient\(payload\.clientId\)\);/);
});

test('app.js: removePaymentsForClient is one bulk call — no per-row loop, no warn-swallow', () => {
  const m = APP.match(/async function removePaymentsForClient[\s\S]*?\n  \}/);
  assert.ok(m, 'removePaymentsForClient not found');
  const body = m[0];
  assert.match(body, /apiPostAction\('removePaymentsForClient', \{ clientId: clientId \}\)/);
  assert.ok(!/console\.warn/.test(body), 'failures must propagate, not be swallowed');
  assert.ok(!/removePayment\(/.test(body), 'must not loop per-row over state.payments');
});

test('app.js: the ✕ delete flow still runs the payment cleanup after persist', () => {
  assert.match(APP, /\.then\(function \(\) \{ return removePaymentsForClient\(deletedId\); \}\)/);
});
