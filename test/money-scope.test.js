'use strict';

/* OP-CRM-3A — server-side money scope.
 *   lib/money-scope.js (pure): scope per name (fail closed), action lists,
 *   deep strip.
 *   server.js (real app, mocked upstream): ורד / אורן get money; דנה never —
 *   on fresh, cached (HIT) and stale responses, on money actions (403 before
 *   any upstream call), on the pay-constants static file, on /api/me; a
 *   browser-supplied moneyScope is refused; the server stamps the scope on
 *   every write; invalid / unnamed sessions get nothing.
 *   Code.gs (sandbox): an 'ops' saveAll keeps the sheet's money fields on
 *   existing rows and blanks them on new rows; a 'full' save behaves as before;
 *   the flag cannot be smuggled past the proxy. */

process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TEST_PORT = 31891;
const DUMMY_PIN = '424242';
const SHEETS = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.USER_PIN_OREN = '515151';
process.env.USER_PIN_DANA = '626262';
process.env.SHEETS_URL = SHEETS;
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;
const PIN_OF = { 'ורד': DUMMY_PIN, 'אורן': '515151', 'דנה': '626262' };

const MS = require('../lib/money-scope');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const DATA = { ok: true, dataVersion: 7,
  leads: [{ id: 'L1', name: 'ליד', phone: '0501111111', stage: 'new', pricePerSession: 900 }],
  clients: [{ id: 'C1', name: 'מטופל', phone: '0502222222', status: 'פעיל', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, bundleSize: '', bundlePrice: '', bundlePaid: '', paymentStatus: 'unpaid', paymentDate: '', nextBillingDate: '2026-11-05', creditsOwed: 1, paymentAmountOverrides: '{}', paymentLink: 'https://pay.example', payerName: 'אמא', payerPhone: '0503333333', nested: { amountOwed: 5, keep: 1 } }]
};
const calls = [];
let upstream = () => ({ status: 200, body: DATA });
let failUpstream = false;
global.fetch = async (url, init) => {
  if (failUpstream) throw new Error('down');
  const u = new URL(String(url));
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push({ action: body ? body.action : u.searchParams.get('action'), body });
  const r = upstream(body, u);
  return { status: r.status, text: async () => JSON.stringify(r.body) };
};
const server = require('../server');
let httpServer;
test.before(() => { httpServer = server.start(TEST_PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

function request(method, urlPath, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: TEST_PORT, path: urlPath, method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {}) },
    (res) => { let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, json, text: data, headers: res.headers }); }); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const cookies = {};
async function login(user) {
  if (cookies[user]) return cookies[user];
  for (let i = 0; i < 50; i++) { try { await request('GET', '/healthz'); break; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } }
  const res = await request('POST', '/api/verify-pin', { pin: PIN_OF[user], user });
  assert.equal(res.status, 200, user + ' login');
  cookies[user] = (res.headers['set-cookie'] || [])[0].split(';')[0];
  return cookies[user];
}
const H = (c) => ({ Cookie: c });
const hasMoney = (obj) => JSON.stringify(obj).match(/pricePerSession|billingType|paymentStatus|creditsOwed|paymentLink|amountOwed|nextBillingDate/) !== null;

/* ---------- pure ---------- */
test('lib: scope per name, fail closed for blank / unknown / retired', () => {
  assert.equal(MS.scopeOf('ורד'), 'full');
  assert.equal(MS.scopeOf('אורן'), 'full');
  assert.equal(MS.scopeOf('דנה'), 'ops');
  assert.equal(MS.scopeOf(' דנה '), 'ops');
  for (const u of ['', null, undefined, 'ירדן', 'שירן', 'מישהו', 'Vered']) assert.equal(MS.scopeOf(u), 'ops', JSON.stringify(u));
  assert.equal(MS.isMoneyAction('GET', 'getPayments'), true);
  assert.equal(MS.isMoneyAction('GET', 'getData'), false);
  assert.equal(MS.isMoneyAction('POST', 'savePayment'), true);
  assert.equal(MS.isMoneyAction('POST', 'saveAll'), false);
  assert.equal(MS.isMoneyAction('POST', 'saveContinuation'), false);
});

