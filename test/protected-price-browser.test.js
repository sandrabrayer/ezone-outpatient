'use strict';
// Real browser + public UI + server.js. Price / pay constants must not exist in the page before
// sign-in, must arrive after it, must be dropped on logout, and must never enter the service-worker
// cache or the HTTP cache. Dummy in-memory Sheets only; no external request is allowed.
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

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary'); return null;
  }
  const sb = sandbox([]);
  const oldFetch = global.fetch;
  const keys = ['APP_PIN', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'PORT'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.APP_PIN = '424242';
  process.env.SESSION_SECRET = 'fixture-session-secret-not-a-real-credential';
  process.env.SHEETS_URL = 'https://sheets.invalid/fixture';
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    const result = options.method === 'POST'
      ? JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: options.body } }).getContent())
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
  return { browser, origin };
}

const PROTECTED = /(treatment-map|therapist-pay)\.js/;

test('browser: constants are absent before sign-in, present after, dropped on logout, never cached', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const context = await fx.browser.newContext();                       // service workers ALLOWED on purpose
  await context.route('**/*', (route) => new URL(route.request().url()).origin === fx.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const protectedResponses = [];
  page.on('response', (r) => { if (PROTECTED.test(r.url())) protectedResponses.push([r.status(), r.headers()['cache-control'] || '']); });
  const globals = () => page.evaluate(() => ({ map: typeof window.TreatmentMap, pay: typeof window.TherapistPay, payout: typeof window.TherapistPayout, nodes: document.querySelectorAll('script[data-protected]').length }));

  await page.goto(fx.origin, { waitUntil: 'networkidle' });
  await page.waitForSelector('#pinScreen:not([hidden])');
  assert.deepEqual(await globals(), { map: 'undefined', pay: 'undefined', payout: 'undefined', nodes: 0 }, 'nothing before sign-in');
  assert.deepEqual(protectedResponses, [], 'the page did not even request them while signed out');

  await page.fill('#pinInput', '424242');
  await page.click('#pinSubmit');
  await page.locator('#userButtons .user-btn').getByText('ורד', { exact: true }).click();
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => typeof window.TherapistPay === 'object' && typeof window.TreatmentMap === 'object' && typeof window.TherapistPayout === 'object');
  assert.deepEqual((await globals()).nodes, 3);
  assert.ok(protectedResponses.length === 2 && protectedResponses.every(([s, cc]) => s === 200 && cc === 'no-store'), JSON.stringify(protectedResponses));
  // billing helpers still work once loaded (math untouched)
  assert.equal(await page.evaluate(() => window.TreatmentMap.billingPrice('פרטני')), 500);
  assert.equal(await page.evaluate(() => window.TherapistPayout && typeof window.TherapistPayout.monthlyPayoutSummary), 'function');

  // service worker active + reload: still not in any cache
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.TherapistPay === 'object');
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) { const c = await caches.open(k); for (const req of await c.keys()) out.push(req.url); }
    return out;
  });
  assert.ok(cached.length > 0, 'the shell is cached, so this check is meaningful');
  assert.deepEqual(cached.filter((u) => PROTECTED.test(u)), [], 'no price/pay file in Cache Storage');

  // logout drops everything and the server stops answering
  await page.click('#logoutBtn');
  await page.waitForSelector('#pinScreen:not([hidden])');
  assert.deepEqual(await globals(), { map: 'undefined', pay: 'undefined', payout: 'undefined', nodes: 0 }, 'dropped on logout');
  const after = await page.evaluate(async () => (await fetch('/treatment-map.js', { cache: 'no-store' })).status);
  assert.equal(after, 401, 'the server no longer answers once the session is gone');
  assert.deepEqual(errors, []);
});
