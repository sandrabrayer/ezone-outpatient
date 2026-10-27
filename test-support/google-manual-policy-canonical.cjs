'use strict';
// Shared pure canonicalization: the builder and generated native modules use
// exactly these function bodies. Actual cells and array order are preserved.
function check(ok, reason) { if (!ok) throw Error(reason); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    var result = {}; Object.keys(value).sort().forEach(function (key) { result[key] = canonical(value[key]); }); return result;
  }
  return value;
}
function nativeComparable(raw) {
  var snapshot = clone(raw), ids = {};
  snapshot.sheets.forEach(function (sheet, i) { ids[sheet.properties.sheetId] = i; });
  delete snapshot.spreadsheetId; delete snapshot.spreadsheetUrl; delete snapshot.properties.title;
  function mapIds(value) {
    if (Array.isArray(value)) return value.map(mapIds);
    if (!value || typeof value !== 'object') return value;
    var result = {};
    Object.keys(value).forEach(function (key) {
      if (key === 'sheetId') { check(Object.prototype.hasOwnProperty.call(ids, value[key]), 'Native reference outside fixture workbook'); result[key] = ids[value[key]]; }
      else result[key] = mapIds(value[key]);
    });
    return result;
  }
  snapshot.sheets.forEach(function (sheet) {
    var cells = {}, rows = {}, columns = {};
    (sheet.data || []).forEach(function (grid) {
      check(Object.keys(grid).every(function (key) { return ['startRow', 'startColumn', 'rowData', 'rowMetadata', 'columnMetadata'].indexOf(key) >= 0; }),
        'Unsupported native GridData property');
      var startRow = grid.startRow || 0, startColumn = grid.startColumn || 0;
      (grid.rowData || []).forEach(function (row, r) {
        check(Object.keys(row || {}).every(function (key) { return key === 'values'; }), 'Unsupported native RowData property');
        (row && row.values || []).forEach(function (cell, c) {
          if (cell && Object.keys(cell).length) {
            var key = (startRow + r) + ':' + (startColumn + c);
            check(!Object.prototype.hasOwnProperty.call(cells, key), 'Overlapping native cell response'); cells[key] = cell;
          }
        });
      });
      (grid.rowMetadata || []).forEach(function (row, r) {
        if (row && Object.keys(row).length) { var key = String(startRow + r); check(!Object.prototype.hasOwnProperty.call(rows, key), 'Overlapping native row metadata'); rows[key] = row; }
      });
      (grid.columnMetadata || []).forEach(function (column, c) {
        if (column && Object.keys(column).length) { var key = String(startColumn + c); check(!Object.prototype.hasOwnProperty.call(columns, key), 'Overlapping native column metadata'); columns[key] = column; }
      });
    });
    // Empty omitted cells/dimensions mean native defaults within the explicit
    // allocated rectangle. Nonempty CellData and metadata stay byte-for-byte
    // equivalent after canonical object-key ordering, never value coercion.
    sheet.data = { cells: cells, rows: rows, columns: columns };
  });
  return canonical(mapIds(snapshot));
}
function comparable(inv) {
  var result = clone(inv); delete result.spreadsheetId;
  result.sheets.forEach(function (sheet) { delete sheet.sheetId; }); result.native = nativeComparable(result.native); return result;
}
module.exports = { canonical, nativeComparable, comparable, source: [canonical, nativeComparable, comparable].map(fn => fn.toString()).join('\n\n') };
