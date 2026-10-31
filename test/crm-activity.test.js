'use strict';
// OP-CRM-3B — pure view model (public/crm-activity.js) + wiring guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CA = require('../public/crm-activity.js');
const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const TODAY = '2026-11-03';
const tasks = [
  { id: 'task-1', kind: 'call', leadId: 'L1', clientId: '', title: 'לחזור', assignee: 'דנה', dueDate: '2026-11-01', dueTime: '', status: 'open' },
  { id: 'task-2', kind: 'meeting', leadId: 'L1', clientId: '', title: 'פגישה', assignee: 'ורד', dueDate: '2026-11-03', dueTime: '09:00', status: 'deferred' },
  { id: 'task-3', kind: 'other', leadId: 'L1', clientId: '', title: 'בוצע', assignee: 'ורד', dueDate: '2026-10-20', status: 'done' },
  { id: 'task-4', kind: 'call', leadId: '', clientId: 'C1', title: 'מטופל', assignee: 'ורד', dueDate: '', status: 'open' },
  { id: 'task-5', kind: 'call', leadId: 'L9', clientId: '', title: 'אחר', assignee: 'ורד', dueDate: '2026-11-04', status: 'open' }
];
const events = [
  { eventId: 'task_created:task-1', occurredAt: '2026-10-30T08:00:00.000Z', kind: 'task_created', actorName: 'ורד', leadId: 'L1', clientId: '', summary: 'משימה נוצרה: לחזור', detailsJson: '{}', nextAction: 'לחזור', nextDate: '2026-11-01' },
  { eventId: 'contact:a', occurredAt: '2026-11-02T09:15:00', kind: 'contact_logged', actorName: 'דנה', leadId: 'L1', clientId: '', summary: 'לא היה מענה', detailsJson: '{"channel":"phone","outcome":"no_answer"}', nextAction: 'שיחה חוזרת', nextDate: '2026-11-05' },
  { eventId: 'contact:b', occurredAt: '2026-10-28T10:00:00', kind: 'contact_logged', actorName: 'ורד', leadId: 'L1', clientId: '', summary: 'שיחה ראשונה', detailsJson: '{"channel":"whatsapp"}', nextAction: '', nextDate: '' }
];

test('summarize: last contact = newest contact event; next action = earliest open/deferred task; overdue by due date only', () => {
  const s = CA.summarize(tasks, events, { leadId: 'L1' }, TODAY);
  assert.equal(s.lastContact.who, 'דנה');
  assert.equal(s.lastContact.when, '02/11/2026 09:15');
  assert.equal(s.lastContact.channel, 'שיחת טלפון');
  assert.equal(s.nextAction.id, 'task-1');
  assert.equal(s.nextAction.state, 'late');
  assert.deepEqual(s.openTasks.map((t) => t.id), ['task-1', 'task-2']);
  assert.equal(s.openTasks[1].state, 'today');
  assert.equal(s.openTasks[1].stateText, '● להיום');
  assert.equal(s.overdue, 1);
  assert.deepEqual(s.timeline.map((e) => e.eventId), ['contact:a', 'task_created:task-1', 'contact:b'], 'newest first');
  assert.equal(s.timeline[0].kindHe, 'יצירת קשר');
  assert.equal(s.timeline[0].nextDate, '05/11/2026');
  assert.equal(s.total, 3);
});

test('summarize: a client follows its lead-era history via fromLead; undated task is never late; empty subject', () => {
  const s = CA.summarize(tasks, events, { leadId: 'L1', clientId: 'C1' }, TODAY);
  assert.deepEqual(s.openTasks.map((t) => t.id), ['task-1', 'task-2', 'task-4']);
  assert.equal(s.openTasks[2].state, 'undated');
  const e = CA.summarize(tasks, events, { clientId: 'C-none' }, TODAY);
  assert.equal(e.lastContact, null); assert.equal(e.nextAction, null); assert.equal(e.openTasks.length, 0); assert.equal(e.timeline.length, 0);
  assert.equal(CA.summarize(null, null, { leadId: 'L1' }, TODAY).total, 0);
});

test('vocabularies mirror Code.gs; submission ids are unique and token-safe', () => {
  const gs = (name) => GS.match(new RegExp('var ' + name + ' = \\[([^\\]]*)\\]'))[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  assert.deepEqual(CA.CHANNELS.map((c) => c.id), gs('CONTACT_CHANNELS'));
  assert.deepEqual(CA.OUTCOMES.map((o) => o.id), gs('CONTACT_OUTCOMES'));
  assert.deepEqual(CA.TASK_KINDS.map((k) => k.id), gs('TASK_KINDS'));
  const he = GS.match(/var CONTACT_OUTCOME_HE = \{([\s\S]*?)\};/)[1];
  for (const o of CA.OUTCOMES) assert.ok(he.includes("'" + o.he + "'"), o.id + ' label mirrors Code.gs');
  const a = CA.newSubmissionId('contact'), b = CA.newSubmissionId('contact');
  assert.notEqual(a, b); assert.match(a, /^contact-[a-z0-9]+-[a-z0-9]+$/);
  assert.equal(CA.TASK_KINDS.find((k) => k.id === 'collection').money, true);
});

test('wiring: cards carry the block, modals exist, submissions reuse their key until success, derived rows never create tasks', () => {
  assert.match(APP, /crmBlockHtml\('lead', l\)/);
  assert.match(APP, /crmBlockHtml\('client', c\)/);
  assert.match(APP, /document\.addEventListener\('click', handleCrmClick\)/);
  for (const id of ['contactModal', 'taskModal', 'deferModal', 'contactForm', 'taskForm', 'deferForm', 'contactOutcome', 'contactNextAssignee']) assert.ok(HTML.includes('id="' + id + '"'), id);
  assert.match(HTML, /<script src="crm-activity\.js\?v=__BUILD__" defer><\/script>/);
  assert.match(APP, /dataset\.sid \|\| \(\$\('#contactForm'\)\.dataset\.sid = CA\.newSubmissionId\('contact'\)\)/, 'contact key minted once, kept on failure');
  assert.match(APP, /delete \$\('#contactForm'\)\.dataset\.sid/, 'new key after success');
  assert.match(APP, /state\.tasks === null && state\.activity === null/, 'unavailable source shows המידע אינו זמין');
  assert.match(APP, /apiGetTasks\(\)\.catch\(function \(te\) \{[^}]*return null; \}\)/, 'a failed read is null, never []');
  // no default follow-up date anywhere in the contact form
  const form = HTML.slice(HTML.indexOf('id="contactForm"'), HTML.indexOf('id="taskModal"'));
  assert.equal(/name="nextDate"[^>]*value=/.test(form), false);
  assert.equal(/name="nextDays"[^>]*value=/.test(form), false);
  assert.match(APP, /\.filter\(function \(k\) \{ return !\(k\.money && isOpsScope\(\)\); \}\)/, 'ops session is not offered a money task kind');
});
