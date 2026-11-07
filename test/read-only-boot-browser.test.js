'use strict';
/* R6 / R10 acceptance (2026-11-07, CHANGELOG-read-only-boot.md) — opening, navigating and refreshing
 * Outpatient performs ZERO source writes; the continuation milestone sync runs ONLY on the explicit,
 * authorized POST /api/continuation-sync, once per business change, safe to retry after a lost answer;
 * a failed read is «מידע לא זמין», never «nothing» and never a task closure.
 *
 * Synthetic only: the REAL server.js + the REAL apps-script/Code.gs handlers (in-memory sandbox) + a
 * fake Dashboard roster, driven by Chromium. No network outside 127.0.0.1, no production data.
 *
 * "A write" is measured two ways, both must hold:
 *   1. the sandbox spreadsheet (every sheet grid) and the script properties are byte-identical;
 *   2. no Apps Script POST other than the known read actions reached the source. */
process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');

function loadChromium() {
  try { return require('playwright').chromium; } catch (_) {}
  try {
    const root = require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright')).chromium;
  } catch (_) { return null; }
}
const chromium = loadChromium();
if (!chromium && process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw new Error('playwright is required for browser acceptance');
const skipOpt = chromium ? {} : { skip: 'playwright not installed' };

function iso(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d); }

// Source POST actions that only read. Anything else reaching the source during a "read" is a write.
const READ_POST_ACTIONS = new Set(['getTasks', 'getActivity', 'previewContinuationMilestones', 'getBackendCapabilities', 'getRenewalState', 'getExtraChargeState']);

