'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../ops/removed-leads-header-correction.gs'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const schemaMatch = backend.match(/var REMOVED_LEADS_HEADERS = (\[[\s\S]*?\]);/);
assert.ok(schemaMatch, 'the production schema is the independent schema reference');
const canonical = Array.from(vm.runInNewContext('(' + schemaMatch[1] + ')'));
const SCRIPT_ID = '1JSI3Ahqnen0pxi1x5q24nBku8Nk8I5iFNqRC-yMcTv1EDKTh6KhmSuSX';
const WORKBOOK_ID = '17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc';
const SHEET_ID = 1894136505;
const SHEET_NAME = 'לידים שהוסרו';
const RUNTIME_HASH = '5a9c368dec1a59d1644068aa7aa87b9ed02ebbd2f5a0b04f008d97e9ca867f8a';
const START = Date.parse('2026-10-27T19:00:00.000Z');
const TAIL = ['updatedAt', 'updatedBy', 'preferredHouse'];
const plain = value => JSON.parse(JSON.stringify(value));
const cloneCell = value => value instanceof Date ? new Date(value.getTime()) : value;
const cloneGrid = grid => grid.map(row => row.map(cloneCell));

// A separate fixture keeps the frozen native-drill test-support bytes intact.
// It supplies only the read capabilities and the single approved mutation.
function fixture() {
  const w = {
    now: START, phase: 'setup', held: false, events: [], writes: [], logs: [],
    hook: null, failures: new Map(), busy: false, missingWorkbook: false, missingSheet: false,
    scriptId: SCRIPT_ID, workbookId: WORKBOOK_ID, sheetId: SHEET_ID, sheetName: SHEET_NAME,
    maxRows: 999, maxColumns: 26, frozenRows: 1, frozenColumns: 0,
    merged: false, editable: true, validations: [[null, null, null]],
    sheetProtections: [], rangeProtections: [],
    props: { UNRELATED_SECRET: 'synthetic-property-never-read' },
    unrelated: { Clients: [['synthetic-client', 250]], Backup: [['synthetic-old-snapshot']] },
    formats: { headerNumberFormat: '@', phoneNumberFormat: '@', headerColor: '#e0e0e0' },
    grid: Array.from({ length: 999 }, () => Array(26).fill('')),
    formulas: Array.from({ length: 999 }, () => Array(26).fill(''))
  };
  w.grid[0].splice(0, 18, ...canonical.slice(0, 18));
  w.grid[1].splice(0, 7, 'synthetic-lead-001', 'SYNTHETIC PRIVATE ROW', '0500000001', 'synthetic', false, 0, new Date('2026-10-01T00:00:00Z'));
  w.grid[2][0] = 'synthetic-lead-002';
  w.grid[2][5] = 2;
  w.formulas[2][5] = '=1+1';
  w.grid[6][0] = 'synthetic-last-row';

  function event(type, details = {}) {
    const e = { type, locked: w.held, phase: w.phase, ...details };
    w.events.push(e);
    if (w.hook) w.hook(e, w);
    const failure = w.failures.get(type + ':' + (details.key || '')) || w.failures.get(type);
    if (failure) throw new Error('SYNTHETIC PRIVATE SERVICE ERROR: ' + failure);
    return e;
  }
  function usedBounds() {
    let lastRow = 0, lastColumn = 0;
    for (let r = 0; r < w.grid.length; r++) {
      for (let c = 0; c < w.grid[r].length; c++) {
        if (w.grid[r][c] !== '' || w.formulas[r][c] !== '') {
          lastRow = Math.max(lastRow, r + 1);
          lastColumn = Math.max(lastColumn, c + 1);
        }
      }
    }
    return { lastRow, lastColumn };
  }
  function range(row, column, rows = 1, columns = 1) {
    assert.ok([row, column, rows, columns].every(Number.isInteger), 'bounded numeric ranges only');
    assert.ok(row > 0 && column > 0 && rows > 0 && columns > 0);
    assert.ok(row + rows - 1 <= w.maxRows && column + columns - 1 <= w.maxColumns, 'range remains allocated');
    const rectangle = [row, column, rows, columns];
    const full = row === 1 && column === 1 && rows === 999 && columns === 26;
    return {
      getValues() {
        event('getValues', { rectangle, full });
        const result = w.grid.slice(row - 1, row - 1 + rows).map(r => r.slice(column - 1, column - 1 + columns).map(cloneCell));
        return full && w.mapValues ? w.mapValues(result) : result;
      },
      getFormulas() {
        event('getFormulas', { rectangle, full });
        const result = w.formulas.slice(row - 1, row - 1 + rows).map(r => r.slice(column - 1, column - 1 + columns));
        return full && w.mapFormulas ? w.mapFormulas(result) : result;
      },
      setValues(values) {
        event('setValues', { rectangle });
        assert.equal(w.held, true, 'the actual write must hold the writer lock');
        assert.deepEqual(rectangle, [1, 19, 1, 3], 'no wider write capability is permitted');
        assert.deepEqual(plain(values), [TAIL]);
        w.writes.push({ rectangle: rectangle.slice(), values: plain(values) });
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < columns; c++) w.grid[row - 1 + r][column - 1 + c] = values[r][c];
        }
        event('afterSetValues', { rectangle });
        return this;
      },
      isPartOfMerge() { event('isPartOfMerge', { rectangle }); return w.merged; },
      getDataValidations() { event('getDataValidations', { rectangle }); return w.validations; },
      canEdit() { event('canEdit', { rectangle }); return w.editable; },
      getSheet() { return sh; },
      getRow() { return row; },
      getColumn() { return column; },
      getNumRows() { return rows; },
      getNumColumns() { return columns; }
    };
  }
  const sh = {
    getSheetId() { event('getSheetId'); return w.sheetId; },
    getName() { event('getName'); return w.sheetName; },
    getMaxRows() { event('getMaxRows'); return w.maxRows; },
    getMaxColumns() { event('getMaxColumns'); return w.maxColumns; },
    getFrozenRows() { event('getFrozenRows'); return w.frozenRows; },
    getFrozenColumns() { event('getFrozenColumns'); return w.frozenColumns; },
    getLastRow() { event('getLastRow'); return w.overrideLastRow ?? usedBounds().lastRow; },
    getLastColumn() { event('getLastColumn'); return w.overrideLastColumn ?? usedBounds().lastColumn; },
    getRange: range,
    getProtections(type) {
      event('getProtections', { key: type });
      return type === 'SHEET' ? w.sheetProtections : w.rangeProtections;
    }
  };
  const workbook = {
    getId() { event('getWorkbookId'); return w.workbookId; },
    getSheetByName(name) { event('getSheetByName'); return !w.missingSheet && name === SHEET_NAME ? sh : null; }
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [w.now])); }
    static now() { return w.now; }
  }
  const lock = {
    tryLock(milliseconds) {
      event('tryLock', { milliseconds });
      assert.equal(milliseconds, 5000);
      if (w.busy) return false;
      assert.equal(w.held, false);
      w.held = true;
      event('lockAcquired');
      return true;
    },
    releaseLock() {
      event('releaseLock');
      assert.equal(w.held, true, 'never release an unowned lock');
      w.held = false;
    }
  };
  const ctx = {
    Date: Clock,
    REMOVED_LEADS_HEADERS: canonical.slice(),
    ScriptApp: { getScriptId() { event('getScriptId'); return w.scriptId; } },
    SpreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      getActiveSpreadsheet() { event('getActiveSpreadsheet'); return w.missingWorkbook ? null : workbook; },
      flush() { event('flush'); assert.equal(w.held, true, 'flush happens under the writer lock'); }
    },
    LockService: { getScriptLock() { event('getScriptLock'); return lock; } },
    PropertiesService: {
      getScriptProperties() {
        event('getScriptProperties');
        return {
          getProperty(key) {
            assert.ok(['OUTPATIENT_RECOVERY_HOLD', 'INTEGRITY_ACTIVE_BACKUP'].includes(key), 'no unrelated property read');
            event('getProperty', { key });
            return Object.prototype.hasOwnProperty.call(w.props, key) ? w.props[key] : null;
          }
        };
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest(algorithm, value, charset) {
        event('computeDigest');
        assert.equal(algorithm, 'SHA_256');
        assert.equal(charset, 'UTF_8');
        return Array.from(crypto.createHash('sha256').update(value, 'utf8').digest(), byte => byte > 127 ? byte - 256 : byte);
      }
    },
    Logger: { log(value) { event('log'); w.logs.push(value); } }
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'removed-leads-header-correction.gs' });
  w.ctx = ctx;
  w.rangeProtection = (...args) => ({ getRange: () => range(...args) });
  w.preview = () => { w.phase = 'preview'; return ctx.previewRemovedLeadsHeaderCorrection(); };
  w.apply = () => { w.phase = 'apply'; return ctx.applyRemovedLeadsHeaderCorrection(); };
  w.clearTrace = () => { w.events.length = 0; w.logs.length = 0; w.writes.length = 0; };
  w.receipt = () => JSON.parse(w.logs.at(-1));
  w.protectedState = () => ({ grid: cloneGrid(w.grid), formulas: cloneGrid(w.formulas),
    formats: plain(w.formats), props: plain(w.props), unrelated: plain(w.unrelated),
    frozenRows: w.frozenRows, frozenColumns: w.frozenColumns });
  w.approve = () => {
    const preview = w.preview();
    ctx.OP03_HEADER_CORRECTION_APPROVAL = {
      operation: 'op03-removed-leads-headers-v1', runtimeSourceSha256: RUNTIME_HASH,
      previewFingerprint: preview.previewFingerprint, previewObservedAt: preview.observedAt,
      operator: 'synthetic operator', ownerApprovalReference: 'synthetic exact-three-cell approval',
      pauseEvidenceReference: 'synthetic coordinated pause evidence',
      windowStart: new Date(w.now - 1000).toISOString(),
      windowEnd: new Date(w.now + 59000).toISOString(),
      operatorAttestations: {
        runtimeSourceReadBack: true, applicationRequestsStopped: true, directEditorsStopped: true,
        integrationsStopped: true, scheduledAndManualJobsStopped: true, legacyBackupDrained: true
      }
    };
    w.clearTrace();
    return ctx.OP03_HEADER_CORRECTION_APPROVAL;
  };
  return w;
}

