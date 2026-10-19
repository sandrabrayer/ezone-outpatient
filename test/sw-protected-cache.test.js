'use strict';
// Executes the REAL public/sw.js in a VM with a Cache API double: encoded / re-cased aliases of the
// price & pay files are never intercepted, never cached, never served from cache; no-store / private
// responses are not cached; previously stored aliases are evicted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

function makeSw(networkImpl) {
  const stores = new Map();
  const listeners = {};
  const cacheApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async put(req, res) { m.set(typeof req === 'string' ? req : req.url, res); },
        async addAll() {},
        async keys() { return [...m.keys()].map((u) => ({ url: u })); },
        async delete(r) { return m.delete(r.url); },
        async match(r) { return m.get(typeof r === 'string' ? r : r.url); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
    async match(r) { for (const m of stores.values()) { const h = m.get(typeof r === 'string' ? r : r.url); if (h) return h; } return undefined; }
  };
  const self = { location: { origin: 'http://x.test' }, addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
  const ctx = { self, caches: cacheApi, fetch: networkImpl, URL, Promise, console };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  async function fetchEvent(url) {
    let responded; let waits = [];
    const ev = { request: { method: 'GET', url: 'http://x.test' + url }, respondWith: (p) => { responded = p; }, waitUntil: (p) => waits.push(p) };
    listeners.fetch(ev);
    const res = responded ? await responded : undefined;
    await new Promise((r) => setTimeout(r, 5));
    return { intercepted: !!responded, res };
  }
  return { stores, listeners, cacheApi, fetchEvent };
}
const resp = (body, cc) => ({ ok: true, status: 200, body, headers: { get: (h) => (/cache-control/i.test(h) ? cc || null : null) }, clone() { return this; } });
const cachedUrls = (sw) => [...sw.stores.values()].flatMap((m) => [...m.keys()]);

const ALIASES = ['/treatment-map.js', '/%74reatment-map.js', '/Treatment-Map.js', '/%2574reatment-map.js', '/therapist-pay.js', '/%74herapist-pay.js', '/x/..%2ftreatment-map.js', '/treatment-map.js%20', '/treatment-map.js%'];

test('protected paths (any spelling) are never intercepted, so never cached nor served from cache', async () => {
  const sw = makeSw(async () => resp('SECRET-PRICES'));
  for (const u of ALIASES) {
    const r = await sw.fetchEvent(u);
    assert.equal(r.intercepted, false, u);
  }
  assert.deepEqual(cachedUrls(sw), []);
});

test('therapist-payout.js (no constants) stays a normal cached asset', async () => {
  const sw = makeSw(async () => resp('logic'));
  const r = await sw.fetchEvent('/therapist-payout.js');
  assert.equal(r.intercepted, true);
  assert.ok(cachedUrls(sw).some((u) => u.endsWith('/therapist-payout.js')));
});

test('no-store / private responses are not written to Cache Storage; plain ones are', async () => {
  for (const cc of ['no-store', 'private', 'max-age=0, No-Store', 'private, max-age=60']) {
    const sw = makeSw(async () => resp('x', cc));
    await sw.fetchEvent('/index.html');
    assert.deepEqual(cachedUrls(sw), [], cc);
  }
  const sw = makeSw(async () => resp('x', 'max-age=60'));
  await sw.fetchEvent('/style.css');
  assert.equal(cachedUrls(sw).length, 1);
});

test('purge-protected (and activate) evict stored aliases under any spelling but keep the shell', async () => {
  const sw = makeSw(async () => resp('x'));
  const c = await sw.cacheApi.open(/var CACHE = '([^']+)'/.exec(SRC)[1]);
  for (const u of ['/%74reatment-map.js', '/treatment-map.js', '/Therapist-Pay.js', '/style.css']) await c.put('http://x.test' + u, resp('old'));
  let p; sw.listeners.message({ data: { type: 'purge-protected' }, waitUntil: (x) => { p = x; } });
  await p;
  assert.deepEqual(cachedUrls(sw), ['http://x.test/style.css']);
  // activate does the same
  await c.put('http://x.test/%74herapist-pay.js', resp('old'));
  let a; sw.listeners.activate({ waitUntil: (x) => { a = x; } });
  await a;
  assert.deepEqual(cachedUrls(sw), ['http://x.test/style.css']);
});
