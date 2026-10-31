/* «היום שלי» for the Outpatient app (OP-CRM-1, CHANGELOG-my-day.md).
 *
 * The opening screen answers, for the signed-in person: what is urgent, why
 * now, what happened, and what she can do — the same model as the Dashboard
 * CRM (E-Zone-Dashboard docs/crm/SPEC): summary cards whose numbers come
 * from the SAME rows as the lists, an urgent band, work lists by domain with
 * a direct action, and «המידע אינו זמין» (never 0) when a source did not load.
 *
 * PURE: no DOM, no fetch, no Date.now — `today` (YYYY-MM-DD, Asia/Jerusalem)
 * and `renewalInfo(client)` (app.js' own rule) are injected. UMD so
 * node --test exercises it directly.
 *
 * Urgency is never a lead's age: a lead without a scheduled intro call is
 * «ממתין לתיאום», an intro whose date passed without a decision is an
 * exception, a dated item is late only after its date.
 *
 * Money (renewals / collection): hidden for דנה (CRM spec §2 — no money for
 * her). Honest limit: this is a display rule; the Outpatient server still
 * sends every field to every signed-in name (open gap G3 in
 * docs/crm/OUTPATIENT-STAGE0.md). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MyDay = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var NO_MONEY_USERS = ['דנה'];
  var PRIORITY = { binding: 0, exception: 1, late: 2, today: 3, wait: 4, undated: 5 };
  var TASK_KIND_HE = { call: 'שיחה', meeting: 'פגישה', intro: 'שיחת היכרות', plan: 'תוכנית טיפול', activation: 'הפעלת טיפול', continuity: 'המשך טיפול', collection: 'גבייה', review: 'בירור', other: 'משימה' };
  var DOMAINS = [
    { id: 'tasks', label: 'משימות ושיחות לביצוע' },
    { id: 'leads', label: 'פניות ושיחות היכרות' },
    { id: 'plans', label: 'תוכניות טיפול להפעלה' },
    { id: 'renewals', label: 'חידושים וגבייה', money: true },
    { id: 'approvals', label: 'ממתין לאישור שלך' },
    { id: 'continuity', label: 'המשך טיפול ועצירות' }
  ];

  function s(v) { return String(v == null ? '' : v).trim(); }
  function isoDay(v) { var t = s(v); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''; }
  function timeOf(v) { var m = /T(\d{2}:\d{2})/.exec(s(v)); return m ? m[1] : ''; }
  function fmtDate(iso) { var t = isoDay(iso); return t ? t.slice(8, 10) + '/' + t.slice(5, 7) + '/' + t.slice(0, 4) : ''; }
  function daysBetween(a, b) { var x = Date.parse(isoDay(a) + 'T00:00:00Z'), y = Date.parse(isoDay(b) + 'T00:00:00Z'); return isNaN(x) || isNaN(y) ? null : Math.round((y - x) / 86400000); }
  function stateOf(when, today) { var d = isoDay(when); if (!d) return 'undated'; return d < today ? 'late' : d === today ? 'today' : 'wait'; }
  function sortRows(rows) {
    return rows.sort(function (a, b) {
      return (PRIORITY[a.priority] - PRIORITY[b.priority]) || ((a.when || '9') < (b.when || '9') ? -1 : (a.when || '9') > (b.when || '9') ? 1 : 0) || ((b.time ? 1 : 0) - (a.time ? 1 : 0)) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
    });
  }
  function canSeeMoney(user) { return NO_MONEY_USERS.indexOf(s(user)) < 0; }

  /* input: { leads, clients, stopFlags, extraRequests, continuation, today, user, renewalInfo }
   * Each list may be null/undefined = «did not load» (cards show null, never 0). */
  function build(input) {
    var i = input || {};
    var today = isoDay(i.today);
    var money = canSeeMoney(i.user);
    var leads = Array.isArray(i.leads) ? i.leads : null;
    var clients = Array.isArray(i.clients) ? i.clients : null;
    var stopFlags = Array.isArray(i.stopFlags) ? i.stopFlags : null;
    var extras = Array.isArray(i.extraRequests) ? i.extraRequests : null;
    var cont = Array.isArray(i.continuation) ? i.continuation : null;
    var tasks = Array.isArray(i.tasks) ? i.tasks : null;           // persisted CRM tasks (OP-CRM-3B); null = unavailable
    var activity = Array.isArray(i.activity) ? i.activity : null;  // CRM events; null = unavailable
    var renewalInfo = typeof i.renewalInfo === 'function' ? i.renewalInfo : function () { return { status: 'unknown' }; };
    var rowsBy = { tasks: [], leads: [], plans: [], renewals: [], approvals: [], continuity: [] };

    // Phase C: ONE task engine. Persisted open/deferred tasks are rows of their own;
    // a derived row is SUPPRESSED when an open task already covers the same subject
    // and kind family, so a refresh never duplicates manual work.
    var isMoneyTask = function (t) { return t.money === true || String(t.money) === 'true' || t.kind === 'collection'; };
    var openTasks = (tasks || []).filter(function (t) {
      if (!t || !(t.status === 'open' || t.status === 'deferred')) return false;
      return money || !isMoneyTask(t); // the server already hides them from an ops session; belt and braces
    });
    var nameOf = {};
    (leads || []).forEach(function (l) { if (l && l.id) nameOf['lead:' + s(l.id)] = s(l.name); });
    (clients || []).forEach(function (c) { if (c && c.id) nameOf['client:' + s(c.id)] = s(c.name); });
    var covered = {}; // subjectKey -> { kind: true }
    openTasks.forEach(function (t) {
      ['lead:' + s(t.leadId), 'client:' + s(t.clientId)].forEach(function (k) {
        if (k === 'lead:' || k === 'client:') return;
        covered[k] = covered[k] || {}; covered[k][s(t.kind)] = true;
      });
    });
    function coveredBy(subjectKind, id, kinds) {
      var c = covered[subjectKind + ':' + s(id)];
      if (!c) return false;
      for (var k = 0; k < kinds.length; k++) if (c[kinds[k]]) return true;
      return false;
    }
    // first contact: a lead with a logged contact is «ממתין» rather than «ללא קשר ראשון»
    var contacted = {};
    (activity || []).forEach(function (e) { if (e && e.kind === 'contact_logged' && s(e.leadId)) contacted[s(e.leadId)] = true; });
    openTasks.forEach(function (t) {
      var d = isoDay(t.dueDate), tm = s(t.dueTime);
      var st = !d ? 'undated' : d < today ? 'late' : d === today ? 'today' : 'wait';
      var subjectKind = s(t.clientId) ? 'client' : 'lead';
      var subjectId = s(t.clientId) || s(t.leadId);
      rowsBy.tasks.push({ id: 'task:' + s(t.id), kind: 'task', taskId: s(t.id), taskKind: s(t.kind), subjectKind: subjectKind, subjectId: subjectId,
        leadId: s(t.leadId), clientId: s(t.clientId), name: nameOf[subjectKind + ':' + subjectId] || s(t.subjectName) || '—', sub: TASK_KIND_HE[s(t.kind)] || s(t.kind),
        owner: s(t.assignee), action: s(t.title), why: s(t.reason) || (t.status === 'deferred' ? 'נדחתה מ-' + fmtDate(t.deferredFrom) : ''),
        when: d, time: tm, state: st, priority: st === 'late' ? 'late' : (st === 'today' && tm ? 'binding' : st), open: subjectKind, money: isMoneyTask(t) });
    });

    (leads || []).forEach(function (l) {
      if (!l || s(l.stage) === 'not_relevant' || s(l.stage) === 'active') return;
      var base = { subjectKind: 'lead', subjectId: s(l.id), name: s(l.name) || '—', sub: [s(l.serviceType), s(l.location)].filter(Boolean).join(' · '), owner: s(l.assignedTo), time: '' };
      var stage = s(l.stage);
      if (stage === 'new') {
        if (coveredBy('lead', l.id, ['call', 'intro', 'meeting'])) return; // a real task already owns this
        var wasContacted = !!contacted[s(l.id)];
        rowsBy.leads.push(Object.assign(base, { id: 'lead:new:' + l.id, kind: wasContacted ? 'lead_waiting' : 'lead_new', action: wasContacted ? 'להמשיך מעקב — נוצר קשר, עדיין ללא היכרות' : 'ליצור קשר ולתאם שיחת היכרות', why: l.created ? 'פנייה מ-' + fmtDate(l.created) + (l.house_of_origin ? ' · הופנה מ' + s(l.house_of_origin) : '') : 'פנייה חדשה', when: '', state: 'undated', priority: 'undated', open: 'lead' }));
      } else if (stage === 'intro') {
        var d = isoDay(l.introDateTime), t = timeOf(l.introDateTime);
        if (!d) { if (!coveredBy('lead', l.id, ['intro', 'call', 'meeting'])) rowsBy.leads.push(Object.assign(base, { id: 'lead:intro-undated:' + l.id, kind: 'intro_unscheduled', action: 'לקבוע מועד לשיחת ההיכרות', why: 'שלב היכרות ללא מועד', when: '', state: 'undated', priority: 'undated', open: 'lead' })); }
        else if (d < today) { if (!coveredBy('lead', l.id, ['intro', 'plan', 'review', 'call'])) rowsBy.leads.push(Object.assign(base, { id: 'lead:intro-passed:' + l.id, kind: 'intro_passed', action: 'לעדכן מה יצא משיחת ההיכרות', why: 'השיחה היתה ב-' + fmtDate(d) + ' — אין החלטה (תוכנית / לא רלוונטי)', when: d, time: t, state: 'late', priority: 'exception', open: 'lead' })); }
        else rowsBy.leads.push(Object.assign(base, { id: 'lead:intro:' + l.id, kind: 'intro_scheduled', action: 'שיחת היכרות' + (t ? ' ' + t : ''), why: d === today ? 'היום' : 'ב-' + fmtDate(d), when: d, time: t, state: d === today ? 'today' : 'wait', priority: d === today && t ? 'binding' : (d === today ? 'today' : 'wait'), open: 'lead' }));
      } else if (stage === 'agreement') {
        var sd = isoDay(l.startDate);
        if (coveredBy('lead', l.id, ['activation', 'plan'])) return;
        rowsBy.plans.push(Object.assign(base, { id: 'lead:plan:' + l.id, kind: 'plan_to_activate', action: sd ? 'להפעיל את המטופל/ת' : 'להשלים תוכנית טיפול ותאריך התחלה', why: sd ? 'תאריך התחלה ' + fmtDate(sd) + (sd < today ? ' עבר — טרם הופעל' : '') : 'תוכנית ללא תאריך התחלה', when: sd, state: sd ? stateOf(sd, today) : 'undated', priority: sd && sd < today ? 'exception' : (sd ? stateOf(sd, today) : 'undated'), open: 'lead' }));
      }
    });

    var activeClients = (clients || []).filter(function (c) { return c && c.status !== 'סיים טיפול' && c.status !== 'לא פעיל'; });
    if (money) {
      activeClients.forEach(function (c) {
        var info = renewalInfo(c) || { status: 'unknown' };
        if (coveredBy('client', c.id, ['collection'])) return;
        var base = { subjectKind: 'client', subjectId: s(c.id), name: s(c.name) || '—', sub: [s(c.serviceType), s(c.location)].filter(Boolean).join(' · '), owner: s(c.assignedTo), time: '', open: 'client' };
        if (info.status === 'overdue') rowsBy.renewals.push(Object.assign(base, { id: 'renew:overdue:' + c.id, kind: 'renewal_overdue', action: 'תשלום לא שולם — גבייה / החלטה על עצירה', why: info.daysLeft != null && info.daysLeft < 0 ? 'באיחור של ' + Math.abs(info.daysLeft) + ' ימים' : 'המחזור הנוכחי לא שולם', when: isoDay(info.renewalDate), state: 'late', priority: 'late', money: true }));
        else if (info.status === 'due_soon') rowsBy.renewals.push(Object.assign(base, { id: 'renew:soon:' + c.id, kind: 'renewal_due', action: 'חידוש — לגבות לפני המועד', why: info.daysLeft === 0 ? 'היום' : info.daysLeft === 1 ? 'מחר' : 'בעוד ' + info.daysLeft + ' ימים', when: isoDay(info.renewalDate), state: info.daysLeft === 0 ? 'today' : 'wait', priority: info.daysLeft === 0 ? 'today' : 'wait', money: true }));
      });
    }

    (stopFlags || []).forEach(function (f) {
      if (!f || s(f.status) !== 'pending') return;
      rowsBy.approvals.push({ id: 'stopflag:' + f.id, kind: 'stop_flag', subjectKind: f.clientId ? 'client' : 'stopflag', subjectId: s(f.clientId || f.id), name: s(f.name) || '—', sub: s(f.phone), owner: '', action: 'לאשר או לדחות בקשת הפסקת טיפול', why: 'דווח ע״י ' + (s(f.reportedBy) || '—') + (f.reportedAt ? ' · ' + fmtDate(f.reportedAt) : '') + (f.note ? ' · ' + s(f.note) : ''), when: isoDay(f.reportedAt), time: '', state: 'late', priority: 'exception', open: 'stopflag' });
    });
    (extras || []).forEach(function (r) {
      if (!r || s(r.status) !== 'pending') return;
      rowsBy.approvals.push({ id: 'extra:' + r.id, kind: 'extra_request', subjectKind: 'phone', subjectId: s(r.phone), name: s(r.patientName) || '—', sub: [s(r.treatmentType), s(r.therapist)].filter(Boolean).join(' · '), owner: '', action: 'לאשר טיפול נוסף מעבר לחבילה', why: (r.monthKey ? s(r.monthKey) + ' · ' : '') + s(r.used) + '/' + s(r.quota) + ' נוצלו' + (r.requestedBy ? ' · ביקש/ה ' + s(r.requestedBy) : ''), when: isoDay(r.requestedAt), time: '', state: 'wait', priority: 'exception', open: 'extra' });
    });
    (cont || []).forEach(function (v) {
      if (!v) return;
      var md = isoDay(v.meetingDate);
      if (md && !s(v.outcome)) rowsBy.continuity.push({ id: 'cont:' + s(v.key), kind: 'continuation_meeting', subjectKind: 'continuation', subjectId: s(v.key), name: s(v.name) || '—', sub: s(v.house), owner: '', action: md < today ? 'לעדכן תוצאת פגישת המשך' : 'פגישת המשך טיפול', why: (md < today ? 'הפגישה היתה ב-' : 'ב-') + fmtDate(md), when: md, time: '', state: md < today ? 'late' : (md === today ? 'today' : 'wait'), priority: md < today ? 'exception' : (md === today ? 'today' : 'wait'), open: 'continuation' });
    });

    Object.keys(rowsBy).forEach(function (k) { sortRows(rowsBy[k]); });
    var all = [].concat(rowsBy.tasks, rowsBy.leads, rowsBy.plans, rowsBy.renewals, rowsBy.approvals, rowsBy.continuity);
    var dueNow = function (r) { return r.state === 'late' || r.state === 'today'; };
    var count = function (rows, pred) { return rows.filter(pred || function () { return true; }).length; };
    var isCall = function (r) { return r.kind === 'task' && (r.taskKind === 'call' || r.taskKind === 'intro'); };
    var cards = [
      { id: 'tasks', label: 'משימות לביצוע', value: tasks ? count(rowsBy.tasks, dueNow) : null, hint: tasks ? count(rowsBy.tasks, function (r) { return r.state === 'late'; }) + ' באיחור · ' + rowsBy.tasks.length + ' פתוחות' : 'המידע אינו זמין' },
      { id: 'calls', label: 'שיחות להיום', value: tasks ? count(rowsBy.tasks, function (r) { return isCall(r) && dueNow(r); }) : null, hint: tasks ? count(rowsBy.tasks, function (r) { return isCall(r) && r.state === 'late'; }) + ' שיחות באיחור' : 'המידע אינו זמין', domain: 'tasks' },
      { id: 'leads', label: 'פניות ללא היכרות', value: leads ? count(rowsBy.leads, function (r) { return r.kind === 'lead_new' || r.kind === 'intro_unscheduled'; }) : null, hint: leads ? count(rowsBy.leads, function (r) { return r.kind === 'intro_passed'; }) + ' היכרויות ללא החלטה' : 'המידע אינו זמין' },
      { id: 'intros', label: 'שיחות היכרות היום', value: leads ? count(rowsBy.leads, function (r) { return r.kind === 'intro_scheduled' && r.state === 'today'; }) : null, second: leads ? { label: 'מתוכננות', value: count(rowsBy.leads, function (r) { return r.kind === 'intro_scheduled' && r.state === 'wait'; }) } : null, domain: 'leads' },
      { id: 'plans', label: 'תוכניות להפעלה', value: leads ? rowsBy.plans.length : null, hint: leads ? count(rowsBy.plans, function (r) { return r.priority === 'exception'; }) + ' אחרי תאריך ההתחלה' : 'המידע אינו זמין' }
    ];
    if (money) cards.push({ id: 'renewals', label: 'חידושים וגבייה', value: clients ? count(rowsBy.renewals, dueNow) : null, hint: clients ? count(rowsBy.renewals, function (r) { return r.state === 'late'; }) + ' לא שולמו · ' + rowsBy.renewals.length + ' בשבוע הקרוב' : 'המידע אינו זמין' });
    else cards.push({ id: 'continuity', label: 'המשך טיפול ועצירות', value: cont ? rowsBy.continuity.length : null, hint: cont ? 'פגישות המשך לעדכון' : 'המידע אינו זמין' });
    cards.push({ id: 'approvals', label: 'ממתין לאישור שלך', value: stopFlags && extras ? rowsBy.approvals.length : null, hint: stopFlags && extras ? count(rowsBy.approvals, function (r) { return r.kind === 'stop_flag'; }) + ' הפסקות · ' + count(rowsBy.approvals, function (r) { return r.kind === 'extra_request'; }) + ' טיפולים נוספים' : 'המידע אינו זמין' });
    var urgent = sortRows(all.filter(function (r) { return r.priority === 'binding' || r.priority === 'exception' || r.state === 'late'; }).slice());
    // Priority order of the opening screen (CRM program §6). Each row appears ONCE:
    // the first section that claims it wins. Sections and cards read the same rows.
    var taken = {};
    function take(pred) { var out = []; all.forEach(function (r) { if (taken[r.id] || !pred(r)) return; taken[r.id] = true; out.push(r); }); return sortRows(out); }
    var sections = [
      { id: 'critical', label: 'באיחור ומחויבויות עם מועד', rows: take(function (r) { return r.state === 'late' || r.priority === 'binding' || (r.kind === 'task' && r.state === 'today'); }) },
      { id: 'calls', label: 'שיחות להיום', rows: take(function (r) { return isCall(r) && r.state === 'today'; }) },
      { id: 'intros', label: 'שיחות היכרות היום', rows: take(function (r) { return r.kind === 'intro_scheduled' && r.state === 'today'; }) },
      { id: 'undecided', label: 'היכרויות שעברו ללא החלטה', rows: take(function (r) { return r.kind === 'intro_passed'; }) },
      { id: 'first', label: 'פניות ללא קשר ראשון', rows: take(function (r) { return r.kind === 'lead_new' || r.kind === 'intro_unscheduled'; }) },
      { id: 'starts', label: 'תחילת טיפול והמשך טיפול', rows: take(function (r) { return r.kind === 'plan_to_activate' || r.kind === 'continuation_meeting' || r.kind === 'lead_waiting'; }) },
      { id: 'approvals', label: 'אישורים וחריגים', rows: take(function (r) { return r.kind === 'stop_flag' || r.kind === 'extra_request'; }) }
    ];
    if (money) sections.push({ id: 'money', label: 'חידושים וגבייה', rows: take(function (r) { return !!r.money || r.kind === 'renewal_overdue' || r.kind === 'renewal_due'; }) });
    sections.push({ id: 'later', label: 'בהמשך השבוע', rows: take(function () { return true; }) });
    sections = sections.filter(function (x) { return x.rows.length; });
    return { today: today, money: money, cards: cards, rowsBy: rowsBy, urgent: urgent, sections: sections, domains: DOMAINS.filter(function (d) { return !d.money || money; }), total: all.length };
  }

  function stateText(r) {
    if (r.priority === 'exception') return '⚠ חריג';
    if (r.state === 'late') return '⏰ באיחור';
    if (r.state === 'today') return '● להיום';
    if (r.state === 'undated') return '◷ ללא מועד';
    return '◷ ממתין';
  }

  return { build: build, DOMAINS: DOMAINS, TASK_KIND_HE: TASK_KIND_HE, NO_MONEY_USERS: NO_MONEY_USERS, canSeeMoney: canSeeMoney, stateText: stateText, fmtDate: fmtDate, daysBetween: daysBetween };
}));
