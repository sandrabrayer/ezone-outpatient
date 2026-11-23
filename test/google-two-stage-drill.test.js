'use strict';
// Safety/real-code proof for the pending native Google Gate 0 runner.
// These tests NEVER contact Google; the native rehearsal requires a separate
// explicitly owned standalone Apps Script project and no production workbook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build, extract, ENTRYPOINTS, PLACEHOLDER } =
  require('../test-support/build-google-two-stage-drill.cjs');

const root = path.join(__dirname,'..');
const scriptId = 'isolated-op03-script-0123456789-aBcDeFgHi';
const prodId = JSON.parse(fs.readFileSync(path.join(root,'.clasp.json'))).scriptId;

test('Gate 0 contains ACTUAL source A and B, not just old five-phase helpers', () => {
  const { output, metadata } = build({ scriptId });
  const actual = extract();
  assert.deepEqual(metadata.realEntrypoints,
    ['nightlyIntegrityJob', 'finalizeNightlyIntegrityJob']);
  for (const name of ENTRYPOINTS) assert.ok(actual.names.includes(name), name);
  for (const name of ['nightlyIntegrityJob', 'finalizeNightlyIntegrityJob']) {
    const f = actual.names.find(n => n === name);
    assert.ok(f);
    assert.match(output, new RegExp('function ' + name + '\\('));
  }
  assert.match(output, /nightlyIntegrityJob\(\); \/\/ ACTUAL product Phase A/);
  assert.match(output, /finalizeNightlyIntegrityJob\(\); \/\/ ACTUAL product Phase B/);
  assert.match(output, /_integrityValidateRestoreSet\(books\.backup, state\.day, true\)/);
  assert.ok(metadata.sourceCodeSHA256 && metadata.helperSHA256 && metadata.drillDefinitionSHA256);
  assert.equal(metadata.productionCertified, false);
  assert.doesNotThrow(() => new vm.Script(output));
});
test('production Script ID and invalid or unauthenticated IDs are refused before generation', () => {
  for (const id of [prodId, 'short', 'oops\napp', 'x'.repeat(151)]) {
    assert.throws(() => build({ scriptId: id }), /isolated Apps Script/);
  }
  const disabled = build().output;
  assert.match(disabled, /ISOLATED_SCRIPT_ID_REQUIRED/);
  assert.ok(!disabled.includes(prodId), 'never embed the production script identifier');
  assert.equal(PLACEHOLDER, 'ISOLATED_SCRIPT_ID_REQUIRED');
});
test('the isolated wrapper owns exactly three NEW synthetic books, namespaced properties, no email', () => {
  const { output } = build({scriptId});
  assert.match(output, /SpreadsheetApp\.getActiveSpreadsheet\(\)/);
  assert.match(output, /A NEW standalone/);
  assert.match(output, /nativeProperties\.getKeys\(\)\.length !== 0/);
  assert.match(output, /\['source','backup','target'\]\.forEach/);
  assert.match(output, /OP03 TWO-STAGE SYNTHETIC ONLY/);
  assert.match(output, /propPrefix = 'OP03_NATIVE_V3_'/);
  assert.match(output, /Mail suppressed in native synthetic drill/);
  assert.match(output, /Refusing workbook OUTSIDE this isolated test/);
  assert.match(output, /function expandTwoStageInventoryDrill/);
  assert.match(output, /state\.scaleTabs === 350/);
  assert.match(output, /!assertSnapshot\(null,'manifest'\) && !assertSnapshot\(null,'verified'\)/);
  assert.match(output, /Manual tabs lost during physical copy/);
  assert.match(output, /Operational restore MUST remain held for manual archive policy/);
  assert.match(output, /productionCertified:false, fullOperationalRecoveryCertified:false/);
});
test('source, fixture and wrapper hashes bind to the exact candidate and script ID', () => {
  const a = build({scriptId}), b = build({scriptId});
  const c = build({scriptId:'isolated-op03-script-0123456789-different'});
  assert.equal(a.output,b.output);
  assert.equal(a.metadata.sourceCodeSHA256,b.metadata.sourceCodeSHA256);
  assert.notEqual(a.metadata.drillDefinitionSHA256,c.metadata.drillDefinitionSHA256);
});
test('legacy native five-function drill remains a separate unchanged path', () => {
  const original = fs.readFileSync(path.join(root,'test-support/google-operational-drill-template.txt'),'utf8');
  assert.match(original,/function prepareOperationalDrill/);
  assert.match(original,/function verifyManualTabDrill/);
  assert.doesNotMatch(original,/function captureTwoStageDrill/);
});
