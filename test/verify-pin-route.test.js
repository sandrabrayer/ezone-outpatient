'use strict';

/**
 * HTTP-route coverage for edit-mode auth and basic server health.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * lib/pin.js (the constant-time compare) is unit-tested in test/pin.test.js;
 * this file proves the wiring at the Express layer:
 *   - POST /api/verify-pin blocks a wrong PIN (401) and rate-limits (429),
 *   - accepts the correct PIN (200),
 *   - GET /healthz responds,
 * WITHOUT any live upstream call — verify-pin never touches Apps Script, so no
 * network is involved and no real secret appears here (the PIN is a dummy).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31855;
const TEST_PIN = '135790'; // dummy edit PIN, never a real secret

process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = TEST_PIN;
// SHEETS_URL intentionally left unset — these routes must not need it.

const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: TEST_PORT,
        path,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* leave null */ }
          resolve({ status: res.statusCode, body: data, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
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

// A correct PIN resets the per-IP attempt counter, isolating each test below.
async function resetRateLimit() {
  const res = await request('POST', '/api/verify-pin', { pin: TEST_PIN });
  assert.equal(res.status, 200);
}

test('GET /healthz responds ok', async () => {
  await waitForListen();
  const res = await request('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
});

test('POST /api/verify-pin accepts the correct PIN → 200 { ok: true }', async () => {
  await waitForListen();
  const res = await request('POST', '/api/verify-pin', { pin: TEST_PIN });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
});

test('POST /api/verify-pin blocks a wrong PIN → 401 { ok: false }', async () => {
  await waitForListen();
  await resetRateLimit();
  const res = await request('POST', '/api/verify-pin', { pin: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
});

test('POST /api/verify-pin blocks a missing PIN → 401', async () => {
  await waitForListen();
  await resetRateLimit();
  const res = await request('POST', '/api/verify-pin', {});
  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
});

test('POST /api/verify-pin rate-limits after 10 wrong attempts → 429', async () => {
  await waitForListen();
  await resetRateLimit();
  // Attempts 1..10 are wrong but still evaluated → 401. The 11th is refused
  // outright by the per-IP window (10 attempts / 15 min) → 429.
  for (let i = 0; i < 10; i++) {
    const res = await request('POST', '/api/verify-pin', { pin: 'wrong' });
    assert.equal(res.status, 401, `attempt ${i + 1} should be 401`);
  }
  const limited = await request('POST', '/api/verify-pin', { pin: 'wrong' });
  assert.equal(limited.status, 429, '11th attempt should be rate-limited');
  assert.equal(limited.json.ok, false);
  // Once rate-limited, even a correct PIN is refused until the window elapses,
  // so we do NOT try to reset here — this is the last test in the file and each
  // test file runs in its own process, so the dirty counter affects nothing.
});
