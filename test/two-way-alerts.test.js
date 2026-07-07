'use strict';

/**
 * Two-way treatment alerts (stop + resume) with Vered-side undo.
 *
 * Backend ('התראות עצירת טיפול' sheet):
 *   - STOP_ALERTS_HEADERS gained 'type' then 'cancelledAt' (append-only; a legacy
 *     row reads type:'' → treated as 'stop', cancelledAt:'').
 *   - createStopAlert writes type:'stop'.
 *   - resumeTreatmentAlert (INTERNAL, no secret): atomically cancels this client's
 *     UNREAD 'stop' rows, and — only if a 'stop' was already READ — appends a NEW
 *     'resume' row. Returns { ok, cancelled, resumeCreated }.
 *   - getMyStopAlerts (INTERNAL, no secret): minimal id/clientId/status/type only.
 *
 * Frontend: on an overdue row whose latest 'stop' alert is unread/read, a
 * 'נשלחה התראת עצירה' chip + 'חידוש טיפול' button appears (editor); confirming
 * fires resumeTreatmentAlert and the chip becomes 'נשלח חידוש' or 'ההתראה בוטלה'.
 *
 * Apps Script can't be imported, so the pure logic is mirrored against an
 * in-memory sheet (like test/stop-alerts.test.js) and source-guards lock Code.gs /
 * public/app.js. The Playwright e2e drives the REAL app and SKIPS gracefully when
 * no browser is available (env-dependent), so `npm test` still passes headless.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');

// ---- mirror of STOP_ALERTS_HEADERS + the two new actions --------------------
const HEADERS = ['id', 'clientId', 'clientName', 'createdAt', 'createdBy', 'status', 'readAt', 'note', 'reason', 'type', 'cancelledAt'];
const col = (n) => HEADERS.indexOf(n);
let seq = 0;
function createStopAlert(sheet, p) {
  const clientId = String((p && p.clientId) || '').trim();
  const clientName = String((p && p.clientName) || '').trim();
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  if (!clientName) return { ok: false, error: 'missing_client_name' };
  const alert = { id: 'stop-' + (++seq), clientId, clientName, createdAt: 'now', createdBy: (p.createdBy || ''),
    status: 'unread', readAt: '', note: (p.note || ''), reason: (p.reason || 'no_payment'), type: 'stop', cancelledAt: '' };
  sheet.push(HEADERS.map((h) => (alert[h] == null ? '' : alert[h])));
  return { ok: true, alert };
}
function resumeTreatmentAlert(sheet, p) {
  const clientId = String((p && p.clientId) || '').trim();
  const clientName = String((p && p.clientName) || '').trim();
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  if (!clientName) return { ok: false, error: 'missing_client_name' };
  let cancelled = 0, hadReadStop = false;
  for (const r of sheet) {
    if (String(r[col('clientId')]) !== clientId) continue;
    const t = String(r[col('type')] || '');
    if (t !== '' && t !== 'stop') continue; // legacy '' == stop
    const st = String(r[col('status')] || '');
    if (st === 'unread') { r[col('status')] = 'cancelled'; r[col('cancelledAt')] = 'now'; cancelled++; }
    else if (st === 'read') hadReadStop = true;
  }
  let resumeCreated = false;
  if (hadReadStop) {
    const resume = { id: 'stop-' + (++seq), clientId, clientName, createdAt: 'now', createdBy: (p.createdBy || ''),
      status: 'unread', readAt: '', note: '', reason: '', type: 'resume', cancelledAt: '' };
    sheet.push(HEADERS.map((h) => (resume[h] == null ? '' : resume[h])));
    resumeCreated = true;
  }
  return { ok: true, cancelled, resumeCreated };
}
function getMyStopAlerts(sheet) {
  return { ok: true, myStopAlerts: sheet.map((r) => ({ id: r[col('id')], clientId: r[col('clientId')], status: r[col('status')], type: (r[col('type')] || 'stop') })) };
}

// ===========================================================================
// Backend behavior (mirror)
// ===========================================================================
test('createStopAlert writes an unread stop-type row (type:stop, cancelledAt empty)', () => {
  const sheet = [];
  const res = createStopAlert(sheet, { clientId: 'c1', clientName: 'דנה', reason: 'no_payment' });
  assert.equal(res.ok, true);
  assert.equal(sheet[0][col('type')], 'stop');
  assert.equal(sheet[0][col('status')], 'unread');
  assert.equal(sheet[0][col('cancelledAt')], '');
});

test('resumeTreatmentAlert cancels an UNREAD stop (no resume) — stamps cancelledAt', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'דנה' });
  const res = resumeTreatmentAlert(sheet, { clientId: 'c1', clientName: 'דנה' });
  assert.deepEqual({ ok: res.ok, cancelled: res.cancelled, resumeCreated: res.resumeCreated }, { ok: true, cancelled: 1, resumeCreated: false });
  assert.equal(sheet[0][col('status')], 'cancelled');
  assert.equal(sheet[0][col('cancelledAt')], 'now');
  assert.equal(sheet.length, 1, 'no resume row appended for an unread stop');
});

test('resumeTreatmentAlert on a READ stop leaves it read and appends a resume row', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'דנה' });
  sheet[0][col('status')] = 'read'; // Yarden saw it
  const res = resumeTreatmentAlert(sheet, { clientId: 'c1', clientName: 'דנה' });
  assert.deepEqual({ cancelled: res.cancelled, resumeCreated: res.resumeCreated }, { cancelled: 0, resumeCreated: true });
  assert.equal(sheet[0][col('status')], 'read', 'the read stop is untouched');
  assert.equal(sheet.length, 2, 'a resume row is appended');
  assert.equal(sheet[1][col('type')], 'resume');
  assert.equal(sheet[1][col('status')], 'unread');
  assert.equal(sheet[1][col('reason')], '', 'resume rows carry no reason');
});

test('resumeTreatmentAlert handles a mix: cancels the unread stop AND resumes the read one', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'דנה' }); // will be marked read
  sheet[0][col('status')] = 'read';
  createStopAlert(sheet, { clientId: 'c1', clientName: 'דנה' }); // stays unread
  const res = resumeTreatmentAlert(sheet, { clientId: 'c1', clientName: 'דנה' });
  assert.deepEqual({ cancelled: res.cancelled, resumeCreated: res.resumeCreated }, { cancelled: 1, resumeCreated: true });
  assert.equal(sheet[1][col('status')], 'cancelled', 'the unread stop is cancelled');
  assert.equal(sheet[2][col('type')], 'resume', 'a resume row is appended');
});

test('resumeTreatmentAlert only touches this client and only stop-type rows', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'דנה' });
  createStopAlert(sheet, { clientId: 'c2', clientName: 'יוסי' });
  const res = resumeTreatmentAlert(sheet, { clientId: 'c1', clientName: 'דנה' });
  assert.equal(res.cancelled, 1);
  assert.equal(sheet[0][col('status')], 'cancelled', 'c1 cancelled');
  assert.equal(sheet[1][col('status')], 'unread', 'c2 untouched');
});

test('resumeTreatmentAlert requires clientId and clientName', () => {
  const sheet = [];
  assert.equal(resumeTreatmentAlert(sheet, { clientName: 'דנה' }).error, 'missing_client_id');
  assert.equal(resumeTreatmentAlert(sheet, { clientId: 'c1' }).error, 'missing_client_name');
});

test('getMyStopAlerts exposes ONLY id/clientId/status/type (no names/notes/reasons)', () => {
  const sheet = [];
  createStopAlert(sheet, { clientId: 'c1', clientName: 'דנה', note: 'סודי', reason: 'mismatch' });
  const rows = getMyStopAlerts(sheet).myStopAlerts;
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['clientId', 'id', 'status', 'type']);
  assert.equal(rows[0].type, 'stop');
});

test('getMyStopAlerts reads a legacy empty type as "stop"', () => {
  const sheet = [['stop-old', 'c9', 'דנה', 'old', 'Vered', 'unread', '', '', '']]; // 9 cells, pre type/cancelledAt
  const rows = getMyStopAlerts(sheet).myStopAlerts;
  assert.equal(rows[0].type, 'stop', 'empty/missing type reads as stop');
});

// ===========================================================================
// Source guards — Code.gs
// ===========================================================================
test('source(Code.gs): STOP_ALERTS_HEADERS ends with type then cancelledAt', () => {
  const m = SRC.match(/var STOP_ALERTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m);
  const cols = m[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(cols, HEADERS);
});

test('source(Code.gs): createStopAlert stamps type:stop and cancelledAt empty', () => {
  const fn = SRC.match(/function _createStopAlert\(payload\)\s*\{[\s\S]*?\n\}/)[0];
  assert.match(fn, /type: 'stop'/);
  assert.match(fn, /cancelledAt: ''/);
});

test('source(Code.gs): _resumeTreatmentAlert is INTERNAL, locked, fail-closed, cancels-unread + resume-only-if-read', () => {
  const m = SRC.match(/function _resumeTreatmentAlert\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_resumeTreatmentAlert not found');
  const fn = m[0];
  assert.match(fn, /LockService\.getScriptLock\(\)/, 'must take a lock');
  assert.doesNotMatch(fn, /STOP_ALERTS_SECRET/, 'must NOT require the cross-app secret (internal)');
  assert.match(fn, /if \(!clientId\) return \{ ok: false, error: 'missing_client_id' \};/, 'requires clientId');
  assert.match(fn, /if \(!clientName\) return \{ ok: false, error: 'missing_client_name' \};/, 'requires clientName');
  // cancels UNREAD stop rows in place + stamps cancelledAt
  assert.match(fn, /if \(st === 'unread'\)/, 'branches on unread');
  assert.match(fn, /setValue\('cancelled'\)/, "cancels unread → 'cancelled'");
  assert.match(fn, /cancelledAtIdx \+ 1\)\.setValue\(nowISO\)/, 'stamps cancelledAt');
  // resume row only when a stop was already READ
  assert.match(fn, /else if \(st === 'read'\)\s*\{?\s*hadReadStop = true/, 'read stop → hadReadStop');
  assert.match(fn, /if \(hadReadStop\)\s*\{/, 'appends resume ONLY if a stop was read');
  assert.match(fn, /type: 'resume'/, 'appended row is a resume');
  assert.match(fn, /return \{ ok: true, cancelled: cancelled, resumeCreated: resumeCreated \};/, 'returns cancelled + resumeCreated');
  assert.doesNotMatch(fn, /_writeAll/, 'must not rewrite the whole sheet');
});

test('source(Code.gs): resumeTreatmentAlert + getMyStopAlerts are routed WITHOUT the secret gate', () => {
  // resumeTreatmentAlert: internal write in doPost, no _stopAlertsAuthOk
  assert.match(SRC, /if \(action === 'resumeTreatmentAlert'\) \{[\s\S]*?return _json\(_resumeTreatmentAlert\(payload\)\);/);
  const resumeBlock = SRC.match(/if \(action === 'resumeTreatmentAlert'\) \{([\s\S]*?)return _json\(_resumeTreatmentAlert\(payload\)\);/)[1];
  assert.doesNotMatch(resumeBlock, /_stopAlertsAuthOk/, 'resumeTreatmentAlert must not be secret-gated');
  // getMyStopAlerts routed in doGet with no secret gate
  assert.match(SRC, /if \(action === 'getMyStopAlerts'\) \{[\s\S]*?return _json\(_getMyStopAlerts\(\)\);/);
});

test('source(Code.gs): _getMyStopAlerts returns only id/clientId/status/type', () => {
  const fn = SRC.match(/function _getMyStopAlerts\(\)\s*\{[\s\S]*?\n\}/)[0];
  assert.match(fn, /return \{ id: a\.id, clientId: a\.clientId, status: a\.status, type: \(a\.type \|\| 'stop'\) \};/, 'minimal fields only');
  assert.doesNotMatch(fn, /clientName|note|reason/, 'must not leak names/notes/reasons');
});

// ===========================================================================
// Source guards — frontend (public/app.js + index.html)
// ===========================================================================
test('wiring(app.js): getMyStopAlerts is fetched in loadAll and stored on state.myStopAlerts', () => {
  assert.match(APP, /myStopAlerts: \[\]/, 'state.myStopAlerts initialised');
  assert.match(APP, /function apiGetMyStopAlerts\(\)/, 'apiGetMyStopAlerts reader');
  assert.match(APP, /action=getMyStopAlerts/, 'reads via GET');
  assert.match(APP, /apiGetMyStopAlerts\(\)\.catch/, 'wired into loadAll Promise.all');
  assert.match(APP, /state\.myStopAlerts = \(results\[6\]\.myStopAlerts \|\| \[\]\)/, 'stored from results[6]');
});

test('wiring(app.js): latestAlertFor / stopAlertStanding / renderStopAlertControl exist', () => {
  assert.match(APP, /function latestAlertFor\(clientId\)/);
  assert.match(APP, /function stopAlertStanding\(clientId\)/);
  assert.match(APP, /function renderStopAlertControl\(c\)/);
});

test('wiring(app.js): renderStopAlertControl renders the three chip states + resume/send buttons', () => {
  const fn = APP.match(/function renderStopAlertControl\(c\)\s*\{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /נשלחה התראת עצירה/, 'standing chip');
  assert.match(fn, /data-action="resume-treatment"/, 'resume button');
  assert.match(fn, /חידוש טיפול/, 'resume label');
  assert.match(fn, /נשלח חידוש/, 'resumed chip');
  assert.match(fn, /ההתראה בוטלה/, 'cancelled chip');
  assert.match(fn, /data-action="stop-alert">🛑 הודעת עצירת טיפול/, 'send button literal preserved');
  assert.match(fn, /state\.role === 'editor'/, 'resume button gated to editor');
});

test('wiring(app.js): the overdue row dispatches resume-treatment', () => {
  assert.match(APP, /action === 'resume-treatment'\) \{\s*resumeTreatment\(c\);/);
  assert.match(APP, /renderStopAlertControl\(c\)/, 'renewal row uses the control');
});

test('wiring(app.js): submitResumeTreatment posts resumeTreatmentAlert with clientId+clientName, optimistic + rollback', () => {
  const fn = APP.match(/function submitResumeTreatment\(\)\s*\{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /apiPostAction\('resumeTreatmentAlert', \{ clientId: c\.id, clientName: c\.name/, 'posts clientId + clientName');
  assert.match(fn, /a\.status = 'cancelled'/, 'optimistically cancels unread stops');
  assert.match(fn, /type: 'resume'/, 'optimistically appends a resume when a stop was read');
  assert.match(fn, /state\.myStopAlerts = snapshot/, 'rolls back on failure');
  assert.match(fn, /res && res\.resumeCreated \? 'נשלח חידוש טיפול לירדן' : 'התראת העצירה בוטלה'/, 'toast reflects the response');
});

test('wiring(index.html): resume-treatment confirm modal exists and explains the branch', () => {
  assert.match(HTML, /id="resumeTreatmentModal"/);
  assert.match(HTML, /id="resumeTreatmentClientName"/);
  assert.match(HTML, /id="resumeTreatmentConfirm"/);
  assert.match(HTML, /מבטלת את התראת העצירה אם ירדן טרם קראה אותה/, 'explains cancel-if-unread');
  assert.match(HTML, /תישלח לירדן התראת חידוש טיפול/, 'explains resume-if-read');
});

// ===========================================================================
// Playwright e2e — drives the real app; skips when no browser
// ===========================================================================
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function pastISO(d) { const t = new Date(Date.now() - d * 86400000); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }

// Stub server backed by the same in-memory mirror above (real create/resume/read).
function startServer() {
  const sheet = [];
  const captured = [];
  const clients = [
    { id: 'c1', name: 'דנה כהן', phone: '0501234567', serviceType: 'פסיכותרפיה', location: 'רעננה', sessionsPerWeek: '1', pricePerSession: 400, startDate: pastISO(120), status: 'פעיל', nextBillingDate: pastISO(20) },
    { id: 'c2', name: 'יוסי לוי', phone: '0502223333', serviceType: 'פסיכותרפיה', location: 'רעננה', sessionsPerWeek: '1', pricePerSession: 400, startDate: pastISO(120), status: 'פעיל', nextBillingDate: pastISO(20) }
  ];
  // Pre-seed: c2 already has a READ stop alert (Yarden saw it).
  createStopAlert(sheet, { clientId: 'c2', clientName: 'יוסי לוי' });
  sheet[sheet.length - 1][col('status')] = 'read';
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); const p = u.pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/verify-pin') return res.end(JSON.stringify({ ok: true }));
      if (p === '/api/sheets') {
        if (req.method === 'GET') {
          const a = u.searchParams.get('action') || 'getData';
          if (a === 'getPayments') return res.end(JSON.stringify({ ok: true, payments: [] }));
          if (a === 'getCharges') return res.end(JSON.stringify({ ok: true, charges: [] }));
          if (a === 'getStopFlags') return res.end(JSON.stringify({ ok: true, stopFlags: [] }));
          if (a === 'getExtraSessionRequests') return res.end(JSON.stringify({ ok: true, requests: [] }));
          if (a === 'getSettings') return res.end(JSON.stringify({ ok: true, settings: {} }));
          if (a === 'getMyStopAlerts') return res.end(JSON.stringify(getMyStopAlerts(sheet)));
          return res.end(JSON.stringify({ ok: true, leads: [], clients }));
        }
        let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
          let pl = {}; try { pl = JSON.parse(body); } catch (_) {}
          if (pl.action === 'createStopAlert') { captured.push(pl); return res.end(JSON.stringify(createStopAlert(sheet, pl))); }
          if (pl.action === 'resumeTreatmentAlert') { captured.push(pl); return res.end(JSON.stringify(resumeTreatmentAlert(sheet, pl))); }
          return res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      if (p === '/sw.js') { res.setHeader('content-type', 'text/javascript'); return res.end('/*noop*/'); }
      let rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const f = path.join(PUBLIC, rel);
      if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
      let d = fs.readFileSync(f);
      if (rel === 'index.html') d = Buffer.from(d.toString().replace(/__BUILD__/g, 'test'));
      res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
      res.end(d);
    });
    srv.listen(0, () => resolve({ srv, port: srv.address().port, sheet, captured }));
  });
}

