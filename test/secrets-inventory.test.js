'use strict';

// docs/SECRETS-INVENTORY.md must list every config name the code reads, and
// must never contain a value. Names only — see CLAUDE.md rule 8.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'SECRETS-INVENTORY.md'), 'utf8');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function filesIn(dir, ext) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
}
function collect(sources, re) {
  const names = new Set();
  for (const rel of sources) for (const m of read(rel).matchAll(re)) names.add(m[1]);
  return [...names].sort();
}
function undocumented(names) { return names.filter((n) => !DOC.includes('`' + n + '`')); }

const NODE_SOURCES = ['server.js', ...filesIn('lib', '.js'), ...filesIn('scripts', '.js')];

test('every process.env / env.X name read by server, lib and scripts is documented', () => {
  const names = collect(NODE_SOURCES, /\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)\b/g);
  assert.ok(names.includes('SESSION_SECRET'), 'scanner sanity check');
  assert.deepEqual(undocumented(names), []);
});

test('every Apps Script Script Property is documented', () => {
  const code = ['apps-script/Code.gs'];
  const names = [
    ...collect(code, /getProperty\(\s*'([A-Z][A-Z0-9_]+)'\s*\)/g),
    ...collect(code, /:\s*'([A-Z][A-Z0-9_]*_SECRET)'/g),
    ...collect(code, /_PROP\s*=\s*'([A-Z][A-Z0-9_]+)'/g)
  ];
  assert.ok(names.includes('OUTPATIENT_PROXY_SECRET'), 'scanner sanity check');
  assert.deepEqual(undocumented([...new Set(names)].sort()), []);
});

test('every GitHub Actions secret is documented', () => {
  const names = collect(filesIn('.github/workflows', '.yml'), /\bsecrets\.([A-Z][A-Z0-9_]+)\b/g);
  assert.ok(names.includes('CLASPRC_JSON'), 'scanner sanity check');
  assert.deepEqual(undocumented(names), []);
});

test('the inventory contains no secret-looking values', () => {
  // Long hex / base64 runs, Apps Script deployment IDs, Google OAuth tokens,
  // and NAME=value assignments are all forbidden here.
  const forbidden = [
    /\b[0-9a-f]{32,}\b/i,
    /[A-Za-z0-9+/_-]{40,}={0,2}/,
    /AKfyc[A-Za-z0-9_-]{10,}/,
    /\bya29\.[A-Za-z0-9_-]+/,
    /\b1\/\/[A-Za-z0-9_-]{20,}/,
    /\b[A-Z][A-Z0-9_]*(?:SECRET|PIN|TOKEN|JSON)\s*=\s*\S/
  ];
  for (const re of forbidden) assert.doesNotMatch(DOC, re);
});
