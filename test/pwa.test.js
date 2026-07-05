'use strict';

/**
 * Guard tests for the mobile / PWA layer.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * These lock the PWA contract so a future edit cannot silently break
 * installability, freshness (network-first, /api/ never cached), or the
 * versioned-icon discipline required to dodge Android's launcher icon cache.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

const manifestRaw = read('manifest.webmanifest');
const swRaw = read('sw.js');
const indexRaw = read('index.html');

test('1. manifest parses and carries the core identity fields', () => {
  const m = JSON.parse(manifestRaw);
  assert.strictEqual(m.name, 'E-ZONE Outpatient');
  assert.strictEqual(m.lang, 'he');
  assert.strictEqual(m.dir, 'rtl');
  assert.strictEqual(m.display, 'standalone');
  assert.ok(m.start_url, 'start_url present');
  assert.ok(m.scope, 'scope present');
});

test('2. manifest icons cover 192 any / 512 any / 512 maskable and exist on disk', () => {
  const m = JSON.parse(manifestRaw);
  const key = (i) => `${i.sizes} ${i.purpose}`;
  const have = new Set(m.icons.map(key));
  assert.ok(have.has('192x192 any'), '192 any present');
  assert.ok(have.has('512x512 any'), '512 any present');
  assert.ok(have.has('512x512 maskable'), '512 maskable present');
  for (const icon of m.icons) {
    assert.match(icon.src, /^icon-v\d+-/, `icon src is versioned: ${icon.src}`);
    assert.ok(fs.existsSync(path.join(PUB, icon.src)), `icon file exists: ${icon.src}`);
  }
});

test('3. sw.js declares a versioned cache name', () => {
  assert.match(swRaw, /var CACHE = 'ezone-outpatient-v\d+'/);
});

test('4. sw.js short-circuits /api/ before it ever calls respondWith', () => {
  const apiIdx = swRaw.indexOf("url.pathname.indexOf('/api/') === 0");
  const respIdx = swRaw.indexOf('respondWith');
  assert.ok(apiIdx !== -1, '/api/ guard present');
  assert.ok(respIdx !== -1, 'respondWith present');
  assert.ok(apiIdx < respIdx, '/api/ guard comes before respondWith');
});

test('5. sw.js ignores non-GET requests', () => {
  assert.ok(swRaw.includes("req.method !== 'GET'"));
});

test('6. every icon filename mentioned in sw.js is versioned', () => {
  const icons = swRaw.match(/icon-[\w.-]*\.png/g) || [];
  assert.ok(icons.length > 0, 'sw.js references at least one icon');
  for (const name of icons) {
    assert.match(name, /^icon-v\d+-/, `sw.js icon is versioned: ${name}`);
  }
});

test('7. index.html wires manifest + SW + apple-touch-icon, scripts stay cache-busted', () => {
  assert.ok(indexRaw.includes('rel="manifest"'), 'manifest link present');
  assert.ok(indexRaw.includes("serviceWorker.register('sw.js')"), 'SW registration present');
  assert.ok(indexRaw.includes('apple-touch-icon'), 'apple-touch-icon present');
  const srcs = indexRaw.match(/<script\s+src="[^"]+"/g) || [];
  assert.ok(srcs.length > 0, 'at least one external script');
  for (const s of srcs) {
    assert.ok(s.includes('?v=__BUILD__'), `script stays cache-busted: ${s}`);
  }
});

test('8. the service-worker registration is inline (no src on that <script>)', () => {
  const regIdx = indexRaw.indexOf('serviceWorker.register');
  assert.ok(regIdx !== -1, 'registration present');
  const openIdx = indexRaw.lastIndexOf('<script', regIdx);
  assert.ok(openIdx !== -1, 'opening <script> found');
  const head = indexRaw.slice(openIdx, indexRaw.indexOf('>', openIdx));
  assert.ok(!head.includes('src='), 'registration <script> has no src attribute');
});
