'use strict';

// OP-ID-2 — real browser + public UI + server.js + Code.gs (dummy in-memory
// Sheets; the Dashboard roster is a fixture served at a fake URL). Scenario: a
// coordinator decides to_outpatient on the continuation tab; the SERVER creates
// the lead from the roster identity, links the continuation row, and a replay
// links instead of duplicating. No production URL, credential or data is used.
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

const ROSTER = { ok: true, patients: [
  { sourceApp: 'ezone-dashboard', id: 'id-stay-1', personId: 'id-root-1', name: 'מטופל המשך א', phone: '0500000011', house: 'asher', entryDate: '2026-07-01' },
  { sourceApp: 'ezone-dashboard', name: 'מטופל ללא מזהה', phone: '0500000012', house: 'ramot', entryDate: '2026-08-01' }
] };

async function fixture(t, initialLeads) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox(initialLeads || []);
  const captured = [], errors = [];
  const oldFetch = global.fetch;
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.APP_PIN = '424242';
  process.env.USER_PIN_OREN = '515151';
  process.env.USER_PIN_DANA = '626262';
  process.env.SESSION_SECRET = 'fixture-session-secret-not-a-real-credential';
  process.env.SHEETS_URL = 'https://sheets.invalid/fixture';
  process.env.DASHBOARD_SHEETS_URL = 'https://dashboard.invalid/fixture';
  process.env.OCCUPANCY_SECRET = 'fixture-occupancy-secret';
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.origin + url.pathname === 'https://dashboard.invalid/fixture') {
      assert.equal(url.searchParams.get('action'), 'getAdmittedRoster');
      assert.equal(url.searchParams.get('secret'), 'fixture-occupancy-secret');
      return { status: 200, text: async () => JSON.stringify(ROSTER) };
    }
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
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pinScreen:not([hidden])');
    await page.locator('#pinNames .user-btn').getByText(user, { exact: true }).click();
    await page.fill('#pinInput', { 'אורן': '515151', 'דנה': '626262' }[user] || '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    await page.click('.tab[data-view="continuation"]');
    await page.locator('#continuationList .continuation-row').first().waitFor();
    return page;
  }
  return { sb, captured, errors, login };
}

const rowOf = (page, name) => page.locator('#continuationList .continuation-row').filter({ hasText: name });

async function decideToOutpatient(page, name) {
  const row = rowOf(page, name);
  await row.locator('[data-cfield="meetingDate"]').fill('2026-11-02');
  await row.locator('[data-cfield="outcome"]').selectOption('to_outpatient');
  await row.locator('[data-caction="save"]').click();
  await page.waitForSelector('#continuationToOutpatientModal:not([hidden])');
  const response = page.waitForResponse((r) => r.url().endsWith('/api/continuation/to-outpatient') && r.request().method() === 'POST');
  await page.click('#continuationToOutpatientConfirm');
  return (await response).json();
}

test('browser: to_outpatient creates the lead SERVER-side from roster identity, links the row, and a replay links instead of duplicating', skipOpt, async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const page = await f.login('ורד');

  const first = await decideToOutpatient(page, 'מטופל המשך א');
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.lead.matched, false);
  const leads = f.sb.rows('Leads');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, 'מטופל המשך א');
  assert.equal(leads[0].phone, '0500000011');
  assert.equal(leads[0].dashboardPatientId, 'id-stay-1');
  assert.equal(leads[0].dashboardPersonId, 'id-root-1');
  assert.equal(leads[0].handoffSource, 'continuation');
  assert.equal(leads[0].assignedTo, 'ורד', 'owner = the signed-in user');
  assert.equal(leads[0].house_of_origin, 'raanana', 'asher -> raanana mapped server-side');
  const cont = f.sb.rows(f.sb.ctx.CONTINUATION_SHEET);
  assert.equal(cont.length, 1);
  assert.equal(cont[0].outcome, 'to_outpatient');
  assert.equal(cont[0].dashboardPatientId, 'id-stay-1');
  assert.equal(cont[0].outpatientId, leads[0].id);
  assert.equal(cont[0].outpatientEntity, 'lead');
  assert.equal(cont[0].key, 'מטופל המשך א|asher|2026-07-01');
  assert.match(cont[0].outcomeDate, /^\d{4}-\d{2}-\d{2}$/, 'server-stamped');
  // the browser never sent a saveAll / local lead for this flow
  assert.equal(f.captured.some((c) => c.payload.action === 'saveAll' || !c.payload.action), false);
  const create = f.captured.find((c) => c.payload.action === 'createContinuationLead');
  assert.ok(create);
  assert.equal(create.payload.user, 'ורד');

  // the לידים tab shows the new lead after the core reload
  await page.click('.tab[data-view="leads"]');
  await page.locator('#kanban .card').filter({ has: page.locator('.name', { hasText: 'מטופל המשך א' }) }).waitFor();

  // replay (e.g. the decision is re-saved): links the same lead, no second row
  await page.click('.tab[data-view="continuation"]');
  // decided rows live in the collapsed «הועברו ללידים» group — open it
  await page.locator('details.continuation-grp-to_outpatient > summary').click();
  await rowOf(page, 'מטופל המשך א').waitFor();
  const row = rowOf(page, 'מטופל המשך א');
  await row.locator('[data-cfield="outcome"]').selectOption('continuing');
  await row.locator('[data-caction="save"]').click();
  await page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST');
  const again = await decideToOutpatient(page, 'מטופל המשך א');
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.lead.matched, true);
  assert.equal(f.sb.rows('Leads').length, 1, 'no duplicate lead');
  assert.equal(f.sb.rows(f.sb.ctx.CONTINUATION_SHEET).length, 1, 'no duplicate continuation row');
  assert.deepEqual(f.errors, []);
});

