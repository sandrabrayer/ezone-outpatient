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
const ADMIN_PIN = '9137246';
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
const sess = (user = 'ורד') => 'ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, user);
const adminCookie = (ttl) => catalogAdmin.ADMIN_COOKIE + '=' + createSessionToken(SESSION_SECRET, ttl, catalogAdmin.ADMIN_SCOPE);
const both = (user) => sess(user) + '; ' + adminCookie();
let ipN = 0;
const freshIp = () => ({ 'x-forwarded-for': '10.1.0.' + (++ipN) });
const rpc = (op, extra, cookie = both(), headers) => request('POST', '/api/catalog-admin/rpc', { op, ...extra }, { Cookie: cookie, ...(headers || {}) });

test('privilege: a session (any display name) is NOT admin; status reports admin:false until the PIN is verified', async () => {
  await ready();
  assert.equal((await request('GET', '/api/catalog-admin/status')).status, 401);
  for (const u of ['ורד', 'שירן', 'יעל', '']) {
    const s = await request('GET', '/api/catalog-admin/status', null, { Cookie: sess(u) });
    assert.deepEqual(s.json, { ok: true, configured: true, admin: false });
    const r = await rpc('catalog', {}, sess(u));
    assert.equal(r.status, 401, 'name "' + u + '" must not unlock pricing');
    assert.equal(r.json.error, 'admin_required');
  }
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
  assert.ok(!ok.body.includes(ADMIN_PIN));
});

test('login: rate limited per client and globally; a correct PIN is refused while locked out', async () => {
  const ip = { 'x-forwarded-for': '10.9.9.9' };
  for (let i = 0; i < 5; i++) assert.equal((await request('POST', '/api/catalog-admin/login', { pin: 'wrong' + i }, { Cookie: sess(), ...ip })).status, 401);
  assert.equal((await request('POST', '/api/catalog-admin/login', { pin: ADMIN_PIN }, { Cookie: sess(), ...ip })).status, 429);
  // unit: the global cap stops a rotating-address guesser
  let t = 0;
  const lim = catalogAdmin.createLimiter({ perKeyMax: 5, globalMax: 8, windowMs: 1000, now: () => t });
  const allowed = []; for (let i = 0; i < 12; i++) allowed.push(lim.attempt('ip' + i));
  assert.equal(allowed.filter(Boolean).length, 8);
  t = 2000; assert.equal(lim.attempt('ip0'), true, 'window expires');
});

test('cookie scope: an admin token is not a session, a session token is not an admin token, expired/tampered ones fail', async () => {
  const adminAsSession = 'ezone_session=' + adminCookie().split('=')[1];
  assert.equal((await request('GET', '/api/me', null, { Cookie: adminAsSession })).status, 401);
  const sessionAsAdmin = catalogAdmin.ADMIN_COOKIE + '=' + sess().split('=')[1];
  assert.equal((await rpc('catalog', {}, sess() + '; ' + sessionAsAdmin)).status, 401);
  assert.equal((await rpc('catalog', {}, sess() + '; ' + adminCookie(-5))).status, 401, 'expired');
  const good = adminCookie();
  assert.equal((await rpc('catalog', {}, sess() + '; ' + good.slice(0, -2) + '00')).status, 401, 'tampered');
  assert.equal((await rpc('catalog', {}, adminCookie())).status, 401, 'admin cookie without a session');
  // another SESSION_SECRET signs a token the server must refuse
  const foreign = catalogAdmin.ADMIN_COOKIE + '=' + createSessionToken('another-secret-0123456789abcdef-xyz', undefined, catalogAdmin.ADMIN_SCOPE);
  assert.equal((await rpc('catalog', {}, sess() + '; ' + foreign)).status, 401);
});

test('rpc end to end: Node signs, Code.gs verifies; actor comes from the session, never the browser; allowlist rebuild', async () => {
  upstream = [];
  assert.equal(sb.rows('PackageCatalog').length, 0);
  const seed = await rpc('seed', {}, both('ורד'));
  assert.equal(seed.json.ok, true, JSON.stringify(seed.json));
  const sent = upstream[0];
  assert.equal(sent.action, 'adminSeedPackageCatalog');
  assert.equal(sent.proxySecret, PROXY);
  assert.equal(sent.user, 'ורד', 'actor is the signed session name');
  assert.match(sent.adminAssertion, /^v1\.\d+\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  assert.equal(sb.rows('PackageCatalog').length, 15);

  const cat = await rpc('catalog', {}, both('שירן'));
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
    const g = await request('GET', '/api/sheets?action=' + encodeURIComponent(a), null, { Cookie: both() });
    assert.equal(g.status, 403, 'GET ' + a);
    assert.equal(g.json.error, 'forbidden_action');
    const p = await request('POST', '/api/sheets', { action: a, requestId: crypto.randomUUID() }, { Cookie: both() });
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

test('config: fail closed unless PIN (6-12, != APP_PIN) and a distinct >=32 char assertion secret are set', () => {
  const base = { SESSION_SECRET: 's'.repeat(40), APP_PIN: '424242', OUTPATIENT_PROXY_SECRET: 'p'.repeat(40), CATALOG_ADMIN_PIN: '9137246', CATALOG_ADMIN_ASSERTION_SECRET: 'a'.repeat(40) };
  assert.equal(catalogAdmin.adminConfigStatus(base).ok, true);
  const bad = (over) => catalogAdmin.adminConfigStatus({ ...base, ...over });
  assert.equal(bad({ CATALOG_ADMIN_PIN: '' }).reason, 'pin_not_configured');
  assert.equal(bad({ CATALOG_ADMIN_PIN: '123' }).reason, 'pin_not_configured');
  assert.equal(bad({ CATALOG_ADMIN_PIN: '424242' }).reason, 'pin_must_differ_from_app_pin');
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
      out.push(await call('POST','/api/catalog-admin/login',{pin:'9137246'}));
      out.push(await call('POST','/api/catalog-admin/rpc',{op:'catalog'}));
      console.log(JSON.stringify(out)); h.close(); process.exit(0); })();`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(JSON.parse(out[0][1]), { ok: true, configured: false, admin: false });
  assert.equal(out[1][0], 503);
  assert.equal(out[2][0], 503);
  assert.match(out[2][1], /catalog_admin_not_configured/);
});
