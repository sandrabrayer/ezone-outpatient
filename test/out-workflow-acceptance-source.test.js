'use strict';

// Cross-stage acceptance against the real Code.gs router and handlers. Only the
// Google runtime is synthetic; these tests do not call another app or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');

const HANDOFF_SECRET = 'synthetic-workflow-handoff-secret';
const DEACTIVATE_SECRET = 'synthetic-workflow-deactivation-secret';
const lead = { id: 'workflow-lead', name: 'Synthetic workflow patient', phone: '0500000071',
  stage: 'תוכנית טיפול', assignedTo: 'ורד', serviceType: 'פרטני', pricePerSession: 1973,
  notes: 'private synthetic inquiry detail', created: '2026-11-01' };
const client = { id: 'workflow-client', fromLead: lead.id, name: lead.name, phone: lead.phone,
  status: 'פעיל', assignedTo: 'ורד', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}',
  startDate: '2026-11-01', pricePerSession: 1973, paymentStatus: 'unpaid',
  payerName: 'Synthetic private payer', notes: 'private synthetic clinical detail' };
const full = (s, body) => s.post({ user: 'ורד', moneyScope: 'full', ...body });
const snapshot = s => JSON.stringify(Object.fromEntries(Object.entries(s.sheets).map(([name, sh]) => [name, sh.grid])));
function reopen(s) {
  const next = sandbox();
  Object.assign(next.props, s.props);
  for (const [name, sh] of Object.entries(s.sheets)) {
    const headers = sh.grid[0] || [];
    next.seed(name, headers, sh.grid.slice(1).map(row => Object.fromEntries(headers.map((key, i) => [key, row[i] ?? '']))));
  }
  return next;
}
function handoff(s, id) {
  return s.get({ action: 'getHandoffStatus', secret: HANDOFF_SECRET, outpatientIds: id });
}
function refused(result) {
  return result.ok === false || (Array.isArray(result.conflicts) && result.conflicts.length > 0);
}

test('actual admission removes the lead while original-id handoff and lead-era activity survive reload and discharge', () => {
  let s = sandbox([lead]); s.props.HANDOFF_STATUS_SECRET = HANDOFF_SECRET;
  const contact = full(s, { action: 'logContact', submissionId: 'workflow-contact',
    contact: { leadId: lead.id, channel: 'phone', outcome: 'spoke_follow_up',
      summary: 'private synthetic contact detail', occurredAt: '2026-11-18T09:00' },
    next: { dueDate: '2099-01-05', title: 'Synthetic operational follow-up' } });
  assert.equal(contact.ok, true, JSON.stringify(contact));
  const admitted = full(s, { action: 'saveAll', leads: [], clients: [client], dataVersion: 0 });
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.deepEqual(s.rows('Leads'), [], 'exercise actual conversion, not a retained-lead fixture');
  assert.equal(s.rows('Clients').length, 1);
  const activity = s.rows('Activity'), tasks = s.rows('Tasks');
  s = reopen(s);
  const result = handoff(s, lead.id);
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1, 'the original referral ID still resolves after the Lead was removed');
  assert.equal(result.results[0].outpatientId, client.id);
  assert.equal(result.results[0].entity, 'client');
  assert.equal(result.results[0].state, 'active');
  assert.equal(result.results[0].lastActionDate, '2026-11-18');
  assert.equal(result.results[0].nextActionDate, '2099-01-05');
  assert.deepEqual(handoff(s, client.id).results, result.results, 'both exact IDs resolve the same saved person');
  for (const value of [client.phone, '1973', 'private synthetic', client.payerName, 'pricePerSession', 'paymentStatus', 'serviceType']) {
    assert.equal(JSON.stringify(result).includes(value), false, 'handoff must not disclose ' + value);
  }
  const nameLookup = handoff(s, lead.name);
  assert.equal(nameLookup.ok, false, 'a display name is not an allowed identity key');
  assert.equal(nameLookup.error, 'missing_ids');
  assert.equal(nameLookup.results, undefined, 'invalid identity input discloses no records');
  assert.deepEqual(handoff(s, lead.phone).results, [], 'phone numbers are never identity lookups');

  const stored = s.rows('Clients')[0];
  const ended = full(s, { action: 'saveAll', leads: [], clients: [{ ...stored, status: 'סיים טיפול', exitDate: '2026-11-19' }] });
  assert.equal(ended.ok, true, JSON.stringify(ended));
  assert.equal((ended.conflicts || []).length, 0);
  s = reopen(s);
  const endedStatus = handoff(s, lead.id);
  assert.equal(endedStatus.results.length, 1);
  assert.equal(endedStatus.results[0].outpatientId, client.id);
  assert.equal(endedStatus.results[0].state, 'ended');
  assert.equal(endedStatus.results[0].stateDate, '2026-11-19');
  assert.deepEqual(s.rows('Activity'), activity, 'admission and discharge retain contact history');
  assert.deepEqual(s.rows('Tasks'), tasks, 'lead-era tasks remain available through fromLead');
});

