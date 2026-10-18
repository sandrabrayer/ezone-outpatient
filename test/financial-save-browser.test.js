'use strict';

// Real browser + UI + server + Code.gs, with controlled financial failures.
// Only Google runtime services are replaced with dummy, in-memory Sheets.
// No production URL, credential, data or external browser request is used.
process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { failWrite } = require('../test-support/renewal-journal-fixture.cjs');

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
const card = (page, name) => page.locator('#kanban .card').filter({ has: page.locator('.name', { hasText: name }) });

async function fixture(t, options = {}) {
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.EZONE_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox'] }); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const client = { id: 'fixture-client', name: 'מטופל בדיקה', phone: '0500000003',
    serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', location: 'רעננה הפרדס',
    status: 'פעיל', pricePerSession: 500, startDate: '2026-09-01', billingDay: 1,
    nextBillingDate: '2026-10-01', paymentDate: '2026-09-01',
    updatedAt: '2026-10-01T00:00:00.000Z' };
  const sb = sandbox([{ ...A, stage: 'תוכנית טיפול' }], [client]);
  const faults = { payment: options.payment || '', remove: false, renewal: options.renewal || '' };
  if (faults.renewal === 'client_done') failWrite(sb, 'FinancialOps', 'payment_writing', 'before');
  if (faults.renewal === 'ambiguous') failWrite(sb, 'FinancialOps', 'payment_writing', 'after');
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
      if (payload.action === 'getRenewalState' && faults.renewal === 'source_unavailable') result = { ok: false, error: 'unknown_action' };
      else if (payload.action === 'savePayment' && faults.payment === 'reject') result = { ok: false, error: 'busy' };
      else if (payload.action === 'removePayment' && faults.remove) result = { ok: false, error: 'busy' };
      else {
        result = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(payload) } }).getContent());
        if ((payload.action === 'reserveRenewal' && faults.renewal === 'reserve_lost') ||
            (payload.action === 'applyRenewal' && faults.renewal === 'apply_lost')) {
          result = { ok: false, error: 'fixture_response_lost' }; faults.renewal = '';
        }
        if (payload.action === 'savePayment' && faults.payment === 'lost') result = { ok: false, error: 'fixture_response_lost' };
      }
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
    await page.addInitScript(() => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : ['2026-10-18T09:00:00Z'])); }
        static now() { return new RealDate('2026-10-18T09:00:00Z').getTime(); }
      };
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pinScreen:not([hidden])');
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.locator('#userButtons .user-btn').getByText(user, { exact: true }).click();
    await page.waitForSelector('#app:not([hidden])');
    await page.click('.tab[data-view="clients"]');
    await page.locator('#clientsList .client-card').first().waitFor();
    return page;
  }
  return { sb, captured, errors, login, faults, client };
}

