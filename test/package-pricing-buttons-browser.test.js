'use strict';

// «תמחור חבילות» buttons (2026-11-03 report: "clicking the buttons opens nothing").
// Real browser (Chromium via Playwright) + real public UI + server.js + Code.gs in the in-memory sandbox,
// signed in as ורד, at 1280px and 360px. Covers the three root causes that were fixed:
//   1. two mounts during the first load ran two catalog logins; the second revoked the first admin session,
//      every rpc answered 401 admin_required and the screen was redrawn under the user — now ONE login, 0 × 401;
//   2. after the 15-minute privilege lapsed, the first click was silently dropped — now renewed + retried;
//   3. a failed load was drawn as an empty catalog / "no requests" — now an error with a retry button.
// And the regression itself: every button on every sub-tab opens what it should, no console errors.
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
const CLIENT = { id: 'fixture-c1', name: 'מטופל חבילה', phone: '0500000021', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-11-05', startDate: '2026-10-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };

async function fixture(t, opts) {
  opts = opts || {};
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
  const epoch = admin('adminGetPackageCatalog', { user: 'ורד' }).catalogEpoch;
  // two manager requests: a fixed-price pack (adjust + approve) and a Solo range (tier selection)
  assert.equal(post({ action: 'createPackageRequest', secret: 'package-request-secret-0123456789abcdef-B', requestId: '11111111-1111-4111-8111-111111111111', requesterKey: 'oren', patientName: 'מטופל אורן', patientPhone: '0502222222', packageKey: 'emdr_core', catalogEpoch: epoch }).ok, true);
  assert.equal(post({ action: 'createPackageRequest', secret: 'package-request-secret-0123456789abcdef-B', requestId: '22222222-2222-4222-8222-222222222222', requesterKey: 'shahar', patientName: 'מטופל שחר', patientPhone: '0503333333', packageKey: 'solo_housing', months: 3, catalogEpoch: epoch }).ok, true);

  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
  const upstream = { latencyMs: opts.latencyMs || 0, fail: false };
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    if (upstream.latencyMs) await new Promise((r) => setTimeout(r, upstream.latencyMs));
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
    page.setDefaultTimeout(15000);
    const errors = [], consoleErrors = [], calls = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/catalog-admin')) calls.push({ path: u.pathname, status: r.status(), body: r.request().postData() || '' }); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    // the pre-sign-in boot answers 401 before any session exists; only what happens after sign-in counts
    consoleErrors.length = 0; calls.length = 0;
    return { context, page, errors, consoleErrors, calls };
  }
  return { sb, upstream, open };
}

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('תמחור חבילות ' + vp.name + ': every button opens what it should, one login, no 401, no console errors, no horizontal scroll', skipOpt, async (t) => {
    const f = await fixture(t, { latencyMs: 250 }); if (!f) return;
    const { page, errors, consoleErrors, calls } = await f.open({ width: vp.width, height: vp.height });
    // The race: the pricing tab is opened, and while it loads the host app re-renders it (tab away and back).
    await page.click('.tab[data-view="packages"]');
    await page.waitForTimeout(100);
    await page.click('.tab[data-view="clients"]');
    await page.click('.tab[data-view="packages"]');
    await page.waitForSelector('.pkg-admin');
    await page.waitForSelector('.pkg-card');
    await page.waitForTimeout(800);
    assert.equal(calls.filter((c) => c.path.endsWith('/login')).length, 1, 'exactly one catalog login: ' + JSON.stringify(calls));
    assert.deepEqual(calls.filter((c) => c.status === 401), [], 'no admin_required bounce');
    assert.equal(await page.locator('.pkg-load-error').count(), 0);

    // requests: both manager requests are drawn with their controls
    assert.equal(await page.locator('.pkg-card').count(), 2);
    const solo = page.locator('.pkg-card', { hasText: 'מטופל שחר' });
    assert.equal(await solo.locator('select').count(), 1, 'Solo request offers the tier select');
    assert.equal(await solo.getByRole('button', { name: 'אישור תמחור' }).isDisabled(), true, 'cannot approve a range before a tier is picked');
    await solo.locator('select').selectOption({ index: 1 });
    await solo.getByRole('button', { name: 'בחירת מחיר חודשי' }).click();
    await page.locator('.pkg-card', { hasText: 'מטופל שחר' }).getByRole('button', { name: 'אישור תמחור' }).waitFor();
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('.pkg-card button')].find((x) => x.textContent === 'אישור תמחור' && x.closest('.pkg-card').textContent.includes('מטופל שחר')); return b && !b.disabled; });
    const oren = page.locator('.pkg-card', { hasText: 'מטופל אורן' });
    await oren.getByLabel('סכום מתואם').fill('3000');
    await oren.getByLabel('סיבת התאמה').fill('הנחת היכרות');
    await oren.getByRole('button', { name: 'התאמת סכום' }).click();
    await page.locator('.pkg-card', { hasText: 'מטופל אורן' }).locator('.pkg-log li', { hasText: 'הנחת היכרות' }).waitFor();
    await page.locator('.pkg-card', { hasText: 'מטופל אורן' }).getByRole('button', { name: 'אישור תמחור' }).click();
    await page.locator('.pkg-card', { hasText: 'מטופל אורן' }).locator('.pkg-approved').waitFor();
    // approved -> the attach control appears (a reference only; no charge, no payment)
    const attach = page.locator('.pkg-card', { hasText: 'מטופל אורן' }).getByRole('button', { name: 'שיוך (ללא חיוב)' });
    assert.equal(await attach.count(), 1);
    await page.locator('.pkg-card', { hasText: 'מטופל אורן' }).locator('select').selectOption({ label: 'מטופל · מטופל חבילה' });
    await attach.click();
    await page.locator('.pkg-card', { hasText: 'מטופל אורן' }).getByText(/משויך למטופל/).waitFor();
    assert.equal(f.sb.rows('Charges').length, 0, 'attaching a quote creates no charge');
    assert.equal(f.sb.rows('Payments').length, 0, 'attaching a quote creates no payment');

    // calculator: a package chip opens its options and a quote; every option is a button
    await page.locator('.pkg-tabs button', { hasText: 'מחשבון' }).click();
    await page.waitForSelector('.pkg-calc');
    await page.locator('.pkg-chip', { hasText: 'טווח מחיר' }).click();
    await page.locator('.pkg-chip', { hasText: 'אמצע' }).waitFor();
    await page.locator('.pkg-chip', { hasText: 'אמצע' }).click();
    await page.waitForSelector('.pkg-total');

    // catalog: «עריכת מחיר» opens the edit row (and closes it again)
    await page.locator('.pkg-tabs button', { hasText: 'קטלוג' }).click();
    await page.waitForSelector('.pkg-card');
    const editBtns = page.locator('.pkg-card').getByRole('button', { name: 'עריכת מחיר' });
    assert.ok((await editBtns.count()) >= 10, 'all catalog rows have an edit button');
    const first = page.locator('.pkg-card').first();
    assert.equal(await first.locator('.pkg-row').isHidden(), true);
    await first.getByRole('button', { name: 'עריכת מחיר' }).click();
    assert.equal(await first.locator('.pkg-row').isVisible(), true, 'the edit form opened');
    assert.equal(await first.getByRole('button', { name: 'שמירה כגרסה חדשה' }).isVisible(), true);
    await first.getByRole('button', { name: 'עריכת מחיר' }).click();
    assert.equal(await first.locator('.pkg-row').isHidden(), true, 'the edit form closed again');
    // the last card is reachable too (nothing covers the list)
    const last = page.locator('.pkg-card').last();
    await last.getByRole('button', { name: 'עריכת מחיר' }).click();
    assert.equal(await last.locator('.pkg-row').isVisible(), true);

    // רענון keeps the screen; the top-level tab buttons all switch
    await page.locator('.pkg-tabs button', { hasText: 'רענון' }).click();
    await page.waitForSelector('.pkg-card');
    await page.locator('.pkg-tabs button', { hasText: /^בקשות/ }).click();
    await page.locator('.pkg-card', { hasText: 'מטופל אורן' }).waitFor();

    // layout: no horizontal page scroll at this width
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'no horizontal overflow (' + over + 'px)');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}