function refusesWithoutWrite(w, expected = /OP03 header correction:/) {
  const before = w.protectedState();
  assert.throws(() => w.apply(), expected);
  assert.equal(w.writes.length, 0);
  assert.deepEqual(w.protectedState(), before, 'a refusal preserves all existing cells and surrounding state');
  assert.equal(w.held, false);
  const receipt = w.receipt();
  assert.equal(receipt.status, 'refused');
  assert.equal(receipt.writeAttempted, false);
  assert.equal(receipt.writeVerified, false);
  return receipt;
}

test('header helper is default-disabled without accessing Google state', () => {
  const w = fixture();
  refusesWithoutWrite(w, /apply_disabled/);
  assert.deepEqual(w.events.map(e => e.type), ['log']);
});

test('preview is read-only, schema-bound and free of row payload', () => {
  const w = fixture(), before = w.protectedState();
  const receipt = w.preview();
  assert.deepEqual(w.protectedState(), before);
  assert.equal(w.writes.length, 0);
  assert.equal(receipt.status, 'preview');
  assert.equal(receipt.snapshot.headerState, 'pending');
  assert.equal(receipt.snapshot.lastColumn, 18);
  assert.equal(receipt.snapshot.lastRow, 7);
  assert.equal(receipt.pauseMachineVerified, false);
  assert.equal(receipt.legacyBackupIdleMachineVerified, false);
  assert.match(receipt.previewFingerprint, /^[a-f0-9]{64}$/);
  const expected = crypto.createHash('sha256').update(JSON.stringify({
    observation: plain(receipt.snapshot), observedAt: receipt.observedAt
  })).digest('hex');
  assert.equal(receipt.previewFingerprint, expected);
  assert.equal(w.logs.some(s => /SYNTHETIC PRIVATE ROW|synthetic-property-never-read|=1\+1/.test(s)), false);
  assert.deepEqual(plain(w.ctx._op03HcDefinition_().headers), canonical);
});

