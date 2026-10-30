'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const SECRET = 'care-continuum-create-lead-secret';
const plain = (x) => JSON.parse(JSON.stringify(x));

function createLead(sb, body, secret = SECRET) {
  sb.props.CREATE_LEAD_SECRET = SECRET;
  return JSON.parse(sb.ctx.doPost({
    parameter: {},
    postData: { contents: JSON.stringify(Object.assign({ action: 'createLead', secret }, body || {})) }
  }).getContent());
}

function lead(over) {
  return Object.assign({
    id: 'L1', name: 'דנה כהן', phone: '0501234567', stage: 'new',
    house_of_origin: 'ramot', assignedTo: '', updatedAt: '2026-10-30T07:00:00.000Z'
  }, over || {});
}

function client(over) {
  return Object.assign({
    id: 'C1', name: 'דנה כהן', phone: '0501234567', status: 'פעיל',
    serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', startDate: '2026-10-01'
  }, over || {});
}

test('schema: care-continuum fields append to active Leads, Clients and client tombstones only', () => {
  const { ctx } = sandbox();
  const tail = ['dashboardPatientId', 'dashboardPersonId', 'dashboardLeadId', 'handoffSource', 'continuationKey'];
  assert.deepEqual(plain(ctx.LEADS_HEADERS).slice(-5), tail);
  assert.deepEqual(plain(ctx.CLIENTS_HEADERS).slice(-5), tail);
  assert.deepEqual(plain(ctx.CLIENTS_REMOVED_HEADERS).slice(-5), tail);
  assert.equal(plain(ctx.REMOVED_LEADS_HEADERS).some((h) => tail.includes(h)), false,
    'removed-leads archive stays in OP-03 scope');
});

test('createLead stores stable Dashboard identity and validated provenance/owner', () => {
  const sb = sandbox();
  const res = createLead(sb, {
    name: 'דנה כהן', phone: '050-123-4567', house: 'ramot',
    dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root',
    dashboardLeadId: 'id-lead-1', source: 'dashboard_discharge',
    continuationKey: 'דנה כהן|ramot|2026-10-01', assignedTo: 'ורד'
  });
  assert.equal(res.ok, true);
  assert.equal(res.matched, false);
  const [row] = sb.rows('Leads');
  assert.equal(row.dashboardPatientId, 'id-stay-1');
  assert.equal(row.dashboardPersonId, 'id-root');
  assert.equal(row.dashboardLeadId, 'id-lead-1');
  assert.equal(row.handoffSource, 'dashboard_discharge');
  assert.equal(row.continuationKey, 'דנה כהן|ramot|2026-10-01');
  assert.equal(row.assignedTo, 'ורד');
});

test('retry with the same dashboardPatientId links the open lead and does not create a duplicate', () => {
  const sb = sandbox();
  const first = createLead(sb, { name: 'דנה כהן', phone: '0501234567', dashboardPatientId: 'id-stay-1' });
  const second = createLead(sb, { name: 'דנה כהן', phone: '0501234567', dashboardPatientId: 'id-stay-1' });
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: true, id: first.id, matched: true, entity: 'lead', matchedBy: 'dashboardPatientId' });
  assert.equal(sb.rows('Leads').length, 1);
});

test('returning stay links by dashboard person key (personId || patientId), never by PII', () => {
  const sb = sandbox();
  const first = createLead(sb, { name: 'דנה כהן', dashboardPatientId: 'id-root' });
  const second = createLead(sb, {
    name: 'דנה כהן', dashboardPatientId: 'id-stay-2', dashboardPersonId: 'id-root'
  });
  assert.equal(second.ok, true);
  assert.equal(second.matched, true);
  assert.equal(second.id, first.id);
  assert.equal(second.matchedBy, 'personKey');
  assert.equal(sb.rows('Leads').length, 1);
});

test('a closed historical lead is history: same person key creates a new episode', () => {
  const sb = sandbox([lead({
    id: 'OLD', stage: 'לא רלוונטי', dashboardPatientId: 'id-root'
  })], []);
  const res = createLead(sb, {
    name: 'דנה כהן', dashboardPatientId: 'id-stay-2', dashboardPersonId: 'id-root'
  });
  assert.equal(res.ok, true);
  assert.equal(res.matched, false);
  assert.equal(sb.rows('Leads').length, 2);
});

test('an active client with the exact person key wins: createLead returns it and creates no lead', () => {
  const sb = sandbox([], [client({
    id: 'C1', dashboardPatientId: 'id-root', dashboardPersonId: ''
  })]);
  const res = createLead(sb, {
    name: 'דנה כהן', dashboardPatientId: 'id-stay-2', dashboardPersonId: 'id-root'
  });
  assert.deepEqual(res, { ok: true, id: 'C1', matched: true, entity: 'client', matchedBy: 'personKey' });
  assert.equal(sb.rows('Leads').length, 0);
});

