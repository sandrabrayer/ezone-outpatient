'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configuredOrigin, readPublic, checkPublic, ALLOWED_PATHS } = require('../scripts/public-healthcheck');

const ORIGIN = 'https://example.test';
const SHA = 'a'.repeat(40);
function canned(overrides) {
  const responses = Object.assign({
    '/api/version': { commit: SHA, builtAt: '2026-11-22T00:00:00Z' },
    '/healthz': { ok: true },
    '/': '<html><title>E-ZONE Outpatient</title></html>'
  }, overrides || {});
  const seen = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    seen.push({ path, init });
    assert.equal(new URL(url).origin, ORIGIN);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(!init.headers.Authorization);
    assert.ok(!init.headers.Cookie);
    assert.ok(!init.body);
    const spec = responses[path];
    if (!spec) throw new Error('unexpected endpoint ' + path);
    const code = spec && typeof spec === 'object' && spec.status ? spec.status : 200;
    const data = code !== 200 ? { ok: false } : spec;
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    return new Response(content, { status: code });
  };
  return { fetcher, seen };
}
test('public check is healthy and makes EXACTLY three data-free requests', async () => {
  const { fetcher, seen } = canned();
  assert.deepEqual(await checkPublic({ env: { APP_URL: ORIGIN }, fetcher }),
    { ok: true, commit: SHA, checks: 3, publicOnly: true });
  assert.deepEqual(seen.map(x => x.path), ['/api/version', '/healthz', '/']);
  assert.deepEqual(ALLOWED_PATHS, ['/', '/api/version', '/healthz']);
});
test('no protected data endpoint can be requested even with injected caller', async () => {
  let calls = 0;
  await assert.rejects(() => readPublic(async () => { calls++; }, ORIGIN, '/api/sheets'), /endpoint_not_allowed/);
  assert.equal(calls, 0);
});
test('unhealthy service fails without reading protected data', async () => {
  await assert.rejects(() => checkPublic({ env: { APP_URL: ORIGIN }, fetcher: canned({ '/healthz': { ok: false } }).fetcher }),
    /healthz: not_ready/);
});
test('wrong or stale release fingerprint fails', async () => {
  await assert.rejects(() => checkPublic({ env: { APP_URL: ORIGIN }, fetcher: canned({ '/api/version': { commit: 'missing' } }).fetcher }),
    /version: invalid_commit/);
});
test('broken shell is detected without authentication', async () => {
  await assert.rejects(() => checkPublic({ env: { APP_URL: ORIGIN }, fetcher: canned({ '/': '<h1>Wrong app</h1>' }).fetcher }),
    /shell: marker_missing/);
});
test('a public endpoint 401 or 5xx is an explicit failure', async () => {
  for (const status of [401, 503]) {
    await assert.rejects(() => checkPublic({ env: { APP_URL: ORIGIN }, fetcher: canned({ '/healthz': { status } }).fetcher }),
      new RegExp('healthz: HTTP ' + status));
  }
});
test('oversized public responses are rejected before processing', async () => {
  const large = 'x'.repeat(40000);
  await assert.rejects(() => checkPublic({ env: { APP_URL: ORIGIN }, fetcher: canned({ '/': large }).fetcher }),
    /response_too_large/);
});
test('invalid or unsafe origin is refused', () => {
  for (const value of ['http://example.test', 'https://example.test/path', 'https://x@y.example.test',
    'https://example.test/?secret=1', 'https://example.test/#fragment']) {
    assert.throws(() => configuredOrigin({ APP_URL: value }), /APP_URL must be/);
  }
  assert.equal(configuredOrigin({ APP_URL: ORIGIN }), ORIGIN);
});
