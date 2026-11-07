'use strict';
// «מסלול המשך» as a CRM flow (2026-11-03) in a real browser: server.js + Code.gs sandbox + a fake Dashboard
// roster. Signed in as ורד at 1280px and 360px:
//   - opening the tab writes nothing; «עדכון משימות המשך» triggers ONE server-side milestone sync; the tab shows month 1/2/3 from the ENTRY date
//     with their contact dates, «חסר תאריך כניסה» for a patient without one, the link chip by phone only;
//   - status / owner save → reload → read back; «📞 פנייה» on the month-1 task files the contact under the
//     stable subject and closes that task only; a terminal status closes the open tasks;
//   - the milestone task appears in «היום שלי» with its last contact; no horizontal scroll.
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

function iso(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d); }

const CLIENT = { id: 'fixture-c1', name: 'מטופל קיים', phone: '0509999999', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-11-05', startDate: '2026-10-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
// entry 20 days ago → month 1 in 10 days → contact date 4 days AGO (late); month 2 / 3 wait
const ROSTER = { ok: true, patients: [
  { sourceApp: 'dashboard', name: 'נועה לוי', phone: '050-123-4567', house: 'ramot', entryDate: daysAgo(20) },
  { sourceApp: 'dashboard', name: 'בלי תאריך', phone: '0502222222', house: 'ramot', entryDate: '' },
  { sourceApp: 'dashboard', name: 'מטופל קיים', phone: '0509999999', house: 'asher', entryDate: daysAgo(5) }
] };

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([], [CLIENT]);
  const calls = { roster: 0, sync: 0 };
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', DASHBOARD_SHEETS_URL: 'https://dashboard.invalid/exec', OCCUPANCY_SECRET: 'occupancy-fixture-secret' });
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.host === 'dashboard.invalid') {
      calls.roster++;
      assert.equal(url.searchParams.get('action'), 'getAdmittedRoster');
      return { status: 200, text: async () => JSON.stringify(ROSTER) };
    }
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    let result;
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body);
      if (payload.action === 'syncContinuationMilestones') { calls.sync++; assert.equal(payload.patients.length, 3); assert.equal(payload.rosterComplete, true); }
      result = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: options.body } }).getContent());
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
  async function open(viewport) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    return { page, errors, context };
  }
  return { sb, calls, open };
}

