'use strict';

/**
 * End-to-end coverage for the two stop-alert SEND bugs (PR #63 / #66 follow-up).
 *
 * BUG 1 — "no feedback": pressing 🛑 הודעת עצירת טיפול appeared to do nothing even
 *   though the alert reached the therapists app. Root cause: the ONLY feedback was a
 *   transient toast; the overdue row/button never changed, so after the toast faded
 *   the row looked identical → "nothing happened". Fix: after a successful send the
 *   button flips to DISABLED with the label 'נשלחה התראה ✓' for the rest of the
 *   session (optimistic; rolled back — re-enabled — if the write fails).
 *
 * BUG 2 — "missing name": the alert reached the therapists app with no patient name.
 *   This harness ASSERTS the outpatient side is correct — the createStopAlert POST
 *   carries a non-empty clientName for a card-rendered client, and the Code.gs
 *   _createStopAlert mirror persists it to the clientName column. Since outpatient
 *   sends it correctly, the missing-name bug is on the therapists READ side.
 *
 * The e2e tests drive the REAL public/ app in a headless Chromium against a stub
 * that serves the static files and stubs /api/*. They SKIP gracefully when
 * Playwright or a browser binary is unavailable (env-dependent), so `npm test`
 * still passes in a browser-less CI. Source guards below always run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

// --- Playwright (global-install fallback) ----------------------------------
function loadChromium() {
  try { return require('playwright').chromium; } catch (_) {}
  try {
    const { execSync } = require('node:child_process');
    const groot = execSync('npm root -g').toString().trim();
    return require(path.join(groot, 'playwright')).chromium;
  } catch (_) { return null; }
}
const chromium = loadChromium();

// --- shared stop-alert mirror (matches apps-script/Code.gs _createStopAlert) --
const STOP_ALERTS_HEADERS = ['id', 'clientId', 'clientName', 'createdAt', 'createdBy', 'status', 'readAt', 'note', 'reason'];
const STOP_ALERT_REASONS = { no_payment: true, mismatch: true, other: true };
const clientNameCol = STOP_ALERTS_HEADERS.indexOf('clientName');
let uuidSeq = 0;
function mirrorCreateStopAlert(sheet, payload) {
  const clientId = String((payload && payload.clientId) || '').trim();
  const clientName = String((payload && payload.clientName) || '').trim();
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  if (!clientName) return { ok: false, error: 'missing_client_name' };
  const reason = String((payload && payload.reason) || '').trim();
  if (!STOP_ALERT_REASONS[reason]) return { ok: false, error: 'invalid_reason' };
  const alert = {
    id: 'stop-uuid' + (++uuidSeq), clientId, clientName,
    createdAt: '2026-07-06T00:00:00.000Z',
    createdBy: String((payload && payload.createdBy) || '').trim(),
    status: 'unread', readAt: '',
    note: String((payload && payload.note) || '').trim().slice(0, 1000), reason
  };
  sheet.push(STOP_ALERTS_HEADERS.map((h) => (alert[h] == null ? '' : alert[h])));
  return { ok: true, alert };
}

// --- seed: one active, card-rendered client that is OVERDUE (shows the panel) --
function pastISO(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const SEED_CLIENT = {
  id: 'c-overdue-1', name: 'דנה כהן', phone: '0501234567', serviceType: 'פסיכותרפיה',
  location: 'רעננה', sessionsPerWeek: '1', pricePerSession: 400,
  startDate: pastISO(120), status: 'פעיל', nextBillingDate: pastISO(20), paymentStatus: ''
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// Start a stub server. opts.failCreate → createStopAlert responds 500 (rollback test).
function startServer(opts) {
  opts = opts || {};
  const stopSheet = [];
  const captured = [];
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/verify-pin') return res.end(JSON.stringify({ ok: true }));
      if (p === '/api/sheets') {
        if (req.method === 'GET') {
          const action = u.searchParams.get('action') || 'getData';
          if (action === 'getPayments') return res.end(JSON.stringify({ ok: true, payments: [] }));
          if (action === 'getCharges') return res.end(JSON.stringify({ ok: true, charges: [] }));
          if (action === 'getStopFlags') return res.end(JSON.stringify({ ok: true, stopFlags: [] }));
          if (action === 'getExtraSessionRequests') return res.end(JSON.stringify({ ok: true, requests: [] }));
          if (action === 'getSettings') return res.end(JSON.stringify({ ok: true, settings: {} }));
          return res.end(JSON.stringify({ ok: true, leads: [], clients: [SEED_CLIENT] }));
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          let payload = {};
          try { payload = JSON.parse(body); } catch (_) {}
          if (payload.action === 'createStopAlert') {
            captured.push(payload);
            if (opts.failCreate) { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, error: 'boom' })); }
            return res.end(JSON.stringify(mirrorCreateStopAlert(stopSheet, payload)));
          }
          return res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      if (p === '/sw.js') { res.setHeader('content-type', 'text/javascript'); return res.end('/* noop */'); }
      let rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('nf'); }
      let data = fs.readFileSync(file);
      if (rel === 'index.html') data = Buffer.from(data.toString().replace(/__BUILD__/g, 'test'));
      res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
    srv.listen(0, () => resolve({ srv, port: srv.address().port, stopSheet, captured }));
  });
}

