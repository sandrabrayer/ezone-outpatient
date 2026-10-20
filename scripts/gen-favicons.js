'use strict';

/**
 * Browser-tab favicon generator — no external dependencies (Node's built-in
 * `zlib` only).
 *
 * Draws ONE distinct, high-contrast letter on a rounded square, in this app's
 * existing PWA palette (same dark ground + accent as icon-v1-*.png), so the
 * app is identifiable among many tabs even at 16px:
 *   ezone-therapists  ->  "T", pink #e873bc on dark plum #2c1a28
 *   ezone-outpatient  ->  "O", green #39ff14 on dark green #071410
 *
 * Geometry lives on a 16-unit grid (GEOMETRY below), so straight edges land on
 * whole pixels at 16px and 32px (crisp, not blurry). The SAME geometry is
 * written to favicon.svg, so every format shows the identical mark.
 *
 * Output (public/):
 *   favicon.svg          vector (modern browsers)
 *   favicon-16x16.png    16px tab icon
 *   favicon-32x32.png    32px tab icon (hi-dpi tab, bookmarks)
 *   favicon.ico          16 + 32 + 48 px, PNG-compressed ICO entries
 *
 * To replace the mark: edit APP / GEOMETRY below, run
 *   node scripts/gen-favicons.js
 * commit the regenerated files, and bump CACHE in public/sw.js (docs/favicons.md).
 * test/favicon.test.js fails if the committed files drift from this script.
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

const APP = Object.freeze({
  letter: 'O',
  bg: [0x07, 0x14, 0x10], // #071410 — same dark ground as icon-v1-*.png
  fg: [0x39, 0xff, 0x14]  // #39ff14 — same accent as icon-v1-*.png
});

// All values in 16ths of the icon edge.
const GEOMETRY = Object.freeze({
  radius: 3.5,                                   // rounded-square corner radius
  T: [{ x: 3, y: 3, w: 10, h: 3 },               // top bar
      { x: 6, y: 3, w: 4, h: 10 }],              // stem
  O: { cx: 8, cy: 8, outer: 5.5, inner: 2.5 }    // ring
});

const ICO_SIZES = [16, 32, 48];
const PNG_SIZES = [16, 32];

function hex(c) { return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); }

// ---- Coverage tests in 16-unit space --------------------------------------
function inRoundedSquare(x, y) {
  const r = GEOMETRY.radius;
  const cx = Math.min(Math.max(x, r), 16 - r);
  const cy = Math.min(Math.max(y, r), 16 - r);
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && x >= 0 && x <= 16 && y >= 0 && y <= 16;
}
function inLetter(x, y) {
  if (APP.letter === 'T') {
    return GEOMETRY.T.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }
  const o = GEOMETRY.O;
  const d2 = (x - o.cx) * (x - o.cx) + (y - o.cy) * (y - o.cy);
  return d2 <= o.outer * o.outer && d2 >= o.inner * o.inner;
}

// ---- Raster: 8x8 supersampled, straight (non-premultiplied) RGBA ----------
function render(size) {
  const SS = 8;
  const out = Buffer.alloc(size * size * 4);
  const unit = 16 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0, ink = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * unit;
          const y = (py + (sy + 0.5) / SS) * unit;
          if (!inRoundedSquare(x, y)) continue;
          cover++;
          if (inLetter(x, y)) ink++;
        }
      }
      const i = (py * size + px) * 4;
      if (!cover) continue; // fully transparent corner
      const t = ink / cover;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(APP.bg[c] + (APP.fg[c] - APP.bg[c]) * t);
      out[i + 3] = Math.round((255 * cover) / (SS * SS));
    }
  }
  return out;
}

// ---- PNG encode (8-bit RGBA, filter None) ---------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- ICO container with PNG-compressed entries ----------------------------
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, k) => {
    const d = k * 16;
    dir[d] = e.size >= 256 ? 0 : e.size;
    dir[d + 1] = e.size >= 256 ? 0 : e.size;
    dir.writeUInt16LE(1, d + 4);  // colour planes
    dir.writeUInt16LE(32, d + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, d + 8);
    dir.writeUInt32LE(offset, d + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir].concat(entries.map((e) => e.png)));
}

// ---- SVG (same 16-unit geometry) ------------------------------------------
function svg() {
  const fg = hex(APP.fg);
  let mark;
  if (APP.letter === 'T') {
    mark = GEOMETRY.T.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fg}"/>`).join('');
  } else {
    const o = GEOMETRY.O;
    const mid = (o.outer + o.inner) / 2;
    mark = `<circle cx="${o.cx}" cy="${o.cy}" r="${mid}" fill="none" stroke="${fg}" stroke-width="${o.outer - o.inner}"/>`;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">' +
    `<rect width="16" height="16" rx="${GEOMETRY.radius}" fill="${hex(APP.bg)}"/>` + mark + '</svg>\n';
}

/** Every output file name -> its exact bytes. Pure: no disk writes. */
function build() {
  const files = {};
  const png = {};
  for (const s of new Set(PNG_SIZES.concat(ICO_SIZES))) png[s] = encodePng(s, render(s));
  for (const s of PNG_SIZES) files[`favicon-${s}x${s}.png`] = png[s];
  files['favicon.ico'] = encodeIco(ICO_SIZES.map((s) => ({ size: s, png: png[s] })));
  files['favicon.svg'] = Buffer.from(svg(), 'utf8');
  return files;
}

if (require.main === module) {
  const files = build();
  for (const [name, bytes] of Object.entries(files)) {
    fs.writeFileSync(path.join(PUB, name), bytes);
    console.log(`wrote public/${name} (${bytes.length} bytes)`);
  }
}

module.exports = { build, render, APP, GEOMETRY, ICO_SIZES, PNG_SIZES };
