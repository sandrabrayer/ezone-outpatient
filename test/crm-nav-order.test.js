'use strict';
// CRM navigation order (2026-11-03, section 3 of the E-ZONE One brief): the archive-like views —
// «שימור לידים» (win-back) and «מטופלים לא פעילים» — sit LAST in the menu; everything else keeps its
// data-view ids, and the win-back cards carry the CRM follow-up block (last contact / next contact / owner).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

function navViews() {
  const nav = HTML.slice(HTML.indexOf('<nav class="tabs">'), HTML.indexOf('</nav>'));
  return [...nav.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]);
}

test('nav: שימור לידים and מטופלים לא פעילים are the last two tabs; every existing view id is still present', () => {
  const views = navViews();
  assert.deepEqual(views.slice(-2), ['retention', 'inactive']);
  assert.deepEqual(views.sort(), ['billing', 'clients', 'continuation', 'dashboard', 'inactive', 'leads', 'packages', 'payouts', 'retention', 'revenue'].sort());
  assert.equal(navViews()[0], 'dashboard', '«היום שלי» opens the app');
});

test('nav: the matching <section id="view-…"> exists for every tab, and every tab has its menu icon', () => {
  for (const v of navViews()) {
    assert.match(HTML, new RegExp('<section id="view-' + v + '"'), 'section for ' + v);
    assert.match(CSS, new RegExp('\\.tab\\[data-view="' + v + '"\\]::before'), 'icon for ' + v);
  }
});

test('win-back cards: light-theme classes (no inline dark colours) and the CRM follow-up block on each lead', () => {
  const start = APP.indexOf('function renderRetention()'); const end = APP.indexOf('// Lazily fetch the Clients-removed tombstones');
  const body = APP.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(body, /crmBlockHtml\('lead', l\)/, 'last contact / next contact / owner come from the shared CRM block');
  assert.doesNotMatch(body, /#1a2e4a|#9fcfcf|#2a3f5a/, 'no inline dark palette left in the archive cards');
  assert.match(body, /אחראי\/ת: /, 'the owner (assignedTo) is shown on the card');
  const inactive = APP.slice(APP.indexOf('function renderInactive()'), APP.indexOf('function retRow(') > 0 ? APP.length : APP.length);
  assert.doesNotMatch(APP.slice(APP.indexOf('function renderInactive()'), APP.indexOf('function renderInactive()') + 6000), /#1a2e4a/, 'inactive cards use .arc-card too');
  for (const cls of ['.arc-card', '.arc-head', '.arc-row', '.arc-k', '.arc-v', '.arc-heading', '.view-title']) assert.ok(CSS.includes(cls + ' {'), cls + ' styled');
  assert.ok(inactive.length > 0);
});
