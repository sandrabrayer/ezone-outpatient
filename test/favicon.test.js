'use strict';

/**
 * favicon.test.js — browser-tab favicon (letter "O", app palette).
 *  - the icon files exist and are byte-identical to scripts/gen-favicons.js output
 *  - /favicon.ico (+ .svg / -16x16 / -32x32) are public: 200 + image type, no cookie
 *  - exact static paths only: no traversal, no other file served under those names
 *  - EVERY HTML page under public/ (and every page the server serves) carries the
 *    root-absolute <link rel="icon"> tags
 *  - the service-worker cache was bumped so installed PWAs pick the icons up
 * Run with:  npm test     (Node >= 18, built-in test runner)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
process.env.APP_PIN = '424242';
process.env.SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef';
global.fetch = async () => ({ status: 200, text: async () => '{"ok":true}' });

const PUB = path.join(__dirname, '..', 'public');
const Gen = require('../scripts/gen-favicons.js');
const app = require('../server.js');

const LETTER = 'O';
const SW_FLOOR = 16;
const SERVED_PAGES = ['/', '/index.html'];

const ICONS = {
  '/favicon.ico': 'image/x-icon',
  '/favicon.svg': 'image/svg+xml',
  '/favicon-16x16.png': 'image/png',
  '/favicon-32x32.png': 'image/png'
};
const LINK_TAGS = [
  /<link rel="icon" href="\/favicon\.ico" sizes="32x32"\s*\/?>/,
  /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"\s*\/?>/,
  /<link rel="icon" href="\/favicon-32x32\.png" type="image\/png" sizes="32x32"\s*\/?>/,
  /<link rel="icon" href="\/favicon-16x16\.png" type="image\/png" sizes="16x16"\s*\/?>/
];

let server;
let port;
test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});
test.after(() => new Promise((r) => server.close(r)));

function request(pathname, method) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: pathname, method: method || 'GET' }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    r.on('error', reject);
    r.end();
  });
}

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

// ---- files -------------------------------------------------------------------

test('icon files exist and match the generator output byte for byte', () => {
  const built = Gen.build();
  assert.deepEqual(Object.keys(built).sort(), ['favicon-16x16.png', 'favicon-32x32.png', 'favicon.ico', 'favicon.svg']);
  for (const [name, bytes] of Object.entries(built)) {
    const file = path.join(PUB, name);
    assert.ok(fs.existsSync(file), `public/${name} exists`);
    assert.ok(fs.readFileSync(file).equals(bytes), `public/${name} is stale — run node scripts/gen-favicons.js`);
  }
});

test('PNG favicons have the size their name says', () => {
  for (const s of [16, 32]) {
    const buf = fs.readFileSync(path.join(PUB, `favicon-${s}x${s}.png`));
    assert.equal(buf.readUInt32BE(0), 0x89504e47, 'PNG signature');
    assert.equal(buf.readUInt32BE(16), s, 'width');
    assert.equal(buf.readUInt32BE(20), s, 'height');
  }
});

test('favicon.ico is a valid ICO holding 16, 32 and 48 px PNG entries', () => {
  const buf = fs.readFileSync(path.join(PUB, 'favicon.ico'));
  assert.equal(buf.readUInt16LE(0), 0, 'reserved');
  assert.equal(buf.readUInt16LE(2), 1, 'type = icon');
  const n = buf.readUInt16LE(4);
  const sizes = [];
  for (let k = 0; k < n; k++) {
    const d = 6 + k * 16;
    const len = buf.readUInt32LE(d + 8);
    const off = buf.readUInt32LE(d + 12);
    assert.ok(off + len <= buf.length, 'entry inside file');
    assert.equal(buf.readUInt32BE(off), 0x89504e47, 'entry is a PNG');
    sizes.push(buf[d]);
  }
  assert.deepEqual(sizes, [16, 32, 48]);
});

test('favicon.svg is a plain static vector (no script, no external refs)', () => {
  const svg = fs.readFileSync(path.join(PUB, 'favicon.svg'), 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 16 16"/);
  assert.doesNotMatch(svg, /<script|on\w+=|href=|<foreignObject/i);
});

test(`the 16px mark is the letter ${LETTER} in the app palette`, () => {
  const px = Gen.render(16);
  const at = (x, y) => Array.from(px.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
  const fg = Gen.APP.fg.concat(255);
  const bg = Gen.APP.bg.concat(255);
  assert.equal(Gen.APP.letter, LETTER);
  assert.equal(at(0, 0)[3] < 255, true, 'rounded corner is (partly) transparent');
  if (LETTER === 'T') {
    assert.deepEqual(at(4, 4), fg, 'top bar');
    assert.deepEqual(at(8, 10), fg, 'stem');
    assert.deepEqual(at(4, 10), bg, 'ground beside the stem');
  } else {
    assert.deepEqual(at(8, 8), bg, 'hole in the O');
    assert.deepEqual(at(8, 3), fg, 'top of the ring');
  }
});

// ---- routes ------------------------------------------------------------------

for (const [route, type] of Object.entries(ICONS)) {
  test(`GET ${route} is public (no cookie) and served as ${type}`, async () => {
    const r = await request(route);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'].split(';')[0], type);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['cache-control'], /max-age=86400/);
    assert.ok(r.body.equals(fs.readFileSync(path.join(PUB, route.slice(1)))), 'serves the committed file');
  });
}

test('HEAD /favicon.ico answers 200 with an image type', async () => {
  const r = await request('/favicon.ico', 'HEAD');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^image\//);
});

test('favicon.svg is served under a script-free CSP', async () => {
  const r = await request('/favicon.svg');
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
});

test('no traversal, listing or look-alike path is served as an icon', async () => {
  const probes = ['/favicon.ico/../server.js', '/%2e%2e/server.js', '/favicon.ico%2f..%2f..%2fserver.js',
    '/favicon-99x99.png', '/favicon.ico.bak', '/scripts/gen-favicons.js', '/public/'];
  for (const p of probes) {
    const r = await request(p);
    const body = r.body.toString('utf8');
    assert.doesNotMatch(String(r.headers['content-type'] || ''), /^image\//, `${p} must not be an icon`);
    assert.ok(!body.includes("require('express')") && !body.includes('gen-favicons'), `${p} must not leak source`);
    assert.ok(!/Index of \//.test(body), `${p} must not list a directory`);
  }
});

// ---- HTML pages ----------------------------------------------------------------

test('every HTML file under public/ carries the root-absolute icon links', () => {
  const pages = htmlFiles(PUB);
  assert.ok(pages.length >= 1);
  for (const file of pages) {
    const head = fs.readFileSync(file, 'utf8').split(/<\/head>/i)[0];
    for (const tag of LINK_TAGS) assert.match(head, tag, `${path.relative(PUB, file)} <head> missing ${tag}`);
  }
});

test('every page the server serves (incl. the sign-in screen) carries the icon links', async () => {
  for (const p of SERVED_PAGES) {
    const r = await request(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers['content-type'], /text\/html/, p);
    const head = r.body.toString('utf8').split(/<\/head>/i)[0];
    for (const tag of LINK_TAGS) assert.match(head, tag, `${p} missing ${tag}`);
  }
});

test(`service-worker cache bumped to v${SW_FLOOR}+ so installed apps refresh`, () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  const m = sw.match(/var CACHE = '[a-z-]+-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= SW_FLOOR, `cache version must be >= v${SW_FLOOR}`);
});
