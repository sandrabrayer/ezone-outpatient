'use strict';

/**
 * Session cookie + who/when stamping (session-who-when PR — port of the
 * E-Zone-Dashboard design in PRs #113/#114).
 *
 * Locked contracts:
 *   A. lib/session.js — legacy `<expiry>.<sig>` tokens validate byte-for-byte;
 *      the user-bearing `<expiry>.<userB64>.<sig>` form validates and reads the
 *      Hebrew name back; a tampered name segment is rejected; an empty secret
 *      fails closed (create throws, verify is false).
 *   B. server.js — POST /api/verify-pin mints an HttpOnly / SameSite=Lax /
 *      7-day cookie (Secure behind HTTPS); an optional `user` is accepted ONLY
 *      from lib/users.js SESSION_USERS (anything else -> the legacy user-less
 *      token); GET /api/me round-trips it; /api/sheets GET+POST,
 *      /api/continuation-roster and /api/debug/* answer 401 without a cookie;
 *      POST /api/sheets ALWAYS overwrites body.user from the cookie;
 *      /api/logout expires the cookie; /healthz stays open.
 *   C. Code.gs schema — CLIENTS_HEADERS and LEADS_HEADERS (and their tombstone
 *      mirrors) END with updatedAt, updatedBy (append-only); the two columns
 *      are text-forced on ensure + write.
 *   D. Code.gs _saveAll — changed row stamped (now + user), unchanged row keeps
 *      the SHEET's stamps, new row stamped, payload stamps never trusted,
 *      preserved (merge-don't-drop) rows untouched; same for Leads; an explicit
 *      delete stamps the deleter onto the tombstone.
 *   E. Every single-cell Clients writer stamps its row (blank user for the
 *      cross-app receivers).
 *   F. Cross-app endpoints: no Railway route serves another app (verified in
 *      Phase 1 — therapists/dashboard call the Apps Script /exec directly), so
 *      the Apps Script secret gates are the cross-app contract: each stays
 *      exactly as secret-gated as before and needs no session.
 *   G. public/app.js — every /api data call goes through apiFetch (401 -> PIN
 *      screen, one handler); the PIN call does not; stamps round-trip.
 *
 * The Code.gs tests run the REAL shipped file in a vm sandbox with in-memory
 * sheets (the corrupted-rows-cleanup / stale-next-billing-repair harness
 * pattern). No live backend, no real secret — dummy fixtures only.
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
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// ---- server env (must be set BEFORE server.js is required) ------------------
const TEST_PORT = 31842;
const DUMMY_PIN = '424242';
const DUMMY_SHEETS_URL = 'https://script.example.com/macros/s/AKfycbDUMMY/exec';
const SECRET = 'test-session-secret-0123456789abcdef0123456789';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.SHEETS_URL = DUMMY_SHEETS_URL;
process.env.SESSION_SECRET = SECRET;
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;

// Upstream is mocked: capture the body the proxy forwards to Apps Script.
let lastUpstream = null;
global.fetch = async (url, init) => {
  lastUpstream = { url, body: init && init.body ? JSON.parse(init.body) : null };
  return { status: 200, text: async () => JSON.stringify({ ok: true, mocked: true }) };
};

const { createSessionToken, verifySessionToken, readSessionUser, DEFAULT_TTL_SECONDS } = require('../lib/session');
const { SESSION_USERS } = require('../lib/users');
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
function setCookieOf(res) { return (res.headers['set-cookie'] || [])[0] || ''; }
function cookieOf(res) { return setCookieOf(res).split(';')[0]; }
async function login(user, extraHeaders) {
  const body = user === undefined ? { pin: DUMMY_PIN } : { pin: DUMMY_PIN, user };
  const res = await request('POST', '/api/verify-pin', body, extraHeaders);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  return res;
}

/* ================= A. lib/session.js tokens ================= */

test('A: legacy user-less token (2-part) still validates byte-for-byte and reads back an empty user', () => {
  const token = createSessionToken(SECRET);
  assert.equal(token.split('.').length, 2);
  assert.equal(verifySessionToken(token, SECRET), true);
  assert.equal(readSessionUser(token, SECRET), '');
  assert.equal(DEFAULT_TTL_SECONDS, 7 * 24 * 60 * 60, 'TTL is 7 days');
});

test('A: user-bearing token (3-part) validates and returns the Hebrew name', () => {
  const token = createSessionToken(SECRET, undefined, undefined, 'ורד');
  assert.equal(token.split('.').length, 3, 'expiry.userB64.sig — inside the signed payload');
  assert.equal(verifySessionToken(token, SECRET), true);
  assert.equal(readSessionUser(token, SECRET), 'ורד');
});

test('A: a tampered user segment is rejected (the signature covers the name); expiry and wrong secret too', () => {
  const token = createSessionToken(SECRET, undefined, undefined, 'ורד');
  const [expiry, , sig] = token.split('.');
  const forged = expiry + '.' + Buffer.from('האקר', 'utf8').toString('base64url') + '.' + sig;
  assert.equal(verifySessionToken(forged, SECRET), false);
  assert.equal(readSessionUser(forged, SECRET), '');
  assert.equal(verifySessionToken(createSessionToken(SECRET, -10, undefined, 'ורד'), SECRET), false, 'expired');
  assert.equal(verifySessionToken(token, 'other-secret'), false, 'wrong secret');
  assert.equal(verifySessionToken('123.deadbeef', SECRET), false, 'garbage');
});

test('A: missing SESSION_SECRET fails closed — create throws, verify/read never succeed', () => {
  assert.throws(() => createSessionToken(''), /SESSION_SECRET/);
  assert.throws(() => createSessionToken(undefined), /SESSION_SECRET/);
  const token = createSessionToken(SECRET, undefined, undefined, 'ורד');
  assert.equal(verifySessionToken(token, ''), false);
  assert.equal(verifySessionToken(token, undefined), false);
  assert.equal(readSessionUser(token, ''), '');
  assert.equal(server.sessionAuthStatus('ezone_session=' + token, ''), 'not_configured');
});

