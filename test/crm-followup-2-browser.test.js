'use strict';
// CRM follow-up 2 (Sandra's production review, 2026-11-04) — real browser (Chromium), server.js + Code.gs sandbox,
// a Dashboard roster fixture, signed in as ורד, 1280px and 360px, RTL, no horizontal scroll:
//   1. billing mode: a per-session client has no overdue banner / chip / renewal row / «תשלומים באיחור»; the
//      suggestion chip flips a פרטני client with one click and persists; the edit modal carries the toggle;
//   2. «💰 הצעת מחיר» on the client card opens the SAME offer form (target locked) and the quote shows at once;
//   3. «🗑 מחיקה» / «↺ איפוס» with the in-app confirm — the deleted quote vanishes from the card, list and My Day;
//   4. the picker offers מטופלים · מאושפזים · לידים פתוחים in one field; a roster pick shows in «מסלול המשך»;
//   5. WhatsApp: two real anchors (href asserted), opening changes nothing; the missing-Oren hint links to settings.
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
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function todayPlus(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
// both unpaid with a renewal date in the past: the package client is overdue, the per-session one must never be
const PKG = { id: 'fixture-pkg', name: 'מטופל חבילה', phone: '0500000021', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: daysAgo(10), startDate: '2026-06-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
const PER = { id: 'fixture-per', name: 'ערן לפי טיפול', phone: '0500000022', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 450, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: daysAgo(10), startDate: '2026-06-01', assignedTo: 'ורד', billingMode: 'per_session', updatedAt: '2026-10-30T07:00:00.000Z' };
const SUGGEST = { id: 'fixture-sug', name: 'מועמד לפי טיפול', phone: '0500000023', status: 'פעיל', serviceType: 'פרטני', location: 'רמות השבים', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 0, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: todayPlus(20), startDate: '2026-10-01', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
const ROSTER = { ok: true, patients: [
  { sourceApp: 'dashboard', id: 'dash-77', name: 'נועה מאושפזת', phone: '050-123-4567', house: 'ramot', entryDate: daysAgo(20) }
] };

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([
    { id: 'lead-open', name: 'ליד פתוח', phone: '0501111111', stage: 'new', house_of_origin: 'external', assignedTo: 'ורד', created: '2026-10-20' },
    { id: 'lead-closed', name: 'ליד סגור', phone: '0501111112', stage: 'לא רלוונטי', source: 'אתר', assignedTo: 'ורד', created: '2026-10-20' }
  ], [PKG, PER, SUGGEST]);
  Object.assign(sb.props, { PACKAGE_CATALOG_SECRET: 'package-catalog-secret-0123456789abcdef-A', PACKAGE_REQUEST_SECRET: 'package-request-secret-0123456789abcdef-B', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const post = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => post(Object.assign({ action }, body, { proxySecret: process.env.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);
  const keys = ['APP_PIN', 'USER_PIN_OREN', 'USER_PIN_DANA', 'SESSION_SECRET', 'SHEETS_URL', 'DASHBOARD_SHEETS_URL', 'OCCUPANCY_SECRET', 'CATALOG_ADMIN_ASSERTION_SECRET'];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_PIN: '424242', USER_PIN_OREN: '515151', USER_PIN_DANA: '626262', SESSION_SECRET: 'fixture-session-secret-not-a-real-credential', SHEETS_URL: 'https://sheets.invalid/fixture', DASHBOARD_SHEETS_URL: 'https://dashboard.invalid/exec', OCCUPANCY_SECRET: 'occupancy-fixture-secret', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.host === 'dashboard.invalid') return { status: 200, text: async () => JSON.stringify(ROSTER) };
    assert.equal(url.origin + url.pathname, 'https://sheets.invalid/fixture', 'no other upstream allowed');
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
    const errors = [], consoleErrors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) consoleErrors.push(m.text()); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#pinNames .user-btn').getByText('ורד', { exact: true }).click();
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#app:not([hidden])');
    consoleErrors.length = 0;
    return { context, page, errors, consoleErrors };
  }
  return { sb, post, open };
}

const noOverflow = async (page) => { const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 0, 'no horizontal overflow (' + over + 'px)'); };

for (const vp of [{ name: 'desktop 1280px', width: 1280, height: 900 }, { name: 'mobile 360px', width: 360, height: 740 }]) {
  test('follow-up 2 ' + vp.name + ': billing mode → card quote → picker sources → WhatsApp links → delete/reset', skipOpt, async (t) => {
    const f = await fixture(t); if (!f) return;
    const { page, errors, consoleErrors } = await f.open({ width: vp.width, height: vp.height });
    const clientRows = () => f.sb.rows('Clients');

    /* ---- 1. billing mode -------------------------------------------------------------------- */
    // «היום שלי»: the package client is an overdue payment; the per-session client never is
    const overdueSec = page.locator('#myDay .md-sec-overdue_payments');
    await overdueSec.waitFor();
    assert.match(await overdueSec.textContent(), /מטופל חבילה/);
    assert.doesNotMatch(await page.locator('#myDay').textContent(), /ערן לפי טיפול/, 'no renewal / collection row for a per-session client');
    assert.match(await page.locator('#myDay .md-card', { hasText: 'חידושים וגבייה' }).textContent(), /1 תשלומים באיחור/, 'KPI counts the package client only');
    await page.click('.tab[data-view="clients"]');
    await page.locator('.client-card').first().waitFor();
    const pkgCard = page.locator('.client-card', { hasText: 'מטופל חבילה' });
    const perCard = page.locator('.client-card', { hasText: 'ערן לפי טיפול' });
    const sugCard = page.locator('.client-card', { hasText: 'מועמד לפי טיפול' });
    assert.equal(await pkgCard.locator('.card-banner-stop').count(), 1, 'package client: overdue banner');
    assert.equal(await perCard.locator('.card-banner-stop, .card-banner-warn').count(), 0, 'per-session client: no banner');
    assert.equal(await perCard.locator('.chip-unpaid, .chip-paid, .month-pay-btn').count(), 0, 'no paid / unpaid chip');
    assert.equal(await perCard.locator('.cc-line-hot').count(), 0, 'no «גבייה הבאה» row');
    assert.match(await perCard.locator('.chip-per-session').textContent(), /משלם\/ת לפי טיפול/);
    assert.match(await perCard.locator('.cc-money').textContent(), /₪450.*מחיר לטיפול/s);
    assert.equal(await perCard.locator('.chip-suggest-per-session').count(), 0, 'no suggestion on an already per-session client');
    assert.equal(await pkgCard.locator('.chip-suggest-per-session').count(), 0, 'no suggestion on a client with a monthly amount');
    assert.doesNotMatch(await page.locator('#renewalsAlerts').textContent().catch(() => ''), /ערן לפי טיפול/);
    // the one-click suggestion flips THIS client only and persists as the stable key; nothing else migrates
    const chip = sugCard.locator('.chip-suggest-per-session');
    assert.equal(await chip.count(), 1, 'a פרטני client with no paid package gets the suggestion chip');
    assert.match(await chip.textContent(), /סמן כתשלום לפי טיפול\?/);
    await chip.click();
    await page.locator('.client-card', { hasText: 'מועמד לפי טיפול' }).locator('.chip-per-session').waitFor();
    await page.waitForFunction(() => true); // let the save settle
    await page.waitForTimeout(300);
    const byId = Object.fromEntries(clientRows().map((r) => [r.id, r]));
    assert.equal(byId['fixture-sug'].billingMode, 'per_session');
    assert.equal(byId['fixture-pkg'].billingMode, '', 'nobody else was flipped (no migration)');
    assert.equal(byId['fixture-pkg'].nextBillingDate, PKG.nextBillingDate, 'package billing untouched');
    assert.equal(f.sb.rows('Payments').length, 0, 'no payment row was created or moved');
    // the edit modal carries the toggle, prefilled, and saves it back
    await page.locator('.client-card', { hasText: 'מועמד לפי טיפול' }).getByRole('button', { name: 'עריכה', exact: true }).click();
    await page.waitForSelector('#editClientModal:not([hidden])');
    const sel = page.locator('#editClientForm select[name="billingMode"]');
    assert.equal(await sel.inputValue(), 'per_session');
    assert.deepEqual(await sel.locator('option').allTextContents(), ['חבילה / חודשי', 'תשלום לפי טיפול']);
    await sel.selectOption('package');
    await page.click('#editClientSubmit');
    await page.waitForSelector('#editClientModal[hidden]', { state: 'attached' });
    await page.waitForTimeout(300);
    assert.equal(clientRows().find((r) => r.id === 'fixture-sug').billingMode, 'package');
    await noOverflow(page);

    /* ---- 2. quote from the patient card ---------------------------------------------------- */
    const offerBtn = pkgCard.locator('.cc-offer-btn');
    assert.equal(await offerBtn.count(), 1, 'ורד sees «💰 הצעת מחיר» on the card');
    assert.equal(await perCard.locator('.cc-offer-btn').count(), 1);
    await offerBtn.click();
    const host = pkgCard.locator('.cc-offer-host');
    await host.locator('.pkg-new').waitFor();
    const picked = host.locator('.pkg-who-picked[data-target="client:fixture-pkg"]');
    await picked.waitFor();
    assert.match(await picked.textContent(), /מטופל חבילה/);
    assert.equal(await picked.locator('button').count(), 0, 'the target is locked (no «החלפה»)');
    assert.equal(await host.locator('.pkg-who-input').count(), 0, 'no search field on a locked form');
    await host.locator('.pkg-chip', { hasText: 'Core' }).first().click();
    await host.locator('.pkg-pick-quote', { hasText: 'מחיר ליחידה' }).waitFor();
    assert.match(await host.locator('.pkg-pick-quote').textContent(), /3,400 ₪/, 'the price is computed right there');
    await host.locator('button', { hasText: 'הוספה להצעה' }).click();
    await host.locator('.pkg-item-row').first().waitFor();
    assert.equal(await host.locator('.pkg-new').boundingBox().then((b) => b.width <= vp.width), true);
    await host.locator('.pkg-create-btn').click();
    // the quote shows on the card immediately — the form is gone, the CRM block lists it
    await pkgCard.locator('.crm-block [data-offer-open]').first().waitFor();
    assert.match(await pkgCard.locator('.crm-block [data-offer-open]').first().textContent(), /טיוטה/);
    assert.equal(await pkgCard.locator('.cc-offer-host .pkg-new').count(), 0);
    const mine = () => f.sb.rows('PackageRequests').filter((r) => r.createdFrom === 'outpatient');
    assert.equal(mine().length, 1); assert.equal(mine()[0].attachedType, 'client'); assert.equal(mine()[0].attachedId, 'fixture-pkg');
    assert.equal(f.sb.rows('Charges').length, 0); assert.equal(f.sb.rows('Payments').length, 0, 'a quote is not a charge or a payment');
    await noOverflow(page);

    /* ---- 4. picker sources (pricing tab) + roster link ------------------------------------- */
    await page.click('.tab[data-view="packages"]');
    await page.waitForSelector('.pkg-admin');
    await page.locator('.pkg-new-btn').click();
    await page.waitForSelector('.pkg-new');
    const who = page.locator('.pkg-new .pkg-who-input');
    await who.fill('050');
    await page.locator('.pkg-new .pkg-who-section').first().waitFor();
    const sections = await page.locator('.pkg-new .pkg-who-section').allTextContents();
    assert.deepEqual(sections.map((x) => x.replace(/\s*\(\d+\)$/, '')), ['מטופלים', 'מאושפזים', 'לידים פתוחים'], 'three sources, one field, fixed order');
    assert.equal(await page.locator('.pkg-new .pkg-who-opt', { hasText: 'ליד סגור' }).count(), 0, 'a not-relevant lead is not offered');
    assert.match(await page.locator('.pkg-new .pkg-who-opt-roster').first().textContent(), /נועה מאושפזת.*מאושפז\/ת · רמות השבים/s, 'roster: name, phone, house');
    assert.match(await page.locator('.pkg-new .pkg-who-opt-lead').first().textContent(), /ליד פתוח.*ליד · חיצוני/s, 'lead: name, phone, source');
    await page.locator('.pkg-new .pkg-who-opt-roster').first().click();
    await page.locator('.pkg-new .pkg-who-picked[data-target="roster:id:dash-77"]').waitFor();
    await page.locator('.pkg-new .pkg-chip', { hasText: 'Core' }).first().click();
    await page.locator('.pkg-new .pkg-pick-quote', { hasText: 'מחיר ליחידה' }).waitFor();
    await page.locator('.pkg-new button', { hasText: 'הוספה להצעה' }).click();
    await page.locator('.pkg-new .pkg-item-row').first().waitFor();
    await page.locator('.pkg-create-btn').click();
    const rosterCard = page.locator('.pkg-card', { hasText: 'נועה מאושפזת' });
    await rosterCard.waitFor();
    const rosterRow = mine().find((r) => r.attachedType === 'roster');
    assert.equal(rosterRow.attachedId, 'id:dash-77'); assert.equal(rosterRow.patientPhone, '0501234567');
    assert.match(await rosterCard.locator('.pkg-terms-line').textContent(), /משויך למאושפז\/ת \(מזהה id:dash-77\)/);
    // the quote shows on the patient's row in «מסלול המשך»
    await page.click('.tab[data-view="continuation"]');
    const contRow = page.locator('.continuation-row', { hasText: 'נועה מאושפזת' });
    await contRow.waitFor();
    await contRow.locator('[data-caction="open-offer"]').waitFor();
    assert.match(await contRow.locator('[data-caction="open-offer"]').textContent(), /הצעה · טיוטה/);

    /* ---- 5. WhatsApp ----------------------------------------------------------------------- */
    await page.click('.tab[data-view="packages"]');
    await page.waitForSelector('.pkg-admin');
    // approve pricing → ready_to_send; no Oren number yet → inline hint that opens the settings
    await rosterCard.getByRole('button', { name: /אישור תמחור/ }).click();
    await rosterCard.locator('.pkg-st-ready_to_send').waitFor();
    assert.equal(await rosterCard.locator('a.pkg-wa-oren').count(), 0);
    assert.match(await rosterCard.locator('.pkg-wa-missing').textContent(), /מספר ה-WhatsApp של אורן לא הוגדר/);
    await rosterCard.locator('.pkg-open-settings').click();
    await page.waitForSelector('#settingsModal:not([hidden])');
    await page.fill('#settingsForm input[name="orenWhatsapp"]', '052-765-4321');
    await page.click('#settingsForm button[type="submit"]');
    await page.waitForSelector('#settingsModal[hidden]', { state: 'attached' });
    await page.locator('.pkg-tabs button', { hasText: 'רענון' }).click();
    const oren = rosterCard.locator('a.pkg-wa-oren'), patient = rosterCard.locator('a.pkg-wa-patient');
    await oren.waitFor();
    for (const a of [oren, patient]) { assert.equal(await a.getAttribute('target'), '_blank'); assert.equal(await a.getAttribute('rel'), 'noopener'); }
    assert.match(await oren.getAttribute('href'), /^https:\/\/wa\.me\/972527654321\?text=/);
    assert.match(await patient.getAttribute('href'), /^https:\/\/wa\.me\/972501234567\?text=/, 'the roster patient\'s phone');
    const text = decodeURIComponent((await patient.getAttribute('href')).split('text=')[1]);
    assert.match(text, /נועה מאושפזת/); assert.match(text, /EMDR — Core/); assert.match(text, /3,400 ₪ \(כולל מע״מ\)/); assert.match(text, /בתוקף עד/); assert.ok(!/אבחנה|תרופ|פסיכיאט/.test(text));
    // both links sit in the first screen of the card and the link itself is clickable
    const box = await oren.boundingBox(); assert.ok(box && box.width > 40 && box.height > 20);
    const popup = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await patient.click();
    const p2 = await popup; if (p2) await p2.close().catch(() => {});
    assert.equal(mine().find((r) => r.attachedType === 'roster').status, 'priced', 'opening WhatsApp changed nothing');
    // mark sent «to the patient»: kind + last four digits only
    await rosterCard.locator('.pkg-mark-sent-btn').click();
    await rosterCard.locator('.pkg-wa select').selectOption('patient');
    await rosterCard.locator('.pkg-wa input[aria-label="מועד מעקב אחרי השליחה"]').fill(todayPlus(0));
    await rosterCard.locator('.pkg-mark-sent-ok').click();
    await rosterCard.locator('.pkg-st-sent').waitFor();
    assert.equal(mine().find((r) => r.attachedType === 'roster').sentTo, 'patient:4567');
    assert.match(await rosterCard.locator('.pkg-terms-line').textContent(), /נשלחה .* למטופל\/ת \(…4567\)/);
    await noOverflow(page);

    /* ---- 3. delete / reset ----------------------------------------------------------------- */
    const clientQuote = page.locator('.pkg-card', { hasText: 'מטופל חבילה' });
    // reset: in-app confirm (no window.confirm — a dialog would hang the test), back to an empty draft
    page.on('dialog', (d) => { throw new Error('unexpected native dialog: ' + d.message()); });
    await clientQuote.locator('.pkg-reset-btn').click();
    await clientQuote.locator('.pkg-confirm').waitFor();
    assert.match(await clientQuote.locator('.pkg-confirm').textContent(), /לאפס את ההצעה של מטופל חבילה\?/);
    await clientQuote.locator('.pkg-confirm-cancel').click();
    assert.equal(await clientQuote.locator('.pkg-confirm').count(), 0, 'cancel closes without a change');
    assert.equal(mine().find((r) => r.attachedType === 'client').status, 'pending');
    await clientQuote.locator('.pkg-reset-btn').click();
    await clientQuote.locator('.pkg-confirm input').fill('להתחיל מחדש');
    await clientQuote.locator('.pkg-confirm-ok').click();
    await clientQuote.locator('.pkg-reset-note').waitFor();
    const resetRow = mine().find((r) => r.attachedType === 'client');
    assert.equal(resetRow.items, '[]'); assert.equal(resetRow.status, 'pending');
    assert.equal(JSON.parse(resetRow.adjustLog).at(-1).kind, 'reset');
    assert.equal(await clientQuote.locator('.pkg-redo-btn').count(), 1, 'offers a fresh quote for the same client');
    assert.equal(await clientQuote.getByRole('button', { name: /אישור תמחור/ }).count(), 0, 'an empty draft cannot be approved');
    // delete: hidden from the list, the client card and «היום שלי»; the row stays with its trail
    await clientQuote.locator('.pkg-delete-btn').click();
    await clientQuote.locator('.pkg-confirm').waitFor();
    assert.match(await clientQuote.locator('.pkg-confirm').textContent(), /למחוק את ההצעה של מטופל חבילה\?/);
    await clientQuote.locator('.pkg-confirm-ok').click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('.pkg-card')).some((c) => /מטופל חבילה/.test(c.textContent)));
    const delRow = f.sb.rows('PackageRequests').find((r) => r.id === resetRow.id);
    assert.equal(delRow.status, 'deleted'); assert.equal(JSON.parse(delRow.adjustLog).at(-1).kind, 'deleted'); assert.equal(JSON.parse(delRow.adjustLog).at(-1).by, 'ורד');
    await page.locator('.pkg-filters .pkg-chip', { hasText: /^הכל/ }).click();
    assert.equal(await page.locator('.pkg-card', { hasText: 'מטופל חבילה' }).count(), 0, 'not even under «הכל»');
    await page.click('.tab[data-view="clients"]');
    await page.locator('.client-card', { hasText: 'מטופל חבילה' }).waitFor();
    await page.waitForFunction(() => { const c = Array.from(document.querySelectorAll('.client-card')).find((x) => /מטופל חבילה/.test(x.textContent)); return c && !c.querySelector('[data-offer-open]'); });
    await page.click('.tab[data-view="dashboard"]');
    await page.locator('#myDay .md-sec-overdue_payments').waitFor();
    assert.equal(await page.locator('#myDay .md-row', { hasText: 'הצעת מחיר' }).filter({ hasText: 'מטופל חבילה' }).count(), 0, 'not in «היום שלי»');
    assert.equal(await page.locator('#myDay .md-row', { hasText: 'מעקב אחרי הצעת מחיר' }).filter({ hasText: 'נועה מאושפזת' }).count(), 1, 'the roster quote follow-up is there today');
    await noOverflow(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });
}
