'use strict';

/* OP-ID-2 — Node side.
 *   lib/continuation-identity.js (pure): exact-id resolution, fail-closed
 *   0 / >1 matches, feed-without-ids, payload builders strip browser fields.
 *   server.js (real app, mocked upstreams): saveContinuation overwrites PII /
 *   identity from the server-held roster and drops trust / link / owner /
 *   source fields; createContinuationLead is forbidden on /api/sheets;
 *   /api/continuation/to-outpatient = resolve -> create/link -> save with the
 *   observed link; possible_duplicate saves no outcome; a failed second write
 *   reports continuation_link_save_failed and a retry is safe. */

process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31877;
const DUMMY_PIN = '424242';
const SHEETS = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
const DASH = 'https://script.example.com/macros/s/AKfycbDASH/exec';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.USER_PIN_OREN = '515151';
process.env.USER_PIN_DANA = '626262';
process.env.SHEETS_URL = SHEETS;
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
process.env.DASHBOARD_SHEETS_URL = DASH;
process.env.OCCUPANCY_SECRET = 'occupancy-fixture-secret';

const CI = require('../lib/continuation-identity');

// ---- mocked upstreams ------------------------------------------------------
const roster = { patients: [
  { sourceApp: 'ezone-dashboard', id: 'id-stay-1', personId: 'id-root', name: 'דנה כהן', phone: '0501234567', house: 'ramot', entryDate: '2026-10-01' },
  { sourceApp: 'ezone-dashboard', id: 'id-stay-2', personId: '', name: 'משה לוי', phone: '0502222222', house: 'asher', entryDate: '2026-09-15' }
] };
const calls = [];
let rosterReply = () => ({ status: 200, body: Object.assign({ ok: true }, roster) });
let sheetsReply = (body) => ({ status: 200, body: { ok: true, echo: body } });
let rosterFetches = 0;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(DASH)) {
    rosterFetches++;
    const r = rosterReply();
    return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  }
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push(body);
  const r = sheetsReply(body);
  return { status: r.status, text: async () => JSON.stringify(r.body) };
};

const server = require('../server');
let httpServer;
test.before(() => { httpServer = server.start(TEST_PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

function request(method, urlPath, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: TEST_PORT, path: urlPath, method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {}) },
    (res) => { let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, json, headers: res.headers }); }); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
let cookie = '';
async function login() {
  for (let i = 0; i < 50; i++) { try { await request('GET', '/healthz'); break; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } }
  const res = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN, user: 'ורד' });
  assert.equal(res.status, 200);
  cookie = (res.headers['set-cookie'] || [])[0].split(';')[0];
}
const H = () => ({ Cookie: cookie });
function reset() { calls.length = 0; rosterFetches = 0; rosterReply = () => ({ status: 200, body: Object.assign({ ok: true }, roster) }); sheetsReply = (body) => ({ status: 200, body: { ok: true, echo: body } }); }

