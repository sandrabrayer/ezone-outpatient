'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, today, THERAPIST } = require('../test-support/out-workflow-fixture.cjs');
const LEAD = { id: 'workflow-http-lead', name: 'מטופלת מסלול HTTP', phone: '0500000078',
  stage: 'פרטים אישיים', serviceType: 'פרטני CBT', location: 'רעננה הפרדס', assignedTo: 'דנה', created: today() };
const CLIENT = { id: 'workflow-http-client', name: LEAD.name, phone: LEAD.phone, fromLead: LEAD.id,
  serviceType: LEAD.serviceType, sessionsPerWeek: '{"פרטני CBT":1}', location: LEAD.location,
  assignedTo: 'דנה', status: 'פעיל', startDate: today(), nextBillingDate: today(),
  pricePerSession: 1200, billingType: 'monthly', paymentStatus: 'unpaid' };

test('HTTP/source journey retains contact and referral identity through admission, plan, approved OUT receipt and discharge', async t => {
  const f = await fixture(t, { browser: false });
  const cookie = await f.login('ורד');
  async function write(payload) {
    const response = await f.request('POST', '/api/sheets', payload, cookie);
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.body.ok, true, JSON.stringify(response.body)); return response.body;
  }
  await write({ action: 'saveAll', leads: [LEAD], clients: [] });
  await write({ action: 'logContact', submissionId: 'workflow-http-contact', contact: {
    leadId: LEAD.id, channel: 'phone', outcome: 'meeting_set', summary: 'תועדה היכרות לפני קליטה' },
    next: { none: true, explanation: 'ההיכרות כבר נקבעה' } });
  const liveLead = f.sb.rows('Leads')[0];
  await write({ action: 'saveAll', leads: [{ ...liveLead, stage: 'שיחת היכרות', introDateTime: today() + 'T09:00' }], clients: [] });
  assert.equal(f.handoff(LEAD.id).results[0].state, 'intro_scheduled');
  await write({ action: 'saveAll', leads: [], clients: [CLIENT] });
  const initial = await f.request('GET', '/api/sheets?action=getData', null, cookie);
  assert.equal(initial.body.clients.length, 1); assert.equal(initial.body.leads.length, 0);
  assert.equal(initial.body.clients[0].fromLead, LEAD.id);
  const admitted = f.handoff(LEAD.id);
  assert.equal(admitted.results.length, 1, JSON.stringify(admitted));
  assert.equal(admitted.results[0].state, 'active'); assert.equal(admitted.results[0].outpatientId, CLIENT.id);
  const plans = f.plans();
  assert.equal(plans.ok, true);
  const plan = plans.clients.find(row => row.clientId === CLIENT.id);
  assert.ok(plan, JSON.stringify(plans)); assert.equal(plan.phone, CLIENT.phone);
  assert.equal('pricePerSession' in plan, false); assert.equal('paymentStatus' in plan, false);

  // Synthetic THR-approved report enters the real OUT source receiver. This is
  // not a claim that the separate THR scheduling/approval screen was exercised.
  const approved = f.outcome({ sessionId: 'workflow-http-approved', phone: CLIENT.phone, therapist: THERAPIST,
    clinicalTreatmentType: 'פרטני CBT', date: today(), outcome: 'happened', reportRevision: today() + 'T10:00:00.000Z' });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const report = await f.request('GET', '/api/sheets?action=getSessionLog&month=' + today().slice(0, 7), null, cookie);
  assert.equal(report.status, 200); assert.equal(report.body.ok, true);
  assert.equal(f.sb.rows('SessionLog')[0].clientId, CLIENT.id);
  const current = f.sb.rows('Clients')[0];
  await write({ action: 'saveAll', leads: [], clients: [{ ...current, status: 'סיים טיפול', exitDate: today() }] });
  const reread = await f.request('GET', '/api/sheets?action=getData', null, cookie);
  assert.equal(reread.body.clients[0].status, 'סיים טיפול');
  assert.equal(f.handoff(LEAD.id).results[0].state, 'ended');
  assert.equal(f.sb.rows('SessionLog').length, 1);
  assert.equal(f.sb.rows('Activity').filter(row => row.kind === 'contact_logged' && row.leadId === LEAD.id).length, 1);
  assert.equal(f.sb.rows('Payments').length, 0);
});

test('signed operational session cannot acquire a persisted financial task by forged full-scope replay', async t => {
  const f = await fixture(t, { clients: [CLIENT], browser: false });
  const vered = await f.login('ורד'), dana = await f.login('דנה');
  const title = 'Restricted synthetic amount 97531';
  const first = await f.request('POST', '/api/sheets', { action: 'createTask', submissionId: 'workflow-hidden-task',
    task: { clientId: CLIENT.id, kind: 'collection', title } }, vered);
  assert.equal(first.body.ok, true);
  const forged = await f.request('POST', '/api/sheets', { action: 'createTask', submissionId: 'workflow-hidden-task',
    user: 'ורד', moneyScope: 'full', task: { clientId: CLIENT.id, kind: 'call', title: 'Operational follow-up' } }, dana);
  assert.equal(forged.status, 400);
  assert.equal(f.calls.filter(call => call.payload.action === 'createTask').length, 1, 'forged privilege never reaches source');
  const replay = await f.request('POST', '/api/sheets', { action: 'createTask', submissionId: 'workflow-hidden-task',
    task: { clientId: CLIENT.id, kind: 'call', title: 'Operational follow-up' } }, dana);
  assert.equal(replay.body.ok, false, JSON.stringify(replay));
  assert.doesNotMatch(JSON.stringify(replay), /97531|collection/);
  const forwarded = f.calls.filter(call => call.payload.action === 'createTask').at(-1).payload;
  assert.equal(forwarded.user, 'דנה'); assert.equal(forwarded.moneyScope, 'ops');
  assert.equal(f.sb.rows('Tasks').length, 1); assert.equal(f.sb.rows('Tasks')[0].title, title);
  const data = await f.request('GET', '/api/sheets?action=getData', null, dana);
  assert.equal('pricePerSession' in data.body.clients[0], false);
  for (const action of ['getPayments', 'getSessionLog']) {
    const read = await f.request('GET', '/api/sheets?action=' + action, null, dana);
    assert.equal(read.status, 403);
  }
});