test('lib: stripMoney removes money keys at any depth and keeps everything else', () => {
  const out = MS.stripMoney(DATA);
  assert.equal(hasMoney(out), false);
  assert.equal(out.clients[0].name, 'מטופל');
  assert.equal(out.clients[0].payerName, 'אמא', 'payer contact is not an amount');
  assert.equal(out.clients[0].nested.keep, 1);
  assert.equal(out.leads[0].stage, 'new');
  assert.equal(out.dataVersion, 7);
  assert.equal(hasMoney(DATA), true, 'input untouched');
});

/* ---------- routes ---------- */
test('routes: ורד and אורן receive money on getData; דנה never — fresh, cached HIT and stale', async () => {
  const v = await login('ורד'), o = await login('אורן'), d = await login('דנה');
  calls.length = 0; upstream = () => ({ status: 200, body: DATA });
  let r = await request('GET', '/api/sheets?action=getData&fresh=1', null, H(v));
  assert.equal(r.status, 200); assert.equal(r.headers['x-cache'], 'MISS'); assert.equal(hasMoney(r.json), true);
  r = await request('GET', '/api/sheets?action=getData', null, H(o));
  assert.equal(r.headers['x-cache'], 'HIT'); assert.equal(hasMoney(r.json), true);
  // the SAME cached object, projected for the ops session
  r = await request('GET', '/api/sheets?action=getData', null, H(d));
  assert.equal(r.status, 200); assert.equal(r.headers['x-cache'], 'HIT'); assert.equal(hasMoney(r.json), false);
  assert.equal(r.json.clients[0].name, 'מטופל');
  // fresh for ops
  r = await request('GET', '/api/sheets?action=getData&fresh=1', null, H(d));
  assert.equal(r.headers['x-cache'], 'MISS'); assert.equal(hasMoney(r.json), false);
  // ורד after the ops request still sees money (projection never mutates the cache)
  r = await request('GET', '/api/sheets?action=getData', null, H(v));
  assert.equal(hasMoney(r.json), true);
  // stale fallback: upstream down, cache older than TTL but usable
  await request('POST', '/api/debug/cache/clear', null, H(v));
  await request('GET', '/api/sheets?action=getData&fresh=1', null, H(v));
  failUpstream = true;
  r = await request('GET', '/api/sheets?action=getData&fresh=1', null, H(d));
  failUpstream = false;
  assert.equal(r.status, 200); assert.equal(r.headers['x-cache'], 'STALE'); assert.equal(hasMoney(r.json), false);
});

test('routes: money actions are 403 for דנה before any upstream call; allowed for ורד / אורן', async () => {
  const v = await login('ורד'), o = await login('אורן'), d = await login('דנה');
  upstream = () => ({ status: 200, body: { ok: true, payments: [{ amountDue: 1 }] } });
  for (const a of ['getPayments', 'getCharges', 'getCredits', 'getSessionLog', 'getSettings', 'getRenewalState']) {
    calls.length = 0;
    const r = await request('GET', '/api/sheets?action=' + a, null, H(d));
    assert.equal(r.status, 403, a); assert.equal(r.json.error, 'forbidden_money_action'); assert.equal(calls.length, 0, a + ' reached upstream');
  }
  for (const a of ['savePayment', 'saveCharge', 'saveCredit', 'savePaymentAmountOverride', 'saveSettings', 'mergeClients', 'applyRenewal', 'correctSessionOutcome', 'markForwarded']) {
    calls.length = 0;
    const r = await request('POST', '/api/sheets', { action: a, id: 'x' }, H(d));
    assert.equal(r.status, 403, a); assert.equal(calls.length, 0, a + ' reached upstream');
  }
  calls.length = 0;
  let r = await request('GET', '/api/sheets?action=getPayments', null, H(v));
  assert.equal(r.status, 200); assert.equal(r.json.payments[0].amountDue, 1);
  r = await request('GET', '/api/sheets?action=getPayments', null, H(o));
  assert.equal(r.status, 200); assert.equal(r.json.payments[0].amountDue, 1);
  r = await request('POST', '/api/sheets', { action: 'savePayment', id: 'x' }, H(v));
  assert.equal(r.status, 200);
});

