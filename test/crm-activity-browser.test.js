'use strict';

// OP-CRM-3B + Dashboard-CRM parity (2026-11-21, CHANGELOG-crm-dashboard-parity.md) — real
// browser + public UI + server.js + Code.gs (dummy in-memory Sheets). ורד documents a call on a
// LEAD through «📞 תיעוד שיחה» (three kinds, none pre-chosen; «קשר הבא» with no default): one
// Activity event, one follow-up, the card shows «מה הלאה» + «שיחות אחרונות»; the call task closes
// only through the contact record; a double submit creates nothing twice. The PATIENT card
// carries the same block: «➕ משימה חדשה» (date + time), «שינוי מועד», «סיום». «ביטול תיעוד» is
// ורד's alone (button, Node 403, source). דנה sees the block but no collection kind. No browser
// dialog is ever opened. No production URL/credential/data.
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
const CLIENT = { id: 'fixture-c1', name: 'מטופל CRM', phone: '0500000032', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', location: 'רעננה הפרדס', startDate: '2026-10-05', assignedTo: 'ורד', updatedAt: '2026-10-30T07:00:00.000Z' };
const card = (page, name) => page.locator('#kanban .card').filter({ has: page.locator('.name', { hasText: name }) });
const clientCard = (page, name) => page.locator('#clientsList .client-card').filter({ has: page.locator('.client-name', { hasText: name }) });
const posted = (page, action) => page.waitForResponse((r) => r.url().endsWith('/api/sheets') && r.request().method() === 'POST' && r.request().postDataJSON().action === action);
const FAR = '2099-12-01';

async function fixture(t) {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    t.skip('no browser binary');
    return null;
  }
  const sb = sandbox([LEAD], [CLIENT]);
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
    // every task action is an in-app form now: a browser dialog is a regression
    page.on('dialog', (d) => { errors.push('dialog: ' + d.type() + ' ' + d.message()); d.dismiss(); });
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

test('browser: «תיעוד שיחה» on a lead — kind required, real date shown, follow-up in «מה הלאה»; the call closes only through the record; a double submit creates nothing twice', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('ורד');
  const c = card(page, LEAD.name);
  await c.locator('.crm-block').waitFor();
  assert.match(await c.locator('.crm-block').innerText(), /אין שיחות מתועדות עדיין/);
  assert.equal(await c.locator('.next-steps').count(), 0, 'no «מה הלאה» box without an open task');
  await c.locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  // nothing is pre-chosen: no kind, no «קשר הבא»
  assert.equal(await page.locator('#contactForm [name="direction"]:checked').count(), 0);
  assert.equal(await page.locator('#contactForm [name="next"]:checked').count(), 0);
  assert.equal(await page.inputValue('#contactForm [name="who"]'), 'ורד');
  // an empty save is refused in the browser; nothing travels
  await page.click('#contactSubmit');
  assert.match(await page.locator('#contactForm [data-err="direction"]').innerText(), /שיחה יוצאת, שיחה נכנסת או תיעוד שיחה/);
  assert.match(await page.locator('#contactForm [data-err="next"]').innerText(), /אין ברירת מחדל/);
  assert.equal(f.captured.filter((x) => x.payload.action === 'logContact').length, 0);
  // an incoming call does not offer «לא היה מענה»; switching back restores it and re-words the labels
  await page.check('#contactForm [name="direction"][value="in"]');
  let outcomes = await page.$$eval('#contactOutcome option', (os) => os.map((o) => o.value));
  assert.equal(outcomes.includes('no_answer'), false); assert.equal(outcomes.includes('bad_contact_details'), false);
  assert.equal(await page.locator('#contactForm [data-dir-text="withWhom"]').innerText(), 'מי התקשר/ה');
  await page.check('#contactForm [name="direction"][value="out"]');
  outcomes = await page.$$eval('#contactOutcome option', (os) => os.map((o) => o.value));
  assert.ok(outcomes.includes('no_answer'));
  assert.equal(await page.locator('#contactForm [data-dir-text="who"]').innerText(), 'מי ביצע');
  await page.selectOption('#contactChannel', 'whatsapp');
  await page.selectOption('#contactOutcome', 'call_back_later');
  await page.fill('#contactForm [name="withWhom"]', 'האמא');
  await page.fill('#contactForm [name="summary"]', 'ביקשה שנחזור אחרי החג');
  await page.check('#contactForm [name="next"][value="days"]');
  await page.fill('#contactForm [name="nextDays"]', '2');
  assert.match(await page.locator('#contactNextPreview').innerText(), /^בעוד 2 ימים — \d{2}\/\d{2}\/\d{4} \(.+\)$/, 'the actual date is shown before saving');
  const resp = posted(page, 'logContact');
  await page.click('#contactSubmit');
  const data = await (await resp).json();
  assert.equal(data.ok, true, JSON.stringify(data));
  assert.equal(data.created.source, 'contact');
  await page.waitForSelector('#contactModal[hidden]', { state: 'attached' });
  // sheet state
  const ev = f.sb.rows('Activity').filter((e) => e.kind === 'contact_logged');
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].detailsJson).direction, 'out');
  const tasks = f.sb.rows('Tasks');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].status, 'open'); assert.equal(tasks[0].assignee, 'ורד'); assert.equal(tasks[0].createdBy, 'ורד');
  assert.equal(tasks[0].title, 'לחזור — התבקשנו לחזור במועד'); assert.equal(tasks[0].kind, 'call');
  const sent = f.captured.find((x) => x.payload.action === 'logContact').payload;
  assert.equal(sent.user, 'ורד', 'actor comes from the proxy');
  assert.match(sent.submissionId, /^contact-/);
  assert.equal(sent.contact.direction, 'out');
  // the card: «מה הלאה» (what · when · who) and «שיחות אחרונות» with the kind chip
  await card(page, LEAD.name).locator('.crm-task').waitFor();
  const steps = await card(page, LEAD.name).locator('.next-steps').innerText();
  assert.match(steps, /מה הלאה/); assert.match(steps, /לחזור — התבקשנו לחזור במועד/); assert.match(steps, /בעוד 2 ימים/); assert.match(steps, /אחראי\/ת: ורד/);
  const recent = await card(page, LEAD.name).locator('.crm-recent').innerText();
  assert.match(recent, /שיחה יוצאת/); assert.match(recent, /ורד/); assert.match(recent, /התבקשנו לחזור במועד · ביקשה שנחזור/); assert.match(recent, /המשך: לחזור/);
  // a call has NO «סיום»: it closes only through «תיעוד שיחה», which opens as «שיחה יוצאת»
  const row = card(page, LEAD.name).locator('.crm-task');
  assert.equal(await row.locator('[data-crm="complete"]').count(), 0);
  await row.locator('[data-crm="contact"]').click();
  await page.waitForSelector('#contactModal:not([hidden])');
  assert.equal(await page.locator('#contactForm [name="direction"]:checked').inputValue(), 'out');
  assert.match(await page.locator('#contactTaskHint').innerText(), /המשימה: לחזור — התבקשנו לחזור במועד/);
  // «התקיימה שיחה — לא נדרש המשך» is itself the answer to «קשר הבא» (no typed explanation)
  await page.selectOption('#contactOutcome', 'spoke_no_follow_up');
  assert.equal(await page.locator('#contactForm [name="next"]:checked').inputValue(), 'none');
  const done = posted(page, 'logContact');
  await page.click('#contactSubmit');
  assert.equal((await (await done).json()).ok, true);
  await page.waitForFunction(() => !document.querySelector('#kanban .crm-task'));
  const closed = f.sb.rows('Tasks')[0];
  assert.equal(closed.status, 'done'); assert.equal(closed.doneBy, 'ורד'); assert.equal(closed.outcome, 'התקיימה שיחה — לא נדרש המשך');
  assert.equal(await card(page, LEAD.name).locator('.next-steps').count(), 0);
  // double submit: same form, same key -> replayed, nothing new
  await card(page, LEAD.name).locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  await page.check('#contactForm [name="direction"][value="note"]');
  await page.selectOption('#contactOutcome', 'no_answer');
  await page.check('#contactForm [name="next"][value="none"]');
  await page.fill('#contactForm [name="nextExplanation"]', 'ביקש שלא נחזור');
  const sid = await page.evaluate(() => { const f = document.getElementById('contactForm'); f.dataset.sid = 'contact-fixed-key'; return f.dataset.sid; });
  const r1 = posted(page, 'logContact');
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

