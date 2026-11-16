'use strict';
// One-time treatment for a LEAD + the four psychiatric services (CHANGELOG-one-time-psychiatric.md) — real browser
// (Chromium), server.js + Code.gs sandbox, 1280px and 360px:
// ורד opens «+ טיפול חד פעמי» on a LEAD card → the modal explains the conversion and lists the four psychiatric
// services with their own labels and source prices → a DOUBLE click converts the lead ONCE to a per-session patient
// (no package, no cycle, no payment row), saves ONE session and ONE charge → the patient card shows it, no debt chip.
// Also: nothing is written before «שמירה»; a refused booking after the conversion is retried without a second
// patient; an unusable phone / an existing patient stop before any write; דנה (operational) has no button.
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
const PSY = 'ד"ר מיכאל שפרינץ';
const LEAD = { id: 'fixture-ots-l1', name: 'פנייה לפסיכיאטר', phone: '0500000041', stage: 'פרטים אישיים', serviceType: '', location: 'רמות השבים', house_of_origin: '', assignedTo: 'ורד', created: '2026-11-01', updatedAt: '2026-11-10T07:00:00.000Z' };
const CLIENT = { id: 'fixture-ots-c9', name: 'מטופל קיים', phone: '0500000049', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-12-05', startDate: '2026-10-01', assignedTo: 'ורד', creditsOwed: 1, updatedAt: '2026-10-30T07:00:00.000Z' };

async function fixture(t, leads = [LEAD], clients = [CLIENT], opts = {}) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox(leads, clients);
  Object.assign(sb.props, { CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => post(Object.assign({ action }, body, { proxySecret: process.env.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  // legacyCatalog: the catalog was imported BEFORE the two new psychiatric rows existed (the live state on 2026-11-16)
  const later = opts.legacyCatalog ? sb.ctx.PACKAGE_CATALOG_SEED.splice(15) : [];
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);
  sb.ctx.PACKAGE_CATALOG_SEED.push(...later);
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [{ name: 'הילה תבור', flatRate: 300 }, { name: PSY, intakeRate: 900, followupRate: 600 }]);

  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
  const upstreamCalls = [];
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    let result;
    if (options.method === 'POST') { const b = JSON.parse(options.body); upstreamCalls.push(b.action); result = post(b); }
    else { upstreamCalls.push(url.searchParams.get('action')); result = JSON.parse(sb.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent()); }
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
  async function open(viewport, who = 'ורד', pin = '424242') {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport, timezoneId: 'UTC' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], consoleErrors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error' || /status of 401/.test(m.text())) return;
      const where = (m.location && m.location().url) || '';
      if (/\/api\/continuation-roster/.test(where)) return;
      consoleErrors.push(m.text() + ' @ ' + where);
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText(who, { exact: true }).click();
    await page.fill('#pinInput', pin);
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    consoleErrors.length = 0;
    return { context, page, errors, consoleErrors };
  }
  return { sb, open, upstreamCalls };
}

const todayUTC = () => new Date().toISOString().slice(0, 10);
async function openLeadModal(page, name = LEAD.name) {
  await page.click('.tab[data-view="leads"]');
  const card = page.locator('#app .card', { hasText: name }).first();
  await card.waitFor();
  await card.locator('.lead-ots-btn').click();
  await page.waitForSelector('#otsModal:not([hidden])');
  const form = page.locator('#otsForm');
  await form.locator('select[name="catalogKey"] option[value="psychiatric_followup"]').waitFor({ state: 'attached' });
  return form;
}
async function fill(form, key, time = '10:00') {
  await form.locator('select[name="catalogKey"]').selectOption(key);
  await form.locator('select[name="therapist"]').selectOption(PSY);
  await form.locator('input[name="date"]').fill(todayUTC());
  await form.locator('input[name="time"]').fill(time);
}

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('lead one-time ' + vp.name + ': four psychiatric services → double click converts ONCE to a per-session patient, one session, one charge', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height });
    const form = await openLeadModal(page);
    assert.equal(await page.locator('#otsTitle').textContent(), 'טיפול חד פעמי — ליד');
    assert.equal(await page.locator('#otsClientName').textContent(), LEAD.name);
    assert.equal(await page.locator('#otsLeadNote').isVisible(), true, 'the conversion is explained before saving');
    assert.match(await page.locator('#otsLeadNote').textContent(), /תשלום לפי טיפול/);
    assert.equal(await form.locator('select[name="location"]').inputValue(), 'רמות השבים', 'defaults to the lead location');
    // the four psychiatric services: each with its own label and the source price
    const opt = async (k) => (await form.locator('select[name="catalogKey"] option[value="' + k + '"]').textContent()).replace(/\s+/g, ' ');
    assert.match(await opt('psychiatric_consult'), /^ייעוץ פסיכיאטרי — .*900/);
    assert.match(await opt('psychiatric_followup'), /^מעקב פסיכיאטרי — .*1,?100/);
    assert.match(await opt('psychiatric_diagnosis'), /^אבחון פסיכיאטרי — .*2,?500/);
    assert.match(await opt('psychiatric_intake'), /^אינטייק פסיכיאטרי — .*2,?300/);
    assert.equal(await form.locator('input[name="amount"]').count(), 0, 'no amount field');
    // nothing is written by opening the modal
    assert.equal(f.sb.rows('Leads').length, 1); assert.equal(f.sb.rows('Clients').length, 1);
    await fill(form, 'psychiatric_followup');
    await page.locator('#otsSubmit').dblclick();
    await page.waitForSelector('#otsModal', { state: 'hidden' });
    // the lead became ONE per-session patient
    assert.equal(f.sb.rows('Leads').length, 0, 'the lead left the pipeline');
    const clients = f.sb.rows('Clients');
    assert.equal(clients.length, 2, 'double click → one new patient');
    const made = clients.find((c) => c.fromLead === LEAD.id);
    assert.ok(made, 'linked to its lead history');
    assert.equal(made.name, LEAD.name); assert.equal(made.phone, LEAD.phone);
    assert.equal(made.billingMode, 'per_session');
    assert.equal(made.location, 'רמות השבים');
    assert.equal(made.assignedTo, 'ורד');
    for (const k of ['nextBillingDate', 'paymentStatus', 'paymentDate', 'billingDay', 'serviceType']) assert.equal(made[k], '', k + ' stays blank');
    assert.equal(Number(made.pricePerSession), 0);
    // one session + one charge at the SOURCE price, the operation acknowledged, no payment row
    const sessions = f.sb.rows('OneTimeSessions');
    assert.equal(sessions.length, 1, 'double click → one session');
    assert.equal(sessions[0].clientId, made.id);
    assert.equal(sessions[0].catalogKey, 'psychiatric_followup');
    assert.equal(sessions[0].clinicalTreatmentType, 'מעקב פסיכיאטרי');
    assert.equal(Number(sessions[0].priceAgorot), 110000);
    const charges = f.sb.rows('ClientCharges');
    assert.equal(charges.length, 1, 'one charge');
    assert.equal(charges[0].id, sessions[0].chargeId); assert.equal(charges[0].clientId, made.id);
    assert.equal(String(charges[0].amount), '1100'); assert.equal(charges[0].billingType, 'one_time');
    const ops = f.sb.rows('FinancialOps');
    assert.equal(ops.length, 1); assert.equal(ops[0].state, 'acknowledged');
    assert.equal(f.sb.rows('Payments').length, 0, 'unpaid unless ticked — and no package payment was invented');
    assert.equal(f.upstreamCalls.filter((a) => a === 'createOneTimeSession').length >= 1, true);
    // the existing patient was not changed by the conversion
    const other = clients.find((c) => c.id === CLIENT.id);
    assert.equal(other.nextBillingDate, '2026-12-05'); assert.equal(Number(other.creditsOwed), 1);
    // the patient card shows the session under its OWN label; a per-session patient carries no renewal / debt row
    await page.click('.tab[data-view="clients"]');
    const card = page.locator('.client-card', { hasText: LEAD.name }).first();
    await card.waitFor();
    const row = card.locator('.ots-row').first();
    await row.waitFor();
    assert.match(await row.textContent(), /מעקב פסיכיאטרי/);
    assert.match(await row.textContent(), /מתוכנן/);
    assert.match(await row.textContent(), /לא שולם/);
    assert.match(await card.textContent(), /משלם\/ת לפי טיפול/, 'the per-session money panel');
    assert.equal(/באיחור|חוב פתוח/.test(await card.textContent()), false, 'not shown as owing');
    // the lead is gone from the leads view
    await page.click('.tab[data-view="leads"]');
    assert.equal(await page.locator('#app .lead-ots-btn').count(), 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, 'no horizontal scroll (' + overflow + 'px)');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}

