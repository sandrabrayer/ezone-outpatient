'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSetup, buildVerifier: realBuildVerifier, helperClosure, sha, typedFingerprint } = require('../test-support/build-google-manual-policy-drill.cjs');
const { world, projectId } = require('../test-support/google-manual-policy-drill-sandbox.cjs');
// Only the local tests supply a commit reader double. CLI/native binding uses
// git show and compares exact committed UTF-8 bytes before emitting a verifier.
function buildVerifier(options, overrides = {}) {
  return realBuildVerifier(options, { committedEvidenceReader: () => options.evidenceRecord.text, ...overrides });
}

function setup() {
  const r = world(), baselineStateRaw = r.completeOriginal();
  const compiled = buildSetup({ scriptId: projectId, baselineStateRaw }); r.load(compiled.output);
  return { r, baselineStateRaw, compiled };
}
function restored() {
  const f = setup();
  f.r.ctx.prepareManualPolicyDrill(); f.r.ctx.captureManualPolicyDrill(); f.r.ctx.restoreManualPolicyDrill();
  return f;
}

test('unbound tooling refuses before native access and its helper closure keeps production approval blank', () => {
  const r = world(), compiled = buildSetup(); r.load(compiled.output);
  assert.throws(() => r.ctx.prepareManualPolicyDrill(), /Wrong isolated/);
  assert.equal(r.events.length, 0); assert.equal(Object.keys(r.props).length, 0);
  const helpers = helperClosure();
  assert.match(helpers.helpers, /var INTEGRITY_APPROVED_MANUAL_POLICY_SHA256 = "";/);
  assert.doesNotMatch(helpers.helpers, /\b(?:DriveApp|UrlFetchApp|MailApp|GmailApp|nightlyIntegrityJob|doPost|doGet)\b/);
  assert.doesNotMatch(compiled.output, /Sheets\.Spreadsheets\.(?:batchUpdate|create)/);
});
test('missing Advanced Sheets API refuses before policy properties or files are created', () => {
  const { r, baselineStateRaw } = setup(); const at = r.events.length, props = JSON.stringify(r.props);
  delete r.ctx.Sheets;
  assert.throws(() => r.ctx.prepareManualPolicyDrill(), /Advanced Google Sheets service/);
  assert.equal(r.events.length, at); assert.equal(JSON.stringify(r.props), props); assert.equal(r.props.OP03_DRILL_STATE, baselineStateRaw);
});
test('an installed but inaccessible Advanced Sheets API is probed before any policy mutation', () => {
  const { r } = setup(), props = JSON.stringify(r.props), books = Object.keys(r.books).length;
  r.faults.nativeApi = true;
  assert.throws(() => r.ctx.prepareManualPolicyDrill(), /Native Sheets API unavailable/);
  assert.equal(JSON.stringify(r.props), props); assert.equal(Object.keys(r.books).length, books);
  assert.equal(r.policyState(), null);
});
test('original candidate identity, completion and production project guard are checked during binding', () => {
  const { baselineStateRaw } = setup();
  for (const change of [{ running: true }, { failed: true }, { phase: 'verified' }, { sourceHash: 'changed' }, { helperHash: 'changed' }, { drillHash: 'changed' }]) {
    assert.throws(() => buildSetup({ scriptId: projectId, baselineStateRaw: JSON.stringify({ ...JSON.parse(baselineStateRaw), ...change }) }));
  }
  const prod = require('../.clasp.json').scriptId;
  assert.throws(() => buildSetup({ scriptId: prod, baselineStateRaw }), /isolated Apps Script/);
});
test('new module does not replace the original entry point or permit changes to its raw baseline', () => {
  const { r } = setup(), original = r.ctx.op03Drill_.toString(), at = r.events.length;
  r.props.OP03_DRILL_STATE += ' ';
  assert.throws(() => r.ctx.prepareManualPolicyDrill(), /Original completed drill changed/);
  assert.equal(r.events.length, at); assert.equal(r.policyState(), null); assert.equal(r.ctx.op03Drill_.toString(), original);
});
test('phase order, duplicate prepare, code drift and running/failed markers never restart work', () => {
  const { r } = setup();
  assert.throws(() => r.ctx.captureManualPolicyDrill(), /identity mismatch/);
  r.ctx.prepareManualPolicyDrill();
  const original = r.props.OP03_POLICY_DRILL_STATE, at = r.events.length;
  assert.throws(() => r.ctx.prepareManualPolicyDrill(), /already exists/);
  assert.throws(() => r.ctx.restoreManualPolicyDrill(), /phase order/);
  for (const change of [{ running: true }, { failed: true }, { setupDefinitionSHA256: 'wrong' }, { helperSHA256: 'wrong' }]) {
    r.props.OP03_POLICY_DRILL_STATE = JSON.stringify({ ...JSON.parse(original), ...change });
    assert.throws(() => r.ctx.captureManualPolicyDrill(), /phase order|identity mismatch/);
  }
  assert.equal(r.events.length, at);
});
test('whole native copy failure preserves state and evidence without resetting or retrying', () => {
  const { r, baselineStateRaw } = setup(); r.ctx.prepareManualPolicyDrill(); r.faults.nativeCopy = true;
  assert.throws(() => r.ctx.captureManualPolicyDrill(), /Whole native copy interrupted/);
  assert.equal(r.policyState().failed, true); assert.equal(r.policyState().running, false); assert.equal(r.policyState().phase, 'prepared');
  assert.equal(r.props.OP03_DRILL_STATE, baselineStateRaw);
  const at = r.events.length; assert.throws(() => r.ctx.captureManualPolicyDrill(), /phase order/); assert.equal(r.events.length, at);
});
test('policy artifact cannot alias an original evidence workbook', () => {
  const { r, baselineStateRaw } = setup(); r.ctx.prepareManualPolicyDrill();
  const state = r.policyState(); state.ids.target = JSON.parse(baselineStateRaw).ids.target; r.props.OP03_POLICY_DRILL_STATE = JSON.stringify(state);
  assert.throws(() => r.ctx.captureManualPolicyDrill(), /aliases original/);
  assert.equal(r.policyState().failed, true); assert.equal(r.props.OP03_DRILL_STATE, baselineStateRaw);
});
test('complete typed/native packets survive chunk readback and restore retains original allocations and order', () => {
  const { r, baselineStateRaw } = restored(), state = r.policyState(), packets = r.packets();
  assert.equal(Object.keys(r.books).length, 6); assert.equal(state.phase, 'restored');
  for (const name of ['prepare', 'capture', 'restore']) assert.equal(sha(packets[name]), state.packetHashes[name]);
  const capture = JSON.parse(packets.capture), restoredPacket = JSON.parse(packets.restore);
  assert.equal(capture.beforeSHA256, capture.afterSHA256); assert.equal(capture.comparableSHA256, restoredPacket.comparableSHA256);
  const manual = capture.manualTabs.find(tab => tab.source === 'Sheet1');
  assert.equal(manual.allocatedRows, 1000); assert.equal(manual.allocatedColumns, 26);
  assert.equal(r.books[state.ids.target].getSheetByName('Sheet1').getMaxRows(), 1000);
  assert.deepEqual(r.books[state.ids.target].getSheets().map(sh => sh.getName()), r.books[state.ids.source].getSheets().map(sh => sh.getName()));
  assert.equal(r.props.OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD, '1'); assert.equal(r.props.OP03_DRILL_STATE, baselineStateRaw);
  const calls = r.events.filter(event => event[0] === 'native-api' && event[2].includeGridData !== false);
  assert.ok(calls.length > 0 && calls.every(event => event[2].includeGridData === true && event[2].ranges.length > 0));
});
test('a changed source cell-format property is observed and cannot be inferred from a successful copy', () => {
  const { r } = setup(); r.ctx.prepareManualPolicyDrill();
  const source = r.books[r.policyState().ids.source];
  source.getSheetByName('Clients').policyNative.cells['0:0'] = { userEnteredFormat: { backgroundColor: { red: 1 } } };
  r.ctx.captureManualPolicyDrill();
  assert.throws(() => r.ctx.restoreManualPolicyDrill(), /Restored native properties differ/);
  assert.equal(r.policyState().failed, true); assert.equal(r.props.OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD, '1');
});
test('builder refuses incomplete packets, missing native observations and unverified permissions', () => {
  const { r, baselineStateRaw } = restored(), options = r.verifierOptions(baselineStateRaw);
  assert.throws(() => buildVerifier({ ...options, packets: { ...options.packets, capture: options.packets.capture + ' ' } }), /packet bytes/);
  const missing = JSON.parse(JSON.stringify(options)); missing.externalProof.permissions.nativeCopy.ownerOnly = false;
  assert.throws(() => buildVerifier(missing), /owner-only/);
  const missingRecord = JSON.parse(JSON.stringify(options)); missingRecord.evidenceRecord.commit = '';
  assert.throws(() => buildVerifier(missingRecord), /Committed exact evidence/);
  const changedWindow = JSON.parse(JSON.stringify(options)); changedWindow.externalProof.captureStartedAt = '2099-01-01T00:00:00.000Z';
  assert.throws(() => buildVerifier(changedWindow), /capture window/);
  assert.throws(() => buildVerifier(options, { committedEvidenceReader: () => 'different committed bytes' }), /git commit/);
  const metadata = JSON.parse(JSON.stringify(options)), record = JSON.parse(metadata.externalProof.permissionRecordText);
  record.files[0].permissions.push({ type: 'anyone', role: 'reader' });
  metadata.externalProof.permissionRecordText = JSON.stringify(record); metadata.externalProof.permissionRecordSHA256 = sha(metadata.externalProof.permissionRecordText);
  assert.throws(() => buildVerifier(metadata), /owner-only metadata/);
});
test('builder recomputes native/manual packet bindings and metadata timing instead of trusting cached claims', () => {
  const { r, baselineStateRaw } = restored();
  for (const change of [
    capture => { capture.nativeCopy.native.sheets[0].properties.hidden = true; },
    capture => { capture.manualTabs[0].allocatedRows++; },
    capture => { capture.metadataCapturedAt = '2099-01-01T00:00:00.000Z'; }
  ]) {
    const options = r.verifierOptions(baselineStateRaw), capture = JSON.parse(options.packets.capture);
    change(capture); options.packets.capture = JSON.stringify(capture);
    const state = JSON.parse(options.setupStateRaw); state.packetHashes.capture = sha(options.packets.capture); options.setupStateRaw = JSON.stringify(state);
    assert.throws(() => buildVerifier(options), /comparison hash|bindings differ|timestamps/);
  }
  const h = helperClosure(), rows = [['outpatient-manual-recovery-policy-v1'], ['source', 1, false, '', '2026-10-27T00:00:00.000Z']];
  assert.equal(h.ctx._integrityFingerprint(rows), typedFingerprint(rows));
});
test('fixed verifier runs actual two-pass finish, keeps original cache/state/report and clears the new hold last', () => {
  const { r, baselineStateRaw } = restored(), options = r.verifierOptions(baselineStateRaw), compiled = buildVerifier(options);
  const originalBackup = r.books[JSON.parse(baselineStateRaw).ids.backup], report = JSON.stringify(originalBackup.getSheetByName('_DrillReport').getDataRange().getValues());
  const cache = r.ctx.CacheService.getScriptCache(); cache.put('therapistRates_v1', 'original-cache-value');
  r.load(compiled.output); assert.equal(r.ctx.verifyManualPolicyDrill().phase, 'verified');
  const packet = JSON.parse(r.packets().verify);
  const proofs = packet.timings.filter(timing => timing.kind === 'proof' && timing.attempt === 'valid-finish');
  assert.equal(proofs.length, 2); assert.ok(proofs.every(timing => timing.ok && timing.durationMs >= 0));
  assert.equal(packet.timings.filter(timing => timing.kind === 'script-lock' && timing.attempt === 'valid-finish').length, 1);
  assert.match(packet.rejectedPolicy, /digest mismatch/); assert.equal(packet.holdReleasedLast, true); assert.equal(packet.productionCertified, false);
  assert.equal(r.props.OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD, undefined);
  assert.equal(cache.get('therapistRates_v1'), 'original-cache-value'); assert.equal(r.props.OP03_DRILL_STATE, baselineStateRaw);
  assert.equal(JSON.stringify(originalBackup.getSheetByName('_DrillReport').getDataRange().getValues()), report);
  const at = r.events.length; assert.throws(() => r.ctx.verifyManualPolicyDrill(), /phase order/); assert.equal(r.events.length, at);
});
test('fixed restored state and policy literals cannot be changed independently', () => {
  const { r, baselineStateRaw } = restored(), compiled = buildVerifier(r.verifierOptions(baselineStateRaw)); r.load(compiled.output);
  r.props.OP03_POLICY_DRILL_STATE += ' ';
  assert.throws(() => r.ctx.verifyManualPolicyDrill(), /Fixed restored state changed/);
  assert.equal(r.policyState().failed, undefined); assert.equal(r.props.OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD, '1');
});
test('row visibility is part of the actual native packet and a later change blocks finish', () => {
  const { r, baselineStateRaw } = restored(), compiled = buildVerifier(r.verifierOptions(baselineStateRaw)); r.load(compiled.output);
  r.books[r.policyState().ids.target].getSheetByName('Sheet1').policyNative.rowMetadata['17'] = { hiddenByUser: true };
  assert.throws(() => r.ctx.verifyManualPolicyDrill(), /target changed before verification/);
  assert.equal(r.policyState().failed, true); assert.equal(r.props.OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD, '1');
});
test('late native proof failure keeps the hold and persisted markers for investigation', () => {
  const { r, baselineStateRaw } = restored(), compiled = buildVerifier(r.verifierOptions(baselineStateRaw)); r.load(compiled.output);
  const getCache = r.ctx.CacheService.getScriptCache;
  r.ctx.CacheService.getScriptCache = () => {
    const cache = getCache(); return { ...cache, remove(key) {
      cache.remove(key);
      if (key === 'OP03_POLICY_CACHE_therapistRates_v1') r.books[r.policyState().ids.target].getSheetByName('Sheet1').getRange(1, 1).setValue('late edit');
    } };
  };
  assert.throws(() => r.ctx.verifyManualPolicyDrill(), /Backup value mismatch/);
  assert.equal(r.policyState().failed, true); assert.equal(r.policyState().phase, 'restored');
  assert.equal(r.props.OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD, '1'); assert.equal(r.props.OP03_POLICY_FIXTURE_FINANCIAL_OPS_CREATED, '1');
  assert.ok(JSON.parse(r.props.OP03_POLICY_FIXTURE_INTEGRITY_REQUIRED_SOURCES).includes('Copy of Clients'));
  assert.equal(r.props.OP03_DRILL_STATE, baselineStateRaw);
});
test('late formatting-only drift is refused by added native proof before the real finish clears hold', () => {
  const { r, baselineStateRaw } = restored(), compiled = buildVerifier(r.verifierOptions(baselineStateRaw)); r.load(compiled.output);
  const getCache = r.ctx.CacheService.getScriptCache;
  r.ctx.CacheService.getScriptCache = () => {
    const cache = getCache(); return { ...cache, remove(key) {
      cache.remove(key);
      if (key === 'OP03_POLICY_CACHE_therapistRates_v1') r.books[r.policyState().ids.target].getSheetByName('Sheet1').policyNative.rowMetadata['17'] = { hiddenByUser: true };
    } };
  };
  assert.throws(() => r.ctx.verifyManualPolicyDrill(), /Late native target properties changed/);
  assert.equal(r.props.OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD, '1');
  assert.equal(r.policyState().failed, true);
  const failure = JSON.parse(r.packets()['failure-verify']);
  const proofs = failure.timings.filter(timing => timing.kind === 'proof' && timing.attempt === 'valid-finish');
  assert.equal(proofs.length, 2); assert.equal(proofs[1].coreOK, true); assert.equal(proofs[1].ok, false);
  assert.ok(failure.events.every(event => event.event !== 'delete:OUTPATIENT_RECOVERY_HOLD'));
});
