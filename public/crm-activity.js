/* CRM tasks + activity view model (OP-CRM-3B, CHANGELOG-crm-tasks-activity.md).
 *
 * PURE (no DOM, no fetch, no clock): app.js hands in the rows the server
 * returned (getTasks / getActivity) and today's Asia/Jerusalem date; this
 * module answers, per lead or client, «what was the last contact, what is the
 * next action, which tasks are open» and the merged timeline the card shows.
 * UMD so node --test exercises it directly. The vocabularies mirror Code.gs
 * (TASK_KINDS / CONTACT_* / CONTACT_OUTCOME_HE) — change both together.
 *
 * 2026-11-21 (CHANGELOG-crm-dashboard-parity.md): the contact record, «קשר הבא», «מה הלאה»,
 * «שיחות אחרונות» and «ביטול תיעוד» follow the Dashboard CRM (E-Zone-Dashboard public/crm/crm.js):
 * same lists, same wording, same rules. Adapted, not copied — this app's subjects are
 * { leadId, clientId } and its tasks have no week window. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CrmActivity = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // The channels the form offers (the Dashboard CRM's list). 'meeting' is no longer offered but
  // stays a valid stored value (ALL_CHANNELS, mirrors Code.gs CONTACT_CHANNELS).
  var CHANNELS = [
    { id: 'phone', he: 'טלפון' }, { id: 'whatsapp', he: 'וואטסאפ' }, { id: 'sms', he: 'SMS' },
    { id: 'email', he: 'דוא״ל' }, { id: 'in_person', he: 'פנים אל פנים' }, { id: 'other', he: 'אחר' }
  ];
  var ALL_CHANNELS = CHANNELS.concat([{ id: 'meeting', he: 'פגישה' }]);
  var OUTCOMES = [
    { id: 'spoke_follow_up', he: 'התקיימה שיחה ונדרש המשך' }, { id: 'spoke_no_follow_up', he: 'התקיימה שיחה — לא נדרש המשך' },
    { id: 'no_answer', he: 'לא היה מענה' },
    { id: 'call_back_later', he: 'התבקשנו לחזור במועד' }, { id: 'awaiting_decision', he: 'ממתינים להחלטה או למידע' },
    { id: 'meeting_set', he: 'נקבעה פגישה' }, { id: 'no_interest_now', he: 'אין עניין כרגע' },
    { id: 'bad_contact_details', he: 'פרטי הקשר אינם תקינים' }, { id: 'stop_contact', he: 'התבקשה הפסקת פניות' }
  ];
  /* The three kinds of a contact record: «שיחה יוצאת» (we called), «שיחה נכנסת» (they called us),
   * «תיעוד שיחה» (a record with no direction — also every record written before the field existed). */
  var DIRECTIONS = [{ id: 'out', he: 'שיחה יוצאת' }, { id: 'in', he: 'שיחה נכנסת' }, { id: 'note', he: 'תיעוד שיחה' }];
  var DIRECTION_CHIPS = { out: 'ok', in: 'today', note: 'wait' };
  var DIR_TEXT = { who: { out: 'מי ביצע', in: 'מי קיבל/ה את השיחה', note: 'מי תיעד/ה' }, withWhom: { out: 'עם מי', in: 'מי התקשר/ה', note: 'עם מי' } };
  /* Outcomes that only describe OUR attempt — not offered for an incoming call. */
  var OUTGOING_ONLY_OUTCOMES = ['no_answer', 'bad_contact_details'];
  /* 'spoke_no_follow_up' IS the answer to «what next»: «ללא משימת המשך» needs no typed explanation. */
  var NO_FOLLOW_UP_OUTCOME = 'spoke_no_follow_up';
  var NO_FOLLOW_UP_TEXT = 'לא נדרש המשך';
  /* «קשר הבא»: no automatic default — the user picks. (The Dashboard's «במהלך שבוע נבחר» is not
   * offered: this app's tasks have a date, never a week window.) */
  var NEXT_CHOICES = [
    { id: 'd1', he: 'מחר', days: 1 }, { id: 'd3', he: 'בעוד 3 ימים', days: 3 }, { id: 'd7', he: 'בעוד שבוע', days: 7 },
    { id: 'd14', he: 'בעוד שבועיים', days: 14 }, { id: 'd30', he: 'בעוד חודש', days: 30 },
    { id: 'days', he: 'בעוד X ימים' }, { id: 'date', he: 'תאריך ושעה' }, { id: 'none', he: 'ללא משימת המשך' }
  ];
  var DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  // A task with NO date is work for today (Sandra, 22/11/2026): it sorts with today's, ahead of future dates.
  var STATE_ORDER = { late: 0, today: 1, undated: 2, wait: 3 };
  var CONTACT_EVENT_ID_RE = /^contact:[A-Za-z0-9_:-]{1,110}$/;
  var TASK_KINDS = [
    { id: 'call', he: 'שיחה' }, { id: 'meeting', he: 'פגישה' }, { id: 'intro', he: 'שיחת היכרות' }, { id: 'plan', he: 'תוכנית טיפול' },
    { id: 'activation', he: 'הפעלת טיפול' }, { id: 'continuity', he: 'המשך טיפול' }, { id: 'collection', he: 'גבייה', money: true },
    { id: 'review', he: 'בירור' }, { id: 'other', he: 'אחר' }
  ];
  var EVENT_HE = {
    contact_logged: 'יצירת קשר', task_created: 'משימה נוצרה', task_completed: 'משימה הושלמה', task_deferred: 'משימה נדחתה',
    task_reassigned: 'אחריות הועברה', task_cancelled: 'משימה בוטלה', contact_voided: 'תיעוד בוטל'
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
  function details(e) {
    try { var d = e && e.detailsJson ? JSON.parse(e.detailsJson) : {}; return d && typeof d === 'object' ? d : {}; } catch (_) { return {}; }
  }
  function isoOk(v) { return /^\d{4}-\d{2}-\d{2}$/.test(s(v)) && !isNaN(Date.parse(s(v) + 'T00:00:00Z')); }
  function timeOk(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s(v)); }
  function addDays(iso, n) { var d = new Date(s(iso) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(s(b) + 'T00:00:00Z') - Date.parse(s(a) + 'T00:00:00Z')) / 86400000); }
  function weekdayOf(iso) { return new Date(s(iso) + 'T00:00:00Z').getUTCDay(); }
  function dateWithDay(iso) { return fmtDate(iso) + ' (' + DAY_NAMES[weekdayOf(iso)] + ')'; }

  /* ---- the contact record (Dashboard CRM rules) ---- */
  /* The kind of a STORED record: anything but 'out' / 'in' (missing included) is «תיעוד שיחה». */
  function contactDirection(d) { var x = s(d && d.direction); return x === 'out' || x === 'in' ? x : 'note'; }
  function directionLabel(id) { return heOf(DIRECTIONS, id) || DIRECTIONS[2].he; }
  function outcomesFor(direction) {
    return direction === 'in' ? OUTCOMES.filter(function (o) { return OUTGOING_ONLY_OUTCOMES.indexOf(o.id) < 0; }) : OUTCOMES.slice();
  }
  /* The follow-up the form describes. choice ∈ NEXT_CHOICES; v = { days, date, time, explanation }.
   * → { none, explanation } | { dueDate, dueTime }, always with `text` (the actual date shown); null = incomplete. */
  function nextPlan(choice, v, today) {
    var c = null;
    for (var i = 0; i < NEXT_CHOICES.length; i++) if (NEXT_CHOICES[i].id === choice) c = NEXT_CHOICES[i];
    if (!c || !isoOk(today)) return null;
    v = v || {};
    var d;
    if (c.days) { d = addDays(today, c.days); return { dueDate: d, dueTime: '', text: c.he + ' — ' + dateWithDay(d) }; }
    if (c.id === 'days') {
      var n = Number(v.days);
      if (!(n >= 1 && n <= 365 && n === Math.floor(n))) return null;
      d = addDays(today, n);
      return { dueDate: d, dueTime: '', text: 'בעוד ' + n + ' ימים — ' + dateWithDay(d) };
    }
    if (c.id === 'date') {
      if (!isoOk(v.date) || s(v.date) < today) return null;
      var t = s(v.time);
      if (t && !timeOk(t)) return null;
      return { dueDate: s(v.date), dueTime: t, text: fmtDate(v.date) + (t ? ' ' + t : '') + ' (' + DAY_NAMES[weekdayOf(v.date)] + ')' };
    }
    var ex = s(v.explanation);
    return ex.length >= 2 ? { none: true, explanation: ex, text: 'ללא משימת המשך — ' + ex } : null;
  }
  /* The follow-up of the form's values (one rule for the preview, the check and the body). */
  function contactNextPlan(v, today) {
    v = v || {};
    var ex = s(v.nextExplanation) || (v.next === 'none' && v.outcome === NO_FOLLOW_UP_OUTCOME ? NO_FOLLOW_UP_TEXT : '');
    return nextPlan(v.next, { days: v.nextDays, date: v.nextDate, time: v.nextTime, explanation: ex }, today);
  }
  /* The contact form → errors by field. v = { direction, when, time, withWhom, channel, reason, outcome,
   * summary, next, nextDays, nextDate, nextTime, nextExplanation }. Nothing is pre-chosen for «קשר הבא». */
  function contactErrors(v, today) {
    var e = {};
    v = v || {};
    if (!isoOk(v.when) || s(v.when) > today) e.when = 'תאריך השיחה — היום או קודם';
    if (s(v.time) && !timeOk(v.time)) e.time = 'שעה בפורמט HH:MM';
    if (!CHANNELS.some(function (c) { return c.id === v.channel; })) e.channel = 'בחרי ערוץ';
    if (!DIRECTIONS.some(function (d) { return d.id === v.direction; })) e.direction = 'בחרי: שיחה יוצאת, שיחה נכנסת או תיעוד שיחה';
    if (!outcomesFor(s(v.direction)).some(function (o) { return o.id === v.outcome; })) e.outcome = 'בחרי תוצאה';
    if (s(v.summary).length > 1000) e.summary = 'עד 1000 תווים';
    if (s(v.withWhom).length > 80) e.withWhom = 'עד 80 תווים';
    if (!v.next) e.next = 'בחרי מה הלאה — אין ברירת מחדל';
    else if (!contactNextPlan(v, today)) {
      e.next = v.next === 'none' ? 'ללא משימת המשך — חובה להסביר (2 תווים לפחות)' : v.next === 'days' ? 'מספר ימים בין 1 ל-365' : 'תאריך מהיום והלאה';
    }
    return e;
  }
  /* The logContact body. subject = { leadId, clientId }; the actor is the session user (server side). */
  function contactBody(subject, v, sid, taskId, today) {
    var plan = contactNextPlan(v, today) || {};
    var contact = {
      leadId: s(subject && subject.leadId), clientId: s(subject && subject.clientId),
      direction: DIRECTIONS.some(function (d) { return d.id === v.direction; }) ? v.direction : 'note',
      // local wall-clock, as the Activity sheet stores it (no time → noon, so the day never shifts)
      occurredAt: s(v.when) + 'T' + (timeOk(v.time) ? s(v.time) : '12:00'),
      withWhom: s(v.withWhom), channel: s(v.channel), reason: s(v.reason), outcome: s(v.outcome), summary: s(v.summary),
      taskId: s(taskId)
    };
    var next = plan.none ? { none: true, explanation: plan.explanation } : { dueDate: plan.dueDate, dueTime: plan.dueTime || '' };
    if (!next.none) {
      next.kind = 'call';
      next.title = s(v.nextTitle) || ('לחזור — ' + heOf(OUTCOMES, v.outcome));
      if (s(v.nextAssignee)) next.assignee = s(v.nextAssignee);
      if (s(v.summary)) next.reason = s(v.summary).slice(0, 300);
    }
    return { submissionId: sid, contact: contact, next: next };
  }
  /* A record entered by mistake is VOIDED, never deleted: a contact_voided event names it in
   * detailsJson.supersedesEventId (Code.gs _voidContact). → { eventId: true } of the voided records. */
  function contactVoidedIds(events) {
    var out = {};
    (Array.isArray(events) ? events : []).forEach(function (e) {
      if (e && s(e.kind) === 'contact_voided' && s(details(e).supersedesEventId)) out[s(details(e).supersedesEventId)] = true;
    });
    return out;
  }
  /* What a contact record says, from its details (never from the stored summary line, so a record
   * reads the same whatever wording it was saved under). */
  function contactEventText(e) {
    var d = details(e);
    return s(d.outcome) ? heOf(OUTCOMES, d.outcome) + (s(d.summary) ? ' · ' + s(d.summary) : '') : s(e && e.summary);
  }
  /* «שיחות אחרונות» of a card: the last documented contacts (newest first, voided left out).
   * → { total, items: [{ eventId, when, actorName, direction, outcome, text, nextTaskId }] }. */
  function recentContacts(events, subject, limit) {
    var mine = (Array.isArray(events) ? events : []).filter(function (e) { return matches(e, subject); });
    var voided = contactVoidedIds(mine);
    var all = mine.filter(function (e) { return s(e.kind) === 'contact_logged' && !voided[s(e.eventId)]; })
      .sort(function (a, b) { return s(a.occurredAt) < s(b.occurredAt) ? 1 : (s(a.occurredAt) > s(b.occurredAt) ? -1 : 0); });
    var n = Number(limit) > 0 ? Math.floor(Number(limit)) : 3;
    return { total: all.length, items: all.slice(0, n).map(function (e) {
      var d = details(e);
      return { eventId: s(e.eventId), when: fmtWhen(e.occurredAt), actorName: s(e.actorName), direction: contactDirection(d), outcome: s(d.outcome), text: contactEventText(e), nextTaskId: s(d.nextTaskId) };
    }) };
  }
  /* voidContact: the check before the post. '' = fine. */
  function voidContactError(eventId, reason) {
    if (!CONTACT_EVENT_ID_RE.test(s(eventId))) return 'התיעוד אינו תקין — רענני את הדף';
    return s(reason).length < 2 ? 'יש לציין סיבה קצרה לביטול' : (s(reason).length > 300 ? 'עד 300 תווים' : '');
  }
  /* «מה הלאה» on a card: the open tasks of the subject as plain sentences — WHAT, WHEN (relative +
   * the real date + the weekday) and WHO — most urgent first.
   * → [{ id, kind, title, reason, assignee, state, rel, when }]. */
  function nextSteps(subject, tasks, today) {
    return (Array.isArray(tasks) ? tasks : []).filter(function (t) { return openish(t) && matches(t, subject); }).map(function (t) {
      var st = dueState(t, today), due = isoDay(t.dueDate);
      var n = due && isoOk(today) ? daysBetween(today, due) : null;
      var rel = st === 'undated' ? 'לטיפול היום'
        : st === 'late' ? 'באיחור' + (n !== null && n < 0 ? ' של ' + (-n === 1 ? 'יום' : -n + ' ימים') : '')
        : n === 0 ? 'היום' : n === 1 ? 'מחר' : 'בעוד ' + n + ' ימים';
      return { id: s(t.id), kind: s(t.kind), title: s(t.title), reason: s(t.reason), assignee: s(t.assignee), state: st, rel: rel,
        when: due ? dateWithDay(due) + (s(t.dueTime) ? ' ' + s(t.dueTime) : '') : '', due: (due || '9999') + ' ' + (s(t.dueTime) || '99:99') };
    }).sort(function (a, b) { return (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0); });
  }
  /* «משימה חדשה»: what to do and who. The DATE and the TIME are OPTIONAL (Sandra, 22/11/2026 — a
   * request such as «לתאם פגישה עם ד״ר נטליה ביום שני» has no hour yet, and may have no date: what
   * matters is that it is handled today). The form opens on today's date; no time = any time that
   * day; no date = stays in «היום» until handled. A typed date is today or later; a time needs a date. */
  function newTaskErrors(v, today) {
    var e = {};
    v = v || {};
    if (!TASK_KINDS.some(function (k) { return k.id === v.kind; })) e.kind = 'בחרי סוג';
    if (!s(v.title) || s(v.title).length > 160) e.title = 'כותרת (עד 160 תווים)';
    if (s(v.dueDate) && (!isoOk(v.dueDate) || s(v.dueDate) < s(today))) e.dueDate = 'תאריך — היום או אחריו';
    if (s(v.dueTime) && !timeOk(v.dueTime)) e.dueTime = 'שעה בפורמט HH:MM';
    else if (s(v.dueTime) && !s(v.dueDate)) e.dueTime = 'שעה דורשת תאריך';
    return e;
  }
  /* «שינוי מועד»: a date (+ time); a reason is required when the task came from a contact
   * (a date promised to the patient / family). */
  function rescheduleErrors(v, task) {
    var e = {};
    v = v || {};
    if (!isoOk(v.dueDate)) e.dueDate = 'בחרי תאריך';
    if (s(v.dueTime) && !timeOk(v.dueTime)) e.dueTime = 'שעה HH:MM';
    if (task && s(task.source) === 'contact' && s(v.reason).length < 2) e.reason = 'מועד שהובטח בשיחה — חובה לציין סיבה';
    return e;
  }

  /* Per-subject summary. subject = { leadId } | { clientId } (a client may also pass
   * its fromLead as leadId so the lead-era history follows it). */
  function summarize(tasks, events, subject, today) {
    var mine = (tasks || []).filter(function (t) { return matches(t, subject); });
    var evs = (events || []).filter(function (e) { return matches(e, subject); });
    evs.sort(function (a, b) { return s(b.occurredAt) < s(a.occurredAt) ? -1 : s(b.occurredAt) > s(a.occurredAt) ? 1 : 0; });
    var voided = contactVoidedIds(evs);
    var contacts = evs.filter(function (e) { return e.kind === 'contact_logged' && !voided[s(e.eventId)]; });
    var last = contacts[0] || null;
    var open = mine.filter(openish).sort(sortByDue);
    var next = open[0] || null;
    return {
      lastContact: last ? { when: fmtWhen(last.occurredAt), who: s(last.actorName), summary: s(last.summary), channel: heOf(ALL_CHANNELS, details(last).channel), outcome: details(last).outcome, direction: contactDirection(details(last)) } : null,
      nextAction: next ? { id: next.id, title: s(next.title), due: fmtDate(next.dueDate), dueTime: s(next.dueTime), assignee: s(next.assignee), state: dueState(next, today) } : null,
      openTasks: open.map(function (t) { return Object.assign({}, t, { state: dueState(t, today), stateText: stateText(dueState(t, today)), kindHe: heOf(TASK_KINDS, t.kind) }); }),
      overdue: open.filter(function (t) { return isOverdue(t, today); }).length,
      timeline: evs.map(function (e) {
        var isContact = e.kind === 'contact_logged';
        return { eventId: e.eventId, when: fmtWhen(e.occurredAt), kind: e.kind, kindHe: EVENT_HE[e.kind] || e.kind, who: s(e.actorName),
          summary: isContact ? contactEventText(e) : s(e.summary), nextAction: s(e.nextAction), nextDate: fmtDate(e.nextDate), details: details(e),
          direction: isContact ? contactDirection(details(e)) : '', voided: isContact && !!voided[s(e.eventId)] };
      }),
      total: mine.length
    };
  }

  /* A browser-minted idempotency key: unique enough per device, no PII. */
  function newSubmissionId(prefix) {
    return (prefix || 'sub') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  return {
    CHANNELS: CHANNELS, ALL_CHANNELS: ALL_CHANNELS, OUTCOMES: OUTCOMES, TASK_KINDS: TASK_KINDS, EVENT_HE: EVENT_HE,
    DIRECTIONS: DIRECTIONS, DIRECTION_CHIPS: DIRECTION_CHIPS, DIR_TEXT: DIR_TEXT, OUTGOING_ONLY_OUTCOMES: OUTGOING_ONLY_OUTCOMES,
    NO_FOLLOW_UP_OUTCOME: NO_FOLLOW_UP_OUTCOME, NO_FOLLOW_UP_TEXT: NO_FOLLOW_UP_TEXT, NEXT_CHOICES: NEXT_CHOICES, DAY_NAMES: DAY_NAMES,
    CONTACT_EVENT_ID_RE: CONTACT_EVENT_ID_RE,
    contactDirection: contactDirection, directionLabel: directionLabel, outcomesFor: outcomesFor, nextPlan: nextPlan,
    contactNextPlan: contactNextPlan, contactErrors: contactErrors, contactBody: contactBody, contactVoidedIds: contactVoidedIds,
    contactEventText: contactEventText, recentContacts: recentContacts, voidContactError: voidContactError, nextSteps: nextSteps,
    newTaskErrors: newTaskErrors, rescheduleErrors: rescheduleErrors, dateWithDay: dateWithDay,
    heOf: heOf, fmtDate: fmtDate, fmtWhen: fmtWhen, isOverdue: isOverdue, isDueToday: isDueToday, dueState: dueState, stateText: stateText,
    summarize: summarize, newSubmissionId: newSubmissionId, matches: matches
  };
}));
