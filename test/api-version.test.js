'use strict';

/**
 * GET /api/version — public deploy-verification endpoint.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Contract:
 *   - public (no session cookie needed), Cache-Control: no-store
 *   - body is EXACTLY { commit, builtAt } — nothing else leaks
 *   - commit = RAILWAY_GIT_COMMIT_SHA, validated as hex; malformed -> null
 *
 * External HTTP is mocked; env values are dummy fixtures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildVersion, normalizeCommit } = require('../lib/version');

const TEST_PORT = 31846;
const DUMMY_SHA = '0123456789abcdef0123456789abcdef01234567';

process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = '424242';
process.env.SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef';
process.env.RAILWAY_GIT_COMMIT_SHA = DUMMY_SHA;

global.fetch = async () => ({ status: 200, text: async () => '{"ok":true}' });

const app = require('../server');
let server;
test.before(() => { server = app.start(TEST_PORT); });
test.after(() => { if (server) server.close(); });

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: TEST_PORT, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* non-JSON */ }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try { await get('/healthz'); return; }
    catch (_) { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start listening');
}

test('GET /api/version is public, no-store, and returns only {commit, builtAt}', async () => {
  await waitForListen();
  const res = await get('/api/version');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['content-type'], /application\/json/);
  assert.deepEqual(Object.keys(res.json).sort(), ['builtAt', 'commit']);
  assert.equal(res.json.commit, DUMMY_SHA);
  assert.ok(!Number.isNaN(Date.parse(res.json.builtAt)), 'builtAt is an ISO date');
});

test('normalizeCommit accepts short and full hex SHAs, lowercases them', () => {
  assert.equal(normalizeCommit('abc1234'), 'abc1234');
  assert.equal(normalizeCommit('  ABC1234  '), 'abc1234');
  assert.equal(normalizeCommit(DUMMY_SHA), DUMMY_SHA);
});

test('normalizeCommit returns null for unset / malformed values (no env echo)', () => {
  assert.equal(normalizeCommit(undefined), null);
  assert.equal(normalizeCommit(''), null);
  assert.equal(normalizeCommit('abc12'), null, 'too short');
  assert.equal(normalizeCommit('a'.repeat(41)), null, 'too long');
  assert.equal(normalizeCommit('<script>alert(1)</script>'), null);
  assert.equal(normalizeCommit('secret-value'), null);
  assert.equal(normalizeCommit(1234567), null);
});

test('buildVersion yields commit null when RAILWAY_GIT_COMMIT_SHA is absent', () => {
  const v = buildVersion({}, 0);
  assert.deepEqual(v, { commit: null, builtAt: '1970-01-01T00:00:00.000Z' });
});
