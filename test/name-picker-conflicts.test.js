'use strict';

/**
 * Name picker + stale-save conflict refusal (Outpatient PR 2 — port of
 * E-Zone-Dashboard PR #114, on top of the PR 1 session/stamping base).
 *
 * Locked contracts:
 *   A. server.js — the picker's re-issue (POST /api/verify-pin {pin, user})
 *      keeps the SAME 7-day TTL (never extends, never a second cookie); the
 *      user is accepted ONLY from lib/users.js SESSION_USERS; GET /api/me
 *      returns it; the new GET /api/users serves that list session-gated.
 *   B. Code.gs _saveAll — for an id-matched row: sheetStamp = existing
 *      updatedAt, seenStamp = incoming updatedAt. Both non-empty AND different
 *      AND a non-meta column changed -> REFUSED: the sheet row is written back
 *      unchanged in its place and reported in the additive `conflicts` field
 *      (absent when none). Stale + meta-only -> no refusal. Empty seenStamp or
 *      empty sheetStamp -> last-writer-wins as before. Fresh stamp -> normal
 *      write. New row -> untouched. Leads mirror Clients. Still under the
 *      lock; the preserve-by-id blocks are untouched. '[conflict]' audit line.
 *   C. public/conflicts.js conflictsMessage — the Hebrew banner wording.
 *   D. public/app.js — the picker appears only when /api/me answers an empty
 *      user; the PIN is held in a closure for one call and never persisted;
 *      the header renders the name via textContent; החלף = logout -> PIN ->
 *      picker; a save with conflicts shows the banner + reloads, never
 *      retries; a remembered user-less editor session gets the picker once.
 *   E. public/sw.js — cache bumped v3 -> v4 (monotonic; never regresses).
 *
 * The Code.gs tests run the REAL shipped file in a vm sandbox with in-memory
 * sheets (the session-who-when harness). No live backend, dummy fixtures only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');

// ---- server env (must be set BEFORE server.js is required) ------------------
const TEST_PORT = 31844; // 31840-31843 are taken by the other server test files (parallel runs)
const DUMMY_PIN = '424242';
const SECRET = 'test-session-secret-name-picker-0123456789abcdef';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
process.env.SESSION_SECRET = SECRET;
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;

global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true, mocked: true }) });

const { DEFAULT_TTL_SECONDS } = require('../lib/session');
const { SESSION_USERS } = require('../lib/users');
const { conflictsMessage, conflictsOf, UNKNOWN_EDITOR } = require('../public/conflicts');
const server = require('../server');

let httpServer;
test.before(() => { httpServer = server.start(TEST_PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

function request(method, urlPath, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1', port: TEST_PORT, path: urlPath, method,
        headers: Object.assign(
          body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
          headers || {})
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* non-JSON */ }
          resolve({ status: res.statusCode, body: data, json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
async function waitForListen() {
  for (let i = 0; i < 50; i++) {
    try { await request('GET', '/healthz'); return; }
    catch (_) { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start listening');
}
const setCookies = (res) => res.headers['set-cookie'] || [];
const cookieOf = (res) => (setCookies(res)[0] || '').split(';')[0];
const tokenOf = (res) => cookieOf(res).split('=')[1] || '';
const maxAgeOf = (res) => Number(((setCookies(res)[0] || '').match(/Max-Age=(\d+)/) || [])[1]);

/* ================= A. server: picker re-issue ================= */

test('A: picker re-issue — a second /api/verify-pin {pin, user} re-issues ONE cookie with the same 7-day TTL and the name inside; /api/me returns it', async () => {
  await waitForListen();
  // 1. the PIN form: user-less login
  const first = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN });
  assert.equal(first.status, 200);
  assert.equal(maxAgeOf(first), DEFAULT_TTL_SECONDS);
  assert.equal(tokenOf(first).split('.').length, 2, 'user-less legacy token');
  const me0 = await request('GET', '/api/me', null, { Cookie: cookieOf(first) });
  assert.deepEqual(me0.json, { ok: true, user: '' });

  // 2. the picker: same PIN + the chosen name, sent WITH the first cookie
  const before = Math.floor(Date.now() / 1000);
  const second = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN, user: 'ורד' }, { Cookie: cookieOf(first) });
  assert.equal(second.status, 200);
  assert.deepEqual(second.json, { ok: true });
  assert.equal(setCookies(second).length, 1, 'exactly one Set-Cookie — re-issued, not a second cookie');
  assert.equal(maxAgeOf(second), DEFAULT_TTL_SECONDS, 'TTL unchanged by the re-issue');
  const token = tokenOf(second);
  assert.equal(token.split('.').length, 3, 'user-bearing token');
  const expiry = Number(token.split('.')[0]);
  assert.ok(expiry >= before + DEFAULT_TTL_SECONDS && expiry <= before + DEFAULT_TTL_SECONDS + 5, 'expiry = now + 7 days, never extended beyond');
  assert.match(setCookies(second)[0], /HttpOnly/);
  assert.match(setCookies(second)[0], /SameSite=Lax/);
  const me = await request('GET', '/api/me', null, { Cookie: cookieOf(second) });
  assert.deepEqual(me.json, { ok: true, user: 'ורד' });
  // the old user-less cookie is still a valid session (it just has no name)
  const meOld = await request('GET', '/api/me', null, { Cookie: cookieOf(first) });
  assert.deepEqual(meOld.json, { ok: true, user: '' });
});

test('A: the user is accepted ONLY from SESSION_USERS — every listed name round-trips, anything else stays user-less; a wrong PIN with a user mints nothing', async () => {
  await waitForListen();
  for (const name of SESSION_USERS) {
    const res = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN, user: name });
    assert.equal(res.status, 200);
    const me = await request('GET', '/api/me', null, { Cookie: cookieOf(res) });
    assert.deepEqual(me.json, { ok: true, user: name });
  }
  for (const bad of ['HACKER', 'ורד<script>', 'ורדx', '', ' ', 42, null, { name: 'ורד' }]) {
    const res = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN, user: bad });
    assert.equal(res.status, 200);
    assert.equal(tokenOf(res).split('.').length, 2, 'legacy token for ' + JSON.stringify(bad));
    const me = await request('GET', '/api/me', null, { Cookie: cookieOf(res) });
    assert.deepEqual(me.json, { ok: true, user: '' });
  }
  const wrong = await request('POST', '/api/verify-pin', { pin: '000000', user: 'ורד' });
  assert.equal(wrong.status, 401);
  assert.equal(setCookies(wrong).length, 0, 'no cookie on a wrong PIN, whatever the user');
});

