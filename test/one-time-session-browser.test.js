'use strict';
// One-time session (טיפול חד פעמי) — real browser (Chromium), server.js + Code.gs sandbox, 1280px and 360px:
// ורד opens «+ טיפול חד פעמי» on a patient card → picks a catalog single session, therapist, date, time →
// a DOUBLE click saves ONE session and ONE charge (server price, durable extra-charge protocol, acknowledged) →
// the card and «היום שלי» show it → «✅ התקיים» writes ONE SessionLog row outside the quota (creditsOwed unchanged)
// → no console errors, no horizontal scroll. דנה (operational) sees the session without any amount and gets no action.
process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');
const catalogAdmin = require('../lib/catalog-admin');

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

const ASSERT = 'catalog-admin-assertion-secret-0123456789-C';
const CLIENT = { id: 'fixture-ots-c1', name: 'מטופלת חד פעמי', phone: '0500000031', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-12-05', startDate: '2026-10-01', assignedTo: 'ורד', creditsOwed: 1, updatedAt: '2026-10-30T07:00:00.000Z' };

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([], [CLIENT]);
  Object.assign(sb.props, { CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => post(Object.assign({ action }, body, { proxySecret: process.env.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [{ name: 'הילה תבור', flatRate: 300 }, { name: 'דנה כהן', flatRate: 280 }]);

  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
  const upstreamCalls = [];
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    let result;
    if (options.method === 'POST') { const b = JSON.parse(options.body); upstreamCalls.push(b.action); result = post(b); }
    else { upstreamCalls.push(url.searchParams.get('action')); result = JSON.parse(sb.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent()); }
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
  async function open(viewport, who = 'ורד', pin = '424242', setup = null) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport, timezoneId: 'UTC' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (setup) await setup(context);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], consoleErrors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error' || /status of 401/.test(m.text())) return;
      const where = (m.location && m.location().url) || '';
      if (/\/api\/continuation-roster/.test(where)) return;
      consoleErrors.push(m.text() + ' @ ' + where);
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText(who, { exact: true }).click();
    await page.fill('#pinInput', pin);
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    consoleErrors.length = 0;
    return { context, page, errors, consoleErrors };
  }
  return { sb, open, upstreamCalls };
}

const todayUTC = () => new Date().toISOString().slice(0, 10);

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('one-time session ' + vp.name + ': schedule (double click = one) → charge via the durable protocol → card + My Day → mark happened', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height });
    await page.click('.tab[data-view="clients"]');
    const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
    await card.waitFor();
    await card.locator('.cc-ots-btn').click();
    await page.waitForSelector('#otsModal:not([hidden])');
    const form = page.locator('#otsForm');
    await form.locator('select[name="catalogKey"] option[value="cbt_single"]').waitFor({ state: 'attached' });
    assert.match(await form.locator('select[name="catalogKey"] option[value="cbt_single"]').textContent(), /CBT — טיפול בודד — ₪?\s?500|500/, 'server price shown');
    assert.equal(await form.locator('input[name="amount"]').count(), 0, 'no amount field — the browser never sends a price');
    assert.equal(await form.locator('select[name="location"]').inputValue(), 'רעננה הפרדס', 'defaults to the patient location');
    await form.locator('select[name="catalogKey"]').selectOption('cbt_single');
    await form.locator('select[name="therapist"]').selectOption('הילה תבור');
    await form.locator('input[name="date"]').fill(todayUTC());
    await form.locator('input[name="time"]').fill('10:00');
    await page.locator('#otsSubmit').dblclick();
    await page.waitForSelector('#otsModal', { state: 'hidden' });
    // exactly one session, one charge, the operation acknowledged
    const sessions = f.sb.rows('OneTimeSessions');
    assert.equal(sessions.length, 1, 'double click → one session');
    assert.equal(sessions[0].priceAgorot, 50000);
    const charges = f.sb.rows('ClientCharges');
    assert.equal(charges.length, 1, 'one charge');
    assert.equal(charges[0].id, sessions[0].chargeId);
    assert.equal(String(charges[0].amount), '500');
    assert.equal(charges[0].billingType, 'one_time');
    assert.equal(charges[0].chargeDate, todayUTC());
    const ops = f.sb.rows('FinancialOps');
    assert.equal(ops.length, 1); assert.equal(ops[0].state, 'acknowledged', 'no operation left open to block the next charge');
    assert.equal(f.sb.rows('Payments').length, 0, 'unpaid unless ticked');
    // the card
    const row = card.locator('.ots-row').first();
    await row.waitFor();
    assert.match(await row.textContent(), /CBT — טיפול בודד/);
    assert.match(await row.textContent(), /הילה תבור/);
    assert.match(await row.textContent(), /מתוכנן/);
    assert.match(await row.textContent(), /לא שולם/);
    // «היום שלי» lists today's session
    await page.click('.tab[data-view="dashboard"]');
    await page.locator('#myDay', { hasText: 'טיפול חד פעמי 10:00 — הילה תבור' }).waitFor();
    // mark happened
    await page.click('.tab[data-view="clients"]');
    page.once('dialog', (d) => d.accept());
    await card.locator('[data-ots-act="happened"]').click();
    await card.locator('.ots-row .ots-status', { hasText: 'התקיים' }).waitFor();
    const log = f.sb.rows('SessionLog');
    assert.equal(log.length, 1); assert.equal(log[0].sessionId, 'ots::' + sessions[0].id);
    assert.equal(log[0].creditStatus, 'one_time'); assert.equal(Number(log[0].clientSessionValue), 500);
    assert.equal(Number(f.sb.rows('Clients')[0].creditsOwed), 1, 'creditsOwed untouched');
    // layout + errors
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, 'no horizontal scroll (' + overflow + 'px)');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}

