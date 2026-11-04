'use strict';
// Continuation milestones (מסלול המשך CRM, 2026-11-03, CHANGELOG-continuation-milestones.md).
//   - the browser helper (public/continuation-logic.js) and Apps Script (_contMilestones in Code.gs)
//     compute the SAME milestones from the ENTRY date: +1/+2/+3 calendar months, end-of-month clamp,
//     leap years, year turn; contact date = milestone − 14 days; no entry date → null (no task);
//   - stable ids cont::<ref>::<entryDate>::m1|m2|m3, ref = Dashboard id or normalized phone, never the name;
//   - the server sync is idempotent, moves open tasks on a corrected entry date, closes them on discharge /
//     a terminal CRM status, and never touches money;
//   - saveContinuation validates the appended CRM columns fail-closed and keeps them for legacy payloads;
//   - linking to outpatient records is by normalized phone only, one match or nothing;
//   - the Node proxy refuses the sync action from a browser.
process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CL = require('../public/continuation-logic.js');
const { sandbox } = require('../test-support/apps-script-sandbox');
const PROXY = process.env.OUTPATIENT_PROXY_SECRET;
const plain = (v) => JSON.parse(JSON.stringify(v)); // vm-context objects vs. deepEqual prototypes

const VECTORS = [
  // [entryDate, [m1, m2, m3] milestones, [c1, c2, c3] contact dates]
  ['2026-09-15', ['2026-10-15', '2026-11-15', '2026-12-15'], ['2026-10-01', '2026-11-01', '2026-12-01']],
  ['2026-01-31', ['2026-02-28', '2026-03-31', '2026-04-30'], ['2026-02-14', '2026-03-17', '2026-04-16']],  // regular year
  ['2028-01-31', ['2028-02-29', '2028-03-31', '2028-04-30'], ['2028-02-15', '2028-03-17', '2028-04-16']],  // leap year
  ['2026-11-20', ['2026-12-20', '2027-01-20', '2027-02-20'], ['2026-12-06', '2027-01-06', '2027-02-06']],  // year turn
  ['2026-10-31', ['2026-11-30', '2026-12-31', '2027-01-31'], ['2026-11-16', '2026-12-17', '2027-01-17']],
  ['2026-03-29', ['2026-04-29', '2026-05-29', '2026-06-29'], ['2026-04-15', '2026-05-15', '2026-06-15']],  // across the DST switch (date-only math)
  ['2026-10-25', ['2026-11-25', '2026-12-25', '2027-01-25'], ['2026-11-11', '2026-12-11', '2027-01-11']]
];
const BAD = ['', null, undefined, '2026-02-30', '15/09/2026', '2026-9-5', '2026-13-01', 'yesterday'];