async function openApp(port) {
  let browser;
  try { browser = await chromium.launch(); } catch (_) { return null; }
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('ez_role', 'editor'); } catch (_) {} });
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-client-id="c1"]', { timeout: 8000 });
  return { browser, page };
}
const ctlText = (page, cid) => page.$eval(`[data-client-id="${cid}"] .renewal-actions`, (el) => el.textContent.replace(/\s+/g, ' ').trim());

test('e2e: send → sent chip + חידוש טיפול; the createStopAlert POST carries a non-empty clientName', skipOpt, async (t) => {
  const { srv, port, captured } = await startServer();
  const app = await openApp(port);
  if (!app) { srv.close(); return t.skip('no browser binary'); }
  const { browser, page } = app;
  try {
    // fresh client → the stop-send button
    assert.match(await ctlText(page, 'c1'), /🛑 הודעת עצירת טיפול/);
    // pre-seeded READ stop on c2 → standing chip + resume button (cross-session state)
    assert.match(await ctlText(page, 'c2'), /נשלחה התראת עצירה/);
    assert.ok(await page.$('[data-client-id="c2"] [data-action="resume-treatment"]'), 'c2 shows חידוש טיפול');

    await page.click('[data-client-id="c1"] [data-action="stop-alert"]');
    assert.equal(await page.isVisible('#stopAlertModal'), true, 'modal opens');
    await page.selectOption('#stopAlertReason', 'no_payment');
    await page.click('#stopAlertSubmit');
    await page.waitForSelector('[data-client-id="c1"] [data-action="resume-treatment"]', { timeout: 5000 });
    assert.match(await ctlText(page, 'c1'), /נשלחה התראת עצירה/, 'c1 now standing');
    assert.equal(await page.$eval('#toast', (el) => el.textContent), 'נשלחה התראת עצירה לירדן', 'toast fired');

    const createPost = captured.find((c) => c.action === 'createStopAlert');
    assert.ok(createPost && createPost.clientName && createPost.clientName.trim(), 'clientName is non-empty');
    assert.equal(createPost.clientName, 'דנה כהן');
  } finally { await browser.close(); srv.close(); }
});