test('one-time session: דנה (operational) sees the session without any amount and has no action', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  f.sb.ctx._todayISODate = () => todayUTC();
  const r = f.sb.post({ action: 'createOneTimeSession', user: 'ורד', moneyScope: 'full', session: { id: '00000000-0000-4000-8000-000000000001', clientId: CLIENT.id, catalogKey: 'emdr_single', therapist: 'הילה תבור', date: todayUTC(), time: '09:00' } });
  assert.equal(r.ok, true);
  const { page, errors } = await f.open({ width: 1280, height: 900 }, 'דנה', '626262');
  await page.click('.tab[data-view="clients"]');
  const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
  await card.locator('.ots-row').waitFor();
  const text = await card.locator('.cc-ots').textContent();
  assert.match(text, /EMDR — טיפול בודד/);
  assert.equal(/850|₪/.test(text), false, 'no amount for an operational session');
  assert.equal(await card.locator('.cc-ots-btn').count(), 0, 'no «+ טיפול חד פעמי»');
  assert.equal(await card.locator('[data-ots-act]').count(), 0, 'no actions');
  // the proxy refuses the money actions for her (before any upstream call)
  const res = await page.evaluate(async () => {
    const a = await fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createOneTimeSession', session: {} }) });
    const b = await fetch('/api/sheets?action=getOneTimeServices');
    const c = await fetch('/api/sheets?action=getOneTimeSessionsFeed&secret=x');
    return [a.status, b.status, c.status];
  });
  assert.deepEqual(res, [403, 403, 403]);
  assert.deepEqual(errors, []);
});

// ---- read-contract hardening: unknown is never «empty», a failed readback never leaves stale actions ----
const BAD_BODIES = {
  'empty object': { status: 200, contentType: 'application/json', body: '{}' },
  'ok without list': { status: 200, contentType: 'application/json', body: '{"ok":true}' },
  'non-array list': { status: 200, contentType: 'application/json', body: '{"ok":true,"sessions":{"a":1},"services":"x"}' },
  'HTML 200': { status: 200, contentType: 'text/html', body: '<html>maintenance</html>' },
  'invalid JSON': { status: 200, contentType: 'application/json', body: '{not json' }
};
const SID = '00000000-0000-4000-8000-0000000000aa';
function seedSession(f) {
  f.sb.ctx._todayISODate = () => todayUTC();
  const r = f.sb.post({ action: 'createOneTimeSession', user: 'ורד', moneyScope: 'full', session: { id: SID, clientId: CLIENT.id, catalogKey: 'cbt_single', therapist: 'הילה תבור', date: todayUTC(), time: '09:00' } });
  assert.equal(r.ok, true);
}
const isAction = (name) => (url) => new URL(url).pathname === '/api/sheets' && new URL(url).searchParams.get('action') === name;

