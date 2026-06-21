/* E-ZONE Therapists — frontend (iteration 3: dashboard + assignment workflow) */
(function () {
  'use strict';

  // Surface uncaught errors as a toast (same convention as the siblings).
  window.addEventListener('error', function (ev) {
    try {
      var msg = (ev && ev.error && ev.error.message) || ev.message || 'Unknown error';
      var where = ev.filename ? (' @ ' + ev.filename + ':' + ev.lineno) : '';
      var t = document.getElementById('toast');
      if (t) { t.textContent = 'JS error: ' + msg + where; t.classList.add('error'); t.hidden = false; }
      console.error('[ezone-therapists] window error', ev.error || ev.message, where);
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    console.error('[ezone-therapists] unhandled rejection', ev.reason);
  });

  // Modules loaded as globals before this file (see index.html).
  var Phone = window.Phone;
  var DebtGate = window.DebtGate;
  var Approval = window.Approval;
  var Scheduling = window.Scheduling;
  var DebtAlert = window.DebtAlert;
  var Writeback = window.Writeback;
  var Access = window.Access;

  // Scheduling LOCATIONS are a fixed code list (id stored, Hebrew shown). This
  // is the therapist's scheduling choice — independent of any roster house.
  var LOCATIONS = [
    { id: 'sde_eliaz',     he: 'שדה אליעז' },
    { id: 'rehab',         he: 'קיסריה ריהאב' },
    { id: 'efroni',        he: 'קיסריה עפרוני' },
    { id: 'raanana_asher', he: 'רעננה אשר' },
    { id: 'raanana_pardes', he: 'רעננה הפרדס' },
    { id: 'ramot',         he: 'רמות השבים' }
  ];
  // Display labels for ids that may sit on OLDER bookings (pre-iteration-10 list)
  // so historical rows still read in Hebrew even though they're off the dropdown.
  var LEGACY_LOCATION_LABELS = { raanana: 'רעננה אשר', asher: 'אשר', arfoni: 'קיסריה עפרוני' };
  function locationLabel(v) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < LOCATIONS.length; i++) if (LOCATIONS[i].id === s) return LOCATIONS[i].he;
    return LEGACY_LOCATION_LABELS[s] || s;
  }

  // ORIGIN HOUSES — a SEPARATE list from the scheduling LOCATIONS, used for the
  // "still admitted — which house" field on the intake record.
  var ORIGIN_HOUSES = [
    { id: 'raanana',  he: 'רעננה אשר' },
    { id: 'ramot',    he: 'רמות השבים' },
    { id: 'efroni',   he: 'קיסריה עפרוני' },
    { id: 'rehab',    he: 'קיסריה ריהאב' },
    { id: 'external', he: 'חיצוני' }
  ];
  function houseLabel(v) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < ORIGIN_HOUSES.length; i++) if (ORIGIN_HOUSES[i].id === s) return ORIGIN_HOUSES[i].he;
    return s;
  }
  // Display-only relabel for legacy outpatient service terms (e.g. מרכז יום).
  function svc(v) { return Scheduling.displayServiceType(v); }

  // --- access: NO roles, NO login -----------------------------------------
  // The app opens directly; all three tabs are visible to everyone. The only
  // "identity" is the therapist NAME picked inside «המטופלים שלי» (tab 3) — fresh
  // each open, NOT persisted. Scheduling/reporting there require a name picked
  // (`hasTherapist`); tab-2 actions (register/assign) are open to all. The real
  // controls are the outpatient debt gate + the Ron/Sandra approval audit.
  function hasTherapist() { return !!state.therapist; }

  // Hebrew copy for each gate flag reason (stable ids come from debt-gate.js).
  var FLAG_TEXT = {
    no_payment_record: 'אין רישום תשלומים עבור מטופל זה — לא ניתן לקבוע חוב. דרוש בירור ידני.',
    no_record: 'הטלפון אינו תואם לאף מטופל חוץ. דרוש בירור ידני.',
    ambiguous: 'הטלפון תואם ליותר ממטופל אחד. דרוש בירור ידני.',
    lookup_failed: 'בדיקת החוב אינה זמינה כרגע — הטיפול יישמר לבירור (לא אומת חוב).'
  };

  // --- state -------------------------------------------------------------
  var state = {
    therapist: '',         // tab-3 selection only — runtime, never persisted
    view: 'dashboard',
    schedule: [],
    occurrences: [],       // virtual recurring occurrences for the coming week
    approvals: [],
    patients: [],
    assignments: [],
    therapists: [],
    treatmentTypes: [],
    debtRoster: [], debtRosterOk: false,
    plans: [], plansOk: false,
    alerts: [],
    dashboardSearch: '',
    workflowSearch: '',
    workflowTherapist: '',
    mineSearch: '',
    loaded: false
  };

  // Per-patient gate decisions pending in the schedule modal (null until check).
  var pendingPatients = null;

  // --- utils -------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function uid() { return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function daysFromToday(n) {
    var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function fmtDate(v) {
    if (!v) return '';
    var s = String(v);
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    return s;
  }
  function displayDate(v) {
    var s = fmtDate(v);
    if (!s) return '';
    var parts = s.split('-');
    if (parts.length !== 3) return s;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  function money(n) {
    if (!isFinite(n)) return '₪0';
    return '₪' + Math.round(n).toLocaleString('he-IL');
  }
  function displayDateTime(date, time) {
    var d = displayDate(date);
    var t = String(time || '').trim();
    return t ? (d + ' ' + t) : d;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normPhone(v) { return Phone.normalizeForMatch(v); }
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // --- API ---------------------------------------------------------------
  async function apiLoad() {
    var r = await fetch('/api/sheets', { cache: 'no-store' });
    var data = await r.json();
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiPost(body) {
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  // saveSession verifies each patient row server-side and may PARTIALLY reject;
  // tolerate ok:false as long as a results array came back (only a transport
  // failure throws), so per-patient rejections are visible.
  async function apiSaveSession(rows) {
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveSession', rows: rows })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!Array.isArray(data.results)) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  function apiUpdateBooking(id, fields) {
    return apiPost({ action: 'updateBooking', id: id, scheduledDate: fields.scheduledDate, time: fields.time, location: fields.location });
  }
  function apiRemoveSchedule(id) { return apiPost({ action: 'removeSchedule', id: id }); }
  function apiMarkAttendance(id, attendance, extra) {
    extra = extra || {};
    return apiPost({
      action: 'markAttendance', id: id, attendance: attendance,
      reason: extra.reason || '', approval: extra.approval || null,
      flagged: !!extra.flagged, gateReason: extra.gateReason || '',
      // For a recurring occurrence (virtual until reported), the backend
      // materializes this booking row first (create-only, idempotent by id).
      occurrence: extra.occurrence || null
    });
  }
  // iteration 18 step 2 — record the 3-state session outcome (storage-only; no
  // debt gate, no outpatient write-back — that's step 3). For a virtual recurring
  // occurrence the backend materializes the booking row first (idempotent by id).
  function apiSetSessionOutcome(id, outcome, extra) {
    extra = extra || {};
    return apiPost({
      action: 'setSessionOutcome', id: id, outcome: outcome,
      outcomeAt: extra.outcomeAt || '', occurrence: extra.occurrence || null
    });
  }
  function apiSyncPending() { return apiPost({ action: 'syncPending' }); }
  function apiSavePatient(patient, mode) { return apiPost({ action: 'savePatient', patient: patient, mode: mode || 'edit' }); }
  function apiMarkPatientStopped(body) { return apiPost(Object.assign({ action: 'markPatientStopped' }, body)); }
  function apiRestorePatient(body) { return apiPost(Object.assign({ action: 'restorePatient' }, body)); }
  function apiRemovePatient(body) { return apiPost(Object.assign({ action: 'removePatient' }, body)); }
  function apiSaveAssignment(assignment) { return apiPost({ action: 'saveAssignment', assignment: assignment }); }
  function apiRemoveAssignment(id) { return apiPost({ action: 'removeAssignment', id: id }); }

  // The assignment ALWAYS saves locally; pushing the clinical billing type to
  // outpatient is a best-effort side-effect the server reports back as
  // `clinicalSync`. ClinicalSync.warningFor maps a FAILED sync to a Hebrew reason
  // so we WARN rather than silently swallow it (null = nothing pushed / synced OK).
  function clinicalSyncWarning(data) {
    return ClinicalSync.warningFor(data && data.clinicalSync);
  }
  // Same shape for the session-outcome push: the outcome ALWAYS saves locally;
  // the pay-sync to outpatient (recordSessionOutcome) is reported back as
  // `outcomeSync`. OutcomeSync.warningFor maps a FAILED sync to a Hebrew reason so
  // we WARN rather than silently swallow it (null = nothing pushed / synced OK).
  function outcomeSyncWarning(data) {
    return OutcomeSync.warningFor(data && data.outcomeSync);
  }
  // Live read — never cached.
  async function apiDebtStatus() {
    var r = await fetch('/api/debt-status', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiTreatmentPlans() {
    var r = await fetch('/api/treatment-plans', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  function normalizeScheduleRow(row) {
    return {
      id: row.id || uid(),
      sessionId: row.sessionId || '',
      therapist: row.therapist || '',
      treatmentType: row.treatmentType || '',
      location: row.location || '',
      scheduledDate: fmtDate(row.scheduledDate),
      time: row.time || '',
      patientName: row.patientName || '',
      patientPhone: Phone.recoverStored(row.patientPhone || ''),
      attendance: row.attendance || '',
      attendanceMarkedAt: row.attendanceMarkedAt || '',
      reason: row.reason || '',
      // iteration 18 step 2 — 3-state session outcome (storage-only) + its stamp.
      outcome: row.outcome || '',
      outcomeAt: row.outcomeAt || '',
      gateStatus: row.gateStatus || '',
      gateReason: row.gateReason || '',
      amountOwed: Number(row.amountOwed) || 0,
      approverId: row.approverId || '',
      approverName: row.approverName || '',
      approvalNote: row.approvalNote || '',
      approvedAt: row.approvedAt || '',
      created: row.created || '',
      syncStatus: row.syncStatus || '',
      syncedAt: row.syncedAt || ''
    };
  }

  // --- loading -----------------------------------------------------------
  async function loadAll() {
    try {
      var data = await apiLoad();
      state.schedule = (data.schedule || []).map(normalizeScheduleRow);
      state.approvals = data.approvals || [];
      // Repair any phone Sheets mangled (lost leading zero) — mirrors the
      // server's read-side recovery so the UI is correct even before redeploy.
      state.patients = (data.patients || []).map(function (p) {
        if (p && p.phone != null) p.phone = Phone.recoverStored(p.phone);
        return p;
      });
      state.assignments = (data.assignments || []).map(function (a) {
        if (a && a.patientPhone != null) a.patientPhone = Phone.recoverStored(a.patientPhone);
        return a;
      });
      state.therapists = data.therapists || [];
      state.treatmentTypes = data.treatmentTypes || [];
      state.loaded = true;
    } catch (e) {
      toast('שגיאה בטעינת הנתונים: ' + e.message, true);
      throw e;
    }
    // Cross-app reads are best-effort and independent; never block the app.
    await Promise.all([loadDebtRoster(), loadPlans()]);
    recomputeAlerts();
    render();
  }
  async function loadDebtRoster() {
    try {
      var d = await apiDebtStatus();
      state.debtRoster = Array.isArray(d.clients) ? d.clients : [];
      state.debtRosterOk = true;
    } catch (e) {
      console.warn('[ezone-therapists] debt status unavailable:', e.message);
      state.debtRoster = []; state.debtRosterOk = false;
    }
  }
  async function loadPlans() {
    try {
      var d = await apiTreatmentPlans();
      state.plans = Array.isArray(d.clients) ? d.clients : (Array.isArray(d.plans) ? d.plans : []);
      state.plansOk = true;
    } catch (e) {
      console.warn('[ezone-therapists] treatment plans unavailable:', e.message);
      state.plans = []; state.plansOk = false;
    }
  }

  // Re-check live debt for upcoming, unmarked scheduled rows: surface patients
  // who fell into debt AFTER booking. Pure logic in debt-alert.js.
  function recomputeAlerts() {
    state.alerts = DebtAlert.evaluateAlerts({
      rows: state.schedule,
      roster: state.debtRoster,
      rosterOk: state.debtRosterOk,
      today: today()
    });
  }
  function alertFor(id) {
    for (var i = 0; i < state.alerts.length; i++) if (state.alerts[i].id === id) return state.alerts[i];
    return null;
  }

  // Always re-check debt live just before scheduling.
  async function refreshDebtRoster() {
    await loadDebtRoster();
    return { roster: state.debtRoster, rosterOk: state.debtRosterOk };
  }

  // --- derived rosters ---------------------------------------------------
  // Active outpatients come from the outpatient sibling roster (treatment plans
  // preferred, debt roster as a fallback/union), keyed by normalized phone, then
  // LEFT-JOINED with this app's local intake record. The dashboard's plan view
  // prefers Vered's locally-set main plan and falls back to the roster's.
  // Build EVERY patient (active + stopped), each tagged with a `stopped` flag.
  // `activePatients` / `stoppedPatients` are thin filters over this so the heavy
  // cross-app join runs once per call site. A patient is stopped when discharged
  // in outpatient (plan status 'סיים טיפול') OR locally flagged (StopFlow).
  // The merge itself lives in the framework-free, unit-tested Roster module.
  function buildPatientRoster() {
    return Roster.build({
      plans: state.plans,
      debtRoster: state.debtRoster,
      patients: state.patients,
      assignments: state.assignments
    });
  }
  // Active = not stopped (the default working list everywhere). Stopped = the
  // stop-requested / discharged list (history kept, off the active list). Both
  // partition one roster via the shared StopFlow.splitStopped.
  function activePatients() { return StopFlow.splitStopped(buildPatientRoster()).active; }
  function stoppedPatients() { return StopFlow.splitStopped(buildPatientRoster()).stopped; }

  // The coming week's recurring occurrences for the picked therapist (virtual —
  // not persisted until reported). Skips stopped patients and any occurrence whose
  // deterministic id is already a real Schedule row (idempotent re-view).
  function buildOccurrences() {
    if (!hasTherapist()) return [];
    var roster = buildPatientRoster();
    var nameByKey = {}, stoppedByKey = {};
    roster.forEach(function (p) {
      nameByKey[p.key] = { name: p.name };
      if (p.stopped) stoppedByKey[p.key] = true;
    });
    var existingIds = {};
    (state.schedule || []).forEach(function (r) { if (r && r.id) existingIds[r.id] = true; });
    return Recurring.generateOccurrences({
      assignments: state.assignments || [],
      therapist: state.therapist,
      today: today(),
      horizonDays: 7,
      patientsByPhone: nameByKey,
      stoppedPhones: stoppedByKey,
      existingScheduleIds: existingIds
    });
  }
  // Short human label for a patient's assignments (multiple parallel plans).
  function assignmentSummary(p, withTherapist) {
    if (!p.assignments.length) {
      // Fall back to the outpatient roster's plan for display only.
      return p.serviceType ? svc(p.serviceType) + (p.rosterSessions ? ' · ' + p.rosterSessions + '×' : '') : '';
    }
    return p.assignments.map(function (a) {
      var bits = [svc(a.treatmentType) || '—'];
      if (a.frequencyPerWeek) bits.push(a.frequencyPerWeek + '× בשבוע');
      if (withTherapist && a.therapist) bits.unshift(a.therapist);
      return bits.join(' · ');
    }).join(' | ');
  }
  function patientByPhone(phone) {
    var key = normPhone(phone);
    return activePatients().filter(function (p) { return p.key === key; })[0] || null;
  }

  // --- render ------------------------------------------------------------
  function render() {
    syncDropdowns();
    renderDashboard();
    renderAssign();
    renderSchedule();
    renderMine();
  }

  function pendingSyncCount() {
    return state.schedule.filter(function (r) { return String(r.syncStatus || '') === 'pending'; }).length;
  }
  function syncBadge(r) {
    if (!r.attendance) return '';
    if (String(r.syncStatus) === 'pending') return ' <span class="chip chip-unpaid">ממתין לסנכרון</span>';
    if (String(r.syncStatus) === 'synced') return ' <span class="chip chip-paid">סונכרן</span>';
    return '';
  }

  function matchName(name, q) {
    if (!q) return true;
    return String(name || '').toLowerCase().indexOf(q.toLowerCase()) !== -1;
  }

  function debtChip(status, owed) {
    if (status === 'clear') return '<span class="chip chip-paid">ללא חוב</span>';
    if (status === 'debt') return '<span class="chip chip-unpaid">חוב ' + money(owed) + '</span>';
    return '';
  }

  function patientUpcomingAlert(phone) {
    var key = normPhone(phone);
    for (var i = 0; i < state.alerts.length; i++) {
      if (normPhone(state.alerts[i].patientPhone) === key) return state.alerts[i];
    }
    return null;
  }

  function patientCard(p) {
    var badges = '';
    if (p.stillAdmitted) badges += ' <span class="chip chip-partial">עדיין מאושפז/ת' + (p.admittedHouse ? ' · ' + escapeHtml(houseLabel(p.admittedHouse)) : '') + '</span>';
    var parts = [];
    parts.push('<div class="p-name">' + escapeHtml(p.name) + badges + '</div>');
    parts.push('<div><span class="p-label">טלפון</span><span class="p-val">' + escapeHtml(p.phone) + '</span></div>');
    var thers = p.therapists.length ? escapeHtml(p.therapists.join(', ')) : '<em class="assign-pending">טרם שובץ</em>';
    parts.push('<div><span class="p-label">מטפל/ת אחראי/ת</span><span class="p-val">' + thers + '</span></div>');
    var plan = assignmentSummary(p, false);
    parts.push('<div class="wide"><span class="p-label">תוכנית טיפול</span><span class="p-val">' + (plan ? escapeHtml(plan) : '—') + '</span></div>');
    if (p.origin) parts.push('<div><span class="p-label">מקור הגעה</span><span class="p-val">' + escapeHtml(p.origin) + '</span></div>');
    parts.push('<div>' + debtChip(p.debtStatus, p.amountOwed) + '</div>');
    var al = patientUpcomingAlert(p.phone);
    if (al) parts.push('<div class="wide alert-row">⚠️ נכנס/ה לחוב לאחר קביעת הטיפול (' + money(al.amountOwed) + ') — יש לבדוק טיפול עתידי</div>');
    // Dashboard is VIEW-ONLY for everyone — no edit/schedule actions here.
    return '<div class="billing-row">' + parts.join('') + '</div>';
  }

  function renderDashboard() {
    var list = activePatients();
    var assigned = list.filter(function (p) { return p.therapists.length; }).length;
    $('#kpiPatients').textContent = list.length;
    $('#kpiAssigned').textContent = assigned;
    $('#kpiAlerts').textContent = state.alerts.length;

    var notice = $('#dashboardNotice');
    if (!state.plansOk && !state.debtRosterOk) {
      notice.hidden = false;
      notice.textContent = 'רשימת המטופלים אינה זמינה כרגע (תלוי בנקודות הקצה של מטופלי החוץ).';
    } else { notice.hidden = true; }

    renderAlertBanner($('#alertBanner'));

    var rows = list
      .filter(function (p) { return matchName(p.name, state.dashboardSearch); })
      .sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); })
      .map(function (p) { return patientCard(p); });
    $('#patientsList').innerHTML = rows.length ? rows.join('') : '<div class="billing-empty">אין מטופלים פעילים</div>';

    // Stopped / discharged — read-only history (matches the same search box).
    var stoppedList = $('#stoppedList');
    if (stoppedList) {
      var stopped = stoppedPatients()
        .filter(function (p) { return matchName(p.name, state.dashboardSearch); })
        .sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); });
      var sec = $('#stoppedSection');
      if (sec) sec.hidden = !stopped.length;
      stoppedList.innerHTML = stopped.length ? stopped.map(stoppedCard).join('') : '';
    }
  }

  // A stopped/discharged patient — read-only line: name, why it's stopped
  // (discharged in outpatient vs a stop request pending Vered), and the local
  // who/when/note when we have it.
  function stoppedCard(p) {
    var reason = StopFlow.isStoppedStatus(p.planStatus)
      ? 'סיים טיפול (מטופלי חוץ)'
      : 'בקשת הפסקה ממתינה לאישור ורד';
    var meta = [];
    if (p.stoppedBy) meta.push('ע״י ' + p.stoppedBy);
    if (p.stoppedAt) meta.push(displayDate(p.stoppedAt));
    if (p.stopNote) meta.push(p.stopNote);
    // Only a LOCAL pending stop request is reversible here (a real outpatient
    // discharge is owned by outpatient). Delete is always offered on this list —
    // the cleanup surface — guarded by a naming confirm in the handler.
    var actions = '';
    if (StopFlow.canRestore(p)) {
      actions += '<button class="btn btn-primary btn-sm" data-restore-patient="' + escapeHtml(p.phone) + '">החזר לפעיל</button>';
    }
    actions += '<button class="btn btn-ghost btn-sm btn-danger" data-delete-patient="' + escapeHtml(p.phone) + '">מחק מטופל/ת</button>';
    return '<div class="assign-row stopped-row">' +
      '<span class="assign-name">' + escapeHtml(p.name) + '</span>' +
      '<span class="assign-type">' + escapeHtml(reason) + '</span>' +
      '<span class="assign-ther">' + escapeHtml(meta.join(' · ')) + '</span>' +
      '<span class="assign-actions">' + actions + '</span>' +
      '</div>';
  }

  function renderAlertBanner(el) {
    if (!el) return;
    if (!state.alerts.length) { el.hidden = true; el.innerHTML = ''; return; }
    var names = state.alerts.map(function (a) { return escapeHtml(a.patientName) + ' (' + money(a.amountOwed) + ')'; });
    el.hidden = false;
    el.innerHTML = '⚠️ ' + state.alerts.length + ' מטופלים נכנסו לחוב לאחר קביעת טיפול: ' + names.join(', ') +
      '. יש לבדוק את הטיפולים הקרובים בלשונית «שיבוץ מטפלים».';
    el.style.margin = '6px 0';
  }

  // Schedule rows grouped by session so a group treatment shows as one card.
  function sessionGroups() {
    var groups = {};
    var order = [];
    state.schedule.forEach(function (r) {
      var key = r.sessionId || r.id;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    return order.map(function (k) { return groups[k]; });
  }

  function attendanceChip(r) {
    if (r.attendance === 'occurred') return '<span class="chip chip-paid">התקיים</span>';
    if (r.attendance === 'missed') return '<span class="chip chip-unpaid">לא התקיים</span>';
    return '<span class="chip">טרם סומן</span>';
  }
  // iteration 18 step 2 — the 3-state session outcome chip (storage-only).
  function outcomeChip(r) {
    if (r.outcome === 'happened') return '<span class="chip chip-paid">התקיים</span>';
    if (r.outcome === 'therapist_cancelled') return '<span class="chip chip-partial">המטפל ביטל / לא הגיע</span>';
    if (r.outcome === 'patient_no_show') return '<span class="chip chip-unpaid">המטופל לא הגיע</span>';
    return '<span class="chip">טרם סומן</span>';
  }
  function gateChip(r) {
    if (r.gateStatus === 'approved') return '<span class="chip chip-partial">אושר למרות חוב (' + money(r.amountOwed) + ')</span>';
    if (r.gateStatus === 'flagged') return '<span class="chip chip-unpaid">לבירור</span>';
    if (r.gateStatus === 'clear') return '<span class="chip chip-paid">ללא חוב</span>';
    return '';
  }

  // Read-only line for Vered's oversight list (marking is the therapist's job,
  // done in «המטופלים שלי»).
  function patientLine(r) {
    var al = alertFor(r.id);
    return '<div class="sess-patient">' +
      '<span class="sess-pname">' + escapeHtml(r.patientName) + '</span> ' +
      gateChip(r) + ' ' + outcomeChip(r) + syncBadge(r) +
      (al ? '<div class="alert-row">⚠️ נכנס/ה לחוב לאחר קביעת הטיפול (' + money(al.amountOwed) + ')</div>' : '') +
      '</div>';
  }

  function sessionCard(rows) {
    var head = rows[0];
    var isGroup = rows.length > 1;
    var parts = [];
    parts.push('<div class="sess-head">' +
      '<span class="sess-date">' + escapeHtml(displayDateTime(head.scheduledDate, head.time)) + '</span>' +
      '<span class="chip">' + escapeHtml(svc(head.treatmentType)) + (isGroup ? ' · ' + rows.length + ' מטופלים' : '') + '</span>' +
      '<span class="chip">' + escapeHtml(locationLabel(head.location)) + '</span>' +
      '<span class="sess-therapist">' + escapeHtml(head.therapist) + '</span>' +
      '</div>');
    parts.push('<div class="sess-patients">' + rows.map(patientLine).join('') + '</div>');
    return '<div class="billing-row">' + parts.join('') + '</div>';
  }

  function renderSchedule() {
    var all = state.schedule;
    $('#kpiScheduled').textContent = all.length;
    var t = today();
    var upcoming = all.filter(function (r) {
      return (r.attendance === '') && fmtDate(r.scheduledDate) >= t;
    }).length;
    $('#kpiUpcoming').textContent = upcoming;
    $('#kpiScheduleAlerts').textContent = state.alerts.length;

    // Filter treatments by therapist AND by patient name.
    var groups = sessionGroups().filter(function (rows) {
      var byTher = !state.workflowTherapist || rows[0].therapist === state.workflowTherapist;
      var byName = rows.some(function (r) { return matchName(r.patientName, state.workflowSearch); });
      return byTher && byName;
    });
    groups.sort(function (a, b) { return String(b[0].scheduledDate || '').localeCompare(String(a[0].scheduledDate || '')); });
    var cards = groups.map(sessionCard);
    $('#scheduleList').innerHTML = cards.length ? cards.join('') : '<div class="billing-empty">אין טיפולים שנקבעו</div>';
  }

  // Compact patient list for the שיבוץ tab — ensures a newly registered patient
  // (local intake) is immediately available for assignment/scheduling here, not
  // only on the dashboard. Filterable by therapist (assigned) AND patient name.
  function renderAssign() {
    var list = activePatients().filter(function (p) {
      // Filter by therapist (matches ANY of the patient's assigned therapists) AND name.
      var byTher = !state.workflowTherapist || p.therapists.indexOf(state.workflowTherapist) !== -1;
      return byTher && matchName(p.name, state.workflowSearch);
    }).sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); });
    var rows = list.map(function (p) {
      var unassigned = !p.therapists.length;
      var thers = unassigned ? '<em class="assign-pending">טרם שובץ</em>' : escapeHtml(p.therapists.join(', '));
      // Unassigned patients get a prominent «שבץ מטפל» call-to-action so Yarden can
      // assign right here; already-assigned patients get the quieter «עריכה».
      var assignBtn = unassigned
        ? '<button class="btn btn-primary btn-sm" data-assignments-patient="' + escapeHtml(p.phone) + '">שבץ מטפל</button>'
        : '<button class="btn btn-primary btn-sm" data-assignments-patient="' + escapeHtml(p.phone) + '">עריכה</button>';
      return '<div class="assign-row' + (unassigned ? ' assign-row-pending' : '') + '">' +
        '<span class="assign-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="assign-ther"><span class="assign-ther-label">מטפל</span>' + thers + '</span>' +
        '<span class="assign-type">' + (assignmentSummary(p, false) ? escapeHtml(assignmentSummary(p, false)) : '—') + '</span>' +
        // Vered's actions: patient details + therapist/plan assignment.
        // Scheduling is the THERAPIST's action — it lives in «המטופלים שלי».
        '<span class="assign-actions">' +
          '<button class="btn btn-ghost btn-sm" data-edit-patient="' + escapeHtml(p.phone) + '">פרטים</button>' +
          assignBtn +
          '<button class="btn btn-ghost btn-sm btn-danger" data-stop-patient="' + escapeHtml(p.phone) + '">הפסקת טיפול</button>' +
        '</span>' +
        '</div>';
    });
    $('#assignList').innerHTML = rows.length ? rows.join('') : '<div class="billing-empty">אין מטופלים</div>';
  }

  // --- my treatments (tab 3) — friendly per-therapist session-outcome view --
  function mineRow(r) {
    // A VIRTUAL recurring occurrence has no sheet row yet → marking it materializes
    // the booking first; edit/cancel apply only once it's a real booking.
    // iteration 18 step 2 — a 3-state outcome picker (storage-only) replaces the
    // old happened/didn't pair. Buttons are generated from Outcome.VALUES so the
    // UI can never drift from the allowed set; the chosen one is highlighted.
    var outcomeBtns = Outcome.VALUES.map(function (v) {
      var on = r.outcome === v;
      return '<button class="btn btn-ghost btn-sm outcome-btn outcome-' + v + (on ? ' is-active' : '') +
        '" data-mine-outcome="' + v + '" data-id="' + escapeHtml(r.id) + '" aria-pressed="' + on + '">' +
        escapeHtml(Outcome.labelFor(v)) + '</button>';
    }).join('');
    var attBtns = '<span class="att-btns outcome-picker" role="group" aria-label="תוצאת הטיפול">' +
      outcomeBtns +
      (r.recurring ? '' :
        '<button class="btn btn-ghost btn-sm" data-edit-booking="' + escapeHtml(r.id) + '">עריכה</button>' +
        // Cancel only while the booking hasn't been reported (keeps outpatient pay consistent).
        (Scheduling.canCancelBooking(r) ? '<button class="btn btn-ghost btn-sm btn-danger" data-cancel-booking="' + escapeHtml(r.id) + '">ביטול טיפול</button>' : '')) +
      '</span>';
    return '<div class="billing-row mine-row">' +
      '<div class="p-name">' + escapeHtml(r.patientName) + (r.recurring ? ' <span class="recurring-tag">קבוע</span>' : '') + '</div>' +
      '<div><span class="p-label">תאריך</span><span class="p-val">' + escapeHtml(displayDateTime(r.scheduledDate, r.time)) + '</span></div>' +
      '<div><span class="p-label">טיפול</span><span class="p-val">' + escapeHtml(svc(r.treatmentType)) + '</span></div>' +
      '<div><span class="p-label">מיקום</span><span class="p-val">' + escapeHtml(locationLabel(r.location)) + '</span></div>' +
      '<div>' + outcomeChip(r) + syncBadge(r) + '</div>' +
      '<div class="row-actions">' + attBtns + '</div>' +
      '</div>';
  }

  // The therapist's own assigned patients (with a «קבע טיפול» action each).
  function myPatientsRow(p) {
    return '<div class="assign-row">' +
      '<span class="assign-name">' + escapeHtml(p.name) + '</span>' +
      '<span class="assign-type">' + (assignmentSummary(p, false) ? escapeHtml(assignmentSummary(p, false)) : '—') + '</span>' +
      '<span class="assign-actions">' +
        '<button class="btn btn-primary btn-sm" data-schedule-patient="' + escapeHtml(p.phone) + '">+ קביעת טיפול</button>' +
        '<button class="btn btn-ghost btn-sm btn-danger" data-stop-patient="' + escapeHtml(p.phone) + '">הפסקת טיפול</button>' +
      '</span>' +
      '</div>';
  }

  function renderMine() {
    var panels = ['#myPatientsPanel', '#mineScheduledPanel', '#mineUpcomingPanel', '#minePerformedPanel', '#mineNotPerformedPanel'];

    // No name picked yet → prompt, hide everything else.
    if (!hasTherapist()) {
      $('#mineEmpty').hidden = false;
      $('#syncBanner').hidden = true;
      panels.forEach(function (s) { $(s).hidden = true; });
      return;
    }
    $('#mineEmpty').hidden = true;
    $('#myPatientsPanel').hidden = false;

    // My assigned patients (I am one of their assigned therapists).
    var myPatients = activePatients().filter(function (p) {
      return p.therapists.indexOf(state.therapist) !== -1 && matchName(p.name, state.mineSearch);
    }).sort(function (a, b) { return String(a.name).localeCompare(b.name, 'he'); });
    var mpList = $('#myPatientsList');
    if (mpList) mpList.innerHTML = myPatients.length ? myPatients.map(myPatientsRow).join('')
      : '<div class="billing-empty">אין מטופלים משויכים אליך עדיין.</div>';

    var pending = pendingSyncCount();
    var banner = $('#syncBanner');
    if (pending > 0) {
      banner.hidden = false;
      banner.innerHTML = '⚠️ ' + pending + ' סימוני טיפול ממתינים לסנכרון למערכת התשלומים. ' +
        '<button id="syncNowBtn" class="btn btn-ghost btn-sm">סנכרן עכשיו</button>';
    } else { banner.hidden = true; banner.innerHTML = ''; }

    // My treatments = treatments I perform. «קרובים» is the COMING WEEK (next 7
    // days); everything else unmarked falls into «שנקבעו».
    var mine = state.schedule.filter(function (r) {
      return r.therapist === state.therapist && matchName(r.patientName, state.mineSearch);
    });
    // Plus the coming week's RECURRING occurrences (virtual until reported). They
    // bucket as normal upcoming rows; an occurrence already materialized as a real
    // Schedule row is dropped by generateOccurrences (idempotent by id).
    state.occurrences = buildOccurrences();
    var occ = state.occurrences.filter(function (o) { return matchName(o.patientName, state.mineSearch); });
    mine = mine.concat(occ);
    var byDate = function (a, b) { return String(a.scheduledDate).localeCompare(String(b.scheduledDate)); };
    var b = Scheduling.bucketMine(mine, today(), daysFromToday(7));

    function fill(panelSel, listSel, rows) {
      $(panelSel).hidden = rows.length === 0;
      $(listSel).innerHTML = rows.sort(byDate).map(mineRow).join('');
    }
    fill('#mineScheduledPanel', '#mineScheduled', b.scheduled);
    fill('#mineUpcomingPanel', '#mineUpcoming', b.upcoming);
    fill('#minePerformedPanel', '#minePerformed', b.performed);
    fill('#mineNotPerformedPanel', '#mineNotPerformed', b.notPerformed);
  }

  function syncNow() {
    toast('מסנכרן…');
    apiSyncPending()
      .then(function () { return loadAll(); })
      .then(function () {
        var left = pendingSyncCount();
        toast(left ? (left + ' עדיין ממתינים לסנכרון') : 'סונכרן');
      })
      .catch(function (err) { toast('שגיאה בסנכרון: ' + err.message, true); });
  }

  // --- dropdown / datalist sync -----------------------------------------
  function activeTherapistNames() { return Scheduling.activeNames(state.therapists); }
  function activeTypeNames() { return Scheduling.activeNames(state.treatmentTypes); }

  function optionList(names, selected) {
    return ['<option value="">—</option>'].concat(names.map(function (n) {
      var sel = (n === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(n) + '"' + sel + '>' + escapeHtml(n) + '</option>';
    })).join('');
  }
  // Treatment-type options: value is the stored string, LABEL is relabeled so a
  // legacy 'מרכז יום' entry shows as 'ליווי יומי בקהילה' (and the seeded new
  // term shows directly). The 5 individual-billing types (ClinicalSync) are
  // nested under one 'פרטני' <optgroup> — DISPLAY ONLY: every option keeps its
  // own distinct value, so the saved treatmentType stays the specific clinical
  // name, never the group label. Every other active type stays inline.
  function typeOptionList(selected) {
    function opt(n) {
      var sel = (n === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(n) + '"' + sel + '>' + escapeHtml(svc(n)) + '</option>';
    }
    var names = activeTypeNames();
    var part = ClinicalSync.partitionTypes(names);
    var parts = ['<option value="">—</option>'];
    var groupPlaced = false;
    names.forEach(function (n) {
      if (ClinicalSync.isIndividualBillingType(n)) {
        // Emit the whole פרטני group once, at the position of its first member.
        if (!groupPlaced) {
          parts.push('<optgroup label="' + escapeHtml(ClinicalSync.GROUP_LABEL) + '">' +
            part.grouped.map(opt).join('') + '</optgroup>');
          groupPlaced = true;
        }
        return;
      }
      parts.push(opt(n));
    });
    return parts.join('');
  }
  // Resolve a stored/legacy plan type to a value that EXISTS in the type list,
  // mapping the relabeled term (מרכז יום → ליווי יומי בקהילה) when needed.
  function resolveTypeOption(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    var names = activeTypeNames();
    if (names.indexOf(v) !== -1) return v;
    var relabeled = svc(v);
    return (names.indexOf(relabeled) !== -1) ? relabeled : v;
  }
  function locationOptions(selected) {
    return ['<option value="">—</option>'].concat(LOCATIONS.map(function (l) {
      var sel = (l.id === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(l.id) + '"' + sel + '>' + escapeHtml(l.he) + '</option>';
    })).join('');
  }
  function houseOptions(selected) {
    return ['<option value="">—</option>'].concat(ORIGIN_HOUSES.map(function (h) {
      var sel = (h.id === selected) ? ' selected' : '';
      return '<option value="' + escapeHtml(h.id) + '"' + sel + '>' + escapeHtml(h.he) + '</option>';
    })).join('');
  }
  // 30-minute time slots 07:00–21:00 for the scheduling dropdowns.
  function timeOptions(selected) {
    return ['<option value="">—</option>'].concat(Scheduling.timeSlots('07:00', '21:00', 30).map(function (t) {
      var sel = (t === selected) ? ' selected' : '';
      return '<option value="' + t + '"' + sel + '>' + t + '</option>';
    })).join('');
  }

  function syncDropdowns() {
    var tNames = activeTherapistNames();
    var st = $('#scheduleTherapist'); if (st) st.innerHTML = optionList(tNames, state.therapist);
    var pt = $('#patientTherapist'); if (pt) pt.innerHTML = '<option value="">— לא שויך —</option>' +
      tNames.map(function (n) { return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; }).join('');
    var sty = $('#scheduleType'); if (sty) { var styv = sty.value; sty.innerHTML = typeOptionList(); sty.value = styv; }
    var pty = $('#patientType'); if (pty) { var ptyv = pty.value; pty.innerHTML = typeOptionList(); pty.value = ptyv; }
    var sl = $('#scheduleLocation'); if (sl) sl.innerHTML = locationOptions();
    var stime = $('#scheduleTime'); if (stime) { var stv = stime.value; stime.innerHTML = timeOptions(); stime.value = stv; }
    var ah = $('#admittedHouse'); if (ah) ah.innerHTML = houseOptions();
    // Identity-screen name picker.
    // Tab-3 name picker — preserve the current pick across re-renders.
    var mt = $('#mineTherapist'); if (mt) { mt.innerHTML = optionList(tNames, state.therapist); mt.value = state.therapist || ''; }
    var wf = $('#workflowTherapistFilter'); if (wf) wf.innerHTML = '<option value="">כל המטפלים</option>' +
      tNames.map(function (n) { var s = (n === state.workflowTherapist) ? ' selected' : ''; return '<option value="' + escapeHtml(n) + '"' + s + '>' + escapeHtml(n) + '</option>'; }).join('');

    var roster = activePatients();
    var names = roster.map(function (p) { return p.name; }).filter(Boolean);
    var rn = $('#rosterNames');
    if (rn) rn.innerHTML = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    $$('.patient-name-dl').forEach(function (dl) {
      dl.innerHTML = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('');
    });
    var os = $('#originSuggestions');
    if (os) os.innerHTML = ORIGIN_HOUSES.map(function (h) { return '<option value="' + escapeHtml(h.he) + '"></option>'; }).join('');
  }

  // --- schedule modal ----------------------------------------------------
  function patientRowHtml(idx, prefill) {
    prefill = prefill || {};
    return '<div class="patient-row" data-idx="' + idx + '">' +
      '<input class="patient-name" name="pname" list="pdl' + idx + '" placeholder="שם מטופל/ת" autocomplete="off" value="' + escapeHtml(prefill.name || '') + '" />' +
      '<datalist id="pdl' + idx + '" class="patient-name-dl"></datalist>' +
      '<input class="patient-phone" name="pphone" inputmode="tel" placeholder="0501234567" value="' + escapeHtml(prefill.phone || '') + '" />' +
      '<button type="button" class="btn btn-ghost btn-sm remove-patient" title="הסר">✕</button>' +
      '</div>';
  }
  var patientRowSeq = 0;
  function addPatientRow(prefill) {
    var wrap = $('#patientRows');
    var div = document.createElement('div');
    div.innerHTML = patientRowHtml(++patientRowSeq, prefill);
    var node = div.firstChild;
    wrap.appendChild(node);
    syncDropdowns();
    return node;
  }
  function patientRowsData() {
    return $$('#patientRows .patient-row').map(function (row) {
      return {
        name: (row.querySelector('.patient-name').value || '').trim(),
        phone: (row.querySelector('.patient-phone').value || '').trim()
      };
    }).filter(function (p) { return p.name || p.phone; });
  }
  function updateGroupUi() {
    var type = $('#scheduleType').value;
    var isGroup = Scheduling.isGroupType(type, state.treatmentTypes);
    $('#addPatientRowBtn').hidden = !isGroup;
    $('#patientsSectionTitle').textContent = isGroup ? 'מטופלים בקבוצה' : 'מטופל/ת';
    $$('#patientRows .remove-patient').forEach(function (b) { b.style.visibility = isGroup ? 'visible' : 'hidden'; });
  }

  function openScheduleModal(prefillPatient) {
    if (!ensureTherapist()) return;
    var form = $('#scheduleForm');
    form.reset();
    resetGateResults();
    form.querySelector('[name="scheduledDate"]').value = today();
    $('#patientRows').innerHTML = '';
    patientRowSeq = 0;
    addPatientRow(prefillPatient || {});
    // syncDropdowns ran inside addPatientRow; now apply defaults. The therapist
    // schedules as THEMSELVES — lock the therapist field to their identity.
    var th = $('#scheduleTherapist');
    th.value = state.therapist || (prefillPatient && prefillPatient.therapist) || '';
    th.disabled = true;
    if (prefillPatient && prefillPatient.treatmentType) $('#scheduleType').value = resolveTypeOption(prefillPatient.treatmentType);
    updateGroupUi();
    $('#scheduleModal').hidden = false;
  }
  function closeScheduleModal() { $('#scheduleModal').hidden = true; resetGateResults(); }
  function resetGateResults() {
    pendingPatients = null;
    var g = $('#gateResults');
    g.hidden = true; g.innerHTML = '';
    $('#scheduleSubmit').textContent = 'בדוק ושמור';
  }

  function readSession() {
    var fd = new FormData($('#scheduleForm'));
    return {
      // A therapist always schedules as themselves (the select is locked).
      therapist: state.therapist || (fd.get('therapist') || '').trim(),
      treatmentType: (fd.get('treatmentType') || '').trim(),
      location: (fd.get('location') || '').trim(),
      scheduledDate: fd.get('scheduledDate') || '',
      time: fd.get('time') || ''
    };
  }

  // Monthly package-cap status for ONE patient + the session's treatment type,
  // for the month of the booking. Uses the existing plan (state.assignments) and
  // bookings (state.schedule), both keyed by normalized phone. A therapist-
  // cancelled session does NOT consume quota (mirrors the credits rule), so it is
  // excluded from usage. Returns the Quota.checkAdd shape, or null when we lack
  // the data to judge (no plan rows for this patient → don't warn spuriously).
  function quotaStatusFor(phone, treatmentType, scheduledDate) {
    if (!window.Quota) return null;
    var key = normPhone(phone);
    var assignments = (state.assignments || []).filter(function (a) {
      return normPhone(a.patientPhone) === key;
    });
    // No plan at all for this patient → we can't define a cap; skip the warning.
    if (!assignments.length) return null;
    var bookings = (state.schedule || []).filter(function (r) {
      return normPhone(r.patientPhone) === key;
    });
    return Quota.checkAdd({
      assignments: assignments,
      bookings: bookings,
      month: Quota.monthKey(scheduledDate),
      treatmentType: treatmentType,
      countsBooking: function (b) { return b.outcome !== 'therapist_cancelled'; }
    });
  }

  function renderGateResults() {
    var g = $('#gateResults');
    var session = readSession();
    var rowsHtml = pendingPatients.map(function (pp, i) {
      var d = pp.gate.decision;
      var status, body = '';
      if (d === 'allow') { status = '<span class="chip chip-paid">ללא חוב</span>'; }
      else if (d === 'block') {
        status = '<span class="chip chip-unpaid">חוב פתוח ' + money(pp.gate.amountOwed) + '</span>';
        body = '<div class="gate-approval">' +
          '<select class="approver-sel" data-i="' + i + '"><option value="">— מאשר/ת —</option>' +
          '<option value="ron">רון</option><option value="sandra">סנדרה</option></select>' +
          '<input class="approver-note" data-i="' + i + '" placeholder="הערת אישור" />' +
          '</div>';
      } else {
        status = '<span class="chip chip-unpaid">לבירור</span>';
        body = '<div class="gate-flag">' + (FLAG_TEXT[pp.gate.reason] || 'דרוש בירור ידני.') + '</div>';
      }
      // Soft package-cap warning (does NOT block). If this booking would push the
      // patient past their monthly quota for this treatment type, warn Yarden;
      // she can still proceed — the over-cap session is flagged for Vered (step 3).
      var q = quotaStatusFor(pp.phone, session.treatmentType, session.scheduledDate);
      var capWarn = '';
      if (q && q.willExceed) {
        capWarn = '<div class="cap-warn">⚠️ מעבר לחבילה החודשית — ' +
          escapeHtml(svc(session.treatmentType)) + ': נוצלו ' + q.used + ' מתוך ' + q.quota +
          ' החודש. דרוש אישור ורד לטיפול נוסף; ניתן לשמור והבקשה תועבר לאישור.</div>';
      }
      return '<div class="gate-patient">' +
        '<div class="gate-pname">' + escapeHtml(pp.name) + ' <span class="muted">' + escapeHtml(pp.phone) + '</span> ' + status + '</div>' +
        capWarn + body + '</div>';
    }).join('');
    var anyBlock = pendingPatients.some(function (pp) { return pp.gate.decision === 'block'; });
    g.hidden = false;
    g.innerHTML = '<div class="form-section-title">בדיקת חוב למטופלים</div>' + rowsHtml;
    // A debtor needs approval; everything else (clear / flagged-for-review) just saves.
    $('#scheduleSubmit').textContent = anyBlock ? 'אשר ושמור' : 'שמור';
  }

  async function handleScheduleSubmit() {
    var sub = $('#scheduleSubmit');
    if (sub.disabled) return;
    var session = readSession();

    // Phase 2 — gate already ran, build rows from the resolved decisions.
    // (lookup_failed is treated as a flag → saved for review, NOT a retry
    // dead-end: when the debt endpoint is down, scheduling still completes.)
    if (pendingPatients) {
      return finalizeSchedule(session);
    }

    // Phase 1 — validate session + patients, then run the gate per patient.
    var sv = Scheduling.validateSession(session);
    if (!sv.ok) { toast(sv.error, true); return; }
    var rawPatients = patientRowsData();
    if (!rawPatients.length) { toast('יש להזין מטופל/ת אחד לפחות', true); return; }
    var isGroup = Scheduling.isGroupType(session.treatmentType, state.treatmentTypes);
    if (!isGroup && rawPatients.length > 1) { toast('סוג טיפול זה מאפשר מטופל/ת אחד בלבד', true); return; }

    var patients = [];
    for (var i = 0; i < rawPatients.length; i++) {
      var rp = rawPatients[i];
      if (!rp.name) { toast('חסר שם מטופל/ת', true); return; }
      var pv = Phone.toCanonical(rp.phone);    // normalize then validate; store normalized
      if (!pv.ok) { toast(rp.name + ': ' + pv.error, true); return; }
      patients.push({ name: rp.name, phone: pv.value });
    }

    sub.disabled = true;
    sub.textContent = 'בודק חוב…';
    var roster;
    try { roster = await refreshDebtRoster(); }
    catch (e) { roster = { roster: [], rosterOk: false }; }
    pendingPatients = Scheduling.evaluateGroup({ patients: patients, roster: roster.roster, rosterOk: roster.rosterOk });
    sub.disabled = false;
    renderGateResults();
  }

  function finalizeSchedule(session) {
    var sub = $('#scheduleSubmit');
    var patients = [];
    for (var i = 0; i < pendingPatients.length; i++) {
      var pp = pendingPatients[i];
      var d = pp.gate.decision;
      if (d === 'allow') {
        patients.push({ name: pp.name, phone: pp.phone, gateStatus: Scheduling.gateStatusForDecision(d) });
      } else if (d === 'flag') {
        // Any flag — including lookup_failed (debt endpoint down) — saves as
        // 'flagged' for manual resolution. Never silently 'clear', never a dead-end.
        patients.push({ name: pp.name, phone: pp.phone, gateStatus: Scheduling.gateStatusForDecision(d), gateReason: pp.gate.reason });
      } else if (d === 'block') {
        var sel = $('.approver-sel[data-i="' + i + '"]');
        var note = $('.approver-note[data-i="' + i + '"]');
        var stamp = Approval.buildApproval({
          approver: sel ? sel.value : '',
          patientName: pp.name, patientPhone: pp.phone,
          therapist: session.therapist,
          note: note ? note.value : '',
          amountOwed: pp.gate.amountOwed
        });
        if (!stamp.ok) { toast(pp.name + ': ' + stamp.error, true); return; }
        patients.push({
          name: pp.name, phone: pp.phone, gateStatus: 'approved',
          amountOwed: stamp.approval.amountOwed,
          approverId: stamp.approval.approverId, approverName: stamp.approval.approverName,
          approvalNote: stamp.approval.note, approvedAt: stamp.approval.approvedAt
        });
      }
    }
    if (!patients.length) { toast('אין מטופלים לשמירה', true); return; }

    var rows = Scheduling.buildSessionRows(session, patients, {
      sessionId: 's_' + uid(), idFn: function () { return uid(); }, now: today()
    });
    var nameById = {};
    rows.forEach(function (r) { nameById[r.id] = r.patientName; });
    var anyFlagged = patients.some(function (p) { return p.gateStatus === 'flagged'; });
    sub.disabled = true;
    apiSaveSession(rows)
      .then(function (res) {
        var failed = (res.results || []).filter(function (r) { return !r.ok; });
        if (failed.length) {
          var who = failed.map(function (f) { return (nameById[f.id] || '') + ' (' + saveErrorText(f.error) + ')'; });
          toast('חלק מהמטופלים לא נקבעו: ' + who.join('; '), true);
        } else if (anyFlagged) {
          toast('נשמר לבירור — לא ניתן לאמת חוב כרגע');
        } else {
          toast('הטיפול נקבע');
        }
        return loadAll();
      })
      .then(function () { closeScheduleModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); sub.disabled = false; });
  }

  // Friendly Hebrew for the server-authoritative rejection codes (mirrors
  // treatment-guard.js). These fire when the live re-read disagrees with the
  // browser's gate — usually a patient who fell into debt since the check.
  var SAVE_ERROR_TEXT = {
    debt_verification_failed: 'נמצא חוב בבדיקה החוזרת — נדרש אישור',
    debt_verification_unavailable: 'בדיקת החוב אינה זמינה — לא ניתן לאשר',
    debt_verification_unconfigured: 'בדיקת החוב אינה מוגדרת בשרת',
    invalid_approver: 'מאשר/ת לא מורשה',
    invalid_gate_status: 'סטטוס שער לא תקין',
    invalid_phone: 'מספר טלפון לא תקין (נדרשות 10 ספרות, מתחיל ב-0)',
    debt_block: 'נמצא חוב בבדיקה החוזרת — נדרש אישור רון/סנדרה כדי לדווח ביצוע',
    // Stop-flag UNDO (restore / delete) — fail-closed reasons from resolveStopFlag.
    stop_flag_unconfigured: 'סנכרון בקשות ההפסקה אינו מוגדר בשרת — לא ניתן לבטל',
    resolve_failed: 'לא ניתן לבטל את בקשת ההפסקה אצל ורד — נסו שוב',
    resolve_rejected: 'בקשת ביטול ההפסקה נדחתה אצל ורד',
    resolve_unreachable: 'מטופלי חוץ אינם זמינים כרגע — נסו שוב',
    // Delete propagation — fail-closed reasons from deactivateClient. The local
    // record is NOT removed until the outpatient client is deactivated.
    deactivate_unconfigured: 'סנכרון מחיקת המטופל אינו מוגדר בשרת — לא ניתן למחוק',
    deactivate_failed: 'לא ניתן להשבית את המטופל/ת במטופלי חוץ — נסו שוב',
    deactivate_rejected: 'מחיקת המטופל/ת נדחתה אצל ורד',
    deactivate_unreachable: 'מטופלי חוץ אינם זמינים כרגע — נסו שוב'
  };
  function saveErrorText(code) { return SAVE_ERROR_TEXT[code] || code || 'נדחה'; }

  // --- post-treatment report --------------------------------------------
  // The report is the payment trigger (no mark = no pay) and drives the
  // outpatient write-back. happened → debt-gated (block a debtor unless Ron/
  // Sandra approve); didn't-happen → capture a reason. Local state is the
  // source of truth; syncStatus tells us whether the write-back reached outpatient.
  var reportCtx = null;

  // A reportable row by id — a real Schedule row, or a virtual recurring occurrence.
  function reportableById(id) {
    return (state.schedule || []).filter(function (r) { return r.id === id; })[0] ||
           (state.occurrences || []).filter(function (o) { return o.id === id; })[0] || null;
  }

  // Entry from a mark button. Re-clicking the same outcome clears it (no modal).
  function markAttendance(id, value) {
    if (!ensureTherapist()) return;
    var row = reportableById(id);
    if (!row) return;
    if (row.attendance === value) { commitReport(id, '', {}); return; }   // toggle off
    openReport(row, value);
  }

  function openReport(row, outcome) {
    reportCtx = { id: row.id, outcome: outcome, row: row, gate: null };
    $('#reportPatient').textContent = row.patientName + ' · ' + svc(row.treatmentType) + ' · ' + displayDateTime(row.scheduledDate, row.time);
    var body = $('#reportBody');
    var save = $('#reportSave');
    if (outcome === 'missed') {
      body.innerHTML = '<label class="wide">סיבה שלא בוצע<textarea id="reportReason" rows="2" placeholder="מדוע הטיפול לא בוצע"></textarea></label>';
      save.disabled = false; $('#reportModal').hidden = false; return;
    }
    // happened → live debt check (authoritative re-check also runs server-side).
    body.innerHTML = '<div class="muted">בודק חוב…</div>';
    save.disabled = true; $('#reportModal').hidden = false;
    refreshDebtRoster().then(function (roster) {
      var gate = DebtGate.evaluate({ phone: row.patientPhone, roster: roster.roster, rosterOk: roster.rosterOk });
      reportCtx.gate = gate;
      if (gate.decision === 'allow') {
        body.innerHTML = '<div class="report-ok">ללא חוב — ניתן לאשר ביצוע.</div>';
      } else if (gate.decision === 'block') {
        body.innerHTML = '<div class="card-banner card-banner-stop" style="margin:0 0 8px">⛔ חוב פתוח ' + money(gate.amountOwed) +
          ' — יש להפסיק טיפול. נדרש אישור רון/סנדרה כדי לדווח ביצוע.</div>' +
          '<div class="gate-approval"><select id="reportApprover"><option value="">— מאשר/ת —</option>' +
          '<option value="ron">רון</option><option value="sandra">סנדרה</option></select>' +
          '<input id="reportNote" placeholder="הערת אישור" /></div>';
      } else {
        body.innerHTML = '<div class="gate-flag">⚠️ ' + (FLAG_TEXT[gate.reason] || 'דרוש בירור ידני.') + ' יירשם לבירור.</div>';
      }
      save.disabled = false;
    }).catch(function () {
      reportCtx.gate = { decision: 'flag', reason: 'lookup_failed' };
      body.innerHTML = '<div class="gate-flag">⚠️ בדיקת חוב נכשלה — יירשם לבירור.</div>';
      save.disabled = false;
    });
  }

  function saveReport() {
    if (!reportCtx) return;
    var outcome = reportCtx.outcome;
    var extra = {};
    if (outcome === 'missed') {
      var reason = ($('#reportReason').value || '').trim();
      if (!reason) { toast('יש לציין סיבה שהטיפול לא בוצע', true); return; }
      extra.reason = reason;
    } else {
      var g = reportCtx.gate;
      if (g && g.decision === 'block') {
        var ap = $('#reportApprover'), note = $('#reportNote');
        var stamp = Approval.buildApproval({
          approver: ap ? ap.value : '', patientName: reportCtx.row.patientName,
          patientPhone: reportCtx.row.patientPhone, therapist: state.therapist,
          note: note ? note.value : '', amountOwed: g.amountOwed
        });
        if (!stamp.ok) { toast(stamp.error, true); return; }
        extra.approval = stamp.approval;
      } else if (g && g.decision === 'flag') {
        extra.flagged = true; extra.gateReason = g.reason;
      }
    }
    $('#reportSave').disabled = true;
    commitReport(reportCtx.id, outcome, extra);
  }
  function closeReportModal() { $('#reportModal').hidden = true; reportCtx = null; }

  function commitReport(id, attendance, extra) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) {
      // Reporting a VIRTUAL recurring occurrence: promote it to a real row in
      // local state and tell the backend to materialize it (idempotent by id).
      var occ = (state.occurrences || []).filter(function (o) { return o.id === id; })[0];
      if (!occ) return;
      row = Object.assign({}, occ);
      delete row.recurring;
      state.schedule.push(row);
      extra = extra || {};
      extra.occurrence = occ;
    }
    var prev = row.attendance;
    row.attendance = attendance;
    if (extra && extra.reason != null) row.reason = extra.reason;
    state.schedule.forEach(function (r) { if (r.sessionId === row.sessionId) r.syncStatus = 'pending'; });
    recomputeAlerts(); render();
    apiMarkAttendance(id, attendance, extra)
      .then(function (res) {
        var status = res && res.syncStatus;
        if (status) state.schedule.forEach(function (r) { if (r.sessionId === row.sessionId) r.syncStatus = status; });
        render();
        var msg = attendance === 'occurred' ? 'דווח: התקיים' : attendance === 'missed' ? 'דווח: לא התקיים' : 'הסימון בוטל';
        if (status === 'pending') msg += ' (ממתין לסנכרון)';
        toast(msg);
        closeReportModal();
      })
      .catch(function (err) {
        row.attendance = prev; recomputeAlerts(); render();
        toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true);
        var s = $('#reportSave'); if (s) s.disabled = false;
      });
  }

  // --- session outcome (iteration 18 step 2) ----------------------------
  // The therapist marks one of three outcomes (happened / therapist-cancelled /
  // patient-no-show). STORAGE-ONLY: it stamps the Schedule row and does NOTHING
  // else — no debt gate, no outpatient write-back (that is step 3). No modal:
  // one click records it (optimistic, with rollback on failure).
  function markOutcome(id, value) {
    if (!ensureTherapist()) return;
    if (!Outcome.isValid(value)) return;
    var src = reportableById(id);
    if (!src) return;

    // Promote a VIRTUAL recurring occurrence to a real local row (the backend
    // materializes its booking row from the occurrence payload, idempotent by id).
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    var occurrence = null;
    if (!row) {
      var occ = (state.occurrences || []).filter(function (o) { return o.id === id; })[0];
      if (!occ) return;
      occurrence = occ;
      row = Object.assign({}, occ);
      delete row.recurring;
      state.schedule.push(row);
    }

    var built = Outcome.buildOutcome(row, value);
    if (!built.ok) { toast('ערך לא חוקי', true); return; }
    var prev = row.outcome, prevAt = row.outcomeAt;
    row.outcome = value;
    row.outcomeAt = built.record.outcomeAt;
    render();
    apiSetSessionOutcome(id, value, { outcomeAt: built.record.outcomeAt, occurrence: occurrence })
      .then(function (res) {
        if (res && res.outcomeAt) row.outcomeAt = res.outcomeAt;
        render();
        // The outcome ALWAYS saved locally. Flag (never swallow) when the
        // outpatient pay-sync didn't land — the outcome stands either way.
        var w = outcomeSyncWarning(res);
        if (w) toast('נרשם: ' + Outcome.labelFor(value) + ' — אך ' + w, true);
        else toast('נרשם: ' + Outcome.labelFor(value));
      })
      .catch(function (err) {
        row.outcome = prev; row.outcomeAt = prevAt; render();
        toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true);
      });
  }

  // --- edit / cancel a booking (therapist, in «המטופלים שלי») -----------
  var bookingEditId = null;
  function openBookingEdit(id) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    bookingEditId = id;
    $('#bookingPatient').textContent = row.patientName + ' · ' + svc(row.treatmentType);
    $('#bookingTime').innerHTML = timeOptions(row.time);
    $('#bookingLocation').innerHTML = locationOptions(row.location);
    var form = $('#bookingForm');
    form.querySelector('[name="scheduledDate"]').value = fmtDate(row.scheduledDate) || today();
    $('#bookingTime').value = row.time || '';
    $('#bookingLocation').value = row.location || '';
    $('#bookingModal').hidden = false;
  }
  function closeBookingModal() { $('#bookingModal').hidden = true; bookingEditId = null; }
  function saveBooking() {
    if (!bookingEditId) return;
    var btn = $('#bookingSave'); if (btn.disabled) return;
    var fd = new FormData($('#bookingForm'));
    var fields = {
      scheduledDate: fd.get('scheduledDate') || '',
      time: fd.get('time') || '',
      location: (fd.get('location') || '').trim()
    };
    if (!fields.scheduledDate) { toast('יש לבחור תאריך', true); return; }
    btn.disabled = true;
    apiUpdateBooking(bookingEditId, fields)
      .then(function () { toast('הטיפול עודכן'); return loadAll(); })
      .then(function () { closeBookingModal(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { btn.disabled = false; });
  }
  function cancelBooking(id) {
    var row = state.schedule.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    if (!Scheduling.canCancelBooking(row)) {
      toast('כדי לבטל טיפול שכבר דווח — סמן/י תחילה «לא התקיים».', true); return;
    }
    if (!window.confirm('לבטל את הטיפול של ' + row.patientName + ' בתאריך ' + displayDate(row.scheduledDate) + '?')) return;
    apiRemoveSchedule(id)
      .then(function () { toast('הטיפול בוטל'); return loadAll(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); });
  }

  // Mark a patient as stopped: send a flagStop request to outpatient (pending
  // Vered's confirmation) and, on success, cancel their future bookings. Does NOT
  // discharge directly. Fail-closed server-side — if the flag can't be sent,
  // nothing changes and the error surfaces here.
  function markPatientStopped(phone) {
    var rec = patientByPhone(phone);
    if (!rec) { toast('מטופל/ת לא נמצא', true); return; }
    if (!window.confirm('לסמן הפסקת טיפול עבור ' + rec.name + '?\nתישלח בקשה לאישור ורד והטיפולים העתידיים שטרם דווחו יבוטלו.')) return;
    var note = window.prompt('הערה (לא חובה):', '');
    if (note === null) return;                       // prompt cancelled → abort
    apiMarkPatientStopped({ phone: rec.phone, name: rec.name, reportedBy: state.therapist || 'עורך', note: note || '' })
      .then(function () { toast('נשלחה בקשת הפסקה לאישור ורד'); return loadAll(); })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); });
  }

  // The display name for a stopped/orphaned patient — looked up by phone from the
  // stopped list (NOT patientByPhone, which only sees ACTIVE patients), falling
  // back to the phone itself so an orphaned flag is still actionable.
  function stoppedNameByPhone(phone) {
    var key = normPhone(phone);
    var hit = stoppedPatients().filter(function (p) { return p.key === key; })[0];
    return (hit && hit.name) || phone;
  }

  // Undo a pending stop request → patient returns to active. Resolves the
  // outpatient StopFlag first (fail-closed server-side), then clears the local
  // stop flag. Works by PHONE, so an orphaned flag (no active match) still clears.
  function restorePatient(phone) {
    var name = stoppedNameByPhone(phone);
    if (!window.confirm('להחזיר את ' + name + ' לרשימת הפעילים?\nבקשת ההפסקה תבוטל אצל ורד. הטיפולים שבוטלו לא ישוחזרו — יש לקבוע מחדש לפי הצורך.')) return;
    apiRestorePatient({ phone: phone, reportedBy: state.therapist || 'עורך' })
      .then(function () { toast('המטופל/ת הוחזר/ה לפעילים'); return loadAll(); })
      .catch(function (err) { toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true); });
  }

  // Delete a patient entirely (test cleanup): removes the local record and
  // resolves any outpatient StopFlag. Double-guarded (destructive). By PHONE, so
  // an orphaned flag with no matching patient can still be cleaned up.
  function removePatient(phone) {
    var name = stoppedNameByPhone(phone);
    if (!window.confirm('למחוק לצמיתות את ' + name + '?\nפעולה זו מסירה את רשומת המטופל/ת המקומית, מבטלת בקשת הפסקה ומשביתה את המטופל/ת במטופלי חוץ. אין לבטל.')) return;
    apiRemovePatient({ phone: phone, reportedBy: state.therapist || 'עורך' })
      .then(function () { toast('המטופל/ת נמחק/ה'); return loadAll(); })
      .catch(function (err) { toast('שגיאה: ' + (SAVE_ERROR_TEXT[err.message] || err.message), true); });
  }

  // --- patient intake / edit modal (identity + origin) ------------------
  // The therapist assignment(s) + plan(s) live in the Assignments modal; the
  // intake form captures identity + origin, plus ONE optional INITIAL assignment
  // for a brand-new patient (further ones are added/edited in «שיבוץ מטפלים»).
  function fillPatientForm(rec) {
    var form = $('#patientForm');
    form.reset();
    syncDropdowns();
    rec = rec || {};
    form.querySelector('[name="name"]').value = rec.name || '';
    form.querySelector('[name="phone"]').value = rec.phone || '';
    $('#patientTherapist').value = '';
    $('#patientType').value = '';
    form.querySelector('[name="frequencyPerWeek"]').value = '';
    form.querySelector('[name="origin"]').value = rec.origin || '';
    $('#stillAdmitted').checked = !!rec.stillAdmitted;
    $('#admittedHouse').value = rec.admittedHouse || '';
    $('#admittedDetails').hidden = !$('#stillAdmitted').checked;
  }
  // 'create' rejects a phone that already belongs to a patient; 'edit' upserts.
  var patientModalMode = 'create';
  function openNewPatient() {
    patientModalMode = 'create';
    $('#patientModalTitle').textContent = 'רישום מטופל חדש';
    fillPatientForm(null);
    $('#initialAssignmentSection').hidden = false;   // initial assignment only for new
    $('#patientForm [name="phone"]').readOnly = false;
    $('#patientModal').hidden = false;
  }
  function openPatientModal(phone) {
    var rec = patientByPhone(phone);
    patientModalMode = rec ? 'edit' : 'create';
    $('#patientModalTitle').textContent = 'עריכת מטופל/ת';
    fillPatientForm(rec || {});
    // Existing patient: edit identity + origin here; manage assignments in שיבוץ.
    $('#initialAssignmentSection').hidden = !!rec;
    $('#patientForm [name="phone"]').readOnly = !!rec;
    $('#patientModal').hidden = false;
  }
  function closePatientModal() { $('#patientModal').hidden = true; }

  function handlePatientSubmit() {
    var sub = $('#patientSubmit');
    if (sub.disabled) return;
    var fd = new FormData($('#patientForm'));
    var name = (fd.get('name') || '').trim();
    if (!name) { toast('חסר שם מטופל/ת', true); return; }
    var pv = Phone.toCanonical(fd.get('phone'));    // normalize then validate; store normalized
    if (!pv.ok) { toast(pv.error, true); return; }
    // On create, block a phone that already belongs to a patient (naming them).
    if (patientModalMode === 'create') {
      var dup = Phone.duplicateOf(pv.value, state.patients);
      if (dup) {
        toast('כבר קיים/ת מטופל/ת עם מספר הטלפון הזה: ' + (dup.name || pv.value), true);
        return;
      }
    }
    var stillAdmitted = !!fd.get('stillAdmitted');
    var patient = {
      phone: pv.value, name: name,
      origin: (fd.get('origin') || '').trim(),
      stillAdmitted: stillAdmitted,
      admittedHouse: stillAdmitted ? (fd.get('admittedHouse') || '').trim() : '',
      updatedBy: state.therapist || 'עורך'
    };
    // Optional initial assignment (new patients only — section is shown then).
    var initTher = (fd.get('assignedTherapist') || '').trim();
    var initType = (fd.get('mainTreatmentType') || '').trim();
    var initFreq = (fd.get('frequencyPerWeek') || '').trim();
    var wantInitial = !$('#initialAssignmentSection').hidden && (initTher || initType);

    sub.disabled = true;
    var initSyncWarning = null;
    apiSavePatient(patient, patientModalMode)
      .then(function () {
        if (!wantInitial) return;
        return apiSaveAssignment({
          id: uid(), patientPhone: pv.value, therapist: initTher,
          treatmentType: initType, frequencyPerWeek: initFreq, updatedBy: state.therapist || 'עורך'
        }).then(function (data) {
          // Save stuck locally; flag if the outpatient billing-type sync didn't.
          var w = clinicalSyncWarning(data);
          if (w) initSyncWarning = svc(initType) + ': ' + w;
        });
      })
      .then(function () { return loadAll(); })
      .then(function () {
        closePatientModal();
        if (initSyncWarning) toast('נשמר, אך סנכרון סוג החיוב נכשל — ' + initSyncWarning, true);
        else toast('נשמר');
      })
      .catch(function (err) {
        // The server is the duplicate safety-net; surface its Hebrew message.
        var msg = err.message === 'duplicate_phone'
          ? 'כבר קיים/ת מטופל/ת עם מספר הטלפון הזה'
          : err.message;
        toast('שגיאה: ' + msg, true);
      })
      .finally(function () { sub.disabled = false; });
  }

  // --- assignments modal (multiple therapists/plans per patient) --------
  var assignmentsCtx = { phone: '', removed: [] };
  // Times-per-week options: blank default + 1..7. Reused by the modal and the
  // intake form so both offer the same fixed, valid range (no free-form number).
  function freqOptions(selected) {
    var sel = String(selected == null ? '' : selected);
    var out = '<option value="">—</option>';
    for (var n = 1; n <= 7; n++) {
      out += '<option value="' + n + '"' + (sel === String(n) ? ' selected' : '') + '>' + n + '</option>';
    }
    return out;
  }
  // Weekly recurring pattern editor: one slot row per weekly session (weekday +
  // time + location). 0=ראשון … 6=שבת (matches JS getDay used by Recurring).
  var WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function weekdayOptions(selected) {
    var sel = String(selected == null ? '' : selected);
    return ['<option value="">— יום —</option>'].concat(WEEKDAY_LABELS.map(function (lab, idx) {
      return '<option value="' + idx + '"' + (sel === String(idx) ? ' selected' : '') + '>' + lab + '</option>';
    })).join('');
  }
  function slotRowHtml(slot) {
    slot = slot || {};
    return '<div class="slot-row">' +
      '<select class="s-weekday">' + weekdayOptions(slot.weekday) + '</select>' +
      '<select class="s-time">' + timeOptions(slot.time || '') + '</select>' +
      '<select class="s-location">' + locationOptions(slot.location || '') + '</select>' +
      '</div>';
  }
  // N slot rows: prefer stored slots, else N empty rows to match the frequency.
  function slotsEditorHtml(slots, freq) {
    var arr = Recurring.parseSlots(slots);
    var n = arr.length || (parseInt(freq, 10) || 0);
    var html = '';
    for (var i = 0; i < n; i++) html += slotRowHtml(arr[i] || {});
    return html;
  }
  function readSlotRows(container) {
    return $$('.slot-row', container).map(function (el) {
      return {
        weekday: el.querySelector('.s-weekday').value,
        time: el.querySelector('.s-time').value,
        location: el.querySelector('.s-location').value
      };
    });
  }
  // Rebuild a row's slot editor to match its chosen frequency, preserving values.
  function syncSlotEditor(rowEl) {
    var n = parseInt(rowEl.querySelector('.a-freq').value, 10) || 0;
    var container = rowEl.querySelector('.a-slots');
    var existing = readSlotRows(container);
    var html = '';
    for (var i = 0; i < n; i++) html += slotRowHtml(existing[i] || {});
    container.innerHTML = html;
  }
  function assignmentRowHtml(a) {
    a = a || {};
    return '<div class="assignment-row" data-aid="' + escapeHtml(a.id || '') + '">' +
      '<div class="assignment-head">' +
        '<select class="a-therapist">' + optionList(activeTherapistNames(), a.therapist || '') + '</select>' +
        '<select class="a-type">' + typeOptionList(resolveTypeOption(a.treatmentType || '')) + '</select>' +
        '<select class="a-freq">' + freqOptions(a.frequencyPerWeek) + '</select>' +
        '<button type="button" class="btn btn-ghost btn-sm remove-assignment" title="הסר">✕</button>' +
      '</div>' +
      '<div class="a-slots-label">מועדים שבועיים קבועים:</div>' +
      '<div class="a-slots">' + slotsEditorHtml(a.slots, a.frequencyPerWeek) + '</div>' +
      '</div>';
  }
  function openAssignmentsModal(phone) {
    var p = patientByPhone(phone);
    if (!p) { toast('מטופל/ת לא נמצא', true); return; }
    assignmentsCtx = { phone: p.phone, removed: [] };
    $('#assignmentsPatientName').textContent = p.name;
    var rows = p.assignments.length ? p.assignments.map(assignmentRowHtml) : [assignmentRowHtml({})];
    $('#assignmentRows').innerHTML = rows.join('');
    $('#assignmentsModal').hidden = false;
  }
  function closeAssignmentsModal() { $('#assignmentsModal').hidden = true; }
  function addAssignmentRow() {
    var div = document.createElement('div');
    div.innerHTML = assignmentRowHtml({});
    $('#assignmentRows').appendChild(div.firstChild);
  }
  function saveAssignments() {
    var btn = $('#assignmentsSave');
    if (btn.disabled) return;
    var phone = assignmentsCtx.phone;
    var rows = $$('#assignmentRows .assignment-row');
    var toSave = [];
    var keptIds = {};
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var ther = (el.querySelector('.a-therapist').value || '').trim();
      var type = (el.querySelector('.a-type').value || '').trim();
      var freq = (el.querySelector('.a-freq').value || '').trim();
      if (!ther && !type) continue;                       // blank row -> skip
      if (!ther) { toast('יש לבחור מטפל/ת לכל שיבוץ', true); return; }
      // Weekly recurring pattern (optional): all-or-nothing — either no slots, or
      // exactly `freq` complete slots {weekday,time,location}.
      var slotsJson = '';
      var filled = readSlotRows(el.querySelector('.a-slots')).filter(function (s) {
        return s.weekday !== '' || s.time || s.location;
      });
      if (filled.length) {
        if (!freq) { toast(ther + ': יש לבחור תדירות בשבוע לפני הגדרת מועדים', true); return; }
        var v = Recurring.validateSlots(filled, freq);
        if (!v.ok) { toast(ther + ': ' + v.error, true); return; }
        slotsJson = JSON.stringify(v.slots);
      }
      var aid = el.getAttribute('data-aid') || '';
      if (aid) keptIds[aid] = true;
      toSave.push({ id: aid || uid(), patientPhone: phone, therapist: ther, treatmentType: type, frequencyPerWeek: freq, slots: slotsJson, updatedBy: state.therapist || 'עורך' });
    }
    // Existing assignments whose row was deleted -> remove.
    var existing = (patientByPhone(phone) || { assignments: [] }).assignments;
    var toRemove = existing.filter(function (a) { return a.id && !keptIds[a.id]; }).map(function (a) { return a.id; });

    btn.disabled = true;
    // Collect any billing-type sync warnings across the saved rows. The saves
    // succeed regardless; a warning means the assignment stuck locally but the
    // outpatient billing-type sync didn't — surfaced, never swallowed.
    var syncWarnings = [];
    var chain = Promise.resolve();
    toSave.forEach(function (a) {
      chain = chain.then(function () {
        return apiSaveAssignment(a).then(function (data) {
          var w = clinicalSyncWarning(data);
          if (w) syncWarnings.push(svc(a.treatmentType) + ': ' + w);
        });
      });
    });
    toRemove.forEach(function (id) { chain = chain.then(function () { return apiRemoveAssignment(id); }); });
    chain
      .then(function () { return loadAll(); })
      .then(function () {
        closeAssignmentsModal();
        if (syncWarnings.length) {
          toast('השיבוצים נשמרו, אך סנכרון סוג החיוב נכשל — ' + syncWarnings.join(' · '), true);
        } else {
          toast('השיבוצים נשמרו');
        }
      })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { btn.disabled = false; });
  }

  // Scheduling/reporting need a therapist name picked in tab 3 first.
  function ensureTherapist() {
    if (hasTherapist()) return true;
    toast('יש לבחור שם מטפל/ת בלשונית «המטופלים שלי»', true); return false;
  }

  // --- view switching (no roles; all tabs always visible) ----------------
  function setView(view) {
    if (!Access.isTab(view)) view = Access.defaultView();
    state.view = view;
    document.body.classList.remove('view-dashboard', 'view-workflow', 'view-mine');
    document.body.classList.add('view-' + view);
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
  }

  function on(sel, ev, fn) {
    var el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) { console.warn('[ezone-therapists] missing element for', sel); return; }
    el.addEventListener(ev, fn);
  }

  function wireEvents() {
    // Shared password gate (verified server-side; correct → reveal the app).
    on('#gateSubmit', 'click', function () {
      var pw = ($('#gateInput').value || '');
      apiGateVerify(pw)
        .then(function (d) { if (d && d.ok) startApp(); else { var e = $('#gateError'); if (e) e.hidden = false; } })
        .catch(function () { var e = $('#gateError'); if (e) e.hidden = false; });
    });
    on('#gateInput', 'keydown', function (e) {
      var err = $('#gateError'); if (err) err.hidden = true;
      if (e.key === 'Enter') { e.preventDefault(); $('#gateSubmit').click(); }
    });

    // Tab-3 name picker — sets the runtime therapist identity (not persisted).
    on('#mineTherapist', 'change', function (e) {
      state.therapist = (e.target.value || '').trim();
      renderMine();
    });

    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { setView(t.dataset.view); }); });
    on('#refreshBtn', 'click', function () { loadAll().then(function () { toast('רועננו'); }).catch(function () {}); });

    on('#dashboardSearch', 'input', function (e) { state.dashboardSearch = e.target.value; renderDashboard(); });
    on('#workflowSearch', 'input', function (e) { state.workflowSearch = e.target.value; renderSchedule(); });

    on('#newPatientBtn', 'click', openNewPatient);          // Vered (שיבוץ)
    on('#mineScheduleBtn', 'click', function () { openScheduleModal(); }); // therapist (מ)

    // Delegated patient actions — shared by the dashboard list and the שיבוץ
    // assign list (so a newly registered patient is actionable in both).
    function onPatientListClick(e) {
      var ep = e.target.closest('[data-edit-patient]');
      if (ep) { openPatientModal(ep.getAttribute('data-edit-patient')); return; }
      var ap = e.target.closest('[data-assignments-patient]');
      if (ap) { openAssignmentsModal(ap.getAttribute('data-assignments-patient')); return; }
      var stp = e.target.closest('[data-stop-patient]');
      if (stp) { markPatientStopped(stp.getAttribute('data-stop-patient')); return; }
      var sp = e.target.closest('[data-schedule-patient]');
      if (sp) {
        var rec = patientByPhone(sp.getAttribute('data-schedule-patient'));
        var first = rec && rec.assignments[0];
        openScheduleModal(rec ? { name: rec.name, phone: rec.phone, treatmentType: first ? first.treatmentType : '', therapist: first ? first.therapist : '' } : null);
      }
    }
    on('#patientsList', 'click', onPatientListClick);  // Vered dashboard (no actions)
    on('#assignList', 'click', onPatientListClick);    // Vered שיבוץ (register/assign)

    // Stopped / discharged list — restore (undo a pending stop) and delete (test
    // cleanup). By phone, so an orphaned flag with no active match still works.
    on('#stoppedList', 'click', function (e) {
      var rp = e.target.closest('[data-restore-patient]');
      if (rp) { restorePatient(rp.getAttribute('data-restore-patient')); return; }
      var dp = e.target.closest('[data-delete-patient]');
      if (dp) { removePatient(dp.getAttribute('data-delete-patient')); return; }
    });

    // המטופלים שלי (therapist): schedule + report did-it-happen on their patients.
    on('#mineSearch', 'input', function (e) { state.mineSearch = e.target.value; renderMine(); });
    on('#view-mine', 'click', function (e) {
      var stp = e.target.closest('[data-stop-patient]');
      if (stp) { onPatientListClick(e); return; }
      var sp = e.target.closest('[data-schedule-patient]');
      if (sp) { onPatientListClick(e); return; }
      var eb = e.target.closest('[data-edit-booking]');
      if (eb) { openBookingEdit(eb.getAttribute('data-edit-booking')); return; }
      var cb = e.target.closest('[data-cancel-booking]');
      if (cb) { cancelBooking(cb.getAttribute('data-cancel-booking')); return; }
      var ob = e.target.closest('[data-mine-outcome]');
      if (ob) { markOutcome(ob.getAttribute('data-id'), ob.getAttribute('data-mine-outcome')); return; }
      // Legacy binary mark (kept for step 3 wiring; no longer surfaced in the UI).
      var b = e.target.closest('[data-mine-att]');
      if (b) { markAttendance(b.getAttribute('data-id'), b.getAttribute('data-mine-att')); return; }
      if (e.target.closest('#syncNowBtn')) syncNow();
    });
    on('#workflowTherapistFilter', 'change', function (e) {
      state.workflowTherapist = e.target.value || '';
      renderAssign(); renderSchedule();
    });

    // Schedule modal: group toggle, add/remove patients.
    on('#scheduleType', 'change', updateGroupUi);
    on('#addPatientRowBtn', 'click', function () { addPatientRow(); updateGroupUi(); });
    on('#patientRows', 'click', function (e) {
      var rm = e.target.closest('.remove-patient');
      if (rm) { var row = rm.closest('.patient-row'); if ($$('#patientRows .patient-row').length > 1) row.remove(); }
    });
    // Editing a patient identity invalidates a pending gate result.
    on('#patientRows', 'input', function () { if (pendingPatients) resetGateResults(); });

    on('#stillAdmitted', 'change', function (e) { $('#admittedDetails').hidden = !e.target.checked; });

    // Assignments modal: add row, remove row, save.
    on('#addAssignmentRowBtn', 'click', addAssignmentRow);
    on('#assignmentRows', 'click', function (e) {
      var rm = e.target.closest('.remove-assignment');
      if (rm) rm.closest('.assignment-row').remove();
    });
    // Changing an assignment's frequency rebuilds its weekly slot editor.
    on('#assignmentRows', 'change', function (e) {
      if (e.target.classList && e.target.classList.contains('a-freq')) {
        syncSlotEditor(e.target.closest('.assignment-row'));
      }
    });
    on('#assignmentsSave', 'click', saveAssignments);

    on('#reportSave', 'click', saveReport);
    on('#bookingForm', 'submit', function (e) { e.preventDefault(); saveBooking(); });
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeScheduleModal(); closePatientModal(); closeAssignmentsModal(); closeReportModal(); closeBookingModal(); });
    });

    on('#scheduleForm', 'submit', function (e) { e.preventDefault(); handleScheduleSubmit(); });
    on('#patientForm', 'submit', function (e) { e.preventDefault(); handlePatientSubmit(); });
  }

  // --- shared password gate (UI only; verified server-side, never persisted) --
  async function apiGateStatus() {
    var r = await fetch('/api/gate', { cache: 'no-store' });
    return r.json();
  }
  async function apiGateVerify(password) {
    var r = await fetch('/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    });
    return r.json();
  }
  function showGate() {
    $('#gateScreen').hidden = false;
    $('#app').hidden = true;
    var i = $('#gateInput'); i.value = ''; i.focus();
  }
  // Reveal the app and run the normal direct-open flow (dashboard + load).
  function startApp() {
    $('#gateScreen').hidden = true;
    $('#app').hidden = false;
    // The tab-3 therapist pick is a fresh runtime choice each open (not stored).
    setView('dashboard');
    loadAll().catch(function () {});
  }

  function init() {
    try { wireEvents(); } catch (e) { console.error('[ezone-therapists] wireEvents failed', e); }
    // Decide the gate first — re-prompted every open, nothing persisted. If the
    // status check fails (the page itself came from this server, so this is rare)
    // we open rather than lock anyone out of a UI-only gate.
    apiGateStatus()
      .then(function (d) { if (d && d.required) showGate(); else startApp(); })
      .catch(function () { startApp(); });
  }

  function bootWhenReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  bootWhenReady();
})();
