'use strict';

/**
 * Coverage for the stale-save PREVENTION layer on top of the _saveAll
 * row-loss guard (apps-script/Code.gs) and its frontend wiring
 * (public/app.js). Companion to test/saveall-tombstone.test.js — same two
 * styles: a pure MIRROR of the server logic, and SOURCE-SCAN guards locking
 * the real wiring to the contract.
 *
 * Incident this locks (2026-08-09, repeat of 2026-08-26): a stale tab's
 * saveAll dropped 2 patients. The #88 guard tombstoned the drops but did not
 * prevent them. Two features close that:
 *
 * 1. merge-don't-drop — an on-sheet id missing from the payload WITHOUT an
 *    explicitRemovedIds declaration is PRESERVED in the rewrite with its
 *    current on-sheet values, and logged to Clients-removed as
 *    removedVia='saveAll-diff-preserved' (visibility, not a removal; the
 *    admin restore surface filters these out). Declared ids still delete.
 *
 * 2. staleness signal — getData returns a dataVersion (script-property
 *    counter, bumped by _saveAll and _restoreRemovedClient under the lock);
 *    the tab echoes it back on saveAll; an echo older than current makes the
 *    response carry staleSave:true (save still proceeds — merge-don't-drop
 *    makes it safe) and the tab toasts + reloads. FAIL-OPEN: a payload with
 *    no echoed version (old clients) is never flagged.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of the merge-don't-drop rewrite set
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors _saveAll's merge: what actually gets written to Clients, what gets
// tombstoned, and how each tombstone is attributed.
function mergeSave(existing, incoming, explicitRemovedIds) {
  const incomingIds = {};
  incoming.forEach((c) => {
    const id = c && c.id != null ? String(c.id) : '';
    if (id) incomingIds[id] = true;
  });
  const explicitSet = {};
  (explicitRemovedIds || []).forEach((id) => {
    if (id != null && String(id) !== '') explicitSet[String(id)] = true;
  });
  const tombstones = [];
  const preserved = [];
  existing.forEach((row) => {
    const id = row && row.id != null ? String(row.id) : '';
    if (id && !incomingIds[id]) {
      if (explicitSet[id]) {
        tombstones.push({ row, removedVia: 'explicit-delete' });
      } else {
        tombstones.push({ row, removedVia: 'saveAll-diff-preserved' });
        preserved.push(row);
      }
    }
  });
  return { written: incoming.concat(preserved), tombstones };
}

const ON_SHEET = [
  { id: 'a', name: 'דנה', notes: 'on-sheet-a' },
  { id: 'b', name: 'מנשה', notes: 'on-sheet-b' },
  { id: 'c', name: 'יוסי', notes: 'on-sheet-c' }
];

test('stale payload preserves missing rows: kept in the write with their CURRENT on-sheet values', () => {
  // A stale tab loaded before 'b' and 'c' existed and saves only 'a' (edited).
  const stale = [{ id: 'a', name: 'דנה', notes: 'edited-by-stale-tab' }];
  const out = mergeSave(ON_SHEET, stale, []);
  assert.deepEqual(out.written.map((r) => r.id), ['a', 'b', 'c'], 'no row may be dropped');
  // The rows the tab never loaded come back byte-for-byte from the sheet …
  assert.equal(out.written.find((r) => r.id === 'b'), ON_SHEET[1]);
  assert.equal(out.written.find((r) => r.id === 'c'), ON_SHEET[2]);
  // … while the row the tab DID send keeps the tab's edit.
  assert.equal(out.written.find((r) => r.id === 'a').notes, 'edited-by-stale-tab');
  // Visibility without loss: every preserved row is still logged.
  assert.deepEqual(
    out.tombstones.map((t) => [t.row.id, t.removedVia]),
    [['b', 'saveAll-diff-preserved'], ['c', 'saveAll-diff-preserved']]
  );
});

test('explicitRemovedIds still deletes: a declared id is dropped and attributed explicit-delete', () => {
  const out = mergeSave(ON_SHEET, [ON_SHEET[0], ON_SHEET[2]], ['b']);
  assert.deepEqual(out.written.map((r) => r.id), ['a', 'c'], 'the declared id must actually be removed');
  assert.deepEqual(out.tombstones.map((t) => [t.row.id, t.removedVia]), [['b', 'explicit-delete']]);
});

test('mixed save: declared id deletes, undeclared id preserves — in the same payload', () => {
  const out = mergeSave(ON_SHEET, [ON_SHEET[0]], ['c']);
  assert.deepEqual(out.written.map((r) => r.id), ['a', 'b']);
  const byId = {};
  out.tombstones.forEach((t) => { byId[t.row.id] = t.removedVia; });
  assert.deepEqual(byId, { b: 'saveAll-diff-preserved', c: 'explicit-delete' });
});

test('an empty incoming list preserves everything (the full-wipe clobber cannot happen)', () => {
  const out = mergeSave(ON_SHEET, [], []);
  assert.deepEqual(out.written.map((r) => r.id), ['a', 'b', 'c']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of the staleness flag (version echo)
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors _saveAll's staleSave computation: echoed payload.dataVersion vs the
// current counter. FAIL-OPEN on anything non-numeric.
function staleFlag(echoedRaw, curVersion) {
  const echoed = (echoedRaw === undefined || echoedRaw === null || echoedRaw === '')
    ? NaN
    : Number(echoedRaw);
  return isFinite(echoed) && echoed < curVersion;
}

test('version echo flags stale: echoed version older than current → staleSave true', () => {
  assert.equal(staleFlag(3, 5), true);
  assert.equal(staleFlag(0, 1), true);
  assert.equal(staleFlag('3', 5), true, 'a numeric string echo still counts');
});

test('current or newer echo → not stale', () => {
  assert.equal(staleFlag(5, 5), false);
  assert.equal(staleFlag(6, 5), false, 'a newer echo (clock/counter weirdness) must never flag');
});

test('FAIL-OPEN: missing / blank / non-numeric echo (old clients) is never flagged', () => {
  assert.equal(staleFlag(undefined, 5), false);
  assert.equal(staleFlag(null, 5), false);
  assert.equal(staleFlag('', 5), false);
  assert.equal(staleFlag('abc', 5), false);
  assert.equal(staleFlag(NaN, 5), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of the preserved-log dedupe
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors _saveAll's dedupe filter: skip the 'saveAll-diff-preserved' log row
// when the NEWEST tombstone for the id is already an open preserved entry.
function shouldLogPreserved(latestTombForId) {
  const lt = latestTombForId;
  return !(lt && lt.removedVia === 'saveAll-diff-preserved' && !lt.restoredAt);
}

test('dedupe: newest tombstone already an open saveAll-diff-preserved → not logged again', () => {
  assert.equal(shouldLogPreserved({ removedVia: 'saveAll-diff-preserved', restoredAt: '' }), false);
});

test('dedupe never swallows a NEW stale episode: no tombstone, other removedVia, or restored → logged', () => {
  assert.equal(shouldLogPreserved(undefined), true, 'first episode for this id');
  assert.equal(shouldLogPreserved({ removedVia: 'explicit-delete', restoredAt: '' }), true,
    'a later explicit-delete tombstone is a different event');
  assert.equal(shouldLogPreserved({ removedVia: 'saveAll-diff', restoredAt: '' }), true,
    'a historical pre-prevention tombstone does not suppress the new log');
  assert.equal(shouldLogPreserved({ removedVia: 'saveAll-diff-preserved', restoredAt: '2026-08-30T00:00:00Z' }), true,
    'a restored entry closed the episode — a fresh one is logged');
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards — Code.gs
// ─────────────────────────────────────────────────────────────────────────────

function saveAllBody() {
  const m = GS.match(/function _saveAll[\s\S]*?\n}/);
  assert.ok(m, '_saveAll not found');
  return m[0];
}

test('Code.gs: _saveAll splits explicit drops from preserved rows and pushes preserved rows back into the write', () => {
  const body = saveAllBody();
  assert.match(body, /explicitDropRows/, '_saveAll must separate declared deletes');
  assert.match(body, /preservedRows/, '_saveAll must collect the undeclared missing rows');
  assert.match(body, /clients\.push\(preservedRows\[p\]\)/,
    'preserved rows must be merged into the clients array that gets written');
  const mergeAt = body.indexOf('clients.push(preservedRows');
  const writeAt = body.indexOf("_writeAll(clientsSh, CLIENTS_HEADERS");
  assert.ok(mergeAt !== -1 && writeAt !== -1 && mergeAt < writeAt,
    'the merge must happen BEFORE the Clients clear-and-rewrite');
});

test("Code.gs: preserved rows are logged with the dedicated 'saveAll-diff-preserved' marker", () => {
  const body = saveAllBody();
  assert.match(body, /_appendClientTombstones\(preservedToLog, null, 'saveAll-diff-preserved'\)/,
    'preserved rows must still be tombstone-logged, under the new removedVia value');
  // The helper keeps 'saveAll-diff' only as its defensive default.
  const helper = GS.match(/function _appendClientTombstones[\s\S]*?\n}/);
  assert.ok(helper, '_appendClientTombstones not found');
  assert.match(helper[0], /viaFallback \|\| 'saveAll-diff'/);
});

test('Code.gs: preserved-log dedupe keys off the NEWEST open saveAll-diff-preserved tombstone', () => {
  const body = saveAllBody();
  assert.match(body, /latestTomb/, '_saveAll must index the latest tombstone per id');
  assert.match(body, /lt\.removedVia === 'saveAll-diff-preserved' && !lt\.restoredAt/,
    'dedupe must require an OPEN preserved entry');
});

test('Code.gs: CLIENTS_REMOVED_HEADERS untouched — the marker is a removedVia value, not a new column', () => {
  const m = GS.match(/var CLIENTS_REMOVED_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CLIENTS_REMOVED_HEADERS not found');
  assert.ok(!/preserved/i.test(m[1]), 'no preserved-marker column may be added to the tombstone sheet');
});

test('Code.gs: _getRemovedClients filters preserved log entries out of the admin restore surface', () => {
  const m = GS.match(/function _getRemovedClients[\s\S]*?\n}/);
  assert.ok(m, '_getRemovedClients not found');
  assert.match(m[0], /removedVia !== 'saveAll-diff-preserved'/,
    'live patients must never be listed under מטופלים שנמחקו');
});

test('Code.gs: dataVersion counter — script property, read + bump helpers', () => {
  assert.match(GS, /var CLIENTS_DATA_VERSION_PROP = 'CLIENTS_DATA_VERSION'/);
  const read = GS.match(/function _readDataVersion[\s\S]*?\n}/);
  assert.ok(read, '_readDataVersion not found');
  assert.match(read[0], /PropertiesService\.getScriptProperties\(\)/);
  const bump = GS.match(/function _bumpDataVersion[\s\S]*?\n}/);
  assert.ok(bump, '_bumpDataVersion not found');
  assert.match(bump[0], /_readDataVersion\(\) \+ 1/);
});

test('Code.gs: _getData returns the current dataVersion for the tab to echo', () => {
  const m = GS.match(/function _getData[\s\S]*?\n}/);
  assert.ok(m, '_getData not found');
  assert.match(m[0], /dataVersion: _readDataVersion\(\)/);
});

test('Code.gs: _saveAll computes staleSave fail-open, still writes, and bumps AFTER the write', () => {
  const body = saveAllBody();
  assert.match(body, /isFinite\(echoed\) && echoed < curVersion/,
    'staleSave must be flagged only for a finite echo older than current (fail-open)');
  const staleAt = body.indexOf('staleSave');
  const writeAt = body.indexOf("_writeAll(clientsSh, CLIENTS_HEADERS");
  const bumpAt = body.indexOf('_bumpDataVersion()');
  assert.ok(staleAt !== -1 && staleAt < writeAt, 'staleness is a signal, not a gate: the write still runs');
  assert.ok(bumpAt !== -1 && bumpAt > writeAt, 'the counter bumps after the successful write');
  assert.match(body, /staleSave: staleSave/, 'the response must carry the flag');
  assert.match(body, /dataVersion: newVersion/, 'the response must carry the new version so the tab re-syncs');
});

test('Code.gs: _restoreRemovedClient bumps the counter — restore is a Clients write stale tabs must learn about', () => {
  const m = GS.match(/function _restoreRemovedClient[\s\S]*?\n}/);
  assert.ok(m, '_restoreRemovedClient not found');
  assert.match(m[0], /_bumpDataVersion\(\)/);
});

test('Code.gs: doPost threads dataVersion through the saveAll branch (payload rebuilt field-by-field)', () => {
  assert.match(GS, /dataVersion: payload\.dataVersion/,
    'doPost must forward the echoed version to _saveAll');
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards — public/app.js
// ─────────────────────────────────────────────────────────────────────────────

test('app.js: loadAll stores the loaded dataVersion on state (null-safe)', () => {
  assert.match(APP, /state\.dataVersion = \(data\.dataVersion == null \|\| data\.dataVersion === ''\) \? null : Number\(data\.dataVersion\)/);
});

test('app.js: persist echoes the version, re-syncs from the response, and handles staleSave with toast + reload', () => {
  const m = APP.match(/async function persist\([\s\S]*?\n  \}/);
  assert.ok(m, 'persist not found in public/app.js');
  const body = m[0];
  assert.match(body, /if \(state\.dataVersion != null\) payload\.dataVersion = state\.dataVersion/,
    'the echo must be omitted when no version was loaded (fail-open end to end)');
  assert.match(body, /state\.dataVersion = Number\(data\.dataVersion\)/,
    'a successful save must adopt the new version so the SAME tab is not flagged next save');
  assert.match(body, /data\.staleSave/, 'persist must inspect the staleSave flag');
  assert.match(body, /loadAll\(\)/, 'a stale save must trigger a reload of server truth');
});

test('app.js: the stale-save toast carries the exact Hebrew message', () => {
  assert.ok(APP.includes("toast('הנתונים עודכנו ממכשיר אחר — רענני לראות את המצב המלא')"),
    'stale-save toast text must match the spec');
});
