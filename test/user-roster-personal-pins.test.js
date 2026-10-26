'use strict';
/* 2026-10-26: שירן -> אורן and יעל -> דנה, with PERSONAL PINs.
 *   A. roster: exactly ורד / אורן / דנה; the three leavers are retired; the assignedTo dropdown matches;
 *   B. resolveUserPins (pure): valid, unset, malformed, too long, equal to APP_PIN, duplicate — all fail closed,
 *      and no PIN value ever appears in a problem message;
 *   C. real server: a name's PIN is the ONLY code that signs in as that name (APP_PIN does not sign in as
 *      אורן / דנה; one person's PIN is not another's); ורד still uses APP_PIN; retired names are refused
 *      even with a correct PIN; an old cookie carrying a retired name is refused;
 *   D. a server started WITHOUT the personal-PIN variables lets nobody in as אורן / דנה (fail-closed) and
 *      logs only the variable NAMES.
 * Every PIN here is a throwaway fixture value. */
process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 31871;
const APP_PIN = '424242';
const OREN_PIN = '515151';
const DANA_PIN = '626262';
const SECRET = 'test-session-secret-user-roster-0123456789abcd';
process.env.PORT = String(PORT);
process.env.APP_PIN = APP_PIN;
process.env.USER_PIN_OREN = OREN_PIN;
process.env.USER_PIN_DANA = DANA_PIN;
process.env.SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
process.env.SESSION_SECRET = SECRET;
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;
global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true }) });

const { SESSION_USERS, RETIRED_SESSION_USERS, CATALOG_ADMIN_USERS, PERSONAL_PIN_ENV, SHARED_PIN_USER, resolveUserPins } = require('../lib/users');
const { createSessionToken } = require('../lib/session');
const server = require('../server');

let httpServer;
test.before(() => { httpServer = server.start(PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

let ipCounter = 0;
const freshIp = () => ({ 'x-forwarded-for': '10.71.0.' + (++ipCounter) });
function request(method, urlPath, bodyObj, headers, port) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: port || PORT, path: urlPath, method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {})
    }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch (_) {} resolve({ status: res.statusCode, json, headers: res.headers }); });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
async function ready(port) { for (let i = 0; i < 80; i++) { try { await request('GET', '/healthz', null, null, port); return; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } } throw new Error('no listen'); }
const login = (pin, user, port) => request('POST', '/api/verify-pin', user === undefined ? { pin } : { pin, user }, freshIp(), port);
const sessionCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('ezone_session=')).split(';')[0];

