'use strict';

/**
 * Self-contained PWA icon generator — no external dependencies.
 *
 * DRAWS a bold geometric letter-E from scratch (it no longer recolours a
 * pre-existing glyph). Uses only Node's built-in `zlib` to encode 8-bit RGBA
 * PNGs. The mark is a heavy block E: a thick vertical stem plus top / middle /
 * bottom arms, centred on a white square.
 *
 * Geometry (as a fraction of the canvas, before the per-icon scale):
 *   glyph height  0.68   (E fills ~65-70% of the canvas)
 *   glyph width   0.64
 *   stroke        0.185  (thick strokes, ~18-20% of canvas height)
 *   middle arm    0.80 x glyph width (slightly shorter, reads as an E)
 *
 * Colours:
 *   background  #ffffff (white)
 *   letter      #00c853 (fierce green)
 *
 * Edges are all axis-aligned, so coverage is computed ANALYTICALLY per pixel
 * (exact pixel-rectangle overlap, inclusion-exclusion over the stem/arm rects).
 * That gives clean anti-aliasing without supersampling.
 *
 * The maskable icon draws the same glyph at a smaller scale so it sits inside
 * the launcher safe zone with white padding all the way to the edge; every
 * icon is a fully-opaque white square.
 *
 * Run:  node scripts/gen-icons.js
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

const BG = [255, 255, 255];     // #ffffff
const LETTER = [0, 200, 83];    // #00c853

// Glyph proportions (fraction of canvas), before the per-icon scale.
const GLYPH_H = 0.68;   // E fills ~68% of the canvas height
const GLYPH_W = 0.64;
const STROKE = 0.185;   // ~18.5% of canvas height
const MID_ARM = 0.80;   // middle arm length as a fraction of glyph width

// ---- CRC32 (PNG chunk checksums) -----------------------------------------
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

// ---- PNG encode (8-bit RGBA, filter 0 / None per scanline) ---------------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodeRGBA(w, h, data) {
  const bpp = 4, stride = w * bpp;
  const rawWithFilters = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    rawWithFilters[y * (stride + 1)] = 0; // filter: None
    data.copy(rawWithFilters, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = zlib.deflateSync(rawWithFilters, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- glyph geometry ------------------------------------------------------
// Returns the rectangles that make up the E (in pixel coordinates) for an
// N x N canvas at the given scale (1 = any-purpose, <1 = maskable safe zone).
function glyphRects(N, scale) {
  const gh = GLYPH_H * scale * N;
  const gw = GLYPH_W * scale * N;
  const s = STROKE * scale * N;
  const x0 = (N - gw) / 2, y0 = (N - gh) / 2;
  const x1 = x0 + gw, y1 = y0 + gh;
  const midLen = MID_ARM * gw;
  const ymid = (y0 + y1) / 2;
  return [
    [x0, y0, x0 + s, y1],           // stem (vertical)
    [x0, y0, x1, y0 + s],           // top arm
    [x0, y1 - s, x1, y1],           // bottom arm
    [x0, ymid - s / 2, x0 + midLen, ymid + s / 2], // middle arm (shorter)
  ];
}

// Exact overlap area between pixel (px,py)->(px+1,py+1) and an axis-aligned rect.
function rectCover(px, py, r) {
  const xo = Math.min(r[2], px + 1) - Math.max(r[0], px);
  const yo = Math.min(r[3], py + 1) - Math.max(r[1], py);
  if (xo <= 0 || yo <= 0) return 0;
  return (xo < 1 ? xo : 1) * (yo < 1 ? yo : 1);
}
// Intersection of two axis-aligned rects, or null if they don't overlap.
function rectIsect(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]);
  return (x1 > x0 && y1 > y0) ? [x0, y0, x1, y1] : null;
}

function draw(N, scale) {
  const [stem, top, bottom, middle] = glyphRects(N, scale);
  // The stem overlaps each arm; arms never overlap each other (vertical gaps).
  const overlaps = [rectIsect(stem, top), rectIsect(stem, bottom), rectIsect(stem, middle)];
  const stride = N * 4;
  const data = Buffer.alloc(N * stride);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Union coverage via inclusion-exclusion over axis-aligned rectangles.
      let cov = rectCover(x, y, stem) + rectCover(x, y, top)
              + rectCover(x, y, bottom) + rectCover(x, y, middle);
      for (const o of overlaps) if (o) cov -= rectCover(x, y, o);
      if (cov < 0) cov = 0; else if (cov > 1) cov = 1;
      const i = y * stride + x * 4;
      data[i] = Math.round(BG[0] + cov * (LETTER[0] - BG[0]));
      data[i + 1] = Math.round(BG[1] + cov * (LETTER[1] - BG[1]));
      data[i + 2] = Math.round(BG[2] + cov * (LETTER[2] - BG[2]));
      data[i + 3] = 255; // fully opaque white square
    }
  }
  return { w: N, h: N, data };
}

// ---- run -----------------------------------------------------------------
const JOBS = [
  { file: 'icon-v1-192.png', size: 192, scale: 1 },
  { file: 'icon-v1-512.png', size: 512, scale: 1 },
  // Maskable: glyph shrunk into the safe zone, white padding to the edge.
  { file: 'icon-v1-maskable.png', size: 512, scale: 0.8 },
];

if (require.main === module) {
  for (const job of JOBS) {
    const img = draw(job.size, job.scale);
    const png = encodeRGBA(img.w, img.h, img.data);
    fs.writeFileSync(path.join(PUB, job.file), png);
    console.log('wrote', job.file, `${img.w}x${img.h}`, png.length, 'bytes',
      job.scale === 1 ? '' : `(safe-zone scale ${job.scale})`);
  }
  console.log('done');
}

module.exports = { draw, glyphRects, encodeRGBA, BG, LETTER };
