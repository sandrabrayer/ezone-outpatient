'use strict';

// OP-CRM-3B — real browser + public UI + server.js + Code.gs (dummy in-memory
// Sheets). ורד logs a contact on a lead through the card's «יצרתי קשר» form with
// a follow-up in 2 days: one Activity event, one follow-up task, the card shows
// last contact + next action; completing the task through ✓ closes it; a double
// submit of the same form creates nothing twice; דנה sees the block but no
// collection task kind. No production URL/credential/data.
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

const LEAD = { id: 'fixture-l1', name: 'פניית CRM', phone: '0500000031', stage: 'פרטים אישיים', serviceType: 'פרטני', location: 'רעננה הפרדס', house_of_origin: 'raanana', assignedTo: 'ורד', created: '2026-10-01', updatedAt: '2026-10-30T07:00:00.000Z' };
const card = (page, name) => page.locator('#kanban .card').filter({ has: page.locator('.name', { hasText: name }) });

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([LEAD], []);
  const captured = [], errors = [];
  const oldFetch = global.fetch;
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.APP_PIN = '424242'; process.env.USER_PIN_OREN = '515151'; process.env.USER_PIN_DANA = '626262';
  process.env.SESSION_SECRET = 'fixture-session-secret-not-a-real-credential';
  process.env.SHEETS_URL = 'https://sheets.invalid/fixture';
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
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
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'דיברנו' : undefined));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pinScreen:not([hidden])');
    await page.locator('#pinNames .user-btn').getByText(user, { exact: true }).click();
    await page.fill('#pinInput', { 'אורן': '515151', 'דנה': '626262' }[user] || '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    await page.click('.tab[data-view="leads"]');
    await card(page, LEAD.name).waitFor();
    return page;
  }
  return { sb, captured, errors, login };
}

test('browser: contact log → event + follow-up task on the card; ✓ completes it; a double submit creates nothing twice', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('ורד');
  const c = card(page, LEAD.name);
  await c.locator('.crm-block').waitFor();
  assert.match(await c.locator('.crm-block').innerText(), /לא תועד קשר/);
  await c.locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  await page.selectOption('#contactChannel', 'whatsapp');
  await page.selectOption('#contactOutcome', 'call_back_later');
  await page.fill('#contactForm [name="withWhom"]', 'האמא');
  await page.fill('#contactForm [name="summary"]', 'ביקשה שנחזור אחרי החג');
  await page.check('#contactForm [name="nextMode"][value="days"]');
  await page.fill('#contactForm [name="nextDays"]', '2');
  const resp = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST' && r.request().postDataJSON().action === 'logContact');
  await page.click('#contactSubmit');
  const data = await (await resp).json();
  assert.equal(data.ok, true, JSON.stringify(data));
  assert.equal(data.created.source, 'contact');
  await page.waitForSelector('#contactModal[hidden]', { state: 'attached' });
  // sheet state
  assert.equal(f.sb.rows('Activity').filter((e) => e.kind === 'contact_logged').length, 1);
  const tasks = f.sb.rows('Tasks');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].status, 'open'); assert.equal(tasks[0].assignee, 'ורד'); assert.equal(tasks[0].createdBy, 'ורד');
  assert.equal(tasks[0].title, 'שיחה חוזרת עם האמא');
  const sent = f.captured.find((x) => x.payload.action === 'logContact').payload;
  assert.equal(sent.user, 'ורד', 'actor comes from the proxy');
  assert.match(sent.submissionId, /^contact-/);
  // card now shows last contact + next action
  await card(page, LEAD.name).locator('.crm-task').waitFor();
  const block = await card(page, LEAD.name).locator('.crm-block').innerText();
  assert.match(block, /קשר אחרון/); assert.match(block, /ורד/); assert.match(block, /וואטסאפ/); assert.match(block, /ביקשה שנחזור/);
  assert.match(block, /שיחה חוזרת עם האמא/);
  // complete through ✓ (prompt answered 'דיברנו')
  const done = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST' && r.request().postDataJSON().action === 'completeTask');
  await card(page, LEAD.name).locator('[data-crm="complete"]').click();
  assert.equal((await (await done).json()).ok, true);
  await page.waitForFunction(() => !document.querySelector('#kanban .crm-task'));
  const row = f.sb.rows('Tasks')[0];
  assert.equal(row.status, 'done'); assert.equal(row.outcome, 'דיברנו'); assert.equal(row.doneBy, 'ורד');
  // double submit: same form, same key -> replayed, nothing new
  await card(page, LEAD.name).locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  await page.selectOption('#contactOutcome', 'no_answer');
  await page.check('#contactForm [name="nextMode"][value="none"]');
  await page.fill('#contactForm [name="nextExplanation"]', 'ביקש שלא נחזור');
  const sid = await page.evaluate(() => { const f = document.getElementById('contactForm'); f.dataset.sid = 'contact-fixed-key'; return f.dataset.sid; });
  const r1 = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST' && r.request().postDataJSON().action === 'logContact');
  await page.click('#contactSubmit');
  await r1;
  await page.waitForSelector('#contactModal[hidden]', { state: 'attached' });
  // simulate the lost-response retry: post the identical payload again through the same proxy
  const again = f.captured.filter((x) => x.payload.action === 'logContact' && x.payload.submissionId === sid);
  assert.equal(again.length, 1);
  const replay = JSON.parse(f.sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(again[0].payload) } }).getContent());
  assert.equal(replay.replayed, true);
  assert.equal(f.sb.rows('Activity').filter((e) => e.eventId === 'contact:' + sid).length, 1);
  assert.deepEqual(f.errors, []);
});

test('browser: דנה sees the activity block and can log a contact; the task form offers no collection kind', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('דנה');
  const c = card(page, LEAD.name);
  await c.locator('.crm-block').waitFor();
  await c.locator('[data-crm="task"]').click();
  await page.waitForSelector('#taskModal:not([hidden])');
  const kinds = await page.$$eval('#taskKind option', (os) => os.map((o) => o.value));
  assert.equal(kinds.includes('collection'), false);
  assert.ok(kinds.includes('call'));
  await page.fill('#taskForm [name="title"]', 'לתאם היכרות');
  await page.fill('#taskForm [name="dueDate"]', '2026-11-20');
  const resp = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST' && r.request().postDataJSON().action === 'createTask');
  await page.click('#taskSubmit');
  const data = await (await resp).json();
  assert.equal(data.ok, true, JSON.stringify(data));
  assert.equal(f.sb.rows('Tasks')[0].createdBy, 'דנה');
  assert.equal(f.sb.rows('Tasks')[0].assignee, 'דנה');
  const sent = f.captured.find((x) => x.payload.action === 'createTask').payload;
  assert.equal(sent.moneyScope, 'ops');
  await card(page, LEAD.name).locator('.crm-task').waitFor();
  assert.deepEqual(f.errors, []);
});
