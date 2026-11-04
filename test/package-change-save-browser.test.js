'use strict';

/**
 * Hotfix 2026-11-04 (CHANGELOG-hotfix-stale-save.md) — real browser + real
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
  const sb = sandbox([], [mkClient(1, 'אורן'), mkClient(2, 'ורד'), mkClient(3, 'אורן'), mkClient(4, 'ורד')]);
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
const sessionsOf = (r) => JSON.parse(r.sessionsPerWeek)['פרטני'];

/* עריכה: set the weekly frequency and (optionally) the monthly amount, submit, return the saveAll exchange. */
async function editPackage(fx, page, name, sessions, amount) {
  await card(page, name).getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.waitForSelector('#editClientModal:not([hidden])');
  await page.locator('#editClientForm [data-host="editClientSessions"] input[data-service]').first().fill(String(sessions));
  if (amount) await page.fill('#editClientForm [name="monthlyAmount"]', String(amount));
  const before = fx.captured.length;
  // persist() posts the snapshot without an explicit action (saveAll is the proxy default)
  const saved = page.waitForResponse((r) => {
    if (!r.url().endsWith('/api/sheets') || r.request().method() !== 'POST') return false;
    const a = (r.request().postDataJSON() || {}).action;
    return !a || a === 'saveAll';
  });
  await page.click('#editClientSubmit');
  await saved;
  await page.waitForTimeout(300);
  const saves = fx.captured.slice(before).filter((c) => c.payload.action === 'saveAll');
  assert.equal(saves.length, 1, 'one saveAll per edit');
  return saves[0];
}
async function bannerText(page) {
  return page.locator('#conflictBanner').evaluate((b) => b.hidden ? '' : b.textContent.trim());
}

test('browser: עריכה package change saves once, re-prices from the amount entered and survives a reload', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const page = await fx.login('ורד');
  const save = await editPackage(fx, page, 'מטופל 1', 3, 1500);
  assert.equal(save.result.ok, true);
  assert.equal(save.result.conflicts, undefined, 'no row refused');
  assert.deepEqual(save.result.stamped, { clients: 1, leads: 0 }, 'only the edited row is re-stamped');
  assert.equal(await bannerText(page), '');
  const r = row(fx.sb, 'c1');
  assert.equal(sessionsOf(r), 3);
  assert.equal(r.pricePerSession, 1500);
  assert.equal(r.updatedBy, 'ורד');
  assert.notEqual(r.updatedAt, STAMP);
  // other rows: content and stamps untouched (no spurious re-stamping that would conflict another tab)
  for (const id of ['c2', 'c3', 'c4']) { assert.equal(row(fx.sb, id).updatedAt, STAMP, id); assert.equal(sessionsOf(row(fx.sb, id)), 1, id); }
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="clients"]');
  await card(page, 'מטופל 1').waitFor();
  await card(page, 'מטופל 1').getByRole('button', { name: 'עריכה', exact: true }).click();
  assert.equal(await page.inputValue('#editClientForm [data-host="editClientSessions"] input[data-service]'), '3');
  assert.equal(await page.inputValue('#editClientForm [name="monthlyAmount"]'), '1500');
  // a second edit from the same tab is not a self-conflict (stamps adopted, cache not poisoned)
  await page.click('#editClientModal [data-close]');
  const again = await editPackage(fx, page, 'מטופל 1', 2);
  assert.equal(again.result.conflicts, undefined);
  assert.equal(sessionsOf(row(fx.sb, 'c1')), 2);
  assert.deepEqual(fx.errors, []);
});

