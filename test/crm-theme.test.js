'use strict';
// OP-CRM-4 — light CRM theme on the Outpatient's own palette (CHANGELOG-crm-theme.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.webmanifest'), 'utf8'));
const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');

function token(name) { const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})')); return m && m[1].toLowerCase(); }
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

test('1. page is light: bg/panel light, text dark, and the palette is NOT the Dashboard slate/teal', () => {
  assert.ok(lum(token('bg')) > 0.8, 'page background is light');
  assert.equal(token('panel'), '#ffffff');
  assert.ok(lum(token('text')) < 0.05, 'text is dark');
  assert.notEqual(token('bg'), '#e6ecf2', 'own background, not the Dashboard one');
  assert.notEqual(token('green'), '#0b6b63', 'own action colour, not the Dashboard teal');
});

test('2. WCAG AA: body text, muted text, action colour and value colour on white/page', () => {
  assert.ok(contrast(token('text'), token('panel')) >= 7, 'text on white >= 7');
  assert.ok(contrast(token('muted'), token('panel')) >= 4.5, 'muted on white >= 4.5');
  assert.ok(contrast(token('text-soft'), token('bg')) >= 4.5, 'soft text on page >= 4.5');
  assert.ok(contrast('#ffffff', token('green')) >= 4.5, 'white on primary button >= 4.5');
  assert.ok(contrast(token('green-2'), token('panel')) >= 4.5, 'KPI value colour on white >= 4.5');
  assert.ok(contrast(token('red'), token('panel')) >= 4.5);
  assert.ok(contrast(token('amber'), token('panel')) >= 4.5);
  assert.ok(contrast(token('blue-deep'), token('panel')) >= 4.5);
});

test('3. no dark-theme leftovers: old dark hex values and gradients are gone', () => {
  for (const dark of ['#071410', '#0b2019', '#13352a', '#123424', '#12392a', '#2a1515', '#3a0f10', '#0f3a27', '#1a2e4a', '#124733', '#0d3845']) {
    assert.ok(!css.toLowerCase().includes(dark), 'dark colour still present: ' + dark);
  }
  assert.ok(!/radial-gradient/.test(css), 'no dark radial gradients');
  assert.ok(!/rgba\(10, 20, 16/.test(css), 'topbar is no longer translucent dark');
  // no light-on-light text: blue-soft is a background only
  assert.ok(!/color: var\(--blue-soft\)/.test(css), 'blue-soft is never used as text');
});

test('4. Dashboard-CRM layout: side menu on desktop, icons on every tab, mobile untouched', () => {
  assert.match(css, /--menu-w: 220px/);
  assert.match(css, /@media \(min-width: 900px\) \{[\s\S]*\.app \{ display: grid; grid-template-columns: var\(--menu-w\) minmax\(0, 1fr\)/);
  assert.match(css, /\.topbar \{[\s\S]*?flex-direction: column/);
  const views = [...html.matchAll(/class="tab[^"]*" data-view="([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(views.length >= 10);
  for (const v of views) assert.match(css, new RegExp('\\.tab\\[data-view="' + v + '"\\]::before \\{ content: "'), 'icon for tab ' + v);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.tabs \{/, 'mobile tab strip kept');
});

test('5. theme-color / manifest follow the light theme; SW cache bumped to v22+', () => {
  assert.match(html, /<meta name="theme-color" content="#EDF4EF" \/>/);
  assert.equal(manifest.background_color, '#EDF4EF');
  assert.equal(manifest.theme_color, '#157A52');
  const m = sw.match(/var CACHE = 'ezone-outpatient-v(\d+)';/);
  assert.ok(Number(m[1]) >= 22, 'SW v22+');
});

test('6. status is never colour alone: state chips carry a word/icon in the my-day markup', () => {
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.match(app, /md-chip st-/);
  const myDay = require('../public/my-day.js');
  for (const r of [{ priority: 'exception' }, { state: 'late' }, { state: 'today' }, { state: 'undated' }, { state: 'wait' }]) {
    assert.ok(/[֐-׿]/.test(myDay.stateText(r)), 'chip text has a Hebrew word');
  }
});