test('lead one-time: closing the modal writes nothing; a refused booking after the conversion is retried without a second patient', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, errors } = await f.open({ width: 1280, height: 900 });
  let form = await openLeadModal(page);
  await fill(form, 'psychiatric_consult');
  await page.locator('#otsForm [data-close]').click();
  await page.waitForSelector('#otsModal', { state: 'hidden' });
  assert.equal(f.sb.rows('Leads').length, 1, 'cancel keeps the lead');
  assert.equal(f.sb.rows('Clients').length, 1);
  assert.equal((f.sb.rows('OneTimeSessions') || []).length, 0);
  // the psychiatrist is busy in the therapists diary → the session is refused AFTER the lead was saved as a patient
  f.sb.busy.occupied = true;
  form = await openLeadModal(page);
  await fill(form, 'psychiatric_consult');
  await page.locator('#otsSubmit').click();
  await page.locator('#otsMsg', { hasText: 'הליד עבר למטופלים' }).waitFor();
  const msg = await page.locator('#otsMsg').textContent();
  assert.match(msg, /הטיפול עדיין לא נקבע/); assert.match(msg, /בחרו מועד אחר/);
  assert.equal(await page.locator('#otsModal').isVisible(), true, 'the form stays as typed');
  assert.equal(await page.locator('#otsLeadNote').isVisible(), false, 'no longer a lead booking');
  assert.equal(f.sb.rows('Leads').length, 0);
  assert.equal(f.sb.rows('Clients').length, 2);
  assert.equal((f.sb.rows('OneTimeSessions') || []).length, 0, 'nothing scheduled, nothing charged');
  assert.equal((f.sb.rows('ClientCharges') || []).length, 0);
  // the slot frees up → the SAME form is saved again: still one patient, now one session
  f.sb.busy.occupied = false;
  await page.locator('#otsSubmit').click();
  await page.waitForSelector('#otsModal', { state: 'hidden' });
  assert.equal(f.sb.rows('Clients').length, 2, 'the retry did not convert twice');
  assert.equal(f.sb.rows('OneTimeSessions').length, 1);
  assert.equal(Number(f.sb.rows('OneTimeSessions')[0].priceAgorot), 90000);
  assert.equal(f.sb.rows('ClientCharges').length, 1);
  assert.deepEqual(errors, []);
});

