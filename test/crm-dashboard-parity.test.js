'use strict';

/* Dashboard-CRM parity for the Outpatient contact record (2026-11-21,
 * CHANGELOG-crm-dashboard-parity.md): the three kinds of a record, the outcome
 * «לא נדרש המשך», «קשר הבא» with no default, «מה הלאה», «שיחות אחרונות»,
 * «ביטול תיעוד» (ורד only, append-only), «שינוי מועד», and «היום» as the team page.
 * Server rules run against the REAL Code.gs in the sandbox; the browser rules are
 * the pure core in public/crm-activity.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const CA = require('../public/crm-activity.js');
const MyDay = require('../public/my-day.js');
const users = require('../lib/users');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const APP = read('public/app.js'), HTML = read('public/index.html'), SERVER = read('server.js'), GS = read('apps-script/Code.gs');
const plain = (x) => JSON.parse(JSON.stringify(x));
function post(sb, body, user = 'ורד', scope = 'full') { return sb.post(Object.assign({ user, moneyScope: scope }, body)); }
const details = (row) => JSON.parse(row.detailsJson || '{}');
const TODAY = '2026-11-21';

/* ---------------- the source (Code.gs) ---------------- */

test('logContact: the kind is stored (out / in), defaults to note, and an unknown kind is refused before anything is written', () => {
  const sb = sandbox();
  const out = post(sb, { action: 'logContact', submissionId: 'k-out', contact: { leadId: 'L1', direction: 'out', channel: 'phone', outcome: 'no_answer', reason: 'בירור התעניינות' }, next: { days: 1 } });
  assert.equal(out.ok, true, JSON.stringify(out));
  const inn = post(sb, { action: 'logContact', submissionId: 'k-in', contact: { leadId: 'L1', direction: 'in', channel: 'in_person', outcome: 'awaiting_decision', summary: 'שאלה על מחיר' }, next: { none: true, explanation: 'תחזור אלינו' } });
  assert.equal(inn.ok, true, JSON.stringify(inn));
  const none = post(sb, { action: 'logContact', submissionId: 'k-none', contact: { leadId: 'L1', channel: 'sms', outcome: 'meeting_set' }, next: { none: true, explanation: 'נקבעה פגישה' } });
  assert.equal(none.ok, true, JSON.stringify(none));
  const rows = sb.rows('Activity').filter((e) => e.kind === 'contact_logged');
  assert.deepEqual(rows.map((e) => details(e).direction), ['out', 'in', 'note'], 'no kind sent = «תיעוד שיחה», never guessed');
  assert.equal(details(rows[0]).reason, 'בירור התעניינות');
  assert.match(rows[0].summary, /^שיחה יוצאת · לא היה מענה/);
  assert.match(rows[1].summary, /^שיחה נכנסת · ממתינים להחלטה או למידע · שאלה על מחיר/);
  assert.match(rows[2].summary, /^נקבעה פגישה/, 'a plain record keeps the old wording');
  assert.deepEqual([details(rows[1]).channel, details(rows[2]).channel], ['in_person', 'sms']);
  // legacy channel still accepted (rows already written keep validating)
  assert.equal(post(sb, { action: 'logContact', submissionId: 'k-legacy', contact: { leadId: 'L1', channel: 'meeting', outcome: 'meeting_set' }, next: { none: true, explanation: 'נקבעה' } }).ok, true);
  // fail closed
  const before = sb.rows('Activity').length;
  const bad = post(sb, { action: 'logContact', submissionId: 'k-bad', contact: { leadId: 'L1', direction: 'sideways', outcome: 'no_answer' }, next: { days: 1 } });
  assert.equal(bad.error, 'bad_direction');
  assert.equal(sb.rows('Activity').length, before, 'nothing written');
  assert.deepEqual(plain(sb.ctx.CONTACT_DIRECTIONS), ['out', 'in', 'note']);
  assert.deepEqual(plain(sb.ctx.ACTIVITY_HEADERS).length, 12, 'no sheet column was added');
});