const clientCard = (page, name = 'מטופל בדיקה') => page.locator('#clientsList .client-card').filter({ has: page.locator('.client-name', { hasText: name }) });
async function submitPayment(page, selector) {
  const response = page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST' && r.request().postDataJSON().action === 'savePayment');
  await page.click(selector);
  await response;
  await page.locator('#financialSaveWarning:not([hidden])').waitFor();
}
async function checkWarning(page) {
  assert.match(await page.textContent('#financialSaveWarningText'), /לא התקבל אישור לרישום התשלום/);
  assert.equal(await page.locator('#financialSaveWarning').evaluate((el) => getComputedStyle(el).direction), 'rtl');
}
for (const payment of ['reject', 'lost']) {
  test(`browser: additional charge ${payment}, no false paid badge; reload reconciles actual source`, skipOpt, async (t) => {
    const fx = await fixture(t, { payment }); if (!fx) return;
    const page = await fx.login('ורד');
    await clientCard(page).getByRole('button', { name: '+ הוסף טיפול', exact: true }).click();
    await page.fill('#addChargeForm [name="description"]', 'טיפול נוסף לבדיקה');
    await page.fill('#addChargeForm [name="amount"]', '500');
    await page.check('#addChargeForm [name="chargePaid"]');
    await submitPayment(page, '#addChargeSubmit');
    await checkWarning(page);
    assert.equal(fx.sb.rows('ClientCharges').length, 1);
    assert.equal(fx.sb.rows('Payments').length, payment === 'lost' ? 1 : 0);
    assert.equal(await clientCard(page).locator('.charge-status').textContent(), 'לא שולם');
    assert.equal(await page.isHidden('#addChargeModal'), true);
    if (process.env.EZONE_FINANCIAL_SCREENSHOT && payment === 'reject') {
      await page.screenshot({ path: process.env.EZONE_FINANCIAL_SCREENSHOT, fullPage: true });
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-view="clients"]');
    await clientCard(page).locator('.charge-status').waitFor();
    assert.equal(await clientCard(page).locator('.charge-status').textContent(), payment === 'lost' ? 'שולם' : 'לא שולם');
    assert.equal(fx.captured.filter((r) => r.payload.action === 'savePayment').length, 1, 'no automatic retry');
    assert.deepEqual(fx.errors, []);
  });
}
for (const flow of ['direct', 'activate']) {
  test(`browser: ${flow} payment fails; saved patient survives without a paid chip even after reload`, skipOpt, async (t) => {
    const fx = await fixture(t, { payment: 'reject' }); if (!fx) return;
    const page = await fx.login('ורד');
    if (flow === 'direct') {
      await page.click('#addClientBtn');
      await page.fill('#directClientForm [name="name"]', 'חדש לבדיקה');
      await page.fill('#directClientForm [name="phone"]', '0500000004');
      await page.locator('#directClientForm [data-group="serviceType"] input[type="checkbox"]').first().check();
      await page.selectOption('#directClientForm [name="location"]', A.location);
      await page.selectOption('#directClientForm [name="house_of_origin"]', 'raanana');
      await page.fill('#directClientForm [name="monthlyAmount"]', '500');
      await page.locator('#directClientForm [data-host="directSessions"] input[type="number"]').first().fill('1');
    } else {
      await page.click('.tab[data-view="leads"]');
      await card(page, A.name).getByRole('button', { name: '← הפוך למטופל פעיל', exact: true }).click();
      await page.locator('#activateForm [data-host="activateSessions"] input[type="number"]').first().fill('1');
      await page.fill('#activateForm [name="pricePerSession"]', '500');
    }
    const form = flow === 'direct' ? '#directClientForm' : '#activateForm';
    await page.fill(form + ' [name="startDate"]', '2026-10-01');
    await page.selectOption(form + ' [name="paymentStatus"]', 'paid');
    await page.fill(form + ' [name="paymentDate"]', '2026-10-16');
    await submitPayment(page, flow === 'direct' ? '#directClientSubmit' : '#activateSubmit');
    await checkWarning(page);
    const name = flow === 'direct' ? 'חדש לבדיקה' : A.name;
    await clientCard(page, name).locator('.chip-payment-review').waitFor();
    assert.equal(await clientCard(page, name).locator('.chip-paid').count(), 0);
    assert.equal(fx.sb.rows('Clients').length, 2);
    assert.equal(fx.sb.rows('Payments').length, 0);
    if (flow === 'activate') assert.equal(fx.sb.rows('Leads').length, 0);
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-view="clients"]');
    await clientCard(page, name).locator('.chip-payment-review').waitFor();
    assert.deepEqual(fx.errors, []);
  });
}
for (const flow of ['edit']) {
  test(`browser: ${flow} stops after a real stale-client refusal; no payment attempt`, skipOpt, async (t) => {
    const fx = await fixture(t); if (!fx) return;
    const page = await fx.login('ורד');
    // A second writer changes the sheet after this browser loaded its stamp.
    const current = fx.sb.rows('Clients')[0];
    assert.equal(fx.sb.save(fx.sb.rows('Leads'), [{ ...current, notes: 'second writer' }]).ok, true);
    await clientCard(page).getByRole('button', { name: flow === 'renew' ? 'חידוש ותשלום' : 'עריכה', exact: true }).click();
    if (flow === 'renew') await page.fill('#renewForm [name="renewAmount"]', '650');
    else {
      await page.selectOption('#editClientForm [name="paymentStatus"]', 'paid');
      await page.fill('#editClientForm [name="paymentDate"]', '2026-10-16');
    }
    await page.click(flow === 'renew' ? '#renewSubmit' : '#editClientSubmit');
    await page.locator('#conflictBanner:not([hidden])').waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(fx.captured.filter((r) => r.payload.action === 'savePayment').length, 0);
    assert.equal(fx.sb.rows('Payments').length, 0);
    assert.equal(fx.sb.rows('Clients')[0].nextBillingDate, '2026-10-01');
    assert.deepEqual(fx.errors, []);
  });
}
test('browser: successful renewal retains amount, backdated paid date and billing cycle', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  const page = await fx.login('ורד');
  await clientCard(page).getByRole('button', { name: 'חידוש ותשלום', exact: true }).click();
  await page.fill('#renewForm [name="renewAmount"]', '650');
  await page.fill('#renewForm [name="renewDate"]', '2026-10-16');
  await page.click('#renewSubmit');
  await page.getByRole('button', {name:'אישור וסגירה',exact:true}).waitFor();
  assert.equal(fx.sb.rows('FinancialOps')[0].state,'done');
  await page.click('#renewResume');
  await page.waitForSelector('#renewModal', { state: 'hidden' });
  assert.equal(fx.sb.rows('FinancialOps')[0].state,'acknowledged');
  await clientCard(page).locator('.chip-paid').waitFor();
  const p = fx.sb.rows('Payments')[0];
  assert.equal(p.id, 'pay::fixture-client::base::2026-10');
  assert.equal(p.paymentDate, '2026-10-16');
  assert.equal(Number(p.amountPaid), 650);
  assert.equal(fx.sb.rows('Clients')[0].nextBillingDate, '2026-11-01');
  assert.equal(await page.isHidden('#financialSaveWarning'), true);
  assert.deepEqual(fx.errors, []);
});
test('browser: legacy paid row still confirms its cycle; no date or amount rewrite', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  fx.sb.seed('Clients', fx.sb.ctx.CLIENTS_HEADERS, [{ ...fx.client, nextBillingDate: '2026-11-01' }]);
  fx.sb.seed('Payments', fx.sb.ctx.PAYMENTS_HEADERS, [{ id: 'pay::fixture-client::2026-10', clientId: 'fixture-client',
    clientName: fx.client.name, billingType: 'monthly', dueDate: '2026-10-01', amountDue: 500, amountPaid: 500,
    status: 'paid', paymentDate: '2026-10-02' }]);
  const page = await fx.login('ורד');
  await clientCard(page).locator('.chip-paid').waitFor();
  assert.equal(await clientCard(page).locator('.chip-payment-review').count(), 0);
  assert.equal(fx.captured.filter((r) => ['saveAll', 'savePayment'].includes(r.payload.action)).length, 0);
  assert.equal(fx.sb.rows('Payments')[0].id, 'pay::fixture-client::2026-10');
  assert.deepEqual(fx.errors, []);
});