test('lead one-time: a lead without a usable phone, or whose phone already belongs to a patient, stops before any write', skipOpt, async (t) => {
  const noPhone = { ...LEAD, id: 'fixture-ots-l2', name: 'ליד בלי טלפון', phone: '' };
  const dup = { ...LEAD, id: 'fixture-ots-l3', name: 'ליד כפול', phone: CLIENT.phone };
  const f = await fixture(t, [noPhone, dup]); if (!f) return;
  const { page, errors } = await f.open({ width: 1280, height: 900 });
  for (const [lead, re] of [[noPhone, /אין טלפון תקין/], [dup, /כבר קיים\/ת: «מטופל קיים»/]]) {
    const form = await openLeadModal(page, lead.name);
    await fill(form, 'psychiatric_intake');
    await page.locator('#otsSubmit').click();
    await page.locator('#otsMsg', { hasText: re }).waitFor();
    assert.equal(await page.locator('#otsLeadNote').isVisible(), true, 'still a lead booking');
    await page.locator('#otsForm [data-close]').click();
    await page.waitForSelector('#otsModal', { state: 'hidden' });
  }
  assert.equal(f.sb.rows('Leads').length, 2, 'both leads are untouched');
  assert.equal(f.sb.rows('Clients').length, 1);
  assert.equal((f.sb.rows('OneTimeSessions') || []).length, 0);
  assert.equal(f.upstreamCalls.includes('createOneTimeSession'), false, 'the source was never asked to book');
  assert.equal(f.upstreamCalls.includes('saveAll'), false, 'and nothing was saved');
  assert.deepEqual(errors, []);
});

