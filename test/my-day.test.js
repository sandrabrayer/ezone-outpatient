'use strict';
// «היום שלי» (OP-CRM-1) — pure model + wiring guards. See CHANGELOG-my-day.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MyDay = require('../public/my-day.js');
const PUB = path.join(__dirname, '..', 'public');
const indexRaw = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const appRaw = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
const swRaw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
const cssRaw = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');

const TODAY = '2026-10-29';
const renewalInfo = (c) => c._renewal || { status: 'unknown' };

function fixture() {
  return {
    today: TODAY,
    user: 'ורד',
    renewalInfo,
    leads: [
      { id: 'L1', name: 'פנייה חדשה', stage: 'new', created: '2026-10-01', serviceType: 'פסיכולוגית', house_of_origin: 'הדר' },
      { id: 'L2', name: 'היכרות ללא מועד', stage: 'intro' },
      { id: 'L3', name: 'היכרות שעברה', stage: 'intro', introDateTime: '2026-10-20T10:00' },
      { id: 'L4', name: 'היכרות היום', stage: 'intro', introDateTime: TODAY + 'T14:30' },
      { id: 'L5', name: 'היכרות מחר', stage: 'intro', introDateTime: '2026-10-30T09:00' },
      { id: 'L6', name: 'תוכנית עם תאריך שעבר', stage: 'agreement', startDate: '2026-10-15' },
      { id: 'L7', name: 'תוכנית ללא תאריך', stage: 'agreement' },
      { id: 'L8', name: 'כבר פעיל', stage: 'active' },
      { id: 'L9', name: 'לא רלוונטי', stage: 'not_relevant' }
    ],
    clients: [
      { id: 'C1', name: 'חוב', status: 'פעיל', _renewal: { status: 'overdue', daysLeft: -4, renewalDate: '2026-10-25' } },
      { id: 'C2', name: 'חידוש היום', status: 'פעיל', _renewal: { status: 'due_soon', daysLeft: 0, renewalDate: TODAY } },
      { id: 'C3', name: 'חידוש בעוד 3', status: 'פעיל', _renewal: { status: 'due_soon', daysLeft: 3, renewalDate: '2026-11-01' } },
      { id: 'C4', name: 'סיים', status: 'סיים טיפול', _renewal: { status: 'overdue', daysLeft: -40 } },
      { id: 'C5', name: 'בסדר', status: 'פעיל', _renewal: { status: 'ok', daysLeft: 20 } }
    ],
    stopFlags: [
      { id: 'S1', clientId: 'C5', name: 'בסדר', status: 'pending', reportedBy: 'אורן', reportedAt: '2026-10-28' },
      { id: 'S2', clientId: 'C1', name: 'חוב', status: 'approved' }
    ],
    extraRequests: [
      { id: 'X1', phone: '0501234567', patientName: 'נוסף', status: 'pending', used: 4, quota: 4, monthKey: '2026-10', requestedBy: 'דנה' },
      { id: 'X2', phone: '0507654321', patientName: 'אושר', status: 'approved' }
    ],
    continuation: [
      { key: 'K1', name: 'פגישה שעברה', house: 'הדר', meetingDate: '2026-10-22', outcome: '' },
      { key: 'K2', name: 'פגישה שעברה עם תוצאה', house: 'הדר', meetingDate: '2026-10-22', outcome: 'ממשיך' },
      { key: 'K3', name: 'פגישה מחר', house: 'פרדס', meetingDate: '2026-10-30', outcome: '' }
    ]
  };
}

