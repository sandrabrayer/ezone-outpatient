'use strict';

/**
 * Coverage for the corrupted-rows cleanup pipeline (apps-script/Code.gs):
 * scanCorruptedRowsNow / harvestRevisionSnapshotsNow / writeRepairPlanNow /
 * applyCorruptedRowRepairsNow / deleteAutoSnapshotsNow, ported from the
 * Dashboard app's shipped design (E-Zone-Dashboard PRs #105/#107/#108).
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Three styles, matching the passing suites (stale-next-billing-repair):
 *
 * 1. REAL-CODE extraction: the pure helpers (wildcard/compatibility guard,
 *    exactly-one matcher, twin-merge, phone key, revision selection) use no
 *    GAS services — their source is extracted from Code.gs and eval'd, so the
 *    tests run the ACTUAL deployed logic.
 *
 * 2. VM SANDBOX: the whole Code.gs is loaded into a vm context with mocked
 *    SpreadsheetApp / DriveApp / Drive / UrlFetchApp / LockService backed by
 *    in-memory sheets that RECORD every write. This proves the contracts:
 *    scan is read-only; the plan writes only to RepairPlan with approved=
 *    FALSE; apply executes approved=TRUE rows only, re-verifies oldValue, and
 *    writes single cells; harvest is idempotent + failure-isolated; snapshot
 *    deletion touches AUTO-prefixed files only.
 *
 * 3. SOURCE-SCAN guards: the five entry points are NOT dispatchable via
 *    doGet/doPost; apply never uses _writeAll / bulk setValues; the scan
 *    engine has no write calls at all; RepairPlan/AuditLog header order is
 *    pinned; the snapshot prefix is EZONE-OUT-SNAPSHOT (never the Dashboard's
 *    EZONE-SNAPSHOT); appsscript.json declares the Drive advanced service and
 *    the explicit scope set; the locations mirror matches public/app.js; and
 *    CLIENTS_HEADERS stays untouched (34 append-only columns).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'appsscript.json'), 'utf8'));

// --- extract a whole `function name(...) {...}` out of Code.gs (balanced) ----
function gsFunction(name) {
  const sig = 'function ' + name + '(';
  const start = GS.indexOf(sig);
  assert.notEqual(start, -1, name + ' not found in Code.gs');
  const open = GS.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = open; j < GS.length; j++) {
    if (GS[j] === '{') depth++;
    else if (GS[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.notEqual(end, -1, name + ' has unbalanced braces');
  return GS.slice(start, end + 1);
}

// --- extract a single-line `var NAME = <literal>;` declaration ---------------
function gsVarDecl(name) {
  const m = GS.match(new RegExp('var ' + name + '\\s*=\\s*[^\\n]*;'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[0];
}

// --- array-of-strings literal (the clients-column-order pattern) -------------
function gsHeaders(name, src) {
  const m = (src || GS).match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found');
  return m[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

const CLIENTS_HEADERS = gsHeaders('CLIENTS_HEADERS');
const CLIENTS_REMOVED_HEADERS = gsHeaders('CLIENTS_REMOVED_HEADERS');
const LEADS_HEADERS = gsHeaders('LEADS_HEADERS');
const STOP_FLAGS_HEADERS = gsHeaders('STOP_FLAGS_HEADERS');
const THERAPIST_RATES_HEADERS = gsHeaders('THERAPIST_RATES_HEADERS');
const REPAIR_PLAN_HEADERS = gsHeaders('REPAIR_PLAN_HEADERS');
const AUDIT_LOG_HEADERS = gsHeaders('AUDIT_LOG_HEADERS');

// Build the pure helpers from the REAL Code.gs source.
const PURE_SRC = [
  gsVarDecl('CORRUPTION_MARK'),
  gsVarDecl('CORRUPTION_BUG_LIVE_DATE'),
  gsVarDecl('CORRUPTION_WINDOW_END_DATE'),
  gsFunction('_recoverPhone'),
  gsFunction('_hasCorruption'),
  gsFunction('_corruptionPhoneKey'),
  gsFunction('_corruptionWildcardRegex'),
  gsFunction('_corruptionMatchOne'),
  gsFunction('_corruptionTwinMerge'),
  gsFunction('_normalizeRevisions'),
  gsFunction('_selectHarvestRevisions'),
].join('\n');

// eslint-disable-next-line no-new-func
const g = new Function(PURE_SRC + `
  return {
    hasCorruption: _hasCorruption,
    phoneKey: _corruptionPhoneKey,
    wildcard: _corruptionWildcardRegex,
    matchOne: _corruptionMatchOne,
    twinMerge: _corruptionTwinMerge,
    normalizeRevisions: _normalizeRevisions,
    selectRevisions: _selectHarvestRevisions,
  };
`)();

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility guard (the shared wildcard rule)
// ─────────────────────────────────────────────────────────────────────────────

test('wildcard: surviving segments must appear in order, each U+FFFD run = 1+ chars', () => {
  const re = g.wildcard('אב�ג');
  assert.equal(re.test('אבXג'), true);
  assert.equal(re.test('אבXYZג'), true, 'a run may stand for many characters');
  assert.equal(re.test('אבג'), false, 'a run stands for at least ONE character');
});

test('wildcard: anchored at both ends — extra leading/trailing text is rejected', () => {
  const re = g.wildcard('אב�ג');
  assert.equal(re.test('Xאבqג'), false, 'leading text must match the first segment');
  assert.equal(re.test('אבqגX'), false, 'trailing text must match the last segment');
});

test('wildcard: out-of-order segments are rejected; multiple runs each need 1+ chars', () => {
  const re = g.wildcard('�נה �הן');
  assert.equal(re.test('דנה כהן'), true);
  assert.equal(re.test('נה הן'), false, 'both runs must stand for something');
  assert.equal(g.wildcard('אב�גד').test('גדXאב'), false, 'order matters');
});

test('wildcard: regex metacharacters in surviving text are escaped (JSON blobs)', () => {
  const re = g.wildcard('{"פרטני":2,"�":1}');
  assert.equal(re.test('{"פרטני":2,"קבוצה":1}'), true);
  assert.equal(re.test('X"פרטני":2,"קבוצה":1}'), false);
});

test('wildcard: a fully corrupted value matches anything non-empty (anchors only)', () => {
  const re = g.wildcard('���');
  assert.equal(re.test('דנה'), true);
  assert.equal(re.test(''), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Exactly-one matcher (enum + roster tiers)
// ─────────────────────────────────────────────────────────────────────────────

test('matchOne: exactly one compatible candidate wins', () => {
  const r = g.matchOne('רעננה �שר', ['רעננה אשר', 'רעננה הפרדס', 'רמות השבים']);
  assert.deepEqual(r, { count: 1, value: 'רעננה אשר' });
});

test('matchOne: zero matches -> no value (manual)', () => {
  const r = g.matchOne('קיסריה �', ['רעננה אשר', 'רמות השבים']);
  assert.deepEqual(r, { count: 0, value: '' });
});

test('matchOne: two or more matches -> no value (a machine must not guess)', () => {
  const r = g.matchOne('�עננה �', ['רעננה אשר', 'רעננה הפרדס']);
  assert.equal(r.count > 1, true);
  assert.equal(r.value, '');
});

// ─────────────────────────────────────────────────────────────────────────────
// Twin-merge
// ─────────────────────────────────────────────────────────────────────────────

test('twinMerge: two strings corrupted in different positions reconstruct the original', () => {
  assert.equal(g.twinMerge('אור� לוי', 'אורן �וי'), 'אורן לוי');
});

test('twinMerge: overlapping corruption / conflicting clean chars / length mismatch -> ""', () => {
  assert.equal(g.twinMerge('א�ג', 'א�ג'), '', 'same corrupted position cannot merge');
  assert.equal(g.twinMerge('אבג', 'אדג'), '', 'conflicting clean characters');
  assert.equal(g.twinMerge('א�גד', 'א�ג'), '', 'differing lengths are not mergeable');
  assert.equal(g.twinMerge('', ''), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// Phone key (the ecosystem rule: /^0\d{9}$/ only, leading zero healed)
// ─────────────────────────────────────────────────────────────────────────────

test('phoneKey: canonical, Sheets-dropped-zero, and intl forms all normalize', () => {
  assert.equal(g.phoneKey('0501234567'), '0501234567');
  assert.equal(g.phoneKey(501234567), '0501234567', 'numeric cell with dropped leading zero');
  assert.equal(g.phoneKey('+972-50-123-4567'), '0501234567');
});

test('phoneKey: anything not a full 10-digit 0-leading number returns "" (never matches)', () => {
  assert.equal(g.phoneKey(''), '');
  assert.equal(g.phoneKey('12'), '');
  assert.equal(g.phoneKey('039876543'), '', '9-digit numbers never participate');
  assert.equal(g.phoneKey(null), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// Revision selection (pure): windowing, dedupe, cap, sparse tolerance
// ─────────────────────────────────────────────────────────────────────────────

function rev(id, iso) {
  return { id, modified: Date.parse(iso), exportLinks: { x: id } };
}

test('selectRevisions: baseline before the window + ~6-day buckets + newest pre-fix', () => {
  const revisions = [];
  for (let d = new Date('2026-07-01T00:00:00Z'), i = 0; d < new Date('2026-09-10T00:00:00Z');
    d = new Date(d.getTime() + 86400000), i++) {
    revisions.push(rev('r' + i, d.toISOString()));
  }
  const out = g.selectRevisions(revisions);
  const labels = Array.from(out, (r) => r.dateLabel);
  assert.deepEqual(labels, [
    '2026-07-26', // newest strictly pre-2026-07-27 baseline
    '2026-08-01', '2026-08-07', '2026-08-13', '2026-08-19', '2026-08-25', // ~6-day buckets
    '2026-08-31', // newest pre-fix (last bucket + preFix dedupe to one)
  ]);
  assert.ok(out.length <= 10, 'default cap');
});

test('selectRevisions: sparse revisions — empty buckets are skipped, takes what exists', () => {
  const out = g.selectRevisions([rev('a', '2026-07-10T09:00:00Z'), rev('b', '2026-08-15T09:00:00Z')]);
  assert.deepEqual(Array.from(out, (r) => r.id), ['a', 'b']);
  assert.deepEqual(Array.from(out, (r) => r.dateLabel), ['2026-07-10', '2026-08-15']);
});

test('selectRevisions: no pre-bug revision -> no baseline, window picks still work', () => {
  const out = g.selectRevisions([rev('m', '2026-08-05T00:00:00Z')]);
  assert.deepEqual(Array.from(out, (r) => r.id), ['m']);
});

test('selectRevisions: same-day revisions dedupe to the latest (name encodes the date)', () => {
  const out = g.selectRevisions([
    rev('early', '2026-08-05T08:00:00Z'),
    rev('late', '2026-08-05T20:00:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'late');
});

test('selectRevisions: cap thins the middle but always keeps first and last', () => {
  const revisions = [];
  for (let d = new Date('2026-07-01T00:00:00Z'), i = 0; d < new Date('2026-09-10T00:00:00Z');
    d = new Date(d.getTime() + 86400000), i++) {
    revisions.push(rev('r' + i, d.toISOString()));
  }
  const out = g.selectRevisions(revisions, { stepDays: 2, cap: 5 });
  assert.ok(out.length <= 5, 'capped');
  const labels = Array.from(out, (r) => r.dateLabel);
  assert.equal(labels[0], '2026-07-26', 'baseline kept');
  assert.equal(labels[labels.length - 1], '2026-08-31', 'newest pre-fix kept');
});

test('normalizeRevisions: v2/v3 shapes both handled, undatable dropped, ascending', () => {
  const out = g.normalizeRevisions([
    { id: 'b', modifiedTime: '2026-08-02T00:00:00Z' },
    { id: 'a', modifiedDate: '2026-08-01T00:00:00Z' },
    { id: 'x' }, null,
  ]);
  assert.deepEqual(Array.from(out, (r) => r.id), ['a', 'b']);
});

// ─────────────────────────────────────────────────────────────────────────────
// VM sandbox
// ─────────────────────────────────────────────────────────────────────────────

// In-memory sheet: 2D array incl. header row; records every value write.
function mockSheet(name, data, writes) {
  let hidden = false;
  function range(row, col, numRows, numCols) {
    numRows = numRows || 1; numCols = numCols || 1;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = data[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      getValue() { return this.getValues()[0][0]; },
      setValue(v) {
        writes.push({ sheet: name, row, col, value: v, kind: 'setValue' });
        (data[row - 1] = data[row - 1] || [])[col - 1] = v;
      },
      setValues(vals) {
        writes.push({ sheet: name, row, col, numRows: vals.length, numCols: (vals[0] || []).length, kind: 'setValues' });
        for (let r = 0; r < vals.length; r++) {
          for (let c = 0; c < vals[r].length; c++) {
            (data[row - 1 + r] = data[row - 1 + r] || [])[col - 1 + c] = vals[r][c];
          }
        }
      },
      clearContent() {
        writes.push({ sheet: name, row, col, kind: 'clearContent' });
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            if (data[row - 1 + r]) data[row - 1 + r][col - 1 + c] = '';
          }
        }
      },
      setNumberFormat() { return this; },
    };
  }
  return {
    _data: data,
    getName: () => name,
    getLastRow: () => data.length,
    getMaxRows: () => Math.max(data.length, 1),
    getLastColumn: () => (data[0] ? data[0].length : 0),
    getRange: range,
    setFrozenRows() {},
    isSheetHidden: () => hidden,
    hideSheet() { hidden = true; },
    appendRow(r) { writes.push({ sheet: name, kind: 'appendRow' }); data.push(r.slice()); },
  };
}

function rowFromObj(headers, obj) {
  return headers.map((h) => (obj[h] === undefined ? '' : obj[h]));
}

// A mock spreadsheet over named mock sheets; insertSheet creates on demand.
function mockSpreadsheet(id, sheets, writes) {
  return {
    getId: () => id,
    getSheetByName: (n) => sheets[n] || null,
    insertSheet(n) {
      sheets[n] = mockSheet(n, [], writes);
      return sheets[n];
    },
  };
}

function driveFile(name, id) {
  return {
    getName: () => name,
    getId: () => id,
    getLastUpdated: () => new Date('2026-09-02T00:00:00Z'),
    setTrashed(v) { this.trashed = v; },
  };
}

function driveIterator(files) {
  let i = 0;
  return { hasNext: () => i < files.length, next: () => files[i++] };
}

function makeSandbox(opts) {
  const writes = [];
  const sheets = {};
  Object.keys(opts.sheets || {}).forEach((n) => { sheets[n] = mockSheet(n, opts.sheets[n], writes); });
  const ss = mockSpreadsheet('LIVE-SS', sheets, writes);
  const snapshotFiles = opts.snapshotFiles || [];
  const snapshotSpreadsheets = opts.snapshotSpreadsheets || {};
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: (id) => {
        if (!snapshotSpreadsheets[id]) throw new Error('not a spreadsheet: ' + id);
        return snapshotSpreadsheets[id];
      },
    },
    DriveApp: {
      searchFiles: opts.searchFiles || (() => driveIterator(snapshotFiles)),
      getFilesByName: opts.getFilesByName || (() => driveIterator([])),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10), getUuid: () => 'uuid' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: {
      createTextOutput: () => ({ setMimeType() { return this; } }),
      MimeType: { JSON: 'JSON' },
    },
    MailApp: { sendEmail() {} },
    ScriptApp: { getOAuthToken: () => 'tok' },
  };
  if (opts.Drive) ctx.Drive = opts.Drive;
  if (opts.UrlFetchApp) ctx.UrlFetchApp = opts.UrlFetchApp;
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  return { ctx, writes, sheets };
}

// ---- the scan scenario: one corrupted cell per tier ------------------------

function clientsRow(over) {
  return rowFromObj(CLIENTS_HEADERS, Object.assign({ status: 'פעיל' }, over));
}

function scanSandbox() {
  const snapWrites = [];
  const snapSheets = {
    Clients: mockSheet('Clients', [
      CLIENTS_HEADERS.slice(),
      clientsRow({ id: 'c3', name: 'משה כהן', notes: 'הערה טובה' }),
      clientsRow({ id: 'c4', name: 'יוסי לוי', notes: 'הערה אחת' }),
      clientsRow({ id: 'c4', name: 'יוסי לוי', notes: 'הערה שתיים' }),
      clientsRow({ id: 'c5', name: 'זיו כספי', location: 'קיסריה גמילה' }),
      clientsRow({ id: 'OLD10', name: 'נעמה שגב', phone: '0509999999' }),
    ], snapWrites),
  };
  const snapSs = mockSpreadsheet('SNAP-1', snapSheets, snapWrites);
  const sandbox = makeSandbox({
    sheets: {
      Clients: [
        CLIENTS_HEADERS.slice(),
        clientsRow({ id: 'c1', name: 'דנה �הן', fromLead: 'L9' }),                       // tier 0a: lead
        clientsRow({ id: 'c2', name: 'רות �וי', phone: '0521111111' }),                  // tier 0b: phone
        clientsRow({ id: 'c3', name: 'משה כהן', notes: 'הערה �ובה' }),                  // tier 1: snapshot
        clientsRow({ id: 'c4', name: 'יוסי לוי', notes: 'שוב �ערה' }),                  // tier 1: ambiguous
        clientsRow({ id: 'c5', name: 'זיו כספי', location: '�עננה אשר' }),              // tier 1: mismatch
        clientsRow({ id: 'c6', name: 'גל פרץ', location: 'רעננה �שר' }),                // tier 2: enum
        clientsRow({ id: 'c7', name: 'טל ברק', location: '�' }),                        // tier 2: multi
        clientsRow({ id: 'c8', name: 'אב� כהן' }),                                      // tier 3: roster
        clientsRow({ id: 'c9', name: 'אור� לוי' }),                                     // tier 3: twin-merge
        clientsRow({ id: 'c10', name: 'נע�ה שגב', phone: '0509999999' }),               // tier 1: phone fallback
      ],
      'Clients-removed': [
        CLIENTS_REMOVED_HEADERS.slice(),
        rowFromObj(CLIENTS_REMOVED_HEADERS, { id: 'c9', name: 'אורן �וי', status: 'פעיל' }),
      ],
      Leads: [
        LEADS_HEADERS.slice(),
        rowFromObj(LEADS_HEADERS, { id: 'L9', name: 'דנה כהן', phone: '0501234567', stage: 'פרטים אישיים' }),
      ],
      StopFlags: [
        STOP_FLAGS_HEADERS.slice(),
        rowFromObj(STOP_FLAGS_HEADERS, { id: 'sf1', name: 'רות לוי', phone: '0521111111' }),
        rowFromObj(STOP_FLAGS_HEADERS, { id: 'sf2', name: 'אבי כהן' }),
      ],
      TherapistRates: [
        THERAPIST_RATES_HEADERS.slice(),
        rowFromObj(THERAPIST_RATES_HEADERS, { name: 'ד�יה מלמד', flatRate: 230 }),
      ],
    },
    snapshotFiles: [driveFile('EZONE-OUT-SNAPSHOT-AUTO-2026-07-26', 'SNAP-1')],
    snapshotSpreadsheets: { 'SNAP-1': snapSs },
  });
  sandbox.snapWrites = snapWrites;
  return sandbox;
}

function findingFor(res, sheet, id, column) {
  // locate by (sheet, column) + the row's position established above
  return Array.from(res.cells).find((c) => c.sheet === sheet && c.column === column &&
    String(c.value).length > 0 && c.row === id);
}

test('vm scan: every tier classifies as designed, and the scan is 100% read-only', () => {
  const { ctx, writes, snapWrites } = scanSandbox();
  const res = ctx.scanCorruptedRowsNow();

  const by = {};
  Array.from(res.cells).forEach((c) => { by[c.sheet + '#' + c.row + '#' + c.column] = c; });

  // tier 0a — originating lead (Clients row 2 = c1)
  assert.equal(by['Clients#2#name'].proposal, 'repair from lead');
  assert.equal(by['Clients#2#name'].newValue, 'דנה כהן');
  // tier 0b — phone match (row 3 = c2)
  assert.equal(by['Clients#3#name'].proposal, 'repair from phone match');
  assert.equal(by['Clients#3#name'].newValue, 'רות לוי');
  // tier 1 — snapshot by stable id (row 4 = c3)
  assert.equal(by['Clients#4#notes'].proposal, 'repair from snapshot');
  assert.equal(by['Clients#4#notes'].newValue, 'הערה טובה');
  assert.match(by['Clients#4#notes'].source, /EZONE-OUT-SNAPSHOT-AUTO-2026-07-26/);
  // tier 1 — ambiguous snapshot key (two snapshot rows share id c4) → NO proposal
  assert.equal(by['Clients#5#notes'].proposal, 'no source — manual');
  assert.equal(by['Clients#5#notes'].newValue, '');
  assert.match(by['Clients#5#notes'].note, /ambiguous, no proposal/);
  // tier 1 — compatibility-guard mismatch blocks the weaker tiers too
  assert.equal(by['Clients#6#location'].proposal, 'snapshot mismatch — manual');
  assert.equal(by['Clients#6#location'].newValue, '');
  // tier 2 — enum exactly-one (location closed set)
  assert.equal(by['Clients#7#location'].proposal, 'repair from enum');
  assert.equal(by['Clients#7#location'].newValue, 'רעננה אשר');
  // tier 2 — enum multi-match → manual + note
  assert.equal(by['Clients#8#location'].proposal, 'no source — manual');
  assert.match(by['Clients#8#location'].note, /values match — manual/);
  // tier 3 — roster exactly-one
  assert.equal(by['Clients#9#name'].proposal, 'repair from roster');
  assert.equal(by['Clients#9#name'].newValue, 'אבי כהן');
  // tier 3 bonus — twin-merge across the Clients family (same id, different corruption)
  assert.equal(by['Clients#10#name'].proposal, 'repair from twin-merge');
  assert.equal(by['Clients#10#name'].newValue, 'אורן לוי');
  assert.equal(by['Clients-removed#2#name'].proposal, 'repair from twin-merge');
  assert.equal(by['Clients-removed#2#name'].newValue, 'אורן לוי');
  // tier 1 — phone FALLBACK when the stable id is absent from the snapshot
  assert.equal(by['Clients#11#name'].proposal, 'repair from snapshot');
  assert.equal(by['Clients#11#name'].newValue, 'נעמה שגב');
  // TherapistRates — enum repair, loudly marked for cross-app verification
  assert.equal(by['TherapistRates#2#name'].proposal, 'repair from enum');
  assert.equal(by['TherapistRates#2#name'].newValue, 'דליה מלמד');
  assert.match(by['TherapistRates#2#name'].source, /THERAPIST-NAME — verify cross-app/);
  // Client name proposals carry the cross-app client-name caution
  assert.match(by['Clients#2#name'].source, /CLIENT-NAME/);

  // READ-ONLY: no value write of any kind, live or snapshot.
  const valueWrites = writes.concat(snapWrites).filter((w) =>
    w.kind === 'setValue' || w.kind === 'setValues' || w.kind === 'appendRow' || w.kind === 'clearContent');
  assert.deepEqual(valueWrites, [], 'scan must not write anything');
});

test('vm scan: no snapshot in Drive — tiers 2-3 still run, tier 1 skipped', () => {
  const { ctx } = makeSandbox({
    sheets: {
      Clients: [CLIENTS_HEADERS.slice(), clientsRow({ id: 'c6', name: 'גל פרץ', location: 'רעננה �שר' })],
    },
  });
  const res = ctx.scanCorruptedRowsNow();
  assert.deepEqual(Array.from(res.snapshots), []);
  assert.equal(res.cells[0].proposal, 'repair from enum');
});

// ---- writeRepairPlanNow -----------------------------------------------------

test('vm plan: writes only RepairPlan, pinned column order, everything approved=FALSE', () => {
  const { ctx, writes, sheets } = scanSandbox();
  const count = ctx.writeRepairPlanNow();
  assert.ok(count > 0);
  const plan = sheets.RepairPlan._data;
  assert.deepEqual(plan[0], REPAIR_PLAN_HEADERS, 'header row is the pinned order');
  assert.equal(plan.length - 1, count);
  for (let r = 1; r < plan.length; r++) {
    assert.equal(plan[r][REPAIR_PLAN_HEADERS.indexOf('approved')], 'FALSE', 'row ' + r + ' starts unapproved');
    assert.equal(plan[r][REPAIR_PLAN_HEADERS.indexOf('action')], 'repair');
  }
  // the therapist-name plan row carries the loud suffix in `source`
  const srcIdx = REPAIR_PLAN_HEADERS.indexOf('source');
  const therapistRow = plan.slice(1).find((r) => r[0] === 'TherapistRates');
  assert.match(therapistRow[srcIdx], /THERAPIST-NAME — verify cross-app/);
  // no write ever targets a data sheet
  const offPlan = writes.filter((w) => w.sheet !== 'RepairPlan' &&
    (w.kind === 'setValue' || w.kind === 'setValues' || w.kind === 'appendRow' || w.kind === 'clearContent'));
  assert.deepEqual(offPlan, [], 'plan writer must not touch any data sheet');
});

// ---- applyCorruptedRowRepairsNow --------------------------------------------

function applySandbox() {
  const NAME = CLIENTS_HEADERS.indexOf('name');
  const NOTES = CLIENTS_HEADERS.indexOf('notes');
  const planRow = (sheet, row, column, newValue, approved, oldValue) =>
    rowFromObj(REPAIR_PLAN_HEADERS, { sheet, row, column, newValue, action: 'repair', approved, oldValue, source: 's' });
  const sb = makeSandbox({
    sheets: {
      Clients: [
        CLIENTS_HEADERS.slice(),
        clientsRow({ id: 'c1', name: 'דנה �הן' }),
        clientsRow({ id: 'c2', name: 'רות �וי' }),
        clientsRow({ id: 'c3', name: 'x', notes: 'הערה �שנה' }),
        clientsRow({ id: 'c4', name: 'y', notes: 'שור� אחר' }),
      ],
      RepairPlan: [
        REPAIR_PLAN_HEADERS.slice(),
        planRow('Clients', 2, 'name', 'דנה כהן', 'FALSE', 'דנה �הן'),   // not approved → untouched
        planRow('Clients', 3, 'name', 'רות לוי', 'TRUE', 'רות �וי'),     // approved + verified → applied
        planRow('Clients', 4, 'notes', 'טקסט', 'TRUE', 'ערך-ישן-אחר'),  // oldValue drift → skipped
        planRow('Clients', 2, 'name', '', 'TRUE', 'דנה �הן'),            // blank newValue → skipped
        planRow('NoSuchSheet', 2, 'name', 'y', 'TRUE', 'z'),              // unknown sheet → skipped
        planRow('Clients', 5, 'notes', 'שורה אחרת', true, 'שור� אחר'),  // boolean TRUE cell → applied
      ],
    },
  });
  sb.NAME = NAME; sb.NOTES = NOTES;
  return sb;
}

test('vm apply: approved=TRUE rows only; oldValue re-verified; single-cell writes only', () => {
  const { ctx, writes, sheets, NAME, NOTES } = applySandbox();
  const res = ctx.applyCorruptedRowRepairsNow();
  assert.equal(res.ok, true);
  assert.equal(res.applied, 2);
  assert.equal(res.skipped, 3);
  // exactly two single-cell setValue writes on Clients, at the planned cells
  const clientWrites = writes.filter((w) => w.sheet === 'Clients');
  assert.deepEqual(clientWrites, [
    { sheet: 'Clients', row: 3, col: NAME + 1, value: 'רות לוי', kind: 'setValue' },
    { sheet: 'Clients', row: 5, col: NOTES + 1, value: 'שורה אחרת', kind: 'setValue' },
  ]);
  // unapproved and drifted rows are untouched
  assert.equal(sheets.Clients._data[1][NAME], 'דנה �הן');
  assert.equal(sheets.Clients._data[3][NOTES], 'הערה �שנה');
  // audit trail: one AuditLog row per applied repair (fail-soft sheet, created on demand)
  assert.equal(sheets.AuditLog._data.length, 1 + 2);
  assert.deepEqual(sheets.AuditLog._data[0], AUDIT_LOG_HEADERS);
  assert.equal(sheets.AuditLog._data[1][AUDIT_LOG_HEADERS.indexOf('action')], 'corruption_repair');
});

test('vm apply: no RepairPlan sheet -> no-op; empty plan -> no-op', () => {
  const empty = makeSandbox({ sheets: { Clients: [CLIENTS_HEADERS.slice()] } });
  assert.deepEqual({ ...empty.ctx.applyCorruptedRowRepairsNow() }, { ok: true, applied: 0, skipped: 0 });
  const writesBefore = empty.writes.filter((w) => w.kind === 'setValue');
  assert.deepEqual(writesBefore, []);
});

// ---- harvest + delete -------------------------------------------------------

test('vm harvest: selects across the window, skips existing names, isolates failures', () => {
  const created = [];
  const existing = { 'EZONE-OUT-SNAPSHOT-AUTO-2026-08-01': true };
  const { ctx } = makeSandbox({
    sheets: {},
    getFilesByName: (name) => driveIterator(existing[name] ? [driveFile(name, 'x')] : []),
    Drive: {
      Revisions: {
        list: () => ({
          revisions: [
            { id: 'r1', modifiedTime: '2026-07-20T10:00:00Z', exportLinks: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'url-r1' } },
            { id: 'r2', modifiedTime: '2026-07-26T10:00:00Z', exportLinks: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'url-r2' } },
            { id: 'r3', modifiedTime: '2026-08-01T10:00:00Z', exportLinks: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'url-r3' } },
            { id: 'r4', modifiedTime: '2026-08-13T10:00:00Z', exportLinks: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'url-r4' } },
            { id: 'r5', modifiedTime: '2026-08-31T10:00:00Z', exportLinks: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'url-r5' } },
          ],
        }),
      },
      Files: { create: (resource) => { created.push(resource.name); return { id: 'new' }; } },
    },
    UrlFetchApp: {
      fetch: (url) => ({
        getResponseCode: () => (url === 'url-r4' ? 500 : 200), // one revision's export fails
        getBlob: () => ({ blob: url }),
        getContentText: () => '{}',
      }),
    },
  });
  const summary = ctx.harvestRevisionSnapshotsNow();
  assert.equal(summary.found, 5);
  assert.equal(summary.selected, 4, 'baseline 07-26 + buckets 08-01/08-13 + pre-fix 08-31');
  assert.equal(summary.skipped, 1, '08-01 already harvested — idempotent');
  assert.equal(summary.failed, 1, 'the failing export is isolated');
  assert.equal(summary.harvested, 2);
  assert.deepEqual(Array.from(created),
    ['EZONE-OUT-SNAPSHOT-AUTO-2026-07-26', 'EZONE-OUT-SNAPSHOT-AUTO-2026-08-31']);
});

test('vm delete: trashes ONLY EZONE-OUT-SNAPSHOT-AUTO-* files', () => {
  const auto = driveFile('EZONE-OUT-SNAPSHOT-AUTO-2026-07-26', 'a');
  const manual = driveFile('EZONE-OUT-SNAPSHOT', 'b');
  const manualDated = driveFile('EZONE-OUT-SNAPSHOT-manual-copy', 'c');
  const other = driveFile('ezone-random', 'd');
  const { ctx } = makeSandbox({
    sheets: {},
    searchFiles: () => driveIterator([auto, manual, manualDated, other]),
  });
  const res = ctx.deleteAutoSnapshotsNow();
  assert.equal(res.trashed, 1);
  assert.equal(auto.trashed, true);
  assert.notEqual(manual.trashed, true, 'a manual snapshot is never touched');
  assert.notEqual(manualDated.trashed, true);
  assert.notEqual(other.trashed, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_ENTRY_POINTS = ['scanCorruptedRowsNow', 'harvestRevisionSnapshotsNow',
  'writeRepairPlanNow', 'applyCorruptedRowRepairsNow', 'deleteAutoSnapshotsNow'];

test('dispatcher guard: none of the five entry points is reachable via doGet/doPost', () => {
  const doGet = gsFunction('doGet');
  const doPost = gsFunction('doPost');
  PUBLIC_ENTRY_POINTS.forEach((fn) => {
    assert.ok(!doGet.includes(fn), fn + ' must not be routed in doGet');
    assert.ok(!doPost.includes(fn), fn + ' must not be routed in doPost');
  });
});

test('all five entry points exist as public (Run-dropdown) functions', () => {
  PUBLIC_ENTRY_POINTS.forEach((fn) => { gsFunction(fn); });
});

test('RepairPlan header order is pinned', () => {
  assert.deepEqual(REPAIR_PLAN_HEADERS,
    ['sheet', 'row', 'column', 'newValue', 'action', 'approved', 'oldValue', 'source']);
});

test('AuditLog header order is pinned; logAudit_ is fail-soft (whole body in try/catch)', () => {
  assert.deepEqual(AUDIT_LOG_HEADERS, ['timestamp', 'action', 'fn', 'rowKey', 'name', 'details']);
  const body = gsFunction('logAudit_');
  assert.match(body, /^function logAudit_\([^)]*\)\s*\{\s*try\s*\{/, 'starts with try');
  assert.ok(/catch \(err\)/.test(body), 'swallows every failure');
  assert.ok(!body.includes('throw'), 'never throws');
});

test('apply: LockService, single-cell setValue only — never _writeAll, never bulk setValues', () => {
  const body = gsFunction('applyCorruptedRowRepairsNow');
  assert.ok(/LockService\.getScriptLock\(\)/.test(body), 'uses the script lock');
  assert.ok(!body.includes('_writeAll('), 'must never rewrite a whole sheet');
  assert.ok(!body.includes('.setValues('), 'no bulk writes');
  assert.ok(/cell\.setValue\(newValue\)/.test(body), 'writes the single verified cell');
  assert.ok(/toUpperCase\(\) === 'TRUE'/.test(body), 'executes approved rows only');
  assert.ok(/_hasCorruption\(current\)/.test(body), 're-verifies the cell is still corrupted');
});

test('scan engine is read-only at the source level (no writes, no sheet creation)', () => {
  ['_corruptionScan', '_corruptionReadRows', '_corruptionSnapshotRows', 'scanCorruptedRowsNow'].forEach((fn) => {
    const body = gsFunction(fn);
    ['.setValue(', '.setValues(', 'appendRow', 'clearContent', '_writeAll(', '_ensureSheet(', 'insertSheet'].forEach((call) => {
      assert.ok(!body.includes(call), fn + ' must not contain ' + call);
    });
  });
});

test('snapshot prefix is EZONE-OUT-SNAPSHOT — never the Dashboard app\'s EZONE-SNAPSHOT', () => {
  assert.ok(GS.includes("var SNAPSHOT_NAME_PREFIX = 'EZONE-OUT-SNAPSHOT'"));
  assert.ok(/var AUTO_SNAPSHOT_PREFIX = SNAPSHOT_NAME_PREFIX \+ '-AUTO-'/.test(GS));
  assert.ok(!GS.includes("'EZONE-SNAPSHOT'"), 'the Dashboard prefix must never appear');
});

test('corruption window constants match the incident', () => {
  assert.ok(GS.includes("var CORRUPTION_BUG_LIVE_DATE = '2026-07-27'"));
  assert.ok(GS.includes("var CORRUPTION_WINDOW_END_DATE = '2026-09-01'"));
});

test('appsscript.json: Drive advanced service v3 + the explicit minimal scope set', () => {
  assert.deepEqual(MANIFEST.dependencies.enabledAdvancedServices,
    [{ userSymbol: 'Drive', version: 'v3', serviceId: 'drive' }]);
  assert.deepEqual(MANIFEST.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  assert.equal(MANIFEST.webapp.access, 'ANYONE_ANONYMOUS', 'webapp deployment unchanged');
  assert.equal(MANIFEST.timeZone, 'Asia/Jerusalem');
});

test('CORRUPTION_LOCATIONS mirrors public/app.js LOCATIONS exactly', () => {
  const codeGs = gsHeaders('CORRUPTION_LOCATIONS');
  const frontend = APP_JS.match(/var LOCATIONS = \[([^\]]*)\]/)[1]
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(codeGs, frontend);
});

test('CLIENTS_HEADERS untouched: 34 append-only columns ending at paymentAmountOverrides', () => {
  assert.equal(CLIENTS_HEADERS.length, 34);
  assert.equal(CLIENTS_HEADERS[CLIENTS_HEADERS.length - 1], 'paymentAmountOverrides');
});

test('scan targets: every configured column exists in its sheet\'s header array', () => {
  // Run the real _corruptionScanTargets with its Code.gs dependencies in scope.
  const src = [
    gsVarDecl('THERAPIST_NAME_SUFFIX'),
    gsVarDecl('CLIENT_NAME_SUFFIX'),
    gsVarDecl('CONTINUATION_SHEET'),
    gsVarDecl('STOP_ALERTS_SHEET'),
    gsVarDecl('THERAPIST_RATES_SHEET'),
    'var CLIENTS_HEADERS = ' + JSON.stringify(CLIENTS_HEADERS) + ';',
    'var CLIENTS_REMOVED_HEADERS = ' + JSON.stringify(CLIENTS_REMOVED_HEADERS) + ';',
    'var LEADS_HEADERS = ' + JSON.stringify(LEADS_HEADERS) + ';',
    'var REMOVED_LEADS_HEADERS = ' + JSON.stringify(gsHeaders('REMOVED_LEADS_HEADERS')) + ';',
    'var PAYMENTS_HEADERS = ' + JSON.stringify(gsHeaders('PAYMENTS_HEADERS')) + ';',
    'var CHARGES_HEADERS = ' + JSON.stringify(gsHeaders('CHARGES_HEADERS')) + ';',
    'var SESSION_LOG_HEADERS = ' + JSON.stringify(gsHeaders('SESSION_LOG_HEADERS')) + ';',
    'var THERAPIST_RATES_HEADERS = ' + JSON.stringify(THERAPIST_RATES_HEADERS) + ';',
    'var STOP_FLAGS_HEADERS = ' + JSON.stringify(STOP_FLAGS_HEADERS) + ';',
    'var STOP_ALERTS_HEADERS = ' + JSON.stringify(gsHeaders('STOP_ALERTS_HEADERS')) + ';',
    'var EXTRA_SESSION_HEADERS = ' + JSON.stringify(gsHeaders('EXTRA_SESSION_HEADERS')) + ';',
    'var CONTINUATION_HEADERS = ' + JSON.stringify(gsHeaders('CONTINUATION_HEADERS')) + ';',
    'var SETTINGS_HEADERS = ' + JSON.stringify(gsHeaders('SETTINGS_HEADERS')) + ';',
    gsFunction('_corruptionScanTargets'),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const targets = new Function(src + '\nreturn _corruptionScanTargets();')();
  assert.ok(targets.length >= 13, 'all Phase-1 sheets are covered');
  targets.forEach((t) => {
    t.textCols.concat(t.phoneCols || [], t.nameCol ? [t.nameCol] : [],
      t.keyCol ? [t.keyCol] : [], t.leadIdCol ? [t.leadIdCol] : [])
      .forEach((col) => {
        assert.ok(t.headers.includes(col), t.sheet + ': column "' + col + '" not in its header array');
      });
    Object.keys(t.enumCols || {}).forEach((col) => {
      assert.ok(t.textCols.includes(col), t.sheet + ': enum column "' + col + '" must also be scanned');
    });
    Object.keys(t.crossAppCols || {}).forEach((col) => {
      assert.ok(t.headers.includes(col), t.sheet + ': cross-app column "' + col + '" not in headers');
    });
  });
  // the therapist-name columns are all loudly marked
  const bySheet = {};
  targets.forEach((t) => { bySheet[t.sheet] = t; });
  assert.match(bySheet.TherapistRates.crossAppCols.name, /THERAPIST-NAME/);
  assert.match(bySheet.SessionLog.crossAppCols.therapist, /THERAPIST-NAME/);
  assert.match(bySheet.ExtraSessionRequests.crossAppCols.therapist, /THERAPIST-NAME/);
});
