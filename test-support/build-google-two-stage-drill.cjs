'use strict';

// OP-03 Gate 0: an entirely separate *native* test harness. The historical
// five-phase operational drill remains unchanged. Never deploy this artifact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sandbox } = require('./apps-script-sandbox');
const { fixture, PLACEHOLDER } = require('./build-google-operational-drill.cjs');
const root = path.join(__dirname, '..');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

// These are the REAL product entrypoints. A helper-only drill is inadequate:
// it cannot measure the two independent Google execution time budgets.
const ENTRYPOINTS = Object.freeze([
  'nightlyIntegrityJob', 'finalizeNightlyIntegrityJob',
  '_integrityValidateRestoreSet', '_integrityVerifyRecoveredWorkbook',
  '_integrityWriteSnapshot', '_integrityCaptureData', '_integrityVerifyGrid',
  '_integrityFingerprint', '_integrityRecoveryMetadata'
]);

function extract() {
  const source = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
  const ctx = sandbox().ctx;
  const selected = new Set();
  const unavailable = new Set([
    'Date', 'SpreadsheetApp', 'PropertiesService', 'LockService', 'Logger',
    'Session', 'Utilities', 'ContentService', 'MailApp', 'ScriptApp',
    'DriveApp', 'UrlFetchApp', 'GmailApp', 'CacheService'
  ]);
  const available = Object.keys(ctx).filter(name => !unavailable.has(name));
  function include(name) {
    if (selected.has(name)) return;
    if (!(name in ctx)) throw Error('Missing real Apps Script source symbol: ' + name);
    selected.add(name);
    if (typeof ctx[name] !== 'function') return;
    const body = ctx[name].toString();
    if (!source.includes(body)) throw Error('Source helper is not verbatim: ' + name);
    const tokens = new Set(body.match(/[A-Za-z_$][\w$]*/g) || []);
    for (const dep of available) if (tokens.has(dep)) include(dep);
  }
  ENTRYPOINTS.forEach(include);
  const names = [...selected].sort();
  function literal(v) {
    if (Object.prototype.toString.call(v) === '[object RegExp]') return v.toString();
    const json = JSON.stringify(v);
    if (json === undefined) throw Error('Unsupported source constant');
    return json;
  }
  const helpers = names.map(name => typeof ctx[name] === 'function'
    ? ctx[name].toString() : 'var ' + name + ' = ' + literal(ctx[name]) + ';').join('\n\n');
  // Only the explicitly sandboxed native services may be referenced. MailApp
  // is always injected as a no-send facade, even on a failing capture.
  if (/\b(?:UrlFetchApp|DriveApp|GmailApp|ScriptApp|doGet|doPost|XmlService)\b/.test(helpers))
    throw Error('Unapproved service or HTTP handler in native Gate 0 closure');
  return { source, helpers, names };
}
function build({ scriptId = PLACEHOLDER } = {}) {
  const productionId = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8')).scriptId;
  if (scriptId !== PLACEHOLDER &&
      (!/^[A-Za-z0-9_-]{30,150}$/.test(scriptId) || scriptId === productionId))
    throw Error('Use a NEW standalone isolated Apps Script project ID, never production');
  const { source, helpers, names } = extract();
  const template = fs.readFileSync(path.join(__dirname, 'google-two-stage-drill-template.txt'), 'utf8');
  const fixtures = JSON.stringify(fixture()); // existing, source-derived synthetic data only
  const metadata = {
    sourceCodeSHA256: sha(source), helperSHA256: sha(helpers),
    drillDefinitionSHA256: sha(JSON.stringify([template, fixtures, helpers, scriptId])),
    helperNames: names, realEntrypoints: ['nightlyIntegrityJob', 'finalizeNightlyIntegrityJob'],
    nativeOnly: true, productionCertified: false
  };
  let output = template;
  for (const [token, value] of Object.entries({
    __SCRIPT_ID_JSON__: JSON.stringify(scriptId),
    __METADATA_JSON__: JSON.stringify(metadata),
    __FIXTURE_JSON__: fixtures,
    __HELPERS__: helpers
  })) {
    if (output.split(token).length !== 2) throw Error('Invalid Gate 0 template token: ' + token);
    output = output.replace(token, value);
  }
  if (!output.includes('function nightlyIntegrityJob(') ||
      !output.includes('function finalizeNightlyIntegrityJob('))
    throw Error('REAL phase A/B source bodies absent: never certify a helper-only drill');
  return { output, metadata };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--script-id'))
    throw Error('Usage: build-google-two-stage-drill.cjs [--script-id ISOLATED_ID]');
  const result = build({ scriptId: args[1] || PLACEHOLDER });
  fs.writeFileSync(path.join(__dirname, 'google-two-stage-drill-candidate.gs'), result.output);
  console.log(JSON.stringify({
    ...result.metadata, bytes: Buffer.byteLength(result.output), runnable: Boolean(args[1])
  }));
}
module.exports = { build, extract, ENTRYPOINTS, PLACEHOLDER };
