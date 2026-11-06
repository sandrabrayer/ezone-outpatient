'use strict';

// «תמחור חבילות» after the Node process restarts (Sandra, production, 2026-11-05 08:13, right after a
// Railway redeploy): the admin tab bar stayed on screen with «רשימת הבקשות לא נטענה» and no way back —
// «רענון» did nothing and only a full page reload helped.
//
// The catalog-admin privilege is a SERVER-SIDE, in-memory record (lib/catalog-admin.js createAdminSessions):
// a restart forgets it while the tab stays open with its admin cookie. Here the restart is emulated exactly
// as the server experiences it — the record store is replaced, the browser keeps every cookie.
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
  const epoch = admin('adminGetPackageCatalog', { user: 'ורד' }).catalogEpoch;
  assert.equal(post({ action: 'createPackageRequest', secret: 'package-request-secret-0123456789abcdef-B', requestId: '11111111-1111-4111-8111-111111111111', requesterKey: 'oren', patientName: 'מטופל אורן', patientPhone: '0502222222', packageKey: 'emdr_core', catalogEpoch: epoch }).ok, true);

  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    let result;
    if (options.method === 'POST') result = post(JSON.parse(options.body));
    else result = JSON.parse(sb.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent());
    return { status: 200, text: async () => JSON.stringify(result) };
  };
  // A restarted Node process: the in-memory admin-session store is empty again. Everything else (the signed
  // base-session cookie, the admin cookie in the browser) is untouched, exactly as in production.
  const realCreate = catalogAdmin.createAdminSessions;
  let store = null;
  let madeWith = null;
  catalogAdmin.createAdminSessions = function (o) { madeWith = o; store = realCreate(o); return proxy; };
  const proxy = {
    create: (...a) => store.create(...a), valid: (...a) => store.valid(...a),
    revoke: (...a) => store.revoke(...a), revokeByBinding: (...a) => store.revokeByBinding(...a), size: () => store.size()
  };
  const modulePath = require.resolve('../server');
  delete require.cache[modulePath];
  const app = require('../server');
  catalogAdmin.createAdminSessions = realCreate;
  const restartNode = () => { store = realCreate(madeWith); };
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    global.fetch = oldFetch;
    catalogAdmin.createAdminSessions = realCreate;
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
    page.on('console', (m) => {
      if (m.type() !== 'error' || /status of 401/.test(m.text())) return;
      const where = (m.location && m.location().url) || '';
      if (/\/api\/continuation-roster/.test(where)) return;
      consoleErrors.push(m.text() + ' @ ' + where);
    });
    page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/catalog-admin')) calls.push({ path: u.pathname, status: r.status() }); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    consoleErrors.length = 0; calls.length = 0;
    return { context, page, errors, consoleErrors, calls };
  }
  return { sb, open, restartNode };
}


async function dump(page) {
  return await page.evaluate(() => ({
    admin: !!document.querySelector('.pkg-admin'), gate: !!document.querySelector('.pkg-gate'),
    loadErr: !!document.querySelector('.pkg-load-error'), cards: document.querySelectorAll('.pkg-card').length,
    pin: !document.querySelector('#pin') || !document.querySelector('#pin').hidden,
    text: ((document.querySelector('#packagesRoot') || {}).textContent || '').slice(0, 120)
  }));
}


/* What the user must never see again: the admin screen with no list, no error and nothing to press. */
async function screen(page) {
  return await page.evaluate(() => ({
    admin: !!document.querySelector('.pkg-admin'),
    gate: !!document.querySelector('.pkg-gate'),
    loadError: !!document.querySelector('.pkg-load-error'),
    cards: document.querySelectorAll('.pkg-card').length,
    recovery: document.querySelectorAll('.pkg-load-error button, .pkg-gate-retry, .pkg-tabs button').length > 0,
    text: ((document.querySelector('#packagesRoot') || {}).textContent || '')
  }));
}
function assertAlive(st, where) {
  assert.ok(!(st.admin && !st.cards && !st.loadError), 'dead state (admin bar, no list, no error) at ' + where + ': ' + JSON.stringify(st));
  assert.ok(st.cards > 0 || st.loadError || st.gate, 'nothing explained at ' + where + ': ' + JSON.stringify(st));
  assert.ok(st.recovery, 'no control to recover with at ' + where + ': ' + JSON.stringify(st));
}

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('תמחור חבילות ' + vp.name + ': after the server forgot the admin session, «רענון» brings the list back by itself', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, calls, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height });
    await page.click('.tab[data-view="packages"]');
    await page.waitForSelector('.pkg-card');
    f.restartNode();                 // the Railway redeploy: the privilege record is gone, the tab is untouched
    calls.length = 0;
    await page.locator('.pkg-tabs button', { hasText: 'רענון' }).click();
    await page.waitForSelector('.pkg-card');
    const st = await screen(page);
    assertAlive(st, 'after רענון');
    assert.equal(st.loadError, false, 'the recovery is transparent: no error shown');
    assert.ok(/מטופל אורן/.test(st.text), 'the request list is back');
    assert.equal(calls.filter((c) => c.path.endsWith('/login')).length, 1, 'one renew only: ' + JSON.stringify(calls));
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}