/* ================= B. server.js session routes ================= */

test('B: SESSION_USERS equals the index.html assignedTo options (nothing invented)', () => {
  const m = INDEX.match(/<select name="assignedTo"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(m, 'assignedTo select missing');
  const options = Array.from(m[1].matchAll(/<option(?:[^>]*)>([^<]*)<\/option>/g))
    .map((x) => x[1].trim()).filter((v) => v && v !== '—');
  assert.deepEqual(SESSION_USERS, options);
  assert.deepEqual(SESSION_USERS, ['ורד', 'שירן', 'יעל']);
});

test('B: verify-pin sets an HttpOnly SameSite=Lax 7-day cookie; Secure only behind HTTPS', async () => {
  await waitForListen();
  const plain = await login();
  const sc = setCookieOf(plain);
  assert.match(sc, /^ezone_session=\d+\.[0-9a-f]{64}; /, 'legacy user-less token when no user is sent');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Path=\//);
  assert.match(sc, /Max-Age=604800/);
  assert.doesNotMatch(sc, /Secure/, 'plain HTTP (local dev) omits Secure');
  const https = await login(undefined, { 'x-forwarded-proto': 'https' });
  assert.match(setCookieOf(https), /; Secure$/, 'Railway TLS termination -> Secure');
  assert.equal(server.requestIsHttps({ headers: { 'x-forwarded-proto': 'https' } }), true);
  assert.equal(server.requestIsHttps({ headers: {}, secure: true }), true);
  assert.equal(server.requestIsHttps({ headers: {} }), false);
});

test('B: wrong PIN -> 401 and no cookie; the rate limiter is unchanged', async () => {
  await waitForListen();
  const res = await request('POST', '/api/verify-pin', { pin: '000000', user: 'ורד' });
  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
  assert.equal(setCookieOf(res), '', 'no cookie on a wrong PIN');
  assert.match(SERVER_SRC, /PIN_RATE_LIMIT_MAX = 10/);
  assert.match(SERVER_SRC, /PIN_RATE_LIMIT_WINDOW_MS = 15 \* 60 \* 1000/);
  await login(); // reset this IP's counter for the sibling tests
});

test('B: user accepted ONLY from SESSION_USERS — listed name rides inside the signed cookie, anything else -> legacy token', async () => {
  await waitForListen();
  const listed = await login('ורד');
  const tok = cookieOf(listed).split('=')[1];
  assert.equal(tok.split('.').length, 3);
  assert.equal(readSessionUser(tok, SECRET), 'ורד');
  for (const bad of ['someone', 'ורד לוי', '<script>', 'admin', '']) {
    const res = await login(bad);
    assert.equal(cookieOf(res).split('=')[1].split('.').length, 2, 'unlisted "' + bad + '" -> user-less legacy token');
  }
  // a listed name survives trimming (the picker never sends padding, but the sanitizer must not break it)
  assert.equal(cookieOf(await login('  שירן ')).split('=')[1].split('.').length, 3);
  assert.equal(server.validateSessionUser('יעל'), 'יעל');
  assert.equal(server.validateSessionUser('יעל2'), '');
  assert.equal(server.validateSessionUser(12345), '');
});

test('B: sanitizeSessionUser trims, caps at 40, strips angle brackets + control chars; Hebrew quotes survive', () => {
  assert.equal(server.sanitizeSessionUser('  ורד לוי  '), 'ורד לוי');
  assert.equal(server.sanitizeSessionUser('א'.repeat(60)).length, 40);
  assert.equal(server.sanitizeSessionUser('<script>ורד</script>'), 'scriptורד/script');
  assert.equal(server.sanitizeSessionUser('ורד '), 'ורד');
  assert.equal(server.sanitizeSessionUser('ד"ר ורד'), 'ד"ר ורד');
  assert.equal(server.sanitizeSessionUser(undefined), '');
});

test('B: /api/me round-trips the cookie user; legacy cookie -> ""; no cookie -> 401', async () => {
  await waitForListen();
  assert.equal((await request('GET', '/api/me')).status, 401);
  const named = await request('GET', '/api/me', null, { Cookie: cookieOf(await login('שירן')) });
  assert.equal(named.status, 200);
  assert.deepEqual(named.json, { ok: true, user: 'שירן' });
  const legacy = await request('GET', '/api/me', null, { Cookie: cookieOf(await login()) });
  assert.deepEqual(legacy.json, { ok: true, user: '' });
});

test('B: /api/sheets GET + POST, /api/continuation-roster and /api/debug/* are 401 without a cookie (and with a bad one); 200 with', async () => {
  await waitForListen();
  const bad = { Cookie: 'ezone_session=123.deadbeef' };
  const expired = { Cookie: 'ezone_session=' + createSessionToken(SECRET, -10) };
  for (const [method, p] of [['GET', '/api/sheets'], ['GET', '/api/sheets?action=getDebtStatus&secret=x'],
    ['POST', '/api/sheets'], ['GET', '/api/continuation-roster'], ['GET', '/api/debug/env'],
    ['GET', '/api/debug/routes'], ['GET', '/api/debug/last-load'], ['GET', '/api/debug/cache'],
    ['POST', '/api/debug/cache/clear']]) {
    const body = method === 'POST' ? { action: 'saveAll' } : null;
    for (const [label, h] of [['none', {}], ['garbage', bad], ['expired', expired]]) {
      const res = await request(method, p, body, h);
      assert.equal(res.status, 401, method + ' ' + p + ' with ' + label + ' cookie');
      assert.deepEqual(res.json, { ok: false, error: 'unauthorized' });
    }
  }
  const cookie = { Cookie: cookieOf(await login('יעל')) };
  assert.equal((await request('GET', '/api/sheets?fresh=1', null, cookie)).status, 200);
  assert.equal((await request('POST', '/api/sheets', { action: 'getData' }, cookie)).status, 200);
  assert.equal((await request('GET', '/api/debug/env', null, cookie)).status, 200);
  // roster proxy: the gate passes, then the (unset) roster config fails closed 500 as before
  const roster = await request('GET', '/api/continuation-roster', null, cookie);
  assert.equal(roster.status, 500);
  assert.match(roster.json.error, /DASHBOARD_SHEETS_URL and OCCUPANCY_SECRET/);
});

test('B: POST /api/sheets ALWAYS overwrites body.user from the cookie — a client-sent user never reaches Apps Script', async () => {
  await waitForListen();
  const named = { Cookie: cookieOf(await login('ורד')) };
  lastUpstream = null;
  const r1 = await request('POST', '/api/sheets', { action: 'saveAll', user: 'HACKER', leads: [], clients: [] }, named);
  assert.equal(r1.status, 200);
  assert.equal(lastUpstream.body.user, 'ורד');
  assert.equal(lastUpstream.body.action, 'saveAll');
  // legacy (user-less) cookie -> '' is forwarded, still overwriting the client value
  const legacy = { Cookie: cookieOf(await login()) };
  await request('POST', '/api/sheets', { action: 'savePaymentAmountOverride', user: 'HACKER', clientId: 'c1', paymentId: 'p1', amount: 5 }, legacy);
  assert.equal(lastUpstream.body.user, '');
  assert.equal(lastUpstream.body.action, 'savePaymentAmountOverride');
  // and a request that never mentioned user gets it set too
  await request('POST', '/api/sheets', { action: 'mergeClients', survivorId: 'a', dupIds: ['b'] }, named);
  assert.equal(lastUpstream.body.user, 'ורד');
  assert.match(SERVER_SRC, /body\.user = sessionUserFromRequest\(req\)/);
});

test('B: /api/logout expires the cookie; /healthz stays open; requireSession middleware unit', async () => {
  await waitForListen();
  const lo = await request('POST', '/api/logout');
  assert.equal(lo.status, 200);
  assert.match(setCookieOf(lo), /^ezone_session=; HttpOnly; SameSite=Lax; Path=\/; Max-Age=0$/);
  assert.deepEqual((await request('GET', '/healthz')).json, { ok: true });
  // middleware: valid -> next(); missing -> 401 without calling next()
  let called = false;
  server.requireSession({ headers: { cookie: 'ezone_session=' + createSessionToken(SECRET) } }, {}, () => { called = true; });
  assert.equal(called, true);
  const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
  let nextCalled = false;
  server.requireSession({ headers: {} }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(server.parseSessionCookie('a=1; ezone_session=TOK; b=2'), 'TOK');
  assert.equal(server.parseSessionCookie(undefined), '');
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
  const sheets = {};
  Object.keys(opts.sheets || {}).forEach((n) => { sheets[n] = fakeSheet(n, opts.sheets[n], log); });
  const props = Object.assign({}, opts.props || {});
  const ss = {
    getId: () => 'LIVE',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet(n) { sheets[n] = fakeSheet(n, [], log); return sheets[n]; }
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
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
  return { ctx, sheets, log, props };
}
let uuidSeq = 0;

function post(ctx, payload, params) {
  const out = ctx.doPost({ postData: { contents: JSON.stringify(payload) }, parameter: params || {} });
  return JSON.parse(out.getContent());
}
function headersOf(ctx, name) { return plain(ctx[name]); }
function rowsOf(sheet, headers) {
  return sheet._grid.slice(1).filter((r) => r.some((v) => v !== '' && v !== null && v !== undefined)).map((r) => {
    const o = {}; headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; }); return o;
  });
}
function rowFrom(headers, obj) { return headers.map((h) => (obj[h] === undefined ? '' : obj[h])); }
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// vm-realm arrays have a foreign Array prototype: flatten before strict deepEqual.
const plain = (x) => JSON.parse(JSON.stringify(x));

const OLD_AT = '2026-01-01T00:00:00.000Z';
function baseClients(ctx) {
  const H = ctx.CLIENTS_HEADERS;
  return [H.slice(),
    rowFrom(H, { id: 'c1', name: 'דנה כהן', phone: '0501234567', status: 'פעיל', notes: 'a', creditsOwed: 2, paymentAmountOverrides: '{"p1":100}', updatedAt: OLD_AT, updatedBy: 'ורד' }),
    rowFrom(H, { id: 'c2', name: 'יוסי לוי', phone: '0502223333', status: 'פעיל', notes: 'b', creditsOwed: 0, updatedAt: OLD_AT, updatedBy: 'שירן' }),
    rowFrom(H, { id: 'c3', name: 'רות', phone: '0503334444', status: 'פעיל', notes: 'c', creditsOwed: 0, updatedAt: '', updatedBy: '' })
  ];
}
function baseLeads(ctx) {
  const H = ctx.LEADS_HEADERS;
  return [H.slice(),
    rowFrom(H, { id: 'l1', name: 'ליד א', phone: '0509990001', stage: 'new', updatedAt: OLD_AT, updatedBy: 'יעל' }),
    rowFrom(H, { id: 'l2', name: 'ליד ב', phone: '0509990002', stage: 'new', updatedAt: OLD_AT, updatedBy: 'יעל' })
  ];
}

/* ================= C. schema ================= */

test('C: CLIENTS_HEADERS, LEADS_HEADERS and both tombstone mirrors END with updatedAt, updatedBy (append-only)', () => {
  const { ctx } = makeSandbox();
  for (const name of ['CLIENTS_HEADERS', 'LEADS_HEADERS', 'CLIENTS_REMOVED_HEADERS', 'REMOVED_LEADS_HEADERS']) {
    assert.deepEqual(headersOf(ctx, name).slice(-2), ['updatedAt', 'updatedBy'], name);
  }
  assert.equal(ctx.CLIENTS_HEADERS.length, 36);
  assert.equal(ctx.CLIENTS_HEADERS[33], 'paymentAmountOverrides', 'everything before the stamps unchanged');
  assert.equal(ctx.LEADS_HEADERS[ctx.LEADS_HEADERS.length - 3], 'assignedTo');
  assert.deepEqual(plain(ctx.CLIENTS_META_COLUMNS), ['id', 'updatedAt', 'updatedBy', 'creditsOwed', 'paymentAmountOverrides']);
  assert.deepEqual(plain(ctx.LEADS_META_COLUMNS), ['id', 'updatedAt', 'updatedBy']);
});

test('C: _ensureSheet adds the headers to a legacy sheet and text-forces the two stamp columns; _writeAll text-forces them too', () => {
  const { ctx, sheets, log } = makeSandbox();
  const H = ctx.CLIENTS_HEADERS;
  // legacy sheet: 34 headers, one row
  sheets.Clients = fakeSheet('Clients', [H.slice(0, 34), rowFrom(H.slice(0, 34), { id: 'c1', name: 'x' })], log);
  const sh = ctx._ensureSheet('Clients', H);
  assert.deepEqual(plain(sh._grid[0]), plain(H), 'header row relabelled with the appended columns');
  const AT = H.indexOf('updatedAt') + 1, BY = H.indexOf('updatedBy') + 1, PH = H.indexOf('phone') + 1;
  const fmtCols = log.filter((w) => w.kind === 'fmt' && w.sheet === 'Clients' && w.fmt === '@').map((w) => w.col);
  assert.ok(fmtCols.includes(AT) && fmtCols.includes(BY), 'updatedAt/updatedBy text-forced on ensure');
  assert.ok(fmtCols.includes(PH), 'phone columns still text-forced');
  // legacy row reads back with blank stamps, nothing shifted
  const rows = ctx._readAll(sh, H);
  assert.equal(rows[0].name, 'x');
  assert.equal(rows[0].updatedAt, '');
  assert.equal(rows[0].updatedBy, '');
  log.length = 0;
  ctx._writeAll(sh, H, [{ id: 'c1', name: 'x', updatedAt: OLD_AT, updatedBy: 'ורד' }]);
  const wfmt = log.filter((w) => w.kind === 'fmt' && w.fmt === '@').map((w) => w.col);
  assert.ok(wfmt.includes(AT) && wfmt.includes(BY), 'text-forced before the write');
  assert.equal(ctx._readAll(sh, H)[0].updatedAt, OLD_AT);
  assert.ok(ctx.STAMP_COLUMNS.updatedAt && ctx.STAMP_COLUMNS.updatedBy);
});

/* ================= D. _saveAll stamping ================= */

test('D: _clientDiffCols / _leadDiffCols ignore meta columns; a real change shows; helpers stamp ISO + user', () => {
  const { ctx } = makeSandbox();
  const a = { id: 'c1', name: 'דנה', notes: 'x', creditsOwed: 1, paymentAmountOverrides: '{"p":1}', updatedAt: OLD_AT, updatedBy: 'ורד' };
  const b = { id: 'OTHER', name: 'דנה', notes: 'x', creditsOwed: 9, paymentAmountOverrides: '', updatedAt: 'forged', updatedBy: 'forged' };
  assert.deepEqual(plain(ctx._clientDiffCols(a, b)), [], 'meta-only differences are not an edit');
  assert.deepEqual(plain(ctx._clientDiffCols(a, Object.assign({}, b, { notes: 'y' }))), ['notes']);
  assert.deepEqual(plain(ctx._clientDiffCols({ pricePerSession: 400 }, { pricePerSession: '400' })), [], 'number vs numeric string is equal');
  assert.deepEqual(plain(ctx._leadDiffCols({ id: 'l', name: 'a', updatedAt: '1' }, { id: 'm', name: 'a', updatedBy: 'z' })), []);
  assert.deepEqual(plain(ctx._leadDiffCols({ name: 'a' }, { name: 'b' })), ['name']);
  const row = ctx._stampRow({ id: 'x' }, 'ורד');
  assert.match(row.updatedAt, ISO_RE);
  assert.equal(row.updatedBy, 'ורד');
  assert.equal(ctx._stampRow({}, undefined).updatedBy, '');
  assert.equal(ctx._requestUser({ user: '  <ורד> ' }), 'ורד');
  assert.equal(ctx._requestUser({ user: 'א'.repeat(50) }).length, 40);
  assert.equal(ctx._requestUser({}), '');
  assert.equal(ctx._requestUser(null), '');
});

test('D: _saveAll via doPost — changed row stamped now+user, unchanged row keeps the SHEET stamps, new row stamped, payload stamps ignored', () => {
  const { ctx, sheets } = makeSandbox();
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), []);
  sheets.Leads = fakeSheet('Leads', baseLeads(ctx), []);
  const before = Date.now();
  const res = post(ctx, {
    action: 'saveAll',
    user: 'שירן', // what the Railway proxy injects from the cookie
    clients: [
      // c1: real change (notes) + forged stamps + stale server-managed cells
      { id: 'c1', name: 'דנה כהן', phone: '0501234567', status: 'פעיל', notes: 'EDITED', creditsOwed: 99, paymentAmountOverrides: '', updatedAt: 'forged', updatedBy: 'HACKER' },
      // c2: pure echo of the sheet row (forged stamps only)
      { id: 'c2', name: 'יוסי לוי', phone: '0502223333', status: 'פעיל', notes: 'b', creditsOwed: 0, updatedAt: 'forged', updatedBy: 'HACKER' },
      // c3: echo of a never-stamped row
      { id: 'c3', name: 'רות', phone: '0503334444', status: 'פעיל', notes: 'c', creditsOwed: 0 },
      // c4: brand new
      { id: 'c4', name: 'חדש', phone: '0504445555', status: 'פעיל', notes: '', updatedAt: 'forged', updatedBy: 'HACKER' }
    ],
    leads: [
      { id: 'l1', name: 'ליד א', phone: '0509990001', stage: 'new', updatedAt: 'forged', updatedBy: 'HACKER' }, // echo
      { id: 'l2', name: 'ליד ב שונה', phone: '0509990002', stage: 'new' },                                    // changed
      { id: 'l3', name: 'ליד חדש', phone: '0509990003', stage: 'new' }                                          // new
    ]
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.stamped, { clients: 2, leads: 2 });
  const C = rowsOf(sheets.Clients, ctx.CLIENTS_HEADERS);
  const by = {}; C.forEach((r) => { by[r.id] = r; });
  // changed -> stamped now + the cookie user
  assert.equal(by.c1.notes, 'EDITED');
  assert.match(by.c1.updatedAt, ISO_RE);
  assert.ok(Date.parse(by.c1.updatedAt) >= before - 1000);
  assert.equal(by.c1.updatedBy, 'שירן');
  // server-managed cells still preserved by id (the payload's 99/'' never landed)
  assert.equal(String(by.c1.creditsOwed), '2');
  assert.equal(by.c1.paymentAmountOverrides, '{"p1":100}');
  // unchanged echo -> the SHEET's stamps, never the forged ones
  assert.equal(by.c2.updatedAt, OLD_AT);
  assert.equal(by.c2.updatedBy, 'שירן');
  assert.equal(by.c3.updatedAt, '', 'never-stamped unchanged row stays unstamped');
  assert.equal(by.c3.updatedBy, '');
  // new -> stamped (forged payload stamps discarded)
  assert.match(by.c4.updatedAt, ISO_RE);
  assert.equal(by.c4.updatedBy, 'שירן');
  // Leads: same rules
  const L = rowsOf(sheets.Leads, ctx.LEADS_HEADERS);
  const lby = {}; L.forEach((r) => { lby[r.id] = r; });
  assert.equal(lby.l1.updatedAt, OLD_AT); assert.equal(lby.l1.updatedBy, 'יעל');
  assert.match(lby.l2.updatedAt, ISO_RE); assert.equal(lby.l2.updatedBy, 'שירן');
  assert.match(lby.l3.updatedAt, ISO_RE); assert.equal(lby.l3.updatedBy, 'שירן');
});

test('D: legacy (user-less) cookie stamps a changed row with a blank updatedBy — allowed by contract; a forged user never lands', () => {
  const { ctx, sheets } = makeSandbox();
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), []);
  sheets.Leads = fakeSheet('Leads', baseLeads(ctx), []);
  // the proxy forwards user:'' for a legacy cookie; a client can't smuggle one in another key
  post(ctx, { action: 'saveAll', user: '', clients: [{ id: 'c1', name: 'דנה כהן', phone: '0501234567', status: 'פעיל', notes: 'EDITED', updatedBy: 'HACKER' }], leads: [] });
  const c1 = rowsOf(sheets.Clients, ctx.CLIENTS_HEADERS).find((r) => r.id === 'c1');
  assert.match(c1.updatedAt, ISO_RE);
  assert.equal(c1.updatedBy, '');
});

