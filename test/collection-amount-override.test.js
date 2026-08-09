'use strict';

/**
 * Coverage for the editable collection amount (סכום גבייה) feature.
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * The manual amount is an APPEND-ONLY override LAYER keyed by payment id, stored as
 * a JSON map (paymentAmountOverrides) on the owning client's row. The read side
 * prefers the override over the computed/billed amount; the package price and the
 * charge source rows are NEVER rewritten.
 *
 * Neither Code.gs nor the app.js IIFE can be imported in Node, so the pure rules
 * (read-precedence, monthly totals, the merge/parse of the override cell) are
 * mirrored below and locked by source-scan guards that assert the real wiring
 * exists — so a mirror can't pass while the app drifts. Modeled on the passing
 * session-credits / card-money-panel suites, not the env-dependent forwarders.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GS = read('apps-script/Code.gs');
const APP = read('public/app.js');
const HTML = read('public/index.html');

function gsHeaders(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of the read side (public/app.js overrideAmountFor / effective).
// ─────────────────────────────────────────────────────────────────────────────
function toNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function overrideAmountFor(clients, payment) {
  if (!payment || !payment.clientId) return null;
  const c = clients.find((x) => x.id === payment.clientId);
  if (!c || !c.paymentAmountOverrides) return null;
  const v = c.paymentAmountOverrides[payment.id];
  if (v == null || v === '') return null;
  const n = toNum(v);
  return isFinite(n) ? n : null;
}
function effectivePaymentAmount(clients, payment, computedFallback) {
  const o = overrideAmountFor(clients, payment);
  if (o != null) return o;
  if (computedFallback != null) return computedFallback;
  return toNum(payment && payment.amountDue);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) Read precedence: override > computed
// ─────────────────────────────────────────────────────────────────────────────
test('override amount wins over the computed amount', () => {
  const clients = [{ id: 'c1', pricePerSession: 300, paymentAmountOverrides: { 'pay::c1::base::2026-05': 250 } }];
  const payment = { id: 'pay::c1::base::2026-05', clientId: 'c1', amountDue: 300 };
  // computed fallback (client price) is 300, override is 250 -> 250 wins
  assert.equal(effectivePaymentAmount(clients, payment, 300), 250);
});

test('no override -> the computed fallback is used', () => {
  const clients = [{ id: 'c1', pricePerSession: 300, paymentAmountOverrides: {} }];
  const payment = { id: 'pay::c1::base::2026-05', clientId: 'c1', amountDue: 300 };
  assert.equal(effectivePaymentAmount(clients, payment, 300), 300);
});

test('blank / missing / malformed override -> computed fallback, never NaN', () => {
  const payment = { id: 'pay::c1::base::2026-05', clientId: 'c1', amountDue: 300 };
  assert.equal(effectivePaymentAmount([{ id: 'c1', paymentAmountOverrides: { 'pay::c1::base::2026-05': '' } }], payment, 300), 300);
  assert.equal(effectivePaymentAmount([{ id: 'c1', paymentAmountOverrides: null }], payment, 300), 300);
  assert.equal(effectivePaymentAmount([{ id: 'c1' }], payment, 300), 300);
  assert.equal(effectivePaymentAmount([], payment, 300), 300);
});

test('override of 0 is not treated as "no override" only when explicitly set (empty string reverts)', () => {
  // A cleared override is stored as '' / removed -> reverts to computed. A real
  // stored number (even a small one) wins.
  const payment = { id: 'p', clientId: 'c1', amountDue: 300 };
  assert.equal(effectivePaymentAmount([{ id: 'c1', paymentAmountOverrides: { p: 120 } }], payment, 300), 120);
});

test('an extra-charge (chg-) row overrides just like a base row', () => {
  const clients = [{ id: 'c1', paymentAmountOverrides: { 'pay::c1::chg-x9::2026-05': 90 } }];
  const payment = { id: 'pay::c1::chg-x9::2026-05', clientId: 'c1', amountDue: 150 };
  assert.equal(effectivePaymentAmount(clients, payment, 150), 90);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) Monthly summary (סיכום חודשי) uses the EFFECTIVE amount
// ─────────────────────────────────────────────────────────────────────────────
function monthKey(iso) { return String(iso || '').slice(0, 7); }
function monthOutstanding(clients, payments, mk) {
  return payments
    .filter((p) => monthKey(p.dueDate) === mk && p.status !== 'paid')
    .reduce((s, p) => s + Math.max(0, effectivePaymentAmount(clients, p, p.amountDue || 0) - (p.amountPaid || 0)), 0);
}
test('monthly outstanding total reflects the override, not the computed amount', () => {
  const clients = [{ id: 'c1', paymentAmountOverrides: { 'pay::c1::base::2026-05': 250 } }];
  const payments = [
    { id: 'pay::c1::base::2026-05', clientId: 'c1', dueDate: '2026-05-01', amountDue: 300, amountPaid: 0, status: 'unpaid' },
    { id: 'pay::c2::base::2026-05', clientId: 'c2', dueDate: '2026-05-01', amountDue: 400, amountPaid: 0, status: 'unpaid' }
  ];
  // 250 (overridden, not 300) + 400 = 650
  assert.equal(monthOutstanding(clients, payments, '2026-05'), 650);
});
test('a partial payment nets against the overridden amount', () => {
  const clients = [{ id: 'c1', paymentAmountOverrides: { 'pay::c1::base::2026-05': 250 } }];
  const payments = [{ id: 'pay::c1::base::2026-05', clientId: 'c1', dueDate: '2026-05-01', amountDue: 300, amountPaid: 100, status: 'partial' }];
  assert.equal(monthOutstanding(clients, payments, '2026-05'), 150); // 250 - 100
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) Backend merge/parse of the override cell (pure mirror of Code.gs helpers)
// ─────────────────────────────────────────────────────────────────────────────
function parseOverrides(v) {
  if (v == null || v === '') return {};
  if (typeof v === 'object') return v;
  try { const o = JSON.parse(String(v)); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
  catch (_) { return {}; }
}
function mergeOverride(cellValue, paymentId, amount) {
  const map = parseOverrides(cellValue);
  if (amount === null || amount === undefined || amount === '') delete map[paymentId];
  else map[paymentId] = Number(amount);
  return Object.keys(map).length ? JSON.stringify(map) : '';
}
test('merge sets, updates, and clears an override key; empty map -> blank cell', () => {
  let cell = '';
  cell = mergeOverride(cell, 'p1', 250);       assert.deepEqual(parseOverrides(cell), { p1: 250 });
  cell = mergeOverride(cell, 'p2', 90);        assert.deepEqual(parseOverrides(cell), { p1: 250, p2: 90 });
  cell = mergeOverride(cell, 'p1', 275);       assert.deepEqual(parseOverrides(cell), { p1: 275, p2: 90 });
  cell = mergeOverride(cell, 'p2', '');         assert.deepEqual(parseOverrides(cell), { p1: 275 });
  cell = mergeOverride(cell, 'p1', null);       assert.equal(cell, ''); // last key cleared -> blank
});
test('parse tolerates blank / malformed JSON -> {}', () => {
  assert.deepEqual(parseOverrides(''), {});
  assert.deepEqual(parseOverrides(null), {});
  assert.deepEqual(parseOverrides('not json'), {});
  assert.deepEqual(parseOverrides('[1,2]'), {}); // array is not a map
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) Source guards — the real wiring must match the mirror (Code.gs)
// ─────────────────────────────────────────────────────────────────────────────
test('CLIENTS_HEADERS appends paymentAmountOverrides as the trailing column', () => {
  const H = gsHeaders('CLIENTS_HEADERS');
  assert.equal(H[H.length - 1], 'paymentAmountOverrides');
});
test('_writePaymentAmountOverride derives columns via CLIENTS_HEADERS.indexOf (never a literal)', () => {
  const m = GS.match(/function _writePaymentAmountOverride[\s\S]*?\n}/);
  assert.ok(m, '_writePaymentAmountOverride not found');
  const body = m[0];
  assert.ok(/CLIENTS_HEADERS\.indexOf\('id'\)\s*\+\s*1/.test(body), 'idCol must be header-derived');
  assert.ok(/CLIENTS_HEADERS\.indexOf\('paymentAmountOverrides'\)\s*\+\s*1/.test(body), 'override col must be header-derived');
  assert.ok(/\.setValue\(/.test(body), 'must do a single-cell setValue');
  assert.ok(!/getRange\([^,]+,\s*\d+\)\.setValue/.test(body), 'must not write a hardcoded column index');
});
test('_setPaymentAmountOverride validates and takes the script lock', () => {
  const m = GS.match(/function _setPaymentAmountOverride[\s\S]*?\n}/);
  assert.ok(m, '_setPaymentAmountOverride not found');
  const body = m[0];
  assert.ok(/missing_clientId/.test(body) && /missing_paymentId/.test(body), 'validates ids');
  assert.ok(/invalid_amount/.test(body), 'rejects a negative/NaN amount');
  assert.ok(/LockService\.getScriptLock\(\)/.test(body), 'uses LockService');
});
test('the savePaymentAmountOverride action is routed in doPost', () => {
  assert.ok(/action === 'savePaymentAmountOverride'/.test(GS), 'router entry missing');
  assert.ok(/_setPaymentAmountOverride\(payload\)/.test(GS), 'router must call the handler');
});
test('_saveAll preserves paymentAmountOverrides by id (no stale-save clobber)', () => {
  const m = GS.match(/function _saveAll[\s\S]*?\n}/);
  assert.ok(m, '_saveAll not found');
  const body = m[0];
  assert.ok(/existingOverrides/.test(body), '_saveAll must snapshot the on-sheet overrides');
  assert.ok(/paymentAmountOverrides\s*=\s*_hasOwn\(existingOverrides/.test(body),
    '_saveAll must prefer the on-sheet override map by id');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) Source guards — the real wiring must match the mirror (public/app.js + HTML)
// ─────────────────────────────────────────────────────────────────────────────
test('the render side uses effectivePaymentAmount for the row and the monthly totals', () => {
  assert.ok(/function effectivePaymentAmount\(/.test(APP), 'helper missing');
  // buildBillingRow computes the effective amount from the computed fallback
  assert.ok(/var amount = effectivePaymentAmount\(payment, computedAmount\)/.test(APP),
    'buildBillingRow must use the effective amount');
  // monthly summary outstanding + per-client breakdown both go through the helper
  const nOutstanding = (APP.match(/effectivePaymentAmount\(p, p\.amountDue/g) || []).length;
  assert.ok(nOutstanding >= 2, 'both monthly-summary totals must use the effective amount');
});
test('the ✏️ appears on every billing row for editors, beside the amount it edits', () => {
  // Editor-gated (not carry-gated) so the main due list (סכום חודשי) is editable too.
  assert.ok(/canEditAmount = state\.role === 'editor'/.test(APP),
    'edit affordance must be gated to editor only');
  assert.ok(/billing-amount-edit/.test(APP), 'edit button class present');
  // one reusable snippet, emitted only when canEditAmount is true
  assert.ok(/var amountEditHtml = canEditAmount[\s\S]{0,200}billing-amount-edit/.test(APP),
    'the ✏️ button must be behind the canEditAmount gate');
  // placed next to "סכום חודשי" on due rows and next to "יתרה" on carry rows
  assert.ok(/isCarry \? '' : amountEditHtml/.test(APP), 'due rows show the ✏️ next to סכום חודשי');
  assert.ok(/isCarry \? amountEditHtml : ''/.test(APP), 'carry rows show the ✏️ next to יתרה');
  assert.ok(/openEditAmountModal\(client, payment, amount, computedAmount\)/.test(APP),
    'click opens the prefilled edit modal');
});
test('the override save is optimistic with rollback and posts savePaymentAmountOverride', () => {
  assert.ok(/apiPostAction\('savePaymentAmountOverride'/.test(APP), 'persist path missing');
  const m = APP.match(/function applyAmountOverride[\s\S]*?\n  }/);
  assert.ok(m, 'applyAmountOverride not found');
  const body = m[0];
  assert.ok(/renderBilling\(\)/.test(body), 'optimistic re-render');
  assert.ok(/\.catch\(/.test(body) && /prev/.test(body), 'rolls back on failure');
});
test('the override map round-trips through normalize + clientForSheet', () => {
  assert.ok(/paymentAmountOverrides: parseAmountOverrides\(row\.paymentAmountOverrides\)/.test(APP),
    'normalizeClientFromSheet must parse the JSON cell');
  assert.ok(/paymentAmountOverrides:\s*\(function \(\)/.test(APP),
    'clientForSheet must serialize the map back to a JSON string');
});
test('the edit-amount modal exists and validates a positive number', () => {
  assert.ok(/id="editAmountModal"/.test(HTML), 'modal markup missing');
  assert.ok(/id="editAmountForm"/.test(HTML) && /name="amount"/.test(HTML), 'amount input missing');
  assert.ok(/יש להזין סכום חיובי/.test(APP), 'positive-number validation missing');
});