test('browser: a tab stale only for rows אורן edited still saves its own package change; banner names his rows; the reload asks for a fresh read', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const vered = await fx.login('ורד');           // loads first → will echo old stamps for c3 / c4
  const oren = await fx.login('אורן');
  for (const name of ['מטופל 3', 'מטופל 4']) {
    const s = await editPackage(fx, oren, name, 4);
    assert.equal(s.result.conflicts, undefined);
  }
  fx.gets.length = 0;
  const save = await editPackage(fx, vered, 'מטופל 1', 3, 1700);
  assert.equal(save.result.ok, true);
  assert.deepEqual((save.result.conflicts || []).map((c) => c.name).sort(), ['מטופל 3', 'מטופל 4'], 'only the rows he changed are refused');
  assert.ok(save.result.conflicts.every((c) => c.sheetUpdatedBy === 'אורן' && !c.reason));
  const r1 = row(fx.sb, 'c1');
  assert.equal(sessionsOf(r1), 3, 'her own package change is written');
  assert.equal(r1.pricePerSession, 1700);
  assert.equal(sessionsOf(row(fx.sb, 'c3')), 4, 'his rows keep his version');
  assert.equal(sessionsOf(row(fx.sb, 'c4')), 4);
  const banner = await bannerText(vered);
  assert.match(banner, /מטופל 3, מטופל 4/);
  assert.match(banner, /אורן עדכן\/ה קודם/);
  assert.doesNotMatch(banner, /מטופל 1/, 'her own row is not reported as lost');
  await vered.waitForFunction(() => !!document.querySelector('#clientsList .client-card'));
  await vered.waitForTimeout(500);
  assert.ok(fx.gets.some((q) => q === '?fresh=1'), 'the conflict reload bypasses the proxy cache: ' + JSON.stringify(fx.gets));
  // after that reload the tab is current: her next edit of one of his rows is accepted
  const next = await editPackage(fx, vered, 'מטופל 3', 5);
  assert.equal(next.result.conflicts, undefined);
  assert.equal(sessionsOf(row(fx.sb, 'c3')), 5);
  assert.deepEqual(fx.errors, []);
});

test('browser: חידוש ותשלום with a package change re-prices the row; until «אישור וסגירה» an עריכה save is refused with the open-operation wording, then saves', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const page = await fx.login('ורד');
  await card(page, 'מטופל 2').getByRole('button', { name: 'חידוש ותשלום', exact: true }).click();
  await page.waitForSelector('#renewModal:not([hidden])');
  await page.waitForSelector('#renewSubmit:not([disabled])');
  await page.locator('#renewForm [data-host="renewSessions"] input[data-service]').first().fill('2');
  await page.fill('#renewForm [name="renewAmount"]', '1800');
  await page.click('#renewSubmit');
  await page.locator('#renewResume').getByText('אישור וסגירה', { exact: true }).waitFor();
  const r2 = row(fx.sb, 'c2');
  assert.equal(sessionsOf(r2), 2, 'new frequency');
  assert.equal(r2.pricePerSession, 1800, 're-priced from the renewal amount');
  assert.equal(r2.packageChangeDate, '2026-11-04', 'cycle re-anchored to the paid date');
  assert.equal(r2.paymentDate, '2026-11-04');
  assert.equal(fx.sb.rows('Payments').length, 1);
  assert.equal(fx.sb.rows('FinancialOps')[0].state, 'done');
  // close WITHOUT confirming → the row stays reserved by the journal
  await page.click('#renewModal [data-close]');
  await page.waitForSelector('#renewModal', { state: 'hidden' });
  const refused = await editPackage(fx, page, 'מטופל 2', 3);
  assert.equal(refused.result.conflicts.length, 1);
  assert.equal(refused.result.conflicts[0].reason, 'financial_operation_pending');
  const banner = await bannerText(page);
  assert.match(banner, /מטופל 2/);
  assert.match(banner, /פעולה כספית פתוחה/);
  assert.doesNotMatch(banner, /עדכן\/ה קודם/, 'a reservation is not blamed on an editor');
  assert.match(await page.locator('#toast').textContent(), /שמירה נכשלה/);
  assert.equal(sessionsOf(row(fx.sb, 'c2')), 2, 'the reserved row is untouched');
  // confirm the renewal → the reservation closes → the same edit saves
  await page.waitForTimeout(600);
  await card(page, 'מטופל 2').getByRole('button', { name: 'חידוש ותשלום', exact: true }).click();
  await page.locator('#renewResume').getByText('אישור וסגירה', { exact: true }).waitFor();
  await page.click('#renewResume');
  await page.waitForSelector('#renewModal', { state: 'hidden' });
  assert.equal(fx.sb.rows('FinancialOps')[0].state, 'acknowledged');
  await page.waitForTimeout(600);
  const ok = await editPackage(fx, page, 'מטופל 2', 3);
  assert.equal(ok.result.conflicts, undefined);
  assert.equal(sessionsOf(row(fx.sb, 'c2')), 3);
  assert.equal(row(fx.sb, 'c2').pricePerSession, 1800, 'the renewal price stays unless the amount is edited');
  assert.deepEqual(fx.errors, []);
});