test('valid approval writes exactly S1:U1, flushes and verifies under lock, preserving every other cell and property', () => {
  const w = fixture();
  w.approve();
  const before = w.protectedState(), expected = w.protectedState();
  expected.grid[0].splice(18, 3, ...TAIL);
  const receipt = w.apply();
  assert.deepEqual(w.protectedState(), expected);
  assert.deepEqual(w.writes, [{ rectangle: [1, 19, 1, 3], values: [TAIL] }]);
  assert.deepEqual(w.grid[0].slice(0, 18), before.grid[0].slice(0, 18));
  assert.equal(receipt.status, 'corrected');
  assert.equal(receipt.writeAttempted, true);
  assert.equal(receipt.writeVerified, true);
  assert.equal(receipt.lockReleased, true);
  const types = w.events.map(e => e.type), writeAt = types.indexOf('setValues');
  const flushAt = types.indexOf('flush'), releaseAt = types.indexOf('releaseLock');
  assert.ok(types.indexOf('lockAcquired') < writeAt);
  assert.ok(writeAt < flushAt && flushAt < releaseAt);
  assert.ok(w.events.slice(flushAt + 1, releaseAt).some(e => e.type === 'getValues' && e.full));
  for (const e of w.events.filter(e => e.type === 'getProperty' || e.full || e.type === 'setValues' || e.type === 'flush')) {
    assert.equal(e.locked, true, e.type + ' must occur while locked');
  }
  assert.equal(w.events.filter(e => e.type === 'flush').length, 1);
  assert.equal(w.events.filter(e => e.type === 'releaseLock').length, 1);
  assert.equal(w.held, false);
});

