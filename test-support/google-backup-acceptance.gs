/** @OnlyCurrentDoc */
// STAGING ONLY. Generated from actual backup helper source by the companion builder.
// Current-document helper acceptance, not the cross-workbook scheduled job.
// No deployment, email, trigger, external fetch or production access.
function stagingBackupAcceptance() {
  var CODE_HASH = '05aacbbfb5aa883950967d21f5ce486b620ea6dda90223999623fc00dd3e41d0';
  var HELPER_HASH = 'fe47ac59889fe8d6f326a2f41a13a5332e5f71f35b758b10a391637d5bd3dbae';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== '1MdBzX6eDJIi9m7JXNuz-Z5OUh8e1dS6FjTGiw71D6n0' ||
      ScriptApp.getScriptId() !== '1IMz_TagTQBCsoK84TNHL5kBnBslH5W7jaZ20RFKA4dqkqfrbDHN42oE_') throw new Error('Wrong staging target');
  var allowed = ['id_mv0yzigz_dxqm2p','id_mv0z2nly_fzv6qq','id_mv0z2amu_g2rsj7'];
  ['Leads','Clients','לידים שהוסרו','Clients-removed'].forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Missing staging sheet: ' + name);
    sh.getDataRange().getValues().slice(1).forEach(function(row) {
      if (row.some(function(v) { return v !== ''; }) && !/^fixture-/.test(String(row[0])) && allowed.indexOf(String(row[0])) === -1) throw new Error('Unknown staging row');
    });
  });
  if (ss.getSheets().some(function(sh) { return /^outpatient-|^_Backup|^_RestoreProbe/.test(sh.getName()); })) throw new Error('Acceptance already ran; do not reset implicitly');
  // These declarations and functions are copied verbatim from Code.gs.
var INTEGRITY_SNAPSHOT_RE = /^outpatient-(\d{4})-(\d{2})-(\d{2})$/;

var INTEGRITY_DATA_SNAPSHOT_RE = /^outpatient-(?:(?:leads|leads-removed|clients-removed)-)?(\d{4})-(\d{2})-(\d{2})$/;

function _integrityCaptureData(sourceSs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Backup capture lock unavailable');
  try {
    var specs = [
      { source: 'Clients', prefix: '', required: true },
      { source: 'Leads', prefix: 'leads-', required: true },
      { source: 'לידים שהוסרו', prefix: 'leads-removed-', headers: REMOVED_LEADS_HEADERS },
      { source: 'Clients-removed', prefix: 'clients-removed-', headers: CLIENTS_REMOVED_HEADERS }
    ];
    return specs.map(function (spec) {
      var sh = sourceSs.getSheetByName(spec.source);
      if (!sh && spec.required) throw new Error('Missing backup source: ' + spec.source);
      var range = sh ? sh.getDataRange() : null;
      var grid = range ? range.getValues() : [spec.headers.slice()];
      if (!grid.length || grid[0].indexOf('id') === -1) {
        throw new Error('Invalid backup headers: ' + spec.source);
      }
      return { source: spec.source, prefix: spec.prefix, absent: !sh,
        grid: grid, formats: range ? range.getNumberFormats() : null };
    });
  } finally { lock.releaseLock(); }
}

function _integrityVerifyGrid(expected, actual) {
  if (expected.length !== actual.length) throw new Error('Backup row count mismatch');
  for (var r = 0; r < expected.length; r++) {
    if (expected[r].length !== actual[r].length) throw new Error('Backup column count mismatch');
    for (var c = 0; c < expected[r].length; c++) {
      var a = expected[r][c], b = actual[r][c];
      var equal = a instanceof Date ? b instanceof Date && a.getTime() === b.getTime() : a === b;
      if (!equal) throw new Error('Backup value mismatch at row ' + (r + 1) + ', column ' + (c + 1));
    }
  }
}

