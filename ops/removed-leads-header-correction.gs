/**
 * OP-03 one-time removed-leads header correction. NOT a deployment input.
 * Installation into the existing bound project needs separate owner approval.
 * This does not establish a maintenance window: the operator must stop and
 * drain application requests, direct editors, integrations and automated jobs.
 * Never add an HTTP route/trigger or call a business/recovery handler for this.
 * See docs/removed-leads-header-correction.md before any native use.
 */
var OP03_HEADER_CORRECTION_APPROVAL = null;

function previewRemovedLeadsHeaderCorrection() {
  return _op03HcRun_(false);
}

function applyRemovedLeadsHeaderCorrection() {
  return _op03HcRun_(true);
}

function _op03HcDefinition_() {
  return {
    operation: 'op03-removed-leads-headers-v1',
    scriptId: '1JSI3Ahqnen0pxi1x5q24nBku8Nk8I5iFNqRC-yMcTv1EDKTh6KhmSuSX',
    spreadsheetId: '17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc',
    sheetId: 1894136505,
    sheetName: 'לידים שהוסרו',
    rows: 999,
    columns: 26,
    runtimeSourceSha256: '5a9c368dec1a59d1644068aa7aa87b9ed02ebbd2f5a0b04f008d97e9ca867f8a',
    headers: [
      'id', 'name', 'phone', 'serviceType', 'location', 'note', 'stage',
      'sessionsPerWeek', 'pricePerSession', 'startDate', 'created',
      'introDateTime', 'house_of_origin', 'not_relevant_reason',
      'not_relevant_note', 'removedAt', 'originSheet', 'assignedTo',
      'updatedAt', 'updatedBy', 'preferredHouse'
    ]
  };
}

function _op03HcRefuse_(code) {
  var err = new Error(code);
  err.op03HeaderCorrectionCode = code;
  throw err;
}

function _op03HcHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value), Utilities.Charset.UTF_8).map(function (b) {
      return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
    }).join('');
}

function _op03HcTime_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
    _op03HcRefuse_('invalid_window');
  }
  var parsed = Date.parse(value);
  if (!isFinite(parsed) || new Date(parsed).toISOString() !== value) _op03HcRefuse_('invalid_window');
  return parsed;
}

function _op03HcApproval_(approval, definition) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) _op03HcRefuse_('apply_disabled');
  if (approval.operation !== definition.operation ||
      approval.runtimeSourceSha256 !== definition.runtimeSourceSha256 ||
      typeof approval.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(approval.previewFingerprint)) {
    _op03HcRefuse_('invalid_approval');
  }
  ['operator', 'ownerApprovalReference', 'pauseEvidenceReference'].forEach(function (key) {
    if (typeof approval[key] !== 'string' || !approval[key].trim() ||
        approval[key].length > 300 || /[\r\n]/.test(approval[key])) _op03HcRefuse_('invalid_approval');
  });
  var attestations = approval.operatorAttestations;
  ['runtimeSourceReadBack', 'applicationRequestsStopped', 'directEditorsStopped',
    'integrationsStopped', 'scheduledAndManualJobsStopped', 'legacyBackupDrained'].forEach(function (key) {
    if (!attestations || attestations[key] !== true) _op03HcRefuse_('missing_pause_attestation');
  });
  var started = _op03HcTime_(approval.windowStart);
  var expires = _op03HcTime_(approval.windowEnd);
  var observed = _op03HcTime_(approval.previewObservedAt);
  var now = Date.now();
  if (expires <= started || expires - started > 300000 || observed < started ||
      observed > now || now < started || now >= expires || now - observed > 120000) {
    _op03HcRefuse_('window_not_current');
  }
}

function _op03HcContext_(definition) {
  if (ScriptApp.getScriptId() !== definition.scriptId) _op03HcRefuse_('wrong_script');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss || ss.getId() !== definition.spreadsheetId) _op03HcRefuse_('wrong_workbook');
  if (typeof REMOVED_LEADS_HEADERS === 'undefined' ||
      JSON.stringify(REMOVED_LEADS_HEADERS) !== JSON.stringify(definition.headers)) {
    _op03HcRefuse_('runtime_schema_drift');
  }
  var sh = ss.getSheetByName(definition.sheetName);
  if (!sh || sh.getSheetId() !== definition.sheetId || sh.getName() !== definition.sheetName) {
    _op03HcRefuse_('wrong_sheet');
  }
  if (sh.getMaxRows() !== definition.rows || sh.getMaxColumns() !== definition.columns ||
      definition.rows * definition.columns > 50000) _op03HcRefuse_('allocation_drift');
  return sh;
}

function _op03HcProperties_() {
  var props = PropertiesService.getScriptProperties();
  ['OUTPATIENT_RECOVERY_HOLD', 'INTEGRITY_ACTIVE_BACKUP'].forEach(function (key) {
    // Apps Script returns null when absent. Empty/unexpected stored states also
    // refuse; their truthiness is not evidence that maintenance is safe.
    if (props.getProperty(key) !== null) _op03HcRefuse_('recovery_or_backup_state_present');
  });
}

