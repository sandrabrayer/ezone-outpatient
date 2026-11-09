'use strict';

/**
 * billingMode (אופן חיוב, CRM follow-up 2, 2026-11-04) — package vs. per-session clients.
 *
 *   A. schema: ONE append-only column at the very END of CLIENTS_HEADERS (position 39), mirrored at the
 *      end of the Clients-removed literal; a money key (ops sessions never change it); nothing before it moves.
 *   B. _saveAll: a sent value is validated (anything else stored blank = package); a payload WITHOUT the
 *      key keeps the sheet value; an ops session cannot flip it; a new client seeds from its payload.
 *   C. NO migration: no code path writes 'per_session' on its own — the only literal is the allowed list.
 *   D. UI contracts (static): renewalInfo short-circuits, labels, forms, card panel, suggestion chip,
 *      no base monthly due item (app.js and the charges-logic mirror agree).
 * A–C run the REAL apps-script/Code.gs in a sandbox. The browser flow is in test/crm-followup-2-browser.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const MS = require('../lib/money-scope');
const CL = require('../public/charges-logic.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GS = read('apps-script/Code.gs');
const APP = read('public/app.js');
const HTML = read('public/index.html');
const plain = (x) => JSON.parse(JSON.stringify(x));
const base = (over) => Object.assign({
  id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני',
  sessionsPerWeek: '{"פרטני":1}', status: 'פעיל', startDate: '2026-09-01', nextBillingDate: '2026-10-01', paymentStatus: 'unpaid'
}, over);

/* ================================ A. schema ================================ */

test('A: billingMode is the ONE new column, appended LAST on Clients (position 39) and on the tombstone', () => {
  const { ctx } = sandbox();
  const H = plain(ctx.CLIENTS_HEADERS), R = plain(ctx.CLIENTS_REMOVED_HEADERS);
  assert.equal(H.length, 41); // complementaryType + privateTherapists appended 2026-11-09
  assert.equal(H[38], 'billingMode');
  assert.equal(H.indexOf('billingMode'), H.lastIndexOf('billingMode'), 'exactly once');
  assert.deepEqual(H.slice(-5), ['plannedExitDate', 'preferredHouse', 'billingMode', 'complementaryType', 'privateTherapists']);
  assert.equal(H.indexOf('phone'), 25, 'phone join key untouched');
  assert.deepEqual(R.slice(-3), ['billingMode', 'complementaryType', 'privateTherapists']);
  assert.deepEqual(plain(ctx.BILLING_MODES), ['package', 'per_session']);
  // Leads carry no billing mode
  assert.ok(!plain(ctx.LEADS_HEADERS).includes('billingMode'));
});

test('A: a money key on both sides — the proxy strips it for an ops session, the source preserves it', () => {
  const { ctx } = sandbox();
  assert.ok(plain(ctx.OPS_CLIENT_MONEY_KEYS).includes('billingMode'));
  assert.ok(MS.MONEY_KEYS.includes('billingMode'));
  assert.deepEqual(MS.stripMoney({ id: 'c', billingMode: 'per_session', name: 'x' }), { id: 'c', name: 'x' });
});

/* ================================ B. _saveAll ============================== */

test('B: a new client seeds a validated billingMode; invalid / missing values store blank (= package)', () => {
  const sb = sandbox([], []);
  assert.equal(sb.save([], [
    base({ id: 'n1', billingMode: 'per_session' }), base({ id: 'n2', phone: '0501234568', billingMode: 'package' }),
    base({ id: 'n3', phone: '0501234569', billingMode: 'weekly' }), base({ id: 'n4', phone: '0501234560' })
  ]).ok, true);
  const byId = Object.fromEntries(sb.rows('Clients').map((r) => [r.id, r]));
  assert.equal(byId.n1.billingMode, 'per_session');
  assert.equal(byId.n2.billingMode, 'package');
  assert.equal(byId.n3.billingMode, '');
  assert.equal(byId.n4.billingMode, '');
  assert.deepEqual(plain(sb.ctx.CLIENTS_HEADERS), sb.sheets.Clients.grid[0], 'header row untouched');
});

test('B: Vered flips an existing client; a pre-column tab (no key) leaves the sheet value alone', () => {
  const sb = sandbox([], [base({ id: 'a', updatedAt: '2026-10-01T00:00:00.000Z' })]);
  const echo = sb.rows('Clients')[0];
  assert.equal(sb.save([], [Object.assign({}, echo, { billingMode: 'per_session' })], { user: 'ורד' }).ok, true);
  let after = sb.rows('Clients')[0];
  assert.equal(after.billingMode, 'per_session');
  assert.equal(after.updatedBy, 'ורד', 'a real edit, stamped');
  // an older tab that never heard of the column
  const old = Object.assign({}, after); delete old.billingMode;
  assert.equal(sb.save([], [old]).ok, true);
  after = sb.rows('Clients')[0];
  assert.equal(after.billingMode, 'per_session', 'kept');
  // back to package is an explicit edit too; garbage is stored blank (= package), never coerced to per_session
  assert.equal(sb.save([], [Object.assign({}, after, { billingMode: 'package' })]).ok, true);
  assert.equal(sb.rows('Clients')[0].billingMode, 'package');
  assert.equal(sb.save([], [Object.assign({}, sb.rows('Clients')[0], { billingMode: 'PER_SESSION' })]).ok, true);
  assert.equal(sb.rows('Clients')[0].billingMode, '');
});