function _integrityWriteSnapshot(backupSs, snapName, grid, formats) {
  if (!INTEGRITY_DATA_SNAPSHOT_RE.test(snapName)) throw new Error('Invalid backup name');
  if (!grid || !grid.length || !grid[0].length) throw new Error('Empty backup grid');
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1)) throw new Error('Backup writer already running');
  var sh = null, old = null, renamedOld = false, published = false;
  try {
    var token = Utilities.getUuid();
    sh = backupSs.insertSheet('outpatient-pending-' + token);
    if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
    if (sh.getMaxColumns() < grid[0].length) sh.insertColumnsAfter(sh.getMaxColumns(), grid[0].length - sh.getMaxColumns());
    var target = sh.getRange(1, 1, grid.length, grid[0].length);
    var safeFormats = grid.map(function (row, r) {
      return row.map(function (value, c) {
        return typeof value === 'string' ? '@' :
          (formats && formats[r] && formats[r][c]) || (value instanceof Date ? 'yyyy-mm-dd hh:mm:ss.000' : 'General');
      });
    });
    target.setNumberFormats(safeFormats);
    target.setValues(grid.map(function (row) {
      return row.map(function (value) { return typeof value === 'string' && value ? "'" + value : value; });
    }));
    SpreadsheetApp.flush();
    _integrityVerifyGrid(grid, target.getValues());
    var formulas = target.getFormulas();
    for (var r = 0; r < formulas.length; r++) {
      if (formulas[r].some(function (formula) { return !!formula; })) throw new Error('Backup contains a formula');
    }
    old = backupSs.getSheetByName(snapName);
    if (old) { old.setName('outpatient-previous-' + token); renamedOld = true; }
    sh.setName(snapName);
    published = true;
    if (old) backupSs.deleteSheet(old);
    return sh;
  } catch (err) {
    if (renamedOld && !published) {
      try { old.setName(snapName); } catch (_) { /* Keep both recovery remnants. */ }
    }
    // A partial temporary sheet is never a published backup. Leave it visible
    // for diagnosis; do not risk deleting a good copy after an ambiguous RPC.
    throw err;
  } finally { lock.releaseLock(); }
}

