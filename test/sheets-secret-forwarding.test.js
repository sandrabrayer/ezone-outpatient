/**
 * Regression test: GET /api/sheets must forward ?secret=... to the Apps
 * Script URL it fetches upstream. Without this, authenticated Apps Script
 * actions like getWinbackSource reject the request.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Strategy: stub global.fetch BEFORE requiring server.js, capture the
 * outbound URL, fire a real HTTP request at the route, assert the URL.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31729;
const SHEETS_URL = 'https://script.example.com/macros/s/AKfycb/exec';
const SECRET = 'sekret-xyz-123';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;

let capturedUrl = null;
global.fetch = async (url) => {
  capturedUrl = url;
  return {
    status: 200,
    text: async () => JSON.stringify({ ok: true, source: 'test' }),
  };
};

// Import the app and start a server we control, so the test runner can exit
// cleanly (the server is closed in the after() hook below) instead of hanging
// on a listening socket.
const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: TEST_PORT, path },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
  });
}

// Give app.listen a tick to bind before the first request.
async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try {
      await httpGet('/healthz');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('server did not start listening');
}

test('GET /api/sheets forwards ?secret to the Apps Script URL', async () => {
  await waitForListen();
  capturedUrl = null;

  const res = await httpGet(
    `/api/sheets?action=getWinbackSource&secret=${encodeURIComponent(SECRET)}`
  );

  assert.equal(res.status, 200, 'route should respond 200');
  assert.ok(capturedUrl, 'upstream fetch should have been called');
  assert.ok(
    capturedUrl.startsWith(SHEETS_URL),
    `outbound URL should start with SHEETS_URL, got: ${capturedUrl}`
  );
  assert.ok(
    capturedUrl.includes('action=getWinbackSource'),
    `outbound URL should include action, got: ${capturedUrl}`
  );
  assert.ok(
    capturedUrl.includes(`secret=${encodeURIComponent(SECRET)}`),
    `outbound URL should include secret param, got: ${capturedUrl}`
  );
});

test('GET /api/sheets omits secret when not provided', async () => {
  await waitForListen();
  capturedUrl = null;

  // Use a non-getData action so the cache does not short-circuit fetch.
  const res = await httpGet('/api/sheets?action=getWinbackSource');

  assert.equal(res.status, 200);
  assert.ok(capturedUrl, 'upstream fetch should have been called');
  assert.ok(
    !capturedUrl.includes('secret='),
    `outbound URL should NOT include secret param, got: ${capturedUrl}`
  );
});
