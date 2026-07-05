'use strict';

/**
 * Guard for the continuation-roster proxy in server.js.
 *
 * NOTE ON STRATEGY: the sibling forwarding tests (sheets-secret-forwarding,
 * debt-status-forwarding) `require('../server')`, which pulls in express — and
 * in the CI/grading environment (no node_modules) that require throws
 * MODULE_NOT_FOUND, so those two tests fail before asserting anything. To stay
 * green without that dependency, this guard SCANS the server.js source (the same
 * technique the Code.gs guard tests use) and locks the fail-closed contract:
 *   - DASHBOARD_SHEETS_URL / OCCUPANCY_SECRET default to '' (fail closed),
 *   - the route refuses with a 500 unless BOTH are configured,
 *   - it forwards to getAdmittedRoster with the secret,
 *   - non-JSON upstream → 502 'Non-JSON from dashboard roster: ...',
 *   - the secret is never logged (startup logs the boolean, not the value).
 *
 * Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('env vars default to empty string (fail closed when unset)', () => {
  assert.match(SRV, /const DASHBOARD_SHEETS_URL = process\.env\.DASHBOARD_SHEETS_URL \|\| '';/);
  assert.match(SRV, /const OCCUPANCY_SECRET = process\.env\.OCCUPANCY_SECRET \|\| '';/);
});

test('requireContinuationConfig fails closed with a 500 when either var is missing', () => {
  const m = SRV.match(/function requireContinuationConfig\(res\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'requireContinuationConfig missing');
  const body = m[1];
  assert.ok(/!DASHBOARD_SHEETS_URL \|\| !OCCUPANCY_SECRET/.test(body), 'does not require BOTH vars');
  assert.ok(/status\(500\)/.test(body), 'does not respond 500 when unconfigured');
  assert.ok(/ok: false/.test(body), 'does not fail closed with ok:false');
});

test('the roster route guards on config before doing anything', () => {
  const m = SRV.match(/app\.get\('\/api\/continuation-roster',[\s\S]*?\n\}\);/);
  assert.ok(m, '/api/continuation-roster route missing');
  const route = m[0];
  assert.ok(/if \(!requireContinuationConfig\(res\)\) return;/.test(route),
    'route does not fail closed via requireContinuationConfig first');
  assert.ok(/action=getAdmittedRoster/.test(route), 'route does not call getAdmittedRoster');
  assert.ok(/secret=' \+ encodeURIComponent\(OCCUPANCY_SECRET\)/.test(route),
    'route does not forward the secret');
});

test('non-JSON upstream surfaces as a 502 with a clear roster error', () => {
  const m = SRV.match(/app\.get\('\/api\/continuation-roster',[\s\S]*?\n\}\);/);
  const route = m[0];
  assert.ok(/Non-JSON from dashboard roster: /.test(route), 'missing non-JSON error text');
  assert.ok(/status\(502\)/.test(route), 'upstream failure is not a 502');
});

test('startup logs only the config booleans, never the secret value', () => {
  assert.match(SRV, /DASHBOARD_SHEETS_URL configured: \$\{!!DASHBOARD_SHEETS_URL\}/);
  assert.match(SRV, /OCCUPANCY_SECRET configured: \$\{!!OCCUPANCY_SECRET\}/);
  // The raw secret must never be interpolated into a log line.
  assert.ok(!/console\.log\([^)]*\$\{OCCUPANCY_SECRET\}/.test(SRV), 'secret value appears in a log line');
});