for (const [name, mutate, error] of [
  ['wrong host script', w => { w.scriptId = 'other-script'; }, /wrong_script/],
  ['wrong workbook', w => { w.workbookId = 'other-workbook'; }, /wrong_workbook/],
  ['missing bound workbook', w => { w.missingWorkbook = true; }, /wrong_workbook/],
  ['wrong sheet id', w => { w.sheetId++; }, /wrong_sheet/],
  ['wrong sheet title', w => { w.sheetName = 'other-sheet'; }, /wrong_sheet/],
  ['missing sheet', w => { w.missingSheet = true; }, /wrong_sheet/],
  ['runtime canonical schema drift', w => { w.ctx.REMOVED_LEADS_HEADERS[20] = 'different'; }, /runtime_schema_drift/],
  ['allocation grew', w => { w.maxRows++; }, /allocation_drift/],
  ['allocation shrank', w => { w.maxColumns--; }, /allocation_drift/],
  ['preserved prefix changed', w => { w.grid[0][17] = 'different'; }, /prefix_drift/],
  ['new preserved data since preview', w => { w.grid[4][1] = 'synthetic new row'; }, /preview_drift/],
  ['wrong used bounds', w => { w.overrideLastColumn = 22; }, /used_bounds_drift/]
]) {
  test('header correction refuses ' + name, () => {
    const w = fixture(); w.approve(); mutate(w); refusesWithoutWrite(w, error);
  });
}