test('A: GET /api/users serves SESSION_USERS (the picker list) and is session-gated; the route table has no new open route', async () => {
  await waitForListen();
  const noCookie = await request('GET', '/api/users');
  assert.equal(noCookie.status, 401);
  assert.deepEqual(noCookie.json, { ok: false, error: 'unauthorized' });
  const bad = await request('GET', '/api/users', null, { Cookie: 'ezone_session=1.deadbeef' });
  assert.equal(bad.status, 401);
  const login = await request('POST', '/api/verify-pin', { pin: DUMMY_PIN });
  const ok = await request('GET', '/api/users', null, { Cookie: cookieOf(login) });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { ok: true, users: SESSION_USERS });
  assert.deepEqual(ok.json.users, ['ורד', 'שירן', 'יעל', 'ירדן'], 'the four names, nothing invented');
  // gated in the router (the F test in session-who-when pins the open set)
  const route = server._router.stack.find((m) => m.route && m.route.path === '/api/users');
  assert.ok(route, '/api/users mounted');
  assert.ok(route.route.stack.some((l) => l.handle === server.requireSession), '/api/users behind requireSession');
});

/* ================= Code.gs sandbox harness ================= */

function fakeSheet(name, grid, log) {
  grid = grid.map((r) => r.slice());
  function cell(r, c) { const row = grid[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  function put(r, c, v) { (grid[r - 1] = grid[r - 1] || [])[c - 1] = v; }
  const sh = {
    _grid: grid,
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => Math.max(grid.length, 50),
    setFrozenRows() {},
    hideSheet() {},
    isSheetHidden: () => false,
    appendRow(r) { log.push({ sheet: name, kind: 'appendRow' }); grid.push(r.slice()); },
    deleteRow(n) { log.push({ sheet: name, kind: 'deleteRow', row: n }); grid.splice(n - 1, 1); },
    getDataRange() { return sh.getRange(1, 1, grid.length, sh.getLastColumn()); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValue: () => cell(r, c),
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(cell(r + i, c + j)); out.push(row); }
          return out;
        },
        setValue(v) { log.push({ sheet: name, kind: 'setValue', row: r, col: c, value: v }); put(r, c, v); },
        setValues(vals) {
          log.push({ sheet: name, kind: 'setValues', row: r, col: c, numRows: vals.length });
          for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) put(r + i, c + j, vals[i][j]);
        },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (grid[r - 1 + i]) grid[r - 1 + i][c - 1 + j] = ''; },
        setNumberFormat(fmt) { log.push({ sheet: name, kind: 'fmt', row: r, col: c, numRows: nr, fmt }); return this; }
      };
    }
  };
  return sh;
}

function makeSandbox(opts) {
  opts = opts || {};
  const log = [];
  const logger = [];
  const sheets = {};
  Object.keys(opts.sheets || {}).forEach((n) => { sheets[n] = fakeSheet(n, opts.sheets[n], log); });
  const props = Object.assign({}, opts.props || {});
  const ss = {
    getId: () => 'LIVE',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet(n) { sheets[n] = fakeSheet(n, [], log); return sheets[n]; }
  };
  let locked = false;
  const lock = {
    tryLock() { locked = true; return true; },
    waitLock() { locked = true; },
    releaseLock() { locked = false; },
    isLocked: () => locked
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => lock },
    Logger: { log() { logger.push(Array.prototype.slice.call(arguments)); } },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10), getUuid: () => 'uuid-' + (++uuidSeq) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty(k, v) { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }), MimeType: { JSON: 'JSON' } },
    MailApp: { sendEmail() {} },
    ScriptApp: { getOAuthToken: () => 'tok' },
    DriveApp: { searchFiles: () => ({ hasNext: () => false }), getFilesByName: () => ({ hasNext: () => false }) }
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  return { ctx, sheets, log, logger, props, lock };
}
let uuidSeq = 0;

function post(ctx, payload, params) {
  const out = ctx.doPost({ postData: { contents: JSON.stringify(payload) }, parameter: params || {} });
  return JSON.parse(out.getContent());
}
function rowsOf(sheet, headers) {
  return sheet._grid.slice(1).filter((r) => r.some((v) => v !== '' && v !== null && v !== undefined)).map((r) => {
    const o = {}; headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; }); return o;
  });
}
function byId(rows) { const m = {}; rows.forEach((r) => { m[r.id] = r; }); return m; }
function rowFrom(headers, obj) { return headers.map((h) => (obj[h] === undefined ? '' : obj[h])); }
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const plain = (x) => JSON.parse(JSON.stringify(x));

const OLD_AT = '2026-01-01T00:00:00.000Z';   // what the sheet holds
const OLDER_AT = '2025-12-01T00:00:00.000Z'; // what a STALE tab loaded
// The exact content the sheet holds — a test that wants "unchanged" echoes these.
const C1 = { id: 'c1', name: 'דנה כהן', phone: '0501234567', status: 'פעיל', notes: 'a', creditsOwed: 2, paymentAmountOverrides: '{"p1":100}' };
const C2 = { id: 'c2', name: 'יוסי לוי', phone: '0502223333', status: 'פעיל', notes: 'b', creditsOwed: 0 };
const C3 = { id: 'c3', name: 'רות', phone: '0503334444', status: 'פעיל', notes: 'c', creditsOwed: 0 };
const L1 = { id: 'l1', name: 'ליד א', phone: '0509990001', stage: 'new' };
const L2 = { id: 'l2', name: 'ליד ב', phone: '0509990002', stage: 'new' };
function baseClients(ctx) {
  const H = ctx.CLIENTS_HEADERS;
  return [H.slice(),
    rowFrom(H, Object.assign({}, C1, { updatedAt: OLD_AT, updatedBy: 'ורד' })),
    rowFrom(H, Object.assign({}, C2, { updatedAt: OLD_AT, updatedBy: '' })),      // stamped WHEN only (cross-app / legacy cookie)
    rowFrom(H, Object.assign({}, C3, { updatedAt: '', updatedBy: '' }))           // never stamped
  ];
}
function baseLeads(ctx) {
  const H = ctx.LEADS_HEADERS;
  return [H.slice(),
    rowFrom(H, Object.assign({}, L1, { updatedAt: OLD_AT, updatedBy: 'יעל' })),
    rowFrom(H, Object.assign({}, L2, { updatedAt: OLD_AT, updatedBy: 'יעל' }))
  ];
}
function sandboxWithData() {
  const sb = makeSandbox();
  sb.sheets.Clients = fakeSheet('Clients', baseClients(sb.ctx), sb.log);
  sb.sheets.Leads = fakeSheet('Leads', baseLeads(sb.ctx), sb.log);
  return sb;
}
function save(sb, clients, leads, extra) {
  return post(sb.ctx, Object.assign({ action: 'saveAll', user: 'שירן', clients, leads: leads || [] }, extra || {}));
}
function conflictLines(sb) {
  return sb.logger.filter((args) => String(args[0]).indexOf('[conflict]') === 0);
}

