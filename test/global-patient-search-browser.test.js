'use strict';
// Real browser (Chromium), server.js + Code.gs sandbox, Hebrew RTL, 1280px and 360px:
//   A. «חיפוש מטופל» pinned at the top of «היום שלי» — name, phone with dashes, keyboard
//      nav, Esc, click-outside, opening a client card / an inactive patient / an open lead,
//      and NO money on a row (דנה, an operational session, sees the same rows);
//   B. «למי ההצעה» browse — clicking the EMPTY field opens מטופלים · מאושפזים · לידים פתוחים,
//      a roster row can be picked from the browse list, typing still narrows, the manual
//      name/phone row still works.
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
function todayPlus(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function daysAgo(n) { return todayPlus(-n); }

// phone deliberately dashed in the sheet, so a dashed OR bare query must both match
const ACTIVE = { id: 'gs-active', name: 'דנה כהן', phone: '052-378-7911', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: daysAgo(10), startDate: '2026-06-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
const OTHER = { id: 'gs-other', name: 'יוסי לוי', phone: '0541112222', status: 'פעיל', serviceType: 'קבוצתי', location: 'קיסריה עפרוני', sessionsPerWeek: '{"קבוצתי":1}', pricePerSession: 900, billingType: 'monthly', billingDay: 5, paymentStatus: 'paid', nextBillingDate: todayPlus(20), startDate: '2026-06-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
const DONE = { id: 'gs-done', name: 'רונית כהן', phone: '0509998888', status: 'סיים טיפול', serviceType: 'פרטני', location: 'רמות השבים', startDate: '2026-01-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
const LEADS = [
  { id: 'gs-lead', name: 'מיכל כהן', phone: '0501234567', stage: 'new', house_of_origin: 'external', serviceType: 'פרטני', assignedTo: 'ורד', created: daysAgo(3) },
  // the sheet stores the HEBREW stage label; app.js maps it to the stable id
  { id: 'gs-lead-closed', name: 'כהן לא רלוונטי', phone: '0501111112', stage: 'לא רלוונטי', source: 'אתר', assignedTo: 'ורד', created: daysAgo(30) }
];
const ROSTER = { ok: true, patients: [
  { sourceApp: 'dashboard', id: 'dash-77', name: 'נועה מאושפזת', phone: '050-123-4568', house: 'ramot', entryDate: daysAgo(20) },
  { sourceApp: 'dashboard', id: 'dash-78', name: 'אבי מאושפז', phone: '050-123-4569', house: 'asher', entryDate: daysAgo(40) }
] };

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox(LEADS, [ACTIVE, OTHER, DONE]);
  Object.assign(sb.props, { PACKAGE_CATALOG_SECRET: 'package-catalog-secret-0123456789abcdef-A', PACKAGE_REQUEST_SECRET: 'package-request-secret-0123456789abcdef-B', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => post(Object.assign({ action }, body, { proxySecret: process.env.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', DASHBOARD_SHEETS_URL: 'https://dashboard.invalid/exec', OCCUPANCY_SECRET: 'occupancy-fixture-secret', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.host === 'dashboard.invalid') return { status: 200, text: async () => JSON.stringify(ROSTER) };
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
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
  async function open(viewport, user) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], consoleErrors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 401|403/.test(m.text())) consoleErrors.push(m.text()); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText(user, { exact: true }).click();
    await page.fill('#pinInput', { 'דנה': '626262' }[user] || '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    consoleErrors.length = 0;
    return { context, page, errors, consoleErrors };
  }
  return { sb, post, open };
}

const noOverflow = async (page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'no horizontal overflow (' + over + 'px)');
};
const MONEY = /₪|2,?000|unpaid|לא שולם|חוב|יתרה/;
// the box is debounced (~150ms), so every assertion waits for the dropdown to settle
const gsNames = async (page, expected) => {
  await page.waitForFunction(
    (want) => JSON.stringify(Array.from(document.querySelectorAll('#globalSearchResults .gs-name'), (e) => e.textContent)) === want,
    JSON.stringify(expected), { timeout: 5000 }
  ).catch(() => {});
  assert.deepEqual(await page.locator('#globalSearchResults .gs-name').allTextContents(), expected);
};

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('global patient search ' + vp.name + ': name, phone, keyboard, open card / lead, no money', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height }, 'ורד');
    const input = page.locator('#globalSearch');
    const box = page.locator('#globalSearchResults');

    // the box is pinned ABOVE the KPI strip and spans the view
    await input.waitFor();
    const order = await page.evaluate(() => {
      const gs = document.querySelector('.gs-wrap'), kpi = document.querySelector('#view-dashboard .kpis-landing');
      return gs.compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
    });
    assert.equal(order, 'before', 'search box precedes the KPI strip');
    const widths = await page.evaluate(() => {
      const el = document.querySelector('#globalSearch');
      return { input: el.getBoundingClientRect().width, host: el.closest('.view').clientWidth };
    });
    assert.ok(widths.input >= widths.host - 40, 'full width (' + JSON.stringify(widths) + ')');
    assert.equal(await box.isHidden(), true, 'no dropdown at rest');

    // --- name: partial match anywhere, active + inactive clients + the OPEN lead
    await input.fill('כהן');
    await gsNames(page, ['דנה כהן', 'רונית כהן', 'מיכל כהן']);   // active, then inactive, then lead
    assert.deepEqual(await box.locator('.gs-hint').allTextContents(), ['פעיל', 'לא פעיל', 'ליד']);
    assert.equal(await box.locator('.gs-opt', { hasText: 'כהן לא רלוונטי' }).count(), 0, 'a not-relevant lead is not offered');
    // no money anywhere in the dropdown, not even for ורד
    const dropHtml = await box.innerHTML();
    assert.equal(MONEY.test(dropHtml), false, 'no financial data on a result row: ' + dropHtml.slice(0, 200));
    await noOverflow(page);

    // --- phone: dashes, bare and a tail all find the same client
    for (const q of ['052-378-7911', '0523787911', '3787911']) {
      await input.fill(q);
      await gsNames(page, ['דנה כהן']);
    }
    await input.fill('0000000');
    await box.locator('.gs-none').waitFor();

    // --- Esc clears; clicking outside closes
    await input.fill('כהן');
    await gsNames(page, ['דנה כהן', 'רונית כהן', 'מיכל כהן']);
    await input.press('Escape');
    assert.equal(await box.isHidden(), true, 'Esc closes');
    assert.equal(await input.inputValue(), '', 'Esc clears the box');
    await input.fill('כהן');
    await gsNames(page, ['דנה כהן', 'רונית כהן', 'מיכל כהן']);
    await page.locator('header.topbar .logo').click();   // the dropdown overlays the KPI strip, so click above it
    assert.equal(await box.isHidden(), true, 'a click outside closes');

    // --- keyboard: ↓ ↓ Enter opens the SECOND row (רונית כהן, inactive)
    await input.fill('כהן');
    await gsNames(page, ['דנה כהן', 'רונית כהן', 'מיכל כהן']);
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    assert.deepEqual(await box.locator('.gs-opt.is-active .gs-name').allTextContents(), ['רונית כהן']);
    await input.press('ArrowUp');
    assert.deepEqual(await box.locator('.gs-opt.is-active .gs-name').allTextContents(), ['דנה כהן'], '↑ moves back');
    await input.press('ArrowDown');
    await input.press('Enter');
    await page.waitForSelector('#view-inactive.active');
    await page.locator('#inactiveList .arc-card', { hasText: 'רונית כהן' }).waitFor();
    assert.equal(await input.inputValue(), '', 'the box is cleared when a result is opened');

    // --- click a result: the active client's card opens in מטופלים
    await page.click('.tab[data-view="dashboard"]');
    await input.fill('דנה');
    await gsNames(page, ['דנה כהן']);
    await box.locator('.gs-opt').first().click();
    await page.waitForSelector('#view-clients.active');
    const card = page.locator('#clientsList .client-card', { hasText: 'דנה כהן' });
    await card.waitFor();
    assert.equal(await card.count(), 1, 'the tab search is prefilled, so only that card shows');
    assert.equal(await page.locator('#clientsSearch').inputValue(), 'דנה כהן');
    assert.equal(await box.isHidden(), true);

    // --- a lead opens its לידים modal
    await page.click('.tab[data-view="dashboard"]');
    await input.fill('מיכל');
    await gsNames(page, ['מיכל כהן']);
    await box.locator('.gs-opt').first().click();
    await page.waitForSelector('#view-leads.active');
    await page.waitForSelector('#leadModal:not([hidden])');
    assert.equal(await page.locator('#leadForm [name="name"]').inputValue(), 'מיכל כהן');

    await noOverflow(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });

  test('global patient search ' + vp.name + ': דנה (operational session) — same rows, no money', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors } = await f.open({ width: vp.width, height: vp.height }, 'דנה');
    const input = page.locator('#globalSearch');
    const box = page.locator('#globalSearchResults');
    await input.fill('כהן');
    await gsNames(page, ['דנה כהן', 'רונית כהן', 'מיכל כהן']);
    const html = await box.innerHTML();
    assert.equal(MONEY.test(html), false, 'no money for an ops session: ' + html.slice(0, 200));
    // opening still works for her
    await box.locator('.gs-opt').first().click();
    await page.waitForSelector('#view-clients.active');
    await page.locator('#clientsList .client-card', { hasText: 'דנה כהן' }).waitFor();
    await noOverflow(page);
    assert.deepEqual(errors, []);
  });

  test('offer picker ' + vp.name + ': clicking the EMPTY field browses all three sources', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height }, 'ורד');
    // the roster is loaded on demand — open «מסלול המשך» once so the picker has מאושפזים
    await page.click('.tab[data-view="continuation"]');
    await page.locator('.continuation-row', { hasText: 'נועה מאושפזת' }).waitFor();
    await page.click('.tab[data-view="packages"]');
    await page.waitForSelector('.pkg-admin');
    await page.locator('.pkg-new-btn').click();
    await page.waitForSelector('.pkg-new');
    const who = page.locator('.pkg-new .pkg-who-input');
    const list = page.locator('.pkg-new .pkg-who-list');

    // BROWSE: click the empty field → the three sections with their uncapped totals
    await who.click();
    await list.locator('.pkg-who-section').first().waitFor();
    const sections = await list.locator('.pkg-who-section').allTextContents();
    assert.deepEqual(sections, ['מטופלים (3)', 'מאושפזים (2)', 'לידים פתוחים (1)'], 'browsable, honest totals: ' + sections.join(' | '));
    assert.equal(await who.inputValue(), '', 'nothing typed');
    assert.equal(await list.locator('.pkg-who-opt').count(), 6, 'every target is listed');
    assert.equal(await list.locator('.pkg-who-opt', { hasText: 'כהן לא רלוונטי' }).count(), 0, 'a not-relevant lead is never offered');
    assert.equal(await list.locator('.pkg-who-more').count(), 0, 'nothing truncated at this size');
    // the list scrolls instead of growing without bound, and nothing overflows sideways
    const scrollable = await list.evaluate((el) => getComputedStyle(el).overflowY === 'auto' && el.getBoundingClientRect().height <= window.innerHeight * 0.55);
    assert.equal(scrollable, true, 'the dropdown is scrollable and bounded');
    assert.equal(MONEY.test(await list.innerHTML()), false, 'no money on a picker row');
    await noOverflow(page);

    // typing still narrows, down to a single character
    await who.fill('נועה');
    await list.locator('.pkg-who-opt').first().waitFor();
    assert.deepEqual(await list.locator('.pkg-who-section').allTextContents(), ['מאושפזים (1)']);
    await who.fill('');
    await list.locator('.pkg-who-section').nth(2).waitFor();
    assert.equal(await list.locator('.pkg-who-opt').count(), 6, 'clearing the field goes back to browse');

    // pick an admitted patient straight out of the browse list
    await list.locator('.pkg-who-opt-roster', { hasText: 'נועה מאושפזת' }).click();
    await page.locator('.pkg-new .pkg-who-picked[data-target="roster:id:dash-77"]').waitFor();
    assert.match(await page.locator('.pkg-new .pkg-who-picked').textContent(), /נועה מאושפזת.*מאושפז\/ת · רמות השבים/s);

    // the manual «לקוח שאינו במערכת» row still works
    await page.locator('.pkg-new .pkg-who-picked button', { hasText: 'החלפה' }).click();
    const manual = page.locator('.pkg-new .pkg-who-manual input');
    await manual.first().fill('לקוח חד-פעמי');
    await manual.nth(1).fill('050-999-0000');
    assert.equal(await manual.first().inputValue(), 'לקוח חד-פעמי');

    // Esc closes the browse list
    await who.click();
    await list.locator('.pkg-who-section').first().waitFor();
    await who.press('Escape');
    assert.equal(await list.isHidden(), true, 'Esc closes the picker list');

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}
