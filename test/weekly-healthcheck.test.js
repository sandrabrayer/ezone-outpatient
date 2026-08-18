'use strict';

/**
 * Tests for scripts/healthcheck.js (the weekly live healthcheck).
 *
 * Same pattern as the rest of the suite: node:test + fully mocked HTTP — the
 * fetch implementation is INJECTED (opts.fetchImpl), so no test can ever reach
 * the live Railway URL or the live Apps Script. Fixtures are built from the
 * REAL header arrays parsed out of apps-script/Code.gs, so a schema change in
 * Code.gs automatically flows into these fixtures.
 *
 * No real secret appears anywhere in this file — DUMMY_PIN is a fixture.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hc = require('../scripts/healthcheck');

const DUMMY_PIN = '424242';
const BASE = 'https://healthcheck.test.invalid';

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const CLIENTS_HEADERS = hc.parseHeadersFromSource(GS, 'CLIENTS_HEADERS');

function fullClient(overrides) {
  const c = {};
  CLIENTS_HEADERS.forEach(function (h) { c[h] = ''; });
  c.id = 'c1';
  c.startDate = '2026-01-05';
  c.paymentDate = '2026-07-01';
  c.nextBillingDate = '2026-08-01';
  return Object.assign(c, overrides || {});
}

/* Canned OK payloads for every endpoint the healthcheck touches. */
function okPayloads(overrides) {
  const p = {
    '/': '<!doctype html><html><body>E-ZONE Outpatient</body></html>',
    'verify-pin': { status: 200, json: { ok: true } },
    'action=getPayments': { ok: true, payments: [{ id: 'p1', clientId: 'c1', dueDate: '2026-07-01', paymentDate: '2026-07-02' }] },
    'action=getCharges': { ok: true, charges: [{ id: 'ch1', clientId: 'c1', chargeDate: '2026-07-03' }] },
    'action=getStopFlags': { ok: true, stopFlags: [] },
    'action=getExtraSessionRequests': { ok: true, requests: [] },
    'action=getSettings': { ok: true, settings: {} },
    'action=getMyStopAlerts': { ok: true, myStopAlerts: [] },
    'action=getSessionLog': { ok: true, sessionLog: [] },
    getData: { ok: true, leads: [], clients: [fullClient()] }
  };
  return Object.assign(p, overrides || {});
}

/* Route a request URL to its canned payload. getData is the bare /api/sheets
 * call (no action param) — matched last. */
function mockFetch(payloads) {
  return async function (url, init) {
    url = String(url);
    let body;
    if (init && init.method === 'POST' && url.indexOf('/api/verify-pin') !== -1) {
      const spec = payloads['verify-pin'];
      return {
        status: spec.status,
        headers: { getSetCookie: function () { return spec.cookies || []; } },
        text: async function () { return JSON.stringify(spec.json); }
      };
    }
    if (url.indexOf('/api/sheets') !== -1) {
      const key = Object.keys(payloads).find(function (k) {
        return k.indexOf('action=') === 0 && url.indexOf(k) !== -1;
      });
      body = key ? payloads[key] : payloads.getData;
    } else {
      body = payloads['/'];
    }
    return {
      status: 200,
      headers: { getSetCookie: function () { return []; } },
      text: async function () { return typeof body === 'string' ? body : JSON.stringify(body); }
    };
  };
}

function run(payloads) {
  return hc.runHealthcheck({ appUrl: BASE, appPin: DUMMY_PIN, fetchImpl: mockFetch(payloads) });
}

/* ===== happy path ========================================================= */

test('all endpoints healthy -> no criticals, no warnings', async () => {
  const r = await run(okPayloads());
  assert.deepEqual(r.criticals, []);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.notes.some((n) => n.includes('stateless')), 'notes explain the no-cookie login');
  assert.ok(r.notes.some((n) => n.includes('TherapistRates')), 'TherapistRates skip is noted');
});

/* ===== criticals ========================================================== */

test('HTML instead of JSON on a loadAll endpoint is CRITICAL (Google error page)', async () => {
  const r = await run(okPayloads({ 'action=getPayments': '<html><body>Google Drive error</body></html>' }));
  assert.ok(r.criticals.some((c) => c.includes('getPayments') && c.includes('HTML')));
  // the raw body must never be echoed into CI output
  assert.ok(!r.criticals.join('\n').includes('Google Drive error'));
});

test('missing expected top-level key is CRITICAL', async () => {
  const r = await run(okPayloads({ 'action=getCharges': { ok: true } }));
  assert.ok(r.criticals.some((c) => c.includes('getCharges') && c.includes('charges')));
});

test('ok:false payload is CRITICAL', async () => {
  const r = await run(okPayloads({ 'action=getStopFlags': { ok: false, error: 'boom' } }));
  assert.ok(r.criticals.some((c) => c.includes('getStopFlags') && c.includes('ok:false')));
});

test('client missing a CLIENTS_HEADERS field is CRITICAL (positional drift)', async () => {
  const broken = fullClient();
  delete broken.creditsOwed;
  const r = await run(okPayloads({ getData: { ok: true, leads: [], clients: [broken] } }));
  assert.ok(r.criticals.some((c) => c.includes('clients schema') && c.includes('creditsOwed')));
});

