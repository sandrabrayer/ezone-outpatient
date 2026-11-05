'use strict';

/**
 * Action busy spinner (Sandra, 2026-11-05: «כשלוחצים על כפתורים שמירה איפוס או
 * כל שינוי תוסיף ספינר») — real browser (Chromium via Playwright), the real
 * public UI, server.js and Code.gs in the in-memory sandbox, signed in as ורד,
 * at 1280px and 360px.
 *
 * Every case holds the upstream response open, so the assertions happen WHILE
 * the request is in flight:
 *   A. patient card → עריכה → שמור     (a client save through POST /api/sheets)
 *   B. patient card save that FAILS     (the button must come back)
 *   B2. patient card → חידוש ותשלום    (the card button itself, so the spinner
 *       is visibly in the row and its width is checked)
 *   C. תמחור חבילות → יצירת הצעה       (a quote created through the catalog rpc)
 *   D. an offer's 🗑 מחיקה → אישור מחיקה
 *   E. תמחור חבילות → רענון            (a reload, not a write)
 * For each: the pressed button is disabled, carries aria-busy="true" and an
 * inline .busy-spinner, a SECOND click sends no second request, and the button
 * is restored once the action settles.
 *
 * Run with:  npm test
 */
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
const CLIENT = { id: 'spin-c1', name: 'מטופל ספינר', phone: '0500000031', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-11-05', startDate: '2026-10-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([], [CLIENT]);
  Object.assign(sb.props, { PACKAGE_CATALOG_SECRET: 'package-catalog-secret-0123456789abcdef-A', PACKAGE_REQUEST_SECRET: 'package-request-secret-0123456789abcdef-B', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => post(Object.assign({ action }, body, { proxySecret: process.env.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);

  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;

  /* The gate: while `upstream.hold` is set, every upstream call waits on it, so
   * the browser really is mid-request when the spinner is asserted. */
  const upstream = { hold: null, fail: false };
  function holdOpen() {
    let release;
    upstream.hold = new Promise((r) => { release = r; });
    return () => { const h = upstream.hold; upstream.hold = null; release(); return h; };
  }
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    if (upstream.hold) await upstream.hold;
    if (upstream.fail) throw new Error('upstream down (fixture)');
    let result;
    if (options.method === 'POST') result = post(JSON.parse(options.body));
    else result = JSON.parse(sb.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent());
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
  async function open(viewport) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [], posts = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (r.method() === 'POST' && u.pathname.startsWith('/api/')) posts.push(u.pathname + '|' + (r.postData() || '').slice(0, 80));
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    posts.length = 0;
    return { context, page, errors, posts };
  }
  return { sb, upstream, holdOpen, open };
}

/** The three things a busy button must show, read straight off the DOM. */
async function busyState(locator) {
  return locator.evaluate((el) => ({
    disabled: !!el.disabled,
    ariaBusy: el.getAttribute('aria-busy'),
    spinners: el.querySelectorAll('.busy-spinner').length,
    width: Math.round(el.getBoundingClientRect().width)
  }));
}

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('action spinner ' + vp.name + ': patient-card save shows a spinner, blocks the second click, and comes back after success AND after a server error', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, posts } = await f.open({ width: vp.width, height: vp.height });

    await page.click('.tab[data-view="clients"]');
    const editBtn = page.locator('#view-clients .client-card button', { hasText: 'עריכה' }).first();
    await editBtn.waitFor({ state: 'visible' });

    // --- A. a save that SUCCEEDS -------------------------------------------
    await page.locator('#view-clients .client-card button', { hasText: 'עריכה' }).first().click();
    await page.waitForSelector('#editClientModal:not([hidden])');
    const submit = page.locator('#editClientSubmit');
    const before = await busyState(submit);
    assert.equal(before.ariaBusy, null, 'not busy at rest');
    assert.equal(before.spinners, 0);

    let release = f.holdOpen();
    await submit.click();
    await page.waitForFunction(() => document.querySelector('#editClientSubmit').getAttribute('aria-busy') === 'true');
    const during = await busyState(submit);
    assert.equal(during.disabled, true, 'disabled while saving');
    assert.equal(during.ariaBusy, 'true');
    assert.equal(during.spinners, 1, 'one inline CSS spinner replaces the label');
    // the spinner really animates (or, under reduced motion, pulses)
    assert.ok(await page.locator('#editClientSubmit .busy-spinner').evaluate((el) => {
      const a = getComputedStyle(el).animationName;
      return a === 'busy-spin' || a === 'busy-pulse';
    }), 'the spinner is a CSS animation');

    const sent = posts.length;
    assert.ok(sent >= 1, 'the save was sent');
    // the double-submit that caused duplicate writes. The modal is already
    // closed (the save is optimistic), so the form's submit event is dispatched
    // straight at the guard instead of clicking the hidden button.
    await page.evaluate(() => document.getElementById('editClientForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(200);
    assert.equal(posts.length, sent, 'a second click while busy sends nothing: ' + JSON.stringify(posts));

    release();
    await page.waitForFunction(() => document.getElementById('editClientModal').hidden);
    const after = await busyState(submit);
    assert.equal(after.ariaBusy, null, 'aria-busy cleared after success');
    assert.equal(after.spinners, 0, 'the label is back');
    assert.equal(after.disabled, false, 'usable again');
    assert.equal(await submit.textContent(), 'שמור');

    // --- B2. a card button that STAYS on screen: חידוש ותשלום --------------
    // (עריכה's save closes its modal optimistically, so the spinner there is
    // correct but off-screen; this is the visible-in-the-row case.)
    const renew = await page.locator('#view-clients .client-card button', { hasText: 'חידוש ותשלום' }).first().elementHandle();
    const renewIdle = await busyState(renew);
    assert.ok(renewIdle.width > 0);
    release = f.holdOpen();
    await renew.click();
    await page.waitForFunction(() => document.querySelectorAll('#view-clients .client-card button[aria-busy="true"]').length === 1);
    const renewing = await busyState(renew);
    assert.equal(renewing.disabled, true, 'חידוש ותשלום is disabled while the source state is read');
    assert.equal(renewing.spinners, 1, 'the spinner sits in the card row');
    assert.ok(renewing.width >= renewIdle.width - 1, 'the card button keeps its width (no layout jump): ' + JSON.stringify([renewIdle.width, renewing.width]));
    const sentR = posts.length;
    await renew.click({ force: true });
    await page.waitForTimeout(200);
    assert.equal(posts.length, sentR, 'a second חידוש ותשלום click sends nothing');
    release();
    await page.waitForFunction(() => document.querySelectorAll('#view-clients .client-card button[aria-busy="true"]').length === 0);
    const renewAfter = await busyState(renew);
    assert.equal(renewAfter.disabled, false, 'the card button is usable again');
    assert.equal(renewAfter.spinners, 0);
    assert.equal((await renew.textContent()).trim(), 'חידוש ותשלום');
    // the renewal modal it opened would cover the card
    // dispatched in-page: at 360px the modal's footer may sit below the fold
    await page.evaluate(() => document.querySelector('#renewModal [data-close]').click());
    await page.waitForFunction(() => document.getElementById('renewModal').hidden);

    // --- B. the same save when the server FAILS ----------------------------
    await page.locator('#view-clients .client-card button', { hasText: 'עריכה' }).first().click();
    await page.waitForSelector('#editClientModal:not([hidden])');
    f.upstream.fail = true;
    release = f.holdOpen();
    await submit.click();
    await page.waitForFunction(() => document.querySelector('#editClientSubmit').getAttribute('aria-busy') === 'true');
    assert.equal((await busyState(submit)).disabled, true, 'disabled while the failing save is in flight');
    release();
    await page.waitForFunction(() => document.querySelector('#editClientSubmit').getAttribute('aria-busy') === null);
    const failed = await busyState(submit);
    assert.equal(failed.disabled, false, 'the button comes back after a server error');
    assert.equal(failed.spinners, 0);
    assert.equal(await submit.textContent(), 'שמור');
    f.upstream.fail = false;

    assert.deepEqual(errors, [], 'no page errors');
  });

  test('action spinner ' + vp.name + ': תמחור חבילות — יצירת הצעה, 🗑 מחיקה and רענון each spin, block a second click and restore', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, posts } = await f.open({ width: vp.width, height: vp.height });

    await page.click('.tab[data-view="packages"]');
    await page.waitForSelector('.pkg-admin');

    // --- C. יצירת הצעה (טיוטה) --------------------------------------------
    await page.locator('.pkg-new-btn').click();
    await page.locator('input[aria-label="שם הלקוח"]').fill('לקוחה לבדיקת ספינר');
    await page.locator('.pkg-pick .pkg-chip').first().click();
    const addBtn = page.locator('button', { hasText: '➕ הוספה להצעה' }).first();
    await page.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.indexOf('➕ הוספה להצעה') === 0);
      return b && !b.disabled;
    });
    await addBtn.click();
    const createBtn = page.locator('.pkg-create-btn');
    await createBtn.waitFor();

    let release = f.holdOpen();
    await createBtn.click();
    await page.waitForFunction(() => {
      const b = document.querySelector('.pkg-create-btn');
      return b && b.getAttribute('aria-busy') === 'true';
    });
    const creating = await busyState(page.locator('.pkg-create-btn'));
    assert.equal(creating.disabled, true, 'the create button is disabled while the quote is created');
    assert.equal(creating.spinners, 1, 'the create button shows the inline spinner');
    const sent = posts.length;
    await page.locator('.pkg-create-btn').click({ force: true });
    await page.waitForTimeout(200);
    assert.equal(posts.length, sent, 'a second «יצירת הצעה» click creates no second draft: ' + JSON.stringify(posts.slice(-3)));
    release();
    await page.waitForSelector('.pkg-card');
    assert.equal(await page.locator('.pkg-create-btn[aria-busy="true"]').count(), 0, 'no spinner left once the offer exists');

    // --- D. 🗑 מחיקה → אישור מחיקה ----------------------------------------
    await page.locator('.pkg-delete-btn').first().click();
    const ok = page.locator('.pkg-confirm-ok');
    await ok.waitFor();
    release = f.holdOpen();
    await ok.click();
    await page.waitForFunction(() => {
      const b = document.querySelector('.pkg-confirm-ok');
      return b && b.getAttribute('aria-busy') === 'true';
    });
    const deleting = await busyState(ok);
    assert.equal(deleting.disabled, true, 'אישור מחיקה is disabled while it deletes');
    assert.equal(deleting.spinners, 1);
    const sentD = posts.length;
    await ok.click({ force: true });
    await page.waitForTimeout(200);
    assert.equal(posts.length, sentD, 'a second «אישור מחיקה» click deletes nothing twice');
    release();
    await page.waitForFunction(() => !document.querySelector('.pkg-confirm-ok'), null, { timeout: 20000 });

    // --- E. רענון (a reload, not a write) ----------------------------------
    const refresh = page.locator('.pkg-admin button', { hasText: 'רענון' }).first();
    const idle = await busyState(refresh);
    release = f.holdOpen();
    await refresh.click();
    await page.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.indexOf('רענון') >= 0);
      return b && b.getAttribute('aria-busy') === 'true';
    });
    const refreshing = await busyState(page.locator('button[aria-busy="true"]').first());
    assert.equal(refreshing.disabled, true, 'רענון is disabled while the list reloads');
    assert.equal(refreshing.spinners, 1, 'רענון shows the spinner until the refresh completes');
    assert.ok(refreshing.width >= idle.width - 1, 'רענון keeps its width');
    release();
    await page.waitForFunction(() => document.querySelectorAll('button[aria-busy="true"]').length === 0, null, { timeout: 20000 });

    assert.deepEqual(errors, [], 'no page errors');
  });
}
