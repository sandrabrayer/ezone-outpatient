'use strict';

/**
 * Regression test: the Node proxy must forward the stop-flag actions to Apps
 * Script unchanged —
 *   - POST /api/sheets {action:'flagStop', secret, ...}  → body forwarded incl. secret
 *   - GET  /api/sheets?action=getStopFlags               → action forwarded
 * server.js needs no per-action code for these (it passes the POST body and the
 * GET action through), so this locks that pass-through for the new actions.
 *
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Strategy mirrors debt-status-forwarding.test.js: stub global.fetch BEFORE
 * requiring server.js, capture the outbound call, fire a real HTTP request.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31741;
const SHEETS_URL = 'https://script.example.com/macros/s/AKfycb/exec';
const SECRET = 'stop-flag-sekret-789';

process.env.PORT = String(TEST_PORT);
process.env.SHEETS_URL = SHEETS_URL;

let captured = null;
global.fetch = async (url, opts) => {
  captured = { url, opts: opts || {} };
  return {
    status: 200,
    text: async () => JSON.stringify({ ok: true, flags: [] }),
  };
};

const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1', port: TEST_PORT, path, method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try { await httpRequest('GET', '/healthz'); return; }
    catch (_) { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start listening');
}

test('POST /api/sheets forwards the flagStop body incl. secret to Apps Script', async () => {
  await waitForListen();
  captured = null;

  const res = await httpRequest('POST', '/api/sheets', {
    action: 'flagStop', secret: SECRET, phone: '050-1234567', name: 'אורי',
    reportedBy: 'מטפלת', note: 'הפסיק להגיע',
  });

  assert.equal(res.status, 200);
  assert.ok(captured, 'upstream fetch should have been called');
  assert.ok(String(captured.url).startsWith(SHEETS_URL), `got: ${captured.url}`);
  assert.equal((captured.opts.method || '').toUpperCase(), 'POST');
  const forwarded = JSON.parse(captured.opts.body);
  assert.equal(forwarded.action, 'flagStop');
  assert.equal(forwarded.secret, SECRET, 'secret must be forwarded for the fail-closed write');
  assert.equal(forwarded.phone, '050-1234567');
  assert.equal(forwarded.name, 'אורי');
});

test('GET /api/sheets forwards action=getStopFlags', async () => {
  await waitForListen();
  captured = null;

  const res = await httpRequest('GET', '/api/sheets?action=getStopFlags');

  assert.equal(res.status, 200);
  assert.ok(captured, 'upstream fetch should have been called');
  assert.ok(String(captured.url).includes('action=getStopFlags'), `got: ${captured.url}`);
});