test('browser: recorded two-cycle prepayment stays paid without invoking a wrong-month quick toggle', skipOpt, async (t) => {
  const fx = await fixture(t); if (!fx) return;
  fx.sb.seed('Clients', fx.sb.ctx.CLIENTS_HEADERS, [{ ...fx.client, nextBillingDate: '2026-11-01' }]);
  fx.sb.seed('Payments', fx.sb.ctx.PAYMENTS_HEADERS, [{ id: 'pay::fixture-client::base::2026-09', clientId: 'fixture-client',
    clientName: fx.client.name, billingType: 'monthly', dueDate: '2026-09-01', amountDue: 1000, amountPaid: 1000,
    status: 'paid', paymentDate: '2026-09-01', coverageStart: '2026-09-01', coverageEnd: '2026-10-31' }]);
  const page = await fx.login('ורד');
  await clientCard(page).locator('.chip-paid').waitFor();
  assert.equal(await clientCard(page).locator('.chip-payment-review').count(), 0);
  assert.equal(await clientCard(page).locator('.month-pay-btn').count(), 0, 'custom row is edited in billing, not a guessed cycle toggle');
  assert.match(await clientCard(page).locator('.chip-paid').textContent(), /01\/11/);
  assert.equal(fx.captured.filter((r) => ['saveAll', 'savePayment'].includes(r.payload.action)).length, 0);
  assert.deepEqual(fx.errors, []);
});

