'use strict';

// Real browser + public UI + server.js (signed sessions/proxy/cache) + Code.gs.
// Only Google runtime services are replaced with dummy, in-memory Sheets.
// No production URL, credential, data or external browser request is used.
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
const A = { id: 'fixture-a', name: 'פניית בדיקה א', phone: '0500000001', stage: 'פרטים אישיים', serviceType: 'פרטני', location: 'רעננה הפרדס', house_of_origin: 'raanana', assignedTo: 'ורד', created: '2026-10-01' };
const B = { ...A, id: 'fixture-b', name: 'פניית בדיקה ב', phone: '0500000002' };
const card = (page, name) => page.locator('#kanban .card').filter({ has: page.locator('.name', { hasText: name }) });

async function fixture(t, initial) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox(initial);
  const captured = [], errors = [];
  const oldFetch = global.fetch;
  const keys = ['APP_PIN', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.APP_PIN = '424242';
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
      result = sb.post(payload);
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
    // Wait for initial session discovery before interacting with login. A click
    // during boot can otherwise precede the app's event-handler registration.
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pinScreen:not([hidden])');
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.locator('#userButtons .user-btn').getByText(user, { exact: true }).click();
    await page.waitForSelector('#app:not([hidden])');
    await page.click('.tab[data-view="leads"]');
    await card(page, A.name).waitFor();
    return page;
  }
  return { sb, captured, errors, login };
}

async function submit(page, selector, action = 'saveAll') {
  const response = page.waitForResponse((r) => {
    if (!r.url().endsWith('/api/sheets') || r.request().method() !== 'POST') return false;
    return (r.request().postDataJSON().action || 'saveAll') === action;
  });
  await page.click(selector);
  const data = await (await response).json();
  assert.equal(data.ok, true, JSON.stringify(data));
  return data;
}

async function addLead(page) {
  await page.click('#addLeadBtn');
  await page.fill('#leadForm [name="name"]', B.name);
  await page.fill('#leadForm [name="phone"]', B.phone);
  await page.locator('#leadForm [data-group="serviceType"] input[type="checkbox"]').first().check();
  await page.selectOption('#leadForm [name="location"]', B.location);
  await page.selectOption('#leadForm [name="house_of_origin"]', B.house_of_origin);
  await page.fill('#leadForm [name="created"]', B.created);
  await page.selectOption('#leadForm [name="assignedTo"]', 'יעל');
  await submit(page, '#leadFormSubmit');
  await card(page, B.name).waitFor();
}

async function editLead(page, name) {
  await card(page, name).getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.fill('#leadForm [name="note"]', 'הערת בדיקה מעותק ישן');
  return submit(page, '#leadFormSubmit');
}

test('browser: another user adds a lead, an older tab edits, both remain and the tab refreshes', skipOpt, async (t) => {
  const fx = await fixture(t, [A]); if (!fx) return;
  const first = await fx.login('ורד');
  const second = await fx.login('יעל');
  await addLead(second);
  const added = fx.sb.rows('Leads').find((l) => l.name === B.name);
  const result = await editLead(first, A.name);
  assert.equal(result.preservedLeads, 1);
  assert.equal(result.staleSave, true);
  const save = fx.captured.filter((c) => c.payload.action === 'saveAll').at(-1);
  assert.equal(save.payload.leads.some((l) => l.id === added.id), false, 'the browser really sent an old snapshot');
  assert.equal(save.payload.user, 'ורד', 'real proxy forwards signed session identity');
  assert.deepEqual(fx.sb.rows('Leads').find((l) => l.id === added.id), added);
  await card(first, B.name).waitFor();
  assert.equal(await first.locator('#kanban .card').count(), 2);
  assert.deepEqual(fx.errors, []);
});

test('browser: a removed lead stays absent when another user saves an old snapshot', skipOpt, async (t) => {
  const fx = await fixture(t, [A, B]); if (!fx) return;
  const first = await fx.login('ורד');
  const second = await fx.login('יעל');
  await card(second, A.name).getByRole('button', { name: 'הסר', exact: true }).click();
  await submit(second, '#removeLeadForm button[type="submit"]', 'removeLead');
  await card(second, A.name).waitFor({ state: 'detached' });
  const result = await editLead(first, B.name);
  assert.equal(result.staleSave, true);
  assert.deepEqual(fx.sb.rows('Leads').map((l) => l.id), [B.id]);
  assert.equal(fx.sb.rows('לידים שהוסרו').length, 1);
  await card(first, A.name).waitFor({ state: 'detached' });
  assert.equal(await first.locator('#kanban .card').count(), 1);
  assert.deepEqual(fx.errors, []);
});

test('browser: conversion preserves an unseen lead and an old tab cannot resurrect the converted one', skipOpt, async (t) => {
  const fx = await fixture(t, [{ ...A, stage: 'תוכנית טיפול' }]); if (!fx) return;
  const first = await fx.login('ורד');
  const second = await fx.login('יעל');
  await addLead(second);
  await card(first, A.name).getByRole('button', { name: '← הפוך למטופל פעיל', exact: true }).click();
  await first.locator('#activateForm [data-host="activateSessions"] input[type="number"]').first().fill('1');
  await first.fill('#activateForm [name="pricePerSession"]', '1200');
  await first.fill('#activateForm [name="startDate"]', '2026-10-09');
  await first.selectOption('#activateForm [name="paymentStatus"]', 'unpaid');
  const converted = await submit(first, '#activateSubmit');
  assert.equal(converted.preservedLeads, 1);
  const client = fx.sb.rows('Clients')[0];
  assert.equal(client.fromLead, A.id);
  assert.equal(Number(client.pricePerSession), 1200);
  assert.equal(client.nextBillingDate, '2026-11-09');
  await first.locator('#clientsList .client-card').filter({ hasText: A.name }).waitFor();
  await first.click('.tab[data-view="leads"]');
  await card(first, B.name).waitFor();
  assert.equal(await card(first, A.name).count(), 0);
  const stale = await editLead(second, B.name);
  assert.equal(stale.staleSave, true);
  assert.equal(fx.sb.rows('Leads').length, 1);
  assert.equal(fx.sb.rows('Leads')[0].name, B.name);
  assert.equal(fx.sb.rows('Clients').length, 1);
  await card(second, A.name).waitFor({ state: 'detached' });
  assert.deepEqual(fx.errors, []);
});
