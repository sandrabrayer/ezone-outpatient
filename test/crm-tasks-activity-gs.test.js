'use strict';

/* OP-CRM-3B — Tasks + Activity + contact history (real Code.gs in the sandbox).
 * Idempotency by submissionId, server-verified actor, money tasks invisible to
 * an ops session, defer / complete / reassign / withdraw, logContact as one
 * transaction with no default follow-up date, auth table + append-only schema. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const plain = (x) => JSON.parse(JSON.stringify(x));
function post(sb, body, user = 'ורד', scope = 'full') { return sb.post(Object.assign({ user, moneyScope: scope }, body)); }
function get(sb, params) { return sb.get(Object.assign({ proxySecret: sb.props.OUTPATIENT_PROXY_SECRET }, params)); }
const TASK = { kind: 'call', leadId: 'L1', title: 'לחזור לרונית', dueDate: '2026-11-03', dueTime: '10:30', assignee: 'דנה', reason: 'ביקשה שנחזור' };

test('schema + auth: Tasks/Activity headers, internal-only actions, never a cross-app secret', () => {
  const { ctx } = sandbox();
  assert.deepEqual(plain(ctx.TASKS_HEADERS), ['id', 'kind', 'leadId', 'clientId', 'title', 'reason', 'assignee', 'dueDate', 'dueTime', 'status', 'source', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'doneAt', 'doneBy', 'outcome', 'deferredFrom', 'contactEventId', 'submissionId', 'money']);
  assert.deepEqual(plain(ctx.ACTIVITY_HEADERS), ['eventId', 'occurredAt', 'recordedAt', 'kind', 'source', 'actorName', 'leadId', 'clientId', 'summary', 'detailsJson', 'nextAction', 'nextDate']);
  const P = plain(ctx.SOURCE_POST_AUTH), G = plain(ctx.SOURCE_GET_AUTH);
  for (const a of ['getTasks', 'getActivity', 'createTask', 'completeTask', 'deferTask', 'reassignTask', 'withdrawTask', 'logContact']) assert.equal(P[a], 'OUTPATIENT_PROXY_SECRET', a);
  for (const a of ['getTasks', 'getActivity']) assert.equal(G[a], 'OUTPATIENT_PROXY_SECRET', a);
  for (const a of ['createTask', 'logContact']) assert.equal(G[a], undefined, a + ' is never a GET');
  // no proxy key -> unauthorized, nothing created
  const sb = sandbox();
  const r = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'createTask', submissionId: 'x1', task: TASK, user: 'ורד' }) } }).getContent());
  assert.equal(r.error, 'unauthorized');
  assert.equal(sb.sheets.Tasks, undefined);
});

test('createTask: idempotent by submissionId, actor from the proxy, validation fails closed', () => {
  const sb = sandbox();
  const a = post(sb, { action: 'createTask', submissionId: 's1', task: TASK });
  assert.equal(a.ok, true); assert.equal(a.created, true);
  assert.equal(a.task.id, 'task-s1'); assert.equal(a.task.status, 'open'); assert.equal(a.task.createdBy, 'ורד'); assert.equal(a.task.assignee, 'דנה');
  const b = post(sb, { action: 'createTask', submissionId: 's1', task: Object.assign({}, TASK, { title: 'שונה' }) });
  assert.equal(b.created, false); assert.equal(b.replayed, true); assert.equal(b.task.title, 'לחזור לרונית');
  assert.equal(sb.rows('Tasks').length, 1);
  assert.equal(sb.rows('Activity').length, 1, 'one task_created event, not two');
  assert.equal(sb.rows('Activity')[0].eventId, 'task_created:task-s1');
  // defaults: assignee = actor when blank
  const c = post(sb, { action: 'createTask', submissionId: 's2', task: { kind: 'other', clientId: 'C1', title: 'x' } }, 'אורן');
  assert.equal(c.task.assignee, 'אורן'); assert.equal(c.task.dueDate, '');
  // validation
  assert.equal(post(sb, { action: 'createTask', submissionId: 'bad id', task: TASK }).error, 'bad_submission_id');
  assert.equal(post(sb, { action: 'createTask', submissionId: 's3', task: Object.assign({}, TASK, { kind: 'payment' }) }).error, 'bad_kind');
  assert.equal(post(sb, { action: 'createTask', submissionId: 's4', task: { kind: 'call', title: 'x' } }).error, 'missing_subject');
  assert.equal(post(sb, { action: 'createTask', submissionId: 's5', task: Object.assign({}, TASK, { dueDate: '03/11/2026' }) }).error, 'bad_due');
  assert.equal(post(sb, { action: 'createTask', submissionId: 's6', task: Object.assign({}, TASK, { assignee: 'מישהו' }) }).error, 'bad_assignee');
  assert.equal(post(sb, { action: 'createTask', submissionId: 's7', task: Object.assign({}, TASK, { title: '' }) }).error, 'missing_title');
  assert.equal(sb.rows('Tasks').length, 2);
});

test('money tasks: an ops session cannot create, see or touch them; a full session can', () => {
  const sb = sandbox();
  assert.equal(post(sb, { action: 'createTask', submissionId: 'm1', task: Object.assign({}, TASK, { kind: 'collection' }) }, 'דנה', 'ops').error, 'forbidden_money_task');
  assert.equal(post(sb, { action: 'createTask', submissionId: 'm2', task: Object.assign({}, TASK, { money: true }) }, 'דנה', 'ops').error, 'forbidden_money_task');
  post(sb, { action: 'createTask', submissionId: 'm3', task: Object.assign({}, TASK, { kind: 'collection', title: 'גבייה' }) });
  post(sb, { action: 'createTask', submissionId: 'm4', task: TASK });
  assert.equal(get(sb, { action: 'getTasks', moneyScope: 'ops' }).tasks.map((t) => t.id).join(), 'task-m4');
  assert.equal(get(sb, { action: 'getTasks', moneyScope: 'full' }).tasks.length, 2);
  assert.equal(get(sb, { action: 'getTasks' }).tasks.length, 2, 'no scope = legacy full read');
  assert.equal(post(sb, { action: 'completeTask', id: 'task-m3' }, 'דנה', 'ops').error, 'not_found');
  assert.equal(post(sb, { action: 'completeTask', id: 'task-m3' }).ok, true);
  // Activity: the money task's whole trail (created / completed) is invisible to ops —
  // its title is free text («לגבות ₪3,000») — while the call task's trail stays.
  const act = get(sb, { action: 'getActivity', moneyScope: 'ops' }).events;
  assert.equal(act.some((e) => /task-m3/.test(e.detailsJson) || /גבייה/.test(e.summary) || /גבייה/.test(e.nextAction)), false, 'no money-task event reaches ops');
  assert.equal(act.filter((e) => /task-m4/.test(e.detailsJson)).length, 1, 'the call task event is still there');
  const full = get(sb, { action: 'getActivity', moneyScope: 'full' }).events;
  assert.equal(full.filter((e) => /task-m3/.test(e.detailsJson)).map((e) => e.kind).sort().join(), 'task_completed,task_created', 'ורד sees the money trail');
  assert.equal(get(sb, { action: 'getActivity' }).events.length, full.length, 'no scope = legacy full read');
  for (const e of full) assert.equal(JSON.parse(e.detailsJson).money, /task-m3/.test(e.detailsJson), e.kind + ' carries the money flag');
});

test('money trail via logContact and legacy (unflagged) events: filtered for ops by the Tasks sheet, kept for ורד', () => {
  const sb = sandbox();
  post(sb, { action: 'createTask', submissionId: 'c1', task: Object.assign({}, TASK, { kind: 'collection', title: 'לגבות 3000' }) });
  // a contact that CLOSES the money task, and one that SPAWNS a money follow-up
  const r1 = post(sb, { action: 'logContact', submissionId: 'k1', contact: { leadId: 'L1', channel: 'phone', outcome: 'spoke_follow_up', summary: 'הבטיחה לשלם', taskId: 'task-c1' }, next: { none: true, explanation: 'שולם' } });
  assert.equal(r1.ok, true); assert.equal(r1.completed.status, 'done');
  const r2 = post(sb, { action: 'logContact', submissionId: 'k2', contact: { leadId: 'L1', channel: 'phone', outcome: 'call_back_later', summary: 'לא ענתה' }, next: { dueDate: '2026-12-01', kind: 'collection', title: 'גבייה חוזרת' } });
  assert.equal(r2.ok, true); assert.equal(r2.created.kind, 'collection');
  // a plain contact that must survive
  post(sb, { action: 'logContact', submissionId: 'k3', contact: { leadId: 'L1', channel: 'whatsapp', outcome: 'no_answer', summary: 'הודעה' }, next: { none: true, explanation: 'ננסה שוב' } });
  // legacy row: a task_deferred event for the money task written WITHOUT a money flag
  const act = sb.sheets.Activity;
  const legacy = act.grid[1].slice();
  const H = act.grid[0];
  legacy[H.indexOf('eventId')] = 'legacy-1'; legacy[H.indexOf('kind')] = 'task_deferred'; legacy[H.indexOf('summary')] = 'המשימה נדחתה: לגבות 3000';
  legacy[H.indexOf('detailsJson')] = JSON.stringify({ prev: '2026-11-03', next: '2026-11-10', id: 'task-c1' });
  act.grid.push(legacy);
  const ops = get(sb, { action: 'getActivity', moneyScope: 'ops' }).events;
  assert.deepEqual(ops.map((e) => e.eventId), ['contact:k3'], 'ops sees only the plain contact');
  const full = get(sb, { action: 'getActivity', moneyScope: 'full' }).events.map((e) => e.eventId).sort();
  assert.deepEqual(full, ['contact:k1', 'contact:k2', 'contact:k3', 'legacy-1', 'task_created:task-c1'], 'a logContact follow-up has no task_created event of its own (the contact event carries nextTaskId)');
  assert.equal(JSON.parse(get(sb, { action: 'getActivity', moneyScope: 'full', limit: 600 }).events.find((e) => e.eventId === 'contact:k1').detailsJson).money, true);
  assert.equal(sb.sheets.Tasks.grid.length, 3, 'read never writes');
});

test('complete / defer / reassign / withdraw: state machine, history, no second completion', () => {
  const sb = sandbox();
  post(sb, { action: 'createTask', submissionId: 't1', task: TASK });
  const d = post(sb, { action: 'deferTask', id: 'task-t1', dueDate: '2026-11-10', dueTime: '', reason: 'ביקשה שבוע' }, 'דנה');
  assert.equal(d.ok, true); assert.equal(d.task.status, 'deferred'); assert.equal(d.task.dueDate, '2026-11-10'); assert.equal(d.task.deferredFrom, '2026-11-03'); assert.equal(d.task.updatedBy, 'דנה');
  assert.equal(post(sb, { action: 'deferTask', id: 'task-t1', dueDate: '2026-11-11' }).error, 'missing_reason');
  assert.equal(post(sb, { action: 'deferTask', id: 'task-t1', reason: 'xx' }).error, 'bad_due');
  const r = post(sb, { action: 'reassignTask', id: 'task-t1', assignee: 'אורן' });
  assert.equal(r.task.assignee, 'אורן');
  assert.equal(post(sb, { action: 'reassignTask', id: 'task-t1', assignee: 'ירדן' }).error, 'bad_assignee');
  const c = post(sb, { action: 'completeTask', id: 'task-t1', outcome: 'דיברנו, מגיעה ביום ג' });
  assert.equal(c.task.status, 'done'); assert.equal(c.task.doneBy, 'ורד'); assert.match(c.task.doneAt, /^\d{4}-/);
  const again = post(sb, { action: 'completeTask', id: 'task-t1' });
  assert.equal(again.error, 'not_open'); assert.equal(again.task.status, 'done');
  assert.equal(post(sb, { action: 'withdrawTask', id: 'task-t1', reason: 'xx' }).error, 'not_open');
  post(sb, { action: 'createTask', submissionId: 't2', task: TASK });
  assert.equal(post(sb, { action: 'withdrawTask', id: 'task-t2' }).error, 'missing_reason');
  const w = post(sb, { action: 'withdrawTask', id: 'task-t2', reason: 'כפול' });
  assert.equal(w.task.status, 'cancelled'); assert.equal(sb.rows('Tasks').length, 2, 'cancelled rows stay');
  assert.equal(post(sb, { action: 'completeTask', id: 'nope' }).error, 'not_found');
  const kinds = sb.rows('Activity').map((e) => e.kind);
  assert.deepEqual(kinds, ['task_created', 'task_deferred', 'task_reassigned', 'task_completed', 'task_created', 'task_cancelled']);
  const ev = sb.rows('Activity').find((e) => e.kind === 'task_deferred');
  assert.equal(ev.actorName, 'דנה'); assert.equal(ev.leadId, 'L1'); assert.equal(ev.nextDate, '2026-11-10');
  assert.deepEqual(JSON.parse(ev.detailsJson), { prev: '2026-11-03', next: '2026-11-10', reason: 'ביקשה שבוע', id: 'task-t1', money: false });
});

test('logContact: one transaction — event + fulfilled task + follow-up; replay writes nothing twice; no default date', () => {
  const sb = sandbox();
  post(sb, { action: 'createTask', submissionId: 'c0', task: TASK });
  const r = post(sb, { action: 'logContact', submissionId: 'k1',
    contact: { leadId: 'L1', channel: 'whatsapp', outcome: 'call_back_later', summary: 'ביקשה שנחזור אחרי החג', withWhom: 'רונית', taskId: 'task-c0', occurredAt: '2026-11-02T09:15' },
    next: { dueDate: '2026-11-05', dueTime: '11:00', assignee: 'דנה' } }, 'דנה');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.event.eventId, 'contact:k1'); assert.equal(r.event.occurredAt, '2026-11-02T09:15:00');
  assert.match(r.event.summary, /^התבקשנו לחזור במועד · ביקשה שנחזור/);
  assert.equal(r.completed.id, 'task-c0'); assert.equal(r.completed.status, 'done'); assert.equal(r.completed.contactEventId, 'contact:k1');
  assert.equal(r.created.id, 'task-k1-next'); assert.equal(r.created.source, 'contact'); assert.equal(r.created.dueDate, '2026-11-05'); assert.equal(r.created.dueTime, '11:00'); assert.equal(r.created.assignee, 'דנה');
  assert.equal(r.created.title, 'שיחה חוזרת עם רונית'); assert.equal(r.created.reason, 'התבקשנו לחזור במועד');
  assert.equal(r.replayed, false);
  const ev = sb.rows('Activity').find((e) => e.eventId === 'contact:k1');
  assert.equal(ev.actorName, 'דנה'); assert.equal(ev.nextAction, 'שיחה חוזרת עם רונית'); assert.equal(ev.nextDate, '2026-11-05');
  assert.equal(JSON.parse(ev.detailsJson).channel, 'whatsapp');
  // replay after a lost response
  const again = post(sb, { action: 'logContact', submissionId: 'k1', contact: { leadId: 'L1', channel: 'whatsapp', outcome: 'call_back_later', taskId: 'task-c0' }, next: { dueDate: '2026-11-05' } }, 'דנה');
  assert.equal(again.replayed, true); assert.equal(again.created.id, 'task-k1-next');
  assert.equal(sb.rows('Activity').filter((e) => e.eventId === 'contact:k1').length, 1);
  assert.equal(sb.rows('Tasks').length, 2);
  // no follow-up needs an explanation; a follow-up needs a date (days or dueDate) — never a default
  assert.equal(post(sb, { action: 'logContact', submissionId: 'k2', contact: { clientId: 'C1', outcome: 'no_answer' }, next: { none: true } }).error, 'missing_next_explanation');
  assert.equal(post(sb, { action: 'logContact', submissionId: 'k3', contact: { clientId: 'C1', outcome: 'no_answer' }, next: {} }).error, 'bad_due');
  assert.equal(post(sb, { action: 'logContact', submissionId: 'k4', contact: { clientId: 'C1', outcome: 'no_answer' } }).error, 'missing_next');
  const none = post(sb, { action: 'logContact', submissionId: 'k5', contact: { clientId: 'C1', outcome: 'no_interest_now', summary: 'לא מעוניין' }, next: { none: true, explanation: 'ביקש שלא נחזור' } });
  assert.equal(none.ok, true); assert.equal(none.created, null); assert.match(none.event.nextAction, /^אין המשך: ביקש/);
  const days = post(sb, { action: 'logContact', submissionId: 'k6', contact: { clientId: 'C1', outcome: 'no_answer' }, next: { days: 2 } });
  const expect = new Date(); expect.setUTCDate(expect.getUTCDate() + 2);
  assert.equal(days.created.dueDate, expect.toISOString().slice(0, 10));
  assert.equal(post(sb, { action: 'logContact', submissionId: 'k7', contact: { clientId: 'C1', outcome: 'weird' }, next: { days: 1 } }).error, 'bad_outcome');
  assert.equal(post(sb, { action: 'logContact', submissionId: 'k8', contact: { clientId: 'C1', outcome: 'no_answer', channel: 'fax' }, next: { days: 1 } }).error, 'bad_channel');
  assert.equal(post(sb, { action: 'logContact', submissionId: 'k9', contact: { outcome: 'no_answer' }, next: { days: 1 } }).error, 'missing_subject');
});

test('reads: getTasks filters by status/subject; getActivity newest first with subject filter and limit', () => {
  const sb = sandbox();
  post(sb, { action: 'createTask', submissionId: 'a', task: TASK });
  post(sb, { action: 'createTask', submissionId: 'b', task: Object.assign({}, TASK, { leadId: '', clientId: 'C9', title: 'ב' }) });
  post(sb, { action: 'completeTask', id: 'task-b' });
  assert.equal(get(sb, { action: 'getTasks', status: 'open' }).tasks.length, 1);
  assert.equal(post(sb, { action: 'getTasks', clientId: 'C9' }).tasks[0].id, 'task-b');
  const act = post(sb, { action: 'getActivity', clientId: 'C9' }).events;
  assert.deepEqual(act.map((e) => e.kind), ['task_completed', 'task_created'], 'newest first');
  assert.equal(post(sb, { action: 'getActivity', limit: 1 }).events.length, 1);
  assert.equal(get(sb, { action: 'getActivity' }).events.length, 3);
});
