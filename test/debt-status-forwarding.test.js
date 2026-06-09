'use strict';

/**
 * Regression test: GET /api/sheets?action=getDebtStatus must forward
 * ?secret=... to the Apps Script URL, exactly like getWinbackSource. Without
 * this, the authenticated getDebtStatus action rejects the cross-app read.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Strategy mirrors sheets-secret-forwarding.test.js: stub global.fetch BEFORE
 * requiring server.js, capture the outbound URL, fire a real HTTP request.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31731;
const SHEETS_URL = 'https://script.example.com/macros/s/AKfycb/exec';
const SECRET = 'debt-sekret-456';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;

let capturedUrl = null;
global.fetch = async (url) => {
  capturedUrl = url;
  return {
    status: 200,
    text: async () => JSON.stringify({ ok: true, debtors: [] }),
  };
};

require('../server');

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

test('GET /api/sheets forwards ?secret for getDebtStatus', async () => {
  await waitForListen();
  capturedUrl = null;

  const res = await httpGet(
    `/api/sheets?action=getDebtStatus&secret=${encodeURIComponent(SECRET)}`
  );

  assert.equal(res.status, 200);
  assert.ok(capturedUrl, 'upstream fetch should have been called');
  assert.ok(capturedUrl.startsWith(SHEETS_URL), `got: ${capturedUrl}`);
  assert.ok(capturedUrl.includes('action=getDebtStatus'), `got: ${capturedUrl}`);
  assert.ok(
    capturedUrl.includes(`secret=${encodeURIComponent(SECRET)}`),
    `outbound URL should include secret param, got: ${capturedUrl}`
  );
});
