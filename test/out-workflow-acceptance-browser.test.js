'use strict';

// Cross-stage OUT acceptance. THR's scheduling/report-approval UI is explicitly
// outside this fixture: its approved report is synthetic input to the real OUT receiver.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, today, THERAPIST, sourceAction, browserAvailable, required } = require('../test-support/out-workflow-fixture.cjs');
const opt = { skip: !browserAvailable && !required ? 'Playwright not installed' : false, timeout: 120000 };
const NAME = 'מטופלת מסלול בדיקה', PHONE = '0500000079';
const leadCard = page => page.locator('#kanban .card').filter({ has: page.locator('.name', { hasText: NAME }) });
const clientCard = page => page.locator('#clientsList .client-card').filter({ has: page.locator('.client-name', { hasText: NAME }) });
const sampleClient = { id: 'workflow-client', name: NAME, phone: PHONE, fromLead: 'workflow-lead', status: 'פעיל',
  serviceType: 'פרטני CBT', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני CBT":1}',
  pricePerSession: 1200, billingType: 'monthly', billingDay: 1, nextBillingDate: '2026-11-01',
  startDate: '2026-11-01', assignedTo: 'ורד', paymentStatus: 'unpaid' };

test('OUT journey: inquiry/contact/meeting → admission → original referral and plan → scheduled outcome → renewal → discharge survives reload', opt, async t => {
  const f = await fixture(t); if (!f) return;
  const { page, errors } = await f.open();
  await page.click('.tab[data-view="leads"]');
  await page.click('#addLeadBtn');
  await page.fill('#leadForm [name="name"]', NAME);
  await page.fill('#leadForm [name="phone"]', PHONE);
  await page.locator('#leadForm [data-group="serviceType"] input[type="checkbox"]').first().check();
  await page.selectOption('#leadForm [name="location"]', 'רעננה הפרדס');
  await page.selectOption('#leadForm [name="house_of_origin"]', 'external');
  await page.selectOption('#leadForm [name="assignedTo"]', 'ורד');
  await sourceAction(page, 'saveAll', () => page.click('#leadFormSubmit'));
  await leadCard(page).waitFor();
  const lead = f.sb.rows('Leads')[0];
  assert.ok(lead.id);
  await leadCard(page).locator('[data-crm="contact"]').first().click();
  await page.selectOption('#contactOutcome', 'meeting_set');
  await page.fill('#contactForm [name="summary"]', 'תועדה פנייה ראשונה ונקבעה היכרות');
  await page.check('#contactForm [name="nextMode"][value="none"]');
  await page.fill('#contactForm [name="nextExplanation"]', 'ההיכרות נקבעה בכרטיס');
  await sourceAction(page, 'logContact', () => page.click('#contactSubmit'));
  await page.waitForSelector('#contactModal', { state: 'hidden' });
  await sourceAction(page, 'saveAll', () => leadCard(page).getByRole('button', { name: /שלב הבא: שיחת היכרות/ }).click());
  await sourceAction(page, 'saveAll', async () => {
    const date = leadCard(page).locator('input[type="datetime-local"]');
    await date.fill(today() + 'T10:30');
    await date.press('Tab');
  });
  assert.equal(f.sb.rows('Leads')[0].introDateTime, today() + 'T10:30');
  await leadCard(page).getByRole('button', { name: /שלב הבא: תוכנית טיפול/ }).click();
  await page.locator('#agreementForm [data-host="agreementSessions"] input[type="number"]').first().fill('1');
  await page.fill('#agreementForm [name="pricePerSession"]', '1200');
  await page.selectOption('#agreementForm [name="paymentStatus"]', 'unpaid');
  await sourceAction(page, 'saveAll', () => page.locator('#agreementForm button[type="submit"]').click());
  await leadCard(page).getByRole('button', { name: '← הפוך למטופל פעיל', exact: true }).click();
  await page.locator('#activateForm [data-host="activateSessions"] input[type="number"]').first().fill('1');
  await page.fill('#activateForm [name="pricePerSession"]', '1200');
  await page.fill('#activateForm [name="startDate"]', today());
  await page.selectOption('#activateForm [name="paymentStatus"]', 'unpaid');
  await sourceAction(page, 'saveAll', () => page.click('#activateSubmit'));
  const client = f.sb.rows('Clients')[0];
  assert.equal(client.fromLead, lead.id); assert.equal(client.assignedTo, 'ורד');
  assert.equal(f.sb.rows('Leads').length, 0, 'actual conversion removes the original lead');
  assert.equal(f.sb.rows('Payments').length, 0, 'unpaid admission creates no paid receipt');
  const status = f.handoff(lead.id);
  assert.equal(status.ok, true); assert.equal(status.results.length, 1, JSON.stringify(status));
  assert.equal(status.results[0].outpatientId, client.id);
  assert.equal(status.results[0].entity, 'client');
  assert.equal(status.results[0].state, 'active');
  const plans = f.plans();
  assert.equal(plans.ok, true);
  const plan = plans.clients.find(p => p.clientId === client.id);
  assert.ok(plan, JSON.stringify(plans)); assert.equal(plan.phone, PHONE);
  for (const key of ['pricePerSession', 'payerPhone', 'paymentStatus', 'paymentDate']) assert.equal(key in plan, false, key);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="clients"]');
  const card = clientCard(page); await card.waitFor();
  assert.match(await card.locator('.crm-block').innerText(), /תועדה פנייה ראשונה/);

  // OUT's own concrete scheduling flow; catalog, durable charge and row are actual source code.
  await card.locator('.cc-ots-btn').click();
  await page.locator('#otsForm select[name="catalogKey"] option[value="cbt_single"]').waitFor({ state: 'attached' });
  await page.selectOption('#otsForm [name="catalogKey"]', 'cbt_single');
  await page.selectOption('#otsForm [name="therapist"]', THERAPIST);
  await page.fill('#otsForm [name="date"]', today());
  await page.fill('#otsForm [name="time"]', '14:00');
  await page.click('#otsSubmit');
  await page.waitForSelector('#otsModal', { state: 'hidden' });
  await card.locator('.ots-row').waitFor();
  const session = f.sb.rows('OneTimeSessions')[0];
  assert.equal(session.clientId, client.id); assert.equal(f.sb.rows('ClientCharges').length, 1);
  const report = f.outcome({ sessionId: 'workflow-approved-report', oneTimeSessionId: session.id,
    phone: PHONE, therapist: THERAPIST, clinicalTreatmentType: 'פרטני CBT', date: today(), outcome: 'happened',
    reportRevision: today() + 'T15:00:00.000Z' });
  assert.equal(report.ok, true, JSON.stringify(report));
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="clients"]');
  await card.locator('.ots-row .ots-status', { hasText: 'התקיים' }).waitFor();
  const log = f.sb.rows('SessionLog');
  assert.equal(log.length, 1); assert.equal(log[0].clientId, client.id);
  assert.match(await card.locator('.crm-block').innerText(), /תועדה פנייה ראשונה/);

  // The same admitted identity continues through the journaled payment UI.
  // Date arithmetic is independently pinned by the financial owner; here the
  // actual saved payment, source plan and reloaded card must agree.
  await card.getByRole('button', { name: 'חידוש ותשלום', exact: true }).click();
  await page.locator('#renewSubmit:enabled').waitFor();
  await page.selectOption('#renewForm [name="renewCoverageIntent"]', 'ordinary');
  await page.fill('#renewForm [name="renewAmount"]', '1200');
  await page.fill('#renewForm [name="renewDate"]', today());
  await sourceAction(page, 'applyRenewal', () => page.click('#renewSubmit'));
  await page.getByRole('button', { name: 'אישור וסגירה', exact: true }).waitFor();
  await sourceAction(page, 'acknowledgeRenewal', () => page.click('#renewResume'));
  await page.waitForSelector('#renewModal', { state: 'hidden' });
  const payment = f.sb.rows('Payments')[0];
  assert.equal(payment.clientId, client.id); assert.equal(payment.status, 'paid');
  assert.equal(payment.coverageStart, today());
  assert.equal(f.sb.rows('Payments').length, 1, 'one renewal adds exactly one payment');
  const reserved = f.calls.filter(call => call.payload.action === 'reserveRenewal').at(-1).payload;
  assert.equal(reserved.coverageIntent, 'ordinary');
  assert.equal(f.sb.rows('FinancialOps').filter(op => op.id === reserved.opId)[0].state, 'acknowledged');
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="clients"]');
  await card.waitFor();
  assert.equal(f.plans().clients.find(row => row.clientId === client.id).renewalDate, f.sb.rows('Clients')[0].nextBillingDate);
  assert.equal(f.sb.rows('Payments').length, 1, 'readback never pays twice');
  await card.getByRole('button', { name: 'סיים טיפול', exact: true }).click();
  await page.fill('#exitForm [name="exitDate"]', today());
  await sourceAction(page, 'saveAll', () => page.click('#exitSubmit'));
  await page.reload({ waitUntil: 'networkidle' });
  const ended = f.handoff(lead.id);
  assert.equal(ended.results.length, 1); assert.equal(ended.results[0].state, 'ended');
  assert.equal(ended.results[0].outpatientId, client.id);
  assert.equal(f.sb.rows('Clients')[0].status, 'סיים טיפול');
  assert.equal(f.sb.rows('SessionLog').length, 1, 'discharge preserves the report');
  assert.equal(f.sb.rows('Activity').filter(r => r.kind === 'contact_logged' && r.leadId === lead.id).length, 1);
  assert.deepEqual(errors, []);
});

