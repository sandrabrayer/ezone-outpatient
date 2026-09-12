'use strict';

/**
 * Add ירדן (Yarden) as an outpatient user.
 *
 * She is a NAME on the existing allow-list, not a new role: `lib/users.js`
 * SESSION_USERS is an allow-list of who may stamp `updatedBy`, and the only
 * roles in the app are editor/viewer — decided by which PIN button was used,
 * never by which name was picked. So the contract this file locks is
 * PARITY: every assertion that holds for ורד / שירן / יעל holds for ירדן,
 * and nothing about the existing three changed.
 *
 * Locked contracts:
 *   A. The list — ירדן is in SESSION_USERS, APPENDED last (the existing three
 *      keep their order), and the list still equals the index.html
 *      `assignedTo` options exactly. No second copy anywhere on the client.
 *   B. Server parity — /api/verify-pin accepts her exactly like the others
 *      (3-part token, same 7-day TTL), /api/me hands the name back,
 *      /api/users lists her. Near-miss spellings are still refused, including
 *      `לירדן` — the string the UNRELATED stop-alert copy uses.
 *   C. Stamping (real Code.gs in a vm) — a save by ירדן stamps
 *      updatedBy = 'ירדן' on a changed client, a changed lead and a new row,
 *      byte-identically to how it stamps the existing three.
 *   D. Conflict refusal parity — a stale tab of hers is refused like anyone
 *      else's, and a row SHE stamped refuses someone else's stale save with
 *      sheetUpdatedBy = 'ירדן'.
 *   E. Blast radius — she gets no therapist pay rate, and the stop-alert copy
 *      that already said "ירדן" (a different person-reference in the app) is
 *      untouched.
 *   F. public/sw.js — cache bumped v4 -> v5 (index.html changed).
 *
 * No live backend: the server runs locally on its own port, and Code.gs runs
 * in a vm sandbox over in-memory sheets (the session-who-when harness).
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
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
const USERS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'users.js'), 'utf8');

// ---- server env (must be set BEFORE server.js is required) ------------------
const TEST_PORT = 31845; // 31840-31844 are taken by the other server test files
const DUMMY_PIN = '424242';
const SECRET = 'test-session-secret-add-user-yarden-0123456789ab';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
process.env.SESSION_SECRET = SECRET;
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;

global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true, mocked: true }) });

const { DEFAULT_TTL_SECONDS, readSessionUser } = require('../lib/session');
const { SESSION_USERS } = require('../lib/users');
const server = require('../server');

const YARDEN = 'ירדן';
const LEGACY_THREE = ['ורד', 'שירן', 'יעל'];

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
const login = (user) => request('POST', '/api/verify-pin', user === undefined ? { pin: DUMMY_PIN } : { pin: DUMMY_PIN, user });

/* ================= A. the list ================= */

test('A: ירדן is on the allow-list, APPENDED last — the existing three keep their exact order', () => {
  assert.ok(SESSION_USERS.includes(YARDEN), 'ירדן must be a session user');
  assert.deepEqual(SESSION_USERS, LEGACY_THREE.concat([YARDEN]));
  assert.equal(SESSION_USERS.length, 4);
  assert.deepEqual(SESSION_USERS.slice(0, 3), LEGACY_THREE, 'no existing user moved, renamed or dropped');
  assert.equal(new Set(SESSION_USERS).size, SESSION_USERS.length, 'no duplicate names');
  SESSION_USERS.forEach((u) => assert.equal(typeof u, 'string', 'a flat list of names — never {name, role} objects'));
});

test('A: the list is still the ONLY source — lib/users.js exports nothing but SESSION_USERS (no role table)', () => {
  const mod = require('../lib/users');
  assert.deepEqual(Object.keys(mod), ['SESSION_USERS'], 'adding a user must not add a roles/permissions export');
  // Guard the CODE, not the prose: the header comment legitimately explains
  // that the list carries no roles, so strip comments before looking.
  const code = USERS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /role|permission|admin/i, 'no per-user role or permission crept into the list module');
  assert.equal((code.match(/const\s+\w+\s*=/g) || []).length, 1, 'still exactly one declaration — the names array');
});

