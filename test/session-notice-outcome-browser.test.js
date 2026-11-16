'use strict';
// «התקיים / לא התקיים» in Outpatient — real browser (Chromium), server.js + REAL Code.gs in the sandbox.
// The therapists app's approved reports arrive through the real recordSessionOutcome receiver, then:
//   • patient card → «📋 מפגשים שדווחו»: each session with the green/red chip, the reason and the account
//     effect (מחויב / נוצר קרדיט / מומש קרדיט), and the credit balance — matched by clientId only;
//   • «תשלומי מטפלים»: the same wording per session, the notice cancellation unpaid and counted on its own;
//   • «תקן»: correcting «late / no-show» to «24h notice» re-prices pay and credit at the source;
//   • דנה (operational, money-free) has no button and the server refuses the read.
// Synthetic data; no network. 1280px and 360px; no console errors, no sideways scroll.
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

const OUTCOME_SECRET = 'session-outcome-secret-fixture';
const PHONE = '0500000047';
const THERAPIST = 'הילה תבור';
const CLIENT = { id: 'fixture-held-c1', name: 'מטופלת דיווח', phone: PHONE, status: 'פעיל', serviceType: 'פרטני CBT', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני CBT":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, startDate: '2026-10-01', creditsOwed: 0 };
const OTHER = { id: 'fixture-held-c2', name: 'מטופלת אחרת', phone: '0500000048', status: 'פעיל', serviceType: 'פרטני CBT', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני CBT":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, startDate: '2026-10-01', creditsOwed: 0 };
const month = () => new Date().toISOString().slice(0, 7);
const dayOf = (d) => month() + '-' + String(d).padStart(2, '0');

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([], [CLIENT, OTHER]);
  sb.props.SESSION_OUTCOME_SECRET = OUTCOME_SECRET;
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [{ name: THERAPIST, flatRate: 300 }]);
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  // The therapists app's approved reports, through the REAL receiver.
  const report = (sessionId, day, outcome, phone) => {
    const r = post({ action: 'recordSessionOutcome', secret: OUTCOME_SECRET, sessionId, phone: phone || PHONE, therapist: THERAPIST, clinicalTreatmentType: 'פרטני CBT', date: dayOf(day), outcome, reportRevision: dayOf(day) + 'T10:00:00.000Z' });
    assert.equal(r.ok, true, sessionId + ': ' + JSON.stringify(r));
  };
  report('s-held', 2, 'happened');
  report('s-notice', 3, 'patient_cancelled_notice');
  report('s-late', 4, 'patient_no_show');
  report('s-ther', 5, 'therapist_cancelled');
  report('s-other', 6, 'happened', OTHER.phone);              // another patient's session
  report('s-orphan', 7, 'patient_cancelled_notice', '0509999999'); // no client: flagged, credited to nobody

  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture' });
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
  return { sb, open, upstreamCalls, post };
}

