'use strict';

/**
 * Plan-types save fix + therapist search (2026-11-09, CHANGELOG-plan-types-save-fix.md).
 * Real browser + real server.js + real Code.gs (in-memory Sheets only):
 *   1. ורד opens a row damaged before the fix (multi-type plan collapsed to the
 *      clinical type) — the edit modal shows every picked type; saving stores
 *      the whole plan, and a second save keeps it.
 *   2. חיפוש מטפל/ת filters the pickers; Enter picks a single match; a missing
 *      name («אוהד לביא») is added to TherapistRates (names only) and picked;
 *      the save persists both therapists.
 *   3. דנה (operational) never sees the add button.
 *
 * (Template below adapted from package-change-save-browser.test.js — Hotfix 2026-11-04 (CHANGELOG-hotfix-stale-save.md) — real browser + real
 * server.js + real Code.gs (in-memory Sheets only). Locks the package-change
 * save paths of the patient card for ורד:
 *
 *   1. עריכה — new weekly frequency + new monthly amount → saveAll accepted,
 *      the row is stamped once, a reload shows the new package and price.
 *   2. a tab that is stale ONLY for rows someone else (אורן) edited still saves
 *      its own package change; the refusal banner names only his rows, and the
 *      reload it triggers asks the proxy for a fresh read (?fresh=1).
 *   3. חידוש ותשלום with a package change — the journal flow re-prices the
 *      row (pricePerSession = the amount entered, new frequency,
 *      packageChangeDate = paid date). Before «אישור וסגירה» the row is
 *      reserved: an עריכה save is refused with the open-operation wording
 *      (never «ורד עדכן/ה קודם»); after the confirmation the same edit saves.
 */
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

const STAMP = '2026-11-01T08:00:00.000Z';
function mkClient(i, by) {
  return { id: 'c' + i, name: 'מטופל ' + i, phone: '05000000' + (10 + i), serviceType: 'פרטני',
    sessionsPerWeek: '{"פרטני":1}', location: 'רעננה הפרדס', status: 'פעיל', pricePerSession: 1200,
    startDate: '2026-09-01', billingDay: 1, nextBillingDate: '2026-11-01', paymentDate: '2026-10-01',
    paymentStatus: 'paid', source: 'lead', billingType: 'monthly', updatedAt: STAMP, updatedBy: by };
}

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.EZONE_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox'] }); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const damaged = Object.assign(mkClient(1, 'ורד'), { serviceType: 'מעקב פסיכיאטרי', clinicalTreatmentType: 'מעקב פסיכיאטרי',
    sessionsPerWeek: '{"פרטני":2,"ליווי יומי בקהילה":1,"מעקב פסיכיאטרי":2,"_units":{"פרטני":"שבוע","ליווי יומי בקהילה":"שבוע","מעקב פסיכיאטרי":"חודש"}}' });
  const sb = sandbox([], [damaged, mkClient(2, 'ורד')]);
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [
    { name: 'איתן דשא', flatRate: 300 }, { name: 'הילה תבור', flatRate: 300 }, { name: 'ד"ר ילנה זבניאצקובסקי', intakeRate: 900, followupRate: 700 }]);
  sb.ctx._todayISODate = () => '2026-11-04';
  const captured = [], errors = [], gets = [];
  const oldFetch = global.fetch;
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.APP_PIN = '424242';
  process.env.USER_PIN_OREN = '515151'; // throwaway fixture values, never real PINs
  process.env.USER_PIN_DANA = '626262';
  process.env.SESSION_SECRET = 'fixture-session-secret-not-a-real-credential';
  process.env.SHEETS_URL = 'https://sheets.invalid/fixture';
  delete process.env.DASHBOARD_SHEETS_URL;
  delete process.env.OCCUPANCY_SECRET;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    let result;
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body);
      result = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(payload) } }).getContent());
      captured.push({ payload, result });
    } else {
      result = JSON.parse(sb.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent());
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
  async function login(user) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (r.method() === 'GET' && r.url().indexOf('/api/sheets') >= 0) gets.push(new URL(r.url()).search); });
    await page.addInitScript(() => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : ['2026-11-04T09:00:00Z'])); }
        static now() { return new RealDate('2026-11-04T09:00:00Z').getTime(); }
      };
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pinScreen:not([hidden])');
    await page.locator('#pinNames .user-btn').getByText(user, { exact: true }).click();
    await page.fill('#pinInput', { 'אורן': '515151', 'דנה': '626262' }[user] || '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    await page.click('.tab[data-view="clients"]');
    await page.locator('#clientsList .client-card').first().waitFor();
    return page;
  }
  return { sb, captured, errors, gets, login };
}