const OPEN_LEAD = { id: 'lead-open-1', name: 'ליד פתוח', phone: '0503333333', stage: 'new', serviceType: 'פרטני', created: '2026-11-01', updatedAt: '2026-11-01T08:00:00.000Z' };
// a lead that was already converted (a client points at it): the old boot path persisted a trimmed list
const CONVERTED_LEAD = { id: 'lead-conv-1', name: 'מטופל קיים', phone: '0509999999', stage: 'new', serviceType: 'פרטני', created: '2026-10-01', updatedAt: '2026-10-01T08:00:00.000Z' };
const CLIENT = { id: 'fixture-c1', name: 'מטופל קיים', phone: '0509999999', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-11-05', startDate: '2026-10-01', assignedTo: 'ורד', fromLead: 'lead-conv-1', updatedAt: '2026-10-30T07:00:00.000Z' };
const NOA = { sourceApp: 'dashboard', name: 'נועה לוי', phone: '050-123-4567', house: 'ramot', entryDate: daysAgo(20) };
const DEPARTED = { sourceApp: 'dashboard', name: 'עזב את הבית', phone: '0504444444', house: 'ramot', entryDate: daysAgo(10) };
const ROSTER = { ok: true, patients: [NOA, { sourceApp: 'dashboard', name: 'מטופל קיים', phone: '0509999999', house: 'asher', entryDate: daysAgo(5) }] };

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([OPEN_LEAD, CONVERTED_LEAD], [CLIENT]);
  // The production spreadsheet already has every operational sheet. Some source READ getters bootstrap a
  // missing sheet (header row only) — that is not a data write, but the empty synthetic spreadsheet would
  // show it as one. Create them header-only up front, exactly as production has them, before the snapshot.
  for (const [name, headers] of [
    ['ClientCharges', 'CHARGES_HEADERS'], ['Clients-removed', 'CLIENTS_REMOVED_HEADERS'], ['ExtraSessionRequests', 'EXTRA_SESSION_HEADERS'],
    ['Payments', 'PAYMENTS_HEADERS'], ['SessionLog', 'SESSION_LOG_HEADERS'], ['Settings', 'SETTINGS_HEADERS'], ['StopFlags', 'STOP_FLAGS_HEADERS'],
    ['לידים שהוסרו', 'REMOVED_LEADS_HEADERS'], ['CREDITS_SHEET', 'CREDIT_COLUMNS'], ['CONTINUATION_SHEET', 'CONTINUATION_HEADERS'],
    ['STOP_ALERTS_SHEET', 'STOP_ALERTS_HEADERS'], ['ACTIVITY_SHEET', 'ACTIVITY_HEADERS'], ['TASKS_SHEET', 'TASKS_HEADERS']
  ]) {
    const sheetName = /_SHEET$/.test(name) ? sb.ctx[name] : name;
    assert.ok(sheetName && Array.isArray(sb.ctx[headers]), name + ' / ' + headers + ' exist in Code.gs');
    if (!sb.sheets[sheetName]) sb.seed(sheetName, sb.ctx[headers], []);
  }
  // setup (before the snapshot): an open milestone task for a patient who has since LEFT the roster —
  // the old GET path would cancel it on a mere page open.
  const seeded = sb.post({ action: 'syncContinuationMilestones', user: 'ורד', patients: [DEPARTED], rosterComplete: false });
  assert.equal(seeded.ok, true); assert.equal(seeded.created, 3);

  const net = { roster: 0, posts: [], rosterDown: false, failGet: new Set() };
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', DASHBOARD_SHEETS_URL: 'https://dashboard.invalid/exec', OCCUPANCY_SECRET: 'occupancy-fixture-secret' });
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.host === 'dashboard.invalid') {
      net.roster++;
      if (net.rosterDown) throw new Error('ECONNRESET (synthetic)');
      return { status: 200, text: async () => JSON.stringify(ROSTER) };
    }
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    let result;
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body);
      net.posts.push(payload.action);
      result = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: options.body } }).getContent());
    } else {
      const params = Object.fromEntries(url.searchParams);
      if (net.failGet.has(params.action)) return { status: 200, text: async () => JSON.stringify({ ok: false, error: 'synthetic_outage' }) };
      result = JSON.parse(sb.ctx.doGet({ parameter: params }).getContent());
    }
    return { status: 200, text: async () => JSON.stringify(result) };
  };
  const modulePath = require.resolve('../server');
  delete require.cache[modulePath];
  const app = require('../server');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    global.fetch = oldFetch;
    for (const k of keys) { if (oldEnv[k] === undefined) delete process.env[k]; else process.env[k] = oldEnv[k]; }
    delete require.cache[modulePath];
  });

  const snapshot = () => JSON.stringify({ sheets: Object.keys(sb.sheets).sort().map((n) => [n, sb.sheets[n].grid]), props: sb.props });
  const writes = () => net.posts.filter((a) => !READ_POST_ACTIONS.has(a));
  // which sheets / properties differ from a snapshot (for a readable failure)
  const changedSince = (snap) => {
    const a = JSON.parse(snap), b = JSON.parse(snapshot()), out = [];
    const ma = new Map(a.sheets), mb = new Map(b.sheets);
    for (const n of new Set([...ma.keys(), ...mb.keys()])) {
      const ga = ma.get(n), gb = mb.get(n);
      if (JSON.stringify(ga) === JSON.stringify(gb)) continue;
      if (!ga || !gb) { out.push(n + (ga ? ' removed' : ' created')); continue; }
      const len = Math.max(ga.length, gb.length);
      for (let i = 0; i < len; i++) if (JSON.stringify(ga[i]) !== JSON.stringify(gb[i])) { out.push(n + ' row ' + (i + 1) + ': ' + JSON.stringify(ga[i]) + ' -> ' + JSON.stringify(gb[i])); break; }
    }
    for (const k of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) if (a.props[k] !== b.props[k]) out.push('prop ' + k + ': ' + a.props[k] + ' -> ' + b.props[k]);
    return out;
  };

  async function context() {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    await ctx.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    return ctx;
  }
  async function open(ctx, name, pin) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText(name || 'ורד', { exact: true }).click();
    await page.fill('#pinInput', pin || '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    await page.waitForLoadState('networkidle');
    return { page, errors };
  }
  async function visitEveryTab(page) {
    const views = await page.$$eval('.tab[data-view]', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute('data-view')));
    for (const v of views) {
      await page.click('.tab[data-view="' + v + '"]');
      await page.waitForLoadState('networkidle');
    }
    return views;
  }
  return { sb, net, origin, snapshot, changedSince, writes, context, open, visitEveryTab };
}

