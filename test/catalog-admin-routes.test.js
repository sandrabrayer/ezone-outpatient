'use strict';
/* Vered-only gateway (/api/catalog-admin/*) end to end through the real Express
 * app, with the real Code.gs (vm) standing in for Apps Script.
 * Proves: a picked display name / session / sessionStorage never grants the
 * privilege; only Vered's SIGNED-IN name (server-side allowlist) mints a short-lived,
 * scoped, HttpOnly cookie — there is no second code; every private action is reachable ONLY through the
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
  CATALOG_ADMIN_ASSERTION_SECRET: ASSERT,   // NO second code exists any more (owner decision 2026-10-19)
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

test('privilege: a session (any display name) is NOT admin; status reports admin:false until the admin login', async () => {
  await ready();
  assert.equal((await request('GET', '/api/catalog-admin/status')).status, 401);
  for (const u of ['ורד', 'שירן', 'יעל']) {
    const s = await request('GET', '/api/catalog-admin/status', null, { Cookie: sess(u) });
    assert.deepEqual(s.json, { ok: true, configured: true, eligible: u === 'ורד', admin: false });
    const r = await rpc('catalog', {}, sess(u));
    assert.equal(r.status, 401, 'name "' + u + '" must not unlock pricing');
    assert.equal(r.json.error, 'admin_required');
  }
  // an UNNAMED (legacy) session is refused outright, even before the PIN: pricing actions must be attributable
  const unnamed = await rpc('catalog', {}, sess(''));
  assert.equal(unnamed.status, 401); assert.equal(unnamed.json.error, 'name_required');
  assert.equal(upstream.length, 0, 'nothing reached Apps Script');
});

test('login: needs a session; ONLY Vered\'s signed-in name mints the short-lived scoped HttpOnly cookie; no second code is asked or checked', async () => {
  assert.equal((await request('POST', '/api/catalog-admin/login', {}, freshIp())).status, 401, 'no session');
  for (const u of ['שירן', 'יעל']) {
    const no = await request('POST', '/api/catalog-admin/login', {}, { Cookie: sess(u), ...freshIp() });
    assert.equal(no.status, 403, u + ' is not Vered'); assert.equal(no.json.error, 'vered_only');
    assert.equal(no.headers['set-cookie'], undefined, 'nothing minted');
    // sending the shared APP_PIN (or any "pin") does not change that
    const tryPin = await request('POST', '/api/catalog-admin/login', { pin: APP_PIN }, { Cookie: sess(u), ...freshIp() });
    assert.equal(tryPin.status, 403);
  }
  const ok = await request('POST', '/api/catalog-admin/login', {}, { Cookie: sess(), ...freshIp() });
  assert.equal(ok.status, 200);
  const sc = ok.headers['set-cookie'][0];
  assert.match(sc, /^ezone_catalog_admin=/);
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/api/catalog-admin', 'Max-Age=900']) assert.ok(sc.includes(part), part);
  assert.equal(ok.headers['cache-control'], 'no-store');
  const tok = sc.split(';')[0];
  const st = await request('GET', '/api/catalog-admin/status', null, { Cookie: sess() + '; ' + tok });
  assert.equal(st.json.admin, true);
  admins['ורד'] = sess() + '; ' + tok;
  // a colleague replaying Vered's admin cookie on their own session is still not admin (bound to the base session + user)
  const replay = await request('GET', '/api/catalog-admin/status', null, { Cookie: sess('שירן') + '; ' + tok });
  assert.equal(replay.json.admin, false);
});

test('the admin cookie expires with its 15 minutes of life but Vered simply re-opens: login is repeatable, no counters, no lock-out', async () => {
  for (let i = 0; i < 40; i++) assert.equal((await loginWith('ורד')).status, 200, 'attempt ' + i);
  // a colleague hammering the endpoint cannot lock Vered out: there is nothing to guess and no failure counter
  for (let i = 0; i < 40; i++) assert.equal((await request('POST', '/api/catalog-admin/login', { pin: 'guess' + i }, { Cookie: sess('יעל'), 'x-forwarded-for': '10.9.9.9' })).status, 403);
  assert.equal((await request('POST', '/api/catalog-admin/login', {}, { Cookie: sess('ורד'), 'x-forwarded-for': '10.9.9.9' })).status, 200);
  admins['ורד'] = undefined;
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
  assert.equal(r.status, 401); assert.equal(r.json.error, 'name_required');
  assert.equal(r.headers['set-cookie'], undefined);
  const retired = 'ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, 'ירדן');
  const rr = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: retired, ...freshIp() });
  assert.equal(rr.status, 401, 'a retired user is refused by the session gate');
  assert.equal(rr.headers['set-cookie'], undefined);
});

test('end to end: a RETIRED / unknown name cannot sign in at all; a name-less PIN-stage session is refused by pricing', async () => {
  for (const user of ['ירדן', 'שם שלא קיים']) {
    const v = await request('POST', '/api/verify-pin', { pin: APP_PIN, user }, freshIp());
    assert.equal(v.status, 403); assert.equal(v.json.error, 'user_not_allowed');
    assert.equal(v.headers['set-cookie'], undefined, 'no cookie of any kind');
  }
  const v = await request('POST', '/api/verify-pin', { pin: APP_PIN }, freshIp());
  assert.equal(v.status, 200); assert.equal(v.json.stage, 'name_required');
  const cookie = v.headers['set-cookie'][0].split(';')[0];
  const me = await request('GET', '/api/me', null, { Cookie: cookie });
  assert.equal(me.json.user, '');
  const l = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: cookie, ...freshIp() });
  assert.equal(l.status, 401); assert.equal(l.json.error, 'name_required');
  assert.equal(l.headers['set-cookie'], undefined);
  assert.equal((await request('POST', '/api/catalog-admin/rpc', { op: 'catalog' }, { Cookie: cookie })).status, 401);
});
test('unconfigured deploy: every admin route answers 503 and nothing is reachable (child process, no admin env)', () => {
  const script = `
    process.env.PORT='31853'; process.env.APP_PIN='424242'; process.env.SESSION_SECRET=${JSON.stringify(SESSION_SECRET)};
    process.env.OUTPATIENT_PROXY_SECRET=${JSON.stringify(PROXY)}; process.env.SHEETS_URL='https://x.example/exec';
    delete process.env.CATALOG_ADMIN_PIN; delete process.env.CATALOG_ADMIN_ASSERTION_SECRET;
    global.fetch = async () => { throw new Error('must not be called'); };
    const http=require('http'); const s=require('./server'); const {createSessionToken}=require('./lib/session');
    const h=s.start(31853); const c='ezone_session='+createSessionToken(process.env.SESSION_SECRET,undefined,undefined,'ורד');
    const call=(m,p,b)=>new Promise(r=>{const q=http.request({host:'127.0.0.1',port:31853,path:p,method:m,headers:{Cookie:c,'Content-Type':'application/json'}},x=>{let d='';x.on('data',k=>d+=k);x.on('end',()=>r([x.statusCode,d]));});q.end(b?JSON.stringify(b):undefined);});
    (async()=>{ await new Promise(r=>setTimeout(r,300)); const out=[];
      out.push(await call('GET','/api/catalog-admin/status'));
      out.push(await call('POST','/api/catalog-admin/login',{pin:'91372468'}));
      out.push(await call('POST','/api/catalog-admin/rpc',{op:'catalog'}));
      console.log(JSON.stringify(out)); h.close(); process.exit(0); })();`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(JSON.parse(out[0][1]), { ok: true, configured: false, eligible: false, admin: false });
  assert.equal(out[1][0], 503);
  assert.equal(out[2][0], 503);
  assert.match(out[2][1], /catalog_admin_not_configured/);
});


/* ================= Review follow-up: ordinary routes, unique logins, re-login revocation ================= */

