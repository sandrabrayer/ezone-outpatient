'use strict';

// Test-only modules for the already completed synthetic operational drill.
// Production source and the original native runner are never rewritten.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sandbox } = require('./apps-script-sandbox');
const original = require('./build-google-operational-drill.cjs');
const canonicalizer = require('./google-manual-policy-canonical.cjs');
const root = path.join(__dirname, '..');
const PLACEHOLDER = original.PLACEHOLDER;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const entries = ['_integrityCaptureData', '_integrityWriteSnapshot', '_integrityValidateRestoreSet',
  '_integrityVerifyRecoveredWorkbook', '_integrityVerifyGrid', '_integrityFingerprint',
  '_integrityManualPolicyRows', 'beginOutpatientRecovery', 'finishOutpatientRecovery', '_finJournal'];

function requireValue(ok, message) { if (!ok) throw Error(message); }
function hash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function instant(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function typedFingerprint(rows) {
  return sha(JSON.stringify(rows.map(row => row.map(value => value instanceof Date ? ['date', value.toISOString()] : [typeof value, value]))));
}
function helperClosure() {
  const code = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
  const ctx = sandbox().ctx, selected = new Set();
  const available = Object.keys(ctx).filter(name => !['Date', 'SpreadsheetApp', 'PropertiesService',
    'LockService', 'Logger', 'Session', 'Utilities', 'ContentService'].includes(name));
  function include(name) {
    if (selected.has(name)) return;
    requireValue(name in ctx, 'Missing production helper: ' + name); selected.add(name);
    if (typeof ctx[name] !== 'function') return;
    const body = ctx[name].toString();
    requireValue(code.includes(body), 'Helper is not copied verbatim: ' + name);
    const words = new Set(body.match(/[A-Za-z_$][\w$]*/g));
    for (const dep of available) if (words.has(dep)) include(dep);
  }
  entries.forEach(include);
  const names = [...selected].sort();
  function literal(value) {
    if (Object.prototype.toString.call(value) === '[object RegExp]') return value.toString();
    const result = JSON.stringify(value); requireValue(result !== undefined, 'Unsupported helper constant'); return result;
  }
  requireValue(ctx.INTEGRITY_APPROVED_MANUAL_POLICY_SHA256 === '', 'Production manual policy must remain disabled');
  const helpers = names.map(name => typeof ctx[name] === 'function' ? ctx[name].toString() :
    'var ' + name + ' = ' + literal(ctx[name]) + ';').join('\n\n');
  requireValue(!/\b(MailApp|GmailApp|UrlFetchApp|DriveApp|ScriptApp|doGet|doPost|nightlyIntegrityJob)\b/.test(helpers), 'Unexpected service in helper closure');
  return { sourceCodeSHA256: sha(code), helperSHA256: sha(helpers), helpers, names, ctx };
}
function configuration(scriptId, baselineStateRaw) {
  if (scriptId === PLACEHOLDER) {
    requireValue(baselineStateRaw == null, 'Unbound module cannot carry a baseline');
    return { scriptId, baselineStateRaw: null, baselineStateSHA256: null, baseline: null };
  }
  // The original builder also rejects this repository's production project ID.
  const old = original.build({ scriptId });
  requireValue(typeof baselineStateRaw === 'string', 'Exact original raw state is required');
  const baseline = JSON.parse(baselineStateRaw);
  requireValue(baseline.phase === 'manual_block_verified' && baseline.running === false && !baseline.failed,
    'Original drill must be complete, idle and successful');
  requireValue(baseline.sourceHash === old.metadata.sourceCodeSHA256 && baseline.helperHash === old.metadata.helperSHA256 &&
    baseline.drillHash === old.metadata.drillDefinitionSHA256, 'Original candidate hashes differ');
  requireValue(typeof baseline.tag === 'string' && /^[a-f0-9-]{36}$/.test(baseline.tag), 'Invalid original tag');
  requireValue(baseline.ids && ['source', 'backup', 'target'].every(role => typeof baseline.ids[role] === 'string' && baseline.ids[role].length > 8) &&
    new Set(Object.values(baseline.ids)).size === 3 && Object.keys(baseline.ids).length === 3, 'Invalid original workbook IDs');
  return { scriptId, baselineStateRaw, baselineStateSHA256: sha(baselineStateRaw), baseline };
}
function parts() {
  const common = render(fs.readFileSync(path.join(__dirname, 'google-manual-policy-common-template.txt'), 'utf8'),
    { __OP03_CANONICAL__: canonicalizer.source });
  const setup = fs.readFileSync(path.join(__dirname, 'google-manual-policy-setup-template.txt'), 'utf8');
  const verify = fs.readFileSync(path.join(__dirname, 'google-manual-policy-verify-template.txt'), 'utf8');
  return { common, setup, verify };
}
function render(template, replacements) {
  let result = template;
  for (const [token, value] of Object.entries(replacements)) {
    requireValue(result.split(token).length === 2, 'Template token is not unique: ' + token);
    result = result.replace(token, () => value);
  }
  requireValue(!/__OP03_[A-Z_]+__/.test(result), 'Unresolved template token'); return result;
}
function buildSetup({ scriptId = PLACEHOLDER, baselineStateRaw } = {}) {
  const config = configuration(scriptId, baselineStateRaw), h = helperClosure(), p = parts();
  const metadata = { sourceCodeSHA256: h.sourceCodeSHA256, helperSHA256: h.helperSHA256,
    setupDefinitionSHA256: sha(JSON.stringify([p.setup, p.common, h.helpers, config])) };
  const output = render(p.setup, { __OP03_CONFIG__: JSON.stringify(config), __OP03_METADATA__: JSON.stringify(metadata),
    __OP03_COMMON__: p.common, __OP03_HELPERS__: h.helpers });
  return { output, metadata, config };
}

function readCommittedEvidence(commit, recordPath) {
  return execFileSync('git', ['show', commit + ':' + recordPath], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const BINDING_START = '<!-- OP03_POLICY_BINDING_V1_BEGIN -->';
const BINDING_END = '<!-- OP03_POLICY_BINDING_V1_END -->';
function validateVerifierInputs({ scriptId, baselineStateRaw, setupStateRaw, packets, externalProof } = {}) {
  const setup = buildSetup({ scriptId, baselineStateRaw }), h = helperClosure(), p = parts();
  requireValue(scriptId !== PLACEHOLDER && typeof setupStateRaw === 'string', 'Bound restored setup state is required');
  const state = JSON.parse(setupStateRaw), config = setup.config;
  requireValue(state.phase === 'restored' && state.running === false && !state.failed &&
    state.baselineStateSHA256 === config.baselineStateSHA256 && state.setupDefinitionSHA256 === setup.metadata.setupDefinitionSHA256 &&
    state.sourceCodeSHA256 === h.sourceCodeSHA256 && state.helperSHA256 === h.helperSHA256, 'Restored setup identity differs');
  requireValue(state.ids && state.ids.source === config.baseline.ids.source && new Set(Object.values(state.ids)).size === 4 &&
    ['backup', 'target', 'nativeCopy'].every(role => state.ids[role] && !Object.values(config.baseline.ids).includes(state.ids[role])),
    'Policy workbook isolation differs');
  requireValue(packets && ['prepare', 'capture', 'restore'].every(name => typeof packets[name] === 'string' &&
    sha(packets[name]) === state.packetHashes[name]), 'Exact retained packet bytes are required');
  const prepared = JSON.parse(packets.prepare), capture = JSON.parse(packets.capture), restored = JSON.parse(packets.restore);
  requireValue(prepared.schema === 'op03-policy-prepare-v2' && capture.schema === 'op03-policy-capture-v2' && restored.schema === 'op03-policy-restore-v2',
    'Versioned phase chronology is required');
  const phaseTimes = [prepared.phaseStartedAt, prepared.observedAt, capture.phaseStartedAt, capture.captureStartedAt,
    capture.captureEndedAt, restored.phaseStartedAt, restored.observedAt];
  requireValue(phaseTimes.every(instant) && phaseTimes.every((value, i) => !i || Date.parse(phaseTimes[i - 1]) <= Date.parse(value)),
    'Native phase chronology is inconsistent');
  for (const [inventory, id] of [[prepared.target, state.ids.target], [capture.before, state.ids.source],
    [capture.after, state.ids.source], [capture.nativeCopy, state.ids.nativeCopy], [restored.target, state.ids.target]]) {
    requireValue(inventory && inventory.spreadsheetId === id && inventory.native && inventory.native.spreadsheetId === id,
      'Retained native packet workbook identity differs');
  }
  requireValue(instant(capture.captureStartedAt) && instant(capture.captureEndedAt) && instant(capture.metadataCapturedAt) &&
    Date.parse(capture.captureStartedAt) <= Date.parse(capture.metadataCapturedAt) &&
    Date.parse(capture.metadataCapturedAt) <= Date.parse(capture.captureEndedAt), 'Native capture timestamps do not enclose metadata');
  requireValue(capture.beforeSHA256 === capture.afterSHA256 && capture.beforeSHA256 === sha(JSON.stringify(capture.before)) &&
    capture.afterSHA256 === sha(JSON.stringify(capture.after)), 'Source capture inventories disagree');
  requireValue(capture.comparableSHA256 === restored.comparableSHA256 && capture.comparableSHA256 === capture.nativeCopyComparableSHA256,
    'Native copy or restored native inventory differs');
  for (const inventory of [capture.before, capture.after, capture.nativeCopy, restored.target]) {
    requireValue(sha(JSON.stringify(canonicalizer.comparable(inventory))) === capture.comparableSHA256,
      'Retained native inventory does not match its claimed comparison hash');
  }
  requireValue(prepared.targetInitiallyEmpty === true && prepared.targetId === state.ids.target &&
    sha(JSON.stringify(prepared.target)) === prepared.targetSHA256 && prepared.target.sheets.length === 1 &&
    prepared.target.sheets[0].lastRow === 0 && prepared.target.sheets[0].lastColumn === 0 && restored.holdRetained === true,
    'Missing initial target or retained-hold evidence');
  requireValue(capture.formulasAbsent === true && sha(JSON.stringify(capture.manifest)) === capture.manifestSHA256 &&
    sha(JSON.stringify(capture.metadata)) === capture.metadataSHA256, 'Retained manifest or metadata fingerprint differs');
  const strings = grid => grid.map(row => row.map(cell => {
    requireValue(Array.isArray(cell) && cell.length === 2 && cell[0] === 'string' && typeof cell[1] === 'string', 'Expected typed string evidence cell');
    return cell[1];
  }));
  const manifest = strings(capture.manifest), metaGrid = strings(capture.metadata), meta = Object.fromEntries(metaGrid.slice(1));
  requireValue(JSON.stringify(manifest[0]) === JSON.stringify(['id', 'source', 'snapshot', 'absent', 'sha256']) && manifest.length === 23 &&
    JSON.stringify(metaGrid[0]) === JSON.stringify(['key', 'value']) && metaGrid.length === 8 && meta.schemaVersion === '2' &&
    meta.sourceSpreadsheetId === state.ids.source && meta.capturedAt === capture.metadataCapturedAt, 'Captured manifest/metadata scope differs');
  const specs = h.ctx._integritySourceSpecs(), seen = new Set();
  for (const row of manifest.slice(1)) {
    const name = row[0], spec = specs.find(item => item.source === name), source = capture.before.sheets.find(sheet => sheet.name === name);
    requireValue(row.length === 5 && row[1] === name && !seen.has(name), 'Manifest sources differ'); seen.add(name);
    const prefix = name === '__RecoveryMetadata' ? 'recovery-meta-' : spec ? spec.prefix : h.ctx._integrityOtherPrefix(name);
    const digest = name === '__RecoveryMetadata' ? capture.metadataSHA256 : source ? sha(JSON.stringify(source.grid)) :
      spec ? h.ctx._integrityFingerprint([spec.headers]) : null;
    requireValue(row[2] === 'outpatient-' + prefix + state.day && row[3] === (source || name === '__RecoveryMetadata' ? '0' : '1') && row[4] === digest,
      'Manifest data does not match retained source inventory');
  }
  requireValue(specs.every(spec => seen.has(spec.source)) && seen.has('__RecoveryMetadata') && seen.has('Sheet1') && seen.has('Copy of Clients'),
    'Captured source set is incomplete');
  for (const tab of capture.manualTabs) {
    const source = capture.before.sheets.find(sheet => sheet.name === tab.source);
    requireValue(source && tab.sheetId === source.sheetId && tab.absent === false && tab.prefix === h.ctx._integrityOtherPrefix(tab.source) &&
      tab.sha256 === sha(JSON.stringify(source.grid)) && tab.rows === source.grid.length && tab.columns === source.grid[0].length &&
      tab.allocatedRows === source.allocatedRows && tab.allocatedColumns === source.allocatedColumns,
      'Manual policy bindings differ from retained native source');
    if (tab.role === 'structural-empty') requireValue(source.grid.every(row => row.every(cell => cell[0] === 'string' && cell[1] === '')),
      'Structural-empty source contains data');
  }
  requireValue(capture.before.schema === 'op03-native-inventory-v2' && capture.before.native && capture.after.native &&
    capture.nativeCopy.native && restored.target.native, 'Complete saved native Sheets API observations are required');
  requireValue(externalProof && externalProof.version === 2 && externalProof.schema === 'op03-external-permission-proof-v2' &&
    typeof externalProof.operator === 'string' && externalProof.operator.trim(), 'External native proof record is required');
  requireValue(externalProof.directWritesPaused === true && instant(externalProof.captureStartedAt) && instant(externalProof.captureEndedAt) &&
    Date.parse(externalProof.captureStartedAt) <= Date.parse(capture.captureStartedAt) &&
    Date.parse(externalProof.captureEndedAt) >= Date.parse(capture.captureEndedAt), 'Coordinated capture window is incomplete');
  const checkpoints = ['beforeCapture', 'beforeRestore', 'beforeVerifier'];
  requireValue(externalProof.permissionRecords && JSON.stringify(Object.keys(externalProof.permissionRecords).sort()) === JSON.stringify(checkpoints.slice().sort()),
    'Three exact permission checkpoints are required');
  const permissionCheckpoints = {}, identities = {}, ownerKeys = [];
  for (const checkpoint of checkpoints) {
    const record = externalProof.permissionRecords[checkpoint];
    requireValue(record && typeof record.text === 'string' && hash(record.sha256) && sha(record.text) === record.sha256,
      'Exact retained permission record bytes are required');
    const permissions = JSON.parse(record.text), roles = checkpoint === 'beforeCapture' ? ['source', 'backup', 'target'] : ['source', 'backup', 'target', 'nativeCopy'];
    requireValue(permissions.version === 2 && permissions.schema === 'op03-drive-permissions-v2' && permissions.checkpoint === checkpoint &&
      instant(permissions.observedAt) && Array.isArray(permissions.files) && permissions.files.length === roles.length, 'Invalid permission evidence schema');
    permissionCheckpoints[checkpoint] = permissions.observedAt;
    for (const role of roles) {
      const matches = permissions.files.filter(file => file.role === role), file = matches[0];
      requireValue(matches.length === 1 && file.id === state.ids[role] && file.shared === false &&
        Array.isArray(file.permissions) && file.permissions.length === 1 && file.permissions[0].type === 'user' &&
        file.permissions[0].role === 'owner' && instant(file.createdTime) && Date.parse(file.createdTime) <= Date.parse(permissions.observedAt),
        'Permission record is not exact owner-only metadata');
      const owner = file.permissions[0];
      const ownerKey = typeof owner.emailAddress === 'string' && owner.emailAddress.trim() ? sha(owner.emailAddress.trim().toLowerCase()) : owner.emailAddressSHA256;
      requireValue(hash(ownerKey), 'Permission record must retain or hash the observed owner identity'); ownerKeys.push(ownerKey);
      const identity = JSON.stringify([file.id, ownerKey, file.createdTime]);
      requireValue(!identities[role] || identities[role] === identity, 'Permission checkpoint identity or creation time changed'); identities[role] = identity;
      if (role === 'target') requireValue(externalProof.targetCreatedAt === file.createdTime, 'Target creation time differs from Drive metadata');
      if (role === 'nativeCopy') requireValue(Date.parse(file.createdTime) >= Date.parse(capture.captureStartedAt) && Date.parse(file.createdTime) <= Date.parse(capture.captureEndedAt),
        'Native-copy creation time is outside the captured interval');
      if (role === 'backup' || role === 'target') requireValue(Date.parse(file.createdTime) >= Date.parse(prepared.phaseStartedAt) && Date.parse(file.createdTime) <= Date.parse(prepared.observedAt),
        'Policy artifact creation time is outside preparation');
      if (role === 'source') requireValue(Date.parse(file.createdTime) <= Date.parse(prepared.phaseStartedAt), 'Original source creation time is inconsistent');
    }
  }
  requireValue(new Set(ownerKeys).size === 1, 'Synthetic workbook owners differ');
  requireValue(Date.parse(permissionCheckpoints.beforeCapture) >= Date.parse(prepared.observedAt) &&
    Date.parse(permissionCheckpoints.beforeCapture) <= Date.parse(capture.phaseStartedAt) &&
    Date.parse(permissionCheckpoints.beforeRestore) >= Date.parse(capture.captureEndedAt) &&
    Date.parse(permissionCheckpoints.beforeRestore) <= Date.parse(restored.phaseStartedAt) &&
    Date.parse(permissionCheckpoints.beforeVerifier) >= Date.parse(restored.observedAt) &&
    Date.parse(permissionCheckpoints.beforeVerifier) <= Date.now(), 'Permission checkpoint chronology is inconsistent');
  requireValue(instant(externalProof.targetCreatedAt) && Date.parse(externalProof.targetCreatedAt) <= Date.parse(prepared.observedAt),
    'Target creation time must precede its initial-empty observation');
  return { setup, h, p, state, config, prepared, capture, restored, externalProof, permissionCheckpoints,
    scriptId, baselineStateRaw, setupStateRaw, packets };
}

function bindingFromValidated(v) {
  return canonicalizer.canonical({ schema: 'op03-policy-evidence-binding-v1', version: 1,
    scriptId: v.scriptId, originalDrill: { stateSHA256: sha(v.baselineStateRaw), tag: v.config.baseline.tag,
      ids: v.config.baseline.ids, sourceSHA256: v.config.baseline.sourceHash, helperSHA256: v.config.baseline.helperHash,
      definitionSHA256: v.config.baseline.drillHash },
    policySetup: { stateSHA256: sha(v.setupStateRaw), tag: v.state.tag, day: v.state.day, ids: v.state.ids,
      sourceSHA256: v.setup.metadata.sourceCodeSHA256, helperSHA256: v.setup.metadata.helperSHA256,
      definitionSHA256: v.setup.metadata.setupDefinitionSHA256 },
    packetSHA256: Object.fromEntries(['prepare', 'capture', 'restore'].map(name => [name, sha(v.packets[name])])),
    inventory: { beforeSHA256: v.capture.beforeSHA256, afterSHA256: v.capture.afterSHA256,
      comparableSHA256: v.capture.comparableSHA256, manifestSHA256: v.capture.manifestSHA256,
      metadataSHA256: v.capture.metadataSHA256, manualTabsSHA256: sha(JSON.stringify(v.capture.manualTabs)) },
    chronology: { prepareStartedAt: v.prepared.phaseStartedAt, prepareObservedAt: v.prepared.observedAt,
      capturePhaseStartedAt: v.capture.phaseStartedAt, captureStartedAt: v.capture.captureStartedAt,
      metadataCapturedAt: v.capture.metadataCapturedAt, captureEndedAt: v.capture.captureEndedAt,
      restoreStartedAt: v.restored.phaseStartedAt, restoreObservedAt: v.restored.observedAt,
      permissions: v.permissionCheckpoints, targetCreatedAt: v.externalProof.targetCreatedAt },
    externalProofSHA256: sha(JSON.stringify(v.externalProof)),
    permissionRecordSHA256: Object.fromEntries(['beforeCapture', 'beforeRestore', 'beforeVerifier'].map(name =>
      [name, sha(v.externalProof.permissionRecords[name].text)])), productionCertified: false });
}
function bindingMarkdown(binding) {
  return BINDING_START + '\n```json\n' + JSON.stringify(binding, null, 2) + '\n```\n' + BINDING_END;
}
function buildEvidenceBinding(options = {}) {
  const validated = validateVerifierInputs(options), binding = bindingFromValidated(validated);
  return { output: bindingMarkdown(binding) + '\n', binding, metadata: validated.setup.metadata };
}
function buildVerifier(options = {}, { committedEvidenceReader = readCommittedEvidence } = {}) {
  const validated = validateVerifierInputs(options);
  const { setup, h, p, state, config, capture, externalProof, permissionCheckpoints, setupStateRaw } = validated;
  const evidenceRecord = options.evidenceRecord;
  requireValue(evidenceRecord && /^docs\/evidence\/op03-manual-tabs-\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?\.md$/.test(evidenceRecord.path) &&
    typeof evidenceRecord.text === 'string' && evidenceRecord.text.trim() && /^[a-f0-9]{40}$/.test(evidenceRecord.commit),
    'Committed exact evidence record is required');
  requireValue(committedEvidenceReader(evidenceRecord.commit, evidenceRecord.path) === evidenceRecord.text,
    'Evidence record bytes differ from the exact git commit');
  const binding = bindingFromValidated(validated), block = bindingMarkdown(binding);
  requireValue(evidenceRecord.text.split(BINDING_START).length === 2 && evidenceRecord.text.split(BINDING_END).length === 2,
    'Evidence record must contain exactly one machine-readable binding block');
  const begin = evidenceRecord.text.indexOf(BINDING_START), end = evidenceRecord.text.indexOf(BINDING_END) + BINDING_END.length;
  requireValue(evidenceRecord.text.slice(begin, end) === block, 'Committed evidence binding differs from actual retained inputs; regenerate the binding block');
  const policy = { version: 1, sourceId: state.ids.source, backupId: state.ids.backup, day: state.day, targetId: state.ids.target,
    manifestSha256: capture.manifestSHA256, metadataSha256: capture.metadataSHA256,
    evidence: { recordPath: evidenceRecord.path, sha256: sha(evidenceRecord.text), operator: externalProof.operator,
      captureStartedAt: externalProof.captureStartedAt, captureEndedAt: externalProof.captureEndedAt,
      beforeInventorySha256: capture.beforeSHA256, afterInventorySha256: capture.afterSHA256, nativeCopyId: state.ids.nativeCopy,
      directWritesPaused: true, formulasAbsent: capture.formulasAbsent === true, nativePropertiesVerified: true,
      targetCreatedAt: externalProof.targetCreatedAt, targetInitiallyEmpty: true, targetOwnerOnly: true }, tabs: capture.manualTabs };
  requireValue(policy.tabs.length === 2 && new Set(policy.tabs.map(tab => tab.source)).size === 2 && policy.tabs.some(t => t.source === 'Sheet1' && t.role === 'structural-empty') &&
    policy.tabs.some(t => t.source === 'Copy of Clients' && t.role === 'retained-archive'), 'Unexpected manual tab classification');
  const rows = h.ctx._integrityManualPolicyRows(policy), pin = h.ctx._integrityFingerprint(rows);
  requireValue(pin === typedFingerprint(rows), 'Typed canonical fingerprint drift');
  const approval = { policy, pin, externalProof, externalProofSHA256: sha(JSON.stringify(externalProof)), permissionCheckpoints,
    evidenceBinding: binding, evidenceBindingSHA256: sha(JSON.stringify(binding)),
    evidenceCommit: evidenceRecord.commit, restoredStateRaw: setupStateRaw, restoredStateSHA256: sha(setupStateRaw) };
  const metadata = { ...setup.metadata, verifierDefinitionSHA256: sha(JSON.stringify([p.verify, p.common, h.helpers, config, approval])) };
  const output = render(p.verify, { __OP03_CONFIG__: JSON.stringify(config), __OP03_METADATA__: JSON.stringify(metadata),
    __OP03_APPROVAL__: JSON.stringify(approval), __OP03_COMMON__: p.common, __OP03_HELPERS__: h.helpers });
  return { output, metadata, policy, pin, approval };
}

if (require.main === module) {
  const [mode, configPath, outputPath, ...rest] = process.argv.slice(2);
  requireValue(['setup', 'binding', 'verify'].includes(mode) && configPath && outputPath && !rest.length,
    'Usage: node test-support/build-google-manual-policy-drill.cjs setup|binding|verify CONFIG_JSON NEW_OUTPUT_FILE');
  const options = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const result = mode === 'setup' ? buildSetup(options) : mode === 'binding' ? buildEvidenceBinding(options) : buildVerifier(options);
  requireValue(path.resolve(outputPath) !== path.join(__dirname, 'google-operational-drill.gs') &&
    path.resolve(outputPath) !== path.join(root, 'apps-script/Code.gs'), 'Never overwrite original runners or production source');
  fs.writeFileSync(outputPath, result.output, { flag: 'wx' });
  console.log(JSON.stringify({ ...result.metadata, bytes: Buffer.byteLength(result.output), fileSHA256: sha(result.output),
    policySHA256: result.pin || null, productionCertified: false }));
}
module.exports = { buildSetup, buildEvidenceBinding, buildVerifier, helperClosure, sha, typedFingerprint, PLACEHOLDER };