test('מסלול המשך CRM: one server sync, milestones from the entry date, status round trip, contact closes month 1 only, My Day row', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, errors } = await f.open({ width: 1280, height: 900 });
  await page.click('.tab[data-view="continuation"]');
  await page.locator('.cont-card').first().waitFor();
  // R6 (2026-11-07): opening the tab writes nothing; the person presses «עדכון משימות המשך»
  assert.equal(f.calls.sync, 0, 'opening the tab did not sync');
  assert.equal(f.sb.rows('Tasks').length, 0, 'opening the tab created no task');
  await page.waitForFunction(() => /6 שינויים ממתינים/.test(document.querySelector('#continuationSyncStatus').textContent));
  const syncedNow = page.waitForResponse((r) => r.url().endsWith('/api/continuation-sync') && r.request().method() === 'POST');
  await page.click('#continuationSyncBtn');
  assert.equal((await (await syncedNow).json()).created, 6);
  await page.waitForSelector('.cont-ms-item');
  assert.equal(f.calls.sync, 1, 'the explicit action synced once');
  const ids = f.sb.rows('Tasks').map((x) => x.id).sort();
  assert.deepEqual(ids, ['m1', 'm2', 'm3'].map((m) => 'cont::phone:0501234567::' + ROSTER.patients[0].entryDate + '::' + m).concat(['m1', 'm2', 'm3'].map((m) => 'cont::phone:0509999999::' + ROSTER.patients[2].entryDate + '::' + m)).sort(), 'three milestone tasks per dated patient, none for the undated one');

  const noa = page.locator('.cont-card', { hasText: 'נועה לוי' });
  assert.equal(await noa.locator('.cont-ms-item').count(), 3);
  assert.match(await noa.locator('.cont-ms-item').first().textContent(), /חודש 1/);
  assert.match(await noa.locator('.cont-ms-item').first().textContent(), /באיחור/, 'month-1 contact date passed → late');
  assert.match(await noa.locator('.cont-ms-item').nth(1).textContent(), /ממתין/);
  assert.match(await noa.textContent(), /טרם נוצר קשר/);
  // no entry date → explicit notice, no milestones, no task
  const undated = page.locator('.cont-card', { hasText: 'בלי תאריך' });
  assert.match(await undated.textContent(), /חסר תאריך כניסה/);
  assert.equal(await undated.locator('.cont-ms-item').count(), 0);
  // phone-linked to an existing client (never by name)
  assert.equal(await page.locator('.cont-card', { hasText: 'מטופל קיים' }).locator('[data-caction="open-client"]').count(), 1);
  assert.equal(await noa.locator('[data-caction="open-client"], [data-caction="open-lead"]').count(), 0);

  // status + owner save → persisted with the stable ref and phone
  await noa.locator('[data-cfield="crmStatus"]').selectOption('interested');
  await noa.locator('[data-cfield="assignee"]').selectOption('ורד');
  await noa.locator('[data-cfield="note"]').fill('רוצה לשמוע על חבילה');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST' && /saveContinuation/.test(r.request().postData() || ''));
  await noa.getByRole('button', { name: 'שמור' }).click();
  assert.equal((await (await saved).json()).ok, true);
  const row = f.sb.rows('מסלול המשך')[0];
  assert.equal(row.crmStatus, 'interested'); assert.equal(row.assignee, 'ורד'); assert.equal(row.patientRef, 'phone:0501234567'); assert.equal(row.phone, '0501234567');
  // reload → read back
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.tab[data-view="continuation"]');
  await page.locator('.cont-card', { hasText: 'נועה לוי' }).waitFor();
  assert.equal(await page.locator('.cont-card', { hasText: 'נועה לוי' }).locator('[data-cfield="crmStatus"]').inputValue(), 'interested');
  assert.match(await page.locator('.cont-card', { hasText: 'נועה לוי' }).textContent(), /מעוניין/);

  // 📞 on month 1 → the contact modal with the stable subject; logging it closes month 1 only
  await page.locator('.cont-card', { hasText: 'נועה לוי' }).locator('.cont-ms-item').first().getByRole('button', { name: /פנייה/ }).click();
  await page.waitForSelector('#contactModal:not([hidden])');
  assert.equal(await page.textContent('#contactModalName'), 'נועה לוי');
  await page.selectOption('#contactOutcome', 'awaiting_decision');
  await page.fill('#contactForm [name="summary"]', 'הוצעה חבילת המשך');
  await page.check('#contactForm [name="nextMode"][value="none"]');
  await page.fill('#contactForm [name="nextExplanation"]', 'ממתינים לתשובה');
  const logged = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && /logContact/.test(r.request().postData() || ''));
  await page.click('#contactSubmit');
  assert.equal((await (await logged).json()).ok, true);
  await page.locator('.cont-card', { hasText: 'נועה לוי' }).locator('.cont-ms-item.st-done').waitFor();
  const tasks = f.sb.rows('Tasks').filter((x) => x.clientId === 'cont:phone:0501234567');
  assert.deepEqual(tasks.map((x) => x.status).sort(), ['done', 'open', 'open']);
  assert.equal(f.sb.rows('Activity').find((e) => e.kind === 'contact_logged').clientId, 'cont:phone:0501234567');
  assert.match(await page.locator('.cont-card', { hasText: 'נועה לוי' }).textContent(), /מגע אחרון/);
  assert.match(await page.locator('.cont-card', { hasText: 'נועה לוי' }).textContent(), /ממתינים להחלטה/);

  // «היום שלי»: the milestone tasks are rows with the PATIENT'S NAME (resolved from the roster, never from the id),
  // Noa's open month 2 shows her last contact; the other patient's month 1 (contact in 25 days) waits in «בהמשך»
  await page.click('.tab[data-view="dashboard"]');
  const noaRow = page.locator('#myDay .md-row', { hasText: 'הצעת המשך טיפול — לפני חודש 2' }).first();
  await noaRow.waitFor();
  assert.match(await noaRow.textContent(), /נועה לוי/);
  assert.match(await noaRow.textContent(), /מסלול המשך/);
  assert.match(await noaRow.locator('.md-last').textContent(), /ממתינים להחלטה/, 'last contact + outcome on the row');
  const laterSec = page.locator('#myDay .md-sec-later');
  assert.match(await laterSec.textContent(), /מטופל קיים/);
  assert.match(await laterSec.textContent(), /לפני חודש 1/);

  // a terminal status closes the open milestone tasks (server sync on demand)
  await page.click('.tab[data-view="continuation"]');
  await page.locator('.cont-card', { hasText: 'נועה לוי' }).locator('[data-cfield="crmStatus"]').selectOption('declined');
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/continuation-sync'));
  await page.locator('.cont-card', { hasText: 'נועה לוי' }).getByRole('button', { name: 'שמור' }).click();
  assert.equal((await (await synced).json()).ok, true);
  await page.waitForFunction(() => document.querySelectorAll('.cont-card .cont-ms-item.st-closed').length >= 2);
  assert.deepEqual(f.sb.rows('Tasks').filter((x) => x.clientId === 'cont:phone:0501234567').map((x) => x.status).sort(), ['cancelled', 'cancelled', 'done']);
  assert.deepEqual(errors, []);
});

test('מסלול המשך CRM at 360px: cards stack, every control reachable, no horizontal scroll', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, errors } = await f.open({ width: 360, height: 740 });
  await page.click('.tab[data-view="continuation"]');
  await page.locator('.cont-card').first().waitFor();
  await page.waitForSelector('.cont-ms-item');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'no horizontal overflow (' + over + 'px)');
  const noa = page.locator('.cont-card', { hasText: 'נועה לוי' });
  for (const sel of ['[data-cfield="crmStatus"]', '[data-cfield="assignee"]', '[data-cfield="meetingDate"]', '[data-cfield="outcome"]', '[data-cfield="note"]']) {
    await noa.locator(sel).scrollIntoViewIfNeeded();
    assert.equal(await noa.locator(sel).isVisible(), true, sel);
  }
  await noa.getByRole('button', { name: '➕ משימה' }).click();
  await page.waitForSelector('#taskModal:not([hidden])');
  assert.equal(await page.textContent('#taskModalName'), 'נועה לוי');
  assert.deepEqual(errors, []);
});