test('B: an operational session (דנה) cannot change billingMode — the sheet value is preserved', () => {
  const sb = sandbox([], [base({ id: 'a', billingMode: 'per_session' })]);
  const echo = sb.rows('Clients')[0];
  assert.equal(sb.save([], [Object.assign({}, echo, { billingMode: 'package', notes: 'ops edit' })], { moneyScope: 'ops', user: 'דנה' }).ok, true);
  assert.equal(sb.rows('Clients')[0].billingMode, 'per_session');
  assert.equal(sb.rows('Clients')[0].notes, 'ops edit', 'the non-money edit went through');
});

test('B: a removed client keeps its billingMode on the tombstone and gets it back on restore', () => {
  const sb = sandbox([], [base({ id: 'a', billingMode: 'per_session' }), base({ id: 'b', phone: '0501234568' })]);
  const rows = sb.rows('Clients');
  assert.equal(sb.save([], [rows[1]], { explicitRemovedIds: ['a'] }).ok, true);
  const tomb = sb.rows('Clients-removed');
  assert.equal(tomb.length, 1); assert.equal(tomb[0].billingMode, 'per_session');
  assert.equal(sb.post({ action: 'restoreRemovedClient', id: 'a' }).ok, true);
  assert.equal(sb.rows('Clients').find((r) => r.id === 'a').billingMode, 'per_session');
});

/* ============================ C. no data migration ========================= */

test('C: nothing in Code.gs writes per_session by itself — the only literal is the allowed list', () => {
  const code = GS.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n'); // comments excluded
  const hits = code.match(/per_session(?!_pack)/g) || [];
  assert.equal(hits.length, 1, 'exactly one occurrence in code (BILLING_MODES; per_session_pack is a catalog unit)');
  assert.match(GS, /var BILLING_MODES = \['package', 'per_session'\];/);
  assert.match(GS, /function _billingModeOrBlank\(v\)/);
  assert.match(GS, /clients\[i\]\.billingMode = \(clients\[i\] && _hasOwn\(clients\[i\], 'billingMode'\)\)\n\s*\? _billingModeOrBlank\(clients\[i\]\.billingMode\)\n\s*: \(existingRow \? _billingModeOrBlank\(existingRow\.billingMode\) : ''\);/);
  // the tombstone / restore copy by header name, so no extra code is needed there
  assert.doesNotMatch(GS, /billingMode\s*=\s*'per_session'/);
});

/* ================================ D. UI contracts ========================== */

test('D: app.js reads, sends, labels and short-circuits the renewal cycle for per-session clients', () => {
  assert.match(APP, /billingMode: billingModeStored\(row\.billingMode\)/, 'read from the sheet as a stable key (blank stays blank)');
  assert.match(APP, /billingMode: billingModeStored\(c\.billingMode\),/, 'always sent on save, blank never rewritten');
  assert.match(APP, /var BILLING_MODE_HE = \{ package: 'חבילה \/ חודשי', per_session: 'תשלום לפי טיפול' \};/);
  assert.match(APP, /if \(isPerSession\(c\)\) return \{ status: 'per_session' \};/, 'renewalInfo: no overdue / due_soon');
  assert.match(APP, /'paymentLink', 'billingMode'\];/, 'a money form field: disabled for an ops session');
  assert.match(APP, /if \(!isPerSession\(c\) && fmtDate\(c\.nextBillingDate\) === dateISO\)/, 'no base monthly due item');
  assert.match(APP, /משלם\/ת לפי טיפול/, 'card panel label');
  assert.match(APP, /data-action="suggest-per-session"[^>]*>סמן כתשלום לפי טיפול\?<\/button>/, 'one-click suggestion chip');
  assert.match(APP, /function setBillingMode\(client, mode\)/);
  assert.match(APP, /if \(form\.billingMode\) form\.billingMode\.value = billingModeOf\(client\.billingMode\);/, 'edit modal prefilled');
  assert.match(APP, /if \(!\(bm === 'package' && !billingModeStored\(client\.billingMode\)\)\) client\.billingMode = bm;/, 'edit modal saves; «package» on a blank row is not an edit');
  assert.doesNotMatch(APP, /billingMode\s*=\s*'per_session'(?!\))/, 'no automatic flip of an existing client in code');
});

test('D: the three client forms carry the toggle with both Hebrew labels', () => {
  for (const id of ['activateForm', 'directClientForm', 'editClientForm']) {
    const start = HTML.indexOf('<form id="' + id + '"');
    const form = HTML.slice(start, HTML.indexOf('</form>', start));
    assert.match(form, /<select name="billingMode">\s*<option value="package">חבילה \/ חודשי<\/option>\s*<option value="per_session">תשלום לפי טיפול<\/option>/, id);
  }
});

test('D: the charges-logic mirror emits no base monthly due item for a per-session client, extras still due', () => {
  const clients = [
    { id: 'p', name: 'per', status: 'פעיל', nextBillingDate: '2026-05-15', pricePerSession: 400, billingMode: 'per_session' },
    { id: 'k', name: 'pkg', status: 'פעיל', nextBillingDate: '2026-05-15', pricePerSession: 2600, billingMode: '' }
  ];
  const charges = [{ id: 'x1', clientId: 'p', billingType: 'one_time', chargeDate: '2026-05-15', amount: 300, active: true }];
  const due = CL.dueItemsOn(clients, charges, '2026-05-15');
  assert.deepEqual(due.map((d) => d.clientId + ':' + d.kind), ['p:extra', 'k:base']);
});