test('logContact: «התקיימה שיחה — לא נדרש המשך» needs no typed explanation; every other outcome still does', () => {
  const sb = sandbox();
  const ok = post(sb, { action: 'logContact', submissionId: 'n1', contact: { clientId: 'C1', direction: 'in', outcome: 'spoke_no_follow_up' }, next: { none: true } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.created, null);
  const ev = sb.rows('Activity')[0];
  assert.equal(details(ev).noNext, 'לא נדרש המשך');
  assert.equal(ev.nextAction, 'אין המשך: לא נדרש המשך');
  assert.equal(post(sb, { action: 'logContact', submissionId: 'n2', contact: { clientId: 'C1', outcome: 'no_interest_now' }, next: { none: true } }).error, 'missing_next_explanation');
  assert.equal(post(sb, { action: 'logContact', submissionId: 'n3', contact: { clientId: 'C1', outcome: 'spoke_follow_up' }, next: {} }).error, 'bad_due', 'still no default date — ever');
});

test('voidContact: ורד only, append-only, cancels the OPEN follow-up it created, idempotent; a fulfilled or finished task is untouched', () => {
  const sb = sandbox();
  post(sb, { action: 'createTask', submissionId: 't0', task: { kind: 'call', leadId: 'L1', title: 'להתקשר', dueDate: '2026-11-20', dueTime: '10:00' } });
  // the record fulfils task-t0 and creates a follow-up
  const c = post(sb, { action: 'logContact', submissionId: 'dup', contact: { leadId: 'L1', direction: 'out', outcome: 'call_back_later', summary: 'הוזן פעמיים', taskId: 'task-t0' }, next: { days: 2, title: 'לחזור' } });
  assert.equal(c.ok, true); assert.equal(c.created.id, 'task-dup-next');
  const eventId = 'contact:dup';
  const original = plain(sb.rows('Activity').find((e) => e.eventId === eventId));
  // auth table: an internal POST, never a GET, never a cross-app secret
  assert.equal(plain(sb.ctx.SOURCE_POST_AUTH).voidContact, 'OUTPATIENT_PROXY_SECRET');
  assert.equal(plain(sb.ctx.SOURCE_GET_AUTH).voidContact, undefined);
  assert.deepEqual(plain(sb.ctx.CONTACT_VOID_USERS), ['ורד']);
  // fail closed: role, id shape, reason, unknown id — nothing written by any of them
  const n0 = sb.rows('Activity').length;
  for (const who of ['דנה', 'אורן', '', 'ירדן']) assert.equal(post(sb, { action: 'voidContact', eventId, reason: 'טעות' }, who).error, 'forbidden_user', who);
  assert.equal(post(sb, { action: 'voidContact', eventId: 'task_created:task-t0', reason: 'טעות' }).error, 'bad_event_id');
  assert.equal(post(sb, { action: 'voidContact', eventId: 'contact:<b>', reason: 'טעות' }).error, 'bad_event_id');
  assert.equal(post(sb, { action: 'voidContact', eventId, reason: 'x' }).error, 'missing_reason');
  assert.equal(post(sb, { action: 'voidContact', eventId: 'contact:nope', reason: 'טעות' }).error, 'not_found');
  assert.equal(sb.rows('Activity').length, n0);
  assert.equal(sb.rows('Tasks').find((t) => t.id === 'task-dup-next').status, 'open');
  // the void
  const v = post(sb, { action: 'voidContact', eventId, reason: 'הוזן פעמיים' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(plain(v.voided), { eventId, by: 'ורד' });
  assert.equal(v.cancelledTask.id, 'task-dup-next'); assert.equal(v.cancelledTask.status, 'cancelled');
  const events = sb.rows('Activity');
  assert.deepEqual(plain(events.find((e) => e.eventId === eventId)), original, 'the record itself is never edited or deleted');
  const voidEv = events.find((e) => e.kind === 'contact_voided');
  assert.equal(voidEv.eventId, 'void:' + eventId); assert.equal(voidEv.actorName, 'ורד'); assert.equal(voidEv.leadId, 'L1');
  assert.deepEqual(details(voidEv), { supersedesEventId: eventId, reason: 'הוזן פעמיים', cancelledTaskId: 'task-dup-next', money: false });
  const tasks = Object.fromEntries(sb.rows('Tasks').map((t) => [t.id, t]));
  assert.equal(tasks['task-dup-next'].status, 'cancelled'); assert.match(tasks['task-dup-next'].outcome, /^התיעוד בוטל: הוזן פעמיים/); assert.equal(tasks['task-dup-next'].doneBy, 'ורד');
  assert.equal(tasks['task-t0'].status, 'done', 'the task the record FULFILLED stays done');
  // idempotent
  const again = post(sb, { action: 'voidContact', eventId, reason: 'שוב' });
  assert.equal(again.ok, true); assert.equal(again.replayed, true); assert.equal(again.cancelledTask, null);
  assert.equal(sb.rows('Activity').filter((e) => e.kind === 'contact_voided').length, 1);
  // a follow-up that was already completed is left alone
  const c2 = post(sb, { action: 'logContact', submissionId: 'two', contact: { leadId: 'L1', outcome: 'no_answer' }, next: { days: 1 } });
  post(sb, { action: 'completeTask', id: c2.created.id, outcome: 'בוצע' });
  const v2 = post(sb, { action: 'voidContact', eventId: 'contact:two', reason: 'טעות' });
  assert.equal(v2.ok, true); assert.equal(v2.cancelledTask, null);
  assert.equal(sb.rows('Tasks').find((t) => t.id === c2.created.id).status, 'done');
});

test('voidContact: a voided record no longer counts as «contacted» in the Dashboard handoff feed', () => {
  const SECRET = 'handoff-status-fixture-secret-0123456789';
  const sb = sandbox([{ id: 'L-new', name: 'חדש', phone: '0501111111', stage: 'פרטים אישיים', created: '2026-10-28', assignedTo: 'ורד' }], []);
  sb.props.HANDOFF_STATUS_SECRET = SECRET;
  const state = () => sb.get({ action: 'getHandoffStatus', secret: SECRET, outpatientIds: 'L-new' }).results[0].state;
  assert.equal(state(), 'referred');
  post(sb, { action: 'logContact', submissionId: 'h1', contact: { leadId: 'L-new', outcome: 'no_answer' }, next: { none: true, explanation: 'ננסה שוב' } });
  assert.equal(state(), 'contacted');
  assert.equal(post(sb, { action: 'voidContact', eventId: 'contact:h1', reason: 'ליד אחר' }).ok, true);
  assert.equal(state(), 'referred');
});

test('deferTask («שינוי מועד»): a reason is required only for a date promised in a contact', () => {
  const sb = sandbox();
  post(sb, { action: 'createTask', submissionId: 'm1', task: { kind: 'review', clientId: 'C1', title: 'בירור', dueDate: '2026-11-22', dueTime: '09:00' } });
  assert.equal(post(sb, { action: 'deferTask', id: 'task-m1', dueDate: '2026-11-25', dueTime: '09:00' }).ok, true, 'a manual task is simply re-dated');
  const c = post(sb, { action: 'logContact', submissionId: 'p1', contact: { clientId: 'C1', outcome: 'call_back_later' }, next: { dueDate: '2026-11-23', dueTime: '11:00' } });
  assert.equal(post(sb, { action: 'deferTask', id: c.created.id, dueDate: '2026-11-24' }).error, 'missing_reason');
  const d = post(sb, { action: 'deferTask', id: c.created.id, dueDate: '2026-11-24', dueTime: '12:00', reason: 'ביקשה לדחות' });
  assert.equal(d.ok, true); assert.equal(d.task.deferredFrom, '2026-11-23'); assert.equal(d.task.dueTime, '12:00');
});

/* ---------------- the browser core (public/crm-activity.js) ---------------- */

const FORM = { direction: 'out', when: TODAY, time: '10:30', withWhom: 'האמא', channel: 'phone', reason: 'בירור', outcome: 'call_back_later', summary: 'ביקשה שנחזור', next: 'd3', nextAssignee: 'דנה' };

test('the form lists follow the Dashboard CRM: three kinds, outcomes per kind, «קשר הבא» with no week', () => {
  assert.deepEqual(CA.DIRECTIONS.map((d) => d.he), ['שיחה יוצאת', 'שיחה נכנסת', 'תיעוד שיחה']);
  assert.deepEqual(CA.CHANNELS.map((c) => c.he), ['טלפון', 'וואטסאפ', 'SMS', 'דוא״ל', 'פנים אל פנים', 'אחר']);
  assert.equal(CA.OUTCOMES.length, 9);
  assert.equal(CA.OUTCOMES[1].id, 'spoke_no_follow_up');
  const inn = CA.outcomesFor('in').map((o) => o.id);
  assert.equal(inn.includes('no_answer'), false); assert.equal(inn.includes('bad_contact_details'), false); assert.equal(inn.length, 7);
  assert.equal(CA.outcomesFor('out').length, 9); assert.equal(CA.outcomesFor('note').length, 9); assert.equal(CA.outcomesFor('').length, 9);
  assert.deepEqual(CA.NEXT_CHOICES.map((n) => n.id), ['d1', 'd3', 'd7', 'd14', 'd30', 'days', 'date', 'none']);
  assert.deepEqual([CA.contactDirection({ direction: 'in' }), CA.contactDirection({}), CA.contactDirection({ direction: 'x' }), CA.contactDirection(null)], ['in', 'note', 'note', 'note']);
  // every stored key the form can send is one the source accepts
  const gs = (name) => GS.match(new RegExp('var ' + name + ' = \\[([^\\]]*)\\]'))[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  for (const c of CA.CHANNELS) assert.ok(gs('CONTACT_CHANNELS').includes(c.id), c.id);
  for (const o of CA.OUTCOMES) assert.ok(gs('CONTACT_OUTCOMES').includes(o.id), o.id);
  assert.match(GS, /var CONTACT_NO_FOLLOW_UP_TEXT = 'לא נדרש המשך';/);
  assert.equal(CA.NO_FOLLOW_UP_TEXT, 'לא נדרש המשך');
});

test('nextPlan / contactErrors: nothing is pre-chosen, the real date is shown, «ללא משימת המשך» must be explained', () => {
  assert.equal(CA.nextPlan('d1', {}, TODAY).text, 'מחר — 22/11/2026 (ראשון)');
  assert.deepEqual(CA.nextPlan('d14', {}, TODAY), { dueDate: '2026-12-05', dueTime: '', text: 'בעוד שבועיים — 05/12/2026 (שבת)' });
  assert.equal(CA.nextPlan('days', { days: '10' }, TODAY).dueDate, '2026-12-01');
  for (const bad of ['0', '366', '1.5', '', 'x']) assert.equal(CA.nextPlan('days', { days: bad }, TODAY), null, bad);
  assert.deepEqual(CA.nextPlan('date', { date: '2026-11-25', time: '14:00' }, TODAY), { dueDate: '2026-11-25', dueTime: '14:00', text: '25/11/2026 14:00 (רביעי)' });
  assert.equal(CA.nextPlan('date', { date: '2026-11-20' }, TODAY), null, 'not in the past');
  assert.equal(CA.nextPlan('date', { date: '2026-11-25', time: '25:00' }, TODAY), null);
  assert.equal(CA.nextPlan('none', { explanation: 'x' }, TODAY), null);
  assert.equal(CA.nextPlan('none', { explanation: 'ביקשה שלא נחזור' }, TODAY).none, true);
  assert.equal(CA.nextPlan('week', { weekStart: TODAY }, TODAY), null, 'no week window in this app');
  assert.deepEqual(CA.contactErrors(FORM, TODAY), {});
  const empty = CA.contactErrors({}, TODAY);
  assert.deepEqual(Object.keys(empty).sort(), ['channel', 'direction', 'next', 'outcome', 'when']);
  assert.equal(empty.next, 'בחרי מה הלאה — אין ברירת מחדל');
  assert.equal(CA.contactErrors(Object.assign({}, FORM, { when: '2026-11-22' }), TODAY).when, 'תאריך השיחה — היום או קודם');
  assert.equal(CA.contactErrors(Object.assign({}, FORM, { direction: 'in', outcome: 'no_answer' }), TODAY).outcome, 'בחרי תוצאה', 'an incoming call cannot be «לא היה מענה»');
  assert.match(CA.contactErrors(Object.assign({}, FORM, { next: 'none' }), TODAY).next, /חובה להסביר/);
  assert.deepEqual(CA.contactErrors(Object.assign({}, FORM, { outcome: 'spoke_no_follow_up', next: 'none' }), TODAY), {}, 'that outcome is itself the explanation');
});

test('contactBody: the exact body the form sends is accepted by the real Code.gs', () => {
  const body = CA.contactBody({ leadId: 'L1', clientId: '' }, FORM, 'contact-abc', '', TODAY);
  assert.deepEqual(body.contact, { leadId: 'L1', clientId: '', direction: 'out', occurredAt: '2026-11-21T10:30', withWhom: 'האמא', channel: 'phone', reason: 'בירור', outcome: 'call_back_later', summary: 'ביקשה שנחזור', taskId: '' });
  assert.deepEqual(body.next, { dueDate: '2026-11-24', dueTime: '', kind: 'call', title: 'לחזור — התבקשנו לחזור במועד', assignee: 'דנה', reason: 'ביקשה שנחזור' });
  const sb = sandbox();
  const r = post(sb, Object.assign({ action: 'logContact' }, body));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.event.eventId, 'contact:contact-abc'); assert.equal(r.event.occurredAt, '2026-11-21T10:30:00');
  assert.equal(r.created.title, 'לחזור — התבקשנו לחזור במועד'); assert.equal(r.created.assignee, 'דנה'); assert.equal(r.created.source, 'contact'); assert.equal(r.created.dueDate, '2026-11-24');
  assert.match('contact:contact-abc', CA.CONTACT_EVENT_ID_RE, 'a browser-minted record id can be voided');
  // no follow-up + no time → noon, and the «none» body
  const none = CA.contactBody({ leadId: '', clientId: 'C1' }, Object.assign({}, FORM, { time: '', outcome: 'spoke_no_follow_up', next: 'none' }), 'contact-def', 'task-9', TODAY);
  assert.equal(none.contact.occurredAt, '2026-11-21T12:00'); assert.equal(none.contact.taskId, 'task-9');
  assert.deepEqual(none.next, { none: true, explanation: 'לא נדרש המשך' });
  assert.equal(post(sb, Object.assign({ action: 'logContact' }, none)).ok, true);
});

const EVENTS = [
  { eventId: 'contact:a', occurredAt: '2026-11-18T09:00:00', kind: 'contact_logged', actorName: 'ורד', leadId: 'L1', clientId: '', summary: 'ישן', detailsJson: JSON.stringify({ direction: 'out', outcome: 'no_answer', summary: '', nextTaskId: 'task-a-next' }) },
  { eventId: 'contact:b', occurredAt: '2026-11-20T15:00:00', kind: 'contact_logged', actorName: 'דנה', leadId: 'L1', clientId: '', summary: 'פנייה נכנסת · משהו', detailsJson: JSON.stringify({ direction: 'in', outcome: 'awaiting_decision', summary: 'שאלה <b>על</b> מחיר' }) },
  { eventId: 'contact:c', occurredAt: '2026-11-21T08:00:00', kind: 'contact_logged', actorName: 'ורד', leadId: 'L1', clientId: '', summary: 'הוזן פעמיים', detailsJson: JSON.stringify({ direction: 'in', outcome: 'awaiting_decision' }) },
  { eventId: 'void:contact:c', occurredAt: '2026-11-21T08:05:00', kind: 'contact_voided', actorName: 'ורד', leadId: 'L1', clientId: '', summary: 'התיעוד בוטל: כפול', detailsJson: JSON.stringify({ supersedesEventId: 'contact:c', reason: 'כפול' }) },
  { eventId: 'contact:old', occurredAt: '2026-10-01T08:00:00', kind: 'contact_logged', actorName: 'ורד', leadId: 'L1', clientId: '', summary: 'לא היה מענה', detailsJson: '{"channel":"meeting","outcome":"no_answer"}' },
  { eventId: 'contact:z', occurredAt: '2026-11-21T09:00:00', kind: 'contact_logged', actorName: 'ורד', leadId: 'L2', clientId: '', summary: 'ליד אחר', detailsJson: '{}' }
];

test('recentContacts / summarize: a voided record is left out of «שיחות אחרונות» and «קשר אחרון», and marked in the history', () => {
  assert.deepEqual(CA.contactVoidedIds(EVENTS), { 'contact:c': true });
  const rc = CA.recentContacts(EVENTS, { leadId: 'L1' }, 2);
  assert.equal(rc.total, 3, 'only this subject, voided left out');
  assert.deepEqual(rc.items.map((x) => x.eventId), ['contact:b', 'contact:a'], 'newest first');
  assert.equal(rc.items[0].direction, 'in'); assert.equal(rc.items[0].actorName, 'דנה'); assert.equal(rc.items[0].when, '20/11/2026 15:00');
  assert.equal(rc.items[0].text, 'ממתינים להחלטה או למידע · שאלה <b>על</b> מחיר', 'built from the details, not the stored line');
  assert.equal(rc.items[1].nextTaskId, 'task-a-next');
  assert.equal(CA.recentContacts(EVENTS, { leadId: 'L1' }).items.length, 3, 'default limit 3');
  assert.equal(CA.recentContacts(EVENTS, { leadId: 'L1' }).items[2].direction, 'note', 'a record without a kind is «תיעוד שיחה»');
  assert.deepEqual(CA.recentContacts(null, { leadId: 'L1' }), { total: 0, items: [] });
  const s = CA.summarize([], EVENTS, { leadId: 'L1' }, TODAY);
  assert.equal(s.lastContact.when, '20/11/2026 15:00', 'the voided 21/11 record is not the last contact');
  assert.equal(s.lastContact.direction, 'in');
  const voided = s.timeline.find((e) => e.eventId === 'contact:c');
  assert.equal(voided.voided, true);
  assert.equal(s.timeline.find((e) => e.eventId === 'void:contact:c').kindHe, 'תיעוד בוטל');
  assert.equal(s.timeline.find((e) => e.eventId === 'contact:b').voided, false);
  // a lead whose only contact was voided is «ללא קשר» again
  const only = [EVENTS[2], EVENTS[3]];
  assert.equal(CA.summarize([], only, { leadId: 'L1' }, TODAY).lastContact, null);
  assert.equal(CA.recentContacts(only, { leadId: 'L1' }).total, 0);
});

test('voidContactError: id shape and reason are checked before anything is posted', () => {
  assert.equal(CA.voidContactError('contact:contact-abc', 'הוזן פעמיים'), '');
  assert.equal(CA.voidContactError('contact:abc', 'x'), 'יש לציין סיבה קצרה לביטול');
  assert.equal(CA.voidContactError('contact:abc', 'א'.repeat(301)), 'עד 300 תווים');
  for (const bad of ['', 'task_created:task-1', 'contact:', 'contact:<b>', null]) assert.equal(CA.voidContactError(bad, 'סיבה'), 'התיעוד אינו תקין — רענני את הדף', String(bad));
});

test('nextSteps («מה הלאה»): what · when (relative + date + weekday + hour) · who, most urgent first', () => {
  const tasks = [
    { id: 't-wait', leadId: 'L1', status: 'open', kind: 'call', title: 'לחזור אחרי החג', dueDate: '2026-11-24', dueTime: '', assignee: 'דנה', reason: 'ביקשה שבוע' },
    { id: 't-late', leadId: 'L1', status: 'deferred', kind: 'call', title: 'לחזור', dueDate: '2026-11-19', dueTime: '09:00', assignee: 'ורד' },
    { id: 't-today', leadId: 'L1', status: 'open', kind: 'meeting', title: 'פגישה', dueDate: TODAY, dueTime: '16:00', assignee: 'אורן' },
    { id: 't-tom', leadId: 'L1', status: 'open', kind: 'other', title: 'מחר', dueDate: '2026-11-22' },
    { id: 't-none', leadId: 'L1', status: 'open', kind: 'other', title: 'בלי תאריך', dueDate: '' },
    { id: 't-yest', leadId: 'L1', status: 'open', kind: 'other', title: 'אתמול', dueDate: '2026-11-20' },
    { id: 't-done', leadId: 'L1', status: 'done', kind: 'call', title: 'בוצע', dueDate: '2026-11-10' },
    { id: 't-other', leadId: 'L2', status: 'open', kind: 'call', title: 'ליד אחר', dueDate: TODAY }
  ];
  const steps = CA.nextSteps({ leadId: 'L1' }, tasks, TODAY);
  // 2026-11-22: a task with NO date is today's work — after today's dated ones, ahead of future dates
  assert.deepEqual(steps.map((x) => x.id), ['t-late', 't-yest', 't-today', 't-none', 't-tom', 't-wait']);
  assert.deepEqual(steps.map((x) => x.rel), ['באיחור של 2 ימים', 'באיחור של יום', 'היום', 'לטיפול היום', 'מחר', 'בעוד 3 ימים']);
  assert.equal(steps[0].when, '19/11/2026 (חמישי) 09:00'); assert.equal(steps[0].assignee, 'ורד'); assert.equal(steps[0].state, 'late');
  assert.equal(steps[2].when, '21/11/2026 (שבת) 16:00');
  assert.equal(steps[5].reason, 'ביקשה שבוע'); assert.equal(steps[3].when, '');
  assert.deepEqual(CA.nextSteps({ clientId: 'C9' }, tasks, TODAY), []);
  assert.deepEqual(CA.nextSteps({ leadId: 'L1' }, null, TODAY), []);
});

test('newTaskErrors / rescheduleErrors: a new task needs only what and who — the date and the time are optional (2026-11-22)', () => {
  const ok = { kind: 'call', title: 'לחזור', dueDate: TODAY, dueTime: '10:00' };
  assert.deepEqual(CA.newTaskErrors(ok, TODAY), {});
  assert.deepEqual(Object.keys(CA.newTaskErrors({}, TODAY)).sort(), ['kind', 'title'], 'no date and no time is a valid task');
  assert.deepEqual(CA.newTaskErrors(Object.assign({}, ok, { dueTime: '' }), TODAY), {}, 'a date with no hour: any time that day');
  assert.deepEqual(CA.newTaskErrors(Object.assign({}, ok, { dueDate: '', dueTime: '' }), TODAY), {}, 'no date: handled today');
  assert.equal(CA.newTaskErrors(Object.assign({}, ok, { dueDate: '2026-11-20' }), TODAY).dueDate, 'תאריך — היום או אחריו');
  assert.equal(CA.newTaskErrors(Object.assign({}, ok, { dueDate: 'x' }), TODAY).dueDate, 'תאריך — היום או אחריו');
  assert.equal(CA.newTaskErrors(Object.assign({}, ok, { dueTime: '25:00' }), TODAY).dueTime, 'שעה בפורמט HH:MM');
  assert.equal(CA.newTaskErrors(Object.assign({}, ok, { dueDate: '' }), TODAY).dueTime, 'שעה דורשת תאריך');
  assert.equal(CA.newTaskErrors(Object.assign({}, ok, { kind: 'payment' }), TODAY).kind, 'בחרי סוג');
  assert.deepEqual(CA.rescheduleErrors({ dueDate: '2026-11-25', dueTime: '' }, { source: 'manual' }), {});
  assert.equal(CA.rescheduleErrors({ dueDate: '2026-11-25' }, { source: 'contact' }).reason, 'מועד שהובטח בשיחה — חובה לציין סיבה');
  assert.deepEqual(CA.rescheduleErrors({ dueDate: '2026-11-25', reason: 'ביקשה' }, { source: 'contact' }), {});
  assert.equal(CA.rescheduleErrors({ dueDate: '' }, null).dueDate, 'בחרי תאריך');
  assert.equal(CA.rescheduleErrors({ dueDate: '2026-11-25', dueTime: '9' }, null).dueTime, 'שעה HH:MM');
});

test('«היום»: a lead whose only contact was voided is «ללא קשר ראשון» again, and its last contact is empty', () => {
  const lead = { id: 'L1', name: 'רונית', phone: '0501234567', stage: 'new', created: '2026-11-20', assignedTo: 'ורד' };
  const base = { leads: [lead], clients: [], stopFlags: [], extraRequests: [], continuation: [], tasks: [], today: TODAY, user: 'ורד', renewalInfo: () => ({ status: 'ok' }) };
  const logged = [EVENTS[2]];
  const a = MyDay.build(Object.assign({}, base, { activity: logged }));
  const b = MyDay.build(Object.assign({}, base, { activity: [EVENTS[2], EVENTS[3]] }));
  const kinds = (m) => Object.values(m.rowsBy).flat().filter((r) => r.subjectId === 'L1').map((r) => r.kind);
  assert.notDeepEqual(kinds(a), kinds(b), 'the void changes how the lead is queued');
  const rowB = Object.values(b.rowsBy).flat().find((r) => r.subjectId === 'L1');
  assert.ok(rowB, 'the lead is listed'); assert.equal(rowB.lastContact, null);
  const rowA = Object.values(a.rowsBy).flat().find((r) => r.subjectId === 'L1');
  assert.ok(rowA && rowA.lastContact, 'before the void the contact shows');
});

test('a task with no hour, or with no date at all, is saved by the real source and is TODAY\'s work on «היום» — never «בהמשך השבוע»', () => {
  const sb = sandbox();
  const noTime = post(sb, { action: 'createTask', submissionId: 'nt1', task: { kind: 'meeting', clientId: 'C1', title: 'לתאם פגישה עם ד״ר נטליה ביום שני', assignee: 'ורד', dueDate: TODAY, dueTime: '' } });
  assert.equal(noTime.ok, true, JSON.stringify(noTime));
  assert.equal(noTime.task.dueDate, TODAY); assert.equal(noTime.task.dueTime, '');
  const noDate = post(sb, { action: 'createTask', submissionId: 'nd1', task: { kind: 'meeting', clientId: 'C1', title: 'לברר שעה מול המרפאה', assignee: 'ורד', dueDate: '', dueTime: '' } });
  assert.equal(noDate.ok, true, JSON.stringify(noDate));
  assert.equal(noDate.task.dueDate, ''); assert.equal(noDate.task.status, 'open');
  const tasks = sb.rows('Tasks').concat([{ id: 't-next', clientId: 'C1', status: 'open', kind: 'meeting', title: 'שבוע הבא', dueDate: '2026-11-29', dueTime: '', assignee: 'ורד' }]);
  const m = MyDay.build({ leads: [], clients: [{ id: 'C1', name: 'מטופל', status: 'פעיל' }], stopFlags: [], extraRequests: [], continuation: [], activity: [], tasks, today: TODAY, user: 'ורד', renewalInfo: () => ({ status: 'ok' }) });
  const by = Object.fromEntries(m.sections.map((x) => [x.id, x.rows.map((r) => r.action)]));
  assert.deepEqual(by.dated, ['לתאם פגישה עם ד״ר נטליה ביום שני', 'לברר שעה מול המרפאה'], 'both sit with today\'s work, the dated one first');
  assert.deepEqual(by.later, ['שבוע הבא']);
  const undated = m.rowsBy.tasks.find((r) => r.taskId === 'task-nd1');
  assert.equal(undated.state, 'undated'); assert.equal(undated.priority, 'today');
  assert.equal(MyDay.stateText(undated), '● להיום');
  // the card: «מה הלאה» says «לטיפול היום», and the row chip wears today\'s colour
  assert.equal(CA.nextSteps({ clientId: 'C1' }, tasks, TODAY).find((x) => x.id === 'task-nd1').rel, 'לטיפול היום');
  assert.match(APP, /escapeHtml\(st === 'undated' \? 'today' : st\)/);
  assert.match(APP, /st === 'today' \|\| st === 'undated' \? 'להיום'/);
  assert.match(APP, /'ללא תאריך — לטיפול היום'/);
  assert.match(APP, /f\.elements\.dueDate\.value = today\(\); f\.elements\.dueDate\.min = today\(\);/, 'the form still opens on today');
});

/* ---------------- wiring / markup pins ---------------- */

test('wiring: one «תיעוד שיחה» button, the block on lead AND patient cards, escaped output, no browser prompt', () => {
  assert.match(APP, /crmBlockHtml\('lead', l\)/);
  assert.match(APP, /crmBlockHtml\('client', c\)/, 'patient cards carry the same block as leads');
  const block = APP.slice(APP.indexOf('function crmBlockHtml(kind, row)'), APP.indexOf('// ---- modals'));
  assert.match(block, /data-crm="contact">📞 תיעוד שיחה<\/button>/);
  assert.match(block, /data-crm="task">➕ משימה חדשה<\/button>/);
  assert.equal(/יצרתי קשר/.test(APP + HTML), false, 'the old wording is gone everywhere');
  for (const txt of ['⏰ מה הלאה', 'שיחות אחרונות', 'ביטול תיעוד', 'אין שיחות מתועדות עדיין.']) assert.ok(block.includes(txt), txt);
  // everything read from the sheets reaches innerHTML through escapeHtml
  for (const v of ['x.title', 'x.when', 'x.assignee', 'x.reason', 'x.text', 'x.actorName', 'x.eventId', 'next.title', 't.title', 't.reason', 'e.summary', 'e.who']) {
    assert.ok(block.includes('escapeHtml(' + v), v + ' is escaped');
  }
  assert.equal(/window\.(prompt|confirm|alert)\(/.test(APP.slice(APP.indexOf('function crmBlockHtml'), APP.indexOf('function leadCard(l, stage)'))), false);
  // the void button is drawn only for ורד, and only for a well-formed record id
  assert.match(APP, /var CONTACT_VOID_USERS = \['ורד'\];/);
  assert.match(block, /canVoid && CA\.CONTACT_EVENT_ID_RE\.test\(x\.eventId\)/);
  // a call is closed only through the contact record
  assert.match(APP, /function crmIsCallKind\(kind\) \{ return kind === 'call' \|\| kind === 'collection'; \}/);
});

test('wiring: the contact form — three kinds with none pre-chosen, the Dashboard fields, textContent-only errors', () => {
  const form = HTML.slice(HTML.indexOf('id="contactForm"'), HTML.indexOf('id="taskModal"'));
  for (const name of ['when', 'time', 'who', 'withWhom', 'channel', 'reason', 'outcome', 'summary', 'nextDays', 'nextDate', 'nextTime', 'nextExplanation', 'nextTitle', 'nextAssignee']) assert.ok(form.includes('name="' + name + '"'), name);
  for (const txt of ['סוג התיעוד *', 'קשר הבא *', 'סיבת הפנייה', 'תקציר', 'שמירת השיחה', 'בחרי מועד — התאריך בפועל יוצג כאן.']) assert.ok(form.includes(txt), txt);
  assert.match(form, /name="who" type="text" readonly/, 'who documented = the signed-in user, not editable');
  assert.match(form, /novalidate/);
  assert.match(APP, /crmRadios\('direction', CA\.DIRECTIONS, taskId \? 'out' : ''\)/, 'only a planned task opens as «שיחה יוצאת»');
  assert.match(APP, /crmRadios\('next', CA\.NEXT_CHOICES, ''\)/, '«קשר הבא» has no default');
  assert.match(APP, /el\.textContent = k === '_form'/, 'errors are written with textContent');
  const task = HTML.slice(HTML.indexOf('id="taskForm"'), HTML.indexOf('id="deferModal"'));
  for (const txt of ['מה לעשות *', 'לטיפול בתאריך', 'שעה (לא חובה)', 'יצירת משימה']) assert.ok(task.includes(txt), txt);
  assert.equal(/תאריך \*|שעה \*/.test(task), false, 'neither the date nor the time is marked required (2026-11-22)');
  assert.equal(/name="reason"/.test(task), false, '«למה עכשיו» is gone from the new-task form');
  for (const id of ['taskDoneForm', 'taskReassignForm', 'taskWithdrawForm', 'voidContactForm', 'deferReasonLabel']) assert.ok(HTML.includes('id="' + id + '"'), id);
  assert.match(HTML, /<div class="modal-title">שינוי מועד — /);
});

test('wiring: «היום» is the team page; the Node proxy refuses voidContact for anyone but ורד', () => {
  assert.match(HTML, /data-view="dashboard">היום</);
  assert.equal(/היום שלי/.test(HTML.replace(/<!--[\s\S]*?-->/g, '')), false, 'no «היום שלי» in the markup');
  assert.match(APP, /<h2>היום<\/h2>/);
  assert.match(APP, /' · כל הצוות<\/span>/);
  assert.equal(/<h2>היום שלי<\/h2>/.test(APP), false);
  assert.deepEqual(users.CONTACT_VOID_USERS, ['ורד']);
  const gate = SERVER.slice(SERVER.indexOf("if (body.action === 'voidContact')"), SERVER.indexOf("for (const k of ['adminAssertion'"));
  assert.match(gate, /sessionUserFromRequest\(req\)/, 'decided from the signed session, never the body');
  assert.match(gate, /CONTACT_VOID_USERS\.indexOf\(who\) < 0 \|\| RETIRED_SESSION_USERS\.indexOf\(who\) >= 0/);
  assert.match(gate, /res\.status\(403\)\.json\(\{ ok: false, error: 'contact_void_vered_only' \}\)/);
});