test('browser: a roster row without a Dashboard id fails visibly — nothing is created, no PII fallback', skipOpt, async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const page = await f.login('ורד');
  const row = rowOf(page, 'מטופל ללא מזהה');
  await row.locator('[data-cfield="outcome"]').selectOption('to_outpatient');
  await row.locator('[data-caction="save"]').click();
  await page.waitForSelector('#continuationToOutpatientModal:not([hidden])');
  await page.click('#continuationToOutpatientConfirm');
  await page.locator('#toast', { hasText: 'חסר מזהה מטופל מהדשבורד' }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(f.sb.rows('Leads').length, 0);
  assert.equal(f.sb.rows(f.sb.ctx.CONTINUATION_SHEET).length, 0);
  assert.equal(f.captured.some((c) => c.payload.action === 'createContinuationLead' || c.payload.action === 'saveContinuation'), false);
  assert.deepEqual(f.errors, []);
});

test('browser: an ordinary continuation save carries the stable id and the server fills the PII; a PII collision refuses the lead', skipOpt, async (t) => {
  const f = await fixture(t, [{ id: 'L-old', name: 'מטופל המשך א', phone: '0500000011', stage: 'פרטים אישיים', house_of_origin: 'raanana', assignedTo: 'ורד', created: '2026-10-01' }]);
  if (!f) return;
  const page = await f.login('ורד');
  const row = rowOf(page, 'מטופל המשך א');
  await row.locator('[data-cfield="meetingDate"]').fill('2026-11-05');
  await row.locator('[data-cfield="outcome"]').selectOption('continuing');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST');
  await row.locator('[data-caction="save"]').click();
  assert.equal((await (await saved).json()).ok, true);
  const sent = f.captured.find((c) => c.payload.action === 'saveContinuation');
  assert.equal(sent.payload.dashboardPatientId, 'id-stay-1');
  assert.equal(sent.payload.name, 'מטופל המשך א');
  assert.equal(sent.payload.house, 'asher');
  assert.equal(Object.prototype.hasOwnProperty.call(sent.payload, 'phone'), false);
  const cont = f.sb.rows(f.sb.ctx.CONTINUATION_SHEET);
  assert.equal(cont[0].dashboardPersonId, 'id-root-1');
  assert.equal(cont[0].meetingDate, '2026-11-05');

  // an open lead with the same phone+name but no stable id -> fail closed, no lead, no outcome
  const dup = await decideToOutpatient(page, 'מטופל המשך א');
  assert.equal(dup.ok, false);
  assert.equal(dup.error, 'possible_duplicate');
  assert.equal(f.sb.rows('Leads').length, 1);
  assert.equal(f.sb.rows(f.sb.ctx.CONTINUATION_SHEET)[0].outcome, 'continuing', 'outcome unchanged');
  await page.locator('#toast', { hasText: 'לא נוצר ליד' }).waitFor();
  assert.deepEqual(f.errors, []);
});
