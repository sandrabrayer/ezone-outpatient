'use strict';

/**
 * HTTP-level coverage for server.js routes with the environment CONFIGURED.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Focus (the gaps the pure unit tests can't reach):
 *   - /healthz responds 200 { ok: true }
 *   - /api/verify-pin: correct PIN -> 200, wrong -> 401, and the per-IP rate
 *     limit -> 429 after the configured number of failures (auth gate).
 *   - /api/debug/env reports config WITHOUT leaking the URL/secret values.
 *
 * External HTTP is mocked: global.fetch is stubbed BEFORE requiring server.js,
 * so no live Apps Script backend is ever contacted. Env values are dummy
 * fixtures — no real secret or URL appears in this file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31840;
const DUMMY_PIN = '424242';
const DUMMY_SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';

process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.SHEETS_URL = DUMMY_SHEETS_URL;

// Stub fetch so the app can never reach a live backend from these tests.
global.fetch = async () => ({
  status: 200,
  text: async () => JSON.stringify({ ok: true, mocked: true })
});

const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function request(method, path, bodyObj) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1', port: TEST_PORT, path, method,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : {}
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* non-JSON body */ }
          resolve({ status: res.statusCode, body: data, json });
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

test('GET /healthz responds 200 { ok: true }', async () => {
  await waitForListen();
  const res = await request('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
});

test('GET /api/debug/env reports config flags without leaking values', async () => {
  await waitForListen();
  const res = await request('GET', '/api/debug/env');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.sheetsUrlConfigured, true);
  // Only the host is exposed, never the full /exec URL or any secret.
  assert.equal(res.json.sheetsUrlHost, 'script.example.com');
  assert.ok(!res.body.includes('AKfycbDUMMY'), 'must not leak the deployment id');
});

test('POST /api/verify-pin accepts the correct PIN (200)', async () => {
  await waitForListen();
  const res = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
});

test('POST /api/verify-pin rejects a wrong PIN (401)', async () => {
  await waitForListen();
  const res = await request('POST', '/api/verify-pin', { pin: '000000' });
  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
});

test('POST /api/verify-pin rate-limits repeated wrong PINs (429)', async () => {
  await waitForListen();
  // A correct PIN clears this IP's counter, giving the test a clean window.
  await request('POST', '/api/verify-pin', { pin: DUMMY_PIN });

  // The limit is 10 wrong attempts per window; the 11th is throttled.
  for (let i = 0; i < 10; i++) {
    const r = await request('POST', '/api/verify-pin', { pin: 'wrong0' });
    assert.equal(r.status, 401, `attempt ${i + 1} should still be a 401`);
  }
  const throttled = await request('POST', '/api/verify-pin', { pin: 'wrong0' });
  assert.equal(throttled.status, 429, '11th attempt should be rate-limited');
  assert.equal(throttled.json.ok, false);
});
