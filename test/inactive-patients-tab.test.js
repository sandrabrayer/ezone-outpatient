'use strict';

/**
 * Coverage for the מטופלים לא פעילים tab and the לא פעיל visibility/billing
 * fix. Run with:  npm test
 *
 * Taxonomy this locks: a LEAD is someone who has not started treatment; a
 * patient who left is NOT a lead. So שימור לידים is leads-only (not-relevant),
 * and BOTH inactive patient kinds — סיים טיפול (manual discharge) and לא פעיל
 * (cross-app deactivated: deleted in the therapists app) — live in the
 * dedicated top-level מטופלים לא פעילים tab.
 *
 * Fix this locks: לא פעיל patients previously leaked into the main patients
 * list (its filter excluded only סיים טיפול) and kept generating גבייה due
 * items in clientsDueOn. Both now exclude both inactive statuses.
 *
 * Two styles, matching the passing tests in this suite: pure MIRRORS of the
 * inline filters, and SOURCE-SCAN guards over public/app.js +
 * public/index.html locking the real handlers to the contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DISCHARGED = 'סיים טיפול';
const DEACTIVATED = 'לא פעיל';

const CLIENTS = [
  { id: 'a', name: 'פעיל', status: 'פעיל' },
  { id: 'b', name: 'בהפסקה', status: 'הפסקה זמנית' },
  { id: 'c', name: 'שוחרר', status: DISCHARGED },
  { id: 'd', name: 'נמחק אצל המטפלים', status: DEACTIVATED },
  { id: 'e', name: 'סטטוס ריק', status: '' }
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirrors of the inline status filters
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors renderClients' visibility filter (status part only).
function visibleInPatientsTab(c) {
  return !(c.status === DISCHARGED || c.status === DEACTIVATED);
}
// Mirrors clientsDueOn's status guard.
function billable(c) {
  return !(c.status === DISCHARGED || c.status === DEACTIVATED);
}
// Mirrors renderInactive's two section filters.
function inactiveSections(clients) {
  return {
    finished: clients.filter((c) => c.status === DISCHARGED),
    deactivated: clients.filter((c) => c.status === DEACTIVATED)
  };
}
// Mirrors renderRetention's client involvement: none — leads only.
function retentionClients() { return []; }

test('patients tab hides BOTH inactive kinds, keeps active/paused/blank', () => {
  assert.deepEqual(CLIENTS.filter(visibleInPatientsTab).map((c) => c.id), ['a', 'b', 'e']);
});

test('billing skips BOTH inactive kinds — a לא פעיל patient stops generating due items', () => {
  assert.deepEqual(CLIENTS.filter(billable).map((c) => c.id), ['a', 'b', 'e']);
});

test('the inactive tab shows the two kinds in separate sections, nothing else', () => {
  const s = inactiveSections(CLIENTS);
  assert.deepEqual(s.finished.map((c) => c.id), ['c']);
  assert.deepEqual(s.deactivated.map((c) => c.id), ['d']);
});

test('retention is leads-only: no client rows at all', () => {
  assert.deepEqual(retentionClients(CLIENTS), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards
// ─────────────────────────────────────────────────────────────────────────────

function fnSource(name) {
  const m = APP.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert.ok(m, name + ' not found in public/app.js');
  return m[0];
}

test('index.html: nav tab + view section exist and wire by the standard data-view pattern', () => {
  assert.match(HTML, /data-view="inactive">מטופלים לא פעילים</);
  assert.match(HTML, /id="view-inactive"/);
  assert.match(HTML, /id="inactiveSearch"/);
  assert.match(HTML, /id="inactiveList"/);
});

test('app.js: render() dispatches the inactive view and the search input is wired', () => {
  assert.match(APP, /state\.view === 'inactive'\) renderInactive\(\)/);
  assert.match(APP, /wireSearchBox\('#inactiveSearch', function \(e\) \{ state\.inactiveSearch = e\.target\.value; return renderInactive\(\); \}\);/);
  assert.match(APP, /inactiveSearch: ''/, 'per-tab search state must be initialized');
});

test('app.js: renderClients excludes both inactive statuses', () => {
  const src = fnSource('renderClients');
  assert.match(src, /c\.status === 'סיים טיפול' \|\| c\.status === 'לא פעיל'/);
});

test('app.js: clientsDueOn excludes both inactive statuses', () => {
  const src = fnSource('clientsDueOn');
  assert.match(src, /c\.status === 'סיים טיפול' \|\| c\.status === 'לא פעיל'/);
});

test('app.js: renewalInfo treats both inactive statuses as unknown (no renewal urgency)', () => {
  const src = fnSource('renewalInfo');
  assert.match(src, /c\.status === 'סיים טיפול' \|\| c\.status === 'לא פעיל'/);
});

test('app.js: renderRetention no longer touches clients — leads only', () => {
  const src = fnSource('renderRetention');
  assert.ok(!/state\.clients/.test(src), 'retention must not read state.clients');
  assert.ok(!/סיים טיפול/.test(src), 'retention must not carry the discharged section');
});

test('app.js: renderInactive builds both sections with distinct badges and the source row', () => {
  const src = fnSource('renderInactive');
  assert.match(src, /'סיימו טיפול'/, 'discharged section title');
  assert.match(src, /'לא פעילים'/, 'deactivated section title');
  assert.match(src, /c\.status === 'סיים טיפול'/);
  assert.match(src, /c\.status === 'לא פעיל'/);
  assert.match(src, /הוסר באפליקציית המטפלים/, 'deactivated cards must say where the removal came from');
  assert.match(src, /openRestoreClientModal/, 'both card kinds reach the restore modal');
});
