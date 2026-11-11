/* One-time sessions (טיפול חד פעמי) — pure helpers for app.js and «היום שלי».
 * CHANGELOG-one-time-session.md.
 *
 * A one-time session is ONE scheduled session for a patient: a package
 * patient's extra session outside the package, or a per-session payer's
 * session. The source (Apps Script) owns the price; the browser
 * creates the linked charge through the existing durable extra-charge protocol.
 *
 * PURE: no DOM, no fetch, no clock — `today` (YYYY-MM-DD, Asia/Jerusalem) is
 * injected. UMD so node --test exercises it directly. Status keys are stable
 * English; every Hebrew label lives here and is applied at render time. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OneTimeSessions = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var STATUS_HE = {
    scheduled: 'מתוכנן',
    completed: 'התקיים',
    no_show: 'לא הגיע/ה',
    therapist_cancelled: 'בוטל ע״י המטפל/ת',
    cancelled: 'בוטל'
  };
  var OUTCOME_HE = { happened: 'התקיים', patient_no_show: 'לא הגיע/ה', therapist_cancelled: 'המטפל/ת ביטל/ה' };
  /* Service labels by the CLINICAL type the source mapped the single-session
   * catalog row to (no catalog key or price is shipped to the browser).
   * Unknown types show as the clinical type itself. */
  var SERVICE_HE = {
    'פרטני EMDR': 'EMDR — טיפול בודד',
    'פרטני CBT': 'CBT — טיפול בודד',
    'מעקב פסיכיאטרי': 'ייעוץ פסיכיאטרי',
    'אינטייק': 'אבחון פסיכיאטרי'
  };
  /* Mirror of ONE_TIME_CHARGE_TREATMENT_TYPES / CLINICAL_TO_BILLING in Code.gs
   * for the charge draft (test/one-time-session-logic.test.js pins the parity). */
  var CHARGE_TREATMENT_TYPES = ['פרטני', 'פרטני CBT', 'פרטני EMDR', 'קבוצה', 'טיפול משפחתי', 'ליווי יומי בקהילה', 'מעקב פסיכיאטרי'];
  var CLINICAL_TO_CHARGE = { 'פרטני EMDR': 'פרטני EMDR', 'פרטני CBT': 'פרטני CBT', 'מעקב פסיכיאטרי': 'מעקב פסיכיאטרי' };
  var ERROR_HE = {
    bad_id: 'מזהה לא תקין — רעננו ונסו שוב',
    bad_op_id: 'מזהה פעולה לא תקין — רעננו ונסו שוב',
    id_conflict: 'הבקשה כבר נשמרה עם פרטים אחרים — רעננו את המסך',
    client_not_found: 'המטופל/ת לא נמצא/ה',
    invalid_service: 'השירות אינו זמין בקטלוג (טיפול בודד פעיל בלבד)',
    unknown_therapist: 'יש לבחור מטפל/ת מהרשימה',
    bad_date: 'תאריך לא תקין',
    bad_time: 'שעה לא תקינה (HH:MM)',
    bad_location: 'מיקום לא תקין',
    note_too_long: 'ההערה ארוכה מדי (עד 300 תווים)',
    duplicate_session: 'כבר קיים טיפול חד פעמי למטופל/ת באותו מועד',
    therapist_busy: 'המטפל/ת כבר משובץ/ת לטיפול חד פעמי באותו מועד',
    revision_conflict: 'הרשומה עודכנה בינתיים — רעננו ונסו שוב',
    not_scheduled: 'אפשר לשנות רק טיפול מתוכנן',
    not_cancellable: 'הטיפול כבר נסגר',
    bad_reason: 'יש לכתוב סיבה (2–200 תווים)',
    no_changes: 'לא שונה דבר',
    session_in_future: 'אי אפשר לסמן תוצאה לפני מועד הטיפול',
    session_cancelled: 'הטיפול בוטל',
    unknown_outcome: 'תוצאה לא מוכרת',
    unknown_type: 'סוג הטיפול אינו מוכר לתשלום המטפלים',
    not_found: 'הטיפול לא נמצא',
    busy: 'המערכת עסוקה — נסו שוב בעוד רגע',
    forbidden_money_action: 'אין הרשאה לפעולה כספית',
    extra_pending: 'יש חיוב נוסף פתוח למטופל/ת — יש להשלים אותו ב«+ הוסף טיפול» ואז לנסות שוב'
  };

  function s(v) { return String(v == null ? '' : v).trim(); }
  function isoDay(v) { var t = s(v); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''; }
  function addDays(iso, n) {
    var d = new Date(isoDay(iso) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function statusLabel(st) { return STATUS_HE[s(st)] || s(st) || '—'; }
  function serviceLabel(key, clinical) { return SERVICE_HE[s(clinical)] || s(clinical) || s(key) || '—'; }
  function errorText(code) {
    var c = s(code);
    if (c.indexOf('unauthorized') >= 0) return 'אין הרשאה — התחברו מחדש';
    return ERROR_HE[c] || c || 'שגיאה';
  }
  function newId() {
    var c = (typeof crypto !== 'undefined' && crypto) || null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* The client's sessions: upcoming scheduled first (soonest first), then the
   * rest newest first. `limit` caps the closed ones (scheduled are never cut). */
  function forClient(sessions, clientId, limit) {
    var mine = (sessions || []).filter(function (x) { return x && s(x.clientId) === s(clientId); });
    var key = function (x) { return isoDay(x.date) + ' ' + s(x.time); };
    var open = mine.filter(function (x) { return x.status === 'scheduled'; }).sort(function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });
    var closed = mine.filter(function (x) { return x.status !== 'scheduled'; }).sort(function (a, b) { return key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0; });
    return open.concat(typeof limit === 'number' ? closed.slice(0, limit) : closed);
  }

  /* The linked charge's state, from what the host loaded:
   *   'paid' | 'partial' | 'unpaid' — the charge exists (status from its ::once payment)
   *   'missing'  — charges loaded and no charge row has the linked id
   *   'unknown'  — charges did not load (never guess)
   * `statusOf(charge)` is the host's existing chargeStatusFor. */
  function chargeState(session, charges, chargesLoaded, statusOf) {
    if (!chargesLoaded) return 'unknown';
    var id = s(session && session.chargeId);
    var ch = null;
    (charges || []).forEach(function (c) { if (c && s(c.id) === id && c.active !== false) ch = c; });
    if (!ch) return 'missing';
    var st = typeof statusOf === 'function' ? statusOf(ch) : 'unpaid';
    return st === 'paid' || st === 'partial' ? st : 'unpaid';
  }
  var CHARGE_HE = { paid: 'שולם', partial: 'שולם חלקית', unpaid: 'לא שולם', missing: 'חיוב לא נוצר', unknown: 'מצב החיוב לא זמין' };
  function chargeLabel(state) { return CHARGE_HE[s(state)] || '—'; }

  /* Which actions a row offers (the host also gates on editor + money scope). */
  function actionsFor(session, today, chargeSt) {
    var st = s(session && session.status), d = isoDay(session && session.date), t = isoDay(today);
    var out = [];
    if (st === 'scheduled') out.push('edit');
    if (st === 'scheduled' && d && t && d <= t) { out.push('happened'); out.push('patient_no_show'); }
    if (st === 'scheduled') out.push('therapist_cancelled');
    if (st === 'scheduled' || st === 'therapist_cancelled') out.push('cancel');
    if (chargeSt === 'missing' && st !== 'cancelled') out.push('complete_charge');
    if (st === 'cancelled' && (chargeSt === 'unpaid')) out.push('remove_charge');
    return out;
  }

  /* The charge for the durable extra-charge protocol, rebuilt from a stored
   * session (retry when the first creation did not finish). Mirrors
   * _otsChargeDraft in Code.gs field for field. */
  function chargeDraft(session) {
    var clinical = s(session.clinicalTreatmentType);
    var billing = CLINICAL_TO_CHARGE[clinical] || '';
    return {
      id: s(session.chargeId), clientId: s(session.clientId),
      description: 'טיפול חד פעמי — ' + clinical + ' · ' + s(session.therapist) + ' · ' + s(session.date) + ' ' + s(session.time),
      amount: Number(session.amount) || 0,
      billingType: 'one_time', chargeDate: s(session.date), billingDay: '',
      notes: 'oneTimeSession:' + s(session.id),
      treatmentType: CHARGE_TREATMENT_TYPES.indexOf(billing) >= 0 ? billing : '',
      frequencyPerWeek: ''
    };
  }

  /* «היום שלי» input rows: each session decorated with its charge state. The
   * builder decides what is work today. */
  function myDayRows(sessions, today) {
    var t = isoDay(today), soon = addDays(t, 2);
    var out = [];
    (sessions || []).forEach(function (x) {
      if (!x || !s(x.id)) return;
      var d = isoDay(x.date), st = s(x.status);
      if (st === 'scheduled' && d === t) out.push({ session: x, kind: 'one_time_today' });
      else if (st === 'scheduled' && d && d < t) out.push({ session: x, kind: 'one_time_unmarked' });
      if (st === 'therapist_cancelled') out.push({ session: x, kind: 'one_time_therapist_cancelled' });
      if (st === 'scheduled' && d && d <= soon && x.chargeState === 'unpaid') out.push({ session: x, kind: 'one_time_unpaid', money: true });
      if (st !== 'cancelled' && x.chargeState === 'missing') out.push({ session: x, kind: 'one_time_charge_missing', money: true });
    });
    return out;
  }

  return {
    STATUS_HE: STATUS_HE, OUTCOME_HE: OUTCOME_HE, SERVICE_HE: SERVICE_HE, ERROR_HE: ERROR_HE,
    CHARGE_TREATMENT_TYPES: CHARGE_TREATMENT_TYPES, CLINICAL_TO_CHARGE: CLINICAL_TO_CHARGE,
    statusLabel: statusLabel, serviceLabel: serviceLabel, errorText: errorText, newId: newId,
    forClient: forClient, chargeState: chargeState, chargeLabel: chargeLabel, actionsFor: actionsFor,
    chargeDraft: chargeDraft, myDayRows: myDayRows, addDays: addDays
  };
}));