test('1. queues: leads by stage, no urgency by lead age, exceptions after dated items pass', () => {
  const out = MyDay.build(fixture());
  const kinds = out.rowsBy.leads.map((r) => r.kind);
  assert.deepEqual(kinds.sort(), ['intro_passed', 'intro_scheduled', 'intro_scheduled', 'intro_unscheduled', 'lead_new'].sort());
  const newLead = out.rowsBy.leads.find((r) => r.kind === 'lead_new');
  assert.equal(newLead.state, 'undated', 'a lead is never late by age');
  assert.equal(newLead.priority, 'undated');
  assert.match(newLead.why, /הופנה מהדר/);
  const passed = out.rowsBy.leads.find((r) => r.kind === 'intro_passed');
  assert.equal(passed.priority, 'exception');
  const todayIntro = out.rowsBy.leads.find((r) => r.id === 'lead:intro:L4');
  assert.equal(todayIntro.priority, 'binding', 'today + time = binding');
  assert.equal(todayIntro.time, '14:30');
  assert.equal(out.rowsBy.leads.find((r) => r.id === 'lead:intro:L5').state, 'wait');
  // active / not_relevant never appear
  assert.ok(!out.rowsBy.leads.some((r) => /L8|L9/.test(r.id)));
});

test('2. ordering: binding, then exceptions, then dated, then waiting/undated', () => {
  const out = MyDay.build(fixture());
  assert.deepEqual(out.rowsBy.leads.map((r) => r.priority), ['binding', 'exception', 'wait', 'undated', 'undated']);
  assert.equal(out.urgent[0].id, 'lead:intro:L4');
  assert.ok(out.urgent.every((r) => r.priority === 'binding' || r.priority === 'exception' || r.state === 'late'));
  assert.ok(!out.urgent.some((r) => r.kind === 'lead_new'), 'new leads are not urgent');
});

test('3. plans: start date passed → exception; no date → undated', () => {
  const out = MyDay.build(fixture());
  const p6 = out.rowsBy.plans.find((r) => r.id === 'lead:plan:L6');
  const p7 = out.rowsBy.plans.find((r) => r.id === 'lead:plan:L7');
  assert.equal(p6.priority, 'exception');
  assert.match(p6.why, /עבר — טרם הופעל/);
  assert.equal(p7.state, 'undated');
});

test('4. renewals use the injected renewalInfo rule and skip finished clients', () => {
  const out = MyDay.build(fixture());
  assert.deepEqual(out.rowsBy.renewals.map((r) => r.id), ['renew:overdue:C1', 'renew:soon:C2', 'renew:soon:C3']);
  assert.ok(out.rowsBy.renewals.every((r) => r.money === true));
  assert.equal(out.rowsBy.renewals[1].why, 'היום');
});

test('5. approvals + continuity: only pending flags/requests, only meetings without outcome', () => {
  const out = MyDay.build(fixture());
  assert.deepEqual(out.rowsBy.approvals.map((r) => r.id), ['stopflag:S1', 'extra:X1']);
  assert.ok(out.rowsBy.approvals.every((r) => r.priority === 'exception'));
  assert.deepEqual(out.rowsBy.continuity.map((r) => r.id), ['cont:K1', 'cont:K3']);
  assert.equal(out.rowsBy.continuity[0].priority, 'exception');
});

test('6. cards count the same rows as the lists; renewals card only with money', () => {
  const out = MyDay.build(fixture());
  const byId = Object.fromEntries(out.cards.map((c) => [c.id, c]));
  assert.equal(byId.leads.value, 2, 'new + unscheduled');
  assert.equal(byId.tasks.value, null, 'no tasks source in this fixture');
  assert.equal(byId.intros.value, 1);
  assert.equal(byId.intros.second.value, 1);
  assert.equal(byId.plans.value, 2);
  assert.equal(byId.renewals.value, 2, 'overdue + due today');
  assert.equal(byId.approvals.value, 2);
  assert.equal(byId.continuity, undefined);
  assert.equal(out.total, out.rowsBy.leads.length + out.rowsBy.plans.length + out.rowsBy.renewals.length + out.rowsBy.approvals.length + out.rowsBy.continuity.length);
});