for (const billingMode of ['', 'per_session']) {
  test('a stale second ' + (billingMode || 'package') + ' conversion cannot create another client for the same lead', () => {
    const s = sandbox([lead]);
    const original = { ...client, billingMode, source: 'lead', ...(billingMode ? {
      serviceType: '', sessionsPerWeek: '{}', pricePerSession: 0, paymentStatus: '', nextBillingDate: ''
    } : {}) };
    const first = full(s, { action: 'saveAll', leads: [], clients: [original], dataVersion: 0 });
    assert.equal(first.ok, true, JSON.stringify(first));
    const saved = s.rows('Clients')[0];
    const second = full(s, { action: 'saveAll', leads: [lead],
      clients: [{ ...original, id: 'workflow-stale-second-client' }], dataVersion: 0 });
    assert.equal(refused(second), true, 'stale distinct-client conversion must report a refusal');
    assert.deepEqual(s.rows('Clients'), [saved], 'the original client remains the only owner of fromLead');
    assert.deepEqual(s.rows('Leads'), [], 'a stale tab cannot resurrect the converted lead');
    assert.deepEqual(s.rows('Payments'), []);
    assert.deepEqual(s.rows('Charges'), []);
    const replay = full(s, { action: 'saveAll', leads: [], clients: [{ ...saved }], dataVersion: 0 });
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal((replay.conflicts || []).length, 0, 'same client exact saved retry remains accepted');
    assert.deepEqual(s.rows('Clients'), [saved]);
  });
}

test('operational createTask replay cannot return a persisted money task; authorized exact replay remains idempotent', () => {
  const s = sandbox([lead]);
  const payload = { action: 'createTask', submissionId: 'workflow-private-task',
    task: { kind: 'collection', leadId: lead.id, title: 'Synthetic confidential amount 9713',
      reason: 'Synthetic confidential payer detail', dueDate: '2026-11-25' } };
  const saved = full(s, payload);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const before = snapshot(s);
  const denied = s.post({ action: 'createTask', submissionId: payload.submissionId, user: 'דנה', moneyScope: 'ops',
    task: { kind: 'call', leadId: lead.id, title: 'Synthetic ordinary follow-up' } });
  assert.equal(denied.ok, false, 'visibility must be checked against the persisted replay target');
  assert.equal(denied.task, undefined);
  for (const value of ['9713', 'confidential', 'collection', saved.task.id]) assert.equal(JSON.stringify(denied).includes(value), false);
  assert.equal(snapshot(s), before, 'denied replay makes no source changes');
  const replay = full(s, payload);
  assert.equal(replay.ok, true); assert.equal(replay.replayed, true);
  assert.deepEqual(replay.task, saved.task);
  assert.equal(snapshot(s), before, 'exact authorized replay creates no duplicate task or event');
});