test('phone + name is duplicate detection only: it never silently auto-links', () => {
  const sb = sandbox([lead({ id: 'L-existing', dashboardPatientId: '' })], []);
  const res = createLead(sb, { name: '  דנה   כהן ', phone: '050-123-4567' });
  assert.equal(res.ok, true);
  assert.equal(res.matched, false);
  assert.deepEqual(res.possibleDuplicateOf, ['lead:L-existing']);
  assert.equal(sb.rows('Leads').length, 2);
});

test('stable identity + open PII collision but no exact id match fails closed and writes nothing', () => {
  const sb = sandbox([lead({ id: 'L-existing', dashboardPatientId: '' })],
    [client({ id: 'C-existing' })]);
  const res = createLead(sb, {
    name: 'דנה כהן', phone: '050-123-4567', dashboardPatientId: 'id-stay-9'
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'possible_duplicate');
  assert.deepEqual(res.possibleDuplicateOf, ['lead:L-existing', 'client:C-existing']);
  assert.equal(sb.rows('Leads').length, 1);
  assert.equal(sb.rows('Clients').length, 1);
});

test('stable identity fails closed on PII collision for personId-only and leadId-only requests too', () => {
  for (const ident of [{ dashboardPersonId: 'id-root-9' }, { dashboardLeadId: 'id-lead-9' }]) {
    const sb = sandbox([lead({ id: 'L-existing' })], []);
    const res = createLead(sb, Object.assign({ name: 'דנה כהן', phone: '0501234567' }, ident));
    assert.equal(res.error, 'possible_duplicate');
    assert.equal(sb.rows('Leads').length, 1);
  }
});

test('exact stable-id match still wins over a PII collision (no possible_duplicate)', () => {
  const sb = sandbox([
    lead({ id: 'L-pii' }),
    lead({ id: 'L-exact', phone: '0509999999', name: 'אחר', dashboardPatientId: 'id-stay-1' })
  ], []);
  const res = createLead(sb, { name: 'דנה כהן', phone: '0501234567', dashboardPatientId: 'id-stay-1' });
  assert.equal(res.ok, true);
  assert.equal(res.id, 'L-exact');
  assert.equal(res.matched, true);
});

test('two open records claiming the same stable id fail closed instead of creating a third', () => {
  const sb = sandbox([
    lead({ id: 'L1', dashboardPatientId: 'id-stay-1' }),
    lead({ id: 'L2', dashboardPatientId: 'id-stay-1', phone: '0509999999' })
  ], []);
  const before = sb.rows('Leads').length;
  const res = createLead(sb, { name: 'דנה כהן', dashboardPatientId: 'id-stay-1' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'identity_conflict');
  assert.equal(res.matchedBy, 'dashboardPatientId');
  assert.equal(sb.rows('Leads').length, before);
});

test('browser save cannot overwrite server-owned handoff identity', () => {
  const sb = sandbox([lead({
    dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root',
    dashboardLeadId: 'id-lead-1', handoffSource: 'dashboard_discharge',
    continuationKey: 'key-1'
  })], []);
  const echo = sb.rows('Leads')[0];
  const tampered = Object.assign({}, echo, {
    dashboardPatientId: 'id-evil', dashboardPersonId: 'id-evil',
    dashboardLeadId: 'id-evil', handoffSource: 'direct', continuationKey: 'evil'
  });
  assert.equal(sb.save([tampered], []).ok, true);
  const [after] = sb.rows('Leads');
  assert.equal(after.dashboardPatientId, 'id-stay-1');
  assert.equal(after.dashboardPersonId, 'id-root');
  assert.equal(after.dashboardLeadId, 'id-lead-1');
  assert.equal(after.handoffSource, 'dashboard_discharge');
  assert.equal(after.continuationKey, 'key-1');
});

test('present malformed stable ids are refused; unknown owner/source are blanked without losing the lead', () => {
  const sb = sandbox();
  assert.deepEqual(createLead(sb, { name: 'X', dashboardPatientId: '=bad' }), { ok: false, error: 'invalid_identity' });
  assert.equal(sb.rows('Leads').length, 0);

  const res = createLead(sb, { name: 'X', assignedTo: 'סנדרה', source: 'legacy free text' });
  assert.equal(res.ok, true);
  assert.equal(res.ownerUnmapped, true);
  const [row] = sb.rows('Leads');
  assert.equal(row.assignedTo, '');
  assert.equal(row.handoffSource, '');
});