test('a second stale browser admission reads back the existing client without a new payment or resurrected lead', opt, async t => {
  const original = { id: 'workflow-two-tab-lead', name: NAME, phone: PHONE, stage: 'תוכנית טיפול',
    serviceType: 'פרטני CBT', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני CBT":1}',
    pricePerSession: 1200, assignedTo: 'ורד', created: today() };
  const f = await fixture(t, { leads: [original] }); if (!f) return;
  const first = await f.open(), stale = await f.open();
  for (const view of [first, stale]) {
    await view.page.click('.tab[data-view="leads"]');
    await leadCard(view.page).getByRole('button', { name: '← הפוך למטופל פעיל', exact: true }).click();
    await view.page.fill('#activateForm [name="pricePerSession"]', '1200');
    await view.page.fill('#activateForm [name="startDate"]', today());
    await view.page.selectOption('#activateForm [name="paymentStatus"]', 'unpaid');
  }
  await sourceAction(first.page, 'saveAll', () => first.page.click('#activateSubmit'));
  const winner = f.sb.rows('Clients')[0];
  assert.equal(winner.fromLead, original.id);
  const refused = stale.page.waitForResponse(r => new URL(r.url()).pathname === '/api/sheets' &&
    r.request().method() === 'POST' && (r.request().postDataJSON().action || 'saveAll') === 'saveAll');
  await stale.page.click('#activateSubmit');
  const refusal = await (await refused).json();
  assert.equal(refusal.ok, false); assert.equal(refusal.error, 'lead_already_converted');
  await stale.page.locator('#conflictBanner:not([hidden])').waitFor();
  assert.match(await stale.page.locator('#conflictBannerText').innerText(), /כבר הועברה למטופלים/);
  await clientCard(stale.page).waitFor();
  assert.equal(await clientCard(stale.page).count(), 1);
  assert.equal(f.sb.rows('Clients').length, 1); assert.equal(f.sb.rows('Clients')[0].id, winner.id);
  assert.equal(f.sb.rows('Leads').length, 0); assert.equal(f.sb.rows('Payments').length, 0);
  await stale.page.click('.tab[data-view="leads"]');
  assert.equal(await leadCard(stale.page).count(), 0);
  assert.doesNotMatch(await stale.page.locator('#toast').textContent(), /^המטופל נוסף$/);
  assert.deepEqual(first.errors, []); assert.deepEqual(stale.errors, []);
});