test('browser: the PATIENT card carries the same block — «משימה חדשה» needs a date and a time, «שינוי מועד», «סיום»; «היום» is the team page', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('ורד');
  // «היום»: the tab and the heading are the team's, not a person's
  assert.equal(await page.locator('.tab[data-view="dashboard"]').innerText(), 'היום');
  await page.click('.tab[data-view="dashboard"]');
  await page.locator('#myDay .md-head').waitFor();
  const head = await page.locator('#myDay .md-head').innerText();
  assert.equal(head.split('\n')[0].trim(), 'היום'); assert.match(head, /כל הצוות/); assert.equal(/היום שלי/.test(head), false);
  await page.click('.tab[data-view="clients"]');
  const c = clientCard(page, CLIENT.name);
  await c.locator('.crm-block').waitFor();
  assert.equal(await c.locator('[data-crm="contact"]').first().innerText(), '📞 תיעוד שיחה');
  assert.equal(await c.locator('[data-crm="task"]').innerText(), '➕ משימה חדשה');
  await c.locator('[data-crm="task"]').click();
  await page.waitForSelector('#taskModal:not([hidden])');
  await page.selectOption('#taskKind', 'review');
  await page.fill('#taskForm [name="title"]', 'לברר אישור קופה');
  await page.fill('#taskForm [name="dueDate"]', FAR);
  // no time → refused in the browser, nothing travels
  await page.click('#taskSubmit');
  assert.equal(await page.locator('#taskForm [data-err="dueTime"]').innerText(), 'בחרי שעה');
  assert.equal(f.captured.filter((x) => x.payload.action === 'createTask').length, 0);
  await page.fill('#taskForm [name="dueTime"]', '09:30');
  const made = posted(page, 'createTask');
  await page.click('#taskSubmit');
  const created = await (await made).json();
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.task.clientId, CLIENT.id); assert.equal(created.task.leadId, ''); assert.equal(created.task.dueTime, '09:30');
  await page.waitForSelector('#taskModal[hidden]', { state: 'attached' });
  const row = clientCard(page, CLIENT.name).locator('.crm-task');
  await row.waitFor();
  assert.match(await clientCard(page, CLIENT.name).locator('.next-steps').innerText(), /לברר אישור קופה/);
  // «שינוי מועד»: a manual task is re-dated with no reason
  await row.locator('[data-crm="defer"]').click();
  await page.waitForSelector('#deferModal:not([hidden])');
  assert.equal(await page.locator('#deferReasonLabel').innerText(), 'סיבה', 'no * for a task that was not promised in a call');
  assert.equal(await page.inputValue('#deferForm [name="dueDate"]'), FAR);
  await page.fill('#deferForm [name="dueDate"]', '2099-12-02');
  const moved = posted(page, 'deferTask');
  await page.click('#deferSubmit');
  assert.equal((await (await moved).json()).ok, true);
  await page.waitForSelector('#deferModal[hidden]', { state: 'attached' });
  assert.equal(f.sb.rows('Tasks')[0].dueDate, '2099-12-02'); assert.equal(f.sb.rows('Tasks')[0].deferredFrom, FAR);
  // «סיום» (not a call): an in-app form, never a browser prompt
  await clientCard(page, CLIENT.name).locator('.crm-task [data-crm="complete"]').click();
  await page.waitForSelector('#taskDoneModal:not([hidden])');
  await page.fill('#taskDoneForm [name="outcome"]', 'האישור התקבל');
  const done = posted(page, 'completeTask');
  await page.click('#taskDoneSubmit');
  assert.equal((await (await done).json()).ok, true);
  await page.waitForFunction(() => !document.querySelector('#clientsList .crm-task'));
  const t0 = f.sb.rows('Tasks')[0];
  assert.equal(t0.status, 'done'); assert.equal(t0.outcome, 'האישור התקבל'); assert.equal(t0.doneBy, 'ורד');
  // «עוד…»: reassign, then cancel with a reason — on a second task
  await clientCard(page, CLIENT.name).locator('[data-crm="task"]').click();
  await page.waitForSelector('#taskModal:not([hidden])');
  await page.fill('#taskForm [name="title"]', 'לשלוח טופס');
  await page.fill('#taskForm [name="dueDate"]', FAR); await page.fill('#taskForm [name="dueTime"]', '10:00');
  const made2 = posted(page, 'createTask');
  await page.click('#taskSubmit'); await made2;
  await clientCard(page, CLIENT.name).locator('.crm-task [data-crm="more"]').click();
  await page.waitForSelector('#taskMoreModal:not([hidden])');
  await page.selectOption('#taskReassignAssignee', 'דנה');
  const re = posted(page, 'reassignTask');
  await page.click('#taskReassignSubmit');
  assert.equal((await (await re).json()).task.assignee, 'דנה');
  await page.waitForSelector('#taskMoreModal[hidden]', { state: 'attached' });
  await clientCard(page, CLIENT.name).locator('.crm-task [data-crm="more"]').click();
  await page.waitForSelector('#taskMoreModal:not([hidden])');
  await page.click('#taskWithdrawSubmit');
  assert.match(await page.locator('#taskWithdrawForm [data-err="reason"]').innerText(), /סיבה/);
  await page.fill('#taskWithdrawForm [name="reason"]', 'נוצר בטעות');
  const wd = posted(page, 'withdrawTask');
  await page.click('#taskWithdrawSubmit');
  assert.equal((await (await wd).json()).task.status, 'cancelled');
  await page.waitForFunction(() => !document.querySelector('#clientsList .crm-task'));
  assert.deepEqual(f.errors, []);
});

