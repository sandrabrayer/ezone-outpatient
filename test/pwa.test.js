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

// ---- Icon colour palette (fluorescent-green logo on a dark ground) --------

// Classify each opaque pixel as dark ground, green logo, or a blend edge.
function near(px, target, tol) {
  return Math.abs(px[0] - target[0]) <= tol && Math.abs(px[1] - target[1]) <= tol && Math.abs(px[2] - target[2]) <= tol;
}
const DARK = [7, 20, 16];    // #071410 background
const LOGO = [57, 255, 20];  // #39ff14 fluorescent-green logo
const WHITE = [255, 255, 255];

test('9. sw.js cache version was bumped past v1 so old icons purge on activate', () => {
  const m = swRaw.match(/var CACHE = 'ezone-outpatient-v(\d+)'/);
  assert.ok(m, 'CACHE version string present');
  assert.ok(Number(m[1]) >= 2, `cache version bumped to v2+ (got v${m[1]})`);
});

test('10. every icon carries a dark ground with a fluorescent-green logo', () => {
  const m = JSON.parse(manifestRaw);
  for (const icon of m.icons) {
    const { data } = decodePngRGBA(icon.src);
    let dark = 0, logo = 0, opaque = 0, other = 0, white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue; // ignore transparent corners
      opaque++;
      const px = [data[i], data[i + 1], data[i + 2]];
      if (near(px, DARK, 18)) dark++;
      else if (near(px, LOGO, 40)) logo++;
      else { other++; if (near(px, WHITE, 20)) white++; }
    }
    assert.ok(dark > logo, `${icon.src}: dark ground dominates (dark=${dark}, logo=${logo})`);
    assert.ok(logo > opaque * 0.02, `${icon.src}: green logo present (logo=${logo})`);
    // Anti-aliased edge pixels are the only "other"; they must stay a small minority.
    assert.ok(other < opaque * 0.10, `${icon.src}: colours are dark+green, few blends (other=${other}/${opaque})`);
    // No leftover white ground from the earlier green-on-white recolour.
    assert.strictEqual(white, 0, `${icon.src}: no leftover white ground pixels`);
  }
});

test('11. the maskable icon is a fully-opaque dark square (safe-zone padding not cropped)', () => {
  const m = JSON.parse(manifestRaw);
  const maskable = m.icons.find((i) => i.purpose === 'maskable');
  assert.ok(maskable, 'maskable icon declared');
  const { w, h, data } = decodePngRGBA(maskable.src);
  // Every pixel opaque — a transparent corner would look cropped under the mask.
  for (let i = 3; i < data.length; i += 4) {
    assert.strictEqual(data[i], 255, 'maskable pixel fully opaque');
  }
  // The four corners (safe-zone padding) must be the dark ground.
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  for (const c of corners) {
    assert.ok(near([data[c], data[c + 1], data[c + 2]], DARK, 8), 'maskable corner is dark');
  }
});

// Logo-presence guard: the recoloured original logo glyph must survive the
// colour pass — the fluorescent-green mark has to occupy a real share of each
// icon. A blank/near-empty ground (e.g. a remap that clamped the whole glyph to
// background) would fall below these floors and fail. A pixel counts as "logo"
// when it is closer to the fluorescent green than to the dark ground.
test('12. logo-presence guard: fluorescent-green logo occupies the icon (any >= 5%, maskable >= 3%)', () => {
  const m = JSON.parse(manifestRaw);
  const dist2 = (px, c) => (px[0] - c[0]) ** 2 + (px[1] - c[1]) ** 2 + (px[2] - c[2]) ** 2;
  for (const icon of m.icons) {
    const { data } = decodePngRGBA(icon.src);
    let logo = 0, opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue; // ignore transparent corners
      opaque++;
      const px = [data[i], data[i + 1], data[i + 2]];
      if (dist2(px, LOGO) < dist2(px, DARK)) logo++;
    }
    const cov = logo / opaque;
    const floor = icon.purpose === 'maskable' ? 0.03 : 0.05;
    assert.ok(cov >= floor, `${icon.src} (${icon.purpose}): logo coverage ${(cov * 100).toFixed(1)}% >= ${floor * 100}%`);
  }
});