test('admitted operational view keeps contact history but cannot expose money through task replay or session reads', opt, async t => {
  const f = await fixture(t, { clients: [sampleClient] }); if (!f) return;
  const secretTitle = 'Synthetic restricted amount 97531';
  assert.equal(f.sb.post({ action: 'createTask', user: 'ורד', moneyScope: 'full', submissionId: 'workflow-money-task',
    task: { clientId: sampleClient.id, kind: 'collection', title: secretTitle } }).ok, true);
  const { page, errors } = await f.open('דנה', 390);
  await page.click('.tab[data-view="clients"]');
  const card = clientCard(page); await card.waitFor();
  assert.doesNotMatch(await page.locator('#app').innerText(), /97531|1,200 ₪/);
  assert.equal(await card.locator('[data-action="client-sessions"], .cc-ots-btn').count(), 0);
  const result = await page.evaluate(async clientId => {
    const replay = await fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action: 'createTask', submissionId: 'workflow-money-task',
      task: { clientId, kind: 'call', title: 'Operational follow-up' } }) });
    const money = await fetch('/api/sheets?action=getPayments');
    const sessions = await fetch('/api/sheets?action=getSessionLog');
    return { replay: await replay.json(), money: money.status, sessions: sessions.status };
  }, sampleClient.id);
  assert.equal(result.replay.ok, false); assert.doesNotMatch(JSON.stringify(result), /97531|collection/);
  assert.equal(result.money, 403); assert.equal(result.sessions, 403);
  assert.equal(f.sb.rows('Tasks').length, 1); assert.equal(f.sb.rows('Tasks')[0].title, secretTitle);
  assert.deepEqual(errors, []);
});

test('missing source task data after admission is visible as unavailable and a successful reload restores the saved history', opt, async t => {
  const f = await fixture(t, { clients: [sampleClient] }); if (!f) return;
  assert.equal(f.sb.post({ action: 'createTask', user: 'ורד', submissionId: 'workflow-followup',
    task: { clientId: sampleClient.id, kind: 'call', title: 'מעקב אחרי הקליטה', dueDate: today() } }).ok, true);
  const { page, context, errors } = await f.open();
  let fail = true;
  await context.route(url => url.pathname === '/api/sheets' && url.searchParams.get('action') === 'getTasks', route =>
    fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'synthetic_unavailable' }) }) : route.continue());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="clients"]');
  await page.locator('#dataUnavailableBanner:not([hidden])').waitFor();
  assert.match(await page.locator('#dataUnavailableText').innerText(), /משימות/);
  assert.equal(f.sb.rows('Tasks').length, 1, 'a failed read deletes nothing');
  fail = false;
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="clients"]');
  await clientCard(page).locator('.crm-task', { hasText: 'מעקב אחרי הקליטה' }).waitFor();
  assert.equal(await page.locator('#dataUnavailableBanner').isHidden(), true);
  assert.deepEqual(errors, []);
});