function _integrityIsExpiredSnapshot(sheetName, todayName, retentionDays) {
  var m = INTEGRITY_DATA_SNAPSHOT_RE.exec(String(sheetName == null ? '' : sheetName));
  if (!m) return false;
  var t = INTEGRITY_SNAPSHOT_RE.exec(String(todayName == null ? '' : todayName));
  if (!t) return false;
  var ageDays = (Date.UTC(+t[1], +t[2] - 1, +t[3]) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000;
  return ageDays > retentionDays;
}

function _integrityApplyRetention(backupSs, todayName, retentionDays) {
  var sheets = backupSs.getSheets();
  var deleted = [];
  for (var i = 0; i < sheets.length; i++) {
    if (backupSs.getSheets().length <= 1) break;
    var name = sheets[i].getName();
    if (_integrityIsExpiredSnapshot(name, todayName, retentionDays)) {
      backupSs.deleteSheet(sheets[i]);
      deleted.push(name);
    }
  }
  return deleted;
}
  var results = [], runId = new Date().toISOString(), originals = [];
  function check(condition, message) { if (!condition) throw new Error(message); }
  function scenario(name, work) {
    var start = Date.now();
    try { work(); results.push([name,'PASS',Date.now()-start,'']); }
    catch (err) { results.push([name,'FAIL',Date.now()-start,String(err)]); throw err; }
  }
  try {
    scenario('four_datasets_native_typed_readback', function() {
      originals = _integrityCaptureData(ss);
      originals.forEach(function(item) {
        _integrityWriteSnapshot(ss, 'outpatient-' + item.prefix + '2099-10-09', item.grid, item.formats);
      });
    });
    var typed = [['id','phone','literal','apostrophe','amount','flag','date','stamp'],
      ['fixture-types','0500000001','=1+1',"'literal",1200.5,true,new Date('2026-10-09T10:11:12.000Z'),'2026-10-09T10:11:12.000Z']];
    scenario('native_literal_strings_and_scalar_types', function() {
      _integrityWriteSnapshot(ss,'outpatient-2099-10-10',typed);
    });
    scenario('native_same_day_verified_replacement', function() {
      var before = ss.getSheetByName('outpatient-2099-10-10').getSheetId();
      _integrityWriteSnapshot(ss,'outpatient-2099-10-10',typed);
      check(ss.getSheetByName('outpatient-2099-10-10').getSheetId() !== before,'Expected verified new sheet');
    });
    scenario('native_failed_readback_keeps_previous', function() {
      var old = ss.getSheetByName('outpatient-2099-10-10');
      var facade = { getSheetByName: function(n) { return ss.getSheetByName(n); },
        deleteSheet: function(sh) { ss.deleteSheet(sh); },
        insertSheet: function(n) {
          var sh = ss.insertSheet(n);
          return { getMaxRows: function() { return sh.getMaxRows(); }, getMaxColumns: function() { return sh.getMaxColumns(); },
            insertRowsAfter: function(a,b) { sh.insertRowsAfter(a,b); }, insertColumnsAfter: function(a,b) { sh.insertColumnsAfter(a,b); },
            setName: function(name) { sh.setName(name); },
            getRange: function(a,b,c,d) { var range = sh.getRange(a,b,c,d); return {
              setNumberFormats: function(f) { range.setNumberFormats(f); }, setValues: function(v) { range.setValues(v); },
              getValues: function() { var v = range.getValues(); v[0][0] = 'injected-readback-failure'; return v; },
              getFormulas: function() { return range.getFormulas(); }
            }; }
          };
        }
      };
      var rejected = false;
      try { _integrityWriteSnapshot(facade,'outpatient-2099-10-10',typed); } catch(err) { rejected = /Backup value mismatch/.test(String(err)); }
      check(rejected,'Readback fault was not rejected');
      check(ss.getSheetByName('outpatient-2099-10-10').getSheetId() === old.getSheetId(),'Previous sheet changed');
      _integrityVerifyGrid(typed,old.getDataRange().getValues());
    });
    scenario('restore_four_datasets_in_place_from_verified_backups', function() {
      originals.forEach(function(item,i) {
        var snapshot = ss.getSheetByName('outpatient-' + item.prefix + '2099-10-09');
        var probe = ss.insertSheet('_RestoreProbe-' + i);
        if (probe.getMaxColumns() < item.grid[0].length) probe.insertColumnsAfter(probe.getMaxColumns(),item.grid[0].length-probe.getMaxColumns());
        var target = probe.getRange(1,1,item.grid.length,item.grid[0].length);
        target.setNumberFormats(snapshot.getDataRange().getNumberFormats());
        snapshot.getDataRange().copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_VALUES,false);
        _integrityVerifyGrid(item.grid,target.getValues());
        var id = probe.getSheetId();
        probe.getRange(2,2).setValue('fixture-deliberately-changed');
        check(probe.getRange(2,2).getValue() === 'fixture-deliberately-changed','Mutation not observed');
        snapshot.getDataRange().copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_VALUES,false);
        _integrityVerifyGrid(item.grid,target.getValues());
        check(probe.getSheetId() === id,'Restore changed sheet binding');
      });
    });
    scenario('native_retention_isolated_to_four_families', function() {
      ['', 'leads-', 'leads-removed-', 'clients-removed-'].forEach(function(p) {
        ss.insertSheet('outpatient-' + p + '2000-01-01').getRange(1,1).setValue('fixture-expired');
      });
      var unrelated = ss.insertSheet('_Backup-unrelated-2000-01-01');
      unrelated.getRange(1,1).setValue('fixture-keep');
      var deleted = _integrityApplyRetention(ss,'outpatient-2099-10-10',30);
      check(deleted.length === 4,'Unexpected retention scope');
      check(!!ss.getSheetByName('_Backup-unrelated-2000-01-01'),'Unrelated sheet lost');
      originals.forEach(function(item) { _integrityVerifyGrid(item.grid,ss.getSheetByName(item.source).getDataRange().getValues()); });
    });
  } finally {
    var report = ss.insertSheet('_BackupAcceptance');
    var rows = [['scenario','result','durationMs','detail','runId','Code.gs SHA256','helper SHA256']].concat(results.map(function(r) { return r.concat([runId,CODE_HASH,HELPER_HASH]); }));
    report.getRange(1,1,rows.length,7).setNumberFormat('@').setValues(rows);
    report.setFrozenRows(1);
    report.getRange(1,1,1,7).setBackground('#164F65').setFontColor('#ffffff').setFontWeight('bold');
    report.getRange(2,1,rows.length-1,7).setWrap(true).setVerticalAlignment('middle');
    report.setColumnWidth(1,370); report.setColumnWidth(2,80); report.setColumnWidth(3,105);
    report.setColumnWidth(4,280); report.setColumnWidth(5,210); report.setColumnWidths(6,2,260);
    report.setRowHeights(2,rows.length-1,50);
    Logger.log(JSON.stringify({runId:runId,sourceCodeSHA256:CODE_HASH,helperSHA256:HELPER_HASH,results:results}));
  }
}