test('תמחור חבילות: an expired catalog privilege is renewed and the click still does its work; a failed load shows an error with retry', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { context, page, calls, errors } = await f.open({ width: 1280, height: 900 });
  await page.click('.tab[data-view="packages"]');
  await page.waitForSelector('.pkg-card');
  // privilege lapses (the 15-minute cookie is gone)
  await context.clearCookies({ name: catalogAdmin.ADMIN_COOKIE });
  calls.length = 0;
  await page.locator('.pkg-tabs button', { hasText: 'מחשבון' }).click();
  await page.waitForSelector('.pkg-calc');
  await page.locator('.pkg-chip', { hasText: 'Core' }).first().click();
  await page.waitForSelector('.pkg-total');
  const seq = calls.map((c) => c.status + ' ' + c.path.replace('/api/catalog-admin', ''));
  assert.deepEqual(seq, ['401 /rpc', '200 /status', '200 /login', '200 /rpc'], 'renewed once, retried once: ' + JSON.stringify(seq));
  assert.match(await page.textContent('.pkg-total'), /3,400/);

  // the upstream fails: not an empty catalog — an error and a retry button
  f.upstream.fail = true;
  await page.locator('.pkg-tabs button', { hasText: 'רענון' }).click();
  await page.waitForSelector('.pkg-load-error');
  assert.match(await page.textContent('.pkg-load-error'), /הנתונים לא נטענו/);
  assert.equal(await page.locator('.pkg-calc').count(), 0, 'no misleading empty calculator');
  f.upstream.fail = false;
  await page.locator('.pkg-load-error button', { hasText: 'נסי שוב' }).click();
  await page.waitForSelector('.pkg-calc');
  assert.equal(await page.locator('.pkg-load-error').count(), 0);
  assert.deepEqual(errors, []);
});
