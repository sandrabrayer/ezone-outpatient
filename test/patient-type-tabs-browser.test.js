'use strict';
// «מטופלים» patient-type tabs (CHANGELOG-patient-type-tabs.md) — real browser (Chromium),
// server.js + Code.gs sandbox, 1280px and 360px:
// ורד opens «מטופלים» → «הכול» / «קהילה יומית» / «טיפולים פרטניים» / «פסיכיאטר» with counts of the
// ACTIVE patients only → each tab lists exactly its patients (a lead booked for a psychiatric one-time
// session lands in «פסיכיאטר»; a day-community patient with a psychiatric session stays in «קהילה יומית»)
// → «סוג מטופל» in עריכה moves a patient by hand («ידני» on the card), persisted on the sheet, and
// «אוטומטי» moves him back. No page error, no console error.
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

const common = { status: 'פעיל', location: 'רעננה הפרדס', billingType: 'monthly', startDate: '2026-10-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
const CLIENTS = [
  Object.assign({ id: 'pt-day', name: 'מטופלת קהילה', phone: '0500000061', serviceType: 'ליווי יומי בקהילה, מעקב פסיכיאטרי', sessionsPerWeek: '{"ליווי יומי בקהילה":3,"מעקב פסיכיאטרי":1}', pricePerSession: 15000, billingDay: 5, paymentStatus: 'paid', nextBillingDate: '2026-12-05' }, common),
  Object.assign({ id: 'pt-ind', name: 'מטופל פרטני', phone: '0500000062', serviceType: 'פרטני CBT', sessionsPerWeek: '{"פרטני CBT":1}', pricePerSession: 2000, billingDay: 5, paymentStatus: 'paid', nextBillingDate: '2026-12-05' }, common),
  Object.assign({ id: 'pt-psy', name: 'מטופל מעקב פסיכיאטרי', phone: '0500000063', serviceType: 'מעקב פסיכיאטרי', sessionsPerWeek: '{"מעקב פסיכיאטרי":1}', pricePerSession: 1100, billingDay: 5, paymentStatus: 'paid', nextBillingDate: '2026-12-05' }, common),
  Object.assign({ id: 'pt-lead', name: 'פנייה חד פעמית', phone: '0500000064', serviceType: '', sessionsPerWeek: '{}', pricePerSession: 0, billingMode: 'per_session', paymentStatus: '', nextBillingDate: '' }, common),
  Object.assign({ id: 'pt-done', name: 'מטופל ששוחרר', phone: '0500000065', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000 }, common, { status: 'סיים טיפול' })
];
const SESSIONS = [
  { id: 'ots-lead-1', clientId: 'pt-lead', patientName: 'פנייה חד פעמית', phone: '0500000064', catalogKey: 'psychiatric_intake', clinicalTreatmentType: 'אינטייק', therapist: 'ד"ר מיכאל שפרינץ', date: '2026-11-20', time: '10:00', status: 'scheduled', revision: 1, createdAt: '2026-11-17T08:00:00.000Z', createdBy: 'ורד' },
  { id: 'ots-day-1', clientId: 'pt-day', patientName: 'מטופלת קהילה', phone: '0500000061', catalogKey: 'psychiatric_consult', clinicalTreatmentType: 'מעקב פסיכיאטרי', therapist: 'ד"ר מיכאל שפרינץ', date: '2026-11-21', time: '11:00', status: 'scheduled', revision: 1, createdAt: '2026-11-17T08:00:00.000Z', createdBy: 'ורד' }
];

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([], CLIENTS);
  sb.seed('OneTimeSessions', sb.ctx.ONE_TIME_SESSION_HEADERS, SESSIONS);
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());

  const keys = ['APP_PIN', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture' });
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    const result = options.method === 'POST'
      ? post(JSON.parse(options.body))
      : JSON.parse(sb.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent());
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
    const context = await browser.newContext({ serviceWorkers: 'block', viewport, timezoneId: 'UTC' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
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
    await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    consoleErrors.length = 0;
    return { page, errors, consoleErrors };
  }
  return { sb, open };
}

async function tabs(page) {
  return page.$$eval('#clientTypeTabs .ctt', (bs) => bs.map((b) => ({
    type: b.dataset.clientType, text: b.textContent.replace(/\s+/g, ' ').trim(), active: b.classList.contains('active')
  })));
}
async function cardsText(page) {
  return page.$$eval('#clientsList .client-card', (cs) => cs.map((c) => c.textContent));
}
async function pick(page, type) {
  await page.click('#clientTypeTabs .ctt[data-client-type="' + type + '"]');
  await page.waitForSelector('#clientTypeTabs .ctt.active[data-client-type="' + type + '"]');
}
const listed = async (page) => {
  const texts = await cardsText(page);
  return CLIENTS.map((c) => c.name).filter((n) => texts.some((t) => t.includes(n))).sort();
};

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('patient-type tabs ' + vp.name + ': counts, per-tab lists, manual override round-trip', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height });
    await page.click('.tab[data-view="clients"]');
    await page.waitForSelector('#clientTypeTabs .ctt');

    assert.deepEqual(await tabs(page), [
      { type: 'all', text: 'הכול 4', active: true },
      { type: 'day_community', text: 'קהילה יומית 1', active: false },
      { type: 'individual', text: 'טיפולים פרטניים 1', active: false },
      { type: 'psychiatric', text: 'פסיכיאטר 2', active: false }
    ], 'the discharged patient is not counted');
    assert.deepEqual(await listed(page), ['מטופל מעקב פסיכיאטרי', 'מטופל פרטני', 'מטופלת קהילה', 'פנייה חד פעמית']);
    // under «הכול» every card names its type
    const all = await cardsText(page);
    assert.ok(all.find((x) => x.includes('פנייה חד פעמית')).includes('פסיכיאטר'));

    await pick(page, 'day_community');
    assert.deepEqual(await listed(page), ['מטופלת קהילה'], 'stays here despite the psychiatric session');
    await pick(page, 'individual');
    assert.deepEqual(await listed(page), ['מטופל פרטני']);
    await pick(page, 'psychiatric');
    assert.deepEqual(await listed(page), ['מטופל מעקב פסיכיאטרי', 'פנייה חד פעמית'], 'psychiatric plan + the lead booked for an intake');
    assert.ok((await page.locator('#clientTabs').isHidden()), 'no service filter when it cannot narrow anything');

    // search narrows inside the tab; counts stay on the whole active list
    await page.fill('#clientsSearch', 'פנייה');
    assert.deepEqual(await listed(page), ['פנייה חד פעמית']);
    assert.equal((await tabs(page))[3].text, 'פסיכיאטר 2');
    await page.fill('#clientsSearch', '');

    // manual override: move the CBT patient to «פסיכיאטר»
    await pick(page, 'individual');
    const card = page.locator('#clientsList .client-card', { hasText: 'מטופל פרטני' });
    await card.locator('button', { hasText: 'עריכה' }).click();
    await page.waitForSelector('#editClientModal:not([hidden])');
    const sel = page.locator('#editClientForm select[name="patientTypeOverride"]');
    assert.equal(await sel.inputValue(), '', 'automatic by default');
    assert.equal(await page.locator('#editClientPatientTypeAuto').textContent(), 'אוטומטי כרגע: טיפולים פרטניים');
    await sel.selectOption('psychiatric');
    await page.click('#editClientSubmit');
    await page.waitForSelector('#editClientModal', { state: 'hidden' });
    await page.waitForFunction(() => {
      const b = document.querySelector('#clientTypeTabs .ctt[data-client-type="psychiatric"]');
      return b && /3$/.test(b.textContent.trim());
    });
    assert.equal(f.sb.rows('Clients').find((r) => r.id === 'pt-ind').patientTypeOverride, 'psychiatric', 'persisted on the sheet');
    assert.deepEqual(await listed(page), [], 'left «טיפולים פרטניים»');
    await pick(page, 'psychiatric');
    const moved = (await cardsText(page)).find((x) => x.includes('מטופל פרטני'));
    assert.ok(moved && moved.includes('ידני'), '«ידני» marks the manual choice');

    // back to automatic
    await page.locator('#clientsList .client-card', { hasText: 'מטופל פרטני' }).locator('button', { hasText: 'עריכה' }).click();
    await page.waitForSelector('#editClientModal:not([hidden])');
    assert.equal(await sel.inputValue(), 'psychiatric');
    await sel.selectOption('');
    await page.click('#editClientSubmit');
    await page.waitForSelector('#editClientModal', { state: 'hidden' });
    await page.waitForFunction(() => /1$/.test(document.querySelector('#clientTypeTabs .ctt[data-client-type="individual"]').textContent.trim()));
    assert.equal(f.sb.rows('Clients').find((r) => r.id === 'pt-ind').patientTypeOverride, '');

    // nothing else on the row moved: billing fields untouched by the two saves
    const row = f.sb.rows('Clients').find((r) => r.id === 'pt-ind');
    assert.equal(String(row.pricePerSession), '2000');
    assert.equal(row.nextBillingDate, '2026-12-05');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}