test('A: SESSION_USERS still equals the index.html assignedTo options exactly (nothing invented, nothing missed)', () => {
  const m = INDEX.match(/<select name="assignedTo"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(m, 'assignedTo select missing');
  const options = Array.from(m[1].matchAll(/<option(?:[^>]*)>([^<]*)<\/option>/g))
    .map((x) => x[1].trim()).filter((v) => v && v !== '—');
  assert.deepEqual(options, SESSION_USERS, 'the dropdown and the allow-list must never drift');
  assert.equal((INDEX.match(/name="assignedTo"/g) || []).length, 1, 'still exactly one assignedTo select to keep in sync');
});

test('A: the picker keeps NO client-side copy — app.js still fills it from GET /api/users', () => {
  assert.match(APP, /async function apiUsers\(\)/);
  assert.match(APP, /apiFetch\('\/api\/users'/);
  // The picker must never gain a hardcoded name array that could drift from
  // lib/users.js. (ירדן also appears in app.js as the stop-alert recipient —
  // unrelated copy — so this looks for a LITERAL LIST, not a bare mention.)
  SESSION_USERS.forEach((u) => {
    assert.doesNotMatch(APP, new RegExp("\\[\\s*'" + u + "'"), 'no hardcoded user array in app.js for ' + u);
  });
});

/* ================= B. server parity ================= */

test('B: /api/users lists all four names, ירדן included, in list order', async () => {
  await waitForListen();
  const cookie = cookieOf(await login());
  const res = await request('GET', '/api/users', null, { Cookie: cookie });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, users: LEGACY_THREE.concat([YARDEN]) });
  assert.ok(res.json.users.includes(YARDEN), 'the picker will render a ירדן button');
});

test('B: ירדן logs in exactly like the existing three — same 3-part token, same 7-day TTL, /api/me hands the name back', async () => {
  await waitForListen();
  const results = [];
  for (const user of SESSION_USERS) {
    const res = await login(user);
    const token = tokenOf(res);
    const me = await request('GET', '/api/me', null, { Cookie: cookieOf(res) });
    results.push({
      user,
      status: res.status,
      parts: token.split('.').length,
      maxAge: maxAgeOf(res),
      cookies: setCookies(res).length,
      inToken: readSessionUser(token, SECRET),
      me: me.json
    });
  }
  // Every name — ירדן included — produces a byte-identical shape.
  results.forEach((r) => {
    assert.equal(r.status, 200, r.user + ' must log in');
    assert.equal(r.parts, 3, r.user + ' rides inside the signed token');
    assert.equal(r.maxAge, DEFAULT_TTL_SECONDS, r.user + ' gets the same 7-day TTL — no shorter, no longer');
    assert.equal(r.cookies, 1, r.user + ' gets exactly one cookie');
    assert.equal(r.inToken, r.user, r.user + ' is the name inside the token');
    assert.deepEqual(r.me, { ok: true, user: r.user }, '/api/me returns ' + r.user);
  });
  const yarden = results.find((r) => r.user === YARDEN);
  const shiran = results.find((r) => r.user === 'שירן');
  assert.deepEqual(
    { parts: yarden.parts, maxAge: yarden.maxAge, cookies: yarden.cookies },
    { parts: shiran.parts, maxAge: shiran.maxAge, cookies: shiran.cookies },
    'ירדן gets the SAME session shape as an existing user — no new privilege, no new limit'
  );
});

test('B: validateSessionUser accepts ירדן and still refuses every near-miss — including the stop-alert string לירדן', async () => {
  await waitForListen();
  assert.equal(server.validateSessionUser(YARDEN), YARDEN);
  assert.equal(server.validateSessionUser('  ירדן '), YARDEN, 'a listed name survives trimming');
  // `לירדן` ("to Yarden") is the UNRELATED stop-alert wording elsewhere in the
  // app — it must never be mistaken for the user name.
  for (const bad of ['לירדן', 'ירדןx', 'ירד', 'ירדן לוי', 'ירדן<script>', 'Yarden', '']) {
    assert.equal(server.validateSessionUser(bad), '', 'must refuse "' + bad + '"');
    const res = await login(bad);
    assert.equal(tokenOf(res).split('.').length, 2, 'unlisted "' + bad + '" -> user-less legacy token');
  }
  assert.equal(server.validateSessionUser(12345), '');
  assert.equal(server.validateSessionUser({ name: YARDEN }), '');
});