test('D: preserved (merge-don\'t-drop) rows are never re-stamped; an explicit delete stamps the DELETER onto the tombstone', () => {
  const { ctx, sheets } = makeSandbox();
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), []);
  sheets.Leads = fakeSheet('Leads', baseLeads(ctx), []);
  // stale tab: sends only c1 (unchanged); c2 is omitted (-> preserved), c3 explicitly deleted
  const res = post(ctx, {
    action: 'saveAll', user: 'יעל',
    clients: [{ id: 'c1', name: 'דנה כהן', phone: '0501234567', status: 'פעיל', notes: 'a', creditsOwed: 2, paymentAmountOverrides: '{"p1":100}' }],
    leads: [], explicitRemovedIds: ['c3']
  });
  assert.equal(res.ok, true);
  assert.equal(res.preserved, 1);
  assert.deepEqual(res.stamped, { clients: 0, leads: 0 });
  const C = rowsOf(sheets.Clients, ctx.CLIENTS_HEADERS);
  const c2 = C.find((r) => r.id === 'c2');
  assert.equal(c2.updatedAt, OLD_AT, 'preserved row keeps its own stamps');
  assert.equal(c2.updatedBy, 'שירן');
  assert.equal(C.find((r) => r.id === 'c3'), undefined, 'explicit delete actually dropped');
  const T = rowsOf(sheets['Clients-removed'], ctx.CLIENTS_REMOVED_HEADERS);
  const del = T.find((t) => t.id === 'c3');
  assert.equal(del.removedVia, 'explicit-delete');
  assert.match(del.updatedAt, ISO_RE);
  assert.equal(del.updatedBy, 'יעל', 'the tombstone names the deleter');
  assert.equal(del.updatedAt, del.removedAt);
  const pres = T.find((t) => t.id === 'c2');
  assert.equal(pres.removedVia, 'saveAll-diff-preserved');
  assert.equal(pres.updatedAt, OLD_AT, 'preserve-log snapshot keeps the row\'s OWN stamps');
  assert.equal(pres.updatedBy, 'שירן');
});