// Drive the app up to the rendered overdue panel. Returns { browser, page } or null
// if a browser can't launch (env-dependent → the caller skips).
async function openApp(port) {
  let browser;
  try { browser = await chromium.launch(); } catch (_) { return null; }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('ez_role', 'editor'); } catch (_) {} });
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#renewalsAlerts [data-action="stop-alert"]', { timeout: 8000 });
  return { browser, page };
}

const BTN = '#renewalsAlerts [data-action="stop-alert"]';
const skipOpt = chromium ? {} : { skip: 'playwright not installed' };

// ===========================================================================
// BUG 1 — the send now visibly changes the row/button (+ modal opens, toast fires)
// ===========================================================================
test('e2e: click opens the modal, a successful send toasts AND flips the button to disabled "נשלחה התראה ✓"', skipOpt, async (t) => {
  const { srv, port, captured, stopSheet } = await startServer();
  const app = await openApp(port);
  if (!app) { srv.close(); return t.skip('no browser binary'); }
  const { browser, page } = app;
  try {
    // modal is hidden before the click …
    assert.equal(await page.$eval('#stopAlertModal', (el) => el.hidden), true, 'modal hidden before click');

    // … and VISIBLY opens on click (bug-1 sanity: it was suspected not to open)
    await page.click(BTN);
    assert.equal(await page.$eval('#stopAlertModal', (el) => el.hidden), false, 'modal opens on click');
    assert.equal(await page.isVisible('#stopAlertModal'), true, 'modal is visible');
    assert.equal(await page.$eval('#stopAlertModal', (el) => getComputedStyle(el).display), 'grid', 'modal display:grid');
    assert.equal(await page.$eval('#stopAlertClientName', (el) => el.textContent), 'דנה כהן', 'modal shows the client name');

    // choose a reason (enables save) and submit
    await page.selectOption('#stopAlertReason', 'no_payment');
    assert.equal(await page.$eval('#stopAlertSubmit', (el) => el.disabled), false, 'save enabled after a reason is chosen');
    await page.click('#stopAlertSubmit');
    await page.waitForFunction(() => document.querySelector('#renewalsAlerts [data-action="stop-alert"]').disabled === true, { timeout: 5000 });

    // toast fired
    assert.equal(await page.$eval('#toast', (el) => el.textContent), 'נשלחה התראת עצירה לירדן', 'success toast');
    assert.equal(await page.$eval('#toast', (el) => el.hidden), false, 'toast visible');

    // the button now reflects the sent state (the actual "feedback" fix)
    assert.equal(await page.$eval(BTN, (el) => el.textContent), 'נשלחה התראה ✓', 'button label flips to sent');
    assert.equal(await page.$eval(BTN, (el) => el.disabled), true, 'button disabled after send');

    // the POST reached the stub and persisted (also covers bug 2 below)
    assert.equal(captured.length, 1, 'exactly one createStopAlert POST');
    assert.equal(stopSheet.length, 1, 'one row persisted');
  } finally {
    await browser.close();
    srv.close();
  }
});

test('e2e: the sent/disabled button survives a re-render (refresh reloads the panel)', skipOpt, async (t) => {
  const { srv, port } = await startServer();
  const app = await openApp(port);
  if (!app) { srv.close(); return t.skip('no browser binary'); }
  const { browser, page } = app;
  try {
    await page.click(BTN);
    await page.selectOption('#stopAlertReason', 'mismatch');
    await page.click('#stopAlertSubmit');
    await page.waitForFunction(() => document.querySelector('#renewalsAlerts [data-action="stop-alert"]').disabled === true, { timeout: 5000 });
    // Force a full re-render via the refresh button; the button must stay sent.
    await page.click('#refreshBtn');
    await page.waitForTimeout(400);
    assert.equal(await page.$eval(BTN, (el) => el.disabled), true, 'still disabled after re-render');
    assert.equal(await page.$eval(BTN, (el) => el.textContent), 'נשלחה התראה ✓', 'still shows sent label after re-render');
  } finally {
    await browser.close();
    srv.close();
  }
});