test('browser helper: milestones from the entry date, 14-day lead, clamped calendar months, no date → null', () => {
  for (const [entry, ms, cs] of VECTORS) {
    const got = CL.milestones(entry);
    assert.deepEqual(got.map((m) => m.milestoneDate), ms, entry);
    assert.deepEqual(got.map((m) => m.contactDate), cs, entry);
    assert.deepEqual(got.map((m) => m.suffix), ['m1', 'm2', 'm3']);
  }
  for (const b of BAD) assert.equal(CL.milestones(b), null, 'bad entry ' + b);
  assert.equal(CL.addCalendarMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(CL.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(CL.addDays('2027-12-31', 1), '2028-01-01');
});

test('Apps Script helper is byte-for-byte the same result on every vector (parity guard)', () => {
  const sb = sandbox();
  for (const [entry, ms, cs] of VECTORS) {
    const got = plain(sb.ctx._contMilestones(entry));
    assert.deepEqual(got.map((m) => m.milestoneDate), ms, entry);
    assert.deepEqual(got.map((m) => m.contactDate), cs, entry);
    assert.deepEqual(got, CL.milestones(entry), 'parity ' + entry);
  }
  for (const b of BAD) assert.equal(sb.ctx._contMilestones(b), null, 'bad entry ' + b);
  assert.equal(sb.ctx.CONTINUATION_CONTACT_LEAD_DAYS, CL.CONTACT_LEAD_DAYS);
  assert.deepEqual(plain(sb.ctx.CONTINUATION_MILESTONE_MONTHS), CL.MILESTONE_MONTHS);
  assert.deepEqual(plain(sb.ctx.CONTINUATION_CRM_STATUSES).slice(1), CL.CRM_STATUSES);
  assert.deepEqual(plain(sb.ctx.CONTINUATION_CRM_TERMINAL), CL.CRM_TERMINAL);
});

test('stable reference: Dashboard id first, else normalized phone, never the name; ids round-trip', () => {
  assert.equal(CL.patientRef({ id: 'pt_42', name: 'דנה', phone: '0501234567' }), 'id:pt_42');
  assert.equal(CL.patientRef({ patientId: 'P-7' }), 'id:P-7');
  assert.equal(CL.patientRef({ name: 'דנה', phone: '050-123-4567' }), 'phone:0501234567');
  assert.equal(CL.patientRef({ name: 'דנה', phone: '+972 50 123 4567' }), 'phone:0501234567');
  assert.equal(CL.patientRef({ name: 'דנה', phone: '12345' }), '', 'a non-Israeli number is no reference');
  assert.equal(CL.patientRef({ name: 'דנה' }), '', 'the name alone is never a reference');
  const sb = sandbox();
  for (const p of [{ id: 'pt_42' }, { phone: '050-123-4567' }, { name: 'x' }]) assert.equal(sb.ctx._contPatientRef(p), CL.patientRef(p));
  const id = CL.milestoneTaskId('phone:0501234567', '2026-09-15', 2);
  assert.equal(id, 'cont::phone:0501234567::2026-09-15::m2');
  assert.deepEqual(CL.parseMilestoneTaskId(id), { ref: 'phone:0501234567', entryDate: '2026-09-15', n: 2 });
  assert.deepEqual(plain(sb.ctx._contParseTaskId(id)), { ref: 'phone:0501234567', entryDate: '2026-09-15', n: 2 });
  assert.equal(CL.parseMilestoneTaskId('task-abc'), null);
  assert.equal(CL.subjectId('phone:0501234567'), 'cont:phone:0501234567');
  assert.equal(CL.subjectId(''), '');
});

test('linking roster patients to outpatient records: phone only, exactly one match, never the name', () => {
  const clients = [{ id: 'c1', name: 'נועה לוי', phone: '0501111111' }, { id: 'c2', name: 'נועה לוי', phone: '0502222222' }];
  const leads = [{ id: 'l1', name: 'רון כהן', phone: '0503333333', stage: 'new' }, { id: 'l2', name: 'עמית', phone: '0501111111', stage: 'removed' }];
  assert.deepEqual(CL.linkPatient({ name: 'נועה לוי', phone: '050-111-1111' }, clients, leads), { state: 'linked', clientId: 'c1', leadId: '', reason: 'client' });
  assert.deepEqual(CL.linkPatient({ name: 'רון כהן', phone: '0503333333' }, clients, leads), { state: 'linked', clientId: '', leadId: 'l1', reason: 'lead' });
  assert.equal(CL.linkPatient({ name: 'נועה לוי', phone: '' }, clients, leads).state, 'none', 'same name, no phone → not linked');
  assert.equal(CL.linkPatient({ name: 'נועה לוי', phone: '0509999999' }, clients, leads).state, 'none');
  const amb = CL.linkPatient({ name: 'x', phone: '0501111111' }, clients.concat([{ id: 'c3', phone: '0501111111' }]), []);
  assert.equal(amb.state, 'ambiguous'); assert.equal(amb.matches, 2); assert.equal(amb.clientId, '');
});

function syncWith(sb, patients, user) {
  return sb.post({ action: 'syncContinuationMilestones', user: user || 'ורד', patients, rosterComplete: true });
}
const openIds = (sb) => sb.rows('Tasks').filter((t) => t.status === 'open').map((t) => t.id).sort();

test('sync: creates the three milestone tasks once (idempotent), under the stable subject, owner ורד, never money', () => {
  const sb = sandbox();
  const r1 = syncWith(sb, [{ name: 'נועה', house: 'ramot', entryDate: '2026-10-20', phone: '050-1234567' }]);
  assert.equal(r1.ok, true); assert.equal(r1.created, 3);
  const r2 = syncWith(sb, [{ name: 'נועה', house: 'ramot', entryDate: '2026-10-20', phone: '0501234567' }]);
  assert.deepEqual([r2.created, r2.updated, r2.cancelled], [0, 0, 0], 'a second sync creates nothing');
  const tasks = sb.rows('Tasks');
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((t) => t.id).sort(), ['m1', 'm2', 'm3'].map((m) => 'cont::phone:0501234567::2026-10-20::' + m).sort());
  for (const t of tasks) {
    assert.equal(t.clientId, 'cont:phone:0501234567'); assert.equal(t.leadId, '');
    assert.equal(t.kind, 'continuity'); assert.equal(t.source, 'derived'); assert.equal(t.assignee, 'ורד');
    assert.equal(t.status, 'open'); assert.equal(t.money, ''); assert.equal(t.createdBy, 'system');
    assert.match(String(t.reason), /אבן דרך \d\d\/\d\d\/\d{4} · כניסה 20\/10\/2026/);
  }
  assert.deepEqual(tasks.map((t) => t.dueDate).sort(), ['2026-11-06', '2026-12-06', '2027-01-06']);
  // visible through the ordinary getTasks read, for an ops session too (not money)
  const ops = sb.post({ action: 'getTasks', user: 'דנה', moneyScope: 'ops' });
  assert.equal(ops.tasks.length, 3);
  assert.equal(sb.rows('Activity').filter((e) => e.kind === 'task_created').length, 3);
});

test('sync: no entry date → no task («חסר תאריך כניסה»); no id/phone → no task; a milestone already in the past is not opened', () => {
  const sb = sandbox();
  const r = syncWith(sb, [
    { name: 'א', house: 'ramot', entryDate: '', phone: '0501111111' },
    { name: 'ב', house: 'ramot', entryDate: '2026-10-20' },               // name only
    { name: 'ג', house: 'ramot', entryDate: '2026-08-20', phone: '0502222222' } // month 1 (20/09) and 2 (20/10) passed; month 3 = 20/11
  ]);
  assert.equal(r.ok, true); assert.equal(r.skipped, 2);
  assert.deepEqual(openIds(sb), ['cont::phone:0502222222::2026-08-20::m3']);
  assert.equal(sb.rows('Tasks')[0].dueDate, '2026-11-06');
});

test('sync: a corrected entry date MOVES the open tasks (same count, new ids/dates) instead of duplicating; done tasks stay', () => {
  const sb = sandbox();
  syncWith(sb, [{ name: 'נועה', house: 'ramot', entryDate: '2026-10-20', phone: '0501234567' }]);
  // Vered already handled month 1
  const m1 = 'cont::phone:0501234567::2026-10-20::m1';
  const done = sb.post({ action: 'completeTask', user: 'ורד', id: m1, outcome: 'דיברנו' });
  assert.equal(done.ok, true);
  const r = syncWith(sb, [{ name: 'נועה', house: 'ramot', entryDate: '2026-10-25', phone: '0501234567' }]);
  assert.deepEqual([r.created, r.updated, r.cancelled], [1, 2, 0]);
  const tasks = sb.rows('Tasks');
  assert.equal(tasks.length, 4, 'm1 done (old date) + m1 new + m2/m3 moved');
  assert.deepEqual(openIds(sb), ['m1', 'm2', 'm3'].map((m) => 'cont::phone:0501234567::2026-10-25::' + m));
  assert.deepEqual(tasks.filter((t) => t.status === 'open').map((t) => t.dueDate).sort(), ['2026-11-11', '2026-12-11', '2027-01-11']);
  assert.equal(tasks.find((t) => t.id === m1).status, 'done');
  assert.equal(sb.rows('Activity').filter((e) => e.kind === 'task_rescheduled').length, 2);
  // and again: nothing changes
  const r2 = syncWith(sb, [{ name: 'נועה', house: 'ramot', entryDate: '2026-10-25', phone: '0501234567' }]);
  assert.deepEqual([r2.created, r2.updated, r2.cancelled], [0, 0, 0]);
});

test('sync: discharge (left the roster) and terminal CRM status close the open tasks; an incomplete roster never cancels', () => {
  const sb = sandbox();
  syncWith(sb, [{ name: 'א', house: 'ramot', entryDate: '2026-10-20', phone: '0501111111' }, { name: 'ב', house: 'asher', entryDate: '2026-10-22', phone: '0502222222' }]);
  assert.equal(openIds(sb).length, 6);
  // partial / failed roster: rosterComplete false → nothing cancelled
  const partial = sb.post({ action: 'syncContinuationMilestones', user: 'ורד', patients: [], rosterComplete: false });
  assert.equal(partial.cancelled, 0);
  // א discharged
  const r = syncWith(sb, [{ name: 'ב', house: 'asher', entryDate: '2026-10-22', phone: '0502222222' }]);
  assert.equal(r.cancelled, 3);
  assert.deepEqual(openIds(sb).map((id) => id.split('::')[1]), ['phone:0502222222', 'phone:0502222222', 'phone:0502222222']);
  assert.ok(sb.rows('Tasks').filter((t) => t.status === 'cancelled').every((t) => t.outcome === 'discharged'));
  // ב declined → closed by the next sync, and nothing new is opened for her
  const save = sb.post({ action: 'saveContinuation', user: 'ורד', key: 'ב|asher|2026-10-22', name: 'ב', house: 'asher', entryDate: '2026-10-22', crmStatus: 'declined', assignee: 'ורד', patientRef: 'phone:0502222222', phone: '0502222222' });
  assert.equal(save.ok, true);
  const r2 = syncWith(sb, [{ name: 'ב', house: 'asher', entryDate: '2026-10-22', phone: '0502222222' }]);
  assert.equal(r2.cancelled, 3); assert.equal(r2.created, 0);
  assert.deepEqual(openIds(sb), []);
  assert.equal(sb.post({ action: 'syncContinuationMilestones', user: 'ורד' }).error, 'missing_patients');
});

test('saveContinuation: CRM columns validated fail-closed, kept when a legacy payload omits them, stored in the appended columns', () => {
  const sb = sandbox();
  const base = { action: 'saveContinuation', user: 'ורד', key: 'נועה|ramot|2026-10-20', name: 'נועה', house: 'ramot', entryDate: '2026-10-20' };
  assert.equal(sb.post(Object.assign({}, base, { crmStatus: 'maybe' })).reason, 'invalid_crm_status');
  assert.equal(sb.post(Object.assign({}, base, { assignee: 'ירדן' })).reason, 'invalid_assignee', 'a retired name is not an assignee');
  assert.equal(sb.post(Object.assign({}, base, { assignee: 'שירן' })).reason, 'invalid_assignee');
  assert.equal(sb.post(Object.assign({}, base, { offerRequestId: 'not-a-uuid' })).reason, 'invalid_offer');
  assert.equal(sb.post(Object.assign({}, base, { patientRef: 'name:נועה' })).reason, 'invalid_patient_ref', 'never a name reference');
  assert.equal(sb.post(Object.assign({}, base, { phone: '12' })).reason, 'invalid_phone');
  const ok = sb.post(Object.assign({}, base, { crmStatus: 'interested', assignee: 'ורד', patientRef: 'phone:0501234567', phone: '050-1234567', offerRequestId: '11111111-1111-4111-8111-111111111111' }));
  assert.equal(ok.ok, true);
  let row = sb.rows('מסלול המשך')[0];
  assert.equal(row.crmStatus, 'interested'); assert.equal(row.assignee, 'ורד'); assert.equal(row.phone, '0501234567'); assert.equal(row.patientRef, 'phone:0501234567');
  // legacy client: only the original fields → CRM columns are preserved
  const legacy = sb.post(Object.assign({}, base, { meetingDate: '2026-11-10', outcome: 'continuing', note: 'שיחה טובה' }));
  assert.equal(legacy.ok, true);
  row = sb.rows('מסלול המשך')[0];
  assert.equal(row.meetingDate, '2026-11-10'); assert.equal(row.crmStatus, 'interested'); assert.equal(row.assignee, 'ורד'); assert.equal(row.offerRequestId, '11111111-1111-4111-8111-111111111111');
  // round trip through the read
  const read = sb.get({ action: 'getContinuation', proxySecret: PROXY });
  assert.equal(read.rows[0].crmStatus, 'interested');
  // header order: the five CRM columns are APPENDED, the nine legacy columns untouched
  assert.deepEqual(plain(sb.ctx.CONTINUATION_HEADERS).slice(0, 9), ['key', 'name', 'house', 'entryDate', 'meetingDate', 'outcome', 'outcomeDate', 'note', 'updatedAt']);
  assert.deepEqual(plain(sb.ctx.CONTINUATION_HEADERS).slice(9), ['crmStatus', 'assignee', 'offerRequestId', 'patientRef', 'phone']);
});

test('a contact logged on a milestone task closes it, is filed under the stable subject and keeps the other milestones open', () => {
  const sb = sandbox();
  syncWith(sb, [{ name: 'נועה', house: 'ramot', entryDate: '2026-10-20', phone: '0501234567' }]);
  const m1 = 'cont::phone:0501234567::2026-10-20::m1';
  const r = sb.post({ action: 'logContact', user: 'ורד', submissionId: 'sub-cont-1', contact: { clientId: 'cont:phone:0501234567', channel: 'phone', outcome: 'awaiting_decision', summary: 'הוצעה חבילת המשך', taskId: m1 }, next: { none: true, explanation: 'ממתינים לתשובה עד אבן הדרך הבאה' } });
  assert.equal(r.ok, true);
  const tasks = sb.rows('Tasks');
  assert.equal(tasks.find((t) => t.id === m1).status, 'done');
  assert.equal(tasks.filter((t) => t.status === 'open').length, 2, 'passing 14 days or sending an offer never closes the other milestones');
  const ev = sb.rows('Activity').find((e) => e.kind === 'contact_logged');
  assert.equal(ev.clientId, 'cont:phone:0501234567');
  // the summary the UI shows
  const CA = require('../public/crm-activity.js');
  const sum = CA.summarize(sb.post({ action: 'getTasks', user: 'ורד' }).tasks, sb.get({ action: 'getActivity', proxySecret: PROXY }).events, { clientId: 'cont:phone:0501234567' }, '2026-11-03');
  assert.equal(sum.lastContact.outcome, 'awaiting_decision');
  assert.equal(sum.nextAction.id, 'cont::phone:0501234567::2026-10-20::m2');
});

test('server: the sync action is server-only (403 from /api/sheets); routes exist; my-day routes continuation tasks to the tab', () => {
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(SRV, /body\.action === 'syncContinuationMilestones'\) \{\s*return res\.status\(403\)/);
  assert.match(SRV, /app\.post\('\/api\/continuation-sync', requireSession/);
  assert.match(SRV, /action: 'syncContinuationMilestones', proxySecret: OUTPATIENT_PROXY_SECRET/);
  assert.match(SRV, /rosterComplete: true/);
  assert.match(SRV, /await runContinuationSync\(got\.data, sessionUserFromRequest\(req\)\)/, 'a fresh roster syncs before answering');
  const MyDay = require('../public/my-day.js');
  const m = MyDay.build({
    leads: [], clients: [], stopFlags: [], extraRequests: [], continuation: [], tasks: [
      { id: 'cont::phone:0501234567::2026-10-20::m1', kind: 'continuity', clientId: 'cont:phone:0501234567', leadId: '', title: 'הצעת המשך טיפול — לפני חודש 1 בבית', reason: 'אבן דרך 20/11/2026', assignee: 'ורד', dueDate: '2026-11-01', status: 'open' },
      { id: 'cont::phone:0501234567::2026-10-20::m2', kind: 'continuity', clientId: 'cont:phone:0501234567', leadId: '', title: 'הצעת המשך טיפול — לפני חודש 2 בבית', assignee: 'ורד', dueDate: '2026-12-06', status: 'open' }
    ], activity: [{ eventId: 'e1', kind: 'contact_logged', occurredAt: '2026-10-30T10:00:00Z', actorName: 'ורד', clientId: 'cont:phone:0501234567', summary: 'שיחה', detailsJson: '{"outcome":"no_answer"}' }],
    continuationNames: { 'cont:phone:0501234567': 'נועה לוי' }, today: '2026-11-03', user: 'ורד', renewalInfo: () => ({ status: 'unknown' })
  });
  const late = m.sections.find((x) => x.id === 'critical').rows;
  assert.equal(late.length, 1); assert.equal(late[0].name, 'נועה לוי'); assert.equal(late[0].open, 'continuation'); assert.equal(late[0].state, 'late');
  assert.equal(MyDay.lastContactText(late[0]), '30/10/2026 · אין מענה');
  const later = m.sections.find((x) => x.id === 'later').rows;
  assert.equal(later.length, 1, 'the December milestone waits in «בהמשך»');
  assert.equal(later[0].state, 'wait');
});
