'use strict';

// OP-CRM-3A — real browser + public UI + server.js + Code.gs (dummy in-memory
// Sheets). דנה signs in: the app boots (the refused pay-constants file is not a
// failure), the money tabs / settings are hidden, the patient card shows no
// money, the activation form submits WITHOUT money fields and the server keeps
// the stored price; ורד sees everything. No production URL/credential/data.
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

const CLIENT = { id: 'fixture-c1', name: 'מטופל כסף', phone: '0500000021', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-11-05', startDate: '2026-10-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([], [CLIENT]);
  const captured = [], errors = [], statuses = [];
  const oldFetch = global.fetch;
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.APP_PIN = '424242';
  process.env.USER_PIN_OREN = '515151';
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
    page.on('response', (r) => { const u = new URL(r.url()); if (u.origin === origin) statuses.push({ user, path: u.pathname + u.search, status: r.status(), body: r.request().postData() }); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pinScreen:not([hidden])');
    await page.locator('#pinNames .user-btn').getByText(user, { exact: true }).click();
    await page.fill('#pinInput', { 'אורן': '515151', 'דנה': '626262' }[user] || '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    await page.click('.tab[data-view="clients"]');
    await page.locator('.client-card').first().waitFor();
    return page;
  }
  return { sb, captured, errors, statuses, login };
}

test('browser: דנה — app boots, money tabs/settings hidden, no money in the DOM or in any response, operational save keeps the stored price', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('דנה');
  for (const v of ['billing', 'revenue', 'payouts', 'packages']) {
    assert.equal(await page.locator('.tab[data-view="' + v + '"]').isHidden(), true, 'tab ' + v + ' hidden');
  }
  assert.equal(await page.locator('#settingsBtn').isHidden(), true);
  assert.equal(await page.locator('.client-card .cc-money').first().isVisible().catch(() => false), false, 'money panel hidden');
  const html = await page.locator('#view-clients').innerHTML();
  const leak = html.match(/.{0,80}(2,?000|₪\s*2|unpaid|לא שולם).{0,80}/);
  assert.equal(leak, null, 'no price / payment status rendered: ' + (leak && leak[0]));
  // the pay constants were refused but the app did not fail
  const pay = f.statuses.find((s) => s.user === 'דנה' && s.path.startsWith('/therapist-pay.js'));
  assert.ok(pay && pay.status === 403, 'therapist-pay.js refused');
  assert.equal(f.statuses.some((s) => s.user === 'דנה' && /action=getPayments|action=getCredits|action=getCharges|action=getSessionLog|action=getSettings/.test(s.path) && s.status === 200), false, 'no money read succeeded');

  // an operational edit (note) through the real UI
  await page.locator('.client-card').first().getByRole('button', { name: 'עריכה', exact: true }).click();
  const noteEl = page.locator('#editClientForm [name="notes"]');
  if (await noteEl.count()) await noteEl.fill('הערה תפעולית של דנה');
  const response = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST');
  await page.click('#editClientSubmit');
  const data = await (await response).json();
  assert.equal(data.ok, true, JSON.stringify(data));
  const save = f.captured.filter((c) => c.payload.action === 'saveAll').at(-1);
  assert.equal(save.payload.moneyScope, 'ops');
  assert.equal(save.payload.user, 'דנה');
  const sent = save.payload.clients.find((c) => c.id === CLIENT.id);
  assert.notEqual(String(sent && sent.pricePerSession), '2000', 'the browser never had the real price to send back');
  const row = f.sb.rows('Clients').find((c) => c.id === CLIENT.id);
  assert.equal(String(row.pricePerSession), '2000');
  assert.equal(row.paymentStatus, 'unpaid');
  assert.equal(row.billingType, 'monthly');
  assert.deepEqual(f.errors, []);
});

test('browser: ורד — money tabs visible, price rendered, pay constants served', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('ורד');
  for (const v of ['billing', 'revenue', 'payouts', 'packages']) {
    assert.equal(await page.locator('.tab[data-view="' + v + '"]').isVisible(), true, 'tab ' + v + ' visible');
  }
  const html = await page.locator('#view-clients').innerHTML();
  assert.equal(/2,?000/.test(html), true, 'price rendered for ורד');
  const pay = f.statuses.find((s) => s.user === 'ורד' && s.path.startsWith('/therapist-pay.js'));
  assert.ok(pay && pay.status === 200);
  assert.deepEqual(f.errors, []);
});