test('7. דנה: no money — no renewal rows, no renewals card/domain, continuity card instead', () => {
  const f = fixture(); f.user = 'דנה';
  const out = MyDay.build(f);
  assert.equal(out.money, false);
  assert.equal(out.rowsBy.renewals.length, 0);
  assert.ok(!out.cards.some((c) => c.id === 'renewals'));
  assert.ok(out.cards.some((c) => c.id === 'continuity'));
  assert.ok(!out.domains.some((d) => d.id === 'renewals'));
  assert.ok(!out.urgent.some((r) => r.money), 'no money row leaks into the urgent band');
  assert.equal(MyDay.canSeeMoney('ורד'), true);
  assert.equal(MyDay.canSeeMoney(' דנה '), false);
});

test('8. a source that did not load gives null (never 0) and «המידע אינו זמין»', () => {
  const f = fixture(); f.leads = null; f.stopFlags = undefined; f.clients = null;
  const out = MyDay.build(f);
  const byId = Object.fromEntries(out.cards.map((c) => [c.id, c]));
  assert.equal(byId.leads.value, null);
  assert.equal(byId.leads.hint, 'המידע אינו זמין');
  assert.equal(byId.intros.value, null);
  assert.equal(byId.plans.value, null);
  assert.equal(byId.renewals.value, null);
  assert.equal(byId.approvals.value, null, 'approvals need both stop flags and extras');
  assert.equal(out.rowsBy.leads.length, 0);
  // empty arrays are a real 0
  const g = fixture(); g.leads = [];
  assert.equal(MyDay.build(g).cards.find((c) => c.id === 'leads').value, 0);
  // Phase C: tasks/calls cards are null when getTasks did not load, 0 when it loaded empty
  assert.equal(MyDay.build(g).cards.find((c) => c.id === 'tasks').value, null);
  g.tasks = [];
  assert.equal(MyDay.build(g).cards.find((c) => c.id === 'tasks').value, 0);
});

test('9. build is pure and tolerant of garbage rows', () => {
  const out = MyDay.build({ today: TODAY, leads: [null, {}, { stage: 'intro', introDateTime: 'garbage' }], clients: [null], stopFlags: [{}], extraRequests: [null], continuation: [{ meetingDate: 'x' }] });
  assert.equal(out.rowsBy.leads.length, 1);
  assert.equal(out.rowsBy.leads[0].kind, 'intro_unscheduled');
  assert.equal(out.rowsBy.approvals.length, 0);
  assert.equal(out.rowsBy.continuity.length, 0);
  assert.equal(MyDay.build().total, 0);
  assert.equal(MyDay.fmtDate('2026-10-29T10:00'), '29/10/2026');
  assert.equal(MyDay.daysBetween('2026-10-01', '2026-10-29'), 28);
  assert.equal(MyDay.stateText({ priority: 'exception' }), '⚠ חריג');
});

test('10. wiring: index.html hosts #myDay first, loads my-day.js cache-busted, tab reads «היום שלי», metrics collapsed', () => {
  assert.ok(indexRaw.includes('<div id="myDay" class="my-day">'), '#myDay container');
  assert.ok(indexRaw.indexOf('id="myDay"') < indexRaw.indexOf('id="panel-renewals"'), 'my-day renders above the renewals panel');
  assert.match(indexRaw, /<script src="my-day\.js\?v=__BUILD__" defer><\/script>/);
  assert.ok(indexRaw.includes('data-view="dashboard"'), 'dashboard view id unchanged (deep links / tests)');
  assert.match(indexRaw, /data-view="dashboard">היום שלי</);
  assert.match(indexRaw, /<details class="panel my-day-metrics" open>/, 'breakdowns open by default (Sandra, 2026-10-31)');
  // the three headline KPIs sit ABOVE «היום שלי» on landing; revenue is money-only
  assert.ok(indexRaw.indexOf('class="kpis kpis-landing"') < indexRaw.indexOf('id="myDay"'), 'KPIs above the work screen');
  assert.match(indexRaw, /<div class="kpi money-only"><div class="kpi-label">הכנסה חודשית<\/div><div id="kpiRevenue"/);
  assert.equal((indexRaw.match(/id="kpiActive"/g) || []).length, 1);
  assert.ok(indexRaw.indexOf('<script src="my-day.js') > indexRaw.indexOf('<script src="continuation-logic.js'), 'loads after continuation-logic');
});