test('cross-app deactivation refuses an ambiguous shared payer without mutations and preserves unique legacy calls', () => {
  const sharedPayer = '0520000090';
  const a = { ...client, id: 'workflow-patient-a', fromLead: '', payerPhone: sharedPayer };
  const b = { ...client, id: 'workflow-patient-b', fromLead: '', name: 'Synthetic second patient', phone: '0500000072', payerPhone: sharedPayer };
  let s = sandbox([], [a, b]); s.props.DEACTIVATE_CLIENT_SECRET = DEACTIVATE_SECRET;
  const originalB = s.rows('Clients').find(row => row.id === b.id);
  const before = snapshot(s);
  const denied = s.post({ action: 'deactivateClient', secret: DEACTIVATE_SECRET, phone: sharedPayer });
  assert.equal(denied.ok, false, 'a shared payer cannot choose multiple patient identities');
  assert.equal(snapshot(s), before, 'neither patient, stamps nor any other sheet may change');
  assert.equal(s.isLocked(), false);
  s = reopen(s);
  const unique = s.post({ action: 'deactivateClient', secret: DEACTIVATE_SECRET, phone: a.phone });
  assert.equal(unique.ok, true); assert.equal(unique.deactivated, 1);
  assert.equal(s.rows('Clients').find(row => row.id === a.id).status, 'לא פעיל');
  assert.deepEqual(s.rows('Clients').find(row => row.id === b.id), originalB, 'unrelated patient remains unchanged');
  const oneDone = snapshot(s);
  const replay = s.post({ action: 'deactivateClient', secret: DEACTIVATE_SECRET, phone: a.phone });
  assert.equal(replay.ok, true); assert.equal(replay.deactivated, 0);
  assert.equal(snapshot(s), oneDone, 'unique legacy retry is idempotent');
});

test('historical duplicate conversions return unknown for the referral while an exact client id remains usable', () => {
  for (const retainedLead of [false, true]) {
    const other = { ...client, id: 'workflow-other-client', status: 'סיים טיפול', assignedTo: 'דנה', exitDate: '2026-11-19' };
    const s = sandbox(retainedLead ? [lead] : [], [client, other]);
    s.props.HANDOFF_STATUS_SECRET = HANDOFF_SECRET;
    const before = snapshot(s), ambiguous = handoff(s, lead.id);
    assert.equal(ambiguous.ok, true); assert.equal(ambiguous.results.length, 1);
    const row = ambiguous.results[0];
    assert.equal(row.outpatientId, lead.id); assert.equal(row.state, 'unknown');
    assert.equal(row.reason, 'ambiguous_conversion');
    for (const key of ['assignedTo', 'nextAction', 'stateDate', 'lastActionDate']) assert.equal(row[key], '');
    assert.equal(handoff(s, client.id).results[0].state, 'active');
    assert.equal(handoff(s, other.id).results[0].state, 'ended');
    assert.equal(snapshot(s), before, 'ambiguity lookup cannot rewrite or merge historical identities');
  }
});

test('two new conversions in one save are refused before any sheet or journal mutation', () => {
  const s = sandbox([lead]), before = snapshot(s);
  const result = full(s, { action: 'saveAll', leads: [], clients: [client, { ...client, id: 'workflow-same-batch-client' }] });
  assert.equal(result.ok, false); assert.equal(result.error, 'lead_already_converted');
  assert.equal(snapshot(s), before);
  assert.equal(s.isLocked(), false);
});

test('an old client editor omitting fromLead cannot erase the saved referral identity', () => {
  const s = sandbox([lead]); s.props.HANDOFF_STATUS_SECRET = HANDOFF_SECRET;
  assert.equal(full(s, { action: 'saveAll', leads: [], clients: [client] }).ok, true);
  const stale = { ...s.rows('Clients')[0], notes: 'updated non-identity note' }; delete stale.fromLead;
  const saved = full(s, { action: 'saveAll', leads: [], clients: [stale], dataVersion: 0 });
  assert.equal(saved.ok, true); assert.equal((saved.conflicts || []).length, 0);
  const reloaded = reopen(s);
  assert.equal(reloaded.rows('Clients')[0].fromLead, lead.id);
  assert.equal(reloaded.rows('Clients')[0].notes, 'updated non-identity note');
  assert.equal(handoff(reloaded, lead.id).results[0].outpatientId, client.id);
});
