'use strict';

/**
 * Guard tests for the topbar header branding.
 *
 * The header dropped the "E-ZONE" text and now shows the app emblem next to
 * the Hebrew app name only (emblem + "טיפולי חוץ"). These lock that contract so
 * a future edit cannot silently reintroduce "E-ZONE" into the topbar logo or
 * lose the emblem image.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const indexRaw = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const cssRaw = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');

// Isolate the topbar <div class="logo">…</div> block.
const logoMatch = indexRaw.match(/<div class="logo">([\s\S]*?)<\/div>/);

test('1. topbar logo exists', () => {
  assert.ok(logoMatch, 'a <div class="logo"> is present in index.html');
});

test('2. topbar logo carries the Hebrew app name', () => {
  assert.ok(logoMatch[1].includes('טיפולי חוץ'), 'logo shows the Hebrew name');
});

test('3. topbar logo no longer shows the "E-ZONE" text', () => {
  assert.ok(!/E-?ZONE/i.test(logoMatch[1]), 'no E-ZONE text in the logo');
});

test('4. topbar logo shows the app emblem, sourced from a manifest icon', () => {
  const img = logoMatch[1].match(/<img\b[^>]*class="logo-mark"[^>]*>/);
  assert.ok(img, 'logo contains an <img class="logo-mark">');
  const srcMatch = img[0].match(/src="([^"?]+)/);
  assert.ok(srcMatch, 'emblem <img> has a src');
  const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.webmanifest'), 'utf8'));
  const manifestSrcs = new Set(manifest.icons.map((i) => i.src));
  assert.ok(manifestSrcs.has(srcMatch[1]), `emblem src ${srcMatch[1]} is a manifest icon`);
  assert.ok(fs.existsSync(path.join(PUB, srcMatch[1])), 'emblem file exists on disk');
});

test('5. emblem <img> stays cache-busted', () => {
  const img = logoMatch[1].match(/<img\b[^>]*class="logo-mark"[^>]*>/)[0];
  assert.ok(img.includes('?v=__BUILD__'), 'emblem src is cache-busted');
});

test('6. emblem is empty-alt (decorative — name carries the label)', () => {
  const img = logoMatch[1].match(/<img\b[^>]*class="logo-mark"[^>]*>/)[0];
  assert.ok(/alt=""/.test(img), 'emblem alt is empty');
});

test('7. logo lays out inline and never wraps (RTL-safe, keeps off the nav)', () => {
  const rule = cssRaw.match(/\.logo\s*\{[\s\S]*?\}/);
  assert.ok(rule, '.logo rule present');
  assert.match(rule[0], /display:\s*flex/, '.logo is flex');
  assert.match(rule[0], /white-space:\s*nowrap/, '.logo does not wrap');
});

test('8. emblem is sized ~30px desktop and 28px on mobile', () => {
  const base = cssRaw.match(/\.logo-mark\s*\{[^}]*\}/);
  assert.ok(base, '.logo-mark rule present');
  assert.match(base[0], /width:\s*30px/, 'desktop emblem is 30px');

  const mobile = cssRaw.match(/@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.logo-mark\s*\{[^}]*\}/);
  assert.ok(mobile, '.logo-mark override inside the mobile media query');
  assert.match(mobile[0].match(/\.logo-mark\s*\{[^}]*\}$/)[0], /width:\s*28px/, 'mobile emblem is 28px');
});