test('R6 acceptance 1–4: open, refresh, every tab, two windows, roster cache miss → ZERO source writes', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const before = f.snapshot();
  const tasksBefore = f.sb.rows('Tasks').length;

  // 1. open the app (sign-in + boot load + continuation roster preload) and visit every tab
  const ctx1 = await f.context();
  const w1 = await f.open(ctx1);
  const views = await f.visitEveryTab(w1.page);
  assert.ok(views.includes('continuation'), 'the continuation tab was visited');
  // the converted lead is hidden on screen but NOT deleted from the source
  await w1.page.click('.tab[data-view="leads"]');
  assert.equal(await w1.page.locator('#view-leads', { hasText: 'ליד פתוח' }).count(), 1);
  assert.ok(f.sb.rows('Leads').some((l) => l.id === 'lead-conv-1'), 'opening the app does not delete the converted lead');
  assert.deepEqual(f.writes(), [], 'opening + navigating sent no write action');
  assert.deepEqual(f.changedSince(before), [], 'opening + navigating changed nothing in the source');

  // 2. repeated refresh (browser reload and the ↻ button, which reads fresh)
  for (let i = 0; i < 3; i++) {
    await w1.page.reload({ waitUntil: 'networkidle' });
    await w1.page.waitForSelector('#app:not([hidden])');
    await w1.page.waitForLoadState('networkidle');
  }
  await w1.page.click('#refreshBtn');
  await w1.page.waitForLoadState('networkidle');
  assert.deepEqual(f.writes(), [], 'refresh sent no write action');
  assert.deepEqual(f.changedSince(before), [], 'refresh changed nothing');

  // 3. two windows at once (second browser context = second reader)
  const ctx2 = await f.context();
  const [w2, w3] = await Promise.all([f.open(ctx2), f.open(ctx1)]);
  await Promise.all([f.visitEveryTab(w2.page), f.visitEveryTab(w3.page)]);
  assert.equal(f.sb.rows('Tasks').length, tasksBefore, 'two windows created no task');
  assert.deepEqual(f.writes(), []);
  assert.deepEqual(f.changedSince(before), [], 'two windows changed nothing');

  // 4. roster cache miss: a forced-fresh roster read (the path that used to sync) still writes nothing
  const rosterCalls = f.net.roster;
  const res = await w1.page.evaluate(async () => { const r = await fetch('/api/continuation-roster?fresh=1', { cache: 'no-store' }); return { status: r.status, cache: r.headers.get('x-cache'), body: await r.json() }; });
  assert.equal(res.status, 200); assert.equal(res.cache, 'MISS'); assert.equal(res.body.patients.length, 2);
  assert.ok(f.net.roster > rosterCalls, 'the upstream roster was really re-read');
  assert.deepEqual(f.writes(), [], 'a roster cache miss sent no write action');
  assert.deepEqual(f.changedSince(before), [], 'a roster cache miss changed nothing');
  // the departed patient's open task is still open: no closure happened by reading
  assert.deepEqual(f.sb.rows('Tasks').filter((x) => x.clientId === 'cont:phone:0504444444').map((x) => x.status), ['open', 'open', 'open']);

  // the tab tells the user changes are waiting (read-only dry run), without making them
  await w1.page.click('.tab[data-view="continuation"]');
  await w1.page.waitForFunction(() => /שינויים ממתינים/.test(document.querySelector('#continuationSyncStatus').textContent));
  assert.match(await w1.page.textContent('#continuationSyncStatus'), /^9 שינויים ממתינים/, '6 to open + 3 to close');
  assert.deepEqual(f.changedSince(before), [], 'the preview changed nothing');
  assert.deepEqual([...w1.errors, ...w2.errors, ...w3.errors], []);
});

