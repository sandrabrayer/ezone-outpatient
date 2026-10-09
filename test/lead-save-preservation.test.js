'use strict';

// Execute the real Apps Script handlers against in-memory Sheets. No HTTP,
// production data, or copied implementation of the lead merge is involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');

const A = { id: 'lead-a', name: 'Fixture A', stage: 'new', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'fixture-original' };
const B = { id: 'lead-b', name: 'Fixture B', stage: 'new', assignedTo: 'fixture-owner', note: 'preserve this' };
const C = { id: 'client-a', name: 'Fixture client', status: 'פעיל', fromLead: A.id };
const ids = (sb, name = 'Leads') => sb.rows(name).map((r) => r.id).sort();

test('a stale full save preserves the lead another user added, including its fields', () => {
  const sb = sandbox([A, B]);
  const before = sb.rows('Leads').find((r) => r.id === B.id);
  const result = sb.save([A], [], { dataVersion: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(ids(sb), [A.id, B.id]);
  assert.deepEqual(sb.rows('Leads').find((r) => r.id === B.id), before);
  assert.equal(result.preservedLeads, 1);
  assert.equal(result.staleSave, true, 'also refresh when a lead writer did not bump the clients version');
  assert.equal(sb.isLocked(), false);
});

test('a legacy save with no version or no leads field cannot clear existing leads', () => {
  const sb = sandbox([A, B]);
  assert.equal(sb.post({ action: 'saveAll', clients: [] }).ok, true);
  assert.deepEqual(ids(sb), [A.id, B.id]);
});

test('two tabs adding different leads and retrying keep both without duplicates', () => {
  const sb = sandbox([A]);
  const other = { id: 'lead-c', name: 'Fixture C', stage: 'new' };
  assert.equal(sb.save([A, B]).ok, true);
  assert.equal(sb.save([A, other]).ok, true);
  assert.equal(sb.save([A, other]).ok, true);
  assert.deepEqual(ids(sb), [A.id, B.id, other.id]);
});

test('the cross-app createLead path survives an older browser save', () => {
  const sb = sandbox([A]);
  const created = sb.ctx._createLead({ name: 'Fixture inbound', phone: '0500000000', source: 'fixture' });
  assert.equal(created.ok, true);
  const before = ids(sb);
  assert.equal(sb.save([A]).ok, true);
  assert.deepEqual(ids(sb), before);
});

test('conversion removes only the converted lead and preserves an unseen new lead', () => {
  const sb = sandbox([A, B]);
  const result = sb.save([], [C]);
  assert.equal(result.ok, true);
  assert.deepEqual(ids(sb), [B.id]);
  assert.deepEqual(ids(sb, 'Clients'), [C.id]);
});

test('a stale tab cannot re-create a lead already converted by another user', () => {
  const sb = sandbox([A, B]);
  assert.equal(sb.save([B], [C]).ok, true);
  const result = sb.save([A, B], []);
  assert.equal(result.ok, true);
  assert.deepEqual(ids(sb), [B.id]);
  assert.deepEqual(ids(sb, 'Clients'), [C.id]);
  assert.equal(result.staleSave, true);
});

test('a refused client edit cannot claim a live lead was converted', () => {
  const current = { ...C, fromLead: '', updatedAt: '2026-10-02T00:00:00.000Z', updatedBy: 'fixture-current' };
  const sb = sandbox([A, B], [current]);
  const before = sb.rows('Clients');
  const result = sb.save([], [{ ...current, fromLead: A.id, updatedAt: '2026-10-01T00:00:00.000Z' }]);
  assert.equal(result.ok, true);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(ids(sb), [A.id, B.id]);
  assert.deepEqual(sb.rows('Clients'), before);
});

test('the existing converted-lead cleanup still works with a persisted client', () => {
  const sb = sandbox([A, B], [C]);
  assert.equal(sb.save([B], [C]).ok, true);
  assert.deepEqual(ids(sb), [B.id]);
});

test('an intentionally removed lead stays removed after an old tab saves it again', () => {
  const sb = sandbox([A, B]);
  assert.equal(sb.post({ action: 'removeLead', lead: A, user: 'fixture-remover' }).ok, true);
  const removedBefore = sb.rows('לידים שהוסרו');
  const result = sb.save([A, B]);
  assert.equal(result.ok, true);
  assert.deepEqual(ids(sb), [B.id]);
  assert.deepEqual(sb.rows('לידים שהוסרו'), removedBefore, 'archive unchanged; no second tombstone');
  assert.equal(result.staleSave, true);
});

test('removal followed by an unrelated save leaves the archive and remaining lead intact', () => {
  const sb = sandbox([A, B]);
  assert.equal(sb.post({ action: 'removeLead', lead: A }).ok, true);
  assert.equal(sb.save([B]).ok, true);
  assert.deepEqual(ids(sb), [B.id]);
  assert.equal(sb.rows('לידים שהוסרו').length, 1);
});

test('a live lead restored outside this flow is not erased just because it has an old archive entry', () => {
  const sb = sandbox([A]);
  sb.seed('לידים שהוסרו', sb.ctx.REMOVED_LEADS_HEADERS, [A]);
  assert.equal(sb.save([{ ...A, note: 'updated live lead' }]).ok, true);
  assert.deepEqual(ids(sb), [A.id]);
  assert.equal(sb.rows('Leads')[0].note, 'updated live lead');
});

test('a fresh edit keeps the existing who/when and conflict behavior', () => {
  const sb = sandbox([A, B]);
  assert.equal(sb.save([{ ...A, note: 'first edit' }, B]).ok, true);
  const stored = sb.rows('Leads')[0];
  const result = sb.save([{ ...A, note: 'stale edit' }]);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(sb.rows('Leads').find((r) => r.id === A.id), stored);
  assert.deepEqual(ids(sb), [A.id, B.id]);
});

test('an unchanged echo preserves stamps and does not report a stale save', () => {
  const sb = sandbox([A]);
  const before = sb.rows('Leads');
  const result = sb.save([A], [], { dataVersion: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.staleSave, false);
  assert.deepEqual(sb.rows('Leads'), before);
  assert.equal(result.stamped.leads, 0);
});

test('the legacy GET save path has the same preservation guard', () => {
  const sb = sandbox([A, B]);
  const result = JSON.parse(sb.ctx.doGet({ parameter: { action: 'saveAll', payload: JSON.stringify({ leads: [A], clients: [] }) } }).getContent());
  assert.equal(result.ok, true);
  assert.deepEqual(ids(sb), [A.id, B.id]);
});

test('failure to read the removal archive fails before clearing either live sheet', () => {
  const client = { ...C, fromLead: '' };
  const sb = sandbox([B], [client]);
  sb.seed('לידים שהוסרו', sb.ctx.REMOVED_LEADS_HEADERS, [A]);
  sb.sheets['לידים שהוסרו'].getRange = () => { throw new Error('fixture archive read failed'); };
  const before = { leads: sb.rows('Leads'), clients: sb.rows('Clients') };
  const result = sb.save([A, B], [client]);
  assert.equal(result.ok, false);
  assert.deepEqual(sb.rows('Leads'), before.leads);
  assert.deepEqual(sb.rows('Clients'), before.clients);
  assert.equal(sb.isLocked(), false);
});

test('editing a live lead does not depend on reading the removal archive', () => {
  const sb = sandbox([A]);
  sb.seed('לידים שהוסרו', sb.ctx.REMOVED_LEADS_HEADERS, [B]);
  sb.sheets['לידים שהוסרו'].getRange = () => { throw new Error('archive must not be read for live edits'); };
  assert.equal(sb.save([{ ...A, note: 'fresh edit' }]).ok, true);
  assert.equal(sb.rows('Leads')[0].note, 'fresh edit');
});

test('failure to acquire the script lock makes no change', () => {
  const sb = sandbox([A, B]);
  sb.lock.tryLock = () => false;
  const result = sb.save([A]);
  assert.equal(result.ok, false);
  assert.deepEqual(ids(sb), [A.id, B.id]);
});