test('11. wiring: app.js renders MyDay from state (incl. renewalInfo + user) and delegates clicks', () => {
  assert.match(appRaw, /function renderMyDay\(\)/);
  assert.match(appRaw, /window\.MyDay\.build\(\{/);
  assert.match(appRaw, /renewalInfo:\s*renewalInfo/);
  assert.match(appRaw, /user:\s*state\.user/);
  assert.match(appRaw, /continuation:\s*state\.continuationRows/);
  assert.match(appRaw, /function myDayOpen\(/);
  assert.match(appRaw, /\$\('#myDay'\);\s*if \(myDayBox\) myDayBox\.addEventListener\('click'/);
  assert.match(appRaw, /closest\('\[data-md-open\]'\)/);
  // renderDashboard ends by drawing my-day
  const rd = appRaw.slice(appRaw.indexOf('function renderDashboard('));
  assert.ok(rd.slice(0, rd.indexOf('function renderMyDay(')).includes('renderMyDay();'), 'renderDashboard calls renderMyDay');
  // sheet text reaches innerHTML only escaped
  assert.match(appRaw, /escapeHtml\(r\.name\)/);
  assert.match(appRaw, /data-md-name="' \+ escapeHtml\(r\.name\)/);
});

test('12. SW cache bumped to v21+ (index.html shell changed) and styles ship', () => {
  const m = swRaw.match(/var CACHE = 'ezone-outpatient-v(\d+)'/);
  assert.ok(Number(m[1]) >= 21, `expected v21+, got v${m[1]}`);
  assert.ok(cssRaw.includes('.my-day'), 'my-day styles present');
  assert.ok(cssRaw.includes('.md-urgent'), 'urgent band style present');
});

/* ---- Phase C: one task engine — persisted tasks + derived rows, priority sections ---- */
function tasked() {
  const f = fixture();
  f.activity = [{ eventId: 'contact:x', kind: 'contact_logged', leadId: 'L2', occurredAt: '2026-10-28T10:00:00' }];
  f.tasks = [
    { id: 't-late', kind: 'call', leadId: 'L1', title: 'לחזור לפנייה', dueDate: '2026-10-27', dueTime: '', status: 'open', assignee: 'דנה' },
    { id: 't-today', kind: 'call', clientId: 'C5', title: 'שיחת מעקב', dueDate: TODAY, dueTime: '10:00', status: 'deferred', assignee: 'ורד', deferredFrom: '2026-10-27' },
    { id: 't-later', kind: 'meeting', clientId: 'C5', title: 'פגישה', dueDate: '2026-11-05', status: 'open', assignee: 'ורד' },
    { id: 't-money', kind: 'collection', clientId: 'C1', title: 'גבייה', dueDate: TODAY, status: 'open', assignee: 'ורד' },
    { id: 't-done', kind: 'call', leadId: 'L3', title: 'בוצע', dueDate: TODAY, status: 'done', assignee: 'ורד' },
    { id: 't-cont', kind: 'continuity', leadId: 'L7', title: 'להשלים תוכנית', dueDate: '', status: 'open', assignee: 'ורד' }
  ];
  return f;
}

test('13. persisted open/deferred tasks are rows; done tasks are not; names come from leads/clients', () => {
  const out = MyDay.build(tasked());
  const ids = out.rowsBy.tasks.map((r) => r.id);
  assert.deepEqual(ids.sort(), ['task:t-cont', 'task:t-late', 'task:t-later', 'task:t-money', 'task:t-today'].sort());
  const late = out.rowsBy.tasks.find((r) => r.id === 'task:t-late');
  assert.equal(late.name, 'פנייה חדשה'); assert.equal(late.state, 'late'); assert.equal(late.open, 'lead'); assert.equal(late.leadId, 'L1');
  const td = out.rowsBy.tasks.find((r) => r.id === 'task:t-today');
  assert.equal(td.priority, 'binding', 'today + time'); assert.equal(td.name, 'בסדר'); assert.match(td.why, /נדחתה מ-27\/10\/2026/);
  assert.equal(out.rowsBy.tasks.find((r) => r.id === 'task:t-money').money, true);
});

test('14. a derived row is suppressed when an open task already covers the subject (no duplicate engines)', () => {
  const out = MyDay.build(tasked());
  assert.equal(out.rowsBy.leads.some((r) => r.id === 'lead:new:L1'), false, 'L1 has a call task');
  assert.equal(out.rowsBy.leads.some((r) => r.id === 'lead:intro-undated:L2'), true, 'L2 has no task');
  assert.equal(out.rowsBy.renewals.some((r) => r.subjectId === 'C1'), false, 'C1 has a collection task');
  assert.equal(out.rowsBy.plans.some((r) => r.id === 'lead:plan:L7'), true, 'a continuity task does not cover a plan');
  // a logged contact turns «ללא קשר ראשון» into «ממתין» (still not urgent)
  const f = tasked(); f.tasks = [];
  const o2 = MyDay.build(f);
  assert.equal(o2.rowsBy.leads.find((r) => r.subjectId === 'L1').kind, 'lead_new');
  f.activity = [{ eventId: 'c1', kind: 'contact_logged', leadId: 'L1' }];
  const o3 = MyDay.build(f);
  assert.equal(o3.rowsBy.leads.find((r) => r.subjectId === 'L1').kind, 'lead_waiting');
  assert.equal(o3.urgent.some((r) => r.subjectId === 'L1'), false);
});

test('15. sections follow the priority order, each row appears once, cards count the same rows', () => {
  const out = MyDay.build(tasked());
  const order = out.sections.map((x) => x.id);
  const want = ['critical', 'intros', 'undecided', 'first', 'starts', 'approvals', 'money', 'later'];
  assert.deepEqual(order.filter((id) => want.includes(id)), want.filter((id) => order.includes(id)));
  assert.equal(order.indexOf('critical'), 0);
  const seen = {}; out.sections.forEach((x) => x.rows.forEach((r) => { assert.ok(!seen[r.id], 'row ' + r.id + ' twice'); seen[r.id] = 1; }));
  assert.equal(Object.keys(seen).length, out.total, 'every row is in exactly one section');
  const critical = out.sections[0].rows.map((r) => r.id);
  assert.ok(critical.includes('task:t-late')); assert.ok(critical.includes('task:t-today')); assert.ok(critical.includes('task:t-money'));
  assert.ok(critical.includes('lead:intro-passed:L3'), 'an undecided intro is late/exception and goes to critical');
  const byId = Object.fromEntries(out.cards.map((c) => [c.id, c]));
  assert.equal(byId.tasks.value, out.rowsBy.tasks.filter((r) => r.state === 'late' || r.state === 'today').length);
  assert.equal(byId.calls.value, 2, 'late + today call tasks');
  assert.equal(out.sections.find((x) => x.id === 'later').rows.some((r) => r.id === 'task:t-later'), true);
});

test('16. דנה: money tasks never reach her rows/sections even if a payload carried one', () => {
  const f = tasked(); f.user = 'דנה';
  const out = MyDay.build(f);
  assert.equal(out.rowsBy.tasks.some((r) => r.money), false);
  assert.equal(out.sections.some((x) => x.id === 'money'), false);
  assert.equal(out.rowsBy.tasks.length, 4);
});