function _op03HcConstraints_(sh) {
  var target = sh.getRange(1, 19, 1, 3);
  var merged = target.isPartOfMerge();
  if (merged === true) _op03HcRefuse_('target_merged');
  if (merged !== false) _op03HcRefuse_('unreadable_merge_state');
  var validations = target.getDataValidations();
  if (!Array.isArray(validations) || validations.length !== 1 ||
      !Array.isArray(validations[0]) || validations[0].length !== 3 ||
      validations[0][0] !== null || validations[0][1] !== null ||
      validations[0][2] !== null) _op03HcRefuse_('target_validation');
  if (target.canEdit() !== true) _op03HcRefuse_('target_not_editable');
  var sheets = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var ranges = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  if (!Array.isArray(sheets) || !Array.isArray(ranges)) _op03HcRefuse_('unreadable_protection');
  if (sheets.length) _op03HcRefuse_('sheet_protected');
  for (var p = 0; p < ranges.length; p++) {
    var protection = ranges[p];
    if (!protection || typeof protection.getRange !== 'function') _op03HcRefuse_('unreadable_protection');
    var r = protection.getRange();
    if (!r || r.getSheet().getSheetId() !== sh.getSheetId()) _op03HcRefuse_('unreadable_protection');
    var row = r.getRow(), col = r.getColumn(), rows = r.getNumRows(), cols = r.getNumColumns();
    [row, col, rows, cols].forEach(function (n) {
      if (!Number.isInteger(n) || n < 1) _op03HcRefuse_('unreadable_protection');
    });
    if (row === 1 && col <= 21 && col + cols - 1 >= 19) _op03HcRefuse_('target_protected');
  }
}

function _op03HcCell_(value, formula) {
  if (typeof formula !== 'string') _op03HcRefuse_('invalid_formula_read');
  // Ignore recalculated results, retaining the exact formula source instead.
  if (formula !== '') return ['formula', formula];
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (!isFinite(value.getTime())) _op03HcRefuse_('invalid_cell_read');
    return ['date', value.getTime()];
  }
  if (typeof value === 'number') {
    if (!isFinite(value)) _op03HcRefuse_('invalid_cell_read');
    return ['number', Object.is(value, -0) ? '-0' : value];
  }
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  _op03HcRefuse_('invalid_cell_read');
}

function _op03HcSnapshot_(definition) {
  var sh = _op03HcContext_(definition);
  _op03HcConstraints_(sh);
  var range = sh.getRange(1, 1, definition.rows, definition.columns);
  var values = range.getValues(), formulas = range.getFormulas();
  if (!Array.isArray(values) || !Array.isArray(formulas) ||
      values.length !== definition.rows || formulas.length !== definition.rows) _op03HcRefuse_('invalid_grid_read');
  for (var i = 0; i < definition.rows; i++) {
    if (!Array.isArray(values[i]) || !Array.isArray(formulas[i]) ||
        values[i].length !== definition.columns || formulas[i].length !== definition.columns) _op03HcRefuse_('invalid_grid_read');
  }
  for (var h = 0; h < 21; h++) {
    if (formulas[0][h] !== '') _op03HcRefuse_('header_formula');
    if (h < 18 && values[0][h] !== definition.headers[h]) _op03HcRefuse_('prefix_drift');
  }
  var pending = values[0].slice(18, 21).every(function (value) { return value === ''; });
  var current = JSON.stringify(values[0].slice(0, 21)) === JSON.stringify(definition.headers);
  if (!pending && !current) _op03HcRefuse_('partial_or_conflicting_headers');
  for (var r = 0; r < definition.rows; r++) {
    for (var c = pending ? 18 : 21; c < definition.columns; c++) {
      if (values[r][c] !== '' || formulas[r][c] !== '') _op03HcRefuse_('nonempty_tail_or_extra_columns');
    }
  }
  var typed = values.map(function (row, rowIndex) {
    return Array.from({ length: definition.columns }, function (_, colIndex) {
      var value = row[colIndex];
      // Mask only the three explicitly permitted value changes. Header
      // formulas are already forbidden; every other cell remains in the hash.
      return rowIndex === 0 && colIndex >= 18 && colIndex < 21 ? ['string', ''] :
        _op03HcCell_(value, formulas[rowIndex][colIndex]);
    });
  });
  var lastRow = sh.getLastRow(), lastColumn = sh.getLastColumn();
  if (!Number.isInteger(lastRow) || lastRow < 1 || lastRow > definition.rows ||
      !Number.isInteger(lastColumn) || lastColumn !== (pending ? 18 : 21)) _op03HcRefuse_('used_bounds_drift');
  var frozenRows = sh.getFrozenRows(), frozenColumns = sh.getFrozenColumns();
  if (!Number.isInteger(frozenRows) || frozenRows < 0 || frozenRows > definition.rows ||
      !Number.isInteger(frozenColumns) || frozenColumns < 0 || frozenColumns > definition.columns) {
    _op03HcRefuse_('invalid_grid_read');
  }
  var preserved = _op03HcHash_({
    scriptId: definition.scriptId, spreadsheetId: definition.spreadsheetId,
    sheetId: definition.sheetId, sheetName: definition.sheetName,
    rows: definition.rows, columns: definition.columns, lastRow: lastRow,
    frozenRows: frozenRows, frozenColumns: frozenColumns,
    schema: definition.headers, cells: typed
  });
  return { headerState: pending ? 'pending' : 'already_current', preservedFingerprint: preserved,
    lastRow: lastRow, lastColumn: lastColumn, rows: definition.rows, columns: definition.columns };
}