/* ================= E. single-cell + other Clients/Leads writers ================= */

test('E: _writeCreditsOwed / _writePaymentAmountOverride / _writeNextBillingDate stamp the row with two single-cell writes (no _writeAll)', () => {
  const { ctx, sheets, log } = makeSandbox();
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), log);
  const H = ctx.CLIENTS_HEADERS;
  const AT = H.indexOf('updatedAt') + 1, BY = H.indexOf('updatedBy') + 1;
  const sh = sheets.Clients;
  log.length = 0;
  assert.equal(ctx._writeCreditsOwed(sh, 'c2', 3, ''), true);
  let c2 = rowsOf(sh, H).find((r) => r.id === 'c2');
  assert.equal(c2.creditsOwed, 3);
  assert.match(c2.updatedAt, ISO_RE);
  assert.equal(c2.updatedBy, '', 'cross-app receiver stamps WHEN only');
  assert.deepEqual(log.map((w) => w.kind), ['setValue', 'setValue', 'setValue'], 'three single-cell writes, no setValues');
  assert.deepEqual(log.slice(1).map((w) => [w.row, w.col]), [[3, AT], [3, BY]]);

  log.length = 0;
  assert.equal(ctx._writePaymentAmountOverride(sh, 'c1', 'p2', 250, 'ורד'), true);
  const c1 = rowsOf(sh, H).find((r) => r.id === 'c1');
  assert.deepEqual(JSON.parse(c1.paymentAmountOverrides), { p1: 100, p2: 250 });
  assert.match(c1.updatedAt, ISO_RE);
  assert.equal(c1.updatedBy, 'ורד');
  assert.equal(log.filter((w) => w.kind === 'setValues').length, 0);

  log.length = 0;
  assert.equal(ctx._writeNextBillingDate(sh, 'c3', '2026-10-01', 'יעל'), true);
  const c3 = rowsOf(sh, H).find((r) => r.id === 'c3');
  assert.equal(c3.nextBillingDate, '2026-10-01');
  assert.match(c3.updatedAt, ISO_RE);
  assert.equal(c3.updatedBy, 'יעל');
  // untouched rows keep their stamps
  c2 = rowsOf(sh, H).find((r) => r.id === 'c2');
  assert.equal(c2.updatedBy, '');
  // no-hit is fail-soft: nothing written
  log.length = 0;
  assert.equal(ctx._writeCreditsOwed(sh, 'ghost', 1, 'ורד'), false);
  assert.equal(ctx._stampClientRow(sh, 'ghost', 'ורד'), false);
  assert.deepEqual(log, []);
});