test('browser: «ביטול תיעוד» — ורד voids a record entered by mistake (its open follow-up goes with it); דנה has no button and the proxy answers 403', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('ורד');
  await page.click('.tab[data-view="clients"]');
  const c = clientCard(page, CLIENT.name);
  await c.locator('.crm-block').waitFor();
  await c.locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  await page.check('#contactForm [name="direction"][value="in"]');
  await page.selectOption('#contactOutcome', 'spoke_follow_up');
  await page.fill('#contactForm [name="summary"]', '<b>הוזן פעמיים</b>');
  await page.check('#contactForm [name="next"][value="d1"]');
  const saved = posted(page, 'logContact');
  await page.click('#contactSubmit');
  const rec = await (await saved).json();
  assert.equal(rec.ok, true, JSON.stringify(rec));
  await page.waitForSelector('#contactModal[hidden]', { state: 'attached' });
  const li = clientCard(page, CLIENT.name).locator('.crm-recent li');
  await li.waitFor();
  assert.match(await li.innerText(), /שיחה נכנסת/);
  assert.equal(await clientCard(page, CLIENT.name).locator('.crm-recent b').count(), 0, 'stored text never becomes markup');
  assert.match(await li.innerText(), /<b>הוזן פעמיים<\/b>/);
  // void it
  await li.locator('[data-crm="void"]').click();
  await page.waitForSelector('#voidContactModal:not([hidden])');
  assert.match(await page.locator('#voidContactNextNote').innerText(), /תבוטל יחד איתו/);
  await page.click('#voidContactSubmit');
  assert.equal(await page.locator('#voidContactForm [data-err="reason"]').innerText(), 'יש לציין סיבה קצרה לביטול');
  assert.equal(f.captured.filter((x) => x.payload.action === 'voidContact').length, 0);
  await page.fill('#voidContactForm [name="reason"]', 'הוזן פעמיים');
  const voided = posted(page, 'voidContact');
  await page.click('#voidContactSubmit');
  const v = await (await voided).json();
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.voided.eventId, rec.event.eventId); assert.equal(v.cancelledTask.status, 'cancelled');
  await page.waitForSelector('#voidContactModal[hidden]', { state: 'attached' });
  await page.waitForFunction(() => !document.querySelector('#clientsList .crm-recent li'));
  const block = clientCard(page, CLIENT.name).locator('.crm-block');
  assert.match(await block.innerText(), /אין שיחות מתועדות עדיין/);
  assert.equal(await block.locator('.next-steps').count(), 0, 'the follow-up left «מה הלאה» with the record');
  await block.locator('.crm-history summary').click();
  assert.match(await block.locator('.crm-history').innerText(), /בוטל/);
  assert.equal(f.sb.rows('Activity').filter((e) => e.kind === 'contact_logged').length, 1, 'the record row is still there');
  // a second record, for דנה to look at
  await clientCard(page, CLIENT.name).locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  await page.check('#contactForm [name="direction"][value="note"]');
  await page.selectOption('#contactOutcome', 'spoke_no_follow_up');
  const s2 = posted(page, 'logContact');
  await page.click('#contactSubmit');
  const rec2 = await (await s2).json();
  assert.equal(rec2.ok, true);
  assert.deepEqual(f.errors, []);
  // דנה: no «ביטול תיעוד» button, and a hand-made request is refused by the proxy before the source
  const dana = await f.login('דנה');
  await dana.click('.tab[data-view="clients"]');
  const dc = clientCard(dana, CLIENT.name);
  await dc.locator('.crm-recent li').waitFor();
  assert.equal(await dc.locator('[data-crm="void"]').count(), 0);
  const before = f.captured.length;
  const refused = await dana.evaluate(async (eventId) => {
    const r = await fetch('/api/sheets', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'voidContact', eventId, reason: 'ניסיון' }) });
    return { status: r.status, body: await r.json() };
  }, rec2.event.eventId);
  assert.equal(refused.status, 403); assert.equal(refused.body.error, 'contact_void_vered_only');
  assert.equal(f.captured.length, before, 'nothing reached the source');
  assert.equal(f.sb.rows('Activity').filter((e) => e.kind === 'contact_voided').length, 1);
});