test('routes: every write carries the SERVER-decided moneyScope; a browser-supplied one is refused; operational writes stay open to דנה', async () => {
  const v = await login('ורד'), d = await login('דנה');
  upstream = (body) => ({ status: 200, body: { ok: true, echo: body } });
  calls.length = 0;
  let r = await request('POST', '/api/sheets', { action: 'saveAll', leads: [], clients: [] }, H(d));
  assert.equal(r.status, 200); assert.equal(calls[0].body.moneyScope, 'ops'); assert.equal(calls[0].body.user, 'דנה');
  calls.length = 0;
  r = await request('POST', '/api/sheets', { action: 'saveAll', leads: [], clients: [] }, H(v));
  assert.equal(calls[0].body.moneyScope, 'full');
  calls.length = 0;
  r = await request('POST', '/api/sheets', { action: 'saveAll', leads: [], clients: [], moneyScope: 'full' }, H(d));
  assert.equal(r.status, 400); assert.equal(r.json.error, 'forbidden_field'); assert.equal(calls.length, 0);
  for (const a of ['saveContinuation', 'createStopAlert', 'resumeTreatmentAlert', 'removeLead', 'setPreferredHouse', 'approveExtraSession']) {
    calls.length = 0;
    // (saveContinuation is identity-validated elsewhere; here the roster proxy is unconfigured -> that route's own 500, never a money 403)
    r = await request('POST', '/api/sheets', { action: a, id: 'x' }, H(d));
    assert.notEqual(r.status, 403, a + ' must not be refused as money');
  }
  // the saveAll RESPONSE is projected too (it may echo rows)
  upstream = () => ({ status: 200, body: { ok: true, conflicts: [{ id: 'C1', pricePerSession: 1 }] } });
  r = await request('POST', '/api/sheets', { action: 'saveAll', leads: [], clients: [] }, H(d));
  assert.equal(hasMoney(r.json), false);
});

test('routes: pay-rate constants file is 403 for דנה, served to ורד / אורן; treatment-map stays available; /api/me reports the scope', async () => {
  const v = await login('ורד'), o = await login('אורן'), d = await login('דנה');
  let r = await request('GET', '/therapist-pay.js', null, H(d));
  assert.equal(r.status, 403);
  r = await request('GET', '/therapist-pay.js', null, H(v)); assert.equal(r.status, 200);
  r = await request('GET', '/therapist-pay.js', null, H(o)); assert.equal(r.status, 200);
  r = await request('GET', '/treatment-map.js', null, H(d)); assert.equal(r.status, 200);
  r = await request('GET', '/api/me', null, H(d)); assert.deepEqual(r.json, { ok: true, user: 'דנה', moneyScope: 'ops' });
  r = await request('GET', '/api/me', null, H(v)); assert.equal(r.json.moneyScope, 'full');
  r = await request('GET', '/api/me', null, H(o)); assert.equal(r.json.moneyScope, 'full');
});

test('routes: no session / invalid cookie / unnamed session get nothing (401), money or not', async () => {
  let r = await request('GET', '/api/sheets?action=getPayments'); assert.equal(r.status, 401);
  r = await request('GET', '/api/sheets?action=getData', null, { Cookie: 'ez_session=garbage' }); assert.equal(r.status, 401);
  r = await request('GET', '/therapist-pay.js'); assert.equal(r.status, 401);
  // PIN-stage (unnamed) cookie: data routes refuse; /api/me reports ops
  const res = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN });
  const unnamed = (res.headers['set-cookie'] || [])[0].split(';')[0];
  r = await request('GET', '/api/sheets?action=getData', null, H(unnamed)); assert.equal(r.status, 401);
  r = await request('GET', '/api/me', null, H(unnamed)); assert.equal(r.json.moneyScope, 'ops');
});