for (const [name, change, error] of [
  ['wrong operation', a => { a.operation = 'other'; }, /invalid_approval/],
  ['unverified runtime identity', a => { a.runtimeSourceSha256 = 'a'.repeat(64); }, /invalid_approval/],
  ['malformed digest', a => { a.previewFingerprint = 'not-a-digest'; }, /invalid_approval/],
  ['changed digest', a => { a.previewFingerprint = 'a'.repeat(64); }, /preview_drift/],
  ['changed observation timestamp', a => { a.previewObservedAt = new Date(START - 1).toISOString(); }, /preview_drift/],
  ['missing operator', a => { a.operator = ''; }, /invalid_approval/],
  ['multiline evidence', a => { a.pauseEvidenceReference = 'line1\nline2'; }, /invalid_approval/],
  ['non-canonical date', a => { a.windowStart = '2026-10-27'; }, /invalid_window/],
  ['future window', a => { a.windowStart = new Date(START + 1).toISOString(); }, /window_not_current/],
  ['expired window', a => { a.windowEnd = new Date(START).toISOString(); }, /window_not_current/],
  ['excessive window', a => { a.windowEnd = new Date(START + 300001).toISOString(); }, /window_not_current/],
  ['stale preview', a => { a.windowStart = new Date(START - 180000).toISOString(); a.previewObservedAt = new Date(START - 120001).toISOString(); }, /window_not_current/],
  ['future preview', a => { a.previewObservedAt = new Date(START + 1).toISOString(); }, /window_not_current/]
]) {
  test('approval rejects ' + name, () => {
    const w = fixture(), approval = w.approve(); change(approval); refusesWithoutWrite(w, error);
  });
}

for (const key of ['runtimeSourceReadBack', 'applicationRequestsStopped', 'directEditorsStopped',
  'integrationsStopped', 'scheduledAndManualJobsStopped', 'legacyBackupDrained']) {
  test('approval requires the explicit operator attestation: ' + key, () => {
    const w = fixture(), approval = w.approve();
    approval.operatorAttestations[key] = 'true';
    refusesWithoutWrite(w, /missing_pause_attestation/);
  });
}

for (const key of ['OUTPATIENT_RECOVERY_HOLD', 'INTEGRITY_ACTIVE_BACKUP']) {
  for (const value of ['1', '', '0', false]) {
    test('guard state must be absent: ' + key + '=' + JSON.stringify(value), () => {
      const w = fixture(); w.approve(); w.props[key] = value;
      refusesWithoutWrite(w, /recovery_or_backup_state_present/);
    });
  }
}

test('guard read errors refuse without revealing the underlying service error', () => {
  const w = fixture(); w.approve();
  w.failures.set('getProperty:INTEGRITY_ACTIVE_BACKUP', 'do not log this payload');
  refusesWithoutWrite(w, /service_error/);
  assert.equal(w.logs.some(s => s.includes('PRIVATE SERVICE ERROR') || s.includes('do not log')), false);
});

test('busy writer lock refuses and never releases somebody else\'s lock', () => {
  const w = fixture(); w.approve(); w.busy = true;
  refusesWithoutWrite(w, /writer_lock_busy/);
  assert.equal(w.events.some(e => e.type === 'releaseLock'), false);
});