test('browser: דנה sees the activity block and can add a task; the task form offers no collection kind', skipOpt, async (t) => {
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
  await page.fill('#taskForm [name="dueDate"]', FAR);
  await page.fill('#taskForm [name="dueTime"]', '11:15');
  const resp = posted(page, 'createTask');
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

test('browser: a stale submission key never follows the form to the next opening (contact + task); the contact form fits a phone', skipOpt, async (t) => {
  const f = await fixture(t); if (!f) return;
  const page = await f.login('ורד');
  const c = card(page, LEAD.name);
  await c.locator('.crm-block').waitFor();
  // 1st opening: a save "fails" from the user's point of view (we only plant the key the
  // form would keep after a lost response), then the modal is cancelled.
  await c.locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  await page.evaluate(() => { document.getElementById('contactForm').dataset.sid = 'contact-stale-key'; });
  await page.click('#contactModal [data-close]');
  await page.waitForSelector('#contactModal[hidden]', { state: 'attached' });
  // 2nd opening (another contact): no key carried over, and the submission mints a new one
  await c.locator('[data-crm="contact"]').first().click();
  await page.waitForSelector('#contactModal:not([hidden])');
  assert.equal(await page.evaluate(() => document.getElementById('contactForm').dataset.sid), undefined, 'contact form key cleared on open');
  // 360px and 1280px: the open form never scrolls sideways
  for (const w of [360, 1280]) {
    await page.setViewportSize({ width: w, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'no horizontal scroll at ' + w + 'px');
    const box = await page.locator('#contactModal .modal-card').boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= w + 1, 'the form fits ' + w + 'px');
  }
  await page.check('#contactForm [name="direction"][value="out"]');
  await page.selectOption('#contactOutcome', 'no_answer');
  await page.check('#contactForm [name="next"][value="none"]');
  await page.fill('#contactForm [name="nextExplanation"]', 'ננסה מחר');
  const r1 = posted(page, 'logContact');
  await page.click('#contactSubmit');
  const d1 = await (await r1).json();
  assert.equal(d1.ok, true); assert.notEqual(d1.replayed, true);
  const sent = f.captured.filter((x) => x.payload.action === 'logContact').map((x) => x.payload.submissionId);
  assert.equal(sent.length, 1); assert.notEqual(sent[0], 'contact-stale-key'); assert.match(sent[0], /^contact-/);
  await page.waitForSelector('#contactModal[hidden]', { state: 'attached' });
  // same for the task form
  await card(page, LEAD.name).locator('[data-crm="task"]').click();
  await page.waitForSelector('#taskModal:not([hidden])');
  await page.evaluate(() => { document.getElementById('taskForm').dataset.sid = 'task-stale-key'; });
  await page.click('#taskModal [data-close]');
  await page.waitForSelector('#taskModal[hidden]', { state: 'attached' });
  await card(page, LEAD.name).locator('[data-crm="task"]').click();
  await page.waitForSelector('#taskModal:not([hidden])');
  assert.equal(await page.evaluate(() => document.getElementById('taskForm').dataset.sid), undefined, 'task form key cleared on open');
  await page.fill('#taskForm [name="title"]', 'לשלוח טופס');
  await page.fill('#taskForm [name="dueDate"]', FAR);
  await page.fill('#taskForm [name="dueTime"]', '08:00');
  const r2 = posted(page, 'createTask');
  await page.click('#taskSubmit');
  const d2 = await (await r2).json();
  assert.equal(d2.ok, true); assert.equal(d2.created, true);
  const tsent = f.captured.filter((x) => x.payload.action === 'createTask').map((x) => x.payload.submissionId);
  assert.equal(tsent.length, 1); assert.notEqual(tsent[0], 'task-stale-key'); assert.match(tsent[0], /^task-/);
  assert.equal(f.sb.rows('Tasks').length, 1);
  assert.deepEqual(f.errors, []);
});