test('R6 acceptance 5–6: explicit sync applies once; a retry after a LOST answer creates nothing twice', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const ctx = await f.context();
  const { page, errors } = await f.open(ctx);
  await page.click('.tab[data-view="continuation"]');
  await page.locator('.cont-card').first().waitFor();
  assert.deepEqual(f.writes(), []);

  // 6 (first half): the server applies the sync but the browser never receives the answer
  let dropped = 0;
  await page.route('**/api/continuation-sync', async (route) => {
    if (dropped === 0) { dropped++; await route.fetch(); return route.abort('connectionreset'); }
    return route.continue();
  });
  await page.click('#continuationSyncBtn');
  // the source committed, the answer was lost: the app reads back instead of claiming «nothing changed»
  await page.waitForFunction(() => /בבדיקה חוזרת משימות ההמשך מעודכנות — העדכון נשמר/.test(document.querySelector('#toast') ? document.querySelector('#toast').textContent : ''));
  assert.doesNotMatch(await page.textContent('#toast'), /לא בוצע שינוי/, 'never claims that nothing was written');
  assert.deepEqual(f.writes(), ['syncContinuationMilestones'], 'the lost attempt reached the source exactly once');
  const afterFirst = f.snapshot();
  const tasks = f.sb.rows('Tasks');
  const contTasks = tasks.filter((x) => String(x.id).startsWith('cont::'));
  assert.equal(contTasks.length, 9, '3 seeded + 3 for each of the 2 dated roster patients');
  assert.equal(new Set(contTasks.map((x) => x.id)).size, contTasks.length, 'no duplicate task ids');
  assert.deepEqual(tasks.filter((x) => x.clientId === 'cont:phone:0504444444').map((x) => x.status), ['cancelled', 'cancelled', 'cancelled'], 'the departed patient’s tasks closed by the explicit sync');
  const created = f.sb.rows('Activity').filter((e) => e.kind === 'task_created').length;
  const cancelled = f.sb.rows('Activity').filter((e) => e.kind === 'task_cancelled').length;
  assert.equal(cancelled, 3);

  // 6 (second half): the person presses again — the replay changes nothing
  await page.click('#continuationSyncBtn');
  await page.waitForFunction(() => /0 נפתחו, 0 הוזזו, 0 נסגרו/.test(document.querySelector('#toast').textContent));
  assert.deepEqual(f.writes(), ['syncContinuationMilestones', 'syncContinuationMilestones']);
  assert.deepEqual(f.changedSince(afterFirst), [], 'the retry after a lost answer wrote nothing new');
  assert.equal(f.sb.rows('Activity').filter((e) => e.kind === 'task_created').length, created, 'each task_created recorded once');
  assert.equal(f.sb.rows('Activity').filter((e) => e.kind === 'task_cancelled').length, cancelled, 'each task_cancelled recorded once');
  await page.waitForFunction(() => /מעודכנות/.test(document.querySelector('#continuationSyncStatus').textContent));

  // and opening a second window afterwards still writes nothing
  const ctx2 = await f.context();
  const w2 = await f.open(ctx2);
  await f.visitEveryTab(w2.page);
  assert.deepEqual(f.changedSince(afterFirst), []);
  assert.deepEqual([...errors, ...w2.errors], []);
});

test('R6/R10 acceptance 7: source / roster outage → «מידע לא זמין», no task closed, sync refused safely', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const before = f.snapshot();
  f.net.failGet.add('getPayments'); f.net.failGet.add('getCharges');
  f.net.rosterDown = true;
  const ctx = await f.context();
  const { page, errors } = await f.open(ctx);
  // payments / charges unreadable: an explicit banner, not a silent «no debt»
  await page.waitForSelector('#dataUnavailableBanner:not([hidden])');
  const banner = await page.textContent('#dataUnavailableText');
  assert.match(banner, /מידע לא זמין/); assert.match(banner, /תשלומים/); assert.match(banner, /חיובים/);
  // roster unreachable: the tab says so; the status line is «לא זמין», never «מעודכנות» / 0
  await page.click('.tab[data-view="continuation"]');
  await page.waitForFunction(() => /שגיאה בטעינת הרוסטר/.test(document.querySelector('#continuationList').textContent));
  await page.waitForFunction(() => /לא זמין/.test(document.querySelector('#continuationSyncStatus').textContent));
  // the explicit sync with no roster is refused and closes nothing
  await page.click('#continuationSyncBtn');
  await page.waitForFunction(() => /לא ניתן לאמת אם העדכון נשמר. אפשר לרענן את המצב ולנסות שוב בבטחה/.test(document.querySelector('#toast').textContent));
  assert.deepEqual(f.writes(), [], 'no write reached the source during the outage');
  assert.deepEqual(f.changedSince(before), [], 'no task was closed because the roster was unreachable');
  assert.deepEqual(f.sb.rows('Tasks').filter((x) => x.clientId === 'cont:phone:0504444444').map((x) => x.status), ['open', 'open', 'open']);
  // the source recovers: the banner clears on the next load
  f.net.failGet.clear();
  await page.click('#refreshBtn');
  await page.waitForSelector('#dataUnavailableBanner', { state: 'hidden' });
  assert.deepEqual(errors, []);
});