test('E: savePaymentAmountOverride (browser, via doPost) stamps with the proxy-injected user; repairStaleNextBilling passes it through', () => {
  const { ctx, sheets } = makeSandbox();
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), []);
  const res = post(ctx, { action: 'savePaymentAmountOverride', user: 'שירן', clientId: 'c2', paymentId: 'p9', amount: 300 });
  assert.equal(res.ok, true);
  const c2 = rowsOf(sheets.Clients, ctx.CLIENTS_HEADERS).find((r) => r.id === 'c2');
  assert.equal(c2.updatedBy, 'שירן');
  assert.match(c2.updatedAt, ISO_RE);
  assert.match(GS, /_repairStaleNextBilling\(rsApply, payload && payload\.today, _requestUser\(payload\)\)/);
  assert.match(GS, /_writeNextBillingDate\(clientsSh, f\.id, f\.to, user\)/);
});

test('E: cross-app receivers (deactivateClient, setClinicalType, recordSessionOutcome) stamp WHEN with a blank user even if the caller sends one', () => {
  const { ctx, sheets } = makeSandbox({ props: { DEACTIVATE_CLIENT_SECRET: 'dsec', CLINICAL_TYPE_SECRET: 'csec' } });
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), []);
  const H = ctx.CLIENTS_HEADERS;
  // deactivateClient: single-cell status write + stamp
  let res = post(ctx, { action: 'deactivateClient', secret: 'dsec', phone: '0502223333', user: 'HACKER' });
  assert.equal(res.ok, true);
  assert.equal(res.deactivated, 1);
  let c2 = rowsOf(sheets.Clients, H).find((r) => r.id === 'c2');
  assert.equal(c2.status, ctx.DEACTIVATED_CLIENT_STATUS_HE);
  assert.match(c2.updatedAt, ISO_RE);
  assert.equal(c2.updatedBy, '');
  // setClinicalType: rewrites the matched client only (others keep stamps)
  const clinical = Object.keys(ctx.CLINICAL_TO_BILLING)[0];
  res = post(ctx, { action: 'setClinicalType', secret: 'csec', phone: '0501234567', clinicalTreatmentType: clinical, user: 'HACKER' });
  assert.equal(res.ok, true);
  const rows = rowsOf(sheets.Clients, H);
  const c1 = rows.find((r) => r.id === 'c1');
  assert.equal(c1.clinicalTreatmentType, clinical);
  assert.match(c1.updatedAt, ISO_RE);
  assert.equal(c1.updatedBy, '');
  assert.equal(rows.find((r) => r.id === 'c3').updatedAt, '', 'unmatched rows untouched');
  // recordSessionOutcome: the secured receiver blanks user before the engine runs
  assert.match(GS, /_recordSessionOutcome\(Object\.assign\(\{\}, payload, \{ user: '' \}\)\)/);
  assert.match(GS, /_writeCreditsOwed\(clientsSh, clientId, balance, _requestUser\(payload\)\)/);
  // the internal correctSessionOutcome path (proxy-injected user) still passes payload through
  assert.match(GS, /if \(action === 'correctSessionOutcome'\) \{[\s\S]*?return _json\(_recordSessionOutcome\(payload\)\);/);
});