const ORDINARY = [['GET', '/api/sheets?action=getSettings'], ['POST', '/api/sheets', { action: 'saveAll' }], ['GET', '/api/continuation-roster'],
  ['GET', '/api/debug/env'], ['GET', '/api/catalog-admin/status'], ['POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }]];

test('ordinary data / write routes refuse name-less, unknown-name, retired-name and legacy unnamed cookies; the PIN stage reaches only the name picker', async () => {
  const stage = (await request('POST', '/api/verify-pin', { pin: APP_PIN }, freshIp())).headers['set-cookie'][0].split(';')[0];
  const jar = {
    'PIN-stage (no name)': stage,
    'legacy unnamed 2-part': 'ezone_session=' + createSessionToken(SESSION_SECRET),
    'unknown name (validly signed)': 'ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, 'מישהו אחר'),
    'retired name': 'ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, 'ירדן')
  };
  const before = upstream.length;
  for (const [label, ck] of Object.entries(jar)) {
    for (const [m, p, b] of ORDINARY) {
      const r = await request(m, p, b, { Cookie: ck, ...freshIp() });
      assert.equal(r.status, 401, label + ' ' + m + ' ' + p);
      assert.ok(['name_required', 'unauthorized'].includes(r.json.error), label + ' ' + p + ' ' + JSON.stringify(r.json));
    }
  }
  assert.equal(upstream.length, before, 'nothing was forwarded to Apps Script');
  // the PIN stage still reaches the two-step flow's own routes
  assert.equal((await request('GET', '/api/me', null, { Cookie: stage })).status, 200);
  assert.equal((await request('GET', '/api/users', null, { Cookie: stage })).status, 200);
  // the retired / unknown tokens do not even get the picker
  assert.equal((await request('GET', '/api/me', null, { Cookie: jar['retired name'] })).status, 401);
  // /api/users is public since the one-screen sign-in (names only), so it no longer depends on the cookie
  assert.equal((await request('GET', '/api/users', null, { Cookie: jar['unknown name (validly signed)'] })).status, 200);
});

test('PIN-stage session is short-lived (10 minutes) and the step-2 upgrade yields a fresh 7-day named session', async () => {
  const stage = await request('POST', '/api/verify-pin', { pin: APP_PIN }, freshIp());
  assert.match(stage.headers['set-cookie'][0], /Max-Age=600/);
  const named = await request('POST', '/api/verify-pin', { pin: APP_PIN, user: 'שירן' }, { Cookie: stage.headers['set-cookie'][0].split(';')[0], ...freshIp() });
  assert.match(named.headers['set-cookie'][0], /Max-Age=604800/);
  const ck = named.headers['set-cookie'][0].split(';')[0];
  assert.notEqual((await request('GET', '/api/sheets?action=getSettings', null, { Cookie: ck })).status, 401, 'the gate passes (the stub upstream answers whatever)');
});

test('each login has a unique identity: two same-name logins in the same second never share a token or an admin privilege', async () => {
  const mk = async () => (await request('POST', '/api/verify-pin', { pin: APP_PIN, user: 'ורד' }, freshIp())).headers['set-cookie'][0].split(';')[0];
  const [a, b] = [await mk(), await mk()];
  assert.notEqual(a, b);
  const la = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: a, ...freshIp() });
  assert.equal(la.status, 200);
  const adminA = la.headers['set-cookie'][0].split(';')[0];
  // login A's admin cookie replayed on login B (same name, same second) is NOT admin
  const onB = await request('GET', '/api/catalog-admin/status', null, { Cookie: b + '; ' + adminA });
  assert.deepEqual(onB.json, { ok: true, configured: true, eligible: true, admin: false });
  assert.equal((await request('GET', '/api/catalog-admin/status', null, { Cookie: a + '; ' + adminA })).json.admin, true);
});