const card = (page, name) => page.locator('#clientsList .client-card').filter({ has: page.locator('.client-name', { hasText: name }) });
const row = (sb, id) => sb.rows('Clients').find((r) => r.id === id);
async function openEdit(page, name) {
  await card(page, name).getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.waitForSelector('#editClientModal:not([hidden])');
}
async function submitEdit(fx, page) {
  const before = fx.captured.length;
  await page.click('#editClientSubmit');
  await page.waitForFunction(() => !document.querySelector('#editClientModal') || document.querySelector('#editClientModal').hidden);
  for (let i = 0; i < 50 && !fx.captured.slice(before).some((c) => c.payload.action === 'saveAll'); i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  const saves = fx.captured.slice(before).filter((c) => c.payload.action === 'saveAll');
  assert.equal(saves.length, 1, 'one saveAll per edit');
  assert.equal(saves[0].result.ok, true);
  return saves[0];
}
const optionTexts = (page, n) => page.locator(`select[data-private-therapist="${n}"] option`).allTextContents();

test('a damaged plan is shown whole, saved whole, and stays whole', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const page = await fx.login('ורד');
  await openEdit(page, 'מטופל 1');
  const checked = await page.locator('#editClientForm [data-group="serviceType"] input:checked').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(checked.sort(), ['ליווי יומי בקהילה', 'מעקב פסיכיאטרי', 'פרטני'].sort());
  await page.fill('#editClientForm [name="notes"]', 'בדיקה');
  await submitEdit(fx, page);
  assert.equal(row(fx.sb, 'c1').serviceType, 'פרטני, ליווי יומי בקהילה, מעקב פסיכיאטרי');
  assert.equal(row(fx.sb, 'c1').notes, 'בדיקה');
  // a second, unrelated edit keeps the plan (the server no longer collapses it)
  await openEdit(page, 'מטופל 1');
  await page.fill('#editClientForm [name="notes"]', 'בדיקה 2');
  await submitEdit(fx, page);
  assert.equal(row(fx.sb, 'c1').serviceType, 'פרטני, ליווי יומי בקהילה, מעקב פסיכיאטרי');
  assert.deepEqual(fx.errors, []);
});

test('therapist search filters, Enter picks, a missing name is added and saved', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const page = await fx.login('ורד');
  await openEdit(page, 'מטופל 1');
  const search = page.locator('input[data-therapist-search]');
  await search.waitFor();
  assert.equal(await page.locator('button[data-therapist-add]').isHidden(), true);
  await search.fill('דר ילנה'); // quotes and spaces ignored
  assert.deepEqual(await optionTexts(page, 1), ['— ללא —', 'ד"ר ילנה זבניאצקובסקי']);
  await search.press('Enter');
  assert.equal(await page.locator('select[data-private-therapist="1"]').inputValue(), 'ד"ר ילנה זבניאצקובסקי');
  assert.equal(await page.locator('#editClientModal').isVisible(), true, 'Enter never submits the form');
  await search.fill('אוהד לביא');
  const add = page.locator('button[data-therapist-add]');
  await add.waitFor({ state: 'visible' });
  assert.match(await add.textContent(), /אוהד לביא/);
  await add.click();
  await page.waitForFunction(() => document.querySelector('select[data-private-therapist="2"]').value === 'אוהד לביא');
  const added = fx.sb.rows('TherapistRates').find((r) => r.name === 'אוהד לביא');
  assert.deepEqual(added, { name: 'אוהד לביא', flatRate: '', intakeRate: '', followupRate: '' });
  const addCall = fx.captured.find((c) => c.payload.action === 'addTherapistToRoster');
  assert.equal(addCall.payload.moneyScope, 'full', 'scope set by the proxy');
  assert.equal(addCall.payload.user, 'ורד');
  await submitEdit(fx, page);
  assert.equal(row(fx.sb, 'c1').privateTherapists, '["ד\\"ר ילנה זבניאצקובסקי","אוהד לביא"]');
  // the roster now offers him in every picker after a reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="clients"]');
  await openEdit(page, 'מטופל 2');
  await page.locator('#editClientForm [data-host="editClientSessions"] input[data-service="פרטני"]').fill('2');
  assert.ok((await optionTexts(page, 1)).includes('אוהד לביא'));
  assert.deepEqual(fx.errors, []);
});

test('an operational session (דנה) gets search but never the add button', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const page = await fx.login('דנה');
  await openEdit(page, 'מטופל 1');
  await page.locator('input[data-therapist-search]').fill('אוהד לביא');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('button[data-therapist-add]').isHidden(), true);
  assert.equal(fx.captured.some((c) => c.payload.action === 'addTherapistToRoster'), false);
});