for (const [label, bad] of Object.entries(BAD_BODIES)) {
  test('one-time session: malformed successful read (' + label + ') is a load gap, never an empty list', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    seedSession(f);
    const { page, errors } = await f.open({ width: 1280, height: 900 }, 'ורד', '424242', (ctx) => ctx.route(isAction('getOneTimeSessions'), (route) => route.fulfill(bad)));
    await page.click('.tab[data-view="clients"]');
    const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
    await card.waitFor();
    assert.match(await page.locator('#dataUnavailableText').textContent(), /טיפולים חד פעמיים/, 'visible gap');
    assert.equal(await page.locator('#dataUnavailableBanner').isHidden(), false);
    assert.equal(await card.locator('.ots-row').count(), 0, 'no rows rendered as if none exist');
    assert.equal(await card.locator('[data-ots-act]').count(), 0, 'no actions on unknown data');
    assert.deepEqual(errors, []);
  });

  test('one-time session: malformed catalogue read (' + label + ') says unavailable, not «import the catalogue»', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page } = await f.open({ width: 1280, height: 900 }, 'ורד', '424242', (ctx) => ctx.route(isAction('getOneTimeServices'), (route) => route.fulfill(bad)));
    await page.click('.tab[data-view="clients"]');
    const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
    await card.locator('.cc-ots-btn').click();
    await page.waitForFunction(() => /הקטלוג לא נטען/.test(document.querySelector('#otsMsg').textContent));
    const msg = await page.locator('#otsMsg').textContent();
    assert.match(msg, /אינו זמין/);
    assert.equal(/לייבא|ייבוא/.test(msg), false, 'no misleading import instruction');
    assert.equal(await page.locator('#otsSubmit').isDisabled(), true, 'cannot submit without a valid catalogue');
  });
}

test('one-time session: valid EMPTY list is a genuine empty (no gap) and valid catalogue still selectable', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page } = await f.open({ width: 1280, height: 900 });
  assert.equal(await page.locator('#dataUnavailableBanner').isHidden(), true, 'no gap for a real empty list');
  await page.click('.tab[data-view="clients"]');
  const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
  await card.locator('.cc-ots-btn').click();
  await page.locator('#otsForm select[name="catalogKey"] option[value="cbt_single"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#otsSubmit').isDisabled(), false);
});

for (const [label, bad] of [['network failure', null], ['malformed 200', BAD_BODIES['ok without list']]]) {
  test('one-time session: accepted cancel + failed readback (' + label + ') → unconfirmed, no stale actions, no duplicate POST, recovery clears the gap', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    seedSession(f);
    let fail = false, cancelPosts = 0;
    const { page, errors } = await f.open({ width: 1280, height: 900 }, 'ורד', '424242', async (ctx) => {
      await ctx.route(isAction('getOneTimeSessions'), (route) => (fail ? (bad ? route.fulfill(bad) : route.abort()) : route.continue()));
      await ctx.route('**/api/sheets', (route) => {
        const req = route.request();
        if (req.method() === 'POST' && /"cancelOneTimeSession"/.test(req.postData() || '')) cancelPosts++;
        return route.continue();
      });
    });
    await page.click('.tab[data-view="clients"]');
    const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
    await card.locator('[data-ots-act="cancel"]').waitFor();
    fail = true;
    await card.locator('[data-ots-act="cancel"]').click();
    await page.fill('#otsCancelForm textarea[name="reason"]', 'סיבה לבדיקה');
    await page.locator('#otsCancelForm button[type="submit"]').click();
    await page.waitForFunction(() => /טיפולים חד פעמיים/.test(document.querySelector('#dataUnavailableText').textContent));
    // the source accepted it exactly once
    assert.equal(cancelPosts, 1);
    assert.equal(f.sb.rows('OneTimeSessions')[0].status, 'cancelled');
    // the UI no longer offers the stale scheduled row or any write
    assert.equal(await card.locator('.ots-row').count(), 0);
    assert.equal(await card.locator('[data-ots-act]').count(), 0);
    const toastText = await page.locator('#toast').textContent();
    assert.match(toastText, /אין לבצע את הפעולה שוב/, 'accepted-but-unconfirmed, no prompt to repeat');
    assert.equal(/^הטיפול בוטל$/.test(toastText), false, 'plain success wording not used without a confirmed readback');
    // recovery: the next successful read shows the cancelled row and clears the gap
    fail = false;
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-view="clients"]');
    await card.locator('.ots-row .ots-status', { hasText: 'בוטל' }).waitFor();
    assert.equal(await page.locator('#dataUnavailableBanner').isHidden(), true);
    assert.equal(cancelPosts, 1, 'recovery never re-posts');
    assert.deepEqual(errors, []);
  });
}