test('B: a wrong PIN with ירדן is still 401 with no cookie — the name is never a way in', async () => {
  await waitForListen();
  const res = await request('POST', '/api/verify-pin', { pin: '000000', user: YARDEN });
  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
  assert.equal(setCookies(res).length, 0, 'no cookie on a wrong PIN');
  await login(); // reset this IP's rate-limit counter for the sibling tests
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

let uuidSeq = 0;
function makeSandbox() {
  const log = [];
  const logger = [];
  const sheets = {};
  const props = {};
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
  return { ctx, sheets, log, logger, lock };
}

function post(ctx, payload) {
  return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(payload) }, parameter: {} }).getContent());
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

const C1 = { id: 'c1', name: 'דנה כהן', phone: '0501234567', status: 'פעיל', notes: 'a', creditsOwed: 2, paymentAmountOverrides: '{"p1":100}' };
const C2 = { id: 'c2', name: 'יוסי לוי', phone: '0502223333', status: 'פעיל', notes: 'b', creditsOwed: 0 };
const L1 = { id: 'l1', name: 'ליד א', phone: '0509990001', stage: 'new' };

/* A sheet whose two rows were last touched by ירדן, so a later save by
 * someone else meets HER stamps. */
function sandboxStampedBy(who) {
  const sb = makeSandbox();
  const CH = sb.ctx.CLIENTS_HEADERS;
  const LH = sb.ctx.LEADS_HEADERS;
  sb.sheets.Clients = fakeSheet('Clients', [CH.slice(),
    rowFrom(CH, Object.assign({}, C1, { updatedAt: OLD_AT, updatedBy: who })),
    rowFrom(CH, Object.assign({}, C2, { updatedAt: OLD_AT, updatedBy: who }))
  ], sb.log);
  sb.sheets.Leads = fakeSheet('Leads', [LH.slice(),
    rowFrom(LH, Object.assign({}, L1, { updatedAt: OLD_AT, updatedBy: who }))
  ], sb.log);
  return sb;
}
function saveAs(sb, user, clients, leads) {
  return post(sb.ctx, { action: 'saveAll', user, clients, leads: leads || [] });
}
function conflictLines(sb) {
  return sb.logger.filter((args) => String(args[0]).indexOf('[conflict]') === 0);
}

/* ================= C. stamping ================= */

test('C: a save by ירדן stamps updatedBy = "ירדן" on a changed client, a changed lead and a new row', () => {
  const sb = sandboxStampedBy('ורד');
  const res = saveAs(sb, YARDEN,
    [Object.assign({}, C1, { notes: 'ערוך על ידי ירדן', updatedAt: OLD_AT }), Object.assign({}, C2, { updatedAt: OLD_AT })],
    [Object.assign({}, L1, { name: 'ליד א שונה', updatedAt: OLD_AT }),
     { id: 'l9', name: 'ליד חדש', phone: '0509990009', stage: 'new' }]);
  assert.equal(res.ok, true);
  assert.equal(res.conflicts, undefined, 'a fresh echo is not a conflict');

  const C = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS));
  assert.equal(C.c1.notes, 'ערוך על ידי ירדן');
  assert.equal(C.c1.updatedBy, YARDEN, 'the changed client is stamped ירדן');
  assert.match(C.c1.updatedAt, ISO_RE, 'server clock, not the payload');
  assert.equal(C.c2.updatedBy, 'ורד', 'an unchanged row keeps its previous editor');
  assert.equal(C.c2.updatedAt, OLD_AT);

  const L = byId(rowsOf(sb.sheets.Leads, sb.ctx.LEADS_HEADERS));
  assert.equal(L.l1.updatedBy, YARDEN, 'the changed lead is stamped ירדן');
  assert.match(L.l1.updatedAt, ISO_RE);
  assert.equal(L.l9.updatedBy, YARDEN, 'a brand-new lead is stamped ירדן');
  assert.match(L.l9.updatedAt, ISO_RE);
  assert.deepEqual(res.stamped, { clients: 1, leads: 2 });
});

