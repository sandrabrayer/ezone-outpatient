/* CRM tasks + activity view model (OP-CRM-3B, CHANGELOG-crm-tasks-activity.md).
 *
 * PURE (no DOM, no fetch, no clock): app.js hands in the rows the server
 * returned (getTasks / getActivity) and today's Asia/Jerusalem date; this
 * module answers, per lead or client, «what was the last contact, what is the
 * next action, which tasks are open» and the merged timeline the card shows.
 * UMD so node --test exercises it directly. The vocabularies mirror Code.gs
 * (TASK_KINDS / CONTACT_* / CONTACT_OUTCOME_HE) — change both together. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CrmActivity = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var CHANNELS = [
    { id: 'phone', he: 'שיחת טלפון' }, { id: 'whatsapp', he: 'וואטסאפ' }, { id: 'meeting', he: 'פגישה' },
    { id: 'email', he: 'אימייל' }, { id: 'other', he: 'אחר' }
  ];
  var OUTCOMES = [
    { id: 'spoke_follow_up', he: 'התקיימה שיחה ונדרש המשך' }, { id: 'no_answer', he: 'לא היה מענה' },
    { id: 'call_back_later', he: 'התבקשנו לחזור במועד' }, { id: 'awaiting_decision', he: 'ממתינים להחלטה או למידע' },
    { id: 'meeting_set', he: 'נקבעה פגישה' }, { id: 'no_interest_now', he: 'אין עניין כרגע' },
    { id: 'bad_contact_details', he: 'פרטי הקשר אינם תקינים' }, { id: 'stop_contact', he: 'התבקשה הפסקת פניות' }
  ];
  var TASK_KINDS = [
    { id: 'call', he: 'שיחה' }, { id: 'meeting', he: 'פגישה' }, { id: 'intro', he: 'שיחת היכרות' }, { id: 'plan', he: 'תוכנית טיפול' },
    { id: 'activation', he: 'הפעלת טיפול' }, { id: 'continuity', he: 'המשך טיפול' }, { id: 'collection', he: 'גבייה', money: true },
    { id: 'review', he: 'בירור' }, { id: 'other', he: 'אחר' }
  ];
  var EVENT_HE = {
    contact_logged: 'יצירת קשר', task_created: 'משימה נוצרה', task_completed: 'משימה הושלמה', task_deferred: 'משימה נדחתה',
    task_reassigned: 'אחריות הועברה', task_cancelled: 'משימה בוטלה'
  };
  function heOf(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].he; return id || ''; }
  function s(v) { return String(v == null ? '' : v).trim(); }
  function isoDay(v) { var t = s(v); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''; }
  function fmtDate(iso) { var t = isoDay(iso); return t ? t.slice(8, 10) + '/' + t.slice(5, 7) + '/' + t.slice(0, 4) : ''; }
  function fmtWhen(iso) { var d = fmtDate(iso), m = /T(\d{2}:\d{2})/.exec(s(iso)); return d + (m ? ' ' + m[1] : ''); }
  function openish(t) { return t && (t.status === 'open' || t.status === 'deferred'); }
  function isOverdue(t, today) { return openish(t) && !!isoDay(t.dueDate) && isoDay(t.dueDate) < today; }
  function isDueToday(t, today) { return openish(t) && isoDay(t.dueDate) === today; }
  function dueState(t, today) {
    if (!openish(t)) return t && t.status === 'done' ? 'done' : 'closed';
    if (!isoDay(t.dueDate)) return 'undated';
    if (isoDay(t.dueDate) < today) return 'late';
    if (isoDay(t.dueDate) === today) return 'today';
    return 'wait';
  }
  function stateText(st) {
    return { late: '⏰ באיחור', today: '● להיום', undated: '◷ ללא מועד', wait: '◷ ממתין', done: '✓ בוצע', closed: '— בוטל' }[st] || '';
  }
  function matches(row, subject) {
    if (!row || !subject) return false;
    if (subject.leadId && s(row.leadId) === s(subject.leadId)) return true;
    if (subject.clientId && s(row.clientId) === s(subject.clientId)) return true;
    return false;
  }
  function sortByDue(a, b) {
    var da = isoDay(a.dueDate) || '9999', db = isoDay(b.dueDate) || '9999';
    if (da !== db) return da < db ? -1 : 1;
    var ta = s(a.dueTime) || '99:99', tb = s(b.dueTime) || '99:99';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  function details(e) { try { return e && e.detailsJson ? JSON.parse(e.detailsJson) : {}; } catch (_) { return {}; } }

  /* Per-subject summary. subject = { leadId } | { clientId } (a client may also pass
   * its fromLead as leadId so the lead-era history follows it). */
  function summarize(tasks, events, subject, today) {
    var mine = (tasks || []).filter(function (t) { return matches(t, subject); });
    var evs = (events || []).filter(function (e) { return matches(e, subject); });
    evs.sort(function (a, b) { return s(b.occurredAt) < s(a.occurredAt) ? -1 : s(b.occurredAt) > s(a.occurredAt) ? 1 : 0; });
    var contacts = evs.filter(function (e) { return e.kind === 'contact_logged'; });
    var last = contacts[0] || null;
    var open = mine.filter(openish).sort(sortByDue);
    var next = open[0] || null;
    return {
      lastContact: last ? { when: fmtWhen(last.occurredAt), who: s(last.actorName), summary: s(last.summary), channel: heOf(CHANNELS, details(last).channel), outcome: details(last).outcome } : null,
      nextAction: next ? { id: next.id, title: s(next.title), due: fmtDate(next.dueDate), dueTime: s(next.dueTime), assignee: s(next.assignee), state: dueState(next, today) } : null,
      openTasks: open.map(function (t) { return Object.assign({}, t, { state: dueState(t, today), stateText: stateText(dueState(t, today)), kindHe: heOf(TASK_KINDS, t.kind) }); }),
      overdue: open.filter(function (t) { return isOverdue(t, today); }).length,
      timeline: evs.map(function (e) { return { eventId: e.eventId, when: fmtWhen(e.occurredAt), kind: e.kind, kindHe: EVENT_HE[e.kind] || e.kind, who: s(e.actorName), summary: s(e.summary), nextAction: s(e.nextAction), nextDate: fmtDate(e.nextDate), details: details(e) }; }),
      total: mine.length
    };
  }

  /* A browser-minted idempotency key: unique enough per device, no PII. */
  function newSubmissionId(prefix) {
    return (prefix || 'sub') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  return {
    CHANNELS: CHANNELS, OUTCOMES: OUTCOMES, TASK_KINDS: TASK_KINDS, EVENT_HE: EVENT_HE,
    heOf: heOf, fmtDate: fmtDate, fmtWhen: fmtWhen, isOverdue: isOverdue, isDueToday: isDueToday, dueState: dueState, stateText: stateText,
    summarize: summarize, newSubmissionId: newSubmissionId, matches: matches
  };
}));
