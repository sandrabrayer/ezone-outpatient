'use strict';

/**
 * plannedExitDate — the PLANNED discharge date of an active outpatient,
 * projected by getTreatmentPlans for the E-Zone Therapists app.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * No planned-discharge field existed (exitDate is the ACTUAL discharge date,
 * stamped by the exit modal), so this adds:
 *   A. an APPEND-ONLY Clients column `plannedExitDate` (position 37) mirrored
 *      at the END of the Clients-removed tombstone literal;
 *   B. getTreatmentPlans.plannedExitDate: 'yyyy-MM-dd' for an ACTIVE client,
 *      '' when none / invalid / not active — every existing key unchanged;
 *   C. _saveAll validation (real 'yyyy-MM-dd' or '') and back-compat (a payload
 *      without the key — a tab on a pre-column app.js — never blanks it);
 *   D. the edit-client modal date input + card line, wired in app.js.
 * Everything in A–C runs the REAL apps-script/Code.gs in a sandbox.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GS = read('apps-script/Code.gs');
const APP = read('public/app.js');
const HTML = read('public/index.html');
const plain = (x) => JSON.parse(JSON.stringify(x));

const ACTIVE = 'פעיל';
const DISCHARGED = 'סיים טיפול';
const base = (over) => Object.assign({
  id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני',
  sessionsPerWeek: '{"פרטני":1}', status: ACTIVE, startDate: '2026-09-01'
}, over);
const plansById = (ctx) => Object.fromEntries(
  plain(ctx._getTreatmentPlans()).clients.map((r) => [r.clientId, r]));

/* ================================ A. schema ================================ */

test('A: plannedExitDate is appended after the stamps on Clients and on the tombstone literal', () => {
  const { ctx } = sandbox();
  const H = plain(ctx.CLIENTS_HEADERS);
  const R = plain(ctx.CLIENTS_REMOVED_HEADERS);
  // preferredHouse (position 38) was appended after it later — see
  // test/preferred-house.test.js.
  assert.equal(H.length, 38);
  assert.equal(H[36], 'plannedExitDate');
  assert.deepEqual(H.slice(-4), ['updatedAt', 'updatedBy', 'plannedExitDate', 'preferredHouse']);
  assert.deepEqual(R.slice(-2), ['plannedExitDate', 'preferredHouse']);
  assert.equal(H.indexOf('exitDate'), 8, 'existing exitDate column untouched');
  assert.equal(H.indexOf('phone'), 25, 'phone join key untouched');
});

/* ========================= B. getTreatmentPlans ============================ */

test('B: active client emits its planned exit date; blank when none', () => {
  const { ctx } = sandbox([], [
    base({ id: 'a', plannedExitDate: '2026-12-31' }),
    base({ id: 'b' })
  ]);
  const p = plansById(ctx);
  assert.equal(p.a.plannedExitDate, '2026-12-31');
  assert.equal(p.b.plannedExitDate, '');
});

test('B: a blank status reads as active (dashboard default)', () => {
  const { ctx } = sandbox([], [base({ id: 'a', status: '', plannedExitDate: '2027-01-15' })]);
  assert.equal(plansById(ctx).a.plannedExitDate, '2027-01-15');
});

test('B: non-active clients never emit a planned exit date', () => {
  const { ctx } = sandbox([], [
    base({ id: 'd', status: DISCHARGED, exitDate: '2026-10-01', plannedExitDate: '2026-12-31' }),
    base({ id: 'x', status: 'מוקפא', plannedExitDate: '2026-12-31' })
  ]);
  const p = plansById(ctx);
  assert.equal(p.d.plannedExitDate, '');
  assert.equal(p.d.exitDate, '2026-10-01', 'the actual exitDate is still projected');
  assert.equal(p.x.plannedExitDate, '');
});

test('B: an invalid stored value is emitted blank, never guessed', () => {
  const bad = ['2026-02-30', '31/12/2026', '2026-1-5', 'soon', '2026-12-31T00:00:00Z', 20261231];
  const { ctx } = sandbox([], bad.map((v, i) => base({ id: 'c' + i, plannedExitDate: v })));
  const p = plansById(ctx);
  bad.forEach((v, i) => assert.equal(p['c' + i].plannedExitDate, '', JSON.stringify(v)));
});

test('B: a Date cell (Sheets coercion) reads back as yyyy-MM-dd', () => {
  const { ctx, sheets } = sandbox([], [base({ id: 'a' })]);
  const col = plain(ctx.CLIENTS_HEADERS).indexOf('plannedExitDate');
  // a Date from the sandbox realm, so Code.gs's `instanceof Date` sees it
  sheets.Clients.grid[1][col] = vm.runInContext("new Date('2026-11-20T00:00:00Z')", ctx);
  assert.equal(plansById(ctx).a.plannedExitDate, '2026-11-20');
});

test('B: every existing field is unchanged — plannedExitDate is purely additive', () => {
  const row = base({ id: 'a', exitDate: '', nextBillingDate: '2026-11-01', plannedExitDate: '2026-12-31' });
  const { ctx } = sandbox([], [row]);
  const p = plansById(ctx).a;
  assert.deepEqual(p, {
    sourceApp: 'ezone-outpatient', clientId: 'a', name: 'אורי', phone: '0501234567',
    phoneIssue: '', serviceType: 'פרטני', sessions: '{"פרטני":1}', status: ACTIVE,
    startDate: '2026-09-01', exitDate: '', renewalDate: '2026-11-01',
    plannedExitDate: '2026-12-31'
  });
});

