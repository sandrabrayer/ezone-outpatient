'use strict';

// Opt-in acceptance of OUR local app against the approved synthetic Google
// endpoint. Never operates the user's browser or a production application.
// Run explicitly; this file is outside test/ and is not an automatic CI test.
// The recorded endpoint was ARCHIVED after the 2026-10-09 acceptance run.
// Re-running requires a newly authorized endpoint and prepared dummy baseline;
// never relax the endpoint/fixture guards or repoint this runner at production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzjnrVJiZKIWbtt7kDIzz99qYZzs07ShRASyJLi_EMHysNl_tpo-0Yh0WQNJr5bUt2gTw/exec';
const STAGING_ID = '1MdBzX6eDJIi9m7JXNuz-Z5OUh8e1dS6FjTGiw71D6n0';
const A = { id: 'fixture-a', name: 'פניית בדיקה א', phone: '0500000001' };
const B = { name: 'פניית בדיקה ב HTTP', phone: '0500000002' };
const rawFetch = global.fetch;
const captured = [];
const pageErrors = [];
const results = [];
const reportPath = process.env.EZONE_STAGING_REPORT_PATH;

function checkpoint() {
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({
    runId, endpoint: ENDPOINT, stagingSpreadsheetId: STAGING_ID,
    sourceCodeSHA256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'))).digest('hex'),
    executionMode: 'Real local public UI, server.js signed sessions/proxy/cache, deployed Google HTTP and native Sheets. Two independent browser contexts. Sequential stale snapshots, not a load test.',
    results, pageErrors,
    writes: captured.map(c => ({ action: c.payload.action, user: c.payload.user,
      leadIds: (c.payload.leads || []).map(l => l.id), ok: c.result.ok,
      preservedLeads: c.result.preservedLeads, staleSave: c.result.staleSave,
      durationMs: c.durationMs })),
    ...runtime
  }, null, 2) + '\n');
}
const runId = new Date().toISOString();
const runtime = { node: process.version, playwright: require('playwright/package.json').version };

async function google(payload) {
  const response = await rawFetch(ENDPOINT + (payload ? '' : '?action=getData'), payload ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000)
  } : { signal: AbortSignal.timeout(90000) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true, JSON.stringify(data));
  return data;
}

const card = (page, name) => page.locator('#kanban .card').filter({ has: page.locator('.name', { hasText: name }) });
async function submit(page, target, action = 'saveAll') {
  const pending = page.waitForResponse(r => r.url().endsWith('/api/sheets') &&
    r.request().method() === 'POST' && (r.request().postDataJSON().action || 'saveAll') === action, { timeout: 90000 });
  await (typeof target === 'string' ? page.locator(target) : target).click();
  const response = await pending;
  const data = await response.json();
  assert.equal(data.ok, true, JSON.stringify(data));
  return data;
}
async function editLead(page, name, note) {
  await card(page, name).getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.fill('#leadForm [name="note"]', note);
  return submit(page, '#leadFormSubmit');
}
async function addLead(page) {
  await page.click('#addLeadBtn');
  await page.fill('#leadForm [name="name"]', B.name);
  await page.fill('#leadForm [name="phone"]', B.phone);
  await page.locator('#leadForm [data-group="serviceType"] input[type="checkbox"]').first().check();
  await page.selectOption('#leadForm [name="location"]', 'רעננה הפרדס');
  await page.selectOption('#leadForm [name="house_of_origin"]', 'raanana');
  await page.fill('#leadForm [name="created"]', '2026-10-01');
  await page.selectOption('#leadForm [name="assignedTo"]', 'יעל');
  await submit(page, '#leadFormSubmit');
  await card(page, B.name).waitFor();
}
async function scenario(name, fn) {
  console.log('START ' + name);
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ scenario: name, status: 'PASS', durationMs: Date.now() - start, ...details });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ scenario: name, status: 'FAIL', durationMs: Date.now() - start, detail: String(error) });
    throw error;
  } finally { checkpoint(); }
}