test('R6 acceptance 8: an unauthorized caller cannot write (no / forged / legacy cookie, browser-typed sync, non-JSON)', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const before = f.snapshot();
  // global.fetch is the fixture's upstream stub, so talk to the local server over node:http
  const http = require('node:http');
  function raw(method, p, body, headers) {
    return new Promise((resolve, reject) => {
      const u = new URL(f.origin + p);
      const req = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject); req.end(body == null ? '{}' : body);
    });
  }
  assert.equal((await raw('POST', '/api/continuation-sync')).status, 401, 'no cookie');
  assert.equal((await raw('POST', '/api/continuation-sync', '{}', { Cookie: 'ezone_session=forged.token' })).status, 401, 'forged cookie');
  assert.equal((await raw('GET', '/api/continuation-sync/preview', '')).status, 401, 'preview needs a session too');
  assert.equal((await raw('POST', '/api/sheets', JSON.stringify({ action: 'saveAll', leads: [], clients: [] }))).status, 401, 'no cookie → no saveAll');
  assert.equal((await raw('POST', '/api/sheets', JSON.stringify({ action: 'createTask', submissionId: 'x' }))).status, 401, 'no cookie → no task');

  // a signed-in browser still cannot type its own patient list into the sync, nor use a form post
  const ctx = await f.context();
  const { page } = await f.open(ctx);
  const r = await page.evaluate(async () => {
    const j = (action) => fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, patients: [{ name: 'x', phone: '0501111111', entryDate: '2026-11-01' }], rosterComplete: true }) }).then((x) => x.status);
    const form = await fetch('/api/continuation-sync', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' }).then((x) => x.status);
    return { sync: await j('syncContinuationMilestones'), preview: await j('previewContinuationMilestones'), form };
  });
  assert.deepEqual(r, { sync: 403, preview: 403, form: 415 });
  assert.deepEqual(f.writes(), []);
  assert.deepEqual(f.changedSince(before), []);
});

test('R6 follow-up: a «היום שלי»-only user sees pending milestone work for a NEW admission and can apply it once from there', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const ctx = await f.context();
  const { page, errors } = await f.open(ctx);
  const before = f.snapshot();
  // never visits «מסלול המשך»: the landing screen alone shows the pending work and the one action
  await page.waitForSelector('#myDayContSync:not([hidden])');
  assert.match(await page.textContent('#myDayContSyncText'), /9 שינויים ממתינים/);
  assert.equal(await page.locator('#myDayContSyncBtn').isVisible(), true);
  assert.deepEqual(f.changedSince(before), [], 'showing the pending work wrote nothing');
  assert.deepEqual(f.writes(), []);
  const done = page.waitForResponse((r) => r.url().endsWith('/api/continuation-sync') && r.request().method() === 'POST');
  await page.click('#myDayContSyncBtn');
  assert.equal((await (await done).json()).created, 6);
  await page.waitForSelector('#myDayContSync', { state: 'hidden' });
  assert.deepEqual(f.writes(), ['syncContinuationMilestones'], 'one explicit sync');
  // the month-1 contact of the existing patient is overdue → a row in «היום שלי» now
  await page.locator('#myDay .md-row', { hasText: 'הצעת המשך טיפול' }).first().waitFor();

  // a NEW admission arrives in the Dashboard roster; a refresh of the landing screen surfaces it (read only)
  const NEW = { sourceApp: 'dashboard', name: 'קבלה חדשה', phone: '0505555555', house: 'ramot', entryDate: daysAgo(1) };
  ROSTER.patients.push(NEW);
  t.after(() => { ROSTER.patients.splice(ROSTER.patients.indexOf(NEW), 1); });
  const settled = f.snapshot();
  await page.evaluate(() => fetch('/api/continuation-roster?fresh=1')); // the 60 s roster cache expires
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('#myDayContSync:not([hidden])');
  assert.match(await page.textContent('#myDayContSyncText'), /3 שינויים ממתינים/);
  assert.deepEqual(f.changedSince(settled), [], 'the new admission was surfaced without any write');
  await page.click('#myDayContSyncBtn');
  await page.waitForSelector('#myDayContSync', { state: 'hidden' });
  const ids = f.sb.rows('Tasks').filter((x) => x.clientId === 'cont:phone:0505555555').map((x) => x.id);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3, 'one task per milestone, no duplicate');
  assert.deepEqual(f.writes(), ['syncContinuationMilestones', 'syncContinuationMilestones']);
  assert.deepEqual(errors, []);
});