test('C: stamping is name-agnostic — ירדן produces byte-identical results to each existing user', () => {
  const perUser = SESSION_USERS.map((user) => {
    const sb = sandboxStampedBy('ורד');
    const res = saveAs(sb, user, [Object.assign({}, C1, { notes: 'שינוי', updatedAt: OLD_AT }), Object.assign({}, C2, { updatedAt: OLD_AT })]);
    const C = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS));
    return { user, stampedBy: C.c1.updatedBy, isoStamp: ISO_RE.test(C.c1.updatedAt), notes: C.c1.notes, stamped: plain(res.stamped), ok: res.ok };
  });
  perUser.forEach((r) => {
    assert.equal(r.ok, true);
    assert.equal(r.stampedBy, r.user, r.user + ' stamps her own name');
    assert.equal(r.isoStamp, true);
    assert.equal(r.notes, 'שינוי');
    assert.deepEqual(r.stamped, { clients: 1, leads: 0 });
  });
  // Everything except the name itself is identical across all four users.
  const shape = (r) => ({ isoStamp: r.isoStamp, notes: r.notes, stamped: r.stamped, ok: r.ok });
  const yarden = shape(perUser.find((r) => r.user === YARDEN));
  perUser.filter((r) => r.user !== YARDEN).forEach((r) => {
    assert.deepEqual(yarden, shape(r), 'ירדן must behave exactly like ' + r.user);
  });
});

/* ================= D. conflict refusal parity ================= */

test('D: a STALE save by ירדן is refused exactly like anyone else — sheet kept, conflicts populated, audit line names her', () => {
  const sb = sandboxStampedBy('ורד');
  const res = saveAs(sb, YARDEN, [
    Object.assign({}, C1, { notes: 'EDITED-STALE', updatedAt: OLDER_AT }), // loaded before ורד's edit
    Object.assign({}, C2, { updatedAt: OLD_AT })
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.conflicts), [
    { id: 'c1', name: 'דנה כהן', sheetUpdatedAt: OLD_AT, sheetUpdatedBy: 'ורד', changed: ['notes'] }
  ]);
  assert.deepEqual(res.stamped, { clients: 0, leads: 0 }, 'a refused row is not a stamped row');
  const C = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS));
  assert.equal(C.c1.notes, 'a', 'ירדן could NOT overwrite the newer edit');
  assert.equal(C.c1.updatedAt, OLD_AT);
  assert.equal(C.c1.updatedBy, 'ורד', 'the sheet keeps the real editor');
  assert.equal(String(C.c1.creditsOwed), '2', 'server-managed cells preserved');
  const lines = conflictLines(sb);
  assert.equal(lines.length, 1, 'one [conflict] audit line');
  assert.deepEqual(lines[0].slice(1, 5), ['client', 'c1', 'דנה כהן', 'notes']);
  assert.ok(lines[0].indexOf(YARDEN) > 0, 'the audit line names ירדן as the attempter');
});

test('D: a row ירדן stamped refuses someone else\'s stale save, reported as sheetUpdatedBy = "ירדן"', () => {
  const sb = sandboxStampedBy(YARDEN);
  const res = saveAs(sb, 'שירן',
    [Object.assign({}, C1, { notes: 'שירן דורסת', updatedAt: OLDER_AT }), Object.assign({}, C2, { updatedAt: OLD_AT })],
    [Object.assign({}, L1, { name: 'ליד א נדרס', updatedAt: OLDER_AT })]);
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.conflicts), [
    { id: 'c1', name: 'דנה כהן', sheetUpdatedAt: OLD_AT, sheetUpdatedBy: YARDEN, changed: ['notes'] },
    { id: 'l1', name: 'ליד א', sheetUpdatedAt: OLD_AT, sheetUpdatedBy: YARDEN, changed: ['name'] }
  ], 'ירדן is named as the person who edited first — clients before leads');
  const C = byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS));
  const L = byId(rowsOf(sb.sheets.Leads, sb.ctx.LEADS_HEADERS));
  assert.equal(C.c1.notes, 'a'); assert.equal(C.c1.updatedBy, YARDEN, 'her edit survives');
  assert.equal(L.l1.name, 'ליד א'); assert.equal(L.l1.updatedBy, YARDEN);
  assert.equal(conflictLines(sb).length, 2);
});