async function main() {
  assert.equal(process.argv[2], '--run-approved-staging', 'Explicit opt-in required');
  assert.equal(process.env.EZONE_APPROVED_STAGING_URL, ENDPOINT, 'Only the individually approved staging deployment is allowed');
  assert.ok(reportPath, 'Evidence output path required');
  assert.ok(!process.env.DASHBOARD_SHEETS_URL && !process.env.OCCUPANCY_SECRET, 'Cross-app integration must be disabled');
  const initial = await google();
  assert.equal(initial.leads.length, 1, 'Refuse mutation unless fixture baseline is exact');
  assert.equal(initial.clients.length, 0);
  assert.equal(initial.leads[0].id, A.id);
  assert.equal(initial.leads[0].name, A.name);
  assert.equal(initial.leads[0].phone, A.phone);
  // Setup only: put this verified synthetic lead in the conversion-capable
  // stage through the real handler. All subsequent business actions use UI.
  initial.leads[0].stage = 'תוכנית טיפול';
  await google({ action: 'saveAll', leads: initial.leads, clients: [], dataVersion: initial.dataVersion, user: 'fixture-http-setup' });
  console.log('Verified staging fixture; production configuration not loaded');

  process.env.APP_PIN = '424242';
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.SHEETS_URL = ENDPOINT;
  delete process.env.DASHBOARD_SHEETS_URL;
  delete process.env.OCCUPANCY_SECRET;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, ENDPOINT, 'Unexpected upstream refused');
    const started = Date.now();
    const response = await rawFetch(input, { ...options, signal: AbortSignal.timeout(90000) });
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body);
      captured.push({ payload, result: await response.clone().json(), durationMs: Date.now() - started });
    }
    return response;
  };
  const app = require('../server');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    runtime.chromium = browser.version();
    async function login(user) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(90000);
      page.on('pageerror', error => pageErrors.push(error.message));
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
    const first = await login('ורד');
    const second = await login('יעל');
    let removedId;
    await scenario('http_stale_create_edit', async () => {
      await addLead(second);
      const added = (await google()).leads.find(l => l.name === B.name);
      assert.ok(added && added.id);
      removedId = added.id;
      const result = await editLead(first, A.name, 'בדיקת HTTP — שמירה מעותק ישן');
      assert.equal(result.preservedLeads, 1);
      assert.equal(result.staleSave, true);
      const capturedSave = captured.filter(c => c.payload.action === 'saveAll').at(-1);
      assert.ok(!capturedSave.payload.leads.some(l => l.id === added.id), 'Browser must really submit stale data');
      assert.equal(capturedSave.payload.user, 'ורד');
      const data = await google();
      assert.deepEqual(data.leads.find(l => l.id === added.id), added);
      assert.equal(data.leads.length, 2);
      await card(first, B.name).waitFor();
      assert.equal(await first.locator('#kanban .card').count(), 2);
      return { preservedLeadId: added.id, freshLeadUnchanged: true, sessionIdentityVerified: true };
    });
    await scenario('http_removal_stale_save', async () => {
      await card(second, B.name).getByRole('button', { name: 'הסר', exact: true }).click();
      await submit(second, '#removeLeadForm button[type="submit"]', 'removeLead');
      await card(second, B.name).waitFor({ state: 'detached' });
      const result = await editLead(first, A.name, 'בדיקת HTTP — שמירה לאחר הסרה');
      assert.equal(result.staleSave, true);
      const data = await google();
      assert.deepEqual(data.leads.map(l => l.id), [A.id]);
      const capturedSave = captured.filter(c => c.payload.action === 'saveAll').at(-1);
      assert.ok(capturedSave.payload.leads.some(l => l.id === removedId), 'Stale browser still included removed row');
      await card(first, B.name).waitFor({ state: 'detached' });
      return { removedLeadId: removedId, staleResurrectionBlocked: true };
    });
    await scenario('http_conversion_and_stale_resurrection', async () => {
      await addLead(second);
      await card(first, A.name).getByRole('button', { name: '← הפוך למטופל פעיל', exact: true }).click();
      await first.locator('#activateForm [data-host="activateSessions"] input[type="number"]').first().fill('1');
      await first.fill('#activateForm [name="pricePerSession"]', '1200');
      await first.fill('#activateForm [name="startDate"]', '2026-10-09');
      await first.selectOption('#activateForm [name="paymentStatus"]', 'unpaid');
      const converted = await submit(first, '#activateSubmit');
      assert.equal(converted.preservedLeads, 1);
      const before = await google();
      assert.equal(before.clients.length, 1);
      const client = before.clients[0];
      assert.equal(client.fromLead, A.id);
      assert.equal(Number(client.pricePerSession), 1200);
      assert.equal(client.nextBillingDate, '2026-11-09');
      await first.locator('#clientsList .client-card').filter({ hasText: A.name }).waitFor();
      await first.click('.tab[data-view="leads"]');
      await card(first, B.name).waitFor();
      assert.equal(await card(first, A.name).count(), 0);
      const stale = await editLead(second, B.name, 'בדיקת HTTP — שמירה לאחר המרה');
      assert.equal(stale.staleSave, true);
      const data = await google();
      assert.equal(data.leads.length, 1);
      assert.equal(data.leads[0].name, B.name);
      assert.notEqual(data.leads[0].id, removedId);
      assert.equal(data.clients.length, 1);
      assert.deepEqual(data.clients[0], client);
      await card(second, A.name).waitFor({ state: 'detached' });
      assert.deepEqual(pageErrors, []);
      return { convertedClientId: client.id, remainingLeadId: data.leads[0].id, clientAndBillingFieldsUnchanged: true };
    });
    console.log('SUMMARY ' + JSON.stringify({ passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, pageErrors }));
  } finally {
    checkpoint();
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    global.fetch = rawFetch;
  }
}

if (require.main === module) main().catch(error => {
  runtime.fatalError = String(error);
  checkpoint();
  console.error(error);
  process.exitCode = 1;
});