test('B: the endpoint stays behind its fail-closed shared secret', () => {
  const { ctx, props } = sandbox([], [base({ plannedExitDate: '2026-12-31' })]);
  const get = (secret) => JSON.parse(ctx.doGet({ parameter: { action: 'getTreatmentPlans', secret } }).getContent());
  assert.equal(get('x').ok, false, 'unset secret rejects');
  props.TREATMENT_PLANS_SECRET = 's3cret';
  assert.equal(get('wrong').error, 'unauthorized');
  assert.equal(get('s3cret').clients[0].plannedExitDate, '2026-12-31');
});

/* ============================== C. _saveAll ================================ */

test('C: a valid date is saved; an explicit blank clears it', () => {
  const sb = sandbox([], [base()]);
  assert.equal(sb.save([], [base({ plannedExitDate: '2026-12-31' })]).ok, true);
  assert.equal(sb.rows('Clients')[0].plannedExitDate, '2026-12-31');
  assert.equal(sb.save([], [base({ plannedExitDate: '' })]).ok, true);
  assert.equal(sb.rows('Clients')[0].plannedExitDate, '');
});

test('C: invalid input is stored blank (boundary validation)', () => {
  for (const v of ['2026-13-01', '2026-02-29', 'DROP TABLE', '=HYPERLINK("x")', '12/31/2026', 42, null]) {
    const sb = sandbox([], [base()]);
    assert.equal(sb.save([], [base({ plannedExitDate: v })]).ok, true);
    assert.equal(sb.rows('Clients')[0].plannedExitDate, '', JSON.stringify(v));
  }
});

test('C: a payload WITHOUT the key (pre-column tab) keeps the sheet value and is not an edit', () => {
  const sb = sandbox([], [base({ plannedExitDate: '2026-12-31', updatedAt: '2026-10-01T00:00:00.000Z' })]);
  const before = sb.rows('Clients')[0];
  const res = sb.save([], [Object.assign({}, before, { plannedExitDate: undefined })]);
  assert.equal(res.ok, true);
  const after = sb.rows('Clients')[0];
  assert.equal(after.plannedExitDate, '2026-12-31');
  assert.equal(after.updatedAt, '2026-10-01T00:00:00.000Z', 'unchanged echo is not re-stamped');
});

test('C: a brand-new client without the key gets a blank value', () => {
  const sb = sandbox([], []);
  assert.equal(sb.save([], [base({ id: 'n1' })]).ok, true);
  assert.equal(sb.rows('Clients')[0].plannedExitDate, '');
});

test('C: changing only plannedExitDate stamps the row (it is a content column)', () => {
  const sb = sandbox([], [base({ updatedAt: '2026-10-01T00:00:00.000Z' })]);
  const echo = sb.rows('Clients')[0];
  assert.equal(sb.save([], [Object.assign({}, echo, { plannedExitDate: '2027-02-01' })]).ok, true);
  const after = sb.rows('Clients')[0];
  assert.equal(after.plannedExitDate, '2027-02-01');
  assert.notEqual(after.updatedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(after.updatedBy, 'fixture-user');
});

test('C: _isoDateOrBlank accepts only real yyyy-MM-dd calendar dates', () => {
  const { ctx } = sandbox();
  assert.equal(ctx._isoDateOrBlank('2028-02-29'), '2028-02-29', 'leap day');
  assert.equal(ctx._isoDateOrBlank(' 2026-12-31 '), '2026-12-31', 'trimmed');
  for (const v of ['2027-02-29', '2026-04-31', '0000-00-00', '', undefined, null, {}, '2026-12-31x']) {
    assert.equal(ctx._isoDateOrBlank(v), '', JSON.stringify(v));
  }
});

/* ================================= D. UI =================================== */

test('D: the edit-client modal has a date input for the planned exit date', () => {
  const form = HTML.slice(HTML.indexOf('<form id="editClientForm"'), HTML.indexOf('</form>', HTML.indexOf('<form id="editClientForm"')));
  assert.match(form, /תאריך סיום מתוכנן<input name="plannedExitDate" type="date" \/>/);
});

test('D: app.js loads, prefills, saves (set or clear) and rolls back plannedExitDate', () => {
  assert.match(APP, /plannedExitDate: fmtDate\(row\.plannedExitDate\)/, 'read from sheet');
  assert.match(APP, /plannedExitDate: c\.plannedExitDate \|\| ''/, 'always sent on save');
  assert.match(APP, /form\.plannedExitDate\.value = client\.plannedExitDate \|\| ''/, 'prefilled');
  assert.match(APP, /plannedExitDate: client\.plannedExitDate\n\s*\};/, 'captured in prev for rollback');
  assert.match(APP, /client\.plannedExitDate = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(ped\) \? ped : ''/, 'validated on submit');
});

test('D: the card shows the planned exit date only when set, HTML-escaped', () => {
  assert.match(APP, /var plannedExitRow = c\.plannedExitDate\s*\n?\s*\? '<div class="cc-line"><span class="cc-k">סיום מתוכנן<\/span><span class="cc-v">' \+ escapeHtml\(displayDate\(c\.plannedExitDate\)\)/);
  assert.match(APP, /hooRow \+\n\s*plannedExitRow \+/);
});

test('D: exitDate (actual discharge) handling is untouched', () => {
  assert.match(APP, /client\.exitDate = fd\.get\('exitDate'\) \|\| today\(\);/);
  assert.match(GS, /exitDate:\s+cl\.exitDate \|\| '',/);
});