test('PIN rejected (401) is CRITICAL and never echoes the PIN', async () => {
  const r = await run(okPayloads({ 'verify-pin': { status: 401, json: { ok: false, error: 'Incorrect PIN.' } } }));
  assert.ok(r.criticals.some((c) => c.includes('PIN rejected')));
  const all = JSON.stringify([r.criticals, r.warnings, r.notes]);
  assert.ok(!all.includes(DUMMY_PIN), 'PIN value must never appear in output');
});

test('missing shell marker on / is CRITICAL', async () => {
  const r = await run(okPayloads({ '/': '<html><body>Something else entirely</body></html>' }));
  assert.ok(r.criticals.some((c) => c.includes('app shell') && c.includes('marker')));
});

/* ===== warnings (run stays green) ========================================= */

test('blank client id is a WARNING, not critical', async () => {
  const r = await run(okPayloads({ getData: { ok: true, leads: [], clients: [fullClient(), fullClient({ id: '' })] } }));
  assert.deepEqual(r.criticals, []);
  assert.ok(r.warnings.some((w) => w.includes('blank/missing client id')));
});

test('malformed date is a WARNING with ids only', async () => {
  const r = await run(okPayloads({
    getData: { ok: true, leads: [], clients: [fullClient({ paymentDate: '01/07/2026' })] }
  }));
  assert.deepEqual(r.criticals, []);
  assert.ok(r.warnings.some((w) => w.includes('clients.paymentDate') && w.includes('c1')));
});

test('SessionLog no_match rows are counted as a WARNING', async () => {
  const r = await run(okPayloads({
    'action=getSessionLog': {
      ok: true,
      sessionLog: [
        { sessionId: 's1', matchStatus: 'matched' },
        { sessionId: 's2', matchStatus: 'no_match' },
        { sessionId: 's3', matchStatus: 'no_match' }
      ]
    }
  }));
  assert.deepEqual(r.criticals, []);
  assert.ok(r.warnings.some((w) => w.includes('2 row(s)') && w.includes('no_match')));
});

test('empty clients dataset SKIPS the schema check with a note, not a failure', async () => {
  const r = await run(okPayloads({ getData: { ok: true, leads: [], clients: [] } }));
  assert.deepEqual(r.criticals, []);
  assert.ok(r.notes.some((n) => n.includes('skipped') && n.includes('empty clients dataset')));
});

/* ===== config errors ====================================================== */

test('missing APP_PIN -> clear critical, no network call, no secret echoed', async () => {
  let fetched = false;
  const r = await hc.runHealthcheck({
    appUrl: BASE,
    appPin: '',
    fetchImpl: async () => { fetched = true; throw new Error('must not be called'); }
  });
  assert.equal(fetched, false, 'no HTTP request may be made without a PIN');
  assert.equal(r.criticals.length, 1);
  assert.ok(r.criticals[0].includes('APP_PIN'));
  assert.ok(r.criticals[0].includes('never printed'));
});

/* ===== pure helpers ======================================================= */

test('classifyBody: HTML / JSON / invalid', () => {
  assert.equal(hc.classifyBody('  <html>err</html>').kind, 'html');
  assert.equal(hc.classifyBody('{"ok":true}').kind, 'json');
  const inv = hc.classifyBody('not json at all');
  assert.equal(inv.kind, 'invalid');
  assert.equal(inv.firstChar, 'n');
});

test('dateFieldsOf derives every *Date column from the real schemas', () => {
  const clientDates = hc.dateFieldsOf(CLIENTS_HEADERS);
  ['startDate', 'exitDate', 'paymentDate', 'nextBillingDate', 'packageChangeDate'].forEach((f) => {
    assert.ok(clientDates.includes(f), f + ' must be detected as a date column');
  });
  assert.ok(!clientDates.includes('billingDay'));
  const payDates = hc.dateFieldsOf(hc.parseHeadersFromSource(GS, 'PAYMENTS_HEADERS'));
  assert.ok(payDates.includes('dueDate') && payDates.includes('paymentDate'));
});

test('parseHeadersFromSource extracts the append-only CLIENTS_HEADERS (33+ cols, frozen prefix)', () => {
  assert.ok(Array.isArray(CLIENTS_HEADERS));
  assert.ok(CLIENTS_HEADERS.length >= 33, 'append-only: never fewer than the frozen 33');
  assert.equal(CLIENTS_HEADERS[0], 'id');
  assert.equal(CLIENTS_HEADERS.indexOf('phone'), 25, 'phone join key stays at index 25');
});

test('ENDPOINTS mirror the loadAll Promise.all reads in public/app.js', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const loadAllBody = appJs.slice(appJs.indexOf('async function loadAll'), appJs.indexOf('async function loadAll') + 2500);
  const actions = { getPayments: 1, getCharges: 1, getStopFlags: 1, getExtraSessionRequests: 1, getSettings: 1, getMyStopAlerts: 1 };
  Object.keys(actions).forEach((a) => {
    const fnName = 'api' + { getPayments: 'GetPayments', getCharges: 'GetCharges', getStopFlags: 'GetStopFlags', getExtraSessionRequests: 'GetExtraRequests', getSettings: 'LoadSettings', getMyStopAlerts: 'GetMyStopAlerts' }[a];
    assert.ok(loadAllBody.includes(fnName + '('), fnName + ' must be fired by loadAll');
    assert.ok(hc.ENDPOINTS.some((e) => e.name === a), a + ' must be covered by the healthcheck');
  });
  assert.ok(loadAllBody.includes('apiLoad('), 'the main getData read is in loadAll');
  assert.ok(hc.ENDPOINTS.some((e) => e.name === 'getData'));
});
