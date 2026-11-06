'use strict';

// «למי ההצעה» browse path (Sandra's production report, 2026-11-04): before this
// the picker needed 2+ typed characters, so clicking the empty field showed
// nothing and Vered could not SCAN the admitted patients / open leads — a
// regression against the pre-#167 <select>. An empty query now browses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PP = require('../public/package-pricing.js');

const T = [
  { type: 'lead', id: 'l1', name: 'דנה כהן', phone: '052-111-2233', sub: 'אתר' },
  { type: 'client', id: 'c1', name: 'אבי כהן', phone: '0501112233', sub: 'קבוצתי · רעננה הפרדס' },
  { type: 'roster', id: 'id:dash-1', name: 'רון כהן', phone: '0531112233', sub: 'קיסריה עפרוני' },
  { type: 'roster', id: 'phone:0541112233', name: 'גל כהן', phone: '0541112233', sub: 'רמות השבים' },
  { type: 'client', id: 'c2', name: 'רות לוי', phone: '', sub: '' }
];

test('browse: an empty query returns EVERY target grouped, in the section order', () => {
  for (const q of ['', '   ', null, undefined]) {
    const g = PP.matchTargetsGrouped(T, q, PP.BROWSE_PER_TYPE);
    assert.deepEqual(g.map((x) => [x.type, x.label, x.total]), [
      ['client', 'מטופלים', 2], ['roster', 'מאושפזים', 2], ['lead', 'לידים פתוחים', 1]
    ], JSON.stringify(q));
    // rows sorted by name (he locale) inside the section
    assert.deepEqual(g[0].items.map((t) => t.name), ['אבי כהן', 'רות לוי']);
    assert.deepEqual(g[1].items.map((t) => t.name), ['גל כהן', 'רון כהן']);
    assert.equal(g.every((x) => x.truncated === false), true, 'nothing hidden');
  }
});

test('browse: a section is capped and reports truncation; `total` stays uncapped', () => {
  assert.equal(PP.BROWSE_PER_TYPE, 15);
  const many = Array.from({ length: 23 }, (_, i) => ({ type: 'roster', id: 'r' + i, name: 'מאושפז ' + String(i).padStart(2, '0'), phone: '', sub: 'רמות' }));
  const g = PP.matchTargetsGrouped(many.concat(T), '', PP.BROWSE_PER_TYPE);
  const roster = g.find((x) => x.type === 'roster');
  assert.equal(roster.total, 25, '«מאושפזים (25)» is honest');
  assert.equal(roster.items.length, 15, 'capped at BROWSE_PER_TYPE');
  assert.equal(roster.truncated, true);
  assert.equal(g.find((x) => x.type === 'client').truncated, false, 'a short section is not truncated');
  // an explicit cap still wins
  assert.equal(PP.matchTargetsGrouped(many, '', 3).find((x) => x.type === 'roster').items.length, 3);
});

test('browse: empty sections are omitted (no «(0)» headers)', () => {
  const g = PP.matchTargetsGrouped(T.filter((t) => t.type === 'client'), '', 15);
  assert.deepEqual(g.map((x) => x.type), ['client']);
  assert.deepEqual(PP.matchTargetsGrouped([], '', 15), []);
  assert.deepEqual(PP.matchTargetsGrouped(null, '', 15), []);
});

test('browseTargets: pure, never mutates, skips holes', () => {
  const input = [T[4], T[0], null, T[1], undefined];
  const copy = input.slice();
  const out = PP.browseTargets(input);
  assert.deepEqual(out.map((t) => t.id), ['c1', 'c2', 'l1']);
  assert.deepEqual(input, copy, 'the caller\'s array order is untouched');
  assert.deepEqual(PP.browseTargets(), []);
});

test('typing still filters exactly as before — one character included', () => {
  // the former 2-char floor lived in the UI, not the matcher; the matcher is unchanged
  assert.deepEqual(PP.matchTargetsGrouped(T, 'כהן', 6).map((x) => [x.type, x.total, x.items.map((t) => t.id)]), [
    ['client', 1, ['c1']], ['roster', 2, ['phone:0541112233', 'id:dash-1']], ['lead', 1, ['l1']]
  ]);
  assert.deepEqual(PP.matchTargetsGrouped(T, 'ל', 6).map((x) => [x.type, x.items.map((t) => t.id)]),
    [['client', ['c2']], ['roster', ['phone:0541112233']]], 'a single letter filters (רות לוי, גל כהן)');
  assert.deepEqual(PP.matchTargetsGrouped(T, 'zzz', 6), []);
  // matchTargets keeps ITS contract: a blank query matches nothing there
  assert.deepEqual(PP.matchTargets(T, ''), []);
  assert.deepEqual(PP.matchTargets(T, '   '), []);
});

test('static: the 2-character floor is gone and the picker opens on focus', () => {
  const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'package-pricing.js'), 'utf8');
  assert.equal(/q\.length\s*<\s*2/.test(UI), false, 'no 2-char minimum left');
  const zone = UI.slice(UI.indexOf('function whoPicker'), UI.indexOf('function matchTargetsGrouped'));
  assert.ok(/onfocus:/.test(zone), 'focus opens the list');
  assert.ok(/Escape/.test(zone), 'Esc closes the list');
  assert.ok(/addEventListener\('click', outside, true\)/.test(zone), 'a click outside closes the list');
  assert.ok(/pkg-who-more/.test(zone) && /הקלידי שם או טלפון לסינון/.test(zone), 'truncated sections say how to narrow');
  // no money on a picker row
  assert.equal(/pkg-who-opt[\s\S]{0,400}(Agorot|₪)/.test(zone), false, 'no price on a picker row');
});