async function openRenew(page) {
  await clientCard(page).getByRole('button',{name:'חידוש ותשלום',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#renewSubmit').disabled || !document.querySelector('#renewRecovery').hidden);
}
for(const renewal of ['client_done','apply_lost','reserve_lost']) {
  test('browser: '+renewal+' rediscovers the original renewal from another device and never bills the next cycle', skipOpt, async t=>{
    const fx=await fixture(t,{renewal});if(!fx)return;
    const first=await fx.login('ורד');await openRenew(first);
    await first.fill('#renewForm [name="renewAmount"]','650');
    await first.fill('#renewForm [name="renewDate"]','2026-10-16');
    // Two submit events in one turn must still reserve once.
    await first.evaluate(()=>{const f=document.querySelector('#renewForm');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await first.locator('#renewRecovery:not([hidden])').waitFor().catch(async e=>{t.diagnostic(JSON.stringify({calls:fx.captured.map(r=>[r.payload.action,r.result.error,r.result.operation?.state]),ui:await first.locator('#renewClientName').textContent(),errors:fx.errors}));throw e;});
    assert.equal(fx.captured.filter(r=>r.payload.action==='reserveRenewal').length,1);
    const opId=fx.sb.rows('FinancialOps')[0].id;
    assert.equal(fx.sb.rows('FinancialOps')[0].cycleDate,'2026-10-01');
    const second=await fx.login('ירדן');await openRenew(second);
    assert.match(await second.locator('#renewRecoveryText').textContent(),/650/);
    assert.equal(await second.isHidden('#renewForm'),true);
    if(renewal!=='apply_lost')await second.click('#renewResume');
    await second.getByRole('button',{name:'אישור וסגירה',exact:true}).waitFor();
    assert.equal(fx.sb.rows('FinancialOps').length,1);
    assert.equal(fx.sb.rows('FinancialOps')[0].id,opId);
    assert.equal(fx.sb.rows('Payments').length,1);
    assert.equal(fx.sb.rows('Payments')[0].paymentDate,'2026-10-16');
    assert.equal(fx.sb.rows('Clients')[0].nextBillingDate,'2026-11-01');
    if(process.env.EZONE_FINANCIAL_SCREENSHOT && renewal==='client_done'){
      await second.screenshot({path:process.env.EZONE_FINANCIAL_SCREENSHOT,fullPage:true});
      await second.setViewportSize({width:390,height:844});
      await second.screenshot({path:process.env.EZONE_FINANCIAL_SCREENSHOT.replace('.png','-mobile.png'),fullPage:true});
      assert.equal(await second.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await second.click('#renewResume');await second.waitForSelector('#renewModal',{state:'hidden'});
    assert.equal(fx.sb.rows('FinancialOps')[0].state,'acknowledged');
    assert.equal(fx.captured.filter(r=>r.payload.action==='savePayment').length,0);
    assert.deepEqual(fx.errors,[]);
  });
}
test('browser: ambiguous missing payment requires manual review; explicit closure records signed user and no financial write',skipOpt,async t=>{
  const fx=await fixture(t,{renewal:'ambiguous'});if(!fx)return;
  const page=await fx.login('ורד');await openRenew(page);await page.click('#renewSubmit');
  await page.locator('#renewRecovery:not([hidden])').waitFor();
  await page.click('#renewResume');await page.locator('#renewReviewResolve:not([hidden])').waitFor();
  assert.equal(await page.isDisabled('#renewResume'),true);
  assert.equal(fx.sb.rows('FinancialOps')[0].state,'review');
  assert.equal(fx.sb.rows('Payments').length,0);
  const clientBefore=JSON.stringify(fx.sb.rows('Clients'));
  page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept('נבדק: התשלום חסר ונדרש תיקון בגבייה'):dialog.accept());
  await page.click('#renewReviewResolve');await page.waitForSelector('#renewModal',{state:'hidden'});
  assert.equal(fx.sb.rows('FinancialOps')[0].state,'reviewed');
  assert.equal(fx.sb.rows('FinancialOps')[0].updatedBy,'ורד');
  assert.equal(JSON.stringify(fx.sb.rows('Clients')),clientBefore);assert.equal(fx.sb.rows('Payments').length,0);
  await clientCard(page).locator('.chip-payment-review').waitFor();
  assert.equal(await clientCard(page).locator('.chip-paid').count(),0);
  assert.deepEqual(fx.errors,[]);
});
test('browser: source protocol unavailable keeps renewal disabled with no legacy write fallback',skipOpt,async t=>{
  const fx=await fixture(t,{renewal:'source_unavailable'});if(!fx)return;
  const page=await fx.login('ורד');await clientCard(page).getByRole('button',{name:'חידוש ותשלום',exact:true}).click();
  await page.getByText('לא ניתן לאמת את מצב החידוש.',{exact:false}).waitFor();
  assert.equal(await page.isDisabled('#renewSubmit'),true);
  assert.equal(await page.isHidden('#renewMarkPaid'),true);
  assert.equal(fx.captured.filter(r=>['saveAll','savePayment','reserveRenewal'].includes(r.payload.action)).length,0);
  assert.deepEqual(fx.errors,[]);
});
test('browser: stale source after opening refuses reservation and never attempts a payment',skipOpt,async t=>{
  const fx=await fixture(t);if(!fx)return;const page=await fx.login('ורד');await openRenew(page);
  const current=fx.sb.rows('Clients')[0];assert.equal(fx.sb.save(fx.sb.rows('Leads'),[{...current,notes:'other writer'}]).ok,true);
  await page.fill('#renewForm [name="renewAmount"]','650');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/sheets')&&r.request().method()==='POST'&&r.request().postDataJSON().action==='reserveRenewal');
  await page.click('#renewSubmit');await response;
  await page.waitForFunction(()=>!document.querySelector('#renewSubmit').disabled);
  assert.equal(fx.sb.rows('FinancialOps').length,0);assert.equal(fx.sb.rows('Payments').length,0);
  assert.equal(fx.sb.rows('Clients')[0].nextBillingDate,'2026-10-01');
  assert.equal(fx.captured.filter(r=>['applyRenewal','savePayment'].includes(r.payload.action)).length,0);
  assert.deepEqual(fx.errors,[]);
});
test('browser: prepared request may be cancelled without any client or payment effect',skipOpt,async t=>{
  const fx=await fixture(t,{renewal:'reserve_lost'});if(!fx)return;const page=await fx.login('ורד');await openRenew(page);
  await page.click('#renewSubmit');await page.locator('#renewCancelIntent:not([hidden])').waitFor();
  await page.click('#renewCancelIntent');await page.waitForSelector('#renewModal',{state:'hidden'});
  assert.equal(fx.sb.rows('FinancialOps')[0].state,'cancelled');
  assert.equal(fx.sb.rows('Clients')[0].nextBillingDate,'2026-10-01');assert.equal(fx.sb.rows('Payments').length,0);
  assert.deepEqual(fx.errors,[]);
});
