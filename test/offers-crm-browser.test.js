'use strict';
// Offers CRM in «תמחור חבילות» — real browser (Chromium), server.js + Code.gs sandbox, signed in as ורד, 1280px and 360px:
// «➕ הצעת מחיר חדשה» → items (package × qty + Solo tier) → create (double click = one) → approve pricing →
// «💬 הכן הודעת WhatsApp» (opening never changes the status) → «סמן כנשלחה» (status sent + follow-up) →
// the offer shows on the lead card and in «היום שלי» on its follow-up date; no charge / payment; no horizontal scroll.
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

async function fixture(t, opts) {
  opts = opts || {};
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([{ id: 'lead-1', name: 'ליד להצעה', phone: '0501111111', stage: 'new', assignedTo: 'ורד', created: '2026-10-20' }], [CLIENT]);
  Object.assign(sb.props, { PACKAGE_CATALOG_SECRET: 'package-catalog-secret-0123456789abcdef-A', PACKAGE_REQUEST_SECRET: 'package-request-secret-0123456789abcdef-B', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => post(Object.assign({ action }, body, { proxySecret: process.env.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);
  const epoch = admin('adminGetPackageCatalog', { user: 'ורד' }).catalogEpoch;
  // two manager requests: a fixed-price pack (adjust + approve) and a Solo range (tier selection)
  assert.equal(post({ action: 'createPackageRequest', secret: 'package-request-secret-0123456789abcdef-B', requestId: '11111111-1111-4111-8111-111111111111', requesterKey: 'oren', patientName: 'מטופל אורן', patientPhone: '0502222222', packageKey: 'emdr_core', catalogEpoch: epoch }).ok, true);
  assert.equal(post({ action: 'createPackageRequest', secret: 'package-request-secret-0123456789abcdef-B', requestId: '22222222-2222-4222-8222-222222222222', requesterKey: 'shahar', patientName: 'מטופל שחר', patientPhone: '0503333333', packageKey: 'solo_housing', months: 3, catalogEpoch: epoch }).ok, true);

  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
  const upstream = { latencyMs: opts.latencyMs || 0, fail: false };
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
    if (upstream.latencyMs) await new Promise((r) => setTimeout(r, upstream.latencyMs));
    if (upstream.fail) throw new Error('upstream down (fixture)');
    let result;
    if (options.method === 'POST') result = post(JSON.parse(options.body));
    else result = JSON.parse(sb.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent());
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
    const errors = [], consoleErrors = [], calls = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error' || /status of 401/.test(m.text())) return;
      // this fixture has no Dashboard roster configured: the boot-time roster probe answers 500 by design
      const where = (m.location && m.location().url) || '';
      if (/\/api\/continuation-roster/.test(where)) return;
      consoleErrors.push(m.text() + ' @ ' + where);
    });
    page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/catalog-admin')) calls.push({ path: u.pathname, status: r.status(), body: r.request().postData() || '' }); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    // the pre-sign-in boot answers 401 before any session exists; only what happens after sign-in counts
    consoleErrors.length = 0; calls.length = 0;
    return { context, page, errors, consoleErrors, calls };
  }
  return { sb, upstream, open };
}


function todayPlus(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('offers CRM ' + vp.name + ': new offer → approve → WhatsApp → mark sent → card + My Day; no billing side effect', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    // Oren's WhatsApp is a SETTING (never in code)
    f.sb.post({ action: 'saveSettings', user: 'ורד', settings: { bankName: '', bankBranch: '', bankAccount: '', bankHolder: '', orenWhatsapp: '052-765-4321' } });
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height });
    await page.click('.tab[data-view="packages"]');
    await page.waitForSelector('.pkg-admin');
    await page.locator('.pkg-new-btn').waitFor();
    await page.locator('.pkg-new-btn').click();
    await page.waitForSelector('.pkg-new');
    // who: a full-width searchable picker — by phone, then by name; the unregistered row sits beneath it
    const who = page.locator('.pkg-new .pkg-who-input');
    const formW = (await page.locator('.pkg-new').boundingBox()).width;
    const whoBox = await who.boundingBox();
    assert.ok(whoBox.width >= formW - 48, 'picker spans the form (' + whoBox.width + ' of ' + formW + ')');
    assert.ok(whoBox.height >= 40, 'picker is large (' + whoBox.height + 'px)');
    const manualBox = await page.locator('.pkg-new .pkg-who-manual').boundingBox();
    assert.ok(manualBox.y > whoBox.y + whoBox.height - 1, 'name/phone row is beneath the picker');
    const nameBox = await page.locator('.pkg-new input[aria-label="שם הלקוח"]').boundingBox();
    assert.ok(nameBox.y >= manualBox.y, 'the unregistered name input lives in that row');
    await who.fill('0500000021');
    await page.locator('.pkg-new .pkg-who-opt').first().waitFor();
    assert.match(await page.locator('.pkg-new .pkg-who-opt').first().textContent(), /מטופל חבילה.*050-?000-?0021|מטופל חבילה.*0500000021/, 'phone search finds the client with name · phone');
    assert.match(await page.locator('.pkg-new .pkg-who-opt').first().textContent(), /פרטני · רעננה הפרדס/, 'house/type shown');
    await who.fill('ליד להצ');
    await page.locator('.pkg-new .pkg-who-opt', { hasText: 'ליד להצעה' }).waitFor();
    assert.equal(await page.locator('.pkg-new .pkg-who-opt').count(), 1);
    await page.locator('.pkg-new .pkg-who-opt', { hasText: 'ליד להצעה' }).click();
    await page.locator('.pkg-new .pkg-who-picked[data-target="lead:lead-1"]').waitFor();
    assert.equal(await page.locator('.pkg-new input[aria-label="שם הלקוח"]').count(), 0, 'a picked target hides the unregistered row');
    // item 1: EMDR Core × 2
    await page.locator('.pkg-new .pkg-chip', { hasText: 'Core' }).first().click();
    await page.locator('.pkg-new .pkg-pick-quote', { hasText: 'מחיר ליחידה' }).waitFor();
    await page.locator('.pkg-new .pkg-qty').fill('2');
    await page.locator('.pkg-new button', { hasText: 'הוספה להצעה' }).click();
    await page.locator('.pkg-item-row').first().waitFor();
    // item 2: Solo needs a tier before it can be added
    await page.locator('.pkg-new .pkg-chip', { hasText: 'טווח מחיר' }).click();
    await page.locator('.pkg-new .pkg-chip', { hasText: 'מינימום' }).waitFor();
    assert.equal(await page.locator('.pkg-new button', { hasText: 'הוספה להצעה' }).isDisabled(), true, 'Solo without a tier cannot be added');
    await page.locator('.pkg-new .pkg-chip', { hasText: 'אמצע' }).click();
    await page.locator('.pkg-new .pkg-pick-quote', { hasText: 'מחיר ליחידה' }).waitFor();
    await page.locator('.pkg-new button', { hasText: 'הוספה להצעה' }).click();
    assert.equal(await page.locator('.pkg-item-row').count(), 2);
    assert.match(await page.locator('.pkg-new .pkg-total').textContent(), /המחיר הסופי מחושב בשרת/);
    await page.locator('.pkg-new input[aria-label="תוקף ההצעה"]').fill(todayPlus(30));
    await page.locator('.pkg-new input[aria-label="מועד מעקב"]').fill(todayPlus(0));
    await page.locator('.pkg-new input[aria-label="הערות"]').fill('הצעה לדוגמה');
    // double click → ONE request
    const createBtn = page.locator('.pkg-create-btn');
    await createBtn.dblclick();
    await page.locator('.pkg-card', { hasText: 'ליד להצעה' }).waitFor();
    const mine = () => f.sb.rows('PackageRequests').filter((r) => r.createdFrom === 'outpatient');
    assert.equal(mine().length, 1, 'a double click created one request (the two manager requests are fixture rows)');
    const card = () => page.locator('.pkg-card', { hasText: 'ליד להצעה' });
    assert.match(await card().textContent(), /טיוטה/);
    assert.equal(await card().locator('.pkg-items-list li').count(), 2, 'both items listed');
    const stored = mine()[0];
    assert.equal(JSON.parse(stored.quoteSnapshot).grossAgorot, 2 * 340000 + 3 * 900000, 'priced by the source');
    assert.equal(stored.attachedType, 'lead');
    // discount (reason mandatory) + approve pricing → ready_to_send
    await card().getByLabel('סכום מתואם').fill('30000');
    await card().getByLabel('סיבת התאמה').fill('הנחת היכרות');
    await card().getByRole('button', { name: 'התאמת סכום' }).click();
    await card().locator('.pkg-log li', { hasText: 'הנחת היכרות' }).waitFor();
    await card().getByRole('button', { name: /אישור תמחור/ }).click();
    await card().locator('.pkg-st-ready_to_send').waitFor();
    // WhatsApp: prepare, open (status unchanged), then mark sent
    await card().getByRole('button', { name: /הכן הודעת WhatsApp/ }).click();
    await card().locator('.pkg-wa').waitFor();
    await card().locator('.pkg-wa select').selectOption('oren');
    const text = await card().locator('.pkg-wa-text').inputValue();
    assert.match(text, /ליד להצעה/); assert.match(text, /30,000 ₪/); assert.ok(!/אבחנה|תרופות/.test(text));
    // capture what would open (the fixture blocks every non-origin navigation)
    await page.evaluate(() => { window.__wa = []; window.open = function (u) { window.__wa.push(String(u)); return null; }; });
    await card().getByRole('button', { name: /פתיחת WhatsApp/ }).click();
    const opened = await page.evaluate(() => window.__wa);
    assert.equal(opened.length, 1);
    assert.match(opened[0], /^https:\/\/wa\.me\/972527654321\?text=/, 'Oren\'s number from the settings, international format');
    assert.match(decodeURIComponent(opened[0].split('text=')[1]), /ליד להצעה/);
    assert.equal(mine()[0].status, 'priced', 'opening WhatsApp did NOT mark the offer as sent');
    await card().locator('.pkg-wa input[aria-label="מועד מעקב אחרי השליחה"]').fill(todayPlus(0));
    await card().locator('.pkg-wa').getByRole('button', { name: /סמן כנשלחה/ }).click();
    await card().locator('.pkg-st-sent').waitFor();
    const row = mine()[0];
    assert.equal(row.status, 'sent'); assert.equal(row.sentTo, 'oren'); assert.ok(row.sentAtIso); assert.equal(row.followUpDate, todayPlus(0));
    assert.equal(f.sb.rows('Charges').length, 0); assert.equal(f.sb.rows('Payments').length, 0);
    // filters
    await page.locator('.pkg-filters .pkg-chip', { hasText: /^נשלחה/ }).click();
    assert.equal(await page.locator('.pkg-card').count(), 1);
    await page.locator('.pkg-filters .pkg-chip', { hasText: /^טיוטה/ }).click();
    assert.equal(await page.locator('.pkg-card').count(), 2, 'the two manager drafts');
    assert.equal(await page.locator('.pkg-card', { hasText: 'ליד להצעה' }).count(), 0);
    // the lead card shows the offer; «היום שלי» has the follow-up row today
    await page.click('.tab[data-view="leads"]');
    await page.locator('.crm-block [data-offer-open]').first().waitFor();
    assert.match(await page.locator('.crm-block [data-offer-open]').first().textContent(), /נשלחה/);
    await page.click('.tab[data-view="dashboard"]');
    const mdRow = page.locator('#myDay .md-row', { hasText: 'מעקב אחרי הצעת מחיר' });
    await mdRow.first().waitFor();
    assert.match(await mdRow.first().textContent(), /ליד להצעה/);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'no horizontal overflow (' + over + 'px)');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}
