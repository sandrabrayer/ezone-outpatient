'use strict';
// Service double for the new tooling. It is never native Google evidence.
const vm = require('node:vm');
const { runtime } = require('./google-drill-sandbox.cjs');
const { build } = require('./build-google-operational-drill.cjs');
const { sha } = require('./build-google-manual-policy-drill.cjs');
const projectId = 'isolated-synthetic-project-0123456789';
const old = build({ scriptId: projectId });

function world() {
  const r = runtime(old.output, projectId), decorated = new WeakSet();
  let sequence = 0;
  function decorate(ss) {
    if (decorated.has(ss)) return ss; decorated.add(ss);
    ss.policyCreatedAt = new Date().toISOString();
    const insert = ss.insertSheet;
    let locale = 'en_US', zone = 'America/Los_Angeles';
    ss.getSpreadsheetLocale = () => locale; ss.setSpreadsheetLocale = value => { locale = value; };
    ss.getSpreadsheetTimeZone = () => zone; ss.setSpreadsheetTimeZone = value => { zone = value; };
    ss.insertSheet = name => decorateSheet(insert(name));
    function decorateSheet(sh) {
      const id = ++sequence, getRange = sh.getRange, copyTo = sh.copyTo;
      const native = { hidden: false, frozenRows: 0, frozenColumns: 0, cells: {}, rowMetadata: {}, columnMetadata: {}, validation: null, merges: [], protections: [] };
      sh.policyNative = native;
      sh.getType = () => 'GRID'; sh.getSheetId = () => id;
      sh.isSheetHidden = () => native.hidden;
      sh.getFrozenRows = () => native.frozenRows; sh.getFrozenColumns = () => native.frozenColumns;
      sh.setFrozenRows = n => { native.frozenRows = n; };
      sh.getProtections = () => native.protections;
      sh.getRange = function (row, column, rows = 1, columns = 1) {
        const range = getRange(row, column, rows, columns);
        range.getDataValidations = () => Array.from({ length: rows }, () => Array(columns).fill(native.validation));
        range.getMergedRanges = () => native.merges;
        return range;
      };
      sh.copyTo = function (target) {
        const copy = copyTo(target);
        if (copy.getMaxRows() > sh.getMaxRows()) copy.deleteRows(sh.getMaxRows() + 1, copy.getMaxRows() - sh.getMaxRows());
        if (copy.getMaxRows() < sh.getMaxRows()) copy.insertRowsAfter(copy.getMaxRows(), sh.getMaxRows() - copy.getMaxRows());
        if (copy.getMaxColumns() > sh.getMaxColumns()) copy.deleteColumns(sh.getMaxColumns() + 1, copy.getMaxColumns() - sh.getMaxColumns());
        if (copy.getMaxColumns() < sh.getMaxColumns()) copy.insertColumnsAfter(copy.getMaxColumns(), sh.getMaxColumns() - copy.getMaxColumns());
        const copiedNative = JSON.parse(JSON.stringify(native)); Object.assign(copy.policyNative, copiedNative);
        return copy;
      };
      return sh;
    }
    ss.getSheets().forEach(decorateSheet);
    ss.copy = title => {
      if (r.faults.nativeCopy) throw Error('Whole native copy interrupted');
      const copy = r.ctx.SpreadsheetApp.create(title), blank = copy.getSheets()[0]; blank.setName('_SyntheticCopyBlank');
      copy.setSpreadsheetLocale(locale); copy.setSpreadsheetTimeZone(zone);
      ss.getSheets().forEach(sh => sh.copyTo(copy).setName(sh.getName())); copy.deleteSheet(blank); return copy;
    };
    return ss;
  }
  const create = r.ctx.SpreadsheetApp.create, open = r.ctx.SpreadsheetApp.openById;
  r.ctx.SpreadsheetApp.create = title => decorate(create(title));
  r.ctx.SpreadsheetApp.openById = id => decorate(open(id));
  r.ctx.SpreadsheetApp.ProtectionType = { SHEET: 'SHEET', RANGE: 'RANGE' };
  r.ctx.Sheets = { Spreadsheets: { get(id, options) {
    r.events.push(['native-api', id, options]);
    if (r.faults.nativeApi) throw Error('Native Sheets API unavailable');
    const ss = r.books[id]; if (!ss) throw Error('Unknown native API workbook');
    const sheets = ss.getSheets().map((sh, index) => {
      const grid = sh.getDataRange().getValues();
      const rowData = grid.map((row, i) => ({ values: row.map((value, j) => {
        let cell = {};
        if (value !== '') cell.userEnteredValue = value instanceof Date ? { numberValue: value.getTime() / 86400000 + 25569 } :
          typeof value === 'number' ? { numberValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value };
        return { ...cell, ...(sh.policyNative.cells[i + ':' + j] || {}) };
      }) }));
      const rows = Object.keys(sh.policyNative.rowMetadata).map(Number), columns = Object.keys(sh.policyNative.columnMetadata).map(Number);
      const rowMetadata = rows.length ? Array.from({ length: Math.max(...rows) + 1 }, (_, i) => sh.policyNative.rowMetadata[i] || {}) : [];
      const columnMetadata = columns.length ? Array.from({ length: Math.max(...columns) + 1 }, (_, i) => sh.policyNative.columnMetadata[i] || {}) : [];
      return { properties: { sheetId: sh.getSheetId(), title: sh.getName(), index, sheetType: 'GRID', hidden: sh.isSheetHidden(),
        gridProperties: { rowCount: sh.getMaxRows(), columnCount: sh.getMaxColumns(), frozenRowCount: sh.getFrozenRows(), frozenColumnCount: sh.getFrozenColumns() } },
      data: [{ rowData, rowMetadata, columnMetadata }] };
    });
    if (r.faults.nativeResponse) r.faults.nativeResponse({ id, sheets });
    return { spreadsheetId: id, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
      properties: { title: ss.getName(), locale: ss.getSpreadsheetLocale(), timeZone: ss.getSpreadsheetTimeZone() }, sheets };
  } } };
  r.load = output => vm.runInContext(output, r.ctx);
  r.completeOriginal = () => {
    r.ctx.prepareOperationalDrill(); r.ctx.captureOperationalDrill(); r.ctx.restoreOperationalDrill();
    r.ctx.verifyOperationalDrill(); r.ctx.verifyManualTabDrill(); return r.props.OP03_DRILL_STATE;
  };
  r.policyState = () => JSON.parse(r.props.OP03_POLICY_DRILL_STATE || 'null');
  r.packets = () => {
    const state = r.policyState(), sheet = r.books[state.ids.backup].getSheetByName('_PolicyEvidence');
    const rows = sheet.getDataRange().getValues().slice(1), packets = {};
    for (const name of Object.keys(state.packetHashes)) packets[name] = rows.filter(row => row[0] === name).map(row => row[4]).join('');
    return packets;
  };
  r.verifierOptions = baselineStateRaw => {
    const state = r.policyState(), packets = r.packets(), capture = JSON.parse(packets.capture), prepare = JSON.parse(packets.prepare);
    const permissionRecordText = JSON.stringify({ version: 1, schema: 'op03-drive-permissions-v1', observedAt: new Date().toISOString(),
      files: Object.entries(state.ids).map(([role, id]) => ({ role, id, shared: false, createdTime: r.books[id].policyCreatedAt,
        permissions: [{ type: 'user', role: 'owner', emailAddress: 'synthetic-owner@example.invalid' }] })) });
    return { scriptId: projectId, baselineStateRaw, setupStateRaw: r.props.OP03_POLICY_DRILL_STATE, packets,
      externalProof: { version: 1, schema: 'op03-external-permission-proof-v1', operator: 'local service double; not native evidence',
        directWritesPaused: true, captureStartedAt: capture.captureStartedAt, captureEndedAt: capture.captureEndedAt,
        permissionRecordSHA256: sha(permissionRecordText), permissionRecordText,
        permissions: Object.fromEntries(Object.entries(state.ids).map(([role, id]) => [role, { id, ownerOnly: true }])),
        targetCreatedAt: r.books[state.ids.target].policyCreatedAt },
      evidenceRecord: { path: 'docs/evidence/op03-manual-tabs-2099-01-01-local-test.md',
        text: '# LOCAL SERVICE DOUBLE ONLY\nNot native evidence.\n', commit: 'a'.repeat(40) } };
  };
  return r;
}
module.exports = { world, projectId };
