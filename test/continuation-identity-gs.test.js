'use strict';

/* OP-ID-2 — Apps Script side (real Code.gs in the vm sandbox):
 *   saveContinuation: stable-id upsert, legacy-key upgrade in place, identity
 *   conflict, server-owned link fields, server-stamped outcomeDate;
 *   createContinuationLead: internal-only auth, forced source/owner, delegates
 *   to _createLead (link / fail-closed duplicate);
 *   activation copies identity from the ON-SHEET source lead, never from the
 *   browser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const plain = (x) => JSON.parse(JSON.stringify(x));
const KEY = 'דנה כהן|ramot|2026-10-01';

function cont(over) {
  return Object.assign({ key: KEY, name: 'דנה כהן', house: 'ramot', entryDate: '2026-10-01', meetingDate: '', outcome: '', outcomeDate: '', note: '', updatedAt: '' }, over || {});
}
function seedCont(sb, rows) { sb.seed(sb.ctx.CONTINUATION_SHEET, sb.ctx.CONTINUATION_HEADERS, rows); }
function save(sb, body) { return sb.post(Object.assign({ action: 'saveContinuation', user: 'ורד' }, body)); }
function create(sb, body) { return sb.post(Object.assign({ action: 'createContinuationLead', user: 'ורד' }, body)); }

test('schema: CONTINUATION_HEADERS gained an append-only identity/link tail; auth table routes createContinuationLead internally', () => {
  const { ctx } = sandbox();
  assert.deepEqual(plain(ctx.CONTINUATION_HEADERS).slice(-4), ['dashboardPatientId', 'dashboardPersonId', 'outpatientId', 'outpatientEntity']);
  assert.equal(plain(ctx.SOURCE_POST_AUTH).createContinuationLead, 'OUTPATIENT_PROXY_SECRET');
  assert.equal(plain(ctx.SOURCE_GET_AUTH).createContinuationLead, undefined, 'never a GET');
});

test('saveContinuation: new row stores stable identity and server-stamps outcomeDate in Asia/Jerusalem', () => {
  const sb = sandbox();
  const res = save(sb, { key: KEY, name: 'דנה כהן', house: 'ramot', entryDate: '2026-10-01', dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', meetingDate: '2026-11-02', outcome: 'continuing', outcomeDate: '1999-01-01', note: 'x' });
  assert.equal(res.ok, true);
  assert.equal(res.created, true);
  const [row] = sb.rows(sb.ctx.CONTINUATION_SHEET);
  assert.equal(row.dashboardPatientId, 'id-stay-1');
  assert.equal(row.dashboardPersonId, 'id-root');
  assert.equal(row.outcomeDate, new Date().toISOString().slice(0, 10), 'payload outcomeDate ignored; server stamps today');
  assert.equal(row.outpatientId, '');
  assert.equal(row.outpatientEntity, '');
});

test('saveContinuation: stable id wins over the legacy key (rename keeps one row, key upgrades)', () => {
  const sb = sandbox();
  seedCont(sb, [cont({ dashboardPatientId: 'id-stay-1', outcome: 'continuing', outcomeDate: '2026-10-20' })]);
  const res = save(sb, { key: 'דנה כהן-לוי|ramot|2026-10-01', name: 'דנה כהן-לוי', house: 'ramot', entryDate: '2026-10-01', dashboardPatientId: 'id-stay-1', outcome: 'continuing' });
  assert.equal(res.ok, true);
  assert.equal(res.matchedBy, 'dashboardPatientId');
  const rows = sb.rows(sb.ctx.CONTINUATION_SHEET);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'דנה כהן-לוי|ramot|2026-10-01');
  assert.equal(rows[0].outcomeDate, '2026-10-20', 'unchanged outcome keeps its original date');
});

test('saveContinuation: a legacy row (no id) with the same old key upgrades in place and receives the id', () => {
  const sb = sandbox();
  seedCont(sb, [cont({ meetingDate: '2026-10-15' })]);
  const res = save(sb, { key: KEY, name: 'דנה כהן', house: 'ramot', entryDate: '2026-10-01', dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', meetingDate: '2026-10-15', outcome: '' });
  assert.equal(res.ok, true);
  assert.equal(res.created, false);
  assert.equal(res.matchedBy, 'key');
  const rows = sb.rows(sb.ctx.CONTINUATION_SHEET);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dashboardPatientId, 'id-stay-1');
  assert.equal(rows[0].dashboardPersonId, 'id-root');
});

test('saveContinuation: legacy (id-less) payload still saves and never downgrades an id-bearing row', () => {
  const sb = sandbox();
  seedCont(sb, [cont({ dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', outpatientId: 'id_lead_1', outpatientEntity: 'lead' })]);
  const res = save(sb, { key: KEY, name: 'דנה כהן', house: 'ramot', entryDate: '2026-10-01', meetingDate: '2026-10-16', outcome: 'continuing' });
  assert.equal(res.ok, true);
  const [row] = sb.rows(sb.ctx.CONTINUATION_SHEET);
  assert.equal(row.dashboardPatientId, 'id-stay-1');
  assert.equal(row.outpatientId, 'id_lead_1');
  assert.equal(row.outpatientEntity, 'lead');
  assert.equal(row.meetingDate, '2026-10-16');
});

test('saveContinuation: identity conflicts write nothing', () => {
  // same legacy key, different stable id
  let sb = sandbox();
  seedCont(sb, [cont({ dashboardPatientId: 'id-stay-OTHER' })]);
  let res = save(sb, { key: KEY, name: 'דנה כהן', house: 'ramot', entryDate: '2026-10-01', dashboardPatientId: 'id-stay-1', outcome: 'continuing' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'continuation_identity_conflict');
  assert.equal(sb.rows(sb.ctx.CONTINUATION_SHEET)[0].outcome, '', 'nothing written');
  // two rows already share the id
  sb = sandbox();
  seedCont(sb, [cont({ dashboardPatientId: 'id-stay-1' }), cont({ key: 'אחר|ramot|2026-09-01', name: 'אחר', dashboardPatientId: 'id-stay-1' })]);
  res = save(sb, { key: KEY, dashboardPatientId: 'id-stay-1', outcome: 'continuing' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'continuation_identity_conflict');
  assert.equal(sb.rows(sb.ctx.CONTINUATION_SHEET).length, 2);
  // malformed id / link are refused, never silently dropped
  sb = sandbox();
  assert.equal(save(sb, { key: KEY, dashboardPatientId: 'id stay;1' }).reason, 'invalid_identity');
  assert.equal(save(sb, { key: KEY, outpatientId: 'id_x', outpatientEntity: 'payment' }).reason, 'invalid_link');
  assert.equal(sb.rows(sb.ctx.CONTINUATION_SHEET).length, 0);
});

test('saveContinuation: link fields are written only when a VALID pair is supplied; otherwise the on-sheet link is preserved', () => {
  const sb = sandbox();
  seedCont(sb, [cont({ dashboardPatientId: 'id-stay-1', outpatientId: 'id_lead_1', outpatientEntity: 'lead' })]);
  // ordinary save (proxy strips link fields) keeps the link
  save(sb, { key: KEY, dashboardPatientId: 'id-stay-1', outcome: 'to_outpatient' });
  let [row] = sb.rows(sb.ctx.CONTINUATION_SHEET);
  assert.equal(row.outpatientId, 'id_lead_1');
  // orchestration save with a new observed link updates it
  save(sb, { key: KEY, dashboardPatientId: 'id-stay-1', outcome: 'to_outpatient', outpatientId: 'C9', outpatientEntity: 'client' });
  [row] = sb.rows(sb.ctx.CONTINUATION_SHEET);
  assert.equal(row.outpatientId, 'C9');
  assert.equal(row.outpatientEntity, 'client');
});

test('createContinuationLead: internal-only (proxy key); forces source=continuation + owner=session user; maps house; keeps raw house in the note', () => {
  const sb = sandbox();
  // no proxy key -> unauthorized, nothing written
  const unauth = JSON.parse(sb.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'createContinuationLead', dashboardPatientId: 'id-stay-1', name: 'x' }) }, parameter: {} }).getContent());
  assert.equal(unauth.ok, false);
  assert.equal(unauth.error, 'unauthorized');
  // a cross-app CREATE_LEAD_SECRET does not open it either
  sb.props.CREATE_LEAD_SECRET = 's3cret';
  const wrongKey = JSON.parse(sb.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'createContinuationLead', secret: 's3cret', dashboardPatientId: 'id-stay-1', name: 'x' }) }, parameter: {} }).getContent());
  assert.equal(wrongKey.ok, false);
  assert.equal(sb.rows('Leads').length, 0);

  const res = create(sb, { dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', name: 'דנה כהן', phone: '050-123-4567', house: 'sde', entryDate: '2026-10-01', meetingDate: '2026-11-02', note: 'הערה', source: 'dashboard_discharge', assignedTo: 'סנדרה' });
  assert.equal(res.ok, true);
  assert.equal(res.matched, false);
  assert.equal(res.entity, 'lead');
  const [lead] = sb.rows('Leads');
  assert.equal(lead.handoffSource, 'continuation', 'browser/source value ignored');
  assert.equal(lead.assignedTo, 'ורד', 'owner is the session user, not a payload field');
  assert.equal(lead.dashboardPatientId, 'id-stay-1');
  assert.equal(lead.dashboardPersonId, 'id-root');
  assert.equal(lead.continuationKey, 'דנה כהן|sde|2026-10-01');
  assert.equal(lead.house_of_origin, '', 'sde has no outpatient equivalent');
  assert.match(lead.note, /^מקור: מסלול המשך \| פגישה: 2026-11-02 \| בית: sde \| הערה$/);
  assert.equal(lead.phone, '0501234567');
  assert.equal(lead.stage, 'new');
  // mapped house
  const sb2 = sandbox();
  create(sb2, { dashboardPatientId: 'id-stay-2', name: 'ב', house: 'asher', entryDate: '2026-10-01' });
  assert.equal(sb2.rows('Leads')[0].house_of_origin, 'raanana');
});

test('createContinuationLead: idempotent by stable id (replay links, creates nothing); PII collision fails closed', () => {
  const sb = sandbox();
  const first = create(sb, { dashboardPatientId: 'id-stay-1', name: 'דנה כהן', phone: '0501234567', house: 'ramot', entryDate: '2026-10-01' });
  const again = create(sb, { dashboardPatientId: 'id-stay-1', name: 'דנה כהן', phone: '0501234567', house: 'ramot', entryDate: '2026-10-01' });
  assert.equal(again.ok, true);
  assert.equal(again.matched, true);
  assert.equal(again.id, first.id);
  assert.equal(again.entity, 'lead');
  assert.equal(sb.rows('Leads').length, 1);
  // an open lead with the same phone+name but NO stable id -> possible_duplicate, nothing written
  const sb2 = sandbox([{ id: 'L-old', name: 'דנה כהן', phone: '0501234567', stage: 'new' }]);
  const dup = create(sb2, { dashboardPatientId: 'id-stay-1', name: 'דנה כהן', phone: '0501234567', house: 'ramot', entryDate: '2026-10-01' });
  assert.equal(dup.ok, false);
  assert.equal(dup.error, 'possible_duplicate');
  assert.deepEqual(dup.possibleDuplicateOf, ['lead:L-old']);
  assert.equal(sb2.rows('Leads').length, 1);
  // missing id / name fail before any sheet access
  assert.equal(create(sandbox(), { name: 'x' }).error, 'invalid_identity');
  assert.equal(create(sandbox(), { dashboardPatientId: 'id-1' }).error, 'missing_name');
});

test('activation: a brand-new client created from a lead copies CARE_ID_FIELDS from the ON-SHEET lead, never from the browser', () => {
  const srcLead = { id: 'L1', name: 'דנה כהן', phone: '0501234567', stage: 'new', dashboardPatientId: 'id-stay-1', dashboardPersonId: 'id-root', dashboardLeadId: 'id-dl', handoffSource: 'continuation', continuationKey: KEY, updatedAt: '2026-10-30T07:00:00.000Z' };
  const sb = sandbox([srcLead], []);
  // the browser activates: new client with fromLead; it ALSO tries to inject other identity
  const res = sb.save([], [{ id: 'C-new', name: 'דנה כהן', phone: '0501234567', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', startDate: '2026-11-01', fromLead: 'L1', source: 'lead', dashboardPatientId: 'id-FAKE', handoffSource: 'direct' }]);
  assert.equal(res.ok, true);
  const [client] = sb.rows('Clients');
  assert.equal(client.dashboardPatientId, 'id-stay-1');
  assert.equal(client.dashboardPersonId, 'id-root');
  assert.equal(client.dashboardLeadId, 'id-dl');
  assert.equal(client.handoffSource, 'continuation');
  assert.equal(client.continuationKey, KEY);
  assert.equal(sb.rows('Leads').length, 0, 'converted lead leaves the Leads sheet as before');
});

test('activation: an existing client keeps its on-sheet identity even if its fromLead lead carries different ids; a new client without a known lead gets none', () => {
  const sb = sandbox(
    [{ id: 'L1', name: 'א', phone: '0501111111', stage: 'new', dashboardPatientId: 'id-from-lead' }],
    [{ id: 'C1', name: 'א', phone: '0501111111', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', fromLead: 'L1', dashboardPatientId: 'id-on-client' }]
  );
  const clientRow = sb.rows('Clients')[0];
  sb.save([{ id: 'L1', name: 'א', phone: '0501111111', stage: 'new' }], [
    Object.assign({}, clientRow, { dashboardPatientId: 'id-browser' }),
    { id: 'C2', name: 'ב', phone: '0502222222', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', fromLead: 'L-unknown', dashboardPatientId: 'id-browser-2' }
  ]);
  const rows = sb.rows('Clients');
  assert.equal(rows.find((r) => r.id === 'C1').dashboardPatientId, 'id-on-client');
  assert.equal(rows.find((r) => r.id === 'C2').dashboardPatientId, '');
});
