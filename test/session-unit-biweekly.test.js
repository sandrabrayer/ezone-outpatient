'use strict';

/**
 * «שבועיים» frequency unit (2026-11-25, CHANGELOG-session-unit-biweekly.md).
 * A plan line can now read «1 / שבועיים» — one session every two weeks — for
 * every treatment type, next to the existing שבוע / חודש units.
 *
 *   - charges-logic + the app.js mirror accept the new unit everywhere a unit
 *     is parsed, attached or resolved; garbage is still dropped;
 *   - Code.gs monthly quota: שבוע ×4, שבועיים ×2, חודש ×1 (plan projection AND
 *     the recordSessionOutcome credit engine);
 *   - the renewal journal accepts a package change to «שבועיים» and still
 *     rejects an unknown unit (server-side validation, fail closed);
 *   - real browser: ורד sets «1 / שבועיים» in עריכה, it is saved and shown.
 */
process.env.OUTPATIENT_PROXY_SECRET = process.env.OUTPATIENT_PROXY_SECRET || 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/charges-logic.js');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { fixture: renewalFixture } = require('../test-support/renewal-journal-fixture.cjs');

const BI = 'שבועיים';

test('charges-logic: the closed unit set is שבוע / שבועיים / חודש', () => {
  assert.deepEqual(C.SESSION_UNITS, ['שבוע', BI, 'חודש']);
  assert.equal(C.isSessionUnit(BI), true);
  assert.equal(C.isSessionUnit('שבועים'), false, 'misspelling is not a unit');
  assert.equal(C.isSessionUnit(''), false);
});

test('charges-logic: a biweekly override parses, resolves and round-trips; garbage still dropped', () => {
  const raw = JSON.stringify({ 'פרטני': 1, 'ליווי יומי בקהילה': 3, _units: { 'פרטני': BI, 'ליווי יומי בקהילה': 'bogus' } });
  assert.deepEqual(C.parseSessionsUnits(raw), { 'פרטני': BI });
  assert.equal(C.sessionUnitFor('פרטני', { 'פרטני': BI }), BI);
  assert.equal(C.sessionUnitFor('מעקב פסיכיאטרי', { 'מעקב פסיכיאטרי': BI }), BI);
  assert.deepEqual(C.attachSessionsUnits({ 'פרטני': 1 }, { 'פרטני': BI, x: 'nope' }), { 'פרטני': 1, _units: { 'פרטני': BI } });
});

test('charges-logic: sessionsPerMonth — שבוע ×4, שבועיים ×2, חודש ×1, unknown → weekly', () => {
  assert.equal(C.sessionsPerMonth(1, 'שבוע'), 4);
  assert.equal(C.sessionsPerMonth(1, BI), 2);
  assert.equal(C.sessionsPerMonth(2, BI), 4);
  assert.equal(C.sessionsPerMonth(1, 'חודש'), 1);
  assert.equal(C.sessionsPerMonth(1, ''), 4);
  assert.equal(C.sessionsPerMonth(0, BI), 0);
  assert.equal(C.sessionsPerMonth('x', BI), 0);
});

test('app.js mirror: the unit menu and every unit check use the shared set (no hard-coded pair left)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /var SESSION_UNITS = \['שבוע', 'שבועיים', 'חודש'\];/);
  assert.match(src, /SESSION_UNITS\.forEach\(function \(unit\)/, 'the unit <select> is built from SESSION_UNITS');
  assert.doesNotMatch(src, /=== 'שבוע' \|\| [a-z.]+ === 'חודש'/, 'no two-unit check remains');
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.match(gs, /var SESSION_UNITS = \['שבוע', 'שבועיים', 'חודש'\];/);
  assert.doesNotMatch(gs, /\['שבוע', 'חודש'\]/, 'the renewal validator uses SESSION_UNITS');
});

test('Code.gs quota: «1 / שבועיים» is 2 sessions a month; mixed plans add up', () => {
  const { ctx } = sandbox([], []);
  const q = (v) => ctx._planMonthlyQuota({ sessionsPerWeek: v });
  assert.equal(q('{"פרטני":1,"_units":{"פרטני":"שבועיים"}}'), 2);
  assert.equal(q('{"פרטני":1,"מעקב פסיכיאטרי":1,"_units":{"פרטני":"שבועיים","מעקב פסיכיאטרי":"חודש"}}'), 3);
  assert.equal(q('{"פרטני":1,"ליווי יומי בקהילה":3,"_units":{"פרטני":"שבועיים"}}'), 14);
  assert.equal(q('{"פרטני":1,"_units":{"פרטני":"junk"}}'), 4, 'unknown unit keeps the weekly legacy rule');
});