test('e2e: a FAILED send rolls back — the button re-enables to 🛑 הודעת עצירת טיפול', skipOpt, async (t) => {
  const { srv, port } = await startServer({ failCreate: true });
  const app = await openApp(port);
  if (!app) { srv.close(); return t.skip('no browser binary'); }
  const { browser, page } = app;
  try {
    await page.click(BTN);
    await page.selectOption('#stopAlertReason', 'other');
    await page.click('#stopAlertSubmit');
    // failure toast + the button re-enabled to its original label
    await page.waitForFunction(
      () => /לא נשלחה/.test(document.querySelector('#toast').textContent || ''),
      { timeout: 5000 }
    );
    assert.equal(await page.$eval(BTN, (el) => el.disabled), false, 'button re-enabled after a failed send');
    assert.equal(await page.$eval(BTN, (el) => el.textContent), '🛑 הודעת עצירת טיפול', 'button label restored after rollback');
  } finally {
    await browser.close();
    srv.close();
  }
});

// ===========================================================================
// BUG 2 — outpatient sends a non-empty clientName; the mirror persists it.
// ===========================================================================
test('e2e: the createStopAlert POST carries a non-empty clientName that persists to the clientName column', skipOpt, async (t) => {
  const { srv, port, captured, stopSheet } = await startServer();
  const app = await openApp(port);
  if (!app) { srv.close(); return t.skip('no browser binary'); }
  const { browser, page } = app;
  try {
    await page.click(BTN);
    await page.selectOption('#stopAlertReason', 'no_payment');
    await page.click('#stopAlertSubmit');
    await page.waitForFunction(() => document.querySelector('#renewalsAlerts [data-action="stop-alert"]').disabled === true, { timeout: 5000 });

    assert.equal(captured.length, 1, 'one POST captured');
    const sent = captured[0].clientName;
    assert.equal(typeof sent, 'string');
    assert.ok(sent && sent.trim().length > 0, 'the POST carries a NON-EMPTY clientName');
    assert.equal(sent, 'דנה כהן', 'clientName is the card-rendered client name');

    // Code.gs _createStopAlert mirror wrote it to the clientName COLUMN
    assert.equal(stopSheet.length, 1, 'one row persisted');
    assert.equal(stopSheet[0][clientNameCol], 'דנה כהן', 'clientName persisted to its column');
  } finally {
    await browser.close();
    srv.close();
  }
});

// ===========================================================================
// Source guards (always run — no browser needed)
// ===========================================================================
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');

test('source(app.js): the sent-state helpers and label exist', () => {
  assert.match(APP, /var STOP_ALERT_SENT_LABEL = 'נשלחה התראה ✓';/, 'sent label constant');
  assert.match(APP, /function hasPendingStopAlert\(clientId\)/, 'hasPendingStopAlert helper');
  assert.match(APP, /function applyStopAlertButtonState\(clientId\)/, 'applyStopAlertButtonState helper');
});

test('source(app.js): renderRenewalRow renders a DISABLED sent button when an alert is pending', () => {
  assert.match(
    APP,
    /hasPendingStopAlert\(c\.id\)\s*\?\s*'<button class="btn btn-wa-stop" data-action="stop-alert" disabled>' \+ STOP_ALERT_SENT_LABEL/,
    'pending → disabled sent button'
  );
  // the un-sent branch keeps the literal label (also matched by the older wiring guard)
  assert.match(APP, /data-action="stop-alert">🛑 הודעת עצירת טיפול/);
});

test('source(app.js): submitStopAlert flips the button optimistically and rolls it back on failure', () => {
  const m = APP.match(/function submitStopAlert\(reason, note\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(m, 'submitStopAlert not found');
  const fn = m[0];
  // optimistic: push then apply the sent state
  assert.match(fn, /state\.stopAlerts\.push\([\s\S]*?applyStopAlertButtonState\(c\.id\);/, 'optimistic button flip after push');
  // rollback: splice then re-apply (re-enable) in the catch
  assert.match(fn, /state\.stopAlerts\.splice\([\s\S]*?applyStopAlertButtonState\(c\.id\);/, 'button re-enabled on rollback');
});

test('source(Code.gs): _createStopAlert reads clientName from the payload and persists the row through STOP_ALERTS_HEADERS', () => {
  const m = SRC.match(/function _createStopAlert\(payload\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, '_createStopAlert not found');
  const fn = m[0];
  assert.match(fn, /var clientName = String\(\(payload && payload\.clientName\) \|\| ''\)\.trim\(\);/, 'reads payload.clientName');
  assert.match(fn, /if \(!clientName\) return \{ ok: false, error: 'missing_client_name' \};/, 'rejects an empty clientName');
  assert.match(fn, /clientName: clientName,/, 'sets clientName on the alert');
  assert.match(fn, /appendRow\(STOP_ALERTS_HEADERS\.map\(function \(h\) \{/, 'appends the row by header order (clientName column)');
  // clientName IS a header column, so the appendRow mapping writes it to that column
  const hm = SRC.match(/var STOP_ALERTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(hm && /'clientName'/.test(hm[1]), 'clientName is a STOP_ALERTS_HEADERS column');
});
