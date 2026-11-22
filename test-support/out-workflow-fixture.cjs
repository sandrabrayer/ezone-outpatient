'use strict';

// Actual HTTP server + public UI + Apps Script handlers. Only external services
// are synthetic. No application decision, response projection or financial rule
// is reimplemented here; all unexpected outbound requests fail the fixture.
const assert = require('node:assert/strict');
const { sandbox } = require('./apps-script-sandbox');
const catalogAdmin = require('../lib/catalog-admin');
const PROXY = 'fixture-proxy-key-with-at-least-32-characters';
const ASSERTION = 'workflow-catalog-assertion-synthetic-0123456789';
const HANDOFF = 'workflow-handoff-synthetic-0123456789';
const PLANS = 'workflow-plan-feed-synthetic-0123456789';
const OUTCOME = 'workflow-session-receiver-synthetic-0123456789';
const THERAPIST = 'מטפלת בדיקה';
const today = () => new Date().toISOString().slice(0, 10);
function chromium() {
  for (const module of [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)) {
    try { return require(module).chromium; } catch (_) {}
  }
  return null;
}
const required = process.env.EZONE_REQUIRE_BROWSER_TESTS === '1';
const browserAvailable = !!chromium();

async function fixture(t, { leads = [], clients = [], browser = true } = {}) {
  const sb = sandbox(leads, clients);
  Object.assign(sb.props, { CATALOG_ADMIN_ASSERTION_SECRET: ASSERTION,
    HANDOFF_STATUS_SECRET: HANDOFF, TREATMENT_PLANS_SECRET: PLANS, SESSION_OUTCOME_SECRET: OUTCOME });
  const rawPost = body => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(body) } }).getContent());
  const body = { user: 'ורד' };
  assert.equal(rawPost({ action: 'adminSeedPackageCatalog', ...body, proxySecret: PROXY,
    adminAssertion: catalogAdmin.signAssertion('adminSeedPackageCatalog', body, ASSERTION) }).ok, true);
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [{ name: THERAPIST, flatRate: 300 }]);
  const env = { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262',
    SESSION_SECRET: 'workflow-session-synthetic-not-a-real-credential',
    OUTPATIENT_PROXY_SECRET: PROXY, CATALOG_ADMIN_ASSERTION_SECRET: ASSERTION,
    SHEETS_URL: 'https://sheets.invalid/workflow', DASHBOARD_SHEETS_URL: 'https://dashboard.invalid/workflow',
    OCCUPANCY_SECRET: 'workflow-roster-synthetic' };
  const oldEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const realFetch = global.fetch, calls = [], unexpected = [], contexts = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.origin + url.pathname === env.DASHBOARD_SHEETS_URL) {
      assert.equal(url.searchParams.get('action'), 'getAdmittedRoster');
      return { status: 200, text: async () => JSON.stringify({ ok: true, patients: [] }) };
    }
    assert.equal(url.origin + url.pathname, env.SHEETS_URL, 'no external upstream is allowed');
    const post = options.method === 'POST';
    const payload = post ? JSON.parse(options.body) : Object.fromEntries(url.searchParams);
    const result = post ? rawPost(payload) : sb.get(payload);
    calls.push({ method: post ? 'POST' : 'GET', payload, result });
    return { status: 200, text: async () => JSON.stringify(result) };
  };
  const modulePath = require.resolve('../server');
  delete require.cache[modulePath];
  const app = require('../server');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  let chrome;
  t.after(async () => {
    await Promise.all(contexts.map(c => c.close()));
    if (chrome) await chrome.close();
    await new Promise(resolve => server.close(resolve));
    global.fetch = realFetch;
    for (const key of Object.keys(env)) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
    delete require.cache[modulePath];
    assert.deepEqual(unexpected, [], 'browser never requests an external site');
  });
  if (browser) {
    const runtime = chromium();
    assert.ok(runtime, 'EZONE_REQUIRE_BROWSER_TESTS=1 requires Playwright');
    const executablePath = process.env.EZONE_BROWSER_EXECUTABLE || process.env.CHROMIUM_PATH;
    try { chrome = await runtime.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); }
    catch (e) { if (required) throw e; t.skip('Chromium unavailable'); return null; }
  }
  async function open(who = 'ורד', width = 1280) {
    const context = await chrome.newContext({ viewport: { width, height: 900 }, timezoneId: 'UTC', serviceWorkers: 'block' });
    contexts.push(context);
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      unexpected.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(12000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'בדיקה סינתטית' : undefined));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText(who, { exact: true }).click();
    await page.fill('#pinInput', { 'ורד': '424242', 'אורן': '515151', 'דנה': '626262' }[who]);
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    return { page, context, errors };
  }
  async function request(method, pathname, payload, cookie) {
    assert.ok(pathname.startsWith('/api/'), 'fixture HTTP requests stay on the local API');
    const response = await realFetch(origin + pathname, { method,
      headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: await response.json(), cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
  }
  async function login(who) {
    const response = await request('POST', '/api/verify-pin', { user: who, pin: { 'ורד': '424242', 'אורן': '515151', 'דנה': '626262' }[who] });
    assert.equal(response.status, 200); assert.ok(response.cookie); return response.cookie;
  }
  return { sb, calls, open, origin, request, login,
    handoff: id => sb.get({ action: 'getHandoffStatus', secret: HANDOFF, outpatientIds: id }),
    plans: () => sb.get({ action: 'getTreatmentPlans', secret: PLANS }),
    outcome: payload => rawPost({ action: 'recordSessionOutcome', secret: OUTCOME, ...payload }) };
}

const sourceAction = (page, action, perform) => {
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/sheets' &&
    r.request().method() === 'POST' && (r.request().postDataJSON().action || 'saveAll') === action);
  return Promise.resolve(perform()).then(() => pending).then(r => r.json()).then(body => {
    assert.equal(body.ok, true, JSON.stringify(body)); return body;
  });
};
module.exports = { fixture, today, THERAPIST, sourceAction, browserAvailable, required };
