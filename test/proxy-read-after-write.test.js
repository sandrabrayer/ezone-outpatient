'use strict';

/**
 * Hotfix 2026-11-04 (CHANGELOG-hotfix-stale-save.md): the proxy's getData cache
 * must never be filled by an upstream read that a write overtook.
 *
 * Incident: ורד's package change was refused as a stale-save conflict
 * («ורד / אורן עדכן/ה קודם») although nobody else had edited the row. The
 * /api/sheets GET handler caches the bulk read for 60 s and every write
 * invalidates it — but a GET whose upstream read was already in flight when
 * the write landed came back AFTER the invalidation carrying the PRE-write
 * sheet, and was stored. Every tab reloading in the next 60 s (the conflict
 * reload included) got rows without that write and its who/when stamps, so
 * its next save echoed an old stamp against a changed row: refused, reloaded
 * from the same poisoned cache, refused again.
 *
 * Contract locked here (real server.js + real Code.gs in the sandbox, only the
 * upstream transport faked):
 *   1. a read that lost the race to a write is re-read once and the fresh
 *      answer is served (X-Cache: MISS) — the caller never sees the old sheet;
 *   2. the cache afterwards holds post-write data (next GET is a HIT with the
 *      new stamp), never the pre-write snapshot;
 *   3. ?fresh=1 still bypasses the cache (the conflict reload asks for it);
 *   4. a plain overlapping read with no write in between is cached as before.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createSessionToken } = require('../lib/session');
const { sandbox } = require('../test-support/apps-script-sandbox');

const SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const SESSION = 'fixture-session-key';
const COOKIE = 'ezone_session=' + createSessionToken(SESSION, undefined, undefined, 'ורד');
const CLIENT = { id: 'c1', name: 'מטופל בדיקה', phone: '0500000011', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}',
  status: 'פעיל', pricePerSession: 1200, updatedAt: '2026-11-01T08:00:00.000Z', updatedBy: 'ורד' };

async function fixture(t) {
  const env = { ...process.env };
  const oldFetch = global.fetch;
  const modulePath = require.resolve('../server');
  const sb = sandbox([], [CLIENT]);
  const upstream = { holdReads: [], reads: 0 };
  process.env.SHEETS_URL = 'https://source.invalid/exec';
  process.env.SESSION_SECRET = SESSION;
  process.env.OUTPATIENT_PROXY_SECRET = SECRET;
  global.fetch = async (url, options = {}) => {
    const event = options.method === 'POST'
      ? { parameter: {}, postData: { contents: options.body } }
      : { parameter: Object.fromEntries(new URL(url).searchParams) };
    // The sheet is read NOW (before any hold) — exactly like a slow Apps Script
    // execution whose response is still travelling when a write lands.
    const result = sb.ctx[options.method === 'POST' ? 'doPost' : 'doGet'](event).getContent();
    if (options.method !== 'POST') {
      upstream.reads++;
      const hold = upstream.holdReads.shift();
      if (hold) await hold;
    }
    return { status: 200, text: async () => result };
  };
  delete require.cache[modulePath];
  const app = require('../server');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = oldFetch;
    for (const k of ['SHEETS_URL', 'SESSION_SECRET', 'OUTPATIENT_PROXY_SECRET']) {
      if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    }
    delete require.cache[modulePath];
  });
  function request(method, reqPath, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path: reqPath,
        headers: { Cookie: COOKIE, 'Content-Type': 'application/json' } }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  function saveSessions(n) {
    const clients = sb.get({ action: 'getData', proxySecret: SECRET }).clients;
    clients[0].sessionsPerWeek = '{"פרטני":' + n + '}';
    return request('POST', '/api/sheets', { action: 'saveAll', leads: [], clients });
  }
  const tick = () => new Promise((r) => setTimeout(r, 30));
  return { sb, upstream, request, saveSessions, tick };
}

test('a getData read overtaken by a save is re-read and never cached: the next tab sees the save and its stamp', async (t) => {
  const f = await fixture(t);
  let release;
  f.upstream.holdReads.push(new Promise((r) => { release = r; }));
  const slow = f.request('GET', '/api/sheets');   // upstream read #1 starts, holds its answer
  await f.tick();
  const saved = await f.saveSessions(3);           // the write lands meanwhile
  assert.equal(saved.json.ok, true);
  const newStamp = saved.json.stamps.clients.c1;
  assert.notEqual(newStamp, CLIENT.updatedAt);
  release();
  const first = await slow;
  assert.equal(first.status, 200);
  assert.equal(first.json.clients[0].sessionsPerWeek, '{"פרטני":3}', 'the overtaken read is re-read, not served stale');
  assert.equal(first.json.clients[0].updatedAt, newStamp);
  assert.equal(first.headers['x-cache'], 'MISS');
  assert.equal(f.upstream.reads, 2, 'exactly one re-read');
  const next = await f.request('GET', '/api/sheets');
  assert.equal(next.headers['x-cache'], 'HIT', 'the re-read (post-write) answer is what got cached');
  assert.equal(next.json.clients[0].updatedAt, newStamp, 'the cache holds the post-write stamp');
  assert.equal(next.json.clients[0].sessionsPerWeek, '{"פרטני":3}');
  // The sheet row carries the same stamp the tabs now echo: a save from either tab is not a conflict.
  const again = await f.saveSessions(4);
  assert.equal(again.json.ok, true);
  assert.equal(again.json.conflicts, undefined);
});

test('a read overtaken twice (write during the re-read) is answered uncached (X-Cache: BYPASS) and the cache stays empty', async (t) => {
  const f = await fixture(t);
  let r1, r2;
  f.upstream.holdReads.push(new Promise((r) => { r1 = r; }), new Promise((r) => { r2 = r; }));
  const slow = f.request('GET', '/api/sheets');
  await f.tick();
  await f.saveSessions(2);
  r1();                                            // re-read starts (held)
  await f.tick(); await f.tick();
  await f.saveSessions(3);                         // a second write lands during the re-read
  r2();
  const res = await slow;
  assert.equal(res.headers['x-cache'], 'BYPASS');
  assert.equal(f.upstream.reads, 2, 'bounded: no third read');
  const next = await f.request('GET', '/api/sheets');
  assert.equal(next.headers['x-cache'], 'MISS', 'nothing stale was cached');
  assert.equal(next.json.clients[0].sessionsPerWeek, '{"פרטני":3}');
});

test('?fresh=1 bypasses a valid cache; an undisturbed read is cached as before', async (t) => {
  const f = await fixture(t);
  const a = await f.request('GET', '/api/sheets');
  assert.equal(a.headers['x-cache'], 'MISS');
  const b = await f.request('GET', '/api/sheets');
  assert.equal(b.headers['x-cache'], 'HIT');
  const c = await f.request('GET', '/api/sheets?fresh=1');
  assert.equal(c.headers['x-cache'], 'MISS');
  assert.equal(f.upstream.reads, 2);
});

test('app.js: the stale-conflict and staleSave reloads ask the proxy for a fresh read; ordinary loads keep the cache', () => {
  const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(APP, /var conflictReload = loadAll\(\{ fresh: true \}\)/);
  assert.match(APP, /var staleReload = loadAll\(\{ fresh: true \}\)/);
  assert.match(APP, /async function apiLoad\(fresh\) \{\s*var r = await apiFetch\(fresh \? '\/api\/sheets\?fresh=1' : '\/api\/sheets', \{ cache: 'no-store' \}\);/);
  assert.match(APP, /async function loadAll\(opts\) \{/);
  assert.match(APP, /apiLoad\(!!\(opts && opts\.fresh\)\)/);
  assert.equal((APP.match(/loadAll\(\{ fresh: true \}\)/g) || []).length, 2, 'only the two stale-picture reloads bypass the cache');
});
