'use strict';

/**
 * Guard: every house enumeration in this repo covers the canonical 5-house
 * ecosystem list, so opening a new house (like רעננה הפרדס, Aug 2026) can never
 * silently miss a surface again.
 *
 * The ecosystem's canonical residential houses (the dashboard roster ids):
 *   arfoni  קיסריה עפרוני
 *   asher   רעננה אשר
 *   pardes  רעננה הפרדס        (canonical id 'pardes'; this repo's stable
 *                               house_of_origin key is 'raanana_pardes')
 *   ramot   רמות השבים
 *   rehab   קיסריה ריהאב
 *
 * Surfaces guarded:
 *   - public/continuation-logic.js  HOUSE_TO_ORIGIN (importable — tested live)
 *   - public/app.js                 CONTINUATION_HOUSE_LABELS,
 *                                   HOUSE_OF_ORIGIN_LABELS, LOCATIONS
 *   - public/index.html             סניף selects + בית מוצא selects
 *   - apps-script/Code.gs           CREATE_LEAD_HOUSE_KEYS
 * app.js / index.html / Code.gs are browser/Apps-Script files that cannot be
 * required, so they are source-guarded (same pattern as create-lead.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CL = require('../public/continuation-logic.js');

const CANONICAL_ROSTER_HOUSES = ['arfoni', 'asher', 'pardes', 'ramot', 'rehab'];

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const APP = read('public/app.js');
const HTML = read('public/index.html');
const GS = read('apps-script/Code.gs');

// --- continuation-logic.js (live) -------------------------------------------
test('HOUSE_TO_ORIGIN maps every canonical roster house to a non-empty stable key', () => {
  CANONICAL_ROSTER_HOUSES.forEach(h => {
    const origin = CL.houseToOrigin(h);
    assert.ok(origin, `houseToOrigin('${h}') must resolve (got '${origin}')`);
  });
  assert.equal(CL.houseToOrigin('pardes'), 'raanana_pardes');
});

// --- public/app.js (source guard) -------------------------------------------
test('CONTINUATION_HOUSE_LABELS labels every canonical roster house', () => {
  const m = APP.match(/var CONTINUATION_HOUSE_LABELS = \{([\s\S]*?)\};/);
  assert.ok(m, 'CONTINUATION_HOUSE_LABELS not found in app.js');
  CANONICAL_ROSTER_HOUSES.forEach(h => {
    assert.match(m[1], new RegExp(h + ":\\s*'[^']+'"), `missing label for '${h}'`);
  });
  assert.match(m[1], /pardes:\s*'רעננה הפרדס'/);
});

test('HOUSE_OF_ORIGIN_LABELS labels every stable key, plus the pardes alias', () => {
  const m = APP.match(/var HOUSE_OF_ORIGIN_LABELS = \{([\s\S]*?)\};/);
  assert.ok(m, 'HOUSE_OF_ORIGIN_LABELS not found in app.js');
  // Stable code keys (never rename) + the canonical-id display alias.
  ['raanana_pardes', 'raanana', 'ramot', 'kisaria_gmila', 'efroni', 'rehab',
   'external', 'pardes'].forEach(k => {
    assert.match(m[1], new RegExp(k + ":\\s*'[^']+'"), `missing label for '${k}'`);
  });
  // Both keys for the pardes house carry the same label.
  assert.match(m[1], /raanana_pardes:\s*'רעננה הפרדס'/);
  assert.match(m[1], /pardes:\s*'רעננה הפרדס'/);
});

test('LOCATIONS (סניף) is the canonical 5-branch list, רעננה הפרדס included', () => {
  const m = APP.match(/var LOCATIONS = \[([\s\S]*?)\];/);
  assert.ok(m, 'LOCATIONS not found in app.js');
  const locs = m[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  assert.deepEqual(locs,
    ['רעננה הפרדס', 'רעננה אשר', 'רמות השבים', 'קיסריה גמילה', 'קיסריה עפרוני']);
});

// --- public/index.html (source guard) ---------------------------------------
const selects = HTML.match(/<select[\s\S]*?<\/select>/g) || [];

test('every סניף select in index.html offers רעננה הפרדס', () => {
  // A location select is one offering another known branch label as a plain
  // (value-less) option; count-agnostic so adding selects later still guards.
  const locationSelects = selects.filter(s => s.includes('<option>רמות השבים</option>'));
  assert.ok(locationSelects.length >= 1, 'no location selects found');
  locationSelects.forEach(s => {
    assert.ok(s.includes('<option>רעננה הפרדס</option>'),
      'a סניף select is missing רעננה הפרדס:\n' + s);
  });
});

test('every בית מוצא select in index.html offers raanana_pardes', () => {
  const originSelects = selects.filter(s => s.includes('value="efroni"'));
  assert.ok(originSelects.length >= 1, 'no house_of_origin selects found');
  originSelects.forEach(s => {
    assert.ok(s.includes('<option value="raanana_pardes">רעננה הפרדס</option>'),
      'a בית מוצא select is missing raanana_pardes:\n' + s);
  });
});

// --- apps-script/Code.gs (source guard) --------------------------------------
test('CREATE_LEAD_HOUSE_KEYS knows every canonical createLead house id', () => {
  const m = GS.match(/var CREATE_LEAD_HOUSE_KEYS = \{([\s\S]*?)\};/);
  assert.ok(m, 'CREATE_LEAD_HOUSE_KEYS not found in Code.gs');
  // The dashboard's createLead scheme: the five classic keys + pardes.
  ['raanana', 'ramot', 'efroni', 'rehab', 'external', 'pardes'].forEach(k => {
    assert.match(m[1], new RegExp(k + ': true'), `missing known key '${k}'`);
  });
});