/* ---------- Code.gs ---------- */
const CL = { id: 'C1', name: 'מטופל', phone: '0502222222', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', startDate: '2026-10-01', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-11-05', paymentLink: 'https://pay.example', updatedAt: '2026-10-30T07:00:00.000Z' };
const LD = { id: 'L1', name: 'ליד', phone: '0501111111', stage: 'new', pricePerSession: 900, updatedAt: '2026-10-30T07:00:00.000Z' };

test('Code.gs: an ops saveAll keeps the stored money fields on existing rows and blanks them on new rows; full saves unchanged', () => {
  const sb = sandbox([LD], [CL]);
  // ops: tampered snapshot tries to zero the price and set a payment status
  const res = sb.post({ action: 'saveAll', user: 'דנה', moneyScope: 'ops',
    leads: [Object.assign({}, LD, { pricePerSession: 1 }), { id: 'L2', name: 'חדש', phone: '0504444444', stage: 'new', pricePerSession: 777 }],
    clients: [Object.assign({}, CL, { pricePerSession: 0, paymentStatus: 'paid', billingType: 'bundle', paymentLink: '' , notes: 'עדכון תפעולי' }),
      { id: 'C2', name: 'חדש', phone: '0505555555', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 999, paymentStatus: 'paid', billingType: 'monthly' }] });
  assert.equal(res.ok, true, JSON.stringify(res));
  const c = sb.rows('Clients');
  const c1 = c.find((r) => r.id === 'C1'), c2 = c.find((r) => r.id === 'C2');
  assert.equal(String(c1.pricePerSession), '2000'); assert.equal(c1.paymentStatus, 'unpaid'); assert.equal(c1.billingType, 'monthly'); assert.equal(c1.paymentLink, 'https://pay.example');
  assert.equal(c1.notes, 'עדכון תפעולי', 'the operational edit itself is saved');
  assert.equal(String(c2.pricePerSession), ''); assert.equal(c2.paymentStatus, ''); assert.equal(c2.billingType, '');
  const l = sb.rows('Leads');
  assert.equal(String(l.find((r) => r.id === 'L1').pricePerSession), '900');
  assert.equal(String(l.find((r) => r.id === 'L2').pricePerSession), '');
  // full: the same payload changes the price
  const sb2 = sandbox([LD], [CL]);
  sb2.post({ action: 'saveAll', user: 'ורד', moneyScope: 'full', leads: [LD], clients: [Object.assign({}, CL, { pricePerSession: 2500 })] });
  assert.equal(String(sb2.rows('Clients')[0].pricePerSession), '2500');
  // no scope at all (legacy / other callers): unchanged behaviour
  const sb3 = sandbox([LD], [CL]);
  sb3.post({ action: 'saveAll', user: 'ורד', leads: [LD], clients: [Object.assign({}, CL, { pricePerSession: 2600 })] });
  assert.equal(String(sb3.rows('Clients')[0].pricePerSession), '2600');
});

test('source guard: money lists mirror each other and the UI hides money for an ops session', () => {
  const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const gsClient = GS.match(/var OPS_CLIENT_MONEY_KEYS = \[([\s\S]*?)\];/)[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  for (const k of gsClient) assert.ok(MS.MONEY_KEYS.includes(k), k + ' preserved by Code.gs but not stripped by the proxy');
  assert.match(APP, /state\.moneyScope = data\.moneyScope === 'full' \? 'full' : 'ops'/);
  assert.match(APP, /function applyMoneyScopeUI\(\)/);
  assert.match(APP, /moneyScope: 'full', \/\/ OP-CRM-3A: server-decided/, 'UI flag is cosmetic; enforcement is server-side');
  for (const v of ['billing', 'revenue', 'payouts', 'packages']) assert.ok(APP.includes("'" + v + "'"), 'tab ' + v + ' handled');
  assert.match(APP, /therapist-pay\\\.js/, 'refused pay constants tolerated for ops');
});