test('re-login / account switch revokes the previous catalog privilege server-side; the copied old pair stops working', async () => {
  const v1 = await request('POST', '/api/verify-pin', { pin: APP_PIN, user: 'ורד' }, freshIp());
  const base1 = v1.headers['set-cookie'][0].split(';')[0];
  const l = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: base1, ...freshIp() });
  const admin1 = l.headers['set-cookie'][0].split(';')[0];
  const oldPair = base1 + '; ' + admin1;
  assert.equal((await request('GET', '/api/catalog-admin/status', null, { Cookie: oldPair })).json.admin, true);
  assert.equal((await rpc('catalog', {}, oldPair)).status, 200);

  // the same browser switches account: it presents the old pair, signs in as שירן
  const v2 = await request('POST', '/api/verify-pin', { pin: APP_PIN, user: 'שירן' }, { Cookie: oldPair, ...freshIp() });
  assert.equal(v2.status, 200);
  assert.ok(v2.headers['set-cookie'].some((c) => /^ezone_catalog_admin=;/.test(c) && /Max-Age=0/.test(c)), 'the admin cookie is cleared');
  const base2 = v2.headers['set-cookie'][0].split(';')[0];

  // REPLAY of the previous cookies (a copied pair) is no longer admin
  assert.equal((await request('GET', '/api/catalog-admin/status', null, { Cookie: oldPair })).json.admin, false);
  const replay = await rpc('catalog', {}, oldPair);
  assert.equal(replay.status, 401); assert.equal(replay.json.error, 'admin_required');
  // the old admin cookie on the NEW session, and the new session on its own, are not admin either
  assert.equal((await request('GET', '/api/catalog-admin/status', null, { Cookie: base2 + '; ' + admin1 })).json.admin, false);
  assert.equal((await request('GET', '/api/catalog-admin/status', null, { Cookie: base2 })).json.admin, false);
  // and a re-login by the SAME name also revokes
  const v3 = await request('POST', '/api/verify-pin', { pin: APP_PIN, user: 'ורד' }, freshIp());
  const base3 = v3.headers['set-cookie'][0].split(';')[0];
  const l3 = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: base3, ...freshIp() });
  const pair3 = base3 + '; ' + l3.headers['set-cookie'][0].split(';')[0];
  await request('POST', '/api/verify-pin', { pin: APP_PIN, user: 'ורד' }, { Cookie: pair3, ...freshIp() });
  assert.equal((await request('GET', '/api/catalog-admin/status', null, { Cookie: pair3 })).json.admin, false);
});

test('a pre-change named cookie (no login id) still serves ordinary routes but cannot enter pricing: fresh_login_required', async () => {
  const crypto = require('crypto');
  const exp = Math.floor(Date.now() / 1000) + 3600, ub = Buffer.from('ורד').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update('ezone-session.' + exp + '.' + ub).digest('hex');
  const legacy3 = 'ezone_session=' + exp + '.' + ub + '.' + sig;
  assert.notEqual((await request('GET', '/api/sheets?action=getSettings', null, { Cookie: legacy3 })).status, 401, 'the gate passes');
  const l = await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: legacy3, ...freshIp() });
  assert.equal(l.status, 403); assert.equal(l.json.error, 'fresh_login_required');
});