test('E: mergeClients stamps the survivor (dups dropped, others untouched); restoreRemovedClient stamps the restored row', () => {
  const { ctx, sheets } = makeSandbox();
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), []);
  const H = ctx.CLIENTS_HEADERS;
  sheets.Payments = fakeSheet('Payments', [ctx.PAYMENTS_HEADERS.slice()], []);
  sheets.ClientCharges = fakeSheet('ClientCharges', [ctx.CHARGES_HEADERS.slice()], []);
  let res = post(ctx, { action: 'mergeClients', user: 'ורד', survivorId: 'c1', dupIds: ['c2'] });
  assert.equal(res.ok, true);
  let rows = rowsOf(sheets.Clients, H);
  assert.equal(rows.find((r) => r.id === 'c2'), undefined);
  const c1 = rows.find((r) => r.id === 'c1');
  assert.match(c1.updatedAt, ISO_RE);
  assert.equal(c1.updatedBy, 'ורד');
  assert.equal(rows.find((r) => r.id === 'c3').updatedAt, '', 'untouched row keeps its (blank) stamps');
  // restore: a tombstone carrying old stamps comes back stamped with the restorer
  const RH = ctx.CLIENTS_REMOVED_HEADERS;
  sheets['Clients-removed'] = fakeSheet('Clients-removed', [RH.slice(),
    rowFrom(RH, { id: 'gone', name: 'מנשה', status: 'פעיל', removedAt: OLD_AT, removedVia: 'explicit-delete', restoredAt: '', updatedAt: OLD_AT, updatedBy: 'שירן' })], []);
  res = post(ctx, { action: 'restoreRemovedClient', user: 'יעל', id: 'gone' });
  assert.equal(res.ok, true);
  rows = rowsOf(sheets.Clients, H);
  const back = rows.find((r) => r.id === 'gone');
  assert.equal(back.name, 'מנשה');
  assert.match(back.updatedAt, ISO_RE);
  assert.notEqual(back.updatedAt, OLD_AT);
  assert.equal(back.updatedBy, 'יעל');
});

