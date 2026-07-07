'use strict';

/**
 * Coverage for the stop-treatment ALERTS feature.
 *
 * The OUTPATIENT app CREATES an alert (internal write) when Vered hits
 * "הודעת עצירת טיפול" on an unpaid patient; the E-Zone THERAPISTS app READS them
 * in its new "עצירת טיפול" tab and marks each one 'read' after Yarden acts. Alerts
 * PERSIST at status 'unread' until explicitly marked read there.
 *
 * The real handlers run inside Apps Script and cannot be imported, so — exactly
 * like test/create-lead.test.js — the pure logic is mirrored here against an
 * in-memory sheet, and source-guards at the bottom lock the real Code.gs and
 * public/app.js so the mirror can never silently drift.
 *
 * Contract under test:
 *   POST ?action=createStopAlert  { clientId, clientName, createdBy?, note? }
 *     - INTERNAL, same auth level as saveAll (NO secret)
 *     - appends one row: id 'stop-<uuid>', status 'unread', createdAt ISO
 *   GET  ?action=getStopAlerts       — fail-closed behind STOP_ALERTS_SECRET
 *   POST ?action=markStopAlertRead   — fail-closed behind STOP_ALERTS_SECRET;
 *                                       single-row update by id → 'read' + readAt
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// --- mirror of STOP_ALERTS_HEADERS (apps-script/Code.gs) — 'type' then 'cancelledAt' appended last ---
const STOP_ALERTS_HEADERS = [
  'id', 'clientId', 'clientName', 'createdAt', 'createdBy', 'status', 'readAt', 'note', 'reason', 'type', 'cancelledAt'
];
const col = (name) => STOP_ALERTS_HEADERS.indexOf(name);

// --- mirror of STOP_ALERT_REASONS (allowed set; fail-closed) ---
const STOP_ALERT_REASONS = { no_payment: true, mismatch: true, other: true };

// --- mirror of _createStopAlert writing into an in-memory sheet (row arrays) ---
let uuidSeq = 0;
function createStopAlert(sheet, payload, nowISO) {
  const clientId = String((payload && payload.clientId) || '').trim();
  const clientName = String((payload && payload.clientName) || '').trim();
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  if (!clientName) return { ok: false, error: 'missing_client_name' };
  const reason = String((payload && payload.reason) || '').trim();
  if (!STOP_ALERT_REASONS[reason]) return { ok: false, error: 'invalid_reason' };
  const alert = {
    id: 'stop-' + 'uuid' + (++uuidSeq),
    clientId,
    clientName,
    createdAt: nowISO,
    createdBy: String((payload && payload.createdBy) || '').trim(),
    status: 'unread',
    readAt: '',
    note: String((payload && payload.note) || '').trim().slice(0, 1000),
    reason,
    type: 'stop',
    cancelledAt: ''
  };
  sheet.push(STOP_ALERTS_HEADERS.map((h) => (alert[h] == null ? '' : alert[h])));
  return { ok: true, alert };
}

// --- mirror of _stopAlertsAuthOk (fail-closed, SESSION_OUTCOME_SECRET pattern) ---
function stopAlertsAuthOk(expectedSecret, params) {
  if (!expectedSecret) return false; // not configured -> reject
  const got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expectedSecret;
}

// --- mirror of _markStopAlertRead (single-row update by id) ---
function markStopAlertRead(sheet, payload, nowISO) {
  const id = String((payload && payload.id) || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  for (let i = 0; i < sheet.length; i++) {
    if (String(sheet[i][col('id')]) === id) {
      sheet[i][col('status')] = 'read';
      sheet[i][col('readAt')] = nowISO;
      return { ok: true };
    }
  }
  return { ok: false, error: 'not_found' };
}

// --- mirror of _markStopAlertUnread (exact inverse of markStopAlertRead) ---
function markStopAlertUnread(sheet, payload) {
  const id = String((payload && payload.id) || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  for (let i = 0; i < sheet.length; i++) {
    if (String(sheet[i][col('id')]) === id) {
      sheet[i][col('status')] = 'unread';
      sheet[i][col('readAt')] = '';
      return { ok: true };
    }
  }
  return { ok: false, error: 'not_found' };
}

const NOW = '2026-07-05T09:00:00.000Z';
const SECRET = 's3cr3t-stop-alerts';

// --- createStopAlert behavior ----------------------------------------------

test('createStopAlert appends one unread row with a stop-<id>, ISO createdAt, and reason', () => {
  const sheet = [];
  const res = createStopAlert(sheet, { clientId: 'c1', clientName: 'אורי', createdBy: 'Vered', note: 'לא שילם', reason: 'no_payment' }, NOW);
  assert.equal(res.ok, true);
  assert.equal(sheet.length, 1, 'exactly one row appended');
  const row = sheet[0];
  assert.match(row[col('id')], /^stop-/, 'id is prefixed stop-');
  assert.equal(row[col('clientId')], 'c1');
  assert.equal(row[col('clientName')], 'אורי');
  assert.equal(row[col('status')], 'unread', 'new alert starts unread');
  assert.equal(row[col('createdAt')], NOW);
  assert.equal(row[col('createdBy')], 'Vered');
  assert.equal(row[col('readAt')], '', 'readAt empty until marked read');
  assert.equal(row[col('note')], 'לא שילם');
  assert.equal(row[col('reason')], 'no_payment', 'reason persisted as its stable key');
});

test('createStopAlert needs clientId and clientName (no row otherwise)', () => {
  const sheet = [];
  assert.equal(createStopAlert(sheet, { clientName: 'אורי', reason: 'no_payment' }, NOW).error, 'missing_client_id');
  assert.equal(createStopAlert(sheet, { clientId: 'c1', reason: 'no_payment' }, NOW).error, 'missing_client_name');
  assert.equal(sheet.length, 0);
});

test('createStopAlert rejects a missing or unknown reason (fail-closed, no row)', () => {
  const sheet = [];
  // missing / empty
  assert.equal(createStopAlert(sheet, { clientId: 'c1', clientName: 'א' }, NOW).error, 'invalid_reason');
  assert.equal(createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: '' }, NOW).error, 'invalid_reason');
  // unknown key
  assert.equal(createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: 'whatever' }, NOW).error, 'invalid_reason');
  assert.equal(sheet.length, 0, 'nothing written for an invalid reason');
  // every allowed key is accepted
  ['no_payment', 'mismatch', 'other'].forEach((r) => {
    assert.equal(createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: r }, NOW).ok, true);
  });
  assert.equal(sheet.length, 3);
});

test('createStopAlert note is optional and caps at 1000 chars', () => {
  const sheet = [];
  const r1 = createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: 'other' }, NOW);
  assert.equal(r1.ok, true);
  assert.equal(sheet[0][col('note')], '');
  createStopAlert(sheet, { clientId: 'c2', clientName: 'ב', reason: 'other', note: 'x'.repeat(2000) }, NOW);
  assert.equal(sheet[1][col('note')].length, 1000);
});

test('legacy pre-reason rows (shorter than the header) read the appended columns as empty strings', () => {
  // A row written before 'reason'/'type'/'cancelledAt' existed has only the first
  // 8 cells; Sheets pads the requested headers.length columns with '' — the read
  // path must tolerate it (a legacy '' type is treated as 'stop' downstream).
  const legacyRow = ['stop-old', 'c9', 'דנה', NOW, 'Vered', 'unread', '', 'הערה ישנה'];
  assert.equal(legacyRow.length, STOP_ALERTS_HEADERS.length - 3, 'legacy row is three cells short (reason/type/cancelledAt)');
  const padded = STOP_ALERTS_HEADERS.map((h, i) => (i < legacyRow.length ? legacyRow[i] : ''));
  assert.equal(padded[col('reason')], '', 'missing trailing reason reads as empty');
  assert.equal(padded[col('type')], '', 'missing trailing type reads as empty (→ treated as stop)');
  assert.equal(padded[col('cancelledAt')], '', 'missing trailing cancelledAt reads as empty');
  assert.equal(padded[col('note')], 'הערה ישנה', 'earlier columns keep their index');
});

// --- markStopAlertRead behavior --------------------------------------------

test('markStopAlertRead flips the matching row to read + stamps readAt, only that row', () => {
  const sheet = [];
  const a = createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: 'no_payment' }, NOW).alert;
  createStopAlert(sheet, { clientId: 'c2', clientName: 'ב', reason: 'mismatch' }, NOW);
  const res = markStopAlertRead(sheet, { id: a.id }, '2026-07-06T00:00:00.000Z');
  assert.equal(res.ok, true);
  assert.equal(sheet[0][col('status')], 'read');
  assert.equal(sheet[0][col('readAt')], '2026-07-06T00:00:00.000Z');
  assert.equal(sheet[1][col('status')], 'unread', 'the other alert is untouched');
});

test('markStopAlertRead needs an id and reports not_found for an unknown id', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: 'other' }, NOW);
  assert.equal(markStopAlertRead(sheet, {}, NOW).error, 'missing_id');
  assert.equal(markStopAlertRead(sheet, { id: 'stop-nope' }, NOW).error, 'not_found');
});

// --- markStopAlertUnread behavior (exact inverse of markStopAlertRead) -------

test('markStopAlertUnread flips the matching row back to unread + clears readAt, only that row', () => {
  const sheet = [];
  const a = createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: 'no_payment' }, NOW).alert;
  createStopAlert(sheet, { clientId: 'c2', clientName: 'ב', reason: 'mismatch' }, NOW);
  // first read both, then reopen only the first
  markStopAlertRead(sheet, { id: a.id }, '2026-07-06T00:00:00.000Z');
  const bId = sheet[1][col('id')];
  markStopAlertRead(sheet, { id: bId }, '2026-07-06T00:00:00.000Z');
  const res = markStopAlertUnread(sheet, { id: a.id });
  assert.equal(res.ok, true);
  assert.equal(sheet[0][col('status')], 'unread', 'reopened row is unread again');
  assert.equal(sheet[0][col('readAt')], '', 'readAt cleared');
  assert.equal(sheet[1][col('status')], 'read', 'the other alert is untouched');
  assert.equal(sheet[1][col('readAt')], '2026-07-06T00:00:00.000Z', 'the other readAt is untouched');
});

test('markStopAlertUnread needs an id and reports not_found for an unknown id', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'א', reason: 'other' }, NOW);
  assert.equal(markStopAlertUnread(sheet, {}).error, 'missing_id');
  assert.equal(markStopAlertUnread(sheet, { id: 'stop-nope' }).error, 'not_found');
});

// --- secret (fail-closed) on the two cross-app endpoints --------------------

test('getStopAlerts / markStopAlertRead auth is fail-closed', () => {
  // configured secret: only an exact match passes
  assert.equal(stopAlertsAuthOk(SECRET, { secret: SECRET }), true);
  assert.equal(stopAlertsAuthOk(SECRET, { secret: 'nope' }), false);
  assert.equal(stopAlertsAuthOk(SECRET, { secret: '' }), false);
  assert.equal(stopAlertsAuthOk(SECRET, {}), false);
  // unset property -> reject EVERY request (never open)
  assert.equal(stopAlertsAuthOk('', { secret: 'anything' }), false);
  assert.equal(stopAlertsAuthOk(undefined, { secret: SECRET }), false);
});

// ===========================================================================
// Source-guards: the real Code.gs still matches this contract.
// ===========================================================================
const SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

test('source: STOP_ALERTS_HEADERS exact order matches the mirror, type then cancelledAt LAST', () => {
  const m = SRC.match(/var STOP_ALERTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'STOP_ALERTS_HEADERS not found');
  const cols = m[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(cols, STOP_ALERTS_HEADERS);
  assert.equal(cols[cols.length - 2], 'type', "'type' must be the second-to-last (appended) header");
  assert.equal(cols[cols.length - 1], 'cancelledAt', "'cancelledAt' must be the LAST (appended) header");
});

test('source: STOP_ALERT_REASONS is exactly the allowed set', () => {
  const m = SRC.match(/var STOP_ALERT_REASONS = \{([\s\S]*?)\};/);
  assert.ok(m, 'STOP_ALERT_REASONS not found');
  const keys = (m[1].match(/(\w+)\s*:/g) || []).map((s) => s.replace(/\s*:$/, ''));
  assert.deepEqual(keys.sort(), Object.keys(STOP_ALERT_REASONS).sort());
});

test('source: createStopAlert is INTERNAL (routed with no secret) and appends one stop-<uuid> row', () => {
  // routed in doPost with no auth gate (same trust level as saveAll)
  assert.match(SRC, /if \(action === 'createStopAlert'\) \{\s*[\s\S]*?return _json\(_createStopAlert\(payload\)\);/);
  const m = SRC.match(/function _createStopAlert\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_createStopAlert not found');
  const fn = m[0];
  assert.match(fn, /LockService\.getScriptLock\(\)/, 'createStopAlert must take a lock');
  assert.match(fn, /'stop-' \+ Utilities\.getUuid\(\)/, "id must be 'stop-<uuid>'");
  assert.match(fn, /status: 'unread'/, 'new alert must be unread');
  assert.match(fn, /new Date\(\)\.toISOString\(\)/, 'createdAt must be ISO');
  assert.match(fn, /appendRow/, 'must append a single row');
  assert.doesNotMatch(fn, /STOP_ALERTS_SECRET/, 'createStopAlert must NOT require the secret');
  // reason is required + fail-closed on the allowed set, and persisted on the row
  assert.match(fn, /if \(!STOP_ALERT_REASONS\[reason\]\) return \{ ok: false, error: 'invalid_reason' \};/, 'must reject an invalid reason');
  assert.match(fn, /reason: reason/, 'must persist the reason on the appended alert');
  // two-way flow: createStopAlert stamps type 'stop' explicitly
  assert.match(fn, /type: 'stop'/, "must write type 'stop'");
});

test('source: _stopAlertsAuthOk is fail-closed and reads STOP_ALERTS_SECRET from Script Properties only', () => {
  const m = SRC.match(/function _stopAlertsAuthOk\(params\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_stopAlertsAuthOk not found');
  const fn = m[0];
  assert.match(fn, /getScriptProperties\(\)\.getProperty\('STOP_ALERTS_SECRET'\)/);
  assert.match(fn, /if \(!expected\) return false;/, 'must fail closed when unset');
  assert.match(fn, /got !== '' && got === expected/, 'must reject empty/wrong secret');
});

test('source: BOTH getStopAlerts and markStopAlertRead gate on _stopAlertsAuthOk', () => {
  // getStopAlerts in doGet
  assert.match(SRC, /action === 'getStopAlerts'\)\s*\{\s*if \(!_stopAlertsAuthOk\(e && e\.parameter\)\)/);
  // getStopAlerts in doPost
  assert.match(SRC, /if \(action === 'getStopAlerts'\) \{[\s\S]*?if \(!_stopAlertsAuthOk\(gsaParams\)\)/);
  // markStopAlertRead in doPost
  assert.match(SRC, /if \(action === 'markStopAlertRead'\) \{[\s\S]*?if \(!_stopAlertsAuthOk\(msaParams\)\)[\s\S]*?return _json\(_markStopAlertRead\(payload\)\);/);
});

test('source: markStopAlertRead takes a lock and updates a single row by id in place', () => {
  const m = SRC.match(/function _markStopAlertRead\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_markStopAlertRead not found');
  const fn = m[0];
  assert.match(fn, /LockService\.getScriptLock\(\)/, 'markStopAlertRead must take a lock');
  assert.match(fn, /\.setValue\('read'\)/, "must set status 'read'");
  assert.match(fn, /readAtIdx \+ 1\)\.setValue\(new Date\(\)\.toISOString\(\)\)/, 'must stamp readAt');
  assert.doesNotMatch(fn, /_writeAll/, 'must not rewrite the whole sheet');
});

test('source: markStopAlertUnread is routed in doPost and gated on _stopAlertsAuthOk (mirrors markStopAlertRead)', () => {
  assert.match(SRC, /if \(action === 'markStopAlertUnread'\) \{[\s\S]*?if \(!_stopAlertsAuthOk\(msuParams\)\)[\s\S]*?return _json\(_markStopAlertUnread\(payload\)\);/);
});

test('source: markStopAlertUnread takes a lock and reopens a single row by id in place (readAt cleared)', () => {
  const m = SRC.match(/function _markStopAlertUnread\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_markStopAlertUnread not found');
  const fn = m[0];
  assert.match(fn, /if \(!id\) return \{ ok: false, error: 'missing_id' \};/, 'must require an id');
  assert.match(fn, /LockService\.getScriptLock\(\)/, 'markStopAlertUnread must take a lock');
  assert.match(fn, /\.setValue\('unread'\)/, "must set status back to 'unread'");
  assert.match(fn, /readAtIdx \+ 1\)\.setValue\(''\)/, 'must clear readAt');
  assert.match(fn, /return \{ ok: false, error: 'not_found' \};/, 'must report not_found for an unknown id');
  assert.doesNotMatch(fn, /_writeAll/, 'must not rewrite the whole sheet');
});

// ===========================================================================
// Frontend wiring guard: the button CREATES an alert, no WhatsApp link.
// ===========================================================================
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('wiring: the overdue-panel button dispatches stop-alert (not a wa- action)', () => {
  assert.match(APP, /data-action="stop-alert">🛑 הודעת עצירת טיפול/);
  assert.match(APP, /action === 'stop-alert'\) \{\s*sendStopAlert\(c\);/);
});

test('wiring: the reason label map uses the stable keys + Hebrew labels', () => {
  const m = APP.match(/var STOP_ALERT_REASON_LABELS = \{([\s\S]*?)\};/);
  assert.ok(m, 'STOP_ALERT_REASON_LABELS not found');
  const body = m[1];
  assert.match(body, /no_payment:\s*'חוסר תשלום'/);
  assert.match(body, /mismatch:\s*'אי התאמה'/);
  assert.match(body, /other:\s*'אחר'/);
});

test('wiring: the confirm modal has a REQUIRED reason select with the stable keys', () => {
  // the select exists, is required, and has an empty '—' default above the note
  const m = HTML.match(/<select name="stop_reason" id="stopAlertReason" required>([\s\S]*?)<\/select>/);
  assert.ok(m, 'stop_reason select not found or not required');
  const opts = m[1];
  assert.match(opts, /<option value="">—<\/option>/, 'empty — default option');
  assert.match(opts, /<option value="no_payment">/);
  assert.match(opts, /<option value="mismatch">/);
  assert.match(opts, /<option value="other">/);
  // the note textarea and the "other" hint both live in the same modal
  assert.match(HTML, /id="stopAlertNote"/, 'optional note textarea present');
  assert.match(HTML, /id="stopAlertOtherHint"/, 'other-reason hint present');
  // save starts disabled (no reason chosen yet)
  assert.match(HTML, /id="stopAlertSubmit"[^>]*disabled/, 'save disabled until a reason is chosen');
});

test('wiring: reason select gates save + focuses the note on "other"', () => {
  // save enabled only for a valid reason key
  assert.match(APP, /submit\.disabled = !STOP_ALERT_REASON_LABELS\[reason\];/);
  // choosing 'other' reveals the hint and focuses the note
  assert.match(APP, /if \(reason === 'other'\) \{[\s\S]*?note\.focus\(\);/);
});

test('wiring: the form submit validates the reason and posts it in the payload', () => {
  const m = APP.match(/if \(saForm\) saForm\.addEventListener\('submit', function \(e\) \{[\s\S]*?\n    \}\);/);
  assert.ok(m, 'stopAlertForm submit handler not found');
  const fn = m[0];
  assert.match(fn, /if \(!STOP_ALERT_REASON_LABELS\[reason\]\) \{ toast\(/, 'required-reason guard toasts');
  assert.match(fn, /submitStopAlert\(reason, note\)/, 'passes the reason through');
});

test('wiring: submitStopAlert CREATES a stop alert with reason — no wa-link, no treatmentContactPhone read', () => {
  const m = APP.match(/function submitStopAlert\(reason, note\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(m, 'submitStopAlert not found');
  const fn = m[0];
  assert.match(fn, /apiPostAction\('createStopAlert'/, 'must call createStopAlert');
  assert.match(fn, /reason: reason/, 'payload must include the reason');
  assert.match(fn, /toast\('נשלחה התראת עצירה לירדן'\)/, 'success toast');
  // optimistic push + rollback splice on state.myStopAlerts (type 'stop')
  assert.match(fn, /state\.myStopAlerts\.push\(/, 'optimistic push');
  assert.match(fn, /state\.myStopAlerts\.splice\(/, 'rollback on failure');
  assert.match(fn, /type: 'stop'/, 'optimistic row is a stop-type row');
  // the flow must NOT read the treatment contact phone or open WhatsApp
  assert.doesNotMatch(fn, /treatmentContactPhone/, 'stop-alert flow must not read treatmentContactPhone');
  assert.doesNotMatch(fn, /openWhatsApp|wa\.me/, 'stop-alert flow must not build a WhatsApp link');
});

test('wiring: the duplicate guard checks whether a stop alert is already standing', () => {
  const m = APP.match(/function openStopAlertModal\(c\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(m, 'openStopAlertModal not found');
  // The guard now delegates to stopAlertStanding (shared with the row's chip),
  // which is where the unread/read check lives.
  assert.match(m[0], /stopAlertStanding\(c\.id\)/, 'guard delegates to stopAlertStanding');
  const h = APP.match(/function stopAlertStanding\(clientId\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(h, 'stopAlertStanding not found');
  assert.match(h[0], /a\.status === 'unread' \|\| a\.status === 'read'/, 'standing = latest stop is unread or read');
});
