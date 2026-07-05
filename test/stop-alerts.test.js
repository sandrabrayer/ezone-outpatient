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

// --- mirror of STOP_ALERTS_HEADERS (apps-script/Code.gs) ---
const STOP_ALERTS_HEADERS = [
  'id', 'clientId', 'clientName', 'createdAt', 'createdBy', 'status', 'readAt', 'note'
];
const col = (name) => STOP_ALERTS_HEADERS.indexOf(name);

// --- mirror of _createStopAlert writing into an in-memory sheet (row arrays) ---
let uuidSeq = 0;
function createStopAlert(sheet, payload, nowISO) {
  const clientId = String((payload && payload.clientId) || '').trim();
  const clientName = String((payload && payload.clientName) || '').trim();
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  if (!clientName) return { ok: false, error: 'missing_client_name' };
  const alert = {
    id: 'stop-' + 'uuid' + (++uuidSeq),
    clientId,
    clientName,
    createdAt: nowISO,
    createdBy: String((payload && payload.createdBy) || '').trim(),
    status: 'unread',
    readAt: '',
    note: String((payload && payload.note) || '').trim().slice(0, 1000)
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

const NOW = '2026-07-05T09:00:00.000Z';
const SECRET = 's3cr3t-stop-alerts';

// --- createStopAlert behavior ----------------------------------------------

test('createStopAlert appends one unread row with a stop-<id> and ISO createdAt', () => {
  const sheet = [];
  const res = createStopAlert(sheet, { clientId: 'c1', clientName: 'אורי', createdBy: 'Vered', note: 'לא שילם' }, NOW);
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
});

test('createStopAlert needs clientId and clientName (no row otherwise)', () => {
  const sheet = [];
  assert.equal(createStopAlert(sheet, { clientName: 'אורי' }, NOW).error, 'missing_client_id');
  assert.equal(createStopAlert(sheet, { clientId: 'c1' }, NOW).error, 'missing_client_name');
  assert.equal(sheet.length, 0);
});

test('createStopAlert note is optional and caps at 1000 chars', () => {
  const sheet = [];
  const r1 = createStopAlert(sheet, { clientId: 'c1', clientName: 'א' }, NOW);
  assert.equal(r1.ok, true);
  assert.equal(sheet[0][col('note')], '');
  createStopAlert(sheet, { clientId: 'c2', clientName: 'ב', note: 'x'.repeat(2000) }, NOW);
  assert.equal(sheet[1][col('note')].length, 1000);
});

// --- markStopAlertRead behavior --------------------------------------------

test('markStopAlertRead flips the matching row to read + stamps readAt, only that row', () => {
  const sheet = [];
  const a = createStopAlert(sheet, { clientId: 'c1', clientName: 'א' }, NOW).alert;
  createStopAlert(sheet, { clientId: 'c2', clientName: 'ב' }, NOW);
  const res = markStopAlertRead(sheet, { id: a.id }, '2026-07-06T00:00:00.000Z');
  assert.equal(res.ok, true);
  assert.equal(sheet[0][col('status')], 'read');
  assert.equal(sheet[0][col('readAt')], '2026-07-06T00:00:00.000Z');
  assert.equal(sheet[1][col('status')], 'unread', 'the other alert is untouched');
});

test('markStopAlertRead needs an id and reports not_found for an unknown id', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'א' }, NOW);
  assert.equal(markStopAlertRead(sheet, {}, NOW).error, 'missing_id');
  assert.equal(markStopAlertRead(sheet, { id: 'stop-nope' }, NOW).error, 'not_found');
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

test('source: STOP_ALERTS_HEADERS exact order matches the mirror', () => {
  const m = SRC.match(/var STOP_ALERTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'STOP_ALERTS_HEADERS not found');
  const cols = m[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(cols, STOP_ALERTS_HEADERS);
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

// ===========================================================================
// Frontend wiring guard: the button CREATES an alert, no WhatsApp link.
// ===========================================================================
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('wiring: the overdue-panel button dispatches stop-alert (not a wa- action)', () => {
  assert.match(APP, /data-action="stop-alert">🛑 הודעת עצירת טיפול/);
  assert.match(APP, /action === 'stop-alert'\) \{\s*sendStopAlert\(c\);/);
});

test('wiring: sendStopAlert CREATES a stop alert — no wa-link, no treatmentContactPhone read', () => {
  const m = APP.match(/function sendStopAlert\(c\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(m, 'sendStopAlert not found');
  const fn = m[0];
  assert.match(fn, /apiPostAction\('createStopAlert'/, 'must call createStopAlert');
  assert.match(fn, /confirm\(/, 'must confirm before sending');
  assert.match(fn, /toast\('נשלחה התראת עצירה לירדן'\)/, 'success toast');
  // optimistic push + rollback splice on state.stopAlerts
  assert.match(fn, /state\.stopAlerts\.push\(/, 'optimistic push');
  assert.match(fn, /state\.stopAlerts\.splice\(/, 'rollback on failure');
  // duplicate guard
  assert.match(fn, /status === 'unread'/, 'checks for an existing pending alert');
  // the flow must NOT read the treatment contact phone or open WhatsApp
  assert.doesNotMatch(fn, /treatmentContactPhone/, 'stop-alert flow must not read treatmentContactPhone');
  assert.doesNotMatch(fn, /openWhatsApp|wa\.me/, 'stop-alert flow must not build a WhatsApp link');
});