test('E: createLead (cross-app) stamps WHEN only; removeLead stamps the REMOVER onto the removed-leads tombstone', () => {
  const { ctx, sheets } = makeSandbox({ props: { CREATE_LEAD_SECRET: 'lsec' } });
  sheets.Leads = fakeSheet('Leads', baseLeads(ctx), []);
  let res = post(ctx, { action: 'createLead', secret: 'lsec', name: 'ליד מהדשבורד', phone: '0508887777', house: 'ramot', user: 'HACKER' });
  assert.equal(res.ok, true);
  const L = rowsOf(sheets.Leads, ctx.LEADS_HEADERS);
  const created = L.find((r) => r.id === res.id);
  assert.match(created.updatedAt, ISO_RE);
  assert.equal(created.updatedBy, '');
  assert.equal(created.name, 'ליד מהדשבורד');
  res = post(ctx, { action: 'removeLead', user: 'ורד', lead: { id: 'l1' } });
  assert.equal(res.ok, true);
  assert.equal(rowsOf(sheets.Leads, ctx.LEADS_HEADERS).find((r) => r.id === 'l1'), undefined);
  const tomb = rowsOf(sheets['לידים שהוסרו'], ctx.REMOVED_LEADS_HEADERS).find((r) => r.id === 'l1');
  assert.equal(tomb.originSheet, 'Leads');
  assert.match(tomb.removedAt, ISO_RE);
  assert.match(tomb.updatedAt, ISO_RE);
  assert.equal(tomb.updatedBy, 'ורד');
});

test('E: source-scan — every Clients write path stamps (no writer left behind)', () => {
  const fn = (name) => { const m = GS.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}')); assert.ok(m, name); return m[0]; };
  assert.match(fn('_writeCreditsOwed'), /_stampClientRowAt\(clientsSh, r \+ 2, user\)/);
  assert.match(fn('_writePaymentAmountOverride'), /_stampClientRowAt\(clientsSh, r \+ 2, user\)/);
  assert.match(fn('_writeNextBillingDate'), /_stampClientRowAt\(clientsSh, r \+ 2, user\)/);
  assert.match(fn('_deactivateClient'), /_stampClientRowAt\(sh, i \+ 2, ''\)/);
  assert.match(fn('_setClinicalType'), /_stampRow\(client, ''\)/);
  assert.match(fn('_mergeClients'), /_stampRow\(survivor, _requestUser\(payload\)\)/);
  assert.match(fn('_restoreRemovedClient'), /_stampRow\(tomb, _requestUser\(payload\)\)/);
  assert.match(fn('_createLead'), /_stampRow\(lead, ''\)/);
  assert.match(fn('_removeLead'), /_stampRow\(rowObj, user\)/);
  assert.match(fn('applyCorruptedRowRepairsNow'), /if \(target\.sheet === 'Clients'\) _stampClientRowAt\(sh, rowNum, ''\)/);
  const stampAt = fn('_stampClientRowAt');
  assert.match(stampAt, /CLIENTS_HEADERS\.indexOf\('updatedAt'\) \+ 1/);
  assert.match(stampAt, /CLIENTS_HEADERS\.indexOf\('updatedBy'\) \+ 1/);
  assert.doesNotMatch(stampAt, /getRange\([^,]+,\s*\d+\)/, 'never a hardcoded column');
  // doPost feeds the proxy-injected user into every internal writer
  assert.match(GS, /user: _requestUser\(payload\)\n\s*\}\)\);/, 'saveAll receives user');
  assert.match(GS, /_removeLead\(payload\.lead, _requestUser\(payload\)\)/);
});

/* ================= F. cross-app endpoints unchanged ================= */