/* ---------------- pure module ---------------- */
test('lib: resolveIdentity — exact id only, fail closed on 0 / >1, feed-without-ids is a distinct error', () => {
  const ok = CI.resolveIdentity(roster.patients, 'id-stay-1');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.identity, { dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', name: 'דנה כהן', house: 'ramot', entryDate: '2026-10-01', phone: '0501234567', key: 'דנה כהן|ramot|2026-10-01' });
  assert.equal(CI.resolveIdentity(roster.patients, 'id-stay-9').error, 'continuation_patient_not_admitted');
  assert.equal(CI.resolveIdentity(roster.patients, '').error, 'continuation_identity_required');
  assert.equal(CI.resolveIdentity(roster.patients, 'id stay 1').error, 'continuation_identity_required');
  assert.equal(CI.resolveIdentity(roster.patients.concat([{ id: 'id-stay-1', name: 'אחר' }]), 'id-stay-1').error, 'continuation_identity_conflict');
  // D-ID-1 not live: no row carries an id
  assert.equal(CI.resolveIdentity([{ name: 'דנה כהן', phone: '0501234567' }], 'id-stay-1').error, 'continuation_identity_unavailable');
  // no phone/name lookup exists
  assert.equal(CI.resolveIdentity(roster.patients, '0501234567').error, 'continuation_patient_not_admitted');
});

test('lib: builders — browser controls only meetingDate/outcome/note; links only from a valid server pair', () => {
  const id = CI.resolveIdentity(roster.patients, 'id-stay-1').identity;
  const p = CI.buildSavePayload({ name: 'X', house: 'Y', entryDate: '1999', key: 'k', outpatientId: 'L', outpatientEntity: 'lead', assignedTo: 'דנה', source: 'direct', trusted: true, meetingDate: '2026-11-02', outcome: 'continuing', note: 'n', outcomeDate: '1999-01-01' }, id, null);
  assert.deepEqual(p, { action: 'saveContinuation', key: 'דנה כהן|ramot|2026-10-01', name: 'דנה כהן', house: 'ramot', entryDate: '2026-10-01', dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', meetingDate: '2026-11-02', outcome: 'continuing', note: 'n' });
  assert.equal(CI.buildSavePayload({}, id, { outpatientId: 'id_1', outpatientEntity: 'lead' }).outpatientEntity, 'lead');
  assert.equal(CI.buildSavePayload({}, id, { outpatientId: 'bad id', outpatientEntity: 'lead' }).outpatientId, undefined);
  assert.equal(CI.buildSavePayload({}, id, { outpatientId: 'id_1', outpatientEntity: 'payment' }).outpatientId, undefined);
  const c = CI.buildCreatePayload({ name: 'X', phone: '000', source: 'direct', assignedTo: 'x', meetingDate: '2026-11-02', note: 'n' }, id);
  assert.deepEqual(c, { action: 'createContinuationLead', dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', name: 'דנה כהן', phone: '0501234567', house: 'ramot', entryDate: '2026-10-01', meetingDate: '2026-11-02', note: 'n' });
});

/* ---------------- server routes ---------------- */
test('routes: saveContinuation via /api/sheets — identity + PII come from the roster, browser fields are dropped, user is the cookie', async () => {
  await login(); reset();
  const res = await request('POST', '/api/sheets', {
    action: 'saveContinuation', dashboardPatientId: 'id-stay-1',
    key: 'forged|x|y', name: 'FORGED', house: 'x', entryDate: '1999-01-01', phone: '0000',
    dashboardPersonId: 'id-forged', outpatientId: 'id_forged', outpatientEntity: 'client',
    assignedTo: 'דנה', source: 'direct', handoffSource: 'direct', linkSource: 'createContinuationLead', trusted: true,
    outcomeDate: '1999-01-01', user: 'מישהו', meetingDate: '2026-11-02', outcome: 'continuing', note: 'שלום'
  }, H());
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(calls.length, 1);
  const fwd = calls[0];
  assert.equal(fwd.action, 'saveContinuation');
  assert.equal(fwd.key, 'דנה כהן|ramot|2026-10-01');
  assert.equal(fwd.name, 'דנה כהן');
  assert.equal(fwd.house, 'ramot');
  assert.equal(fwd.entryDate, '2026-10-01');
  assert.equal(fwd.dashboardPatientId, 'id-stay-1');
  assert.equal(fwd.dashboardPersonId, 'id-root');
  assert.equal(fwd.meetingDate, '2026-11-02');
  assert.equal(fwd.outcome, 'continuing');
  assert.equal(fwd.note, 'שלום');
  assert.equal(fwd.user, 'ורד');
  assert.equal(fwd.proxySecret, process.env.OUTPATIENT_PROXY_SECRET);
  for (const k of ['phone', 'outpatientId', 'outpatientEntity', 'assignedTo', 'source', 'handoffSource', 'linkSource', 'trusted', 'outcomeDate', 'continuationKey']) {
    assert.equal(Object.prototype.hasOwnProperty.call(fwd, k), false, k + ' must not be forwarded');
  }
});

test('routes: saveContinuation fails closed — missing id 400, unknown id 404 (after one fresh re-fetch), duplicate id 409, no-id feed 409; nothing forwarded', async () => {
  reset();
  let res = await request('POST', '/api/sheets', { action: 'saveContinuation', key: 'דנה כהן|ramot|2026-10-01', name: 'דנה כהן', outcome: 'continuing' }, H());
  assert.equal(res.status, 400); assert.equal(res.json.error, 'continuation_identity_required');
  const before = rosterFetches;
  res = await request('POST', '/api/sheets', { action: 'saveContinuation', dashboardPatientId: 'id-stay-9', outcome: 'continuing' }, H());
  assert.equal(res.status, 404); assert.equal(res.json.error, 'continuation_patient_not_admitted');
  assert.ok(rosterFetches >= before + 1, 'a miss re-fetches the roster fresh once before failing closed');
  // (the roster cache is <=60s; refresh it so the changed upstream is what the server holds)
  rosterReply = () => ({ status: 200, body: { ok: true, patients: roster.patients.concat([{ id: 'id-stay-1', name: 'כפול' }]) } });
  await request('GET', '/api/continuation-roster?fresh=1', null, H());
  res = await request('POST', '/api/sheets', { action: 'saveContinuation', dashboardPatientId: 'id-stay-1', outcome: 'continuing' }, H());
  assert.equal(res.status, 409); assert.equal(res.json.error, 'continuation_identity_conflict');
  rosterReply = () => ({ status: 200, body: { ok: true, patients: [{ name: 'דנה כהן', phone: '0501234567', house: 'ramot', entryDate: '2026-10-01' }] } });
  await request('GET', '/api/continuation-roster?fresh=1', null, H());
  res = await request('POST', '/api/sheets', { action: 'saveContinuation', dashboardPatientId: 'id-stay-1', outcome: 'continuing' }, H());
  assert.equal(res.status, 409); assert.equal(res.json.error, 'continuation_identity_unavailable');
  assert.equal(calls.length, 0, 'no Apps Script write on any failure');
});

test('routes: createContinuationLead is forbidden on the /api/sheets pass-through', async () => {
  reset();
  const res = await request('POST', '/api/sheets', { action: 'createContinuationLead', dashboardPatientId: 'id-stay-1', name: 'x' }, H());
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'forbidden_action');
  assert.equal(calls.length, 0);
});

test('routes: /api/continuation/to-outpatient — resolve -> createContinuationLead -> saveContinuation with the observed link', async () => {
  reset();
  sheetsReply = (body) => body.action === 'createContinuationLead'
    ? { status: 200, body: { ok: true, id: 'id_new_lead', matched: false, entity: 'lead' } }
    : { status: 200, body: { ok: true, row: Object.assign({}, body, { updatedAt: 'x' }), created: true } };
  const res = await request('POST', '/api/continuation/to-outpatient', { dashboardPatientId: 'id-stay-1', meetingDate: '2026-11-02', note: 'n', name: 'FORGED', phone: '000', assignedTo: 'דנה', source: 'direct' }, H());
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.ok, true);
  assert.deepEqual(res.json.lead, { id: 'id_new_lead', entity: 'lead', matched: false, matchedBy: '', ownerUnmapped: false });
  assert.equal(calls.length, 2);
  const [c1, c2] = calls;
  assert.equal(c1.action, 'createContinuationLead');
  assert.equal(c1.name, 'דנה כהן'); assert.equal(c1.phone, '0501234567'); assert.equal(c1.house, 'ramot');
  assert.equal(c1.dashboardPatientId, 'id-stay-1'); assert.equal(c1.dashboardPersonId, 'id-root');
  assert.equal(c1.user, 'ורד'); assert.equal(c1.proxySecret, process.env.OUTPATIENT_PROXY_SECRET);
  assert.equal(c1.assignedTo, undefined); assert.equal(c1.source, undefined);
  assert.equal(c2.action, 'saveContinuation');
  assert.equal(c2.outcome, 'to_outpatient');
  assert.equal(c2.outpatientId, 'id_new_lead'); assert.equal(c2.outpatientEntity, 'lead');
  assert.equal(c2.key, 'דנה כהן|ramot|2026-10-01'); assert.equal(c2.dashboardPatientId, 'id-stay-1');
  assert.equal(res.json.row.outpatientId, 'id_new_lead');
});

test('routes: to-outpatient — possible_duplicate / identity_conflict from createLead rules save NO outcome (409)', async () => {
  reset();
  sheetsReply = () => ({ status: 200, body: { ok: false, error: 'possible_duplicate', possibleDuplicateOf: ['lead:L-old'] } });
  let res = await request('POST', '/api/continuation/to-outpatient', { dashboardPatientId: 'id-stay-1', meetingDate: '2026-11-02' }, H());
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'possible_duplicate');
  assert.deepEqual(res.json.possibleDuplicateOf, ['lead:L-old']);
  assert.equal(calls.length, 1, 'no saveContinuation after a refused create');
  reset();
  sheetsReply = () => ({ status: 200, body: { ok: false, error: 'identity_conflict' } });
  res = await request('POST', '/api/continuation/to-outpatient', { dashboardPatientId: 'id-stay-1' }, H());
  assert.equal(res.status, 409); assert.equal(calls.length, 1);
});

test('routes: to-outpatient — second write fails => continuation_link_save_failed with the lead id; the retry links (matched) and saves', async () => {
  reset();
  let saveAttempts = 0;
  sheetsReply = (body) => {
    if (body.action === 'createContinuationLead') return { status: 200, body: { ok: true, id: 'id_lead_1', matched: saveAttempts > 0, matchedBy: saveAttempts > 0 ? 'dashboardPatientId' : '', entity: 'lead' } };
    saveAttempts++;
    return saveAttempts === 1 ? { status: 200, body: { ok: false, reason: 'busy' } } : { status: 200, body: { ok: true, row: body } };
  };
  let res = await request('POST', '/api/continuation/to-outpatient', { dashboardPatientId: 'id-stay-1', meetingDate: '2026-11-02' }, H());
  assert.equal(res.status, 502);
  assert.equal(res.json.error, 'continuation_link_save_failed');
  assert.equal(res.json.reason, 'busy');
  assert.deepEqual(res.json.lead, { id: 'id_lead_1', entity: 'lead', matched: false });
  res = await request('POST', '/api/continuation/to-outpatient', { dashboardPatientId: 'id-stay-1', meetingDate: '2026-11-02' }, H());
  assert.equal(res.status, 200);
  assert.equal(res.json.lead.matched, true, 'retry linked the existing lead instead of creating');
  assert.equal(calls.length, 4);
});

test('routes: to-outpatient fails closed on identity exactly like saveContinuation, and needs a session', async () => {
  reset();
  let res = await request('POST', '/api/continuation/to-outpatient', { name: 'דנה כהן', phone: '0501234567' }, H());
  assert.equal(res.status, 400); assert.equal(res.json.error, 'continuation_identity_required');
  res = await request('POST', '/api/continuation/to-outpatient', { dashboardPatientId: 'id-stay-9' }, H());
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
  res = await request('POST', '/api/continuation/to-outpatient', { dashboardPatientId: 'id-stay-1' });
  assert.equal(res.status, 401);
});

test('routes: GET /api/continuation-roster still serves the cached server-held roster (shared fetch)', async () => {
  reset();
  // earlier tests swapped the upstream; a fresh fetch below re-primes the cache
  const a = await request('GET', '/api/continuation-roster?fresh=1', null, H());
  assert.equal(a.status, 200); assert.equal(a.headers['x-cache'], 'MISS');
  const b = await request('GET', '/api/continuation-roster', null, H());
  assert.equal(b.headers['x-cache'], 'HIT');
  assert.equal(b.json.patients[0].id, 'id-stay-1');
});