test('A: the roster is exactly ורד / אורן / דנה; שירן, יעל and ירדן are retired; the assignedTo dropdown matches; pricing stays ורד-only', () => {
  assert.deepEqual(SESSION_USERS, ['ורד', 'אורן', 'דנה']);
  assert.deepEqual(RETIRED_SESSION_USERS.slice().sort(), ['ירדן', 'יעל', 'שירן'].sort());
  RETIRED_SESSION_USERS.forEach((n) => assert.ok(!SESSION_USERS.includes(n), n + ' must not be listed'));
  assert.deepEqual(CATALOG_ADMIN_USERS, ['ורד']);
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const sel = html.match(/<select name="assignedTo" required>([\s\S]*?)<\/select>/)[1];
  const opts = [...sel.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(opts, SESSION_USERS, 'the dropdown offers exactly the login names');
  // every listed name has a PIN source: ורד = APP_PIN, everyone else a personal variable
  SESSION_USERS.forEach((n) => assert.ok(n === SHARED_PIN_USER || PERSONAL_PIN_ENV[n], n + ' has no PIN source'));
  assert.deepEqual(PERSONAL_PIN_ENV, { 'אורן': 'USER_PIN_OREN', 'דנה': 'USER_PIN_DANA' });
});

test('B: resolveUserPins — valid, unset, malformed, too long, equal to APP_PIN, duplicate: all fail closed; no value in any message', () => {
  const ok = resolveUserPins({ APP_PIN: '111111', USER_PIN_OREN: '222222', USER_PIN_DANA: '3333' });
  assert.deepEqual(ok.pins, { 'ורד': '111111', 'אורן': '222222', 'דנה': '3333' });
  assert.deepEqual(ok.problems, []);

  const none = resolveUserPins({ APP_PIN: '111111' });
  assert.deepEqual(none.pins, { 'ורד': '111111' }, 'unset personal PINs -> those names have no PIN');
  assert.deepEqual(none.problems.sort(), ['USER_PIN_DANA: not set', 'USER_PIN_OREN: not set']);

  const noApp = resolveUserPins({ USER_PIN_OREN: '222222' });
  assert.ok(!('ורד' in noApp.pins), 'no APP_PIN -> ורד has no PIN');
  assert.equal(noApp.pins['אורן'], '222222');

  const bad = resolveUserPins({ APP_PIN: '111111', USER_PIN_OREN: 'abc123', USER_PIN_DANA: '1234567' });
  assert.deepEqual(bad.pins, { 'ורד': '111111' });
  assert.deepEqual(bad.problems, ['USER_PIN_OREN: must be 4-6 digits', 'USER_PIN_DANA: must be 4-6 digits']);

  const sameAsApp = resolveUserPins({ APP_PIN: '111111', USER_PIN_OREN: '111111', USER_PIN_DANA: '333333' });
  assert.ok(!('אורן' in sameAsApp.pins), 'a personal PIN equal to APP_PIN is dropped');
  assert.equal(sameAsApp.pins['דנה'], '333333');

  const dup = resolveUserPins({ APP_PIN: '111111', USER_PIN_OREN: '555555', USER_PIN_DANA: '555555' });
  assert.ok(!('אורן' in dup.pins) && !('דנה' in dup.pins), 'two people sharing a personal PIN: neither works');
  assert.equal(dup.pins['ורד'], '111111');

  [ok, none, noApp, bad, sameAsApp, dup].forEach((r) => r.problems.forEach((m) => assert.ok(!/\d{4}/.test(m), 'no PIN value in "' + m + '"')));
  assert.deepEqual(resolveUserPins().pins, {}, 'no env at all -> nobody');
  assert.deepEqual(resolveUserPins({ APP_PIN: 42, USER_PIN_OREN: 515151 }).pins, {}, 'non-string values are ignored');
});

test('C: each name signs in with ITS OWN PIN only — APP_PIN is not a master key for אורן / דנה; PINs are not interchangeable', async () => {
  await ready();
  // ורד: unchanged, APP_PIN
  const v = await login(APP_PIN, 'ורד');
  assert.equal(v.status, 200); assert.equal(v.json.stage, 'named');
  assert.equal((await request('GET', '/api/me', null, { Cookie: sessionCookie(v) })).json.user, 'ורד');
  // אורן / דנה with their own PIN
  const o = await login(OREN_PIN, 'אורן');
  assert.equal(o.status, 200); assert.equal(o.json.stage, 'named');
  assert.match(o.headers['set-cookie'][0], /Max-Age=604800/);
  assert.equal((await request('GET', '/api/me', null, { Cookie: sessionCookie(o) })).json.user, 'אורן');
  const d = await login(DANA_PIN, 'דנה');
  assert.equal(d.status, 200);
  assert.equal((await request('GET', '/api/me', null, { Cookie: sessionCookie(d) })).json.user, 'דנה');
  // refusals: no cookie, 401
  const refusals = [
    [APP_PIN, 'אורן'], [APP_PIN, 'דנה'],          // the shared PIN does not sign in as them
    [DANA_PIN, 'אורן'], [OREN_PIN, 'דנה'],        // nor does a colleague's PIN
    [OREN_PIN, 'ורד'], [DANA_PIN, 'ורד'],         // nor does a personal PIN sign in as ורד
    ['000000', 'אורן'], ['', 'דנה'], [undefined, 'אורן']
  ];
  for (const [pin, user] of refusals) {
    const r = await request('POST', '/api/verify-pin', { pin, user }, freshIp());
    assert.equal(r.status, 401, JSON.stringify([pin, user]));
    assert.equal((r.headers['set-cookie'] || []).length, 0, 'no cookie for ' + JSON.stringify([pin, user]));
    assert.deepEqual(r.json, { ok: false, error: 'Incorrect PIN.' });
  }
});

test('C: the name-less PIN stage accepts any configured PIN but reaches only the picker; the named upgrade still checks that name\'s PIN', async () => {
  for (const pin of [APP_PIN, OREN_PIN, DANA_PIN]) {
    const stage = await login(pin);
    assert.equal(stage.status, 200); assert.equal(stage.json.stage, 'name_required');
    assert.match(stage.headers['set-cookie'][0], /Max-Age=600/);
    const ck = sessionCookie(stage);
    assert.equal((await request('GET', '/api/sheets?action=getSettings', null, { Cookie: ck })).status, 401, 'a name-less session reaches no data');
  }
  assert.equal((await login('000000')).status, 401);
  // the PIN-stage session of אורן's PIN cannot be upgraded into ורד
  const stage = await login(OREN_PIN);
  const up = await request('POST', '/api/verify-pin', { pin: OREN_PIN, user: 'ורד' }, { Cookie: sessionCookie(stage), ...freshIp() });
  assert.equal(up.status, 401);
  const ok = await request('POST', '/api/verify-pin', { pin: OREN_PIN, user: 'אורן' }, { Cookie: sessionCookie(stage), ...freshIp() });
  assert.equal(ok.status, 200); assert.equal(ok.json.stage, 'named');
});

test('C: שירן, יעל and ירדן are refused even with a CORRECT PIN (403, no cookie); an old cookie that carries them is refused everywhere', async () => {
  for (const name of ['שירן', 'יעל', 'ירדן']) {
    for (const pin of [APP_PIN, OREN_PIN, DANA_PIN]) {
      const r = await login(pin, name);
      assert.equal(r.status, 403, name + ' with a correct PIN');
      assert.deepEqual(r.json, { ok: false, error: 'user_not_allowed' });
      assert.equal((r.headers['set-cookie'] || []).length, 0);
    }
    assert.equal((await login('000000', name)).status, 401, 'a wrong PIN stays 401');
    assert.equal(server.validateSessionUser(name), '');
    const old = 'ezone_session=' + createSessionToken(SECRET, undefined, undefined, name);
    for (const p of ['/api/me', '/api/catalog-admin/status']) {
      assert.equal((await request('GET', p, null, { Cookie: old })).status, 401, p + ' must refuse a stale cookie of ' + name);
    }
  }
  // the current names' cookies still work
  for (const name of SESSION_USERS) {
    const ck = 'ezone_session=' + createSessionToken(SECRET, undefined, undefined, name);
    assert.equal((await request('GET', '/api/me', null, { Cookie: ck })).status, 200);
  }
  const users = await request('GET', '/api/users');
  assert.deepEqual(users.json.users, ['ורד', 'אורן', 'דנה']);
});

test('C: the login rate limit still counts wrong personal PINs (10 attempts / 15 min / IP -> 429)', async () => {
  const ip = { 'x-forwarded-for': '10.99.99.99' };
  for (let i = 0; i < 10; i++) assert.equal((await request('POST', '/api/verify-pin', { pin: '00000' + (i % 10), user: 'אורן' }, ip)).status, 401);
  assert.equal((await request('POST', '/api/verify-pin', { pin: OREN_PIN, user: 'אורן' }, ip)).status, 429, 'even the right PIN waits out the window');
});

test('D: a server started WITHOUT the personal PINs lets nobody in as אורן / דנה (fail-closed), still serves ורד, and logs only variable NAMES', async () => {
  const P2 = 31872;
  const env = Object.assign({}, process.env, { PORT: String(P2), APP_PIN, SESSION_SECRET: SECRET });
  delete env.USER_PIN_OREN; delete env.USER_PIN_DANA;
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  try {
    await ready(P2);
    for (const [pin, user] of [[APP_PIN, 'אורן'], [APP_PIN, 'דנה'], ['', 'אורן'], [OREN_PIN, 'אורן']]) {
      const r = await request('POST', '/api/verify-pin', { pin, user }, freshIp(), P2);
      assert.equal(r.status, 401, JSON.stringify([pin, user]));
      assert.equal((r.headers['set-cookie'] || []).length, 0);
    }
    assert.equal((await request('POST', '/api/verify-pin', { pin: APP_PIN, user: 'ורד' }, freshIp(), P2)).status, 200, 'ורד is unaffected');
    assert.match(out, /USER_PIN_OREN: not set/);
    assert.match(out, /USER_PIN_DANA: not set/);
    [APP_PIN, OREN_PIN, DANA_PIN].forEach((v) => assert.ok(!out.includes(v), 'no PIN value in the logs'));
  } finally { child.kill(); }
});

test('E: no PIN value is written in source, docs or the changelog; the variable names are documented', () => {
  const files = ['lib/users.js', 'server.js', 'README.md', 'CHANGELOG-user-roster-oren-dana.md'];
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/USER_PIN_(OREN|DANA)\s*[=:]\s*['"]?\d{4,}/.test(src), f + ' must not assign a PIN value');
  });
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const log = fs.readFileSync(path.join(ROOT, 'CHANGELOG-user-roster-oren-dana.md'), 'utf8');
  ['USER_PIN_OREN', 'USER_PIN_DANA'].forEach((v) => { assert.ok(readme.includes(v), v + ' in README'); assert.ok(log.includes(v), v + ' in the changelog'); });
});