test('D: ירדן keeps the same escape hatches as everyone — a FRESH echo writes, a pure echo and a never-stamped row are last-writer-wins', () => {
  const sb = sandboxStampedBy(YARDEN);
  // fresh stamp + change -> written normally
  const fresh = saveAs(sb, 'יעל', [Object.assign({}, C1, { notes: 'טרי', updatedAt: OLD_AT }), Object.assign({}, C2, { updatedAt: OLD_AT })]);
  assert.equal(fresh.conflicts, undefined, 'a fresh stamp is never a conflict');
  assert.equal(byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS)).c1.notes, 'טרי');

  // a pre-stamping tab (empty echo) by ירדן still wins, as for any user
  const sb2 = sandboxStampedBy('ורד');
  const empty = saveAs(sb2, YARDEN, [Object.assign({}, C1, { notes: 'ללא חותמת', updatedAt: '' }), Object.assign({}, C2, { updatedAt: OLD_AT })]);
  assert.equal(empty.conflicts, undefined, 'empty seenStamp -> last-writer-wins, unchanged behaviour');
  const C2ROWS = byId(rowsOf(sb2.sheets.Clients, sb2.ctx.CLIENTS_HEADERS));
  assert.equal(C2ROWS.c1.notes, 'ללא חותמת');
  assert.equal(C2ROWS.c1.updatedBy, YARDEN);
});

/* ================= E. blast radius ================= */

test('E: ירדן is a USER, not a therapist — no pay rate was invented for her', () => {
  const { ctx } = makeSandbox();
  assert.equal(ctx.THERAPIST_FLAT_RATES[YARDEN], undefined, 'no flat therapist rate');
  assert.equal(ctx.PSYCHIATRIST_RATES[YARDEN], undefined, 'no psychiatrist rate');
  assert.ok(!Object.keys(ctx.THERAPIST_FLAT_RATES).some((k) => k.indexOf(YARDEN) >= 0), 'not under any longer spelling either');
  // Being on the login allow-list says nothing about being paid: שירן was
  // already a therapist before this change, יעל and ורד never were, and
  // adding ירדן must not have changed that either way.
  assert.ok(ctx.THERAPIST_FLAT_RATES['שירן'] > 0, 'שירן keeps her existing rate');
  assert.equal(ctx.THERAPIST_FLAT_RATES['יעל'], undefined);
  assert.equal(ctx.THERAPIST_FLAT_RATES['ורד'], undefined);
});

test('E: the UNRELATED stop-alert copy that already mentions ירדן is untouched', () => {
  // ירדן was already named in the app as the person stop alerts are sent TO.
  // Adding her as a login user must not have rewritten any of that wording.
  assert.match(APP, /toast\('נשלחה התראת עצירה לירדן'\)/);
  assert.match(INDEX, /התראה לירדן \(הפסקה זמנית, לא סיום טיפול\)/);
  assert.match(INDEX, /הערה לירדן \(רשות\)/);
});

test('E: the existing three still log in and still stamp — no regression from the addition', async () => {
  await waitForListen();
  for (const user of LEGACY_THREE) {
    const res = await login(user);
    assert.equal(readSessionUser(tokenOf(res), SECRET), user, user + ' still logs in');
    const sb = sandboxStampedBy('ורד');
    const saved = saveAs(sb, user, [Object.assign({}, C1, { notes: 'ok', updatedAt: OLD_AT }), Object.assign({}, C2, { updatedAt: OLD_AT })]);
    assert.equal(saved.ok, true);
    assert.equal(byId(rowsOf(sb.sheets.Clients, sb.ctx.CLIENTS_HEADERS)).c1.updatedBy, user, user + ' still stamps');
  }
});

/* ================= F. service worker ================= */

test('F: sw.js cache bumped v4 -> v5 (index.html changed) and the bump is documented', () => {
  assert.match(SW, /var CACHE = 'ezone-outpatient-v5';/);
  assert.doesNotMatch(SW, /var CACHE = 'ezone-outpatient-v4';/, 'only one live CACHE version');
  assert.match(SW, /v5 \(2026-09-12\)/, 'the bump is documented in the header comment');
  // monotonic: every version mentioned in the header is <= the live one
  const live = Number((SW.match(/var CACHE = 'ezone-outpatient-v(\d+)';/) || [])[1]);
  const mentioned = Array.from(SW.matchAll(/^ \* - v(\d+) \(/gm)).map((m) => Number(m[1]));
  assert.ok(mentioned.length >= 4, 'the header keeps the bump history');
  mentioned.forEach((v) => assert.ok(v <= live, 'v' + v + ' documented above the live v' + live));
  assert.equal(live, Math.max.apply(null, mentioned), 'the live cache is the newest documented version');
});