/* ================= B. Code.gs _saveAll conflict refusal ================= */

test('B: helper — _staleConflictCols refuses only when both stamps are non-empty, differ, and content changed', () => {
  const { ctx } = makeSandbox();
  const diff = ctx._clientDiffCols;
  const sheet = Object.assign({}, C1, { updatedAt: OLD_AT, updatedBy: 'ורד' });
  const changed = Object.assign({}, C1, { notes: 'X' });
  assert.deepEqual(plain(ctx._staleConflictCols(diff, Object.assign({}, changed, { updatedAt: OLDER_AT }), sheet)), ['notes'], 'stale + change -> the changed columns');
  assert.equal(ctx._staleConflictCols(diff, Object.assign({}, C1, { updatedAt: OLDER_AT }), sheet), null, 'stale + pure echo -> null');
  assert.equal(ctx._staleConflictCols(diff, Object.assign({}, changed, { updatedAt: OLD_AT }), sheet), null, 'fresh stamp -> null');
  assert.equal(ctx._staleConflictCols(diff, Object.assign({}, changed, { updatedAt: '' }), sheet), null, 'empty seenStamp -> null');
  assert.equal(ctx._staleConflictCols(diff, Object.assign({}, changed), sheet), null, 'missing seenStamp -> null');
  assert.equal(ctx._staleConflictCols(diff, Object.assign({}, changed, { updatedAt: OLDER_AT }), Object.assign({}, sheet, { updatedAt: '' })), null, 'empty sheetStamp -> null');
  assert.equal(ctx._staleConflictCols(diff, Object.assign({}, changed, { updatedAt: OLDER_AT }), null), null, 'new row -> null');
  // meta-only differences never count as a change
  const metaOnly = Object.assign({}, C1, { updatedAt: OLDER_AT, updatedBy: 'X', creditsOwed: 99, paymentAmountOverrides: '{"z":1}' });
  assert.equal(ctx._staleConflictCols(diff, metaOnly, sheet), null, 'stale + meta-only -> null');
});

test('B: stale tab + real change -> REFUSED: sheet row kept byte-for-byte (stamps included), conflicts populated, not counted as stamped, audit line logged', () => {
  const sb = sandboxWithData();
  const res = save(sb, [
    Object.assign({}, C1, { notes: 'EDITED-STALE', updatedAt: OLDER_AT, updatedBy: 'ורד' }), // loaded before ורד's edit
    Object.assign({}, C2, { updatedAt: OLD_AT, updatedBy: '' }),                              // fresh echo
    Object.assign({}, C3)
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.conflicts), [
    { id: 'c1', name: 'דנה כהן', sheetUpdatedAt: OLD_AT, sheetUpdatedBy: 'ורד', changed: ['notes'] }
  ]);
  assert.deepEqual(res.stamped, { clients: 0, leads: 0 }, 'a refused row is not a stamped row');
  assert.equal(res.savedClients, 3, 'the row is written back in its place — nothing dropped');
  assert.equal(res.preserved, 0);
  const C = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS));
  assert.equal(C.c1.notes, 'a', 'sheet content kept');
  assert.equal(C.c1.updatedAt, OLD_AT, 'sheet stamp kept');
  assert.equal(C.c1.updatedBy, 'ורד');
  assert.equal(String(C.c1.creditsOwed), '2');
  assert.equal(C.c1.paymentAmountOverrides, '{"p1":100}');
  assert.equal(C.c2.updatedAt, OLD_AT); assert.equal(C.c3.updatedAt, '');
  const lines = conflictLines(sb);
  assert.equal(lines.length, 1, 'one [conflict] audit line');
  assert.deepEqual(lines[0].slice(1, 5), ['client', 'c1', 'דנה כהן', 'notes']);
  assert.ok(lines[0].indexOf('שירן') > 0, 'the audit line names who attempted the save');
});

test('B: the refused row is written back exactly as _readAll handed it — every column equals the pre-save sheet row', () => {
  const sb = sandboxWithData();
  const before = rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS).find((r) => r.id === 'c1');
  save(sb, [Object.assign({}, C1, { notes: 'X', phone: '0500000000', status: 'לא פעיל', updatedAt: OLDER_AT }), C2, C3]);
  const after = rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS).find((r) => r.id === 'c1');
  assert.deepEqual(plain(after), plain(before));
});

test('B: no conflicts -> the `conflicts` field is ABSENT (not an empty array)', () => {
  const sb = sandboxWithData();
  const res = save(sb, [Object.assign({}, C1, { updatedAt: OLD_AT }), C2, C3]);
  assert.equal(res.ok, true);
  assert.equal('conflicts' in res, false);
});

test('B: stale tab + META-ONLY difference (creditsOwed / overrides / updatedBy) -> no refusal; the sheet stamps are carried, the server-managed cells preserved', () => {
  const sb = sandboxWithData();
  const res = save(sb, [Object.assign({}, C1, { creditsOwed: 99, paymentAmountOverrides: '{"hack":1}', updatedAt: OLDER_AT, updatedBy: 'HACKER' }), C2, C3]);
  assert.equal(res.ok, true);
  assert.equal('conflicts' in res, false);
  assert.deepEqual(res.stamped, { clients: 0, leads: 0 });
  const c1 = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS)).c1;
  assert.equal(c1.updatedAt, OLD_AT); assert.equal(c1.updatedBy, 'ורד');
  assert.equal(String(c1.creditsOwed), '2'); assert.equal(c1.paymentAmountOverrides, '{"p1":100}');
});

