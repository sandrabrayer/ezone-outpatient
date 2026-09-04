'use strict';

/**
 * Fail-closed behaviour of the session layer when SESSION_SECRET is NOT set
 * (session-who-when PR). server.js reads its config at require() time and Node
 * runs each test FILE in its own process, so this file deliberately sets
 * APP_PIN (a correct PIN is possible) but NOT SESSION_SECRET and asserts:
 *   - POST /api/verify-pin with the CORRECT PIN -> 500 { error: 'session_not_configured' }
 *     and NO Set-Cookie (no cookie can be minted, so the login is refused
 *     loudly instead of "succeeding" into a 401 wall) — with a wrong PIN it is
 *     still the ordinary 401;
 *   - every gated route -> 401 { error: 'session_not_configured' } even when
 *     the caller presents a syntactically valid-looking cookie;
 *   - the operator sees a clear boot-time log line naming SESSION_SECRET.
 * global.fetch throws so an accidental upstream call fails the test loudly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31843;
const DUMMY_PIN = '424242';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
delete process.env.SESSION_SECRET;

let fetchCalled = false;
global.fetch = async () => { fetchCalled = true; throw new Error('fetch must not be called without a session'); };

const logged = [];
const origError = console.error;
console.error = (...args) => { logged.push(args.join(' ')); };
const app = require('../server');
console.error = origError;

let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function request(method, path, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: TEST_PORT, path, method,
        headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {}) },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* non-JSON */ }
          resolve({ status: res.statusCode, body: data, json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try { await request('GET', '/healthz'); return; }
    catch (_) { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start listening');
}

test('boot logs a clear line naming SESSION_SECRET (fail-closed, not silent)', () => {
  assert.ok(logged.some((l) => /SESSION_SECRET is not set/.test(l) && /fail-closed/.test(l)), logged.join('\n'));
});

test('POST /api/verify-pin with the CORRECT PIN -> 500 session_not_configured and no cookie; wrong PIN -> 401', async () => {
  await waitForListen();
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const ok = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN, user: 'ורד' });
  console.error = orig;
  assert.equal(ok.status, 500);
  assert.deepEqual(ok.json, { ok: false, error: 'session_not_configured' });
  assert.equal((ok.headers['set-cookie'] || []).length, 0, 'no cookie may be minted without a secret');
  assert.ok(errors.some((l) => /SESSION_SECRET/.test(l)), 'a clear log line accompanies the 500');
  const wrong = await request('POST', '/api/verify-pin', { pin: '000000' });
  assert.equal(wrong.status, 401);
});

test('gated routes answer 401 session_not_configured, even with a plausible cookie; upstream never called', async () => {
  await waitForListen();
  fetchCalled = false;
  const cookie = { Cookie: 'ezone_session=1999999999.' + 'a'.repeat(64) };
  for (const [method, p] of [['GET', '/api/sheets'], ['POST', '/api/sheets'], ['GET', '/api/me'],
    ['GET', '/api/continuation-roster'], ['GET', '/api/debug/env'], ['POST', '/api/debug/cache/clear']]) {
    const res = await request(method, p, method === 'POST' ? { action: 'saveAll' } : null, cookie);
    assert.equal(res.status, 401, method + ' ' + p);
    assert.deepEqual(res.json, { ok: false, error: 'session_not_configured' });
  }
  assert.equal(fetchCalled, false);
  assert.deepEqual((await request('GET', '/healthz')).json, { ok: true }, '/healthz stays open');
});
