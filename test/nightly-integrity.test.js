'use strict';

/**
 * Coverage for the nightly data-integrity job (apps-script/Code.gs):
 * nightlyIntegrityJob + setupIntegrityTrigger.
 *
 * Two styles, matching the passing tests in this suite:
 *
 * 1. REAL-CODE extraction (the session-outcome pattern): the pure helpers
 *    (_integrityDiffMissingIds, _integrityParsePaymentClientId,
 *    _integrityOrphanClientIds, _integritySnapshotName,
 *    _integrityIsExpiredSnapshot, _integrityAlertBody) use no GAS services,
 *    so their source is extracted from Code.gs (balanced braces) and eval'd —
 *    the tests run the ACTUAL deployed logic, no drift-prone mirrors.
 *
 * 2. SOURCE-SCAN guards locking the job's contract:
 *    - READ-ONLY vs the live Clients/Payments sheets: no write primitive and
 *      no _ensureSheet (not even a header relabel) inside the job body.
 *    - Check ORDERING: the sentinel's name lookup (check 1) runs BEFORE the
 *      snapshot overwrite (check 3) — the lookup reads yesterday's snapshot,
 *      which the same-day overwrite would replace.
 *    - Trigger installer idempotency (delete-then-create, 02:00 daily).
 *    - Fail-open alerting (missing ALERT_EMAIL -> Logger.log, never throw).
 *    - CLIENTS_HEADERS untouched; project timezone pinned to Asia/Jerusalem
 *      (atHour(2) + snapshot date rolls depend on it).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

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

// --- array-of-strings literal (the saveall-tombstone pattern) ----------------
function gsHeaders(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

// Build the pure helpers from the REAL Code.gs source. The constants the
// helpers reference are eval'd alongside them, so a prefix or retention
// change in Code.gs flows straight into these tests.
const PURE_SRC = [
  gsVarDecl('INTEGRITY_SNAPSHOT_PREFIX'),
  gsVarDecl('INTEGRITY_SNAPSHOT_RE'),
  gsVarDecl('INTEGRITY_RETENTION_DAYS'),
  gsFunction('_integrityDiffMissingIds'),
  gsFunction('_integrityParsePaymentClientId'),
  gsFunction('_integrityOrphanClientIds'),
  gsFunction('_integritySnapshotName'),
  gsFunction('_integrityIsExpiredSnapshot'),
  gsFunction('_integrityAlertBody'),
].join('\n');

// eslint-disable-next-line no-new-func
const g = new Function(PURE_SRC + `
  return {
    INTEGRITY_SNAPSHOT_PREFIX: INTEGRITY_SNAPSHOT_PREFIX,
    INTEGRITY_RETENTION_DAYS: INTEGRITY_RETENTION_DAYS,
    diffMissingIds: _integrityDiffMissingIds,
    parsePaymentClientId: _integrityParsePaymentClientId,
    orphanClientIds: _integrityOrphanClientIds,
    snapshotName: _integritySnapshotName,
    isExpiredSnapshot: _integrityIsExpiredSnapshot,
    alertBody: _integrityAlertBody,
  };
`)();

// ─────────────────────────────────────────────────────────────────────────────
// Id diffing (check 1 core)
// ─────────────────────────────────────────────────────────────────────────────

test('diffMissingIds: ids gone since the previous run', () => {
  assert.deepEqual(g.diffMissingIds(['a', 'b', 'c'], ['a', 'c']), ['b']);
  assert.deepEqual(g.diffMissingIds(['a', 'b'], []), ['a', 'b']);
});

test('diffMissingIds: no drop / additions only -> empty', () => {
  assert.deepEqual(g.diffMissingIds(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(g.diffMissingIds(['a'], ['a', 'b', 'c']), []);
  assert.deepEqual(g.diffMissingIds([], ['a']), []);
});

test('diffMissingIds: blank/null ids ignored; numeric ids compared as strings', () => {
  assert.deepEqual(g.diffMissingIds(['', null, 'a'], []), ['a']);
  assert.deepEqual(g.diffMissingIds([7, 'x'], ['7']), ['x']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Payment-id parsing (check 2 core)
// ─────────────────────────────────────────────────────────────────────────────

test('parsePaymentClientId: all four documented shapes', () => {
  assert.equal(g.parsePaymentClientId('pay::c1::base::2026-08'), 'c1'); // base monthly
  assert.equal(g.parsePaymentClientId('pay::c1::chg-x9::2026-08'), 'c1'); // extra monthly
  assert.equal(g.parsePaymentClientId('pay::c1::chg-x9::once'), 'c1'); // one-time extra
  assert.equal(g.parsePaymentClientId('pay::c1::2026-08'), 'c1'); // legacy 3-segment
});

test('parsePaymentClientId: real-world id shape', () => {
  assert.equal(g.parsePaymentClientId('pay::id_mslqqp14_ab12::base::2026-08'), 'id_mslqqp14_ab12');
});

test('parsePaymentClientId: non-conforming -> "" (caller falls back to clientId column)', () => {
  assert.equal(g.parsePaymentClientId(''), '');
  assert.equal(g.parsePaymentClientId(null), '');
  assert.equal(g.parsePaymentClientId('pay::c1'), ''); // too few segments
  assert.equal(g.parsePaymentClientId('pay::::2026-08'), ''); // empty clientId slot
  assert.equal(g.parsePaymentClientId('chg::c1::2026-08'), ''); // wrong kind
  assert.equal(g.parsePaymentClientId('c1-2026-08'), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// Orphan detection (check 2)
// ─────────────────────────────────────────────────────────────────────────────

test('orphanClientIds: live row or tombstone clears a payment; neither -> orphan', () => {
  const payments = [
    { id: 'pay::live1::base::2026-08', clientId: 'live1' },
    { id: 'pay::tomb1::base::2026-08', clientId: 'tomb1' },
    { id: 'pay::lost1::base::2026-08', clientId: 'lost1' },
  ];
  assert.deepEqual(
    g.orphanClientIds(payments, { live1: true }, { tomb1: true }),
    ['lost1']
  );
});

test('orphanClientIds: many payments per client -> one orphan entry', () => {
  const payments = [
    { id: 'pay::lost1::base::2026-07' },
    { id: 'pay::lost1::base::2026-08' },
    { id: 'pay::lost1::chg-a::once' },
  ];
  assert.deepEqual(g.orphanClientIds(payments, {}, {}), ['lost1']);
});

test('orphanClientIds: malformed payment id falls back to the clientId column', () => {
  const payments = [
    { id: 'weird-row', clientId: 'lost2' },
    { id: '', clientId: '' }, // no resolvable clientId -> skipped, not an orphan
  ];
  assert.deepEqual(g.orphanClientIds(payments, {}, {}), ['lost2']);
});

test('orphanClientIds: parsed id wins over a stale clientId column', () => {
  // The id was built from the client row, so it is authoritative.
  const payments = [{ id: 'pay::real1::base::2026-08', clientId: 'stale9' }];
  assert.deepEqual(g.orphanClientIds(payments, { real1: true }, {}), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot naming + retention date math (check 3)
// ─────────────────────────────────────────────────────────────────────────────

test('snapshotName: prefixed, zero-padded, from local date parts', () => {
  assert.equal(g.snapshotName(new Date(2026, 0, 5)), 'outpatient-2026-01-05');
  assert.equal(g.snapshotName(new Date(2026, 11, 31)), 'outpatient-2026-12-31');
  assert.equal(g.INTEGRITY_SNAPSHOT_PREFIX, 'outpatient-');
});

test('retention: strictly older than 30 days expires; 30 or newer survives', () => {
  const today = 'outpatient-2026-08-30';
  assert.equal(g.INTEGRITY_RETENTION_DAYS, 30);
  assert.equal(g.isExpiredSnapshot('outpatient-2026-07-30', today, 30), true); // 31 days
  assert.equal(g.isExpiredSnapshot('outpatient-2026-07-31', today, 30), false); // exactly 30
  assert.equal(g.isExpiredSnapshot('outpatient-2026-08-29', today, 30), false);
  assert.equal(g.isExpiredSnapshot(today, today, 30), false);
});

test('retention: month and year boundaries', () => {
  assert.equal(g.isExpiredSnapshot('outpatient-2025-12-01', 'outpatient-2026-01-31', 30), true);
  assert.equal(g.isExpiredSnapshot('outpatient-2025-12-31', 'outpatient-2026-01-30', 30), false);
  assert.equal(g.isExpiredSnapshot('outpatient-2025-12-31', 'outpatient-2026-01-31', 30), true);
});

test('retention: strict matcher — anything not outpatient-YYYY-MM-DD never expires', () => {
  const today = 'outpatient-2026-08-30';
  assert.equal(g.isExpiredSnapshot('Sheet1', today, 30), false);
  assert.equal(g.isExpiredSnapshot('2020-01-01', today, 30), false); // unprefixed
  assert.equal(g.isExpiredSnapshot('dashboard-2020-01-01', today, 30), false); // other app's
  assert.equal(g.isExpiredSnapshot('outpatient-2020-1-1', today, 30), false); // unpadded
  assert.equal(g.isExpiredSnapshot('outpatient-2020-01-01x', today, 30), false); // trailing junk
  assert.equal(g.isExpiredSnapshot('', today, 30), false);
  // Garbage "today" fails closed too.
  assert.equal(g.isExpiredSnapshot('outpatient-2020-01-01', 'garbage', 30), false);
});

test('retention round-trip: snapshotName output feeds isExpiredSnapshot (prefix + RE stay in sync)', () => {
  const today = g.snapshotName(new Date(2026, 7, 30));
  assert.equal(g.isExpiredSnapshot(g.snapshotName(new Date(2026, 6, 1)), today, 30), true); // 60 days
  assert.equal(g.isExpiredSnapshot(g.snapshotName(new Date(2026, 7, 29)), today, 30), false); // yesterday
});

// ─────────────────────────────────────────────────────────────────────────────
// Alert body (Hebrew, ids + names)
// ─────────────────────────────────────────────────────────────────────────────

test('alertBody: lists missing ids + names, orphans, errors, counts', () => {
  const body = g.alertBody({
    missing: [{ id: 'c1', name: 'דנה כהן' }, { id: 'c2', name: '' }],
    orphans: [{ id: 'c3', name: 'יוסי לוי' }],
    errors: ['boom'],
    prevCount: '12',
    currentCount: '10',
  });
  assert.match(body, /c1 — דנה כהן/);
  assert.match(body, /• c2\n/); // nameless id still listed
  assert.match(body, /c3 — יוסי לוי/);
  assert.match(body, /boom/);
  assert.match(body, /12/);
  assert.match(body, /10/);
});

test('alertBody: sections are omitted when empty', () => {
  const body = g.alertBody({ missing: [], orphans: [{ id: 'c3', name: '' }], errors: [] });
  assert.doesNotMatch(body, /שגיאות פנימיות/);
  assert.doesNotMatch(body, /שנעלמו/);
  assert.match(body, /תשלומים/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards: read-only contract + check ordering
// ─────────────────────────────────────────────────────────────────────────────

const JOB = gsFunction('nightlyIntegrityJob');

test('job is read-only vs live sheets: no write primitives, no _ensureSheet in its body', () => {
  // Snapshot writes are delegated to _integrityWriteSnapshot (backup ss only);
  // the job body itself may only write Script Properties.
  for (const forbidden of [
    '_writeAll(', '_ensureSheet(', '.appendRow(', '.clearContent(',
    '.setValue(', '.setValues(', '.insertSheet(', '.deleteSheet(', '.clear(',
  ]) {
    assert.ok(!JOB.includes(forbidden), 'nightlyIntegrityJob body must not contain ' + forbidden);
  }
  // Live reads go through getSheetByName (never _ensureSheet's relabel).
  assert.ok(JOB.includes(".getSheetByName('Clients')"));
  assert.ok(JOB.includes(".getSheetByName('Payments')"));
  assert.ok(JOB.includes(".getSheetByName('Clients-removed')"));
});

test('snapshot/retention helpers never touch the live sheets', () => {
  for (const name of ['_integrityWriteSnapshot', '_integrityApplyRetention']) {
    const src = gsFunction(name);
    assert.ok(!src.includes("'Clients'"), name + ' must not reference the live Clients sheet');
    assert.ok(!src.includes("'Payments'"), name + ' must not reference the live Payments sheet');
    assert.ok(!src.includes('_writeAll('), name + ' must not use _writeAll');
    assert.ok(!src.includes('_ss()'), name + ' must only operate on the passed backup spreadsheet');
  }
});

test('check ordering: sentinel (+ its snapshot name lookup) runs BEFORE the snapshot overwrite', () => {
  const check1 = JOB.indexOf('CHECK 1');
  const check2 = JOB.indexOf('CHECK 2');
  const check3 = JOB.indexOf('CHECK 3');
  assert.ok(check1 !== -1 && check2 !== -1 && check3 !== -1, 'CHECK markers present');
  assert.ok(check1 < check2 && check2 < check3, 'checks appear in order 1, 2, 3');
  // The name lookup reads the newest EXISTING snapshot; writing today's
  // snapshot first would replace it with a copy missing the dropped rows.
  const lookup = JOB.indexOf('_integrityLookupNames(');
  const write = JOB.indexOf('_integrityWriteSnapshot(');
  assert.ok(lookup !== -1 && write !== -1 && lookup < write,
    'name lookup must precede the snapshot write');
});

test('sentinel state: persisted at end of run, only off a successful Clients read', () => {
  const persistIdx = JOB.indexOf('INTEGRITY_PROP_LAST_COUNT, String(clients.length)');
  assert.ok(persistIdx !== -1, 'stored count updated');
  assert.ok(persistIdx > JOB.indexOf('CHECK 3'), 'state persisted after all checks');
  assert.ok(JOB.slice(0, persistIdx).lastIndexOf('if (clientsReadOk)') !== -1,
    'persist is gated on clientsReadOk');
  assert.ok(JOB.includes('INTEGRITY_PROP_LAST_IDS, JSON.stringify(currentIds)'));
  assert.ok(JOB.includes('INTEGRITY_PROP_LAST_RUN'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards: alerting, trigger installer, config
// ─────────────────────────────────────────────────────────────────────────────

test('alerting: fail-open — missing ALERT_EMAIL logs and returns, send failure is caught', () => {
  const src = gsFunction('_integritySendAlert');
  assert.ok(src.includes("'ALERT_EMAIL'") || src.includes('INTEGRITY_PROP_ALERT_EMAIL'));
  assert.ok(src.includes('if (!email)'), 'missing property branch exists');
  assert.ok(src.includes('Logger.log'), 'falls back to Logger.log');
  assert.ok(src.includes('MailApp.sendEmail'), 'sends via MailApp');
  assert.ok(/catch\s*\(err\)\s*\{[\s\S]*Logger\.log/.test(src), 'send failure caught, never thrown');
  assert.ok(!src.includes('throw '), 'never throws');
  // One email per run, only on problems: the job gates the send.
  assert.ok(JOB.includes('if (missing.length || orphans.length || errors.length)'));
});

test('alert subject is the Hebrew mismatch subject', () => {
  assert.ok(GS.includes("var INTEGRITY_ALERT_SUBJECT    = '⚠️ E-ZONE: אי-התאמה בנתוני מטופלים';"));
});

test('setupIntegrityTrigger: idempotent (delete same-handler triggers first), daily @ 02:00', () => {
  const src = gsFunction('setupIntegrityTrigger');
  assert.ok(src.includes("getHandlerFunction() === 'nightlyIntegrityJob'"));
  const del = src.indexOf('ScriptApp.deleteTrigger');
  const create = src.indexOf('ScriptApp.newTrigger');
  assert.ok(del !== -1 && create !== -1 && del < create, 'deletes existing before creating');
  assert.ok(src.includes(".newTrigger('nightlyIntegrityJob')"));
  assert.ok(src.includes('.everyDays(1)'));
  assert.ok(src.includes('.atHour(2)'));
});

test('Script Property keys are pinned', () => {
  assert.ok(GS.includes("var INTEGRITY_PROP_LAST_COUNT  = 'INTEGRITY_LAST_COUNT';"));
  assert.ok(GS.includes("var INTEGRITY_PROP_LAST_IDS    = 'INTEGRITY_LAST_IDS';"));
  assert.ok(GS.includes("var INTEGRITY_PROP_LAST_RUN    = 'INTEGRITY_LAST_RUN';"));
  assert.ok(GS.includes("var INTEGRITY_PROP_BACKUP_SSID = 'INTEGRITY_BACKUP_SSID';"));
  assert.ok(GS.includes("var INTEGRITY_PROP_ALERT_EMAIL = 'ALERT_EMAIL';"));
  assert.ok(GS.includes("var INTEGRITY_BACKUP_NAME      = 'EZONE-Backups';"));
});

test('CLIENTS_HEADERS: append-only tail — paymentAmountOverrides then the who/when stamps', () => {
  const headers = gsHeaders('CLIENTS_HEADERS');
  assert.equal(headers[0], 'id');
  assert.deepEqual(headers.slice(-3), ['paymentAmountOverrides', 'updatedAt', 'updatedBy']);
  assert.equal(headers.length, 36);
});

test('project timezone is Asia/Jerusalem (atHour(2) + snapshot date rolls depend on it)', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'appsscript.json'), 'utf8')
  );
  assert.equal(manifest.timeZone, 'Asia/Jerusalem');
});
