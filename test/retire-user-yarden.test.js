'use strict';
/* ירדן left (2026-10). Removing a picker entry alone is NOT enough: a cookie
 * minted while she was listed stays valid for 7 days, and the user-less
 * fallback ("no name") still opens the app for anyone who knows APP_PIN.
 * This file pins what code CAN close and documents what it cannot:
 *   A. she is not offered (picker list, assignedTo options, validateSessionUser);
 *   B. a login naming her falls back to a user-less session, never her name;
 *   C. an OLD cookie that carries her name is refused by every gated route;
 *   D. history is preserved — nothing rewrites stored `updatedBy` text;
 *   E. UI copy uses neutral role wording (no person-reference to her).
 * What stays manual (docs/package-catalog.md): rotate APP_PIN + SESSION_SECRET,
 * because she still may KNOW the shared PIN. */
process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 31851;
const PIN = '424242';
const SECRET = 'test-session-secret-retire-yarden-0123456789abcd';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = PIN;
process.env.SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
process.env.SESSION_SECRET = SECRET;
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;
global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true }) });

const { SESSION_USERS, RETIRED_SESSION_USERS } = require('../lib/users');
const { createSessionToken, readSessionUser } = require('../lib/session');
const server = require('../server');
const YARDEN = 'ירדן';

let httpServer;
test.before(() => { httpServer = server.start(TEST_PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

function request(method, urlPath, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: TEST_PORT, path: urlPath, method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {})
    }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch (_) {} resolve({ status: res.statusCode, json, headers: res.headers }); });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
async function ready() { for (let i = 0; i < 50; i++) { try { await request('GET', '/healthz'); return; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } } throw new Error('no listen'); }
const cookieFor = (user) => 'ezone_session=' + createSessionToken(SECRET, undefined, undefined, user);

test('A: ירדן is retired — not in SESSION_USERS, not in the picker, not in assignedTo, not accepted as a name', async () => {
  await ready();
  assert.deepEqual(RETIRED_SESSION_USERS, [YARDEN]);
  assert.ok(!SESSION_USERS.includes(YARDEN));
  assert.equal(server.validateSessionUser(YARDEN), '');
  const idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(!/<option>ירדן<\/option>/.test(idx));
  const r = await request('GET', '/api/users', null, { Cookie: cookieFor('ורד') });
  assert.deepEqual(r.json.users, SESSION_USERS);
});

test('B: a login that names ירדן gets a USER-LESS session, never her name', async () => {
  const r = await request('POST', '/api/verify-pin', { pin: PIN, user: YARDEN });
  assert.equal(r.status, 200);
  const tok = (r.headers['set-cookie'][0].split(';')[0]).split('=')[1];
  assert.equal(readSessionUser(tok, SECRET), '');
});

test('C: an OLD cookie that carries ירדן is refused by every session-gated route; the other names still work', async () => {
  for (const p of ['/api/me', '/api/users', '/api/catalog-admin/status']) {
    const old = await request('GET', p, null, { Cookie: cookieFor(YARDEN) });
    assert.equal(old.status, 401, p + ' must refuse a retired user\'s stale cookie');
    const ok = await request('GET', p, null, { Cookie: cookieFor('ורד') });
    assert.equal(ok.status, 200, p + ' still serves a current user');
  }
  const post = await request('POST', '/api/sheets', { action: 'saveAll' }, { Cookie: cookieFor(YARDEN) });
  assert.equal(post.status, 401);
});

test('D: history preserved — lib/users.js documents it and no code rewrites updatedBy', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'users.js'), 'utf8');
  assert.match(src, /never rewritten/);
  const gs = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
  assert.ok(!gs.includes("'" + YARDEN + "'"), 'Code.gs must not special-case the retired name');
});

test('E: UI copy no longer addresses her by name (neutral role wording)', () => {
  for (const f of ['public/index.html', 'public/app.js']) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes(YARDEN), f + ' still names ' + YARDEN);
  }
});