function _op03HcPreviewFingerprint_(snapshot, observedAt) {
  return _op03HcHash_({ observation: snapshot, observedAt: observedAt });
}

function _op03HcRun_(apply) {
  var definition = _op03HcDefinition_();
  var approval = OP03_HEADER_CORRECTION_APPROVAL;
  var lock, acquired = false, flushAttempted = false, failure = null;
  var receipt = { operation: definition.operation, mode: apply ? 'apply' : 'preview',
    scriptId: definition.scriptId, spreadsheetId: definition.spreadsheetId, sheetId: definition.sheetId,
    range: 'S1:U1', writeAttempted: false, writeVerified: false, lockReleased: false,
    pauseMachineVerified: false, legacyBackupIdleMachineVerified: false };
  try {
    if (apply) _op03HcApproval_(approval, definition);
    _op03HcContext_(definition);
    lock = LockService.getScriptLock();
    if (lock.tryLock(5000) !== true) _op03HcRefuse_('writer_lock_busy');
    acquired = true;
    if (apply) _op03HcApproval_(approval, definition);
    _op03HcProperties_();
    var before = _op03HcSnapshot_(definition);
    receipt.observedAt = new Date().toISOString();
    receipt.snapshot = before;
    receipt.previewFingerprint = _op03HcPreviewFingerprint_(before, receipt.observedAt);
    if (!apply) receipt.status = 'preview';
    else if (before.headerState === 'already_current') receipt.status = 'already_current';
    else {
      if (_op03HcPreviewFingerprint_(before, approval.previewObservedAt) !== approval.previewFingerprint) {
        _op03HcRefuse_('preview_drift');
      }
      receipt.approvalFingerprint = _op03HcHash_(approval);
      receipt.operator = approval.operator;
      receipt.ownerApprovalReference = approval.ownerApprovalReference;
      receipt.pauseEvidenceReference = approval.pauseEvidenceReference;
      var sh = _op03HcContext_(definition);
      _op03HcProperties_();
      var confirmed = _op03HcSnapshot_(definition);
      if (JSON.stringify(confirmed) !== JSON.stringify(before)) _op03HcRefuse_('prewrite_drift');
      _op03HcProperties_();
      _op03HcApproval_(approval, definition);
      // Flag BEFORE the RPC. A thrown call can still have committed remotely.
      receipt.writeAttempted = true;
      sh.getRange(1, 19, 1, 3).setValues([definition.headers.slice(18)]);
      flushAttempted = true;
      SpreadsheetApp.flush();
      // Finish verification even if the window expires after the write starts.
      var after = _op03HcSnapshot_(definition);
      if (after.headerState !== 'already_current' || after.preservedFingerprint !== before.preservedFingerprint) {
        _op03HcRefuse_('postwrite_verification_failed');
      }
      receipt.writeVerified = true;
      receipt.after = after;
      receipt.status = 'corrected';
    }
  } catch (err) {
    failure = err && err.op03HeaderCorrectionCode || 'service_error';
  } finally {
    // A failed setValues may have queued work; flush once before releasing.
    // This is not a second write or a retry of the failed RPC.
    if (acquired && receipt.writeAttempted && !flushAttempted) {
      flushAttempted = true;
      try { SpreadsheetApp.flush(); } catch (flushError) { receipt.flushError = true; failure = failure || 'flush_failed'; }
    }
    if (acquired) {
      try { lock.releaseLock(); receipt.lockReleased = true; }
      catch (releaseError) { failure = failure || 'lock_release_failed'; }
    }
  }
  if (failure) {
    receipt.status = receipt.writeAttempted ? 'needs_operator_check' : 'refused';
    receipt.error = failure;
  }
  // No row payload, formulas, raw service exceptions, audit-sheet row or
  // Script Property is written. Keep the receipt with the operator evidence.
  try { Logger.log(JSON.stringify(receipt)); }
  catch (logError) {
    throw new Error('OP03 header correction receipt logging failed; writeAttempted=' + receipt.writeAttempted +
      '; writeVerified=' + receipt.writeVerified + '; inspect before any further action');
  }
  if (failure) throw new Error('OP03 header correction: ' + failure +
    (receipt.writeAttempted ? '; write attempted; inspect before any further action' : '; no write attempted'));
  return receipt;
}