test('e2e: resume on an UNREAD stop cancels it → "ההתראה בוטלה" chip + the send button returns', skipOpt, async (t) => {
  const { srv, port, sheet, captured } = await startServer();
  const app = await openApp(port);
  if (!app) { srv.close(); return t.skip('no browser binary'); }
  const { browser, page } = app;
  try {
    // send a fresh (unread) stop on c1, then resume it
    await page.click('[data-client-id="c1"] [data-action="stop-alert"]');
    await page.selectOption('#stopAlertReason', 'no_payment');
    await page.click('#stopAlertSubmit');
    await page.waitForSelector('[data-client-id="c1"] [data-action="resume-treatment"]', { timeout: 5000 });

    await page.click('[data-client-id="c1"] [data-action="resume-treatment"]');
    await page.waitForSelector('#resumeTreatmentModal:not([hidden])', { timeout: 3000 });
    assert.equal(await page.$eval('#resumeTreatmentClientName', (el) => el.textContent), 'דנה כהן');
    await page.click('#resumeTreatmentConfirm');
    await page.waitForSelector('[data-client-id="c1"] [data-action="stop-alert"]', { timeout: 5000 });
    const txt = await ctlText(page, 'c1');
    assert.match(txt, /ההתראה בוטלה/, 'cancelled chip shown');
    assert.match(txt, /🛑 הודעת עצירת טיפול/, 'send button re-enabled');

    const c1stop = sheet.find((r) => r[col('clientId')] === 'c1' && r[col('type')] === 'stop');
    assert.equal(c1stop[col('status')], 'cancelled', 'the unread stop was cancelled server-side');
    assert.ok(captured.some((c) => c.action === 'resumeTreatmentAlert' && c.clientName === 'דנה כהן'), 'resume POST carried the name');
  } finally { await browser.close(); srv.close(); }
});

test('e2e: resume on a READ stop sends a resume → "נשלח חידוש" chip + a resume row is appended', skipOpt, async (t) => {
  const { srv, port, sheet } = await startServer();
  const app = await openApp(port);
  if (!app) { srv.close(); return t.skip('no browser binary'); }
  const { browser, page } = app;
  try {
    // c2 has a pre-seeded READ stop → resume must append a resume row
    await page.click('[data-client-id="c2"] [data-action="resume-treatment"]');
    await page.waitForSelector('#resumeTreatmentModal:not([hidden])', { timeout: 3000 });
    await page.click('#resumeTreatmentConfirm');
    await page.waitForSelector('[data-client-id="c2"] [data-action="stop-alert"]', { timeout: 5000 });
    assert.match(await ctlText(page, 'c2'), /נשלח חידוש/, 'resumed chip shown');

    assert.ok(sheet.some((r) => r[col('clientId')] === 'c2' && r[col('type')] === 'resume' && r[col('status')] === 'unread'), 'a resume row was appended');
    const c2stop = sheet.find((r) => r[col('clientId')] === 'c2' && r[col('type')] === 'stop');
    assert.equal(c2stop[col('status')], 'read', 'the read stop stays read');
  } finally { await browser.close(); srv.close(); }
});