test('lead one-time: דנה (operational) has no «+ טיפול חד פעמי» on a lead', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, errors } = await f.open({ width: 1280, height: 900 }, 'דנה', '626262');
  await page.click('.tab[data-view="leads"]');
  await page.locator('#app .card', { hasText: LEAD.name }).first().waitFor();
  assert.equal(await page.locator('#app .lead-ots-btn').count(), 0);
  assert.deepEqual(errors, []);
});

test('catalog imported before 2026-11-16: «הוספת השירותים החדשים לקטלוג» adds the two psychiatric rows once; the one-time modal then offers all four', skipOpt, async (t) => {
  const f = await fixture(t, [LEAD], [CLIENT], { legacyCatalog: true }); if (!f) return;
  assert.equal(f.sb.rows('PackageCatalog').length, 15);
  const { page, errors, consoleErrors } = await f.open({ width: 1280, height: 900 });
  // before: the modal offers what the catalog has — the two PDF psychiatric services only
  await page.click('.tab[data-view="clients"]');
  const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
  await card.locator('.cc-ots-btn').click();
  await page.waitForSelector('#otsModal:not([hidden])');
  const select = page.locator('#otsForm select[name="catalogKey"]');
  await select.locator('option[value="psychiatric_consult"]').waitFor({ state: 'attached' });
  assert.equal(await select.locator('option[value="psychiatric_followup"]').count(), 0);
  assert.equal(await select.locator('option[value="psychiatric_intake"]').count(), 0);
  await page.locator('#otsForm [data-close]').click();
  // ורד adds the new services from «תמחור חבילות» → קטלוג
  await page.click('.tab[data-view="packages"]');
  await page.waitForSelector('.pkg-admin');
  await page.locator('.pkg-admin button', { hasText: /^קטלוג$/ }).click();
  const add = page.locator('[data-pkg-add-missing]');
  await add.waitFor();
  assert.match(await page.locator('.pkg-missing').textContent(), /יש 2 שירותים חדשים/);
  const before = f.sb.rows('PackageCatalog');
  await add.dblclick();
  await page.locator('.pkg-card', { hasText: 'פסיכיאטריה — אינטייק' }).waitFor();
  await page.locator('.pkg-card', { hasText: 'פסיכיאטריה — מעקב' }).waitFor();
  assert.equal(await page.locator('[data-pkg-add-missing]').count(), 0, 'nothing left to add');
  const after = f.sb.rows('PackageCatalog');
  assert.equal(after.length, 17, 'double click → two rows, not four');
  assert.deepEqual(after.slice(0, 15), before, 'existing rows untouched');
  assert.deepEqual(after.slice(15).map((r) => [r.key, Number(r.pricePerSessionAgorot) || Number(r.priceTotalAgorot)]), [['psychiatric_followup', 110000], ['psychiatric_intake', 230000]]);
  assert.match(await page.locator('.pkg-card', { hasText: 'פסיכיאטריה — מעקב' }).textContent(), /1,100/);
  assert.match(await page.locator('.pkg-card', { hasText: 'פסיכיאטריה — אינטייק' }).textContent(), /2,300/);
  // after: the one-time modal offers all four
  await page.click('.tab[data-view="clients"]');
  await page.locator('.client-card', { hasText: CLIENT.name }).first().locator('.cc-ots-btn').click();
  await page.waitForSelector('#otsModal:not([hidden])');
  for (const k of ['psychiatric_consult', 'psychiatric_followup', 'psychiatric_diagnosis', 'psychiatric_intake']) await select.locator('option[value="' + k + '"]').waitFor({ state: 'attached' });
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
});