test('F: no Railway route serves another app — the only open routes are /healthz, /api/verify-pin, /api/logout and static files', () => {
  // every /api route except verify-pin + logout is mounted behind requireSession
  const routes = [];
  server._router.stack.forEach((m) => {
    if (m.route) routes.push({ path: m.route.path, methods: Object.keys(m.route.methods), gated: m.route.stack.some((l) => l.handle === server.requireSession) });
  });
  const api = routes.filter((r) => r.path.indexOf('/api/') === 0);
  const open = api.filter((r) => !r.gated).map((r) => r.path).sort();
  assert.deepEqual(open, ['/api/debug/cache', '/api/debug/cache/clear', '/api/debug/env', '/api/debug/last-load', '/api/debug/routes', '/api/logout', '/api/verify-pin'].sort());
  // the debug routes are gated by the router-level app.use('/api/debug', requireSession)
  assert.match(SERVER_SRC, /app\.use\('\/api\/debug', requireSession\)/);
  for (const p of ['/api/sheets', '/api/continuation-roster', '/api/me']) {
    assert.ok(api.filter((r) => r.path === p).every((r) => r.gated), p + ' gated');
  }
  assert.ok(routes.some((r) => r.path === '/healthz' && !r.gated));
});

test('F: Apps Script cross-app receivers keep their own secret gates and need no session (each endpoint found in Phase 1)', () => {
  const secrets = {
    WINBACK_SECRET: 'w', DEBT_STATUS_SECRET: 'd', TREATMENT_PLANS_SECRET: 't', STOP_FLAG_SECRET: 'sf',
    CREATE_LEAD_SECRET: 'cl', CLINICAL_TYPE_SECRET: 'ct', DEACTIVATE_CLIENT_SECRET: 'dc', EXTRA_SESSION_SECRET: 'es',
    SESSION_OUTCOME_SECRET: 'so', STOP_ALERTS_SECRET: 'sa', COLUMN_REPAIR_SECRET: 'cr'
  };
  const { ctx, sheets } = makeSandbox({ props: secrets });
  sheets.Clients = fakeSheet('Clients', baseClients(ctx), []);
  sheets.Leads = fakeSheet('Leads', baseLeads(ctx), []);
  const cases = [
    ['getWinbackSource', 'w'], ['getDebtStatus', 'd'], ['getTreatmentPlans', 't'],
    ['flagStop', 'sf'], ['createLead', 'cl'], ['setClinicalType', 'ct'], ['deactivateClient', 'dc'],
    ['requestExtraSession', 'es'], ['recordSessionOutcome', 'so'], ['getStopAlerts', 'sa'],
    ['markStopAlertRead', 'sa'], ['markStopAlertUnread', 'sa']
  ];
  for (const [action, secret] of cases) {
    // without the secret: unauthorized — unchanged
    const denied = post(ctx, { action, phone: '0501234567', name: 'x' });
    assert.equal(denied.ok, false, action + ' without secret');
    assert.equal(denied.error, 'unauthorized', action + ' without secret');
    // with the secret: passes the gate (whatever the action then returns is
    // not 'unauthorized') — no cookie / user is involved anywhere here
    const allowed = post(ctx, { action, secret, phone: '0501234567', name: 'x' });
    assert.notEqual(allowed.error, 'unauthorized', action + ' with secret');
  }
  // resolveStopFlag with a secret = the secured therapists receiver
  const rs = post(ctx, { action: 'resolveStopFlag', secret: 'wrong', phone: '0501234567' });
  assert.equal(rs.ok, false);
  // the auth helpers do not know about sessions at all
  assert.doesNotMatch(GS, /ezone_session|\bSESSION_SECRET\b|requireSession|readSessionUser/);
});

/* ================= G. client ================= */

test('G: every /api data call in app.js goes through apiFetch (401 -> PIN screen); /api/verify-pin does not', () => {
  const raw = APP.match(/await fetch\('\/api\/[^']*'/g) || [];
  assert.deepEqual(raw, ["await fetch('/api/verify-pin'"], 'only the PIN call may use raw fetch');
  const wrapped = (APP.match(/await apiFetch\('\/api\/[^']*'/g) || []);
  assert.ok(wrapped.length >= 15, 'all data calls wrapped, got ' + wrapped.length);
  assert.ok(wrapped.some((s) => s.includes('/api/continuation-roster')));
  // one reusable handler: 401 -> forget the role, show the PIN screen, throw
  assert.match(APP, /async function apiFetch\(url, opts\) \{\s*var r = await fetch\(url, opts\);\s*if \(r\.status === 401\) \{ handleUnauthorized\(\); throw new Error\('unauthorized'\); \}/);
  assert.match(APP, /function handleUnauthorized\(\) \{[\s\S]*?sessionStorage\.removeItem\('ez_role'\)[\s\S]*?showPin\(\);/);
  // the PIN form itself is unchanged (sends only the PIN; the name picker is PR 2)
  assert.match(APP, /body: JSON\.stringify\(\{ pin: pin \}\)/);
  // logout also expires the server cookie
  assert.match(APP, /fetch\('\/api\/logout', \{ method: 'POST' \}\)/);
  // the load fired at init is refused until the PIN mints the cookie, so a
  // successful PIN (and the viewer button) loads the data if nothing loaded yet
  assert.match(APP, /state\.role = 'editor';\s*enterApp\(\);[\s\S]{0,300}?if \(!state\.loaded\) loadAll\(\)\.catch/);
  assert.match(APP, /state\.role = 'viewer';\s*enterApp\(\);[\s\S]{0,300}?if \(!state\.loaded\) loadAll\(\)\.catch/);
  // and the 401 path raises no error toast on top of the PIN screen
  assert.match(APP, /if \(!\(e && e\.message === 'unauthorized'\)\) toast\('שגיאה בטעינת הנתונים: '/);
});

test('G: normalize + serialize round-trip the who/when stamps defensively (blank when absent)', () => {
  for (const fn of ['normalizeLeadFromSheet', 'normalizeClientFromSheet', 'leadForSheet', 'clientForSheet']) {
    const m = APP.match(new RegExp('function ' + fn + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
    assert.ok(m, fn);
    assert.match(m[0], /updatedAt: \w+\.updatedAt \|\| ''/, fn + ' updatedAt');
    assert.match(m[0], /updatedBy: \w+\.updatedBy \|\| ''/, fn + ' updatedBy');
  }
});
