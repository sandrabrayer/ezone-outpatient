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
const zlib = require('node:zlib');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

const manifestRaw = read('manifest.webmanifest');
const swRaw = read('sw.js');
const indexRaw = read('index.html');

// Minimal 8-bit RGBA PNG decoder (built-in zlib only) so the icon-colour guards
// stay dependency-free, matching scripts/gen-icons.js.
function decodePngRGBA(file) {
  const buf = fs.readFileSync(path.join(PUB, file));
  assert.strictEqual(buf.readUInt32BE(0), 0x89504e47, `${file} is a PNG`);
  let off = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  assert.strictEqual(bd, 8, `${file} is 8-bit`);
  assert.strictEqual(ct, 6, `${file} is RGBA`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let r;
      if (ft === 0) r = v;
      else if (ft === 1) r = v + a;
      else if (ft === 2) r = v + b;
      else if (ft === 3) r = v + ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[y * stride + x] = r & 0xff;
    }
  }
  return { w, h, data: out };
}

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

// ---- Icon art: BOLD letter-E, green on white -----------------------------

// Classify each opaque pixel as white ground, green letter, or a blend edge.
function near(px, target, tol) {
  return Math.abs(px[0] - target[0]) <= tol && Math.abs(px[1] - target[1]) <= tol && Math.abs(px[2] - target[2]) <= tol;
}
const WHITE = [255, 255, 255];
const GREEN = [0, 200, 83]; // #00c853

// Green ink coverage of an icon, as a fraction of its opaque pixels.
function greenCoverage(src) {
  const { data } = decodePngRGBA(src);
  let white = 0, green = 0, opaque = 0, other = 0, dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue; // ignore any transparent corners
    opaque++;
    const px = [data[i], data[i + 1], data[i + 2]];
    if (near(px, WHITE, 12)) white++;
    else if (near(px, GREEN, 24)) green++;
    else other++;
    if (px[0] < 40 && px[1] < 60 && px[2] < 50) dark++;
  }
  return { white, green, opaque, other, dark, frac: green / opaque };
}

test('9. sw.js cache version was bumped to v4 so old icons purge on activate', () => {
  const m = swRaw.match(/var CACHE = 'ezone-outpatient-v(\d+)'/);
  assert.ok(m, 'CACHE version string present');
  assert.ok(Number(m[1]) >= 4, `cache version bumped to v4+ (got v${m[1]})`);
});

test('10. every icon is a green letter on a white ground, no leftover dark background', () => {
  const m = JSON.parse(manifestRaw);
  for (const icon of m.icons) {
    const c = greenCoverage(icon.src);
    assert.ok(c.white > c.green, `${icon.src}: white ground dominates (white=${c.white}, green=${c.green})`);
    assert.ok(c.green > c.opaque * 0.02, `${icon.src}: green letter present (green=${c.green})`);
    // Anti-aliased edge pixels are the only "other"; they must stay a minority.
    assert.ok(c.other < c.opaque * 0.10, `${icon.src}: colours are white+green, few blends (other=${c.other}/${c.opaque})`);
    assert.strictEqual(c.dark, 0, `${icon.src}: no leftover dark background pixels`);
  }
});

test('11. the letter-E glyph is BOLD (heavy ink coverage, not a thin logo)', () => {
  const m = JSON.parse(manifestRaw);
  for (const icon of m.icons) {
    const c = greenCoverage(icon.src);
    // A bold glyph filling most of the canvas paints a large share of the icon
    // in ink; the old thin logo covered far less. Maskable sits in its safe
    // zone so it covers proportionally less, but is still visibly heavy.
    const floor = icon.purpose === 'maskable' ? 0.12 : 0.20;
    assert.ok(c.frac >= floor && c.frac <= 0.45,
      `${icon.src}: bold ink coverage ${(c.frac * 100).toFixed(1)}% (expected ${(floor * 100)}%–45%)`);
  }
});

test('12. the maskable icon is a fully-opaque white square (safe-zone padding not cropped)', () => {
  const m = JSON.parse(manifestRaw);
  const maskable = m.icons.find((i) => i.purpose === 'maskable');
  assert.ok(maskable, 'maskable icon declared');
  const { w, h, data } = decodePngRGBA(maskable.src);
  // Every pixel opaque — a transparent corner would look cropped under the mask.
  for (let i = 3; i < data.length; i += 4) {
    assert.strictEqual(data[i], 255, 'maskable pixel fully opaque');
  }
  // The four corners (safe-zone padding) must be white.
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  for (const c of corners) {
    assert.ok(near([data[c], data[c + 1], data[c + 2]], WHITE, 6), 'maskable corner is white');
  }
});