const tableRows = (page, sel) => page.$$eval(sel + ' tbody tr', (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.innerText.replace(/\s+/g, ' ').trim())));

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('reported sessions ' + vp.name + ': patient card list + payout table read the same «התקיים / לא התקיים», reason and account effect', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height });
    assert.equal(Number(f.sb.rows('Clients')[0].creditsOwed), 2, 'two credits at the source (24h notice + therapist cancelled)');

    // ---- patient card → «📋 מפגשים שדווחו» ----
    await page.click('.tab[data-view="clients"]');
    const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
    await card.waitFor();
    await card.locator('[data-action="client-sessions"]').click();
    await page.waitForSelector('#clientSessionsModal:not([hidden]) .client-sessions-table');
    assert.match(await page.textContent('#clientSessionsTitle'), new RegExp(CLIENT.name));
    const sub = await page.textContent('#clientSessionsSub');
    assert.match(sub, /התקיימו: 1/); assert.match(sub, /לא התקיימו: 3/); assert.match(sub, /קרדיטים שנוצרו: 2/); assert.match(sub, /יתרת קרדיט מפגשים: 2/);
    const rows = await tableRows(page, '#clientSessionsModal');
    assert.equal(rows.length, 4, 'only THIS patient\'s sessions (not the other patient, not the unmatched one): ' + JSON.stringify(rows));
    // newest first: therapist cancelled (5), late (4), notice (3), happened (2)
    assert.match(rows[0][3], /❌ לא התקיים/); assert.match(rows[0][3], /המטפל\/ת ביטל\/ה/); assert.match(rows[0][4], /נוצר קרדיט/); assert.match(rows[0][5], /ללא תשלום/);
    assert.match(rows[1][3], /❌ לא התקיים/); assert.match(rows[1][3], /בפחות מ־24 שעות/); assert.match(rows[1][4], /מחויב/); assert.match(rows[1][4], /ללא קרדיט/); assert.match(rows[1][5], /משולם למטפל/);
    assert.match(rows[2][3], /❌ לא התקיים/); assert.match(rows[2][3], /24 שעות ומעלה/); assert.match(rows[2][4], /נוצר קרדיט/); assert.match(rows[2][5], /ללא תשלום/);
    assert.match(rows[3][3], /✅ התקיים/); assert.match(rows[3][4], /מחויב/); assert.match(rows[3][5], /משולם למטפל/);
    for (const r of rows) assert.doesNotMatch(r.join(' '), /₪|\b300\b/, 'no pay amount in the patient\'s list');
    assert.equal(await page.locator('#clientSessionsModal .session-held-no').count(), 3);
    assert.equal(await page.locator('#clientSessionsModal .session-held-yes').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no page-level horizontal scroll');
    // the list itself never needs sideways scrolling either (stacked blocks on a phone)
    assert.ok(await page.$eval('#clientSessionsModal .client-sessions-scroll', (e) => e.scrollWidth <= e.clientWidth + 1), 'the session list fits its width');
    await page.click('#clientSessionsModal [data-close]');
    await page.waitForSelector('#clientSessionsModal', { state: 'hidden' });

    // ---- «תשלומי מטפלים» ----
    await page.click('.tab[data-view="payouts"]');
    const pcard = page.locator('#payoutList > div', { hasText: THERAPIST }).first();
    await pcard.waitFor();
    const stats = (await pcard.innerText()).replace(/\s+/g, ' ');
    assert.match(stats, /סשנים משולמים 3/, 'happened ×2 (both patients) + the late cancellation');
    assert.match(stats, /בוטלו ע״י מטפל 1/);
    assert.match(stats, /בוטלו ע״י מטופל \(24 שעות\+\) 2/);
    await pcard.locator('[data-action="payout-toggle"]').click();
    await page.waitForSelector('#payoutList table');
    const prow = await tableRows(page, '#payoutList');
    const byPatientDay = (txt) => prow.find((r) => r.join(' ').includes(txt));
    const notice = prow.find((r) => /24 שעות ומעלה/.test(r[3]) && r[1] === CLIENT.name);
    assert.ok(notice, JSON.stringify(prow));
    assert.match(notice[3], /❌ לא התקיים/); assert.match(notice[4], /נוצר קרדיט/); assert.match(notice[5], /₪?\s?0\b/);
    const orphan = prow.find((r) => /24 שעות ומעלה/.test(r[3]) && r[1] !== CLIENT.name);
    assert.match(orphan[4], /לבדיקה/, 'a credit that reached nobody is flagged, never shown as granted');
    const late = prow.find((r) => /בפחות מ־24 שעות/.test(r[3]));
    assert.match(late[4], /מחויב/); assert.match(late[5], /300/);
    assert.ok(byPatientDay('✅ התקיים'));

    // ---- «תקן»: late / no-show → 24h notice (the coordinator learned the patient DID give notice) ----
    const lateTr = page.locator('#payoutList tbody tr', { hasText: 'בפחות מ־24 שעות' }).first();
    await lateTr.locator('[data-action="payout-correct"]').click();
    await page.waitForSelector('#sessionModal:not([hidden])');
    assert.deepEqual(await page.$$eval('#sessionForm select[name="outcome"] option', (os) => os.map((o) => o.value)), ['happened', 'patient_cancelled_notice', 'patient_no_show', 'therapist_cancelled']);
    assert.equal(await page.inputValue('#sessionForm select[name="outcome"]'), 'patient_no_show');
    await page.selectOption('#sessionForm select[name="outcome"]', 'patient_cancelled_notice');
    await page.click('#sessionSubmit');
    await page.waitForSelector('#sessionModal', { state: 'hidden' });
    await page.waitForFunction(() => !/בפחות מ־24 שעות/.test(document.querySelector('#payoutList').innerText));
    const log = f.sb.rows('SessionLog').find((r) => r.sessionId === 's-late');
    assert.equal(log.outcome, 'patient_cancelled_notice');
    assert.equal(Number(log.therapistPay), 0, 'pay re-priced at the source');
    assert.equal(log.creditStatus, 'credit_added');
    assert.equal(Number(f.sb.rows('Clients')[0].creditsOwed), 3, 'the credit followed the correction');
    assert.equal(f.sb.rows('SessionLog').filter((r) => r.sessionId === 's-late').length, 1, 'corrected in place');

    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no page-level horizontal scroll');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}

test('operational scope (דנה): no «מפגשים שדווחו» button and the server refuses the session-log read', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const { page, errors } = await f.open({ width: 1280, height: 900 }, 'דנה', '626262');
  await page.click('.tab[data-view="clients"]');
  const card = page.locator('.client-card', { hasText: CLIENT.name }).first();
  await card.waitFor();
  assert.equal(await card.locator('[data-action="client-sessions"]').count(), 0);
  const res = await page.evaluate(async () => { const r = await fetch('/api/sheets?action=getSessionLog', { cache: 'no-store' }); return { status: r.status, body: await r.text() }; });
  assert.ok(res.status === 403 || /forbidden|money/i.test(res.body), JSON.stringify(res));
  assert.doesNotMatch(res.body, /therapistPay/);
  assert.deepEqual(errors, []);
});
