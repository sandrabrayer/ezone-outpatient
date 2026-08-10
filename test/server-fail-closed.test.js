'use strict';

/**
 * HTTP-level coverage for server.js when the environment is NOT configured.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * server.js reads its config into module-level constants at require() time, so
 * "configured" and "unconfigured" behaviour can't share one process. Node runs
 * each test FILE in its own process, so this file deliberately leaves
 * SHEETS_URL / DASHBOARD_SHEETS_URL / OCCUPANCY_SECRET / APP_PIN unset and
 * asserts the fail-closed behaviour:
 *   - /api/sheets            -> 500 (SHEETS_URL not configured)
 *   - /api/continuation-roster -> 500 (roster proxy not configured)
 *   - /api/verify-pin        -> 401 (APP_PIN unset => checkPin fails closed)
 *
 * global.fetch is stubbed to THROW so that any accidental upstream call (which
 * would be a fail-open regression) turns into a loud test failure rather than a
 * silent live request. No real backend is contacted; no secret appears here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31841;

process.env.PORT = String(TEST_PORT);
// Explicitly clear anything a sibling test/process might have set.
delete process.env.SHEETS_URL;
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;
delete process.env.APP_PIN;

let fetchCalled = false;
global.fetch = async () => {
  fetchCalled = true;
  throw new Error('fetch must not be called when the server is unconfigured');
};

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
          try { json = JSON.parse(data); } catch (_) { /* non-JSON */ }
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

test('GET /api/sheets fails closed (500) when SHEETS_URL is unset', async () => {
  await waitForListen();
  fetchCalled = false;
  const res = await request('GET', '/api/sheets?action=getWinbackSource');
  assert.equal(res.status, 500);
  assert.equal(res.json.ok, false);
  assert.match(res.json.error, /SHEETS_URL/);
  assert.equal(fetchCalled, false, 'must not reach upstream when unconfigured');
});

test('GET /api/continuation-roster fails closed (500) when the roster proxy is unset', async () => {
  await waitForListen();
  fetchCalled = false;
  const res = await request('GET', '/api/continuation-roster');
  assert.equal(res.status, 500);
  assert.equal(res.json.ok, false);
  assert.match(res.json.error, /DASHBOARD_SHEETS_URL and OCCUPANCY_SECRET/);
  assert.equal(fetchCalled, false, 'must not reach upstream when unconfigured');
});

test('POST /api/verify-pin blocks every attempt (401) when APP_PIN is unset', async () => {
  await waitForListen();
  const res = await request('POST', '/api/verify-pin', { pin: '123456' });
  assert.equal(res.status, 401, 'no configured PIN => nothing can authenticate');
  assert.equal(res.json.ok, false);
});
