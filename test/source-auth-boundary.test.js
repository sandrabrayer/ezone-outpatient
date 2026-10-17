'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const GS = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const PROXY = 'fixture-proxy-key-with-at-least-32-characters';

function fixture(overrides = {}) {
  let touched = 0;
  const calls = [];
  const props = Object.assign({ OUTPATIENT_PROXY_SECRET: PROXY }, overrides);
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
    SpreadsheetApp: { getActiveSpreadsheet() { touched++; throw new Error('unexpected source access'); } },
    LockService: { getScriptLock() { touched++; throw new Error('unexpected lock'); } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType() { return this; }, getContent: () => text }) }
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  // Exercise the real routers/authentication. Stub only business operations;
  // no mirrored authorization decision and no patient/financial records.
  const routes = GS.slice(GS.indexOf('function doGet('), GS.indexOf('/* ===== Nightly integrity job'));
  const names = new Set([...routes.matchAll(/_json\((_[A-Za-z0-9]+)\(/g)].map(m => m[1]));
  for (const name of names) ctx[name] = (...args) => { calls.push({ name, args }); return { ok: true, handler: name }; };
  function request(method, action, credentials = {}, payload = {}) {
    const event = method === 'GET'
      ? { parameter: { action, ...credentials } }
      : { parameter: {}, postData: { contents: JSON.stringify({ action, ...payload, ...credentials }) } };
    return JSON.parse(ctx[method === 'GET' ? 'doGet' : 'doPost'](event).getContent());
  }
  return { ctx, props, calls, request, touched: () => touched };
}

const initial = fixture();
const policies = { GET: { ...initial.ctx.SOURCE_GET_AUTH }, POST: { ...initial.ctx.SOURCE_POST_AUTH } };
for (const [method, actions] of Object.entries(policies)) {
  for (const [action, policyKey] of Object.entries(actions)) {
    test(`${method} ${action}: missing/wrong/unconfigured credentials touch no source`, () => {
      const key = policyKey === 'resolveStopFlag' ? 'OUTPATIENT_PROXY_SECRET' : policyKey;
      const field = key === 'OUTPATIENT_PROXY_SECRET' ? 'proxySecret' : 'secret';
      const good = key === 'OUTPATIENT_PROXY_SECRET' ? PROXY : 'fixture-scoped-' + key;
      const f = fixture({ [key]: good });
      for (const credentials of [{}, { [field]: 'wrong' }, { [field]: '' }, { [field]: { value: good } }]) {
        assert.deepEqual(f.request(method, action, credentials), { ok: false, error: 'unauthorized' });
      }
      for (const missing of [null, '']) {
        f.props[key] = missing;
        assert.deepEqual(f.request(method, action, { [field]: good }), { ok: false, error: 'unauthorized' });
      }
      assert.equal(f.touched(), 0);
      assert.equal(f.calls.length, 0);
    });
    test(`${method} ${action}: scoped authorized request reaches exactly one business handler`, () => {
      const key = policyKey === 'resolveStopFlag' ? 'OUTPATIENT_PROXY_SECRET' : policyKey;
      const field = key === 'OUTPATIENT_PROXY_SECRET' ? 'proxySecret' : 'secret';
      const good = key === 'OUTPATIENT_PROXY_SECRET' ? PROXY : 'fixture-scoped-' + key;
      const f = fixture({ [key]: good });
      assert.equal(f.request(method, action, { [field]: good }).ok, true);
      assert.equal(f.calls.length, 1);
      assert.equal(f.touched(), 0);
    });
  }
}

test('consumer keys cannot read full data or change payments; proxy key cannot impersonate consumers', () => {
  const f = fixture({ DEBT_STATUS_SECRET: 'debt-only', SESSION_OUTCOME_SECRET: 'outcome-only' });
  for (const key of ['debt-only', 'outcome-only']) {
    assert.equal(f.request('GET', 'getData', { secret: key }).ok, false);
    assert.equal(f.request('POST', 'savePayment', { secret: key }).ok, false);
  }
  assert.equal(f.request('GET', 'getDebtStatus', { proxySecret: PROXY }).ok, false);
  assert.equal(f.request('POST', 'recordSessionOutcome', { proxySecret: PROXY }).ok, false);
  assert.equal(f.calls.length, 0);
});

test('resolveStopFlag keeps the phone receiver and by-id internal path distinct', () => {
  const f = fixture({ STOP_FLAG_SECRET: 'stop-only' });
  assert.equal(f.request('POST', 'resolveStopFlag', { secret: 'wrong', proxySecret: PROXY }).ok, false);
  assert.equal(f.request('POST', 'resolveStopFlag', { secret: 'stop-only' }).handler, '_resolveStopFlagByPhone');
  assert.equal(f.request('POST', 'resolveStopFlag', { proxySecret: PROXY }).handler, '_resolveStopFlag');
});

test('existing query-only cross-app POST senders remain compatible; their keys stay scoped', () => {
  const f = fixture({ STOP_FLAG_SECRET: 'stop-only', SESSION_OUTCOME_SECRET: 'outcome-only', CREATE_LEAD_SECRET: 'lead-only' });
  for (const [action, secret, handler] of [
    ['flagStop', 'stop-only', '_flagStop'],
    ['recordSessionOutcome', 'outcome-only', '_recordSessionOutcome'],
    ['createLead', 'lead-only', '_createLead']
  ]) {
    const event = { parameter: { action, secret }, postData: { contents: JSON.stringify({ phone: '0500000001' }) } };
    const result = JSON.parse(f.ctx.doPost(event).getContent());
    assert.equal(result.handler, handler);
    event.parameter.secret = 'wrong';
    assert.equal(JSON.parse(f.ctx.doPost(event).getContent()).ok, false);
  }
  assert.equal(f.calls.length, 3);
});

test('a short configured proxy key and default unauthenticated requests are rejected', () => {
  const f = fixture({ OUTPATIENT_PROXY_SECRET: 'short' });
  assert.equal(f.request('GET', 'getData', { proxySecret: 'short' }).ok, false);
  assert.equal(JSON.parse(f.ctx.doGet({ parameter: {} }).getContent()).ok, false);
  assert.equal(JSON.parse(f.ctx.doPost({ parameter: {}, postData: { contents: '{}' } }).getContent()).ok, false);
  assert.equal(f.calls.length, 0);
});

test('wrong methods, unknown/prototype actions and legacy GET save cannot write, even with valid keys', () => {
  const f = fixture();
  for (const action of ['saveAll', 'savePayment', 'saveCredit', '__proto__', 'constructor', 'unknown']) {
    assert.equal(f.request('GET', action, { proxySecret: PROXY }).ok, false);
  }
  assert.equal(f.request('POST', 'unknown', { proxySecret: PROXY }).ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.touched(), 0);
});

test('malformed/null/array POST payloads never reach default saveAll', () => {
  const f = fixture();
  for (const contents of ['{', 'null', '[]', '"string"']) {
    const result = JSON.parse(f.ctx.doPost({ parameter: { proxySecret: PROXY }, postData: { contents } }).getContent());
    assert.equal(result.ok, false);
  }
  assert.equal(f.calls.length, 0);
});

test('all dispatched actions have an explicit auth policy; new routes cannot silently bypass authentication', () => {
  const get = GS.slice(GS.indexOf('function doGet('), GS.indexOf('function doPost('));
  const post = GS.slice(GS.indexOf('function doPost('), GS.indexOf('/* ===== Nightly integrity job'));
  for (const [method, source] of [['GET', get], ['POST', post]]) {
    const dispatched = [...new Set([...source.matchAll(/action === '([^']+)'/g)].map(m => m[1]))].sort();
    assert.deepEqual(dispatched, Object.keys(policies[method]).sort());
  }
});

test('Node-first deployment gate refuses wrong commit, missing readiness, and HTTP/network failures', async () => {
  const { proxyReady } = require('../scripts/wait-for-source-proxy');
  const sha = 'a'.repeat(40);
  const fetcher = (commit = sha, ready = true, httpOk = true) => async url => ({ ok: httpOk, json: async () => url.endsWith('/api/version') ? { commit } : { ok: ready } });
  assert.equal(await proxyReady(fetcher(), sha), true);
  assert.equal(await proxyReady(fetcher('b'.repeat(40)), sha), false);
  assert.equal(await proxyReady(fetcher(sha, false), sha), false);
  assert.equal(await proxyReady(fetcher(sha, true, false), sha), false);
  assert.equal(await proxyReady(async () => { throw new Error('network'); }, sha), false);
  assert.equal(await proxyReady(fetcher(), ''), false);
});