test('R10 finance fail-closed: payments / charges unreadable → no money write leaves the browser; non-money work continues', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  f.net.failGet.add('getPayments');
  const ctx = await f.context();
  const { page, errors } = await f.open(ctx);
  await page.waitForSelector('#dataUnavailableBanner:not([hidden])');
  assert.match(await page.textContent('#dataUnavailableText'), /פעולות כספיות חסומות/);
  const before = f.snapshot();
  // every money write path is refused BEFORE a request is sent (placeholders are never authoritative)
  const sent = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/sheets')) sent.push(r.postDataJSON().action || 'saveAll'); });
  await page.click('.tab[data-view="clients"]');
  const card = page.locator('#clientsList .client-card').filter({ has: page.locator('.client-name', { hasText: 'מטופל קיים' }) });
  await card.getByRole('button', { name: 'חידוש ותשלום', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#renewSubmit').disabled || !document.querySelector('#renewRecovery').hidden);
  await page.click('#renewSubmit');
  await page.waitForFunction(() => /פעולה כספית חסומה/.test(document.body.textContent));
  assert.deepEqual(sent.filter((a) => a !== 'getRenewalState'), [], 'no money write was sent');
  assert.deepEqual(f.changedSince(before), [], 'no payment / renewal / client money row changed');
  assert.ok(f.sb.rows('Payments').length === 0 && f.sb.rows('ClientCharges').length === 0);
  assert.deepEqual(f.writes(), []);
  // fail-closed for money ONLY: a non-money source write still goes through (a lead note save)
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createTask', submissionId: 'sub-r10-nonmoney-1', task: { leadId: 'lead-open-1', kind: 'call', title: 'שיחת מעקב', dueDate: '2026-11-20', assignee: 'ורד' } }) });
    return res.json();
  });
  assert.equal(r.ok, true, 'a non-money task write is not blocked');
  assert.deepEqual(errors, []);
});

test('R10: the browser finance write list mirrors every money WRITE action of lib/money-scope.js', () => {
  const fs = require('node:fs');
  const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const m = APP.match(/var FINANCE_WRITE_ACTIONS = \[([\s\S]*?)\];/);
  assert.ok(m, 'FINANCE_WRITE_ACTIONS present');
  const browser = m[1].match(/'([A-Za-z]+)'/g).map((x) => x.slice(1, -1)).sort();
  const server = require('../lib/money-scope').MONEY_POST_ACTIONS.filter((a) => !/^get/.test(a)).sort();
  assert.deepEqual(browser, server);
  // the three browser write paths are gated
  assert.match(APP, /async function apiPostAction\(action, extra\) \{\s*if \(financeUnavailable\(\) && FINANCE_WRITE_ACTIONS\.indexOf\(action\) >= 0\) throw financeRefusal\(\);/);
  assert.match(APP, /async function apiSave\(payload\) \{\s*if \(financeUnavailable\(\) && saveChangesMoney\(payload\)\) throw financeRefusal\(\);/);
  assert.match(APP, /async function apiSaveCredit\(credit\) \{\s*if \(financeUnavailable\(\)\) throw financeRefusal\(\);/);
  assert.match(APP, /async function apiSaveSettings\(settings\) \{\s*\/\/[^\n]*\n\s*if \(\(state\.loadGaps \|\| \[\]\)\.indexOf\('הגדרות'\) >= 0\) throw/);
});