test('B: EMPTY seenStamp (pre-stamping tab) + change -> last-writer-wins: written and stamped now + user, no refusal', () => {
  const sb = sandboxWithData();
  for (const seen of [undefined, '', null]) {
    const sbx = sandboxWithData();
    const row = Object.assign({}, C1, { notes: 'LWW' });
    if (seen !== undefined) row.updatedAt = seen;
    const res = save(sbx, [row, C2, C3]);
    assert.equal('conflicts' in res, false, 'seen=' + JSON.stringify(seen));
    assert.deepEqual(res.stamped, { clients: 1, leads: 0 });
    const c1 = byId(rowsOf(sbx.sheets.Clients, sbx.ctx.CLIENTS_HEADERS)).c1;
    assert.equal(c1.notes, 'LWW');
    assert.match(c1.updatedAt, ISO_RE);
    assert.notEqual(c1.updatedAt, OLD_AT);
    assert.equal(c1.updatedBy, 'שירן');
  }
  assert.ok(sb, 'sandbox helper usable');
});

test('B: EMPTY sheetStamp (never-stamped row) + any seenStamp + change -> last-writer-wins, first stamp lands', () => {
  const sb = sandboxWithData();
  const res = save(sb, [C1, C2, Object.assign({}, C3, { notes: 'FIRST', updatedAt: 'anything-the-tab-had' })]);
  assert.equal('conflicts' in res, false);
  assert.deepEqual(res.stamped, { clients: 1, leads: 0 });
  const c3 = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS)).c3;
  assert.equal(c3.notes, 'FIRST');
  assert.match(c3.updatedAt, ISO_RE);
  assert.equal(c3.updatedBy, 'שירן');
});

test('B: FRESH stamp (equals the sheet) + change -> normal write, stamped now + user', () => {
  const sb = sandboxWithData();
  const res = save(sb, [Object.assign({}, C1, { notes: 'FRESH', updatedAt: OLD_AT, updatedBy: 'ורד' }), C2, C3]);
  assert.equal('conflicts' in res, false);
  assert.deepEqual(res.stamped, { clients: 1, leads: 0 });
  const c1 = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS)).c1;
  assert.equal(c1.notes, 'FRESH');
  assert.match(c1.updatedAt, ISO_RE);
  assert.notEqual(c1.updatedAt, OLD_AT);
  assert.equal(c1.updatedBy, 'שירן');
  assert.equal(conflictLines(sb).length, 0);
});

test('B: NEW row (no existing id) is unaffected whatever updatedAt it carries', () => {
  const sb = sandboxWithData();
  const res = save(sb, [C1, C2, C3, { id: 'c9', name: 'חדש', phone: '0504445555', status: 'פעיל', updatedAt: 'forged', updatedBy: 'HACKER' }]);
  assert.equal('conflicts' in res, false);
  assert.deepEqual(res.stamped, { clients: 1, leads: 0 });
  const c9 = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS)).c9;
  assert.equal(c9.name, 'חדש');
  assert.match(c9.updatedAt, ISO_RE);
  assert.equal(c9.updatedBy, 'שירן');
});

test('B: mixed save — one refused, one accepted, one new, one preserved: each rule applies per row and the rest of the save proceeds', () => {
  const sb = sandboxWithData();
  const res = save(sb, [
    Object.assign({}, C1, { notes: 'STALE', updatedAt: OLDER_AT }),   // refused
    Object.assign({}, C2, { notes: 'OK', updatedAt: OLD_AT }),        // accepted (fresh)
    // c3 omitted -> preserved (merge-don't-drop), never a conflict
    { id: 'c9', name: 'חדש', phone: '0504445555', status: 'פעיל' }    // new
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.conflicts).map((c) => c.id), ['c1']);
  assert.deepEqual(res.stamped, { clients: 2, leads: 0 });
  assert.equal(res.preserved, 1);
  assert.equal(res.savedClients, 4);
  const C = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS));
  assert.equal(C.c1.notes, 'a'); assert.equal(C.c1.updatedAt, OLD_AT);
  assert.equal(C.c2.notes, 'OK'); assert.match(C.c2.updatedAt, ISO_RE); assert.equal(C.c2.updatedBy, 'שירן');
  assert.equal(C.c3.notes, 'c'); assert.equal(C.c3.updatedAt, '');
  assert.match(C.c9.updatedAt, ISO_RE);
  assert.ok(Number(res.dataVersion) >= 1, 'dataVersion still bumped');
});

test('B: a refusal by a user-less (legacy) cookie is still a refusal; sheetUpdatedBy blank when the sheet row was stamped WHEN only', () => {
  const sb = sandboxWithData();
  const res = post(sb.ctx, { action: 'saveAll', user: '', clients: [C1, Object.assign({}, C2, { notes: 'STALE', updatedAt: OLDER_AT }), C3], leads: [] });
  assert.deepEqual(plain(res.conflicts), [{ id: 'c2', name: 'יוסי לוי', sheetUpdatedAt: OLD_AT, sheetUpdatedBy: '', changed: ['notes'] }]);
  assert.equal(byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS)).c2.notes, 'b');
});

test('B: Leads mirror Clients — stale + change refused (row kept, conflicts entry), fresh + change written, echo carried, new stamped', () => {
  const sb = sandboxWithData();
  const res = save(sb, [C1, C2, C3], [
    Object.assign({}, L1, { name: 'ליד א שונה', updatedAt: OLDER_AT }),  // stale + change -> refused
    Object.assign({}, L2, { name: 'ליד ב שונה', updatedAt: OLD_AT }),    // fresh + change -> written
    { id: 'l3', name: 'ליד חדש', phone: '0509990003', stage: 'new', updatedAt: 'forged' }
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.conflicts), [{ id: 'l1', name: 'ליד א', sheetUpdatedAt: OLD_AT, sheetUpdatedBy: 'יעל', changed: ['name'] }]);
  assert.deepEqual(res.stamped, { clients: 0, leads: 2 });
  assert.equal(res.savedLeads, 3);
  const L = byId(rowsOf(sb.sheets.Leads, sb.ctx.LEADS_HEADERS));
  assert.equal(L.l1.name, 'ליד א'); assert.equal(L.l1.updatedAt, OLD_AT); assert.equal(L.l1.updatedBy, 'יעל');
  assert.equal(L.l2.name, 'ליד ב שונה'); assert.match(L.l2.updatedAt, ISO_RE); assert.equal(L.l2.updatedBy, 'שירן');
  assert.match(L.l3.updatedAt, ISO_RE);
  assert.deepEqual(conflictLines(sb)[0].slice(1, 3), ['lead', 'l1']);
  // stale + meta-only / empty seenStamp on a lead -> no refusal
  const sb2 = sandboxWithData();
  const res2 = save(sb2, [C1, C2, C3], [Object.assign({}, L1, { updatedAt: OLDER_AT, updatedBy: 'X' }), Object.assign({}, L2, { name: 'LWW' })]);
  assert.equal('conflicts' in res2, false);
  assert.equal(byId(rowsOf(sb2.sheets.Leads, sb2.ctx.LEADS_HEADERS)).l2.name, 'LWW');
});

