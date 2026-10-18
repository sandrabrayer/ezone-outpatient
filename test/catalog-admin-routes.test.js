'use strict';
/* Vered-only gateway (/api/catalog-admin/*) end to end through the real Express
 * app, with the real Code.gs (vm) standing in for Apps Script.
 * Proves: a picked display name / session / sessionStorage never grants the
 * privilege; the PIN is server-verified, rate limited and mints a short-lived,
 * scoped, HttpOnly cookie; every private action is reachable ONLY through the
 * rpc route; the generic /api/sheets proxy is closed for them; the upstream
 * body is rebuilt from an allowlist with a server-derived actor and a body-bound
 * assertion that Code.gs itself verifies. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PORT = 31852;
const APP_PIN = '424242';
const ADMIN_PIN = '91372468';
const SESSION_SECRET = 'test-session-secret-catalog-admin-0123456789';
const PROXY = 'fixture-proxy-key-with-at-least-32-characters';
const ASSERT = 'catalog-admin-assertion-secret-0123456789-C';
const CAT = 'package-catalog-secret-0123456789abcdef-A';
const REQ = 'package-request-secret-0123456789abcdef-B';
Object.assign(process.env, {
  PORT: String(PORT), APP_PIN, SESSION_SECRET, OUTPATIENT_PROXY_SECRET: PROXY,
  CATALOG_ADMIN_PIN: ADMIN_PIN, CATALOG_ADMIN_ASSERTION_SECRET: ASSERT,
  SHEETS_URL: 'https://script.example.com/macros/s/AKfycbDUMMY/exec'
});
delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;

const { sandbox } = require('../test-support/apps-script-sandbox');
const { createSessionToken } = require('../lib/session');
const catalogAdmin = require('../lib/catalog-admin');

const sb = sandbox();
Object.assign(sb.props, { PACKAGE_CATALOG_SECRET: CAT, PACKAGE_REQUEST_SECRET: REQ, CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
let upstream = [];            // every body Node sent to "Apps Script"
let upstreamMode = 'sandbox'; // or 'throw' | 'html'
global.fetch = async (_url, init) => {
  upstream.push(JSON.parse(init.body));
  if (upstreamMode === 'throw') throw new Error('connect ECONNREFUSED 10.0.0.9 secret=' + PROXY);
  if (upstreamMode === 'html') return { status: 200, text: async () => '<html>Sign in ' + PROXY + '</html>' };
  const out = sb.ctx.doPost({ postData: { contents: init.body }, parameter: {} }).getContent();
  return { status: 200, text: async () => out };
};

const server = require('../server');
let httpServer;
test.before(() => { httpServer = server.start(PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

function request(method, urlPath, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {}) },
    (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch (_) {} resolve({ status: res.statusCode, json, body: d, headers: res.headers }); });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
async function ready() { for (let i = 0; i < 50; i++) { try { await request('GET', '/healthz'); return; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } } throw new Error('no listen'); }
const sessions = {};   // memoized: the admin privilege is bound to the exact base-cookie value
const sess = (user = 'ורד') => (sessions[user] = sessions[user] || ('ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, user)));
let ipN = 0;
const freshIp = () => ({ 'x-forwarded-for': '10.1.0.' + (++ipN) });
const loginWith = (user, pin = ADMIN_PIN, extra) => request('POST', '/api/catalog-admin/login', { pin }, { Cookie: sess(user), ...freshIp(), ...(extra || {}) });
const adminTok = (r) => r.headers['set-cookie'][0].split(';')[0];
const admins = {};     // user -> "session; admin" cookie header, from a REAL login
async function adminFor(user = 'ורד') {
  if (!admins[user]) {
    const r = await loginWith(user);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    admins[user] = sess(user) + '; ' + adminTok(r);
  }
  return admins[user];
}
const both = adminFor;
const rpc = async (op, extra, cookie, headers) => request('POST', '/api/catalog-admin/rpc', { op, ...extra }, { Cookie: cookie || await adminFor(), ...(headers || {}) });

test('privilege: a session (any display name) is NOT admin; status reports admin:false until the PIN is verified', async () => {
  await ready();
  assert.equal((await request('GET', '/api/catalog-admin/status')).status, 401);
  for (const u of ['ורד', 'שירן', 'יעל']) {
    const s = await request('GET', '/api/catalog-admin/status', null, { Cookie: sess(u) });
    assert.deepEqual(s.json, { ok: true, configured: true, admin: false });
    const r = await rpc('catalog', {}, sess(u));
    assert.equal(r.status, 401, 'name "' + u + '" must not unlock pricing');
    assert.equal(r.json.error, 'admin_required');
  }
  // an UNNAMED (legacy) session is refused outright, even before the PIN: pricing actions must be attributable
  const unnamed = await rpc('catalog', {}, sess(''));
  assert.equal(unnamed.status, 403); assert.equal(unnamed.json.error, 'named_session_required');
  assert.equal(upstream.length, 0, 'nothing reached Apps Script');
});

test('login: needs a session, verifies CATALOG_ADMIN_PIN server-side, mints a short-lived scoped HttpOnly cookie', async () => {
  assert.equal((await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, freshIp())).status, 401, 'no session');
  const bad = await request('POST', '/api/catalog-admin/login', { pin: APP_PIN }, { Cookie: sess(), ...freshIp() });
  assert.equal(bad.status, 401, 'the shared APP_PIN is not the admin PIN');
  assert.equal(bad.headers['set-cookie'], undefined);
  const ok = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: sess(), ...freshIp() });
  assert.equal(ok.status, 200);
  const sc = ok.headers['set-cookie'][0];
  assert.match(sc, /^ezone_catalog_admin=/);
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/api/catalog-admin', 'Max-Age=900']) assert.ok(sc.includes(part), part);
  assert.equal(ok.headers['cache-control'], 'no-store');
  const tok = sc.split(';')[0];
  const st = await request('GET', '/api/catalog-admin/status', null, { Cookie: sess() + '; ' + tok });
  assert.equal(st.json.admin, true);
  admins['ורד'] = sess() + '; ' + tok;
  assert.ok(!ok.body.includes(ADMIN_PIN));
});

test('login: failures are limited PER SESSION; a colleague\'s wrong guesses never lock Vered out; a correct PIN is never counted', async () => {
  const office = { 'x-forwarded-for': '10.9.9.9' };               // one shared office address
  // another session (a colleague / an attacker who knows APP_PIN) burns its own budget
  for (let i = 0; i < 5; i++) assert.equal((await request('POST', '/api/catalog-admin/login', { pin: 'wrong' + i }, { Cookie: sess('יעל'), ...office })).status, 401);
  const blocked = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: sess('יעל'), ...office });
  assert.equal(blocked.status, 429, 'that session is paused');
  assert.ok(Number(blocked.headers['retry-after']) > 0 && blocked.json.retryAfterSec > 0, 'the wait is reported');
  // Vered, same office address, other session: unaffected
  const vered = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: sess('שירן'), ...office });
  assert.equal(vered.status, 200, 'a shared address is not a lock-out');
  // typos then success: success resets her session counter, correct attempts are not counted
  for (let i = 0; i < 4; i++) await request('POST', '/api/catalog-admin/login', { pin: 'typo' + i }, { Cookie: sess('ורד'), ...freshIp() });
  assert.equal((await loginWith('ורד')).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await loginWith('ורד', 'typo' + i)).status, 401);
  assert.equal((await loginWith('ורד')).status, 200, '4 typos after a success do not block');
  admins['ורד'] = undefined; admins['שירן'] = undefined;
});

test('limiter unit: failure-only, session/ip/global scopes, windows expire, success resets the session', () => {
  let t = 0;
  const lim = catalogAdmin.createFailureLimiter({ sessionMax: 3, ipMax: 5, globalMax: 8, windowMs: 1000, now: () => t });
  assert.equal(lim.check('a', 'ip1').allowed, true);
  for (let i = 0; i < 3; i++) lim.fail('a', 'ip1');
  const b1 = lim.check('a', 'ip1'); assert.deepEqual([b1.allowed, b1.scope], [false, 'session']); assert.ok(b1.retryAfterSec >= 1);
  assert.equal(lim.check('b', 'ip1').allowed, true, 'another session on the same address still works');
  lim.fail('b', 'ip1'); lim.fail('c', 'ip1');
  const b2 = lim.check('d', 'ip1'); assert.deepEqual([b2.allowed, b2.scope], [false, 'ip']);
  for (let i = 0; i < 3; i++) lim.fail('e' + i, 'ipX' + i);
  const b3 = lim.check('z', 'ipZ'); assert.deepEqual([b3.allowed, b3.scope], [false, 'global']);
  t = 2000; assert.equal(lim.check('a', 'ip1').allowed, true, 'window expires');
  lim.fail('s', 'i'); lim.fail('s', 'i'); lim.success('s'); lim.fail('s', 'i');
  assert.equal(lim.check('s', 'iq').allowed, true, 'success reset the session counter');
});

test('unnamed / retired sessions cannot log in to pricing; the PIN is not even evaluated', async () => {
  const r = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: sess(''), ...freshIp() });
  assert.equal(r.status, 403); assert.equal(r.json.error, 'named_session_required');
  assert.equal(r.headers['set-cookie'], undefined);
  const retired = 'ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, 'ירדן');
  const rr = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: retired, ...freshIp() });
  assert.equal(rr.status, 401, 'a retired user is refused by the session gate');
  assert.equal(rr.headers['set-cookie'], undefined);
});

test('cookie scope + binding: an admin cookie works ONLY with the session it was minted for', async () => {
  const mine = await adminFor('ורד');
  const myAdminCookie = mine.split('; ')[1];
  assert.equal((await rpc('catalog', {}, mine)).status, 200);
  // not a session; a session is not an admin cookie
  assert.equal((await request('GET', '/api/me', null, { Cookie: 'ezone_session=' + myAdminCookie.split('=')[1] })).status, 401);
  assert.equal((await rpc('catalog', {}, sess() + '; ' + catalogAdmin.ADMIN_COOKIE + '=' + sess().split('=')[1])).status, 401);
  // another user's session + Vered's admin cookie (copied) -> refused
  const stolen = await rpc('catalog', {}, sess('שירן') + '; ' + myAdminCookie);
  assert.equal(stolen.status, 401); assert.equal(stolen.json.error, 'admin_required');
  // a DIFFERENT session of the same name (e.g. a new login elsewhere) + the copied cookie -> refused
  const other = 'ezone_session=' + createSessionToken(SESSION_SECRET, 7 * 24 * 3600 + 5, undefined, 'ורד');
  assert.notEqual(other, sess());
  assert.equal((await rpc('catalog', {}, other + '; ' + myAdminCookie)).status, 401, 'bound to the exact session');
  // forged / unrecorded sid, expired, tampered, foreign secret, no session
  const forged = catalogAdmin.ADMIN_COOKIE + '=' + createSessionToken(SESSION_SECRET, undefined, catalogAdmin.ADMIN_SCOPE, 'never-created-sid');
  assert.equal((await rpc('catalog', {}, sess() + '; ' + forged)).status, 401, 'a correctly signed token with no server record is useless');
  const noSid = catalogAdmin.ADMIN_COOKIE + '=' + createSessionToken(SESSION_SECRET, undefined, catalogAdmin.ADMIN_SCOPE);
  assert.equal((await rpc('catalog', {}, sess() + '; ' + noSid)).status, 401, 'old unbound format refused');
  assert.equal((await rpc('catalog', {}, sess() + '; ' + myAdminCookie.slice(0, -2) + '00')).status, 401, 'tampered');
  assert.equal((await rpc('catalog', {}, myAdminCookie)).status, 401, 'admin cookie without a session');
  const foreign = catalogAdmin.ADMIN_COOKIE + '=' + createSessionToken('another-secret-0123456789abcdef-xyz', undefined, catalogAdmin.ADMIN_SCOPE, 'x');
  assert.equal((await rpc('catalog', {}, sess() + '; ' + foreign)).status, 401);
});

test('server-side revocation: /api/catalog-admin/logout and /api/logout kill a COPIED cookie immediately', async () => {
  const mk = (user, n) => 'ezone_session=' + createSessionToken(SESSION_SECRET, 7 * 24 * 3600 + n, undefined, user);
  const enter = async (n) => { const c = mk('שירן', n); const r = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: c, ...freshIp() }); assert.equal(r.status, 200, JSON.stringify(r.json)); return c + '; ' + adminTok(r); };
  const c1 = await enter(11);
  assert.equal((await rpc('catalog', {}, c1)).status, 200);
  const out = await request('POST', '/api/catalog-admin/logout', {}, { Cookie: c1 });
  assert.equal(out.status, 200);
  assert.equal((await rpc('catalog', {}, c1)).status, 401, 'the cookie the browser "cleared" is dead on the server too');
  assert.equal((await request('GET', '/api/catalog-admin/status', null, { Cookie: c1 })).json.admin, false);
  // base logout also ends the privilege and clears both cookies
  const c2 = await enter(12);
  assert.equal((await rpc('catalog', {}, c2)).status, 200);
  const base = await request('POST', '/api/logout', {}, { Cookie: c2 });
  const cleared = base.headers['set-cookie'].join('|');
  assert.ok(/ezone_session=;/.test(cleared) && /ezone_catalog_admin=;/.test(cleared));
  assert.equal((await rpc('catalog', {}, c2)).status, 401, 'an attacker replaying the old pair after logout gets nothing');
  // a logout by someone else (no matching pair) cannot revoke Vered
  const vered = await adminFor('ורד');
  await request('POST', '/api/catalog-admin/logout', {}, { Cookie: mk('שירן', 13) });
  assert.equal((await rpc('catalog', {}, vered)).status, 200, 'unrelated logout leaves Vered logged in');
});

test('a re-login replaces the previous admin session; the restart-style wipe fails closed (unit)', () => {
  let now = 1000;
  const st = catalogAdmin.createAdminSessions({ ttlMs: 5000, max: 2, now: () => now });
  const a = st.create('b1', 'ורד'), b = st.create('b1', 'ורד');
  assert.equal(st.valid(a, 'b1', 'ורד'), false, 'one live admin session per base session');
  assert.equal(st.valid(b, 'b1', 'ורד'), true);
  assert.equal(st.valid(b, 'b2', 'ורד'), false, 'wrong session'); assert.equal(st.valid(b, 'b1', 'שירן'), false, 'wrong user');
  assert.equal(st.create('', 'ורד'), ''); assert.equal(st.create('b1', ''), '');
  now += 6000; assert.equal(st.valid(b, 'b1', 'ורד'), false, 'expires (absolute, not sliding)');
  st.create('x1', 'ורד'); st.create('x2', 'ורד'); st.create('x3', 'ורד'); assert.ok(st.size() <= 2, 'bounded');
  assert.equal(st.revokeByBinding('x3'), 1);
});

test('rpc end to end: Node signs, Code.gs verifies; actor comes from the session, never the browser; allowlist rebuild', async () => {
  upstream = [];
  assert.equal(sb.rows('PackageCatalog').length, 0);
  const seed = await rpc('seed', {}, await adminFor('ורד'));
  assert.equal(seed.json.ok, true, JSON.stringify(seed.json));
  const sent = upstream[0];
  assert.equal(sent.action, 'adminSeedPackageCatalog');
  assert.equal(sent.proxySecret, PROXY);
  assert.equal(sent.user, 'ורד', 'actor is the signed session name');
  assert.match(sent.adminAssertion, /^v1\.\d+\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  assert.equal(sb.rows('PackageCatalog').length, 15);

  const cat = await rpc('catalog', {}, await adminFor('שירן'));
  assert.equal(cat.json.items.length, 15);
  assert.equal(upstream[upstream.length - 1].user, 'שירן');

  // browser-supplied authority fields are rejected, not trusted
  for (const field of ['user', 'actor', 'actorKey', 'actorRole', 'role', 'requesterKey', 'isAdmin', 'catalogAdmin', 'adminAssertion', 'proxySecret', 'secret', 'action']) {
    const n = upstream.length;
    const r = await rpc('catalog', { [field]: 'ורד' });
    assert.equal(r.status, 400, field);
    assert.equal(r.json.error, 'forbidden_field');
    assert.equal(upstream.length, n, field + ' never reached Apps Script');
  }
  assert.equal((await rpc('nope')).json.error, 'unknown_op');
  assert.equal((await rpc('catalog; adminSeedPackageCatalog')).status, 400);

  // unknown extra keys are dropped before signing
  await rpc('quote', { packageKey: 'emdr_core', evil: 'x', nested: { a: 1 } });
  const q = upstream[upstream.length - 1];
  assert.deepEqual(Object.keys(q).sort(), ['action', 'adminAssertion', 'packageKey', 'proxySecret', 'user']);
  // a request-list / approve through the gateway behaves like the direct call
  const r = await rpc('quote', { packageKey: 'solo_housing', months: 3, selectedMonthlyAgorot: 900000 });
  assert.equal(r.json.quote.grossAgorot, 2700000);
});

test('rpc: the assertion is bound to the body — a replayed assertion with altered fields is refused by Code.gs', async () => {
  upstream = [];
  await rpc('quote', { packageKey: 'emdr_core' });
  const sent = upstream[0];
  const replay = JSON.parse(sb.ctx.doPost({ postData: { contents: JSON.stringify({ ...sent, packageKey: 'cbt_core' }) }, parameter: {} }).getContent());
  assert.deepEqual(replay, { ok: false, error: 'unauthorized' });
  const ok = JSON.parse(sb.ctx.doPost({ postData: { contents: JSON.stringify(sent) }, parameter: {} }).getContent());
  assert.equal(ok.ok, true, 'unchanged body still verifies (idempotent reads)');
});

test('rpc: upstream failures are sanitized (502 upstream_unavailable) — no URL, secret or HTML leaks', async () => {
  for (const mode of ['throw', 'html']) {
    upstreamMode = mode;
    const r = await rpc('catalog');
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { ok: false, error: 'upstream_unavailable' });
    assert.ok(!r.body.includes(PROXY) && !r.body.includes('ECONN') && !r.body.includes('<html'));
  }
  upstreamMode = 'sandbox';
});

test('bypass closed: every package/admin action is refused on the generic /api/sheets proxy, even with admin + session', async () => {
  upstream = [];
  const actions = ['adminGetPackageCatalog', 'adminSeedPackageCatalog', 'adminSavePackageCatalogRow', 'adminQuotePackage',
    'adminListPackageRequests', 'adminAdjustPackageRequest', 'adminApprovePackageRequest', 'adminAttachPackageRequest',
    'getPackageCatalogPublic', 'getPackageRequestStatus', 'createPackageRequest', 'adminAnythingElse', 'ADMINGETPACKAGECATALOG'];
  for (const a of actions) {
    const g = await request('GET', '/api/sheets?action=' + encodeURIComponent(a), null, { Cookie: await adminFor() });
    assert.equal(g.status, 403, 'GET ' + a);
    assert.equal(g.json.error, 'forbidden_action');
    const p = await request('POST', '/api/sheets', { action: a, requestId: crypto.randomUUID() }, { Cookie: await adminFor() });
    assert.equal(p.status, 403, 'POST ' + a);
  }
  for (const f of ['adminAssertion', 'actor', 'actorKey', 'actorRole', 'requesterKey', 'catalogAdmin', 'isAdmin']) {
    const p = await request('POST', '/api/sheets', { action: 'saveAll', [f]: 'x', leads: [], clients: [] }, { Cookie: sess() });
    assert.equal(p.status, 400, f);
    assert.equal(p.json.error, 'forbidden_field');
  }
  assert.equal(upstream.length, 0, 'nothing reached Apps Script');
});

test('logout clears the admin cookie (Path-scoped) and needs no credential', async () => {
  const r = await request('POST', '/api/catalog-admin/logout', {});
  assert.equal(r.status, 200);
  const sc = r.headers['set-cookie'][0];
  assert.match(sc, /^ezone_catalog_admin=;/);
  assert.ok(sc.includes('Max-Age=0') && sc.includes('Path=/api/catalog-admin') && sc.includes('HttpOnly'));
});

test('config: fail closed unless PIN (8-32, != APP_PIN) and a distinct >=32 char assertion secret are set', () => {
  const base = { SESSION_SECRET: 's'.repeat(40), APP_PIN: '87654321', OUTPATIENT_PROXY_SECRET: 'p'.repeat(40), CATALOG_ADMIN_PIN: '91372468', CATALOG_ADMIN_ASSERTION_SECRET: 'a'.repeat(40) };
  assert.equal(catalogAdmin.adminConfigStatus(base).ok, true);
  const bad = (over) => catalogAdmin.adminConfigStatus({ ...base, ...over });
  assert.equal(bad({ CATALOG_ADMIN_PIN: '' }).reason, 'pin_not_configured');
  assert.equal(bad({ CATALOG_ADMIN_PIN: '123' }).reason, 'pin_not_configured');
  assert.equal(bad({ CATALOG_ADMIN_PIN: '1234567' }).reason, 'pin_not_configured', 'minimum length is 8');
  assert.equal(bad({ CATALOG_ADMIN_PIN: '87654321' }).reason, 'pin_must_differ_from_app_pin');
  assert.equal(bad({ CATALOG_ADMIN_ASSERTION_SECRET: 'short' }).reason, 'assertion_secret_not_configured');
  assert.equal(bad({ CATALOG_ADMIN_ASSERTION_SECRET: base.OUTPATIENT_PROXY_SECRET }).reason, 'assertion_secret_must_be_distinct');
  assert.equal(bad({ SESSION_SECRET: '' }).reason, 'session_not_configured');
});

test('unconfigured deploy: every admin route answers 503 and nothing is reachable (child process, no admin env)', () => {
  const script = `
    process.env.PORT='31853'; process.env.APP_PIN='424242'; process.env.SESSION_SECRET=${JSON.stringify(SESSION_SECRET)};
    process.env.OUTPATIENT_PROXY_SECRET=${JSON.stringify(PROXY)}; process.env.SHEETS_URL='https://x.example/exec';
    delete process.env.CATALOG_ADMIN_PIN; delete process.env.CATALOG_ADMIN_ASSERTION_SECRET;
    global.fetch = async () => { throw new Error('must not be called'); };
    const http=require('http'); const s=require('./server'); const {createSessionToken}=require('./lib/session');
    const h=s.start(31853); const c='ezone_session='+createSessionToken(process.env.SESSION_SECRET);
    const call=(m,p,b)=>new Promise(r=>{const q=http.request({host:'127.0.0.1',port:31853,path:p,method:m,headers:{Cookie:c,'Content-Type':'application/json'}},x=>{let d='';x.on('data',k=>d+=k);x.on('end',()=>r([x.statusCode,d]));});q.end(b?JSON.stringify(b):undefined);});
    (async()=>{ await new Promise(r=>setTimeout(r,300)); const out=[];
      out.push(await call('GET','/api/catalog-admin/status'));
      out.push(await call('POST','/api/catalog-admin/login',{pin:'91372468'}));
      out.push(await call('POST','/api/catalog-admin/rpc',{op:'catalog'}));
      console.log(JSON.stringify(out)); h.close(); process.exit(0); })();`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(JSON.parse(out[0][1]), { ok: true, configured: false, admin: false });
  assert.equal(out[1][0], 503);
  assert.equal(out[2][0], 503);
  assert.match(out[2][1], /catalog_admin_not_configured/);
});