test('תמחור חבילות: the privilege cannot be renewed — the gate explains it AND can be retried in place (no page reload)', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, calls, errors } = await f.open({ width: 1280, height: 900 });
  await page.click('.tab[data-view="packages"]');
  await page.waitForSelector('.pkg-card');
  f.restartNode();
  // the renew is refused for as long as this flag holds (the redeploy window: the restarted process is up but
  // the login does not go through yet)
  let refuseLogin = true;
  await page.route('**/api/catalog-admin/login', (r) => refuseLogin
    ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"catalog_admin_unavailable"}' })
    : r.continue());
  calls.length = 0;
  await page.locator('.pkg-tabs button', { hasText: 'רענון' }).click();
  await page.waitForSelector('.pkg-gate');
  let st = await screen(page);
  assert.equal(st.cards, 0);
  assert.ok(/לא ניתן לפתוח את התמחור כרגע/.test(st.text), 'the existing gate text: ' + st.text);
  assert.ok(st.recovery, 'the gate offers a way back: ' + JSON.stringify(st));
  // idle: nothing changes under her hands, and no retry loop
  const loginsSoFar = calls.filter((c) => c.path.endsWith('/login')).length;
  await page.waitForTimeout(1500);
  assert.equal(calls.filter((c) => c.path.endsWith('/login')).length, loginsSoFar, 'no renew loop while idle');
  assert.ok(loginsSoFar <= 2, 'at most one renew per load attempt: ' + JSON.stringify(calls));
  assert.ok(await page.locator('.pkg-gate-retry').count() > 0, 'the gate keeps its retry button');
  // the server is ready again: the retry in the gate restores the screen, no page reload
  refuseLogin = false;
  await page.locator('.pkg-gate-retry').click();
  await page.waitForSelector('.pkg-card');
  assertAlive(await screen(page), 'after the gate retry');
  assert.deepEqual(errors, []);
});

test('תמחור חבילות: a privilege that keeps lapsing never leaves a silent dead screen, and never loops', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, calls, errors } = await f.open({ width: 1280, height: 900 });
  await page.click('.tab[data-view="packages"]');
  await page.waitForSelector('.pkg-card');
  f.restartNode();
  // every rpc answers admin_required, however often the privilege is renewed (a redeploy where the retried
  // call does not reach the process that minted the record)
  await page.route('**/api/catalog-admin/rpc', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"error":"admin_required"}' }));
  calls.length = 0;
  await page.locator('.pkg-tabs button', { hasText: 'רענון' }).click();
  await page.waitForTimeout(1200);
  assertAlive(await screen(page), 'after רענון with a privilege that will not hold');
  await page.waitForTimeout(1500);                       // left idle
  assertAlive(await screen(page), 'idle');
  const logins = calls.filter((c) => c.path.endsWith('/login')).length;
  assert.ok(logins <= 4, 'bounded renews, no loop: ' + logins + ' ' + JSON.stringify(calls.map((c) => c.status + c.path)));
  assert.deepEqual(errors, []);
});

test('תמחור חבילות: the base session is gone — sign-in, and nothing silent', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page } = await f.open({ width: 1280, height: 900 });
  await page.click('.tab[data-view="packages"]');
  await page.waitForSelector('.pkg-card');
  await page.route('**/api/catalog-admin/rpc', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"error":"session_required"}' }));
  await page.locator('.pkg-tabs button', { hasText: 'רענון' }).click();
  await page.waitForTimeout(1200);
  // the app's own 401 handler took over: the sign-in screen is up (the pricing tab is not left pretending)
  assert.equal(await page.locator('#pinView:not([hidden])').count() || await page.locator('#app[hidden]').count(), 1,
    'unauthorized still sends the user to sign-in');
});

test('תמחור חבילות: the offer form inside a client card loads after the server forgot the privilege', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, errors } = await f.open({ width: 1280, height: 900 });
  await page.click('.tab[data-view="packages"]');
  await page.waitForSelector('.pkg-card');
  f.restartNode();
  await page.click('.tab[data-view="clients"]');
  const card = page.locator('.client-card', { hasText: 'מטופל חבילה' }).first();
  await card.getByRole('button', { name: '💰 הצעת מחיר' }).click();
  await card.locator('.cc-offer-host .pkg-new').waitFor();
  assert.equal(await card.locator('.cc-offer-host .pkg-msg').count(), 0, 'no refusal message in the card form');
  assert.deepEqual(errors, []);
});

// Source invariants of the recovery path (no browser needed, so CI checks them on every runner).
test('the pricing source keeps the recovery invariants', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'package-pricing.js'), 'utf8');
  // «רענון» and «נסי שוב» go through the boot path (privilege first), not a bare loadAll()
  assert.match(src, /text: 'רענון', onclick: refresh/, '«רענון» must route through refresh()');
  assert.match(src, /text: 'נסי שוב', onclick: refresh/, '«נסי שוב» must route through refresh()');
  assert.match(src, /async function refresh\(\) \{\s*S\.loading = true; draw\(\);\s*try \{ await boot\(\); \}/, 'refresh() is boot(), single-flight');
  // at most ONE renew per load attempt — the `renewed` flag, never an unconditional retry
  assert.match(src, /async function loadAll\(renewed\)/);
  assert.match(src, /if \(!renewed\) \{\s*try \{ ok = await ensureAdmin\(\); \}/);
  assert.match(src, /if \(ok\) \{ S\.phase = 'admin'; return loadAll\(true\); \}/);
  // a base-session 401 still reaches the host's sign-in handler, and is never turned into admin_required
  assert.match(src, /if \(r\.status === 401 && !\(j && j\.error === 'admin_required'\)\) \{ S\.onUnauthorized\(\); throw new Error\('unauthorized'\); \}/);
  // the single-flight protections that fixed the earlier "buttons do nothing" bug are still in place
  assert.match(src, /if \(adminFlight\) return adminFlight;/);
  assert.match(src, /if \(bootFlight\) return bootFlight;/);
  // the admin_required arm never leaves the admin screen without data
  assert.match(src, /S\.phase = 'gate'; S\.catalog = null; S\.requests = null;/);
});