test('Code.gs projection + credit engine: a biweekly plan is beyond quota on the 3rd session of the month', () => {
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const now = new Date();
  const MONTH = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1);
  const SECRET = 'outcome-secret-for-tests';
  const cl = { id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני', clinicalTreatmentType: 'פרטני כללי',
    sessionsPerWeek: '{"פרטני":1,"_units":{"פרטני":"שבועיים"}}', status: 'פעיל', startDate: '2026-09-01', creditsOwed: 1 };
  const s = sandbox([], [cl]);
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, [1, 2].map((i) => ({ sessionId: 'h' + i, phone: '0501234567', patientName: 'אורי',
    clientId: 'c1', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני כללי', billingType: 'פרטני', date: MONTH + '-0' + i,
    outcome: 'happened', therapistPay: 250, clientSessionValue: 500, sessionStatus: 'consumed', matchStatus: 'matched',
    recordedAt: '', creditStatus: 'within_quota', forwardedToPayroll: '' })));
  s.props.SESSION_OUTCOME_SECRET = SECRET;
  const plan = JSON.parse(JSON.stringify(s.ctx._getTreatmentPlans())).clients.find((r) => r.clientId === 'c1');
  assert.deepEqual([plan.monthQuota, plan.monthUsed, plan.monthRemaining], [2, 2, 0]);
  const r = s.post({ action: 'recordSessionOutcome', secret: SECRET, sessionId: 'third', phone: '0501234567', therapist: 'מעיין דלומי',
    clinicalTreatmentType: 'פרטני כללי', date: MONTH + '-20', outcome: 'happened' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.rows('SessionLog').find((x) => x.sessionId === 'third').creditStatus, 'covered');
});

test('renewal journal: a package change to «שבועיים» is accepted; an unknown unit is still refused', () => {
  const ok = renewalFixture();
  ok.request.patch.sessionsPerWeek = '{"פרטני":1,"_units":{"פרטני":"שבועיים"}}';
  ok.request.patch.packageChangeDate = '2026-02-25';
  assert.equal(ok.reserve().ok, true);
  assert.equal(ok.apply().operation.state, 'done');
  assert.equal(ok.sb.rows('Clients')[0].sessionsPerWeek, '{"פרטני":1,"_units":{"פרטני":"שבועיים"}}');

  const bad = renewalFixture();
  bad.request.patch.sessionsPerWeek = '{"פרטני":1,"_units":{"פרטני":"כל יומיים"}}';
  bad.request.patch.packageChangeDate = '2026-02-25';
  const res = bad.reserve();
  assert.equal(res.ok, false);
  assert.equal(bad.sb.rows('FinancialOps').length, 0);
});

// ---- real browser: ורד sets «1 / שבועיים» in עריכה -------------------------
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

test('browser: עריכה offers שבוע / שבועיים / חודש; «1 / שבועיים» saves and the card shows it', skipOpt, async (t) => {
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.EZONE_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox'] }); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary'); return;
  }
  const STAMP = '2026-11-01T08:00:00.000Z';
  const sb = sandbox([], [{ id: 'c1', name: 'מטופל 1', phone: '0500000011', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}',
    location: 'רעננה הפרדס', status: 'פעיל', pricePerSession: 1200, startDate: '2026-09-01', billingDay: 1,
    nextBillingDate: '2026-12-01', paymentDate: '2026-11-01', paymentStatus: 'paid', source: 'lead', billingType: 'monthly',
    updatedAt: STAMP, updatedBy: 'ורד' }]);
  sb.ctx._todayISODate = () => '2026-11-25';
  const captured = [], errors = [];
  const oldFetch = global.fetch;
  const keys = ['APP_PIN', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.APP_PIN = '424242'; // throwaway fixture value, never a real PIN
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

  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-11-25T09:00:00Z'])); }
      static now() { return new RealDate('2026-11-25T09:00:00Z').getTime(); }
    };
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForSelector('#pinScreen:not([hidden])');
  await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
  await page.fill('#pinInput', '424242');
  await page.click('#pinSubmit');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.tab[data-view="clients"]');
  const card = page.locator('#clientsList .client-card').filter({ has: page.locator('.client-name', { hasText: 'מטופל 1' }) });
  await card.first().waitFor();

  await card.getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.waitForSelector('#editClientModal:not([hidden])');
  const unitSel = page.locator('#editClientForm select[data-service-unit="פרטני"]');
  assert.deepEqual(await unitSel.locator('option').allTextContents(), ['שבוע', BI, 'חודש']);
  await page.locator('#editClientForm input[data-service="פרטני"]').fill('1');
  await unitSel.selectOption(BI);
  const before = captured.length;
  await page.click('#editClientSubmit');
  await page.waitForFunction(() => !document.querySelector('#editClientModal') || document.querySelector('#editClientModal').hidden);
  for (let i = 0; i < 50 && !captured.slice(before).some((c) => c.payload.action === 'saveAll'); i++) await page.waitForTimeout(100);
  const saves = captured.slice(before).filter((c) => c.payload.action === 'saveAll');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].result.ok, true);
  const stored = JSON.parse(sb.rows('Clients').find((r) => r.id === 'c1').sessionsPerWeek);
  assert.deepEqual(stored, { 'פרטני': 1, _units: { 'פרטני': BI } });
  await page.waitForFunction(() => /1\/שבועיים/.test(document.querySelector('#clientsList').textContent));

  // reopen: the stored unit is pre-selected
  await card.getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.waitForSelector('#editClientModal:not([hidden])');
  assert.equal(await unitSel.inputValue(), BI);
  assert.deepEqual(errors, []);
});
