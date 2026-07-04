'use strict';

/**
 * Coverage for the createLead inbound write endpoint (apps-script/Code.gs).
 *
 * The real handler runs inside Apps Script and cannot be imported, so — exactly
 * as test/stop-flag-match.test.js does for _matchStopFlagClient — the pure
 * logic is mirrored here and any change must update both. A source-guard at the
 * bottom asserts the Code.gs implementation still matches this contract (the
 * fail-closed auth, the CREATE_LEAD_SECRET property, the stage-'new' lead, and
 * the LEADS_HEADERS row shape).
 *
 * Contract under test (what the Dashboard POSTs):
 *   POST {exec}?action=createLead
 *   { secret, name, phone, house, note }
 *   - secret: validated against CREATE_LEAD_SECRET, FAIL-CLOSED on missing/wrong
 *   - phone : MAY be empty
 *   - house : a Dashboard houseId key, stored verbatim into house_of_origin
 *             (1:1 with the Outpatient keys; unknown keys stored as-is, never fail)
 *   - note  : free text, may be empty
 *   → { ok:true, id } on success; { ok:false, error } on failure.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// --- mirror of _recoverPhone (apps-script/Code.gs) ---
function recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  else if (s.charAt(0) !== '0') s = '0' + s;
  return s;
}

// --- mirror of _sanitizeLeadText ---
function sanitizeLeadText(v, maxLen) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// --- mirror of _mapLeadHouse (1:1 verbatim, unknown passes through) ---
function mapLeadHouse(house) {
  return String(house == null ? '' : house).trim();
}

// --- mirror of _createLeadAuthOk (fail-closed) ---
function createLeadAuthOk(expectedSecret, params) {
  if (!expectedSecret) return false; // not configured -> reject
  const got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expectedSecret;
}

// --- mirror of doPost createLead block + _createLead, writing into a fake
//     in-memory Leads sheet so "writes a row" / "no write" are observable. ---
const LEADS_HEADERS = [
  'id', 'name', 'phone', 'serviceType', 'location', 'note',
  'stage', 'sessionsPerWeek', 'pricePerSession', 'startDate', 'created', 'introDateTime',
  'house_of_origin', 'not_relevant_reason', 'not_relevant_note',
  // assignedTo (משוייך ל) is appended on the volta line and kept in the union;
  // the mirror must track Code.gs's LEADS_HEADERS.
  'assignedTo'
];

function createLead(sheet, expectedSecret, payload, today) {
  // auth first (fail-closed) — no row is written when it fails
  const params = { secret: payload && payload.secret };
  if (!createLeadAuthOk(expectedSecret, params)) {
    return { ok: false, error: 'unauthorized' };
  }
  const name = sanitizeLeadText(payload && payload.name, 200);
  if (!name) return { ok: false, error: 'missing_name' };
  const phone = recoverPhone(payload && payload.phone);
  const note = sanitizeLeadText(payload && payload.note, 2000);
  const house = mapLeadHouse(payload && payload.house);
  const lead = {
    id: 'id_test_' + (sheet.length + 1),
    name, phone, serviceType: '', location: '', note,
    stage: 'new', sessionsPerWeek: '', pricePerSession: '', startDate: '',
    created: today, introDateTime: '',
    house_of_origin: house, not_relevant_reason: '', not_relevant_note: ''
  };
  sheet.push(LEADS_HEADERS.map(h => (lead[h] == null ? '' : lead[h])));
  return { ok: true, id: lead.id };
}

const SECRET = 's3cr3t-create-lead';
const TODAY = '2026-06-28';
const col = name => LEADS_HEADERS.indexOf(name);

test('valid createLead writes a correct, brand-new lead row', () => {
  const sheet = [];
  const res = createLead(sheet, SECRET, {
    secret: SECRET, name: 'דנה כהן', phone: '054-312-3276',
    house: 'efroni', note: 'שוחרר לטיפול חוץ · ממשיך מעקב'
  }, TODAY);

  assert.equal(res.ok, true);
  assert.ok(res.id, 'returns an id');
  assert.equal(sheet.length, 1, 'exactly one row written');

  const row = sheet[0];
  assert.equal(row[col('name')], 'דנה כהן');
  assert.equal(row[col('phone')], '0543123276');        // normalized, leading zero
  assert.equal(row[col('house_of_origin')], 'efroni');  // verbatim
  assert.equal(row[col('note')], 'שוחרר לטיפול חוץ · ממשיך מעקב');
  assert.equal(row[col('stage')], 'new');               // first kanban stage
  assert.equal(row[col('created')], TODAY);             // created = today
  assert.equal(row[col('id')], res.id);
  // brand-new lead has empty activation fields
  ['serviceType', 'location', 'sessionsPerWeek', 'pricePerSession', 'startDate',
   'introDateTime', 'not_relevant_reason', 'not_relevant_note']
    .forEach(k => assert.equal(row[col(k)], '', k + ' must start empty'));
});

test('missing secret fails closed with NO write', () => {
  const sheet = [];
  const res = createLead(sheet, SECRET, { name: 'X', house: 'ramot' }, TODAY);
  assert.deepEqual(res, { ok: false, error: 'unauthorized' });
  assert.equal(sheet.length, 0, 'no row written on missing secret');
});

test('wrong / empty secret fails closed with NO write', () => {
  const sheet = [];
  assert.equal(createLead(sheet, SECRET, { secret: 'nope', name: 'X' }, TODAY).error, 'unauthorized');
  assert.equal(createLead(sheet, SECRET, { secret: '', name: 'X' }, TODAY).error, 'unauthorized');
  assert.equal(sheet.length, 0, 'no rows written on bad secret');
});

test('unset CREATE_LEAD_SECRET rejects every request (fail-closed, never open)', () => {
  const sheet = [];
  const res = createLead(sheet, '', { secret: 'anything', name: 'X' }, TODAY);
  assert.deepEqual(res, { ok: false, error: 'unauthorized' });
  assert.equal(sheet.length, 0);
});

test('empty phone is accepted and stored as empty', () => {
  const sheet = [];
  const res = createLead(sheet, SECRET, {
    secret: SECRET, name: 'מטופל ללא טלפון', phone: '', house: 'external', note: ''
  }, TODAY);
  assert.equal(res.ok, true);
  assert.equal(sheet[0][col('phone')], '');             // empty stays empty
  assert.equal(sheet[0][col('name')], 'מטופל ללא טלפון');
});

test('missing phone field entirely is also accepted', () => {
  const sheet = [];
  const res = createLead(sheet, SECRET, { secret: SECRET, name: 'A', house: 'raanana' }, TODAY);
  assert.equal(res.ok, true);
  assert.equal(sheet[0][col('phone')], '');
});

test('an unmapped/unknown house key still creates the lead (stored as-is)', () => {
  const sheet = [];
  const res = createLead(sheet, SECRET, {
    secret: SECRET, name: 'B', phone: '', house: 'some_new_house', note: ''
  }, TODAY);
  assert.equal(res.ok, true, 'write must not fail on an unmapped house');
  assert.equal(sheet[0][col('house_of_origin')], 'some_new_house');
});

test('blank name is rejected after auth passes (no row)', () => {
  const sheet = [];
  const res = createLead(sheet, SECRET, { secret: SECRET, name: '   ', house: 'ramot' }, TODAY);
  assert.deepEqual(res, { ok: false, error: 'missing_name' });
  assert.equal(sheet.length, 0);
});

test('all five known Dashboard house keys map 1:1 verbatim', () => {
  ['raanana', 'ramot', 'efroni', 'rehab', 'external'].forEach(k => {
    const sheet = [];
    createLead(sheet, SECRET, { secret: SECRET, name: 'N', house: k }, TODAY);
    assert.equal(sheet[0][col('house_of_origin')], k);
  });
});

// --- source-guard: the real Code.gs still matches this contract ---
const SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

test('source: createLead is routed in doPost', () => {
  assert.match(SRC, /action === 'createLead'/, 'createLead action must be routed');
  assert.match(SRC, /return _json\(_createLead\(payload\)\);/);
});

test('source: auth is fail-closed and reads CREATE_LEAD_SECRET from Script Properties only', () => {
  const m = SRC.match(/function _createLeadAuthOk\(params\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_createLeadAuthOk not found');
  const fn = m[0];
  assert.match(fn, /getScriptProperties\(\)\.getProperty\('CREATE_LEAD_SECRET'\)/);
  assert.match(fn, /if \(!expected\) return false;/, 'must fail closed when unset');
  assert.match(fn, /got !== '' && got === expected/, 'must reject empty/wrong secret');
});

test('source: the new lead uses stage "new" and created = today', () => {
  const m = SRC.match(/function _createLead\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_createLead not found');
  const fn = m[0];
  assert.match(fn, /stage: 'new'/);
  assert.match(fn, /created: Utilities\.formatDate\(/);
  assert.match(fn, /appendRow/, 'must append a single row, not rewrite the sheet');
});

test('source: secret is never logged', () => {
  // No Logger.log / console.log anywhere in the createLead region should echo a secret.
  const region = SRC.slice(SRC.indexOf('Create lead (inbound'), SRC.indexOf('Merge duplicate clients'));
  assert.doesNotMatch(region, /Logger\.log[\s\S]*secret/i, 'secret must never be logged');
});

test('source: mirror lead keys equal LEADS_HEADERS in Code.gs (row shape in sync)', () => {
  const m = SRC.match(/var LEADS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'LEADS_HEADERS not found');
  const cols = m[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  assert.deepEqual(cols, LEADS_HEADERS, 'test mirror must track LEADS_HEADERS');
});
