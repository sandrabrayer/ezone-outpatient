'use strict';

/**
 * Self-contained PWA icon generator — no external dependencies.
 *
 * Uses only Node's built-in `zlib` to encode 8-bit RGBA PNGs. It DRAWS a bold,
 * heavy geometric letter-E from scratch (it does not reuse or recolour the old
 * thin logo glyph): a thick vertical stem plus top / middle / bottom arms.
 *
 * Ecosystem colour scheme:
 *   background  BG_HEX = #ffffff (white)
 *   letter      FG_HEX = #2dd47a (green)
 *
 * Geometry (relative to the glyph's own height Eh):
 *   stroke width  S       = 0.27 * Eh   (~18.5% of a 0.68-canvas glyph height)
 *   glyph width   Ew      = 0.70 * Eh
 *   middle arm            = 0.80 * Ew   (classic slightly-short middle bar)
 * The glyph is centred. For the two `any` icons Eh = 0.68 * canvas (fills
 * ~65-70%). The maskable icon shrinks the glyph into the safe zone and pads the
 * rest with the background colour so nothing looks cropped under a launcher mask.
 *
 * Edges are anti-aliased by 4x4 supersampling (coverage per pixel).
 *
 * Run:  node scripts/gen-icons.js
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

const BG = [0xff, 0xff, 0xff]; // BG_HEX #ffffff
const FG = [0x2d, 0xd4, 0x7a]; // FG_HEX #2dd47a

// Glyph internal proportions (fractions of the glyph height Eh).
const STROKE_OF_EH = 0.27; // stroke width; with Eh=0.68·canvas => ~18.4% of canvas
const WIDTH_OF_EH = 0.70;  // glyph width
const MIDARM_OF_W = 0.80;  // middle arm is slightly shorter than top/bottom

const SS = 4; // supersampling factor for anti-aliasing

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
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(rawWithFilters, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- draw a bold letter-E ------------------------------------------------
// heightFrac: glyph height as a fraction of the canvas.
function drawE(canvas, heightFrac) {
  const Eh = heightFrac * canvas;
  const S = STROKE_OF_EH * Eh;
  const Ew = WIDTH_OF_EH * Eh;
  const midArm = MIDARM_OF_W * Ew;
  const x0 = (canvas - Ew) / 2;
  const y0 = (canvas - Eh) / 2;

  // Axis-aligned rectangles [x1, y1, x2, y2] whose union is the glyph.
  const rects = [
    [x0, y0, x0 + S, y0 + Eh],                    // vertical stem
    [x0, y0, x0 + Ew, y0 + S],                    // top arm
    [x0, y0 + Eh - S, x0 + Ew, y0 + Eh],          // bottom arm
    [x0, y0 + (Eh - S) / 2, x0 + midArm, y0 + (Eh + S) / 2], // middle arm
  ];
  const inRects = (px, py) => {
    for (let r = 0; r < rects.length; r++) {
      const q = rects[r];
      if (px >= q[0] && px < q[2] && py >= q[1] && py < q[3]) return true;
    }
    return false;
  };

  const stride = canvas * 4;
  const out = Buffer.alloc(canvas * stride);
  const inv = 1 / (SS * SS);
  for (let y = 0; y < canvas; y++) {
    for (let x = 0; x < canvas; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) / SS;
        for (let sx = 0; sx < SS; sx++) {
          if (inRects(x + (sx + 0.5) / SS, py)) hit++;
        }
      }
      const cov = hit * inv;
      const o = y * stride + x * 4;
      out[o] = Math.round(BG[0] + cov * (FG[0] - BG[0]));
      out[o + 1] = Math.round(BG[1] + cov * (FG[1] - BG[1]));
      out[o + 2] = Math.round(BG[2] + cov * (FG[2] - BG[2]));
      out[o + 3] = 255; // opaque: full background square (safe-zone padding = BG)
    }
  }
  return out;
}

// ---- run -----------------------------------------------------------------
const JOBS = [
  { file: 'icon-v1-192.png', size: 192, heightFrac: 0.68 },
  { file: 'icon-v1-512.png', size: 512, heightFrac: 0.68 },
  // Maskable: glyph pulled into the safe zone, rest padded with BG.
  { file: 'icon-v1-maskable.png', size: 512, heightFrac: 0.55 },
];

for (const job of JOBS) {
  const data = drawE(job.size, job.heightFrac);
  const png = encodeRGBA(job.size, job.size, data);
  fs.writeFileSync(path.join(PUB, job.file), png);
  console.log('wrote', job.file, `${job.size}x${job.size}`, png.length, 'bytes',
    `E=${Math.round(job.heightFrac * 100)}% stroke=${(STROKE_OF_EH * job.heightFrac * 100).toFixed(1)}%`);
}
console.log('done');