test('guard state appearing while queued is rechecked after acquiring the lock', () => {
  const w = fixture(); w.approve();
  w.hook = e => { if (e.type === 'tryLock') w.props.OUTPATIENT_RECOVERY_HOLD = '1'; };
  assert.throws(() => w.apply(), /recovery_or_backup_state_present/);
  assert.equal(w.writes.length, 0);
  assert.equal(w.held, false);
  assert.equal(w.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

for (const [name, mutate, error] of [
  ['header formula displaying canonical text', w => { w.formulas[0][0] = '="id"'; }, /header_formula/],
  ['tail formula displaying empty text', w => { w.formulas[998][20] = '=""'; }, /nonempty_tail_or_extra_columns/],
  ['zero in final tail row', w => { w.grid[998][20] = 0; }, /nonempty_tail_or_extra_columns/],
  ['false in tail', w => { w.grid[1][18] = false; }, /nonempty_tail_or_extra_columns/],
  ['whitespace in tail', w => { w.grid[1][19] = ' '; }, /nonempty_tail_or_extra_columns/],
  ['unclassified extra column', w => { w.grid[0][25] = 'extra'; }, /nonempty_tail_or_extra_columns/],
  ['partially completed header', w => { w.grid[0][18] = TAIL[0]; }, /partial_or_conflicting_headers/],
  ['target merge', w => { w.merged = true; }, /target_merged/],
  ['undefined merge state', w => { w.merged = undefined; }, /unreadable_merge_state/],
  ['null merge state', w => { w.merged = null; }, /unreadable_merge_state/],
  ['target validation', w => { w.validations = [[{ criterion: 'synthetic' }, null, null]]; }, /target_validation/],
  ['undefined validation cell', w => { w.validations = [[undefined, null, null]]; }, /target_validation/],
  ['sparse validation cell', w => { w.validations = [[null, , null]]; }, /target_validation/],
  ['wrong validation width', w => { w.validations = [[null, null]]; }, /target_validation/],
  ['missing validation row', w => { w.validations = Array(1); }, /target_validation/],
  ['target permission refusal', w => { w.editable = false; }, /target_not_editable/],
  ['sheet protection', w => { w.sheetProtections = [{}]; }, /sheet_protected/],
  ['target range protection', w => { w.rangeProtections = [w.rangeProtection(1, 18, 2, 2)]; }, /target_protected/],
  ['unreadable range protection', w => { w.rangeProtections = [null]; }, /unreadable_protection/],
  ['sparse protection listing', w => { w.rangeProtections = Array(1); }, /unreadable_protection/],
  ['malformed protection listing', w => { w.rangeProtections = {}; }, /unreadable_protection/],
  ['invalid frozen rows', w => { w.frozenRows = NaN; }, /invalid_grid_read/]
]) {
  test('header correction preserves and refuses ' + name, () => {
    const w = fixture(); w.approve(); mutate(w); refusesWithoutWrite(w, error);
  });
}

for (const [name, setReadFault, error] of [
  ['sparse values row', w => { w.mapValues = rows => { delete rows[1]; return rows; }; }, /invalid_grid_read/],
  ['sparse literal cell', w => { w.mapValues = rows => { delete rows[1][0]; return rows; }; }, /invalid_cell_read/],
  ['sparse formula cell', w => { w.mapFormulas = rows => { delete rows[1][0]; return rows; }; }, /invalid_formula_read/]
]) {
  test('unreadable native grid refuses ' + name, () => {
    const w = fixture(); w.approve(); setReadFault(w); refusesWithoutWrite(w, error);
  });
}

test('unrelated row and column protections do not prevent the exact authorized correction', () => {
  const w = fixture(); w.approve();
  w.rangeProtections = [w.rangeProtection(1, 1, 1, 18), w.rangeProtection(2, 19, 30, 3), w.rangeProtection(1, 22, 1, 5)];
  assert.equal(w.apply().status, 'corrected');
  assert.equal(w.writes.length, 1);
});

test('expiry during lock wait refuses before any snapshot or write', () => {
  const w = fixture(); w.approve();
  w.hook = e => { if (e.type === 'tryLock') w.now += 60000; };
  refusesWithoutWrite(w, /window_not_current/);
  assert.equal(w.events.some(e => e.full), false);
});

test('expiry during slow inspection is rechecked immediately before mutation', () => {
  const w = fixture(); w.approve();
  let delayed = false;
  w.hook = e => { if (e.type === 'getValues' && e.full && !delayed) { delayed = true; w.now += 60000; } };
  refusesWithoutWrite(w, /window_not_current/);
  assert.equal(delayed, true);
});

test('expiry after a permitted write does not prevent verification while the lock is still owned', () => {
  const w = fixture(); w.approve();
  w.hook = e => { if (e.type === 'afterSetValues') w.now += 60000; };
  const result = w.apply();
  assert.equal(result.status, 'corrected');
  assert.equal(result.writeVerified, true);
  assert.equal(w.writes.length, 1);
  assert.equal(w.held, false);
});

test('second under-lock snapshot catches preserved-cell drift during late checks before mutation', () => {
  const w = fixture(); w.approve();
  let checks = 0, injected = false;
  w.hook = e => {
    if (e.type === 'getDataValidations' && ++checks === 2) {
      injected = true; w.grid[1][5] = 17;
    }
  };
  assert.throws(() => w.apply(), /prewrite_drift/);
  assert.equal(injected, true);
  assert.equal(w.writes.length, 0);
  assert.equal(w.grid[1][5], 17, 'do not undo an external edit');
  assert.equal(w.held, false);
});

test('guard appearing between initial and confirmation captures refuses without mutation', () => {
  const w = fixture(); w.approve();
  let reads = 0;
  w.hook = e => { if (e.type === 'getProperty' && e.key === 'OUTPATIENT_RECOVERY_HOLD' && ++reads === 2) w.props.INTEGRITY_ACTIVE_BACKUP = 'synthetic-active'; };
  assert.throws(() => w.apply(), /recovery_or_backup_state_present/);
  assert.equal(w.writes.length, 0);
  assert.equal(w.props.INTEGRITY_ACTIVE_BACKUP, 'synthetic-active');
  assert.equal(w.held, false);
});

test('formula recalculation alone does not masquerade as preservation drift', () => {
  const w = fixture(); w.approve();
  let valuesReads = 0;
  w.hook = e => { if (e.type === 'getValues' && e.full) w.grid[2][5] = ++valuesReads * 13; };
  assert.equal(w.apply().status, 'corrected');
  assert.equal(w.formulas[2][5], '=1+1');
  assert.equal(w.writes.length, 1);
});

test('typed literal drift is detected even when the rendered value could look identical', () => {
  const w = fixture(); w.approve();
  w.grid[1][5] = '0';
  refusesWithoutWrite(w, /preview_drift/);
});

test('an already-current source is an explicit no-op, including a second apply after success', () => {
  const w = fixture(); w.approve();
  assert.equal(w.apply().status, 'corrected');
  w.clearTrace();
  const before = w.protectedState(), result = w.apply();
  assert.equal(result.status, 'already_current');
  assert.equal(result.writeAttempted, false);
  assert.deepEqual(w.protectedState(), before);
  assert.equal(w.writes.length, 0);
  assert.equal(w.events.some(e => e.type === 'flush'), false);
});

for (const [name, failureAt, committed] of [
  ['setValues throws before known commit', 'setValues', false],
  ['setValues commits then its RPC throws', 'afterSetValues', true],
  ['flush throws after setValues', 'flush', true]
]) {
  test(name + ' is indeterminate, with no retry or rollback', () => {
    const w = fixture(); w.approve();
    w.failures.set(failureAt, 'private RPC detail');
    assert.throws(() => w.apply(), /write attempted; inspect before any further action/);
    const receipt = w.receipt();
    assert.equal(receipt.status, 'needs_operator_check');
    assert.equal(receipt.writeAttempted, true);
    assert.equal(receipt.writeVerified, false);
    assert.equal(w.events.filter(e => e.type === 'setValues').length, 1);
    assert.equal(w.events.filter(e => e.type === 'flush').length, 1);
    assert.equal(w.writes.length, committed ? 1 : 0);
    assert.deepEqual(w.grid[0].slice(18, 21), committed ? TAIL : ['', '', '']);
    assert.equal(w.held, false);
    assert.equal(w.logs.some(s => s.includes('private RPC detail')), false);
  });
}

test('post-write preservation drift is reported without undoing either the header or external changes', () => {
  const w = fixture(); w.approve();
  w.hook = e => { if (e.type === 'afterSetValues') w.grid[1][1] = 'synthetic concurrent edit'; };
  assert.throws(() => w.apply(), /postwrite_verification_failed; write attempted/);
  assert.equal(w.receipt().writeVerified, false);
  assert.equal(w.receipt().status, 'needs_operator_check');
  assert.equal(w.writes.length, 1);
  assert.deepEqual(w.grid[0].slice(18, 21), TAIL);
  assert.equal(w.grid[1][1], 'synthetic concurrent edit');
  assert.equal(w.held, false);
});

test('post-write read failure retains the attempted mutation and directs operator inspection', () => {
  const w = fixture(); w.approve();
  w.hook = e => { if (e.type === 'afterSetValues') w.failures.set('getValues', 'private readback detail'); };
  assert.throws(() => w.apply(), /service_error; write attempted/);
  assert.equal(w.receipt().status, 'needs_operator_check');
  assert.equal(w.writes.length, 1);
  assert.deepEqual(w.grid[0].slice(18, 21), TAIL);
  assert.equal(w.held, false);
});

test('receipt logger failure after verified mutation reports the outcome without leaking its raw exception', () => {
  const w = fixture(); w.approve();
  w.failures.set('log', 'private logger detail');
  assert.throws(() => w.apply(), error => {
    assert.match(error.message, /receipt logging failed; writeAttempted=true; writeVerified=true/);
    assert.doesNotMatch(error.message, /private logger detail/);
    return true;
  });
  assert.equal(w.writes.length, 1);
  assert.deepEqual(w.grid[0].slice(18, 21), TAIL);
  assert.equal(w.held, false);
});

// The simulated lock service throws BEFORE clearing `held`, so these cases keep
// held=true as an explicitly unresolved lock. They never claim a release succeeded.
test('releaseLock failure after a read-only preview is sanitized, unretried and leaves the lock unresolved', () => {
  const w = fixture(), before = w.protectedState();
  w.failures.set('releaseLock', 'private release detail');
  assert.throws(() => w.preview(), error => {
    assert.match(error.message, /OP03 header correction: lock_release_failed; no write attempted/);
    assert.doesNotMatch(error.message, /private release detail/);
    return true;
  });
  const receipt = w.receipt();
  assert.equal(receipt.status, 'refused');
  assert.equal(receipt.error, 'lock_release_failed');
  assert.equal(receipt.mode, 'preview');
  assert.equal(receipt.lockReleased, false);
  assert.equal(receipt.writeAttempted, false);
  assert.equal(receipt.writeVerified, false);
  assert.equal(w.events.filter(e => e.type === 'releaseLock').length, 1, 'no retry of the release');
  assert.equal(w.writes.length, 0);
  assert.equal(w.events.some(e => e.type === 'setValues'), false);
  assert.deepEqual(w.protectedState(), before, 'all cells and surrounding state are preserved');
  assert.equal(w.held, true, 'the simulated lock is unresolved, not released');
  assert.equal(w.logs.some(s => s.includes('private release detail') || s.includes('PRIVATE SERVICE ERROR')), false);
});

test('releaseLock failure after a verified write reports needs_operator_check with no retry or rollback', () => {
  const w = fixture(); w.approve();
  const expected = w.protectedState();
  expected.grid[0].splice(18, 3, ...TAIL);
  w.failures.set('releaseLock', 'private release detail');
  assert.throws(() => w.apply(), error => {
    assert.match(error.message, /OP03 header correction: lock_release_failed; write attempted; inspect before any further action/);
    assert.doesNotMatch(error.message, /private release detail/);
    return true;
  });
  const receipt = w.receipt();
  assert.equal(receipt.status, 'needs_operator_check');
  assert.equal(receipt.error, 'lock_release_failed');
  assert.equal(receipt.lockReleased, false);
  assert.equal(receipt.writeAttempted, true);
  assert.equal(receipt.writeVerified, true);
  assert.equal(w.events.filter(e => e.type === 'releaseLock').length, 1, 'no retry of the release');
  assert.equal(w.events.filter(e => e.type === 'setValues').length, 1);
  assert.equal(w.events.filter(e => e.type === 'flush').length, 1);
  assert.deepEqual(w.writes, [{ rectangle: [1, 19, 1, 3], values: [TAIL] }]);
  assert.deepEqual(w.protectedState(), expected, 'only the approved cells changed; no rollback');
  assert.equal(w.held, true, 'the simulated lock is unresolved, not released');
  assert.equal(w.logs.some(s => s.includes('private release detail') || s.includes('PRIVATE SERVICE ERROR')), false);
});