test('B: clients + leads conflicts ride the same array (clients first), each entry has exactly the five documented keys', () => {
  const sb = sandboxWithData();
  const res = save(sb, [Object.assign({}, C1, { notes: 'X', updatedAt: OLDER_AT }), C2, C3], [Object.assign({}, L1, { stage: 'won', updatedAt: OLDER_AT }), L2]);
  assert.deepEqual(plain(res.conflicts).map((c) => c.id), ['c1', 'l1']);
  for (const c of res.conflicts) assert.deepEqual(Object.keys(c).sort(), ['changed', 'id', 'name', 'sheetUpdatedAt', 'sheetUpdatedBy']);
});

test('B: source — the check runs inside the lock, after the creditsOwed / paymentAmountOverrides preserve-by-id blocks (unchanged) and before the stamp reconcile; explicit deletes and preserved rows are untouched', () => {
  const body = GS.slice(GS.indexOf('function _saveAll(payload)'), GS.indexOf('/* ===== Clients-removed tombstones'));
  const at = (s) => { const i = body.indexOf(s); assert.ok(i >= 0, 'missing: ' + s); return i; };
  assert.ok(at('lock.tryLock(30000)') < at('_staleConflictCols(_clientDiffCols'), 'under the lock');
  assert.ok(at('clients[i].creditsOwed = _hasOwn(existingCredits, cid)') < at('_staleConflictCols(_clientDiffCols'), 'creditsOwed preserve block first');
  assert.ok(at('clients[i].paymentAmountOverrides = _hasOwn(existingOverrides, cid)') < at('_staleConflictCols(_clientDiffCols'), 'overrides preserve block first');
  assert.ok(at('_staleConflictCols(_clientDiffCols') < at('_reconcileStamps(_clientDiffCols'), 'refusal decided before stamping');
  assert.ok(at('_staleConflictCols(_leadDiffCols') < at('_reconcileStamps(_leadDiffCols'), 'same for Leads');
  assert.match(body, /clients\[i\] = existingRow;[^\n]*\n\s*continue;/, 'the sheet row replaces the incoming one');
  assert.match(body, /leads\[li\] = existingLead;\s*\n\s*continue;/);
  assert.match(body, /if \(conflicts\.length\) result\.conflicts = conflicts;/, 'additive, absent when none');
  // the PR 1 preserve blocks are byte-for-byte what they were
  assert.match(body, /clients\[i\]\.creditsOwed = _hasOwn\(existingCredits, cid\)\s*\? existingCredits\[cid\]\s*: _toCredits\(clients\[i\]\.creditsOwed\);/);
  assert.match(body, /clients\[i\]\.paymentAmountOverrides = _hasOwn\(existingOverrides, cid\)\s*\? existingOverrides\[cid\]\s*: \(clients\[i\]\.paymentAmountOverrides == null \? '' : clients\[i\]\.paymentAmountOverrides\);/);
  assert.match(GS, /Logger\.log\('\[conflict\] saveAll refused %s id=%s/, 'audit line with the [conflict] prefix');
});

/* ================= C. conflictsMessage ================= */

test('C: conflictsMessage — single conflict with a known editor', () => {
  const msg = conflictsMessage({ ok: true, conflicts: [{ id: 'c1', name: 'דנה כהן', sheetUpdatedAt: OLD_AT, sheetUpdatedBy: 'ורד', changed: ['notes'] }] });
  assert.equal(msg, 'השינוי ל־דנה כהן לא נשמר — ורד עדכן/ה קודם. הנתונים רועננו.');
});

test('C: conflictsMessage — blank updatedBy -> מישהו/י; several names joined; several editors joined with " / "; blanks and duplicates collapsed', () => {
  assert.equal(UNKNOWN_EDITOR, 'מישהו/י');
  assert.equal(conflictsMessage({ conflicts: [{ id: 'c2', name: 'יוסי לוי', sheetUpdatedBy: '' }] }),
    'השינוי ל־יוסי לוי לא נשמר — מישהו/י עדכן/ה קודם. הנתונים רועננו.');
  assert.equal(conflictsMessage({ conflicts: [{ id: 'c2', name: 'יוסי לוי' }] }),
    'השינוי ל־יוסי לוי לא נשמר — מישהו/י עדכן/ה קודם. הנתונים רועננו.', 'missing updatedBy = blank');
  assert.equal(conflictsMessage({ conflicts: [
    { id: 'c1', name: 'דנה כהן', sheetUpdatedBy: 'ורד' },
    { id: 'c2', name: 'יוסי לוי', sheetUpdatedBy: '' },
    { id: 'l1', name: 'ליד א', sheetUpdatedBy: 'יעל' },
    { id: 'c1', name: 'דנה כהן', sheetUpdatedBy: 'ורד' }
  ] }), 'השינוי ל־דנה כהן, יוסי לוי, ליד א לא נשמר — ורד / יעל עדכן/ה קודם. הנתונים רועננו.');
});

test('C: conflictsMessage — a nameless row falls back to its id; no/invalid conflicts -> "" (the caller\'s "show a banner?" test)', () => {
  assert.equal(conflictsMessage({ conflicts: [{ id: 'c7', name: '', sheetUpdatedBy: 'שירן' }] }),
    'השינוי ל־c7 לא נשמר — שירן עדכן/ה קודם. הנתונים רועננו.');
  for (const res of [undefined, null, {}, { ok: true }, { conflicts: [] }, { conflicts: 'x' }, { conflicts: [null, 3] }, { conflicts: {} }]) {
    assert.equal(conflictsMessage(res), '', JSON.stringify(res));
  }
  assert.deepEqual(conflictsOf({ conflicts: [null, { id: 'a' }, 'x'] }), [{ id: 'a' }]);
});

/* ================= D. client wiring (source guards) ================= */

function fnSource(name) {
  const m = APP.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert.ok(m, 'function ' + name + ' in app.js');
  return m[0];
}

test('D: the picker is shown only when /api/me answers an EMPTY user; a name goes straight into the app', () => {
  const src = fnSource('finishLogin');
  assert.match(src, /apiMe\(\)\.then\(function \(user\) \{\s*if \(user\) \{ state\.user = user; enterEditor\(\); return; \}\s*showUserPicker\(pin\);/);
  // the PIN handler hands the typed PIN to finishLogin — and only there
  assert.match(APP, /apiVerifyPin\(v\)\.then\(function \(ok\) \{\s*if \(ok\) \{[\s\S]*?return finishLogin\(v\)/);
});

test('D: the picker offers one button per /api/users name, no free text; the PIN is held in a closure for ONE re-issue call and never persisted', () => {
  const src = fnSource('showUserPicker');
  assert.match(src, /apiUsers\(\)\.then\(function \(users\)/);
  assert.match(src, /document\.createElement\('button'\)/);
  assert.match(src, /b\.textContent = name;/, 'name rendered as text, never HTML');
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.match(src, /var chosen = pin;\s*pin = null;/, 'the closure drops the PIN on first use');
  assert.match(src, /apiVerifyPin\(chosen, name\)\.then\(function \(ok\) \{\s*chosen = null;/, 'and the local copy right after the call');
  assert.match(src, /return apiMe\(\);/, 'the name is read back from the cookie, never assumed');
  assert.doesNotMatch(APP, /(sessionStorage|localStorage)\.setItem\(['"][^'"]*pin/i, 'no PIN in web storage');
  assert.doesNotMatch(APP, /state\.pin\b/, 'no PIN on state');
  // the picker markup: PIN-box styling, buttons container, no input
  const picker = INDEX.match(/<div id="userScreen" class="pin-screen" hidden>[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(picker, '#userScreen present');
  assert.match(picker[0], /class="pin-card"/);
  assert.match(picker[0], /id="userButtons"/);
  assert.doesNotMatch(picker[0], /<input/, 'no free text');
  assert.doesNotMatch(picker[0], /<select/, 'no free text');
  assert.match(CSS, /\.user-buttons \{/);
  // the two new calls ride apiFetch (401 -> PIN screen)
  assert.match(APP, /await apiFetch\('\/api\/me'/);
  assert.match(APP, /await apiFetch\('\/api\/users'/);
});

test('D: the header renders "מחובר/ת כ: <name> · החלף" via textContent; החלף = logout -> PIN (-> picker)', () => {
  const span = INDEX.match(/<span id="sessionUser"[^>]*hidden>[\s\S]*?<\/span>/);
  assert.ok(span, '#sessionUser in the topbar');
  assert.match(span[0], /מחובר\/ת כ: <b id="sessionUserName"><\/b> · <button[^>]*id="switchUserBtn"[^>]*>החלף<\/button>/);
  assert.ok(INDEX.indexOf('id="sessionUser"') > INDEX.indexOf('<div class="topbar-right">'), 'inside .topbar-right');
  assert.ok(INDEX.indexOf('id="sessionUser"') < INDEX.indexOf('id="settingsBtn"'));
  const src = fnSource('renderSessionUser');
  assert.match(src, /if \(state\.user\) \{ nameEl\.textContent = state\.user; box\.hidden = false; \}/);
  assert.match(src, /else \{ nameEl\.textContent = ''; box\.hidden = true; \}/);
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.match(fnSource('enterApp'), /renderSessionUser\(\);/);
  // החלף and יציאה share one logout: expire the cookie, forget role + name, PIN screen
  assert.match(APP, /function logout\(\) \{[\s\S]*?apiFetch\('\/api\/logout', \{ method: 'POST' \}[\s\S]*?state\.user = '';[\s\S]*?showPin\(\);\s*\}/);
  assert.match(APP, /on\('#logoutBtn', 'click', logout\);/);
  assert.match(APP, /on\('#switchUserBtn', 'click', logout\);/);
  assert.match(fnSource('handleUnauthorized'), /state\.user = '';/);
});

test('D: a remembered EDITOR session without a name gets PIN -> picker once on load; viewers never pick; a non-401 /api/me failure still loads', () => {
  const src = fnSource('init');
  assert.match(src, /apiMe\(\)\.then\(function \(user\) \{\s*state\.user = user;\s*renderSessionUser\(\);\s*if \(state\.role === 'editor' && !user\) \{ showPin\(\); return; \}\s*loadAll\(\)\.catch/);
  assert.match(src, /if \(!\(e && e\.message === 'unauthorized'\)\) loadAll\(\)\.catch/);
  // no remembered role: PIN screen + the (401-refused) background load, as before
  assert.match(src, /\} else \{\s*showPin\(\);\s*loadAll\(\)\.catch\(function \(\) \{\}\);\s*\}/);
});

test('D: a save with conflicts shows the banner (conflictsMessage) and reloads — never retries; a clean save hides it; banner text via textContent', () => {
  const src = fnSource('persist');
  const branch = src.match(/var conflictMsg = conflictsMessage\(data\);\s*if \(conflictMsg\) \{([\s\S]*?)return;\s*\}/);
  assert.ok(branch, 'conflict branch in persist()');
  assert.match(branch[1], /showConflictBanner\(conflictMsg\);/);
  assert.match(branch[1], /loadAll\(\)/);
  assert.doesNotMatch(branch[1], /apiSave|persist\(/, 'no automatic retry');
  assert.ok(src.indexOf('if (conflictMsg)') < src.indexOf('if (data && data.staleSave)'), 'conflicts take precedence over the staleSave toast (one reload)');
  assert.match(src, /hideConflictBanner\(\);\s*if \(data && data\.staleSave\)/);
  assert.match(fnSource('showConflictBanner'), /txt\.textContent = msg;/);
  assert.doesNotMatch(fnSource('showConflictBanner'), /\.innerHTML\s*=/);
  assert.match(fnSource('conflictsMessage'), /self\.EzoneConflicts/);
  assert.match(APP, /on\('#conflictBannerClose', 'click', hideConflictBanner\);/);
  assert.match(INDEX, /<div id="conflictBanner" class="conflict-banner" role="alert" hidden>\s*<span id="conflictBannerText"><\/span>/);
  assert.match(INDEX, /<script src="conflicts\.js\?v=__BUILD__" defer><\/script>/);
  assert.ok(INDEX.indexOf('conflicts.js?v=__BUILD__') < INDEX.indexOf('app.js?v=__BUILD__'), 'helper loads before app.js');
  assert.match(CSS, /\.conflict-banner \{/);
});

test('D: no other UI change — the PIN card, its buttons and the topbar tabs are as before', () => {
  assert.match(INDEX, /<input id="pinInput" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autocomplete="off" \/>/);
  assert.match(INDEX, /<button type="button" id="pinSubmit" class="btn btn-primary">כניסה<\/button>/);
  assert.match(INDEX, /<button type="button" id="pinViewer" class="btn btn-ghost">המשך כצופה בלבד<\/button>/);
  assert.match(INDEX, /<button id="logoutBtn" class="btn btn-ghost">יציאה<\/button>/);
  assert.equal((INDEX.match(/class="tab(?: active)?" data-view=/g) || []).length, 8, 'eight tabs, unchanged');
});

/* ================= E. service worker ================= */

test('E: this PR\'s v3 -> v4 bump stays documented; the live cache never regresses below it', () => {
  // The v4 bump this PR shipped stays recorded in the header history, and a v3
  // shell can never be served again. The CURRENT version is deliberately NOT
  // pinned here — later PRs bump it monotonically and own that assertion
  // (add-user-yarden pins v5). This test only guards against a regression.
  assert.match(SW, /v4 \(2026-09-04\)/, 'the v4 bump stays documented in the header comment');
  assert.doesNotMatch(SW, /var CACHE = 'ezone-outpatient-v3';/);
  const live = Number((SW.match(/var CACHE = 'ezone-outpatient-v(\d+)';/) || [])[1]);
  assert.ok(live >= 4, 'the live cache never goes below the v4 shipped here, got v' + live);
});

/* ================= F. Playwright e2e — drives the real app; skips when no browser ================= */

function loadChromium() {
  try { return require('playwright').chromium; } catch (_) {}
  try {
    const { execSync } = require('node:child_process');
    const groot = execSync('npm root -g').toString().trim();
    return require(path.join(groot, 'playwright')).chromium;
  } catch (_) { return null; }
}
const chromium = loadChromium();
const skipOpt = chromium ? {} : { skip: 'playwright not installed' };
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* Stub of the Railway server + Apps Script: a cookie `ezone_session=<user>`
 * stands in for the signed token (the real signing is covered above); one
 * saveAll answers with a conflict, every later one is clean. */
function startStub() {
  const seen = { logins: [], saves: 0, logouts: 0 };
  const clients = [{ id: 'c1', name: 'דנה כהן', phone: '0501234567', serviceType: 'פסיכותרפיה', location: 'רעננה הפרדס', sessionsPerWeek: '1', pricePerSession: 400, startDate: '2026-01-01', status: 'פעיל', updatedAt: OLD_AT, updatedBy: 'ורד' }];
  // '' (a user-less cookie) is a VALID session — only a missing cookie is null.
  const cookieUser = (req) => { const m = (req.headers.cookie || '').match(/ezone_session=([^;]*)/); return m ? m[1] : null; };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); const p = u.pathname;
      const json = (o, extra) => { res.setHeader('content-type', 'application/json'); if (extra) Object.keys(extra).forEach((k) => res.setHeader(k, extra[k])); res.end(JSON.stringify(o)); };
      const body = () => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b)); } catch (_) { r({}); } }); });
      if (p === '/api/verify-pin') {
        return body().then((pl) => {
          seen.logins.push(pl);
          if (pl.pin !== '424242') { res.statusCode = 401; return json({ ok: false, error: 'Incorrect PIN.' }); }
          const user = SESSION_USERS.indexOf(pl.user) >= 0 ? pl.user : '';
          json({ ok: true }, { 'Set-Cookie': 'ezone_session=' + encodeURIComponent(user) + '; Path=/; HttpOnly' });
        });
      }
      if (p === '/api/logout') { seen.logouts++; return json({ ok: true }, { 'Set-Cookie': 'ezone_session=; Path=/; Max-Age=0' }); }
      const cu = cookieUser(req);
      if (p.indexOf('/api/') === 0 && cu === null) { res.statusCode = 401; return json({ ok: false, error: 'unauthorized' }); }
      if (p === '/api/me') return json({ ok: true, user: decodeURIComponent(cu) });
      if (p === '/api/users') return json({ ok: true, users: SESSION_USERS });
      if (p === '/api/sheets') {
        if (req.method === 'GET') {
          const a = u.searchParams.get('action') || 'getData';
          if (a === 'getPayments') return json({ ok: true, payments: [] });
          if (a === 'getCharges') return json({ ok: true, charges: [] });
          if (a === 'getStopFlags') return json({ ok: true, stopFlags: [] });
          if (a === 'getExtraSessionRequests') return json({ ok: true, requests: [] });
          if (a === 'getSettings') return json({ ok: true, settings: {} });
          if (a === 'getMyStopAlerts') return json({ ok: true, myStopAlerts: [] });
          return json({ ok: true, leads: [], clients, dataVersion: 7 });
        }
        return body().then((pl) => {
          if ((pl.action || 'saveAll') !== 'saveAll') return json({ ok: true });
          seen.saves++;
          seen.lastSave = pl;
          if (seen.saves === 1) {
            return json({ ok: true, savedLeads: pl.leads.length, savedClients: 1, dataVersion: 8, stamped: { clients: 0, leads: 1 },
              conflicts: [{ id: 'c1', name: 'דנה כהן', sheetUpdatedAt: '2026-02-02T00:00:00.000Z', sheetUpdatedBy: 'יעל', changed: ['notes'] }] });
          }
          return json({ ok: true, savedLeads: pl.leads.length, savedClients: 1, dataVersion: 9, stamped: { clients: 0, leads: 0 } });
        });
      }
      if (p === '/sw.js') { res.setHeader('content-type', 'text/javascript'); return res.end('/*noop*/'); }
      const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const f = path.join(PUBLIC, rel);
      if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
      let d = fs.readFileSync(f);
      if (rel === 'index.html') d = Buffer.from(d.toString().replace(/__BUILD__/g, 'test'));
      res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
      res.end(d);
    });
    srv.listen(0, () => resolve({ srv, port: srv.address().port, seen }));
  });
}

test('F: e2e — PIN -> name picker (one button per SESSION_USERS name, no input) -> pick -> header "מחובר/ת כ: <name> · החלף"; החלף -> logout -> PIN; a refused save shows the banner + reloads', skipOpt, async (t) => {
  const { srv, port, seen } = await startStub();
  let browser;
  try { browser = await chromium.launch(); } catch (_) { srv.close(); return t.skip('no browser binary'); }
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'networkidle' });
    // 1. PIN screen (no remembered role)
    assert.equal(await page.isVisible('#pinScreen'), true);
    assert.equal(await page.isHidden('#userScreen'), true);
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    // 2. the picker, only after the PIN, only names
    await page.waitForSelector('#userScreen:not([hidden]) .user-btn');
    assert.equal(await page.isHidden('#app'), true, 'the app stays hidden behind the picker');
    assert.deepEqual(await page.$$eval('#userButtons .user-btn', (bs) => bs.map((b) => b.textContent)), SESSION_USERS);
    assert.equal(await page.$('#userScreen input'), null, 'no free text');
    assert.deepEqual(seen.logins, [{ pin: '424242' }], 'the PIN form sent only the PIN');
    // 3. pick -> re-issue with {pin, user} -> header
    await page.click('#userButtons .user-btn >> text=שירן');
    await page.waitForSelector('#app:not([hidden])');
    await page.waitForSelector('[data-client-id="c1"], .kpi', { timeout: 8000 });
    assert.deepEqual(seen.logins[1], { pin: '424242', user: 'שירן' }, 'the picker re-posted PIN + name once');
    assert.equal(seen.logins.length, 2);
    await page.waitForSelector('#sessionUser:not([hidden])');
    assert.equal((await page.textContent('#sessionUser')).replace(/\s+/g, ' ').trim(), 'מחובר/ת כ: שירן · החלף');
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).concat(Object.keys(localStorage)).filter((k) => /pin/i.test(k)).length), 0, 'no PIN in web storage');
    // 4. a save the server refuses -> banner + reload; never retried
    await page.click('.tab[data-view="leads"]');
    await page.click('#addLeadBtn');
    await page.fill('#leadForm [name="name"]', 'ליד בדיקה');
    await page.fill('#leadForm [name="phone"]', '0521112222');
    await page.check('#leadForm [data-group="serviceType"] input[type="checkbox"] >> nth=0');
    await page.selectOption('#leadForm [name="location"]', 'רעננה הפרדס');
    await page.selectOption('#leadForm [name="house_of_origin"]', 'raanana');
    await page.fill('#leadForm [name="created"]', '2026-09-04');
    await page.selectOption('#leadForm [name="assignedTo"]', 'שירן');
    await page.click('#leadFormSubmit');
    await page.waitForSelector('#conflictBanner:not([hidden])');
    assert.equal(await page.textContent('#conflictBannerText'), 'השינוי ל־דנה כהן לא נשמר — יעל עדכן/ה קודם. הנתונים רועננו.');
    await page.waitForFunction(() => true);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(seen.saves, 1, 'no automatic retry');
    assert.equal(seen.lastSave.clients[0].updatedAt, OLD_AT, 'the tab echoed the updatedAt it loaded');
    await page.click('#conflictBannerClose');
    assert.equal(await page.isHidden('#conflictBanner'), true);
    // 5. החלף -> logout -> PIN screen (name forgotten)
    await page.click('#switchUserBtn');
    await page.waitForSelector('#pinScreen:not([hidden])');
    assert.equal(seen.logouts, 1);
    assert.equal(await page.isHidden('#app'), true);
    assert.equal(await page.isHidden('#userScreen'), true);
  } finally {
    await browser.close();
    srv.close();
  }
});

test('F: e2e — a remembered EDITOR session whose cookie has no name gets the PIN -> picker once; one that has a name goes straight in with the header set', skipOpt, async (t) => {
  const { srv, port, seen } = await startStub();
  let browser;
  try { browser = await chromium.launch(); } catch (_) { srv.close(); return t.skip('no browser binary'); }
  try {
    // user-less cookie + remembered editor role
    const ctx1 = await browser.newContext();
    await ctx1.addCookies([{ name: 'ezone_session', value: '', url: 'http://127.0.0.1:' + port }]);
    const p1 = await ctx1.newPage();
    await p1.addInitScript(() => { try { sessionStorage.setItem('ez_role', 'editor'); } catch (_) {} });
    await p1.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'networkidle' });
    await p1.waitForSelector('#pinScreen:not([hidden])');
    assert.equal(await p1.isHidden('#app'), true, 'sent through the PIN once');
    await p1.fill('#pinInput', '424242');
    await p1.click('#pinSubmit');
    await p1.waitForSelector('#userScreen:not([hidden]) .user-btn');
    await p1.click('#userButtons .user-btn >> text=ורד');
    await p1.waitForSelector('#sessionUser:not([hidden])');
    assert.equal(await p1.textContent('#sessionUserName'), 'ורד');
    assert.equal(seen.logins.length, 2);
    // named cookie + remembered editor role -> no PIN, no picker, header set
    const ctx2 = await browser.newContext();
    await ctx2.addCookies([{ name: 'ezone_session', value: encodeURIComponent('יעל'), url: 'http://127.0.0.1:' + port }]);
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => { try { sessionStorage.setItem('ez_role', 'editor'); } catch (_) {} });
    await p2.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'networkidle' });
    await p2.waitForSelector('#sessionUser:not([hidden])');
    assert.equal(await p2.textContent('#sessionUserName'), 'יעל');
    assert.equal(await p2.isHidden('#pinScreen'), true);
    assert.equal(await p2.isHidden('#userScreen'), true);
    assert.equal(seen.logins.length, 2, 'no login round-trip for a named session');
    // a remembered VIEWER with a user-less cookie never sees the picker
    const ctx3 = await browser.newContext();
    await ctx3.addCookies([{ name: 'ezone_session', value: '', url: 'http://127.0.0.1:' + port }]);
    const p3 = await ctx3.newPage();
    await p3.addInitScript(() => { try { sessionStorage.setItem('ez_role', 'viewer'); } catch (_) {} });
    await p3.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'networkidle' });
    await p3.waitForSelector('#app:not([hidden])');
    assert.equal(await p3.isHidden('#pinScreen'), true);
    assert.equal(await p3.isHidden('#userScreen'), true);
    assert.equal(await p3.isHidden('#sessionUser'), true, 'no name -> no header line');
  } finally {
    await browser.close();
    srv.close();
  }
});
