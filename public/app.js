/* E-ZONE Outpatient — frontend */
(function () {
  'use strict';

  window.addEventListener('error', function (ev) {
    try {
      var msg = (ev && ev.error && ev.error.message) || ev.message || 'Unknown error';
      var where = ev.filename ? (' @ ' + ev.filename + ':' + ev.lineno) : '';
      var t = document.getElementById('toast');
      if (t) {
        t.textContent = 'JS error: ' + msg + where;
        t.classList.add('error');
        t.hidden = false;
      }
      console.error('[ezone] window error', ev.error || ev.message, where);
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    console.error('[ezone] unhandled rejection', ev.reason);
  });

  // --- constants ---------------------------------------------------------
  // Day-center treatment type: stable key + display label + back-compat aliases.
  // The serviceType column stores the LABEL (it is not keyed), so new writes
  // persist DAY_CENTER_LABEL; existing "מרכז יום" rows keep matching via
  // DAY_CENTER_ALIASES. No sheet migration / backfill.
  var DAY_CENTER_KEY = 'day_center';                 // stable, never changes
  var DAY_CENTER_LABEL = 'ליווי יומי בקהילה';          // display only
  var DAY_CENTER_ALIASES = ['מרכז יום', DAY_CENTER_LABEL, DAY_CENTER_KEY];

  var SERVICE_TYPES = [
    'פרטני',
    'פרטני CBT',
    'פרטני EMDR',
    'קבוצה',
    'טיפול משפחתי',
    DAY_CENTER_LABEL,
    'מעקב פסיכיאטרי'
  ];
  var LOCATIONS = ['רעננה הפרדס', 'רעננה אשר', 'רמות השבים', 'קיסריה גמילה', 'קיסריה עפרוני'];

  var HOUSE_OF_ORIGIN_LABELS = {
    raanana_pardes: 'רעננה הפרדס',
    raanana:  'רעננה אשר',
    ramot:    'רמות השבים',
    kisaria_gmila: 'קיסריה גמילה',
    efroni:   'קיסריה עפרוני',
    rehab:    'קיסריה ריהאב',
    external: 'חיצוני'
  };
  function houseOfOriginLabel(v) {
    var s = String(v == null ? '' : v).trim();
    return HOUSE_OF_ORIGIN_LABELS[s] || '';
  }

  var DAY_CENTER_LOCATION = 'רעננה הפרדס';

  var STAGES = [
 { id: 'new',        he: 'פרטים אישיים' },
    { id: 'intro',      he: 'שיחת היכרות' },
    { id: 'agreement',  he: 'תוכנית טיפול' }
  ];
  var STAGE_ALIASES = { 'הסכם נחתם': 'agreement' };
  var NOT_RELEVANT_HE = 'לא רלוונטי';

  function heToId(he) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].he === he) return STAGES[i].id;
    if (STAGE_ALIASES[he]) return STAGE_ALIASES[he];
    if (he === NOT_RELEVANT_HE) return 'not_relevant';
    return 'new';
  }
  function idToHe(id) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return STAGES[i].he;
    if (id === 'not_relevant') return NOT_RELEVANT_HE;
    return STAGES[0].he;
  }

  function parseServices(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function formatServices(arr) { return (arr || []).join(', '); }
  function hasDayCenter(arr) {
    var svcs = parseServices(arr);
    for (var i = 0; i < svcs.length; i++) {
      if (DAY_CENTER_ALIASES.indexOf(svcs[i]) !== -1) return true;
    }
    return false;
  }
  // Display-only: map a legacy day-center service string to DAY_CENTER_LABEL.
  // Does NOT change stored values or compares; other types pass through.
  function serviceLabel(s) { return hasDayCenter([s]) ? DAY_CENTER_LABEL : s; }
  function wholeSessions(v) { var n = Math.round(toNum(v)); return n < 0 ? 0 : n; }

  function parseSessionsBreakdown(v, services) {
    var out = {};
    if (!v && v !== 0) return out;
    if (typeof v === 'object' && !Array.isArray(v)) {
      Object.keys(v).forEach(function (k) { out[k] = wholeSessions(v[k]); });
      return out;
    }
    var s = String(v).trim();
    if (s && s.charAt(0) === '{') {
      try {
        var parsed = JSON.parse(s);
        Object.keys(parsed).forEach(function (k) { out[k] = wholeSessions(parsed[k]); });
        return out;
      } catch (_) {}
    }
    var list = parseServices(services);
    var n = wholeSessions(s);
    if (list.length === 1) { out[list[0]] = n; return out; }
    if (n) out._total = n;
    return out;
  }
  function formatSessionsBreakdown(b) { return JSON.stringify(b || {}); }
  function totalSessions(v, services) {
    var b = parseSessionsBreakdown(v, services);
    return Object.keys(b).reduce(function (s, k) { return s + wholeSessions(b[k]); }, 0);
  }

  // --- state -------------------------------------------------------------
  var state = {
    role: 'viewer',
    view: 'dashboard',
    leads: [],
    clients: [],
    payments: [],
    charges: [],
    stopFlags: [],  // stop-treatment flags from the therapists app (await confirmation)
    extraRequests: [], // over-package extra-session requests from the therapists app (await Vered approval)
    retained: [],   // lead-retention list (not_relevant + finished)
    leadSearch: '',
    clientSearch: '',
    retentionSearch: '',
    billingSearch: '',
    clientTab: 'all',
    billingDate: '',
    sessionLog: null,    // SessionLog rows for the payout view; null = not yet fetched
    sessionLogLoading: false,
    sessionLogError: '',
    payoutMonth: '',     // 'YYYY-MM' for the payout view; defaults to current month
    payoutExpanded: {},  // therapist name -> expanded session detail (bool)
    settings: { bankName: '', bankBranch: '', bankAccount: '', bankHolder: '' },
    loaded: false
  };

  var PAYMENT_STATUSES = [
    { id: 'paid',    he: 'שולם' },
    { id: 'partial', he: 'שולם חלקית' },
    { id: 'unpaid',  he: 'לא שולם' }
  ];
  var PAYMENT_STATUS_ALIASES = {
    'שולם': 'paid', paid: 'paid',
    'שולם חלקית': 'partial', partial: 'partial',
    'לא שולם': 'unpaid', unpaid: 'unpaid'
  };
  function normalizePaymentStatus(v) {
    var s = String(v == null ? '' : v).trim();
    return PAYMENT_STATUS_ALIASES[s] || PAYMENT_STATUS_ALIASES[s.toLowerCase()] || 'unpaid';
  }

  // Only an EXPLICIT partial/unpaid status is a billing problem.
  // Empty/legacy status = assumed paid (no false alarm for old patients).
  function hasBillingProblem(c) {
    if (!c) return false;
    var raw = String(c.paymentStatus == null ? '' : c.paymentStatus).trim();
    if (!raw) return false;
    var st = PAYMENT_STATUS_ALIASES[raw] || PAYMENT_STATUS_ALIASES[raw.toLowerCase()] || '';
    return st === 'partial' || st === 'unpaid';
  }

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
  function fmtDate(v) {
    if (!v) return '';
    var s = String(v);
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    return s;
  }
  // Display date as DD/MM/YYYY
  function displayDate(v) {
    var s = fmtDate(v);
    if (!s) return '';
    var parts = s.split('-');
    if (parts.length !== 3) return s;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  // Format money with comma + ₪ sign — consistent format everywhere
  function money(n) {
    if (!isFinite(n)) return '₪0';
    return '₪' + Math.round(n).toLocaleString('he-IL');
  }
  function toNum(v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function monthlyRevenue(c) { return toNum(c.pricePerSession); }
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function () { t.hidden = true; }, 2600);
  }
  // Add 30 days to an ISO date string, return ISO string
  function addDays(isoDate, days) {
    if (!isoDate) return '';
    var d = new Date(isoDate);
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + days);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // 1 week before the treatment-month ends — collect the next monthly payment.
  // Mirrors RENEWAL_WINDOW_DAYS in public/vered-alerts.js — keep both in sync.
  var RENEWAL_WINDOW_DAYS = 7;

  // Add 1 calendar month to an ISO date string
  function addMonth(isoDate) {
    if (!isoDate) return '';
    var d = new Date(isoDate);
    if (isNaN(d)) return '';
    var origDay = d.getDate();
    d.setMonth(d.getMonth() + 1);
    // Handle edge case: Jan 31 + 1 month -> Mar 3 (skips Feb). Cap at last day of target month.
    if (d.getDate() !== origDay) d.setDate(0);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // The ISO due-date of a client's next monthly renewal — anchor + 1 month with
  // short-month clamp. Anchor precedence: packageChangeDate (a שינוי חבילה
  // re-anchors the cycle), else last payment date, else start date. Mirrors
  // nextRenewalDueDate in public/charges-logic.js — keep both in sync. Shared
  // by renewalInfo()'s banner and the "חידוש ותשלום" button so they never diverge.
  function nextRenewalDueDate(c) {
    if (!c) return '';
    var anchor = c.packageChangeDate || c.paymentDate || c.startDate || '';
    if (!anchor) return '';
    return addMonth(anchor);
  }

  // Days between two ISO dates (b - a). Negative if a is after b.
  function daysBetween(aIso, bIso) {
    if (!aIso || !bIso) return null;
    var a = new Date(aIso);
    var b = new Date(bIso);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  // Compute renewal info for a client.
  // Returns { renewalDate, daysLeft, status: 'overdue'|'due_soon'|'ok'|'unknown' }
  // Source of truth for "is the current month settled?" is the actual base
  // payment row — the SAME lookup the paid/unpaid badge uses — not the
  // date-only calc or the denormalized paymentStatus flag. Without this the
  // banner screamed "overdue" on a month that was already paid (the row says
  // paid, but the renewal date had quietly slipped into the past).
  //   - If the current month's base row is paid: that month is settled. The
  //     next renewal is one cycle out from this month's due date, so the banner
  //     counts toward next cycle (ok/due_soon) and is NEVER overdue.
  //   - Otherwise: date calc (renewal = anchor + 1 month) + hasBillingProblem.
  function renewalInfo(c) {
    if (!c || c.status === 'סיים טיפול') return { status: 'unknown' };
    var anchor = c.packageChangeDate || c.paymentDate || c.startDate || '';
    if (!anchor) return { status: 'unknown' };
    var status;
    var renewal;
    var daysLeft;
    var curDue = currentMonthBaseDueDate(c);
    var paidThisMonth = paymentForClientOn(c, curDue).status === 'paid';
    if (paidThisMonth) {
      // Current month is settled — renewal is one cycle past this month's due
      // date. Clamp a negative gap to 0 ("renew today") so stale data can't
      // produce nonsense like "renew in -5 days", and so paid never => overdue.
      renewal = addMonth(curDue);
      daysLeft = daysBetween(today(), renewal);
      if (daysLeft === null) {
        status = 'unknown';
      } else {
        if (daysLeft < 0) daysLeft = 0;
        status = daysLeft <= RENEWAL_WINDOW_DAYS ? 'due_soon' : 'ok';
      }
    } else {
      renewal = nextRenewalDueDate(c);
      daysLeft = daysBetween(today(), renewal);
      if (hasBillingProblem(c)) {
        // Explicitly marked partial/unpaid - overdue
        status = 'overdue';
      } else if (daysLeft === null) {
        status = 'unknown';
      } else if (daysLeft < 0) {
        status = 'overdue';
      } else if (daysLeft <= RENEWAL_WINDOW_DAYS) {
        status = 'due_soon';
      } else {
        status = 'ok';
      }
    }
    return { renewalDate: renewal, daysLeft: daysLeft, status: status };
  }

  // --- API ---------------------------------------------------------------
  async function apiLoad() {
    var r = await fetch('/api/sheets', { cache: 'no-store' });
    var data = await r.json();
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiSave(payload) {
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  async function apiLoadSettings() {
    try {
      var r = await fetch('/api/sheets?action=getSettings', { cache: 'no-store' });
      var data = await r.json();
      if (!r.ok || data.ok === false) return {};
      return data.settings || {};
    } catch (_) { return {}; }
  }
  async function apiSaveSettings(settings) {
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveSettings', settings: settings })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  function normalizeLeadFromSheet(row) {
    var services = formatServices(parseServices(row.serviceType));
    return {
      id: row.id || uid(),
      name: row.name || '',
      phone: recoverPhone(row.phone),
      serviceType: services,
      location: row.location || '',
      note: row.note || '',
      stage: heToId(row.stage || ''),
      sessionsPerWeek: parseSessionsBreakdown(row.sessionsPerWeek, services),
      pricePerSession: row.pricePerSession === '' ? '' : toNum(row.pricePerSession),
      startDate: fmtDate(row.startDate),
      created: fmtDate(row.created) || today(),
      introDateTime: row.introDateTime || '',
      // billing info when lead becomes active
      paymentStatus: row.paymentStatus || '',   // 'paid' | 'partial' | 'unpaid'
      paymentDate: fmtDate(row.paymentDate),
      nextBillingDate: fmtDate(row.nextBillingDate),
      house_of_origin: row.house_of_origin || ''
    };
  }
  function normalizeClientFromSheet(row) {
    var services = formatServices(parseServices(row.serviceType));
    return {
      id: row.id || uid(),
      name: row.name || '',
      phone: recoverPhone(row.phone),
      serviceType: services,
      location: row.location || '',
      sessionsPerWeek: parseSessionsBreakdown(row.sessionsPerWeek, services),
      pricePerSession: toNum(row.pricePerSession),
      startDate: fmtDate(row.startDate),
      status: row.status || 'פעיל',
      exitDate: fmtDate(row.exitDate),
      fromLead: row.fromLead || '',
      source: row.source || 'lead',
      notes: row.notes || '',
      billingType: 'monthly',
      billingDay: row.billingDay === '' || row.billingDay == null ? '' : toNum(row.billingDay),
      // payment info
      paymentStatus: row.paymentStatus || '',
      paymentDate: fmtDate(row.paymentDate),
      nextBillingDate: fmtDate(row.nextBillingDate),
      house_of_origin: row.house_of_origin || '',
      treatmentContactPhone: recoverPhone(row.treatmentContactPhone),
      payerName: row.payerName || '',
      payerPhone: recoverPhone(row.payerPhone),
      paymentLink: row.paymentLink || '',
      // data-layer passthrough (task 4.5a): preserve the clinical type so a
      // dashboard save round-trips it (the server derives serviceType from it).
      clinicalTreatmentType: row.clinicalTreatmentType || '',
      // Server-managed monthly credit balance (session accounting). Read-only on
      // the card; the server owns it and ignores the value on saveAll.
      creditsOwed: toNum(row.creditsOwed) || 0,
      // שינוי חבילה: date the package was last changed. Re-anchors the renewal
      // cycle (see nextRenewalDueDate / renewalInfo). Blank for never-changed rows.
      packageChangeDate: fmtDate(row.packageChangeDate)
    };
  }

  function leadForSheet(l) {
    var services = formatServices(parseServices(l.serviceType));
    var breakdown = parseSessionsBreakdown(l.sessionsPerWeek, services);
    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      serviceType: services,
      location: l.location,
      note: l.note,
      stage: idToHe(l.stage),
      sessionsPerWeek: Object.keys(breakdown).length ? formatSessionsBreakdown(breakdown) : '',
      pricePerSession: l.pricePerSession === '' ? '' : toNum(l.pricePerSession),
      startDate: l.startDate || '',
      created: l.created || today(),
      introDateTime: l.introDateTime || '',
      paymentStatus: l.paymentStatus || '',
      paymentDate: l.paymentDate || '',
      nextBillingDate: l.nextBillingDate || '',
      not_relevant_reason: l.not_relevant_reason || '',
      not_relevant_note: l.not_relevant_note || '',
      house_of_origin: l.house_of_origin || ''
    };
  }
  function clientForSheet(c) {
    var services = formatServices(parseServices(c.serviceType));
    var breakdown = parseSessionsBreakdown(c.sessionsPerWeek, services);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      serviceType: services,
      location: c.location,
      sessionsPerWeek: formatSessionsBreakdown(breakdown),
      pricePerSession: toNum(c.pricePerSession),
      startDate: c.startDate || '',
      status: c.status || 'פעיל',
      exitDate: c.exitDate || '',
      fromLead: c.fromLead || '',
      source: c.source || 'lead',
      notes: c.notes || '',
      billingType: 'monthly',
      billingDay: c.billingDay === '' || c.billingDay == null ? '' : toNum(c.billingDay),
      paymentStatus: c.paymentStatus || '',
      paymentDate: c.paymentDate || '',
      nextBillingDate: c.nextBillingDate || '',
      house_of_origin: c.house_of_origin || '',
      treatmentContactPhone: c.treatmentContactPhone || '',
      payerName: c.payerName || '',
      payerPhone: c.payerPhone || '',
      paymentLink: c.paymentLink || '',
      // data-layer passthrough (task 4.5a): preserve the clinical type so it is
      // not blanked on save; the server (_deriveClientServiceType) is the
      // authority that turns it into serviceType.
      clinicalTreatmentType: c.clinicalTreatmentType || '',
      // Send the last-known credit balance to keep the column aligned; the server
      // treats creditsOwed as authoritative and preserves its own value by id.
      creditsOwed: c.creditsOwed == null || c.creditsOwed === '' ? 0 : toNum(c.creditsOwed),
      // שינוי חבילה passthrough: preserve the package-change re-anchor date on save.
      packageChangeDate: c.packageChangeDate || ''
    };
  }

  async function persist() {
    var payload = {
      leads: state.leads.map(leadForSheet),
      clients: state.clients.map(clientForSheet)
    };
    await apiSave(payload);
  }

  // --- Payments API / serialization -------------------------------------
  async function apiGetPayments() {
    var r = await fetch('/api/sheets?action=getPayments', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetCharges() {
    var r = await fetch('/api/sheets?action=getCharges', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetStopFlags() {
    var r = await fetch('/api/sheets?action=getStopFlags', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetExtraRequests() {
    var r = await fetch('/api/sheets?action=getExtraSessionRequests', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiApproveExtra(id, approvedBy) {
    var r = await fetch('/api/sheets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approveExtraSession', id: id, approvedBy: approvedBy })
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetSessionLog() {
    var r = await fetch('/api/sheets?action=getSessionLog', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiPostAction(action, extra) {
    var body = Object.assign({ action: action }, extra || {});
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

  function normalizeStopFlagFromSheet(row) {
    return {
      id: row.id || '',
      phone: recoverPhone(row.phone),
      name: row.name || '',
      clientId: row.clientId == null ? '' : String(row.clientId),
      reportedBy: row.reportedBy || '',
      reportedAt: row.reportedAt || '',
      note: row.note || '',
      status: (row.status || 'pending').toString().trim().toLowerCase(),
      resolvedBy: row.resolvedBy || '',
      resolvedAt: row.resolvedAt || ''
    };
  }

  function normalizePaymentFromSheet(row) {
    return {
      id: row.id || '',
      clientId: row.clientId || '',
      clientName: row.clientName || '',
      billingType: (row.billingType || 'monthly').toString().toLowerCase(),
      dueDate: fmtDate(row.dueDate),
      amountDue: toNum(row.amountDue),
      amountPaid: toNum(row.amountPaid),
      status: normalizePaymentStatus(row.status),
      paymentDate: fmtDate(row.paymentDate),
      method: row.method || '',
      notes: row.notes || '',
      bundleSize: toNum(row.bundleSize),
      sessionsUsed: toNum(row.sessionsUsed)
    };
  }
  function paymentForSheet(p) {
    return {
      id: p.id,
      clientId: p.clientId || '',
      clientName: p.clientName || '',
      billingType: p.billingType || 'monthly',
      dueDate: p.dueDate || '',
      amountDue: toNum(p.amountDue),
      amountPaid: toNum(p.amountPaid),
      status: p.status || 'unpaid',
      paymentDate: p.paymentDate || '',
      method: p.method || '',
      notes: p.notes || '',
      bundleSize: toNum(p.bundleSize),
      sessionsUsed: toNum(p.sessionsUsed)
    };
  }
  async function persistPayment(payment) {
    await apiPostAction('savePayment', { payment: paymentForSheet(payment) });
  }

  async function removePayment(paymentId) {
    await apiPostAction('removePayment', { id: paymentId });
  }

  // Remove every payment row tied to a clientId (used when a patient is deleted).
  async function removePaymentsForClient(clientId) {
    var theirs = state.payments.filter(function (p) { return p.clientId === clientId; });
    state.payments = state.payments.filter(function (p) { return p.clientId !== clientId; });
    for (var i = 0; i < theirs.length; i++) {
      try { await removePayment(theirs[i].id); } catch (e) { console.warn('[ezone] removePayment failed:', theirs[i].id, e.message); }
    }
    return theirs.length;
  }

  function normalizeChargeFromSheet(row) {
    var active = row.active;
    var activeBool = (active === true) || (String(active).toLowerCase() === 'true');
    return {
      id: row.id || '',
      clientId: row.clientId || '',
      description: row.description || '',
      amount: toNum(row.amount),
      billingType: (row.billingType || 'one_time').toString().toLowerCase(),
      chargeDate: fmtDate(row.chargeDate),
      billingDay: row.billingDay === '' || row.billingDay == null ? '' : toNum(row.billingDay),
      active: activeBool,
      notes: row.notes || '',
      created: fmtDate(row.created),
      treatmentType: row.treatmentType || '',
      frequencyPerWeek: row.frequencyPerWeek === '' || row.frequencyPerWeek == null ? '' : toNum(row.frequencyPerWeek)
    };
  }
  function chargeForSheet(c) {
    return {
      id: c.id,
      clientId: c.clientId || '',
      description: c.description || '',
      amount: toNum(c.amount),
      billingType: c.billingType || 'one_time',
      chargeDate: c.chargeDate || '',
      billingDay: (c.billingDay === '' || c.billingDay == null) ? '' : toNum(c.billingDay),
      active: c.active === false ? 'false' : 'true',
      notes: c.notes || '',
      created: c.created || today(),
      treatmentType: c.treatmentType || '',
      frequencyPerWeek: (c.frequencyPerWeek === '' || c.frequencyPerWeek == null) ? '' : toNum(c.frequencyPerWeek)
    };
  }
  async function persistCharge(charge) {
    await apiPostAction('saveCharge', { charge: chargeForSheet(charge) });
  }
  async function persistRemoveCharge(id) {
    await apiPostAction('removeCharge', { id: id });
  }

  async function persistRemoveLead(lead) {
    await apiPostAction('removeLead', { lead: leadForSheet(lead) });
  }

  // --- Billing helpers --------------------------------------------------
  function dayOfMonth(iso) {
    if (!iso) return null;
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length < 3) return null;
    var d = parseInt(parts[2], 10);
    return isFinite(d) ? d : null;
  }
  function monthKey(iso) { return String(iso || '').slice(0, 7); }
  function monthLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }
  function clientAmountDue(c) { return toNum(c.pricePerSession); }

  // Payment id scheme — see CHANGELOG-extra-charges.md for the full design.
  //   base monthly:    pay::<clientId>::base::<YYYY-MM>
  //   extra monthly:   pay::<clientId>::chg-<chargeId>::<YYYY-MM>
  //   one-time extra:  pay::<clientId>::chg-<chargeId>::once
  //   legacy (pre-PR): pay::<clientId>::<YYYY-MM>          (read-only, base-monthly)
  function paymentId(client, dueDateISO, kind, chargeId) {
    if (kind === 'extra') {
      if (!chargeId) throw new Error('paymentId: chargeId required for kind=extra');
      var charge = state.charges.find(function (c) { return c.id === chargeId; });
      var suffix = (charge && charge.billingType === 'one_time') ? 'once' : monthKey(dueDateISO);
      return 'pay::' + client.id + '::chg-' + chargeId + '::' + suffix;
    }
    return 'pay::' + client.id + '::base::' + monthKey(dueDateISO);
  }
  function legacyBasePaymentId(clientId, dueDateISO) {
    return 'pay::' + clientId + '::' + monthKey(dueDateISO);
  }
  // Detect: 'pay::<clientId>::<YYYY-MM>' has 3 segments; new shapes have 4.
  function isLegacyBasePaymentId(id) {
    if (!id) return false;
    var parts = String(id).split('::');
    if (parts.length !== 3) return false;
    if (parts[0] !== 'pay') return false;
    return /^\d{4}-\d{2}$/.test(parts[2]);
  }
  // Inspect an existing payment id to classify it.
  function paymentKindFromId(id) {
    var s = String(id || '');
    var m = s.match(/::chg-([^:]+)::/);
    if (m) return { kind: 'extra', chargeId: m[1] };
    return { kind: 'base' };
  }

  function findPaymentById(id) {
    for (var i = 0; i < state.payments.length; i++) {
      if (state.payments[i].id === id) return state.payments[i];
    }
    return null;
  }
  function paymentForClientOn(client, dueDateISO) {
    // Look up base monthly under either the new or legacy shape. The legacy
    // row keeps its legacy id forever; new patients/months get the new id.
    var newId = paymentId(client, dueDateISO, 'base');
    var existing = findPaymentById(newId);
    if (existing) return existing;
    var legacyId = legacyBasePaymentId(client.id, dueDateISO);
    existing = findPaymentById(legacyId);
    if (existing) return existing;
    return {
      id: newId, clientId: client.id, clientName: client.name,
      billingType: 'monthly', dueDate: dueDateISO,
      amountDue: clientAmountDue(client), amountPaid: 0,
      status: 'unpaid', paymentDate: '', method: '', notes: '',
      bundleSize: 0, sessionsUsed: 0
    };
  }
  function paymentForExtraOn(client, charge, dueDateISO) {
    var id = paymentId(client, dueDateISO, 'extra', charge.id);
    var existing = findPaymentById(id);
    if (existing) return existing;
    return {
      id: id, clientId: client.id, clientName: client.name,
      billingType: charge.billingType === 'one_time' ? 'one_time' : 'monthly',
      dueDate: dueDateISO,
      amountDue: toNum(charge.amount), amountPaid: 0,
      status: 'unpaid', paymentDate: '', method: '',
      notes: charge.description || '',
      bundleSize: 0, sessionsUsed: 0
    };
  }
  // Display-only status for a charge on the client card. Mirrors the pure
  // chargeStatusFor in public/charges-logic.js — keep both in sync.
  //   one_time -> ::once payment row.
  //   monthly  -> CURRENT month's payment row (older months show up in
  //               גבייה's יתרות פתוחות, not on the card).
  function chargeStatusFor(client, charge) {
    if (!client || !charge) return 'unpaid';
    var id = paymentId(client, today(), 'extra', charge.id);
    var found = findPaymentById(id);
    if (!found) return 'unpaid';
    if (found.status === 'paid') return 'paid';
    if (found.status === 'partial') return 'partial';
    return 'unpaid';
  }

  // --- rendering ---------------------------------------------------------
  function setView(view) {
    state.view = view;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    render();
  }

  function render() {
    if (state.view === 'dashboard') renderDashboard();
    else if (state.view === 'leads') renderLeads();
    else if (state.view === 'clients') renderClients();
    else if (state.view === 'billing') renderBilling();
    else if (state.view === 'retention') renderRetention();
    else if (state.view === 'payouts') renderPayouts();
  }

  // ---- Dashboard
  function renderDashboard() {
    var activeClients = state.clients.filter(function (c) { return c.status !== 'סיים טיפול'; });
    $('#kpiActive').textContent = activeClients.filter(function(c){return c.status==='פעיל';}).length;
    var totalRev = activeClients.filter(function (c) { return c.status === 'פעיל'; })
      .reduce(function (s, c) { return s + monthlyRevenue(c); }, 0);
    $('#kpiRevenue').textContent = money(totalRev);
    var openLeads = state.leads.filter(function (l) { return l.stage !== 'not_relevant' && l.stage !== 'active'; }).length;
    $('#kpiLeads').textContent = openLeads;
    var activeOnly = activeClients.filter(function (c) { return c.status === 'פעיל'; });

    var byService = {};
    SERVICE_TYPES.forEach(function (s) { byService[s] = 0; });
    activeOnly.forEach(function (c) {
      parseServices(c.serviceType).forEach(function (s) {
        if (byService[s] === undefined) byService[s] = 0;
        byService[s]++;
      });
    });
    renderBars('#byService', byService);

    var byLoc = {};
    LOCATIONS.forEach(function (l) { byLoc[l] = 0; });
    activeOnly.forEach(function (c) {
      var loc = c.location;
      if (!loc) return;
      if (byLoc[loc] === undefined) byLoc[loc] = 0;
      byLoc[loc]++;
    });
    renderBars('#byLocation', byLoc);

    var pipeline = $('#pipeline');
    pipeline.innerHTML = '';
    STAGES.forEach(function (s) {
      var n = state.leads.filter(function (l) { return l.stage === s.id; }).length;
      var div = document.createElement('div');
      div.className = 'pc';
      div.innerHTML = '<div class="n">' + n + '</div><div class="l">' + s.he + '</div>';
      pipeline.appendChild(div);
    });

    renderCreditAlerts(activeOnly);
    renderRenewalAlerts(activeOnly);
    renderStopFlags();
    renderExtraRequests();
  }

  // Credit alert: active patients who owe a make-up session (creditsOwed > 0),
  // so Vered knows a make-up is owed. Display-only — the balance is
  // server-managed (recordSessionOutcome); the dashboard never writes it.
  // Inline mirror of VeredAlerts.creditAlerts in public/vered-alerts.js — keep
  // both in sync (the browser has no build step to import the module).
  function renderCreditAlerts(activeClients) {
    var box = $('#creditAlerts');
    if (!box) return;
    var owing = (activeClients || [])
      .filter(function (c) { return (toNum(c.creditsOwed) || 0) > 0; })
      .sort(function (a, b) { return (toNum(b.creditsOwed) || 0) - (toNum(a.creditsOwed) || 0); });
    if (!owing.length) {
      box.innerHTML = '<div class="renewals-empty">✅ אין מטופלים עם קרדיט מפגשים פתוח</div>';
      return;
    }
    var rows = owing.map(function (c) {
      var credits = toNum(c.creditsOwed) || 0;
      var unit = credits === 1 ? 'מפגש' : 'מפגשים';
      return '<div class="renewal-row renewal-warn" data-client-id="' + escapeHtml(c.id) + '">' +
        '<div class="renewal-main">' +
          '<div class="renewal-name">' + escapeHtml(c.name) + '</div>' +
        '</div>' +
        '<div class="renewal-meta">' +
          '<span class="chip chip-amount">קרדיט: ' + credits + ' ' + unit + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    box.innerHTML = '<div class="renewals-section renewals-warn">' +
      '<div class="renewals-section-title">🎟️ קרדיט מפגשים — יש להשלים מפגש</div>' +
      rows +
    '</div>';
  }

  // Resolve a pending flag to a client at RENDER time, so flags already written
  // with an empty clientId (the server write-time match needs a persisted phone
  // + exact name) still resolve in the dashboard. Order: an explicit clientId
  // wins; else the reported phone vs ANY of the client's phone fields
  // (treatmentContactPhone / payerPhone / patient phone) — a phone match alone
  // is enough; else a unique exact-name match. Name is only a soft tiebreaker,
  // never a hard gate. Returns { client, ambiguous }.
  function clientPhoneMatches(c, key) {
    if (!c || !key) return false;
    return [c.treatmentContactPhone, c.payerPhone, c.phone].some(function (p) {
      return recoverPhone(p) === key;
    });
  }
  function resolveStopFlagClient(flag) {
    if (flag && flag.clientId) {
      var byId = state.clients.find(function (c) { return c.id === flag.clientId; });
      if (byId) return { client: byId, ambiguous: false, candidates: [byId] };
    }
    var key = recoverPhone(flag && flag.phone);
    var byPhone = key ? state.clients.filter(function (c) { return clientPhoneMatches(c, key); }) : [];
    if (byPhone.length === 1) return { client: byPhone[0], ambiguous: false, candidates: byPhone };
    var nameQ = ((flag && flag.name) || '').trim().toLowerCase();
    if (byPhone.length > 1) {
      var narrowed = nameQ ? byPhone.filter(function (c) { return (c.name || '').trim().toLowerCase() === nameQ; }) : [];
      if (narrowed.length === 1) return { client: narrowed[0], ambiguous: false, candidates: byPhone };
      return { client: null, ambiguous: true, candidates: byPhone };
    }
    if (nameQ) {
      var byName = state.clients.filter(function (c) { return (c.name || '').trim().toLowerCase() === nameQ; });
      if (byName.length === 1) return { client: byName[0], ambiguous: false, candidates: byName };
      if (byName.length > 1) return { client: null, ambiguous: true, candidates: byName };
    }
    return { client: null, ambiguous: false, candidates: [] };
  }

  // Pending stop-treatment flags from the therapists app, awaiting Vered's
  // confirmation. Surfaced only — discharge stays a manual action.
  function renderStopFlags() {
    var box = $('#stopFlagsAlerts');
    if (!box) return;
    var pending = (state.stopFlags || []).filter(function (f) { return f.status === 'pending'; });
    if (!pending.length) {
      box.innerHTML = '<div class="renewals-empty">✅ אין בקשות הפסקה ממתינות</div>';
      return;
    }
    box.innerHTML = pending.map(function (f) {
      var res = resolveStopFlagClient(f);
      var client = res.client;
      var who = client ? client.name : (f.name || '— ללא שם —');
      var phoneChip = '<span class="chip">' + escapeHtml(f.phone || '—') + '</span>';
      var reportedChips =
        (f.reportedBy ? '<span class="chip">דווח ע״י: ' + escapeHtml(f.reportedBy) + '</span>' : '') +
        (f.reportedAt ? '<span class="chip">' + escapeHtml(displayDate(f.reportedAt)) + '</span>' : '');
      var noteHtml = f.note ? '<div class="renewal-note">' + escapeHtml(f.note) + '</div>' : '';
      var action;
      if (client) {
        action = '<button class="btn btn-wa-stop" data-action="open-exit" data-flag-id="' + escapeHtml(f.id) + '">סיים טיפול</button>';
      } else if (res.ambiguous) {
        // Real manual-pick control: one button per candidate client. Picking sets
        // the flag's clientId and opens the exit modal, reusing the discharge +
        // resolve path so the flag clears on discharge.
        action = '<div class="stopflag-pick"><span class="stopflag-pick-label">התאמה מרובה — בחר מטופל:</span>' +
          res.candidates.map(function (c) {
            var bits = [c.name || 'ללא שם'];
            if (c.status) bits.push(c.status);
            if (c.phone) bits.push(c.phone);
            return '<button class="btn btn-wa-stop" data-action="pick-client" data-flag-id="' +
              escapeHtml(f.id) + '" data-client-id="' + escapeHtml(c.id) + '">' +
              escapeHtml(bits.join(' · ')) + '</button>';
          }).join('') +
        '</div>';
      } else {
        action = '<span class="chip chip-amount">לא נמצא מטופל תואם</span>';
      }
      // Dismiss/remove control on EVERY row — the only action for an orphaned
      // flag ("לא נמצא מטופל תואם", e.g. a test phone with no client), and a
      // "this was a mistake" escape on matched rows. Resolves the flag by id
      // (existing internal resolveStopFlag) WITHOUT discharging; editor-only.
      var dismiss = '<button class="btn btn-danger edit-only" data-action="dismiss-flag" ' +
        'data-flag-id="' + escapeHtml(f.id) + '" title="הסר את בקשת ההפסקה מהרשימה (ללא סיום טיפול)">מחק</button>';
      return '<div class="renewal-row renewal-stop" data-flag-id="' + escapeHtml(f.id) + '">' +
        '<div class="renewal-main">' +
          '<div class="renewal-name">' + escapeHtml(who) + '</div>' +
          phoneChip + reportedChips +
        '</div>' +
        noteHtml +
        '<div class="renewal-actions">' + action + dismiss + '</div>' +
      '</div>';
    }).join('');
  }

  // ===== Over-package extra-session requests (Vered approval) =====
  // The therapists app posts a request when Yarden books beyond a patient's
  // monthly package. Vered sees pending ones here and approves; approving stamps
  // approvedBy/At server-side. Mirrors the stop-flags panel.
  function renderExtraRequests() {
    var box = $('#extraRequestsAlerts');
    if (!box) return;
    var pending = (state.extraRequests || []).filter(function (r) { return String(r.status) === 'pending'; });
    if (!pending.length) {
      box.innerHTML = '<div class="renewals-empty">✅ אין בקשות לטיפול נוסף הממתינות לאישור</div>';
      return;
    }
    box.innerHTML = pending.map(function (r) {
      var who = r.patientName || '— ללא שם —';
      var chips =
        '<span class="chip">' + escapeHtml(r.phone || '—') + '</span>' +
        (r.treatmentType ? '<span class="chip chip-next">' + escapeHtml(displayServiceTypeSafe(r.treatmentType)) + '</span>' : '') +
        (r.therapist ? '<span class="chip">מטפל: ' + escapeHtml(r.therapist) + '</span>' : '') +
        ((r.quota || r.used) ? '<span class="chip chip-amount">נוצלו ' + (r.used || 0) + ' מתוך ' + (r.quota || 0) + '</span>' : '') +
        (r.monthKey ? '<span class="chip">' + escapeHtml(r.monthKey) + '</span>' : '');
      var noteHtml = r.note ? '<div class="renewal-note">' + escapeHtml(r.note) + '</div>' : '';
      var approve = '<button class="btn btn-primary edit-only" data-action="approve-extra" ' +
        'data-extra-id="' + escapeHtml(r.id) + '">אשר טיפול נוסף</button>';
      return '<div class="renewal-row renewal-warn" data-extra-id="' + escapeHtml(r.id) + '">' +
        '<div class="renewal-main">' +
          '<div class="renewal-name">' + escapeHtml(who) + '</div>' + chips +
        '</div>' + noteHtml +
        '<div class="renewal-actions">' + approve + '</div>' +
      '</div>';
    }).join('');
  }

  // Safe label for a treatment type on Vered's side (outpatient has no Hebrew
  // relabel map for therapists' types; show the raw value, just escaped).
  function displayServiceTypeSafe(v) { return String(v == null ? '' : v); }

  function handleExtraRequestClick(e) {
    var btn = e.target.closest('[data-action="approve-extra"]');
    if (!btn) return;
    if (state.role !== 'editor') return;
    var id = btn.getAttribute('data-extra-id');
    var req = (state.extraRequests || []).find(function (r) { return r.id === id; });
    if (!req) { toast('הבקשה לא נמצאה', true); return; }
    if (!confirm('לאשר טיפול נוסף עבור ' + (req.patientName || req.phone || '') + ' מעבר לחבילה החודשית?')) return;
    var prev = { status: req.status, approvedBy: req.approvedBy, approvedAt: req.approvedAt };
    req.status = 'approved';
    req.approvedBy = 'Vered';
    req.approvedAt = new Date().toISOString();
    renderExtraRequests();
    apiApproveExtra(id, 'Vered')
      .then(function () { toast('הטיפול הנוסף אושר'); })
      .catch(function (err) {
        req.status = prev.status; req.approvedBy = prev.approvedBy; req.approvedAt = prev.approvedAt;
        renderExtraRequests();
        toast('האישור לא נשמר: ' + err.message, true);
      });
  }


  // Delegated click handler for the pending stop-flags panel. Handles both the
  // single-match "סיים טיפול" button and the ambiguous-case candidate picker.
  function handleStopFlagClick(e) {
    var dismissBtn = e.target.closest('[data-action="dismiss-flag"]');
    if (dismissBtn) { dismissStopFlag(dismissBtn.getAttribute('data-flag-id')); return; }
    var btn = e.target.closest('[data-action="open-exit"], [data-action="pick-client"]');
    if (!btn) return;
    var flagId = btn.getAttribute('data-flag-id');
    var flag = (state.stopFlags || []).find(function (f) { return f.id === flagId; });
    if (!flag) { toast('לא נמצא מטופל תואם', true); return; }
    var client;
    if (btn.getAttribute('data-action') === 'pick-client') {
      var cid = btn.getAttribute('data-client-id');
      client = state.clients.find(function (c) { return c.id === cid; });
    } else {
      client = resolveStopFlagClient(flag).client;
    }
    if (!client) { toast('לא נמצא מטופל תואם', true); return; }
    // Align the flag to the chosen/resolved client so the post-discharge cleanup
    // (resolveStopFlagsForClient, matched by clientId) clears this flag — this is
    // what fixes the ambiguous-flag dead-end where clientId was never set.
    flag.clientId = client.id;
    openExitModal(client);
  }

  // Remove a single stop-flag from the panel WITHOUT discharging — Vered's
  // dismiss for a false report or an orphaned flag (no matching client, e.g. a
  // test phone). Resolves by id via the existing internal resolveStopFlag, which
  // works for orphaned flags too (they have an id, just no clientId). After a
  // confirm, the flag is marked resolved locally so the pending filter drops the
  // row immediately; a failed write is rolled back and re-rendered.
  function dismissStopFlag(flagId) {
    if (state.role !== 'editor') return;
    var flag = (state.stopFlags || []).find(function (f) { return f.id === flagId; });
    if (!flag) { toast('בקשת ההפסקה לא נמצאה', true); return; }
    var who = flag.name || flag.phone || '';
    if (!confirm('להסיר את בקשת ההפסקה' + (who ? ' של ' + who : '') + ' מהרשימה?\n' +
                 'הפעולה אינה מסמנת סיום טיפול — רק מסירה את ההתראה.')) return;
    var prev = { status: flag.status, resolvedBy: flag.resolvedBy, resolvedAt: flag.resolvedAt };
    flag.status = 'resolved';
    flag.resolvedBy = 'Vered';
    flag.resolvedAt = new Date().toISOString();
    renderStopFlags();
    apiPostAction('resolveStopFlag', { id: flag.id, resolvedBy: 'Vered' })
      .then(function () { toast('בקשת ההפסקה הוסרה'); })
      .catch(function (err) {
        flag.status = prev.status;
        flag.resolvedBy = prev.resolvedBy;
        flag.resolvedAt = prev.resolvedAt;
        renderStopFlags();
        toast('שגיאה: ' + err.message, true);
      });
  }

  // Mark every pending stop-flag for a client resolved (called after discharge).
  // Best-effort: failures are logged, never block the discharge that succeeded.
  function resolveStopFlagsForClient(clientId) {
    var pending = (state.stopFlags || []).filter(function (f) {
      return f.clientId === clientId && f.status === 'pending';
    });
    return Promise.all(pending.map(function (f) {
      return apiPostAction('resolveStopFlag', { id: f.id, resolvedBy: 'Vered' })
        .then(function () {
          f.status = 'resolved';
          f.resolvedBy = 'Vered';
          f.resolvedAt = new Date().toISOString();
        })
        .catch(function (err) { console.warn('[ezone] resolveStopFlag failed', f.id, err.message); });
    }));
  }

  // ---- WhatsApp helpers
  // --- phone handling -----------------------------------------------------
  // Canonical STORE/compare form is leading-zero, no separators (0501234567).
  // wa.me needs the 972 form — produced only at link-build time via phoneToWa.
  function phoneDigits(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\s\-\(\)]/g, '');
    if (s.indexOf('+') === 0) s = s.slice(1);
    if (s.indexOf('00') === 0) s = s.slice(2);
    return s.replace(/\D/g, '');
  }
  // Entry normalization: strip separators; +972 / 972 / 00972 -> leading 0.
  // Does NOT invent a missing leading zero (that is a Sheets-recovery concern).
  function normalizePhone(raw) {
    var s = phoneDigits(raw);
    if (!s) return '';
    if (s.indexOf('972') === 0) s = '0' + s.slice(3);
    return s;
  }
  // Read-side recovery: like normalize, plus restore a leading zero that Google
  // Sheets dropped by coercing a numeric-looking phone to a number. Idempotent.
  function recoverPhone(raw) {
    var s = normalizePhone(raw);
    if (s && s.charAt(0) !== '0') s = '0' + s;
    return s;
  }
  // Patient's primary phone for display/edit: the populated `phone` column,
  // falling back to the legacy (usually-empty for active clients)
  // treatmentContactPhone. Leading-zero recovery is applied so a Sheets-coerced
  // 9-digit number still shows the full 10-digit canonical form.
  function clientPhone(c) {
    return recoverPhone(c && c.phone) || recoverPhone(c && c.treatmentContactPhone);
  }
  // Mobile / cross-app matching keys: exactly 10 digits, leading zero.
  function isValidMobile(p) { return /^0\d{9}$/.test(p); }
  // payerPhone only: also allow a 9-digit Israeli landline (031234567).
  function isValidPayerPhone(p) { return /^0\d{8,9}$/.test(p); }
  // wa.me link form: canonical leading-zero -> 972 international.
  function phoneToWa(phone) {
    var p = normalizePhone(phone);
    return p ? '972' + p.slice(1) : '';
  }
  // Entry guard: normalize then validate. Returns the canonical value on
  // success ('' when empty and not required), or false (after a Hebrew toast)
  // when the value is non-empty-invalid or required-but-empty.
  function acceptPhone(raw, label, mode, required) {
    var norm = normalizePhone(raw);
    if (!norm) {
      if (required) { toast('יש להזין ' + label, true); return false; }
      return '';
    }
    var ok = mode === 'payer' ? isValidPayerPhone(norm) : isValidMobile(norm);
    if (!ok) {
      toast(label + ' לא תקין — ' + (mode === 'payer'
        ? 'יש להזין מספר טלפון ישראלי תקין עם אפס בהתחלה (לדוגמה 0501234567 או 031234567)'
        : 'יש להזין מספר נייד תקין בן 10 ספרות עם אפס בהתחלה (לדוגמה 0501234567)'), true);
      return false;
    }
    return norm;
  }

  // --- duplicate-client prevention --------------------------------------
  // Patient-IDENTITY phones: the patient's own number and the treatment-contact
  // phone. payerPhone is deliberately EXCLUDED — a payer (parent / institution)
  // is legitimately shared across siblings, so a hard block on it would reject
  // real patients. Identity uniqueness is what stops the same person being
  // entered twice (the ליעם בריאר / נועם duplicates).
  function clientIdentityPhones(c) {
    if (!c) return [];
    return [c.phone, c.treatmentContactPhone].map(recoverPhone).filter(function (p) { return !!p; });
  }
  function findClientByPhone(rawPhone, exceptId) {
    var key = recoverPhone(rawPhone);
    if (!key) return null;
    return state.clients.find(function (c) {
      if (!c || c.id === exceptId) return false;
      return clientIdentityPhones(c).indexOf(key) !== -1;
    }) || null;
  }
  // Hard block: if another client already owns this identity phone, toast a
  // Hebrew message naming them and return true (caller aborts the save).
  function duplicateClientBlock(rawPhone, exceptId) {
    var dup = findClientByPhone(rawPhone, exceptId);
    if (!dup) return false;
    toast('מטופל עם מספר טלפון זה כבר קיים: «' + (dup.name || 'ללא שם') + '». לא ניתן ליצור כפילות.', true);
    return true;
  }

  // Read-only diagnostic: group clients by canonical identity phone and return
  // groups with more than one client row, each row annotated with how many
  // Payments and ClientCharges rows reference it (clientId). Used to surface
  // duplicate patients (ליעם / נועם) before any manual merge — NO writes.
  function duplicateClientReport(clients, payments, charges) {
    var byKey = {};
    (clients || []).forEach(function (c) {
      if (!c) return;
      var keys = {};
      [c.phone, c.treatmentContactPhone].forEach(function (p) {
        var k = recoverPhone(p);
        if (k) keys[k] = true;
      });
      Object.keys(keys).forEach(function (k) { (byKey[k] = byKey[k] || []).push(c); });
    });
    function refCount(rows, id) {
      var n = 0;
      (rows || []).forEach(function (r) { if (r && String(r.clientId) === String(id)) n++; });
      return n;
    }
    var out = [];
    Object.keys(byKey).forEach(function (k) {
      var rows = byKey[k];
      if (rows.length < 2) return;
      out.push({
        phone: k,
        rows: rows.map(function (c) {
          return {
            id: c.id, name: c.name || '', status: c.status || '', phone: k,
            payments: refCount(payments, c.id), charges: refCount(charges, c.id)
          };
        })
      });
    });
    return out;
  }

  // Default survivor for a group = the (first) active row, else the first row.
  function defaultSurvivorId(group) {
    var active = (group.rows || []).find(function (r) { return r.status === 'פעיל'; });
    return active ? active.id : (group.rows[0] && group.rows[0].id);
  }

  var dupReportGroups = []; // stashed for the merge handler (index = data-group)
  function renderDuplicateReport() {
    var box = $('#duplicateClientsReport');
    if (!box) return;
    dupReportGroups = duplicateClientReport(state.clients, state.payments, state.charges);
    var groups = dupReportGroups;
    if (!groups.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var editor = state.role === 'editor';
    var totalRows = groups.reduce(function (s, g) { return s + g.rows.length; }, 0);
    box.innerHTML =
      '<div class="dupreport-head">⚠️ מטופלים כפולים לפי טלפון (' + groups.length +
        ' מספרים, ' + totalRows + ' רשומות)' + (editor ? '' : ' — לעיון בלבד') + '</div>' +
      groups.map(function (g, gi) {
        var surv = defaultSurvivorId(g);
        return '<div class="dupreport-group">' +
          '<div class="dupreport-phone">' + escapeHtml(g.phone) + '</div>' +
          g.rows.map(function (r) {
            var radio = editor
              ? '<label class="dupreport-keep"><input type="radio" name="dupsurv-' + gi + '" value="' +
                  escapeHtml(String(r.id)) + '"' + (r.id === surv ? ' checked' : '') + '> שמור</label>'
              : '';
            return '<div class="dupreport-row">' + radio +
              '<span class="dupreport-name">' + escapeHtml(r.name || 'ללא שם') + '</span>' +
              '<span class="chip">' + escapeHtml(r.status || '—') + '</span>' +
              '<span class="chip">id: ' + escapeHtml(String(r.id)) + '</span>' +
              '<span class="chip">תשלומים: ' + r.payments + '</span>' +
              '<span class="chip">חיובים: ' + r.charges + '</span>' +
            '</div>';
          }).join('') +
          (editor
            ? '<div class="dupreport-actions"><button class="btn btn-danger" data-action="merge-group" data-group="' +
                gi + '">מזג למטופל שנשמר</button></div>'
            : '') +
        '</div>';
      }).join('');
  }

  // Delegated click on the duplicate report → open the merge confirm modal.
  function handleDuplicateReportClick(e) {
    var btn = e.target.closest('[data-action="merge-group"]');
    if (!btn) return;
    if (state.role !== 'editor') return;
    var gi = parseInt(btn.getAttribute('data-group'), 10);
    var group = dupReportGroups[gi];
    if (!group) return;
    var picked = $('input[name="dupsurv-' + gi + '"]:checked', $('#duplicateClientsReport'));
    var survivorId = picked ? picked.value : defaultSurvivorId(group);
    openMergeClientsModal(group, survivorId);
  }

  var pendingMerge = null;
  function openMergeClientsModal(group, survivorId) {
    var survivor = group.rows.find(function (r) { return String(r.id) === String(survivorId); });
    if (!survivor) { toast('בחר מטופל לשמירה', true); return; }
    var dups = group.rows.filter(function (r) { return String(r.id) !== String(survivorId); });
    if (!dups.length) { toast('אין כפילויות למיזוג', true); return; }
    var movePay = dups.reduce(function (s, r) { return s + r.payments; }, 0);
    var moveChg = dups.reduce(function (s, r) { return s + r.charges; }, 0);
    pendingMerge = { survivorId: String(survivorId), dupIds: dups.map(function (r) { return String(r.id); }) };

    var body = $('#mergeClientsBody');
    if (body) {
      body.innerHTML =
        '<p>לשמור את: <strong>' + escapeHtml(survivor.name || 'ללא שם') + '</strong> ' +
          '(' + escapeHtml(survivor.status || '—') + ', id ' + escapeHtml(String(survivor.id)) + ')</p>' +
        '<p>למחוק ' + dups.length + ' רשומות כפולות: ' +
          escapeHtml(dups.map(function (r) { return r.name + ' (' + (r.status || '—') + ')'; }).join(', ')) + '</p>' +
        '<p>' + movePay + ' תשלומים ו-' + moveChg + ' חיובים יועברו למטופל שנשמר לפני המחיקה.</p>' +
        '<p class="merge-warn">פעולה זו אינה הפיכה.</p>';
    }
    var m = $('#mergeClientsModal');
    if (m) m.hidden = false;
  }
  function closeMergeClientsModal() {
    var m = $('#mergeClientsModal');
    if (m) m.hidden = true;
    pendingMerge = null;
  }
  function performMergeClients() {
    if (!pendingMerge) return;
    var req = pendingMerge;
    var btn = $('#mergeClientsConfirm');
    if (btn) btn.disabled = true;
    apiPostAction('mergeClients', { survivorId: req.survivorId, dupIds: req.dupIds })
      .then(function (res) {
        closeMergeClientsModal();
        var moved = res && res.repointed ? res.repointed : { payments: 0, charges: 0 };
        return loadAll().then(function () {
          toast('מוזג: הוסרו ' + req.dupIds.length + ' כפילויות, הועברו ' +
            moved.payments + ' תשלומים ו-' + moved.charges + ' חיובים');
        });
      })
      .catch(function (err) { toast('שגיאה במיזוג: ' + err.message, true); })
      .finally(function () { if (btn) btn.disabled = false; });
  }

  function bankDetailsLine() {
    var s = state.settings || {};
    var parts = [];
    if (s.bankName) parts.push('בנק ' + s.bankName);
    if (s.bankBranch) parts.push('סניף ' + s.bankBranch);
    if (s.bankAccount) parts.push('חשבון ' + s.bankAccount);
    if (s.bankHolder) parts.push('ע"ש ' + s.bankHolder);
    return parts.join(', ');
  }

  function buildPayerRenewalMsg(c, info) {
    var amt = money(c.pricePerSession);
    var renew = info && info.renewalDate ? displayDate(info.renewalDate) : '';
    var bank = bankDetailsLine();
    var link = c.paymentLink ? ' או דרך לינק התשלום: ' + c.paymentLink : '';
    var bankPart = bank ? ' דרך העברה לחשבון הבנק שלנו: ' + bank : '';
    return 'שלום ' + (c.payerName || '') + ', החבילה החודשית של ' + c.name +
      ' עומדת להסתיים בתאריך ' + renew + '. על מנת לא לפגוע ברצף הטיפול של ' + c.name +
      ' יש להסדיר את התשלום בסך ' + amt + bankPart + link + '. תודה, צוות E-ZONE איזון';
  }

  function buildPayerOverdueMsg(c) {
    var amt = money(c.pricePerSession);
    var bank = bankDetailsLine();
    var link = c.paymentLink ? ' או דרך לינק התשלום: ' + c.paymentLink : '';
    var bankPart = bank ? ' דרך העברה לחשבון הבנק שלנו: ' + bank : '';
    return 'שלום ' + (c.payerName || '') + ', התשלום החודשי של ' + c.name +
      ' בסך ' + amt + ' טרם התקבל. על מנת לא לפגוע ברצף הטיפול של ' + c.name +
      ' יש להסדיר את התשלום בהקדם' + bankPart + link + '. תודה, צוות E-ZONE איזון';
  }

  function buildStopTreatmentMsg(c) {
    return 'שלום, המטופל ' + c.name +
      ' טרם הסדיר את התשלום החודשי. נא לא להעניק טיפול עד הסדרת התשלום מול ההנהלה. בתודה, צוות E-ZONE איזון';
  }

  function openWhatsApp(phone, message) {
    var p = phoneToWa(phone);
    if (!p) { toast('חסר מספר טלפון', true); return; }
    var url = 'https://wa.me/' + p + '?text=' + encodeURIComponent(message);
    window.open(url, '_blank');
  }

  function renderRenewalAlerts(activeClients) {
    var box = $('#renewalsAlerts');
    if (!box) return;
    var overdue = [];
    var dueSoon = [];
    activeClients.forEach(function (c) {
      var info = renewalInfo(c);
      if (info.status === 'overdue') overdue.push({ client: c, info: info });
      else if (info.status === 'due_soon') dueSoon.push({ client: c, info: info });
    });
    // Sort: most urgent first
    overdue.sort(function (a, b) { return (a.info.daysLeft || 0) - (b.info.daysLeft || 0); });
    dueSoon.sort(function (a, b) { return (a.info.daysLeft || 0) - (b.info.daysLeft || 0); });

    if (!overdue.length && !dueSoon.length) {
      box.innerHTML = '<div class="renewals-empty">✅ אין חידושים דחופים ואין עצירות טיפול</div>';
      return;
    }

    var html = '';
    if (overdue.length) {
      html += '<div class="renewals-section renewals-stop">' +
        '<div class="renewals-section-title">🛑 עצור טיפול — לא שולם</div>';
      overdue.forEach(function (item) {
        html += renderRenewalRow(item.client, item.info, 'stop');
      });
      html += '</div>';
    }
    if (dueSoon.length) {
      html += '<div class="renewals-section renewals-warn">' +
        '<div class="renewals-section-title">⏰ חידושים השבוע — לגבות לפני</div>';
      dueSoon.forEach(function (item) {
        html += renderRenewalRow(item.client, item.info, 'warn');
      });
      html += '</div>';
    }
    box.innerHTML = html;
  }

  function renderRenewalRow(c, info, kind) {
    var daysText;
    if (kind === 'stop') {
      if (info.daysLeft === null || info.daysLeft === undefined) {
        daysText = 'תשלום לא שולם';
      } else if (info.daysLeft < 0) {
        daysText = 'באיחור של ' + Math.abs(info.daysLeft) + ' ימים';
      } else {
        daysText = 'תשלום לא שולם לחודש הנוכחי';
      }
    } else {
      daysText = info.daysLeft === 0 ? 'היום!'
               : info.daysLeft === 1 ? 'מחר'
               : 'בעוד ' + info.daysLeft + ' ימים';
    }
    return '<div class="renewal-row renewal-' + kind + '" data-client-id="' + escapeHtml(c.id) + '">' +
      '<div class="renewal-main">' +
        '<div class="renewal-name">' + escapeHtml(c.name) + '</div>' +
        '<span class="chip">משלם: ' + escapeHtml(c.payerName || '— לא הוגדר —') + '</span>' +
      '</div>' +
      '<div class="renewal-meta">' +
        '<span class="renewal-date">' + (info.renewalDate ? displayDate(info.renewalDate) : '') + '</span>' +
        '<span class="renewal-days">' + daysText + '</span>' +
        '<span class="chip chip-amount">' + money(c.pricePerSession) + '</span>' +
      '</div>' +
      '<div class="renewal-actions">' +
        (kind === 'stop'
          ? '<button class="btn btn-wa" data-action="wa-payer-overdue">💬 בקשת תשלום למשלם</button>' +
            '<button class="btn btn-wa-stop" data-action="wa-stop">🛑 הודעת עצירת טיפול</button>'
          : '<button class="btn btn-wa" data-action="wa-payer-renewal">💬 בקשת חידוש למשלם</button>'
        ) +
      '</div>' +
    '</div>';
  }

  // Delegated click handler for renewal action buttons
  function handleRenewalActionClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var row = btn.closest('[data-client-id]');
    if (!row) return;
    var cid = row.getAttribute('data-client-id');
    var c = state.clients.find(function (x) { return x.id === cid; });
    if (!c) { toast('מטופל לא נמצא', true); return; }
    var info = renewalInfo(c);
    var action = btn.getAttribute('data-action');
    if (action === 'wa-payer-renewal') {
      if (!c.payerPhone) { toast('חסר טלפון של גורם משלם — ערוך מטופל', true); return; }
      openWhatsApp(c.payerPhone, buildPayerRenewalMsg(c, info));
    } else if (action === 'wa-payer-overdue') {
      if (!c.payerPhone) { toast('חסר טלפון של גורם משלם — ערוך מטופל', true); return; }
      openWhatsApp(c.payerPhone, buildPayerOverdueMsg(c));
    } else if (action === 'wa-stop') {
      if (!c.treatmentContactPhone) { toast('חסר טלפון של אחראי טיפול — ערוך מטופל', true); return; }
      openWhatsApp(c.treatmentContactPhone, buildStopTreatmentMsg(c));
    }
  }

  function lastDayOfMonth(dateISO) {
    var parts = String(dateISO).slice(0, 10).split('-');
    if (parts.length < 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!isFinite(y) || !isFinite(m)) return null;
    return new Date(y, m, 0).getDate();
  }

  // ISO date of the CURRENT month's base billing day for a client, matching the
  // day clientsDueOn() uses (c.billingDay, else the start-date day-of-month),
  // clamped to the last day of the month. Falls back to today() when neither is
  // known. The payment id keys only on the month, but we keep the day aligned so
  // the row matches what the גבייה tab renders for the same client.
  function currentMonthBaseDueDate(c) {
    var t = today();
    var bd = c.billingDay ? toNum(c.billingDay) : dayOfMonth(c.startDate);
    if (!bd) return t;
    var last = lastDayOfMonth(t);
    var eff = (last && bd > last) ? last : bd;
    return t.slice(0, 7) + '-' + String(eff).padStart(2, '0');
  }

  // ---- Billing
  // Returns an array of due items for the selected date:
  //   { client, kind: 'base'|'extra', charge?, dueDate, amount }
  function clientsDueOn(dateISO) {
    var d = dayOfMonth(dateISO);
    var last = lastDayOfMonth(dateISO);
    var selectedMonthKey = monthKey(dateISO);
    var out = [];
    state.clients.forEach(function (c) {
      if (c.status === 'סיים טיפול') return;
      // Base monthly
      var bd = c.billingDay ? toNum(c.billingDay) : dayOfMonth(c.startDate);
      if (bd) {
        var effective = (last && bd > last) ? last : bd;
        if (effective === d) {
          out.push({ client: c, kind: 'base', dueDate: dateISO, amount: clientAmountDue(c) });
        }
      }
      // Extra charges
      state.charges.forEach(function (charge) {
        if (charge.clientId !== c.id) return;
        if (charge.active === false) return;
        if (charge.billingType === 'monthly') {
          var day = charge.billingDay ? toNum(charge.billingDay) : dayOfMonth(charge.chargeDate);
          if (!day) return;
          var eff = (last && day > last) ? last : day;
          if (eff !== d) return;
          if (selectedMonthKey < monthKey(charge.chargeDate)) return;
          out.push({ client: c, kind: 'extra', charge: charge, dueDate: dateISO, amount: toNum(charge.amount) });
        } else if (charge.billingType === 'one_time') {
          if (charge.chargeDate === dateISO) {
            out.push({ client: c, kind: 'extra', charge: charge, dueDate: dateISO, amount: toNum(charge.amount) });
          }
        }
      });
    });
    return out;
  }

  function renderBilling() {
    if (!state.billingDate) state.billingDate = today();
    var dateInput = $('#billingDate');
    if (dateInput && dateInput.value !== state.billingDate) dateInput.value = state.billingDate;
    var selected = state.billingDate;
    var q = state.billingSearch.trim().toLowerCase();
    var due = clientsDueOn(selected)
      .filter(function (item) { return !q || (item.client.name || '').toLowerCase().indexOf(q) !== -1; })
      .map(function (item) {
        var payment = item.kind === 'extra'
          ? paymentForExtraOn(item.client, item.charge, selected)
          : paymentForClientOn(item.client, selected);
        return { client: item.client, kind: item.kind, charge: item.charge || null, payment: payment };
      });
    var totalDue = due.reduce(function (s, d) { return s + (d.payment.amountDue || 0); }, 0);
    var totalCollected = due.reduce(function (s, d) { return s + (d.payment.amountPaid || 0); }, 0);
    $('#billDueCount').textContent = due.length;
    $('#billDueTotal').textContent = money(totalDue);
    $('#billDueCollected').textContent = money(totalCollected);
    renderBillingDueList(due, selected);
    renderBillingOpenList(selected);
    renderBillingMonthlySummary(selected);
  }

  function renderBillingDueList(dueItems, selectedISO) {
    var list = $('#billingDueList');
    list.innerHTML = '';
    if (!dueItems.length) {
      list.innerHTML = '<div class="billing-empty">אין תשלומים לגבייה בתאריך זה</div>';
      return;
    }
    dueItems.forEach(function (d) {
      list.appendChild(buildBillingRow(d.client, d.payment, selectedISO, false, d.kind, d.charge));
    });
  }

  function renderBillingOpenList(selectedISO) {
    var list = $('#billingOpenList');
    list.innerHTML = '';
    var q = state.billingSearch.trim().toLowerCase();
    var open = state.payments.filter(function (p) {
      if (p.status === 'paid') return false;
      if (!p.dueDate) return false;
      if (p.dueDate >= selectedISO) return false;
      if (q && (p.clientName || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    if (!open.length) {
      list.innerHTML = '<div class="billing-empty">אין יתרות פתוחות מתאריכים קודמים</div>';
      return;
    }
    open.forEach(function (p) {
      var client = state.clients.find(function (c) { return c.id === p.clientId; })
        || { id: p.clientId, name: p.clientName, billingType: 'monthly', pricePerSession: p.amountDue, startDate: p.dueDate };
      var info = paymentKindFromId(p.id);
      var charge = info.kind === 'extra'
        ? state.charges.find(function (c) { return c.id === info.chargeId; })
        : null;
      list.appendChild(buildBillingRow(client, p, p.dueDate, true, info.kind, charge));
    });
  }

  function buildBillingRow(client, payment, dueDateISO, isCarry, kind, charge) {
    var isExtra = kind === 'extra';
    var row = document.createElement('div');
    row.className = 'billing-row'
      + (isCarry ? ' carry' : '')
      + (isExtra ? ' billing-row-extra' : '');
    var amount = payment.amountDue || (isExtra ? toNum(charge && charge.amount) : clientAmountDue(client)) || 0;
    var disabled = state.role === 'editor' ? '' : ' disabled';
    var statusSelect = PAYMENT_STATUSES.map(function (s) {
      return '<option value="' + s.id + '"' + (payment.status === s.id ? ' selected' : '') + '>' + s.he + '</option>';
    }).join('');
    var dateCellLabel = isCarry ? 'תאריך מקורי' : 'סכום חודשי';
    var dateCellVal = isCarry ? displayDate(dueDateISO) : money(amount);

    // Show next billing date if available on client
    var nextBillHtml = '';
    if (client.nextBillingDate) {
      nextBillHtml = '<div><span class="p-label">גבייה הבאה</span><span class="p-val next-bill">' + displayDate(client.nextBillingDate) + '</span></div>';
    }

    var nameDisplay = client.name || payment.clientName || '';
    if (isExtra) {
      var desc = (charge && charge.description) || payment.notes || '';
      nameDisplay = 'חיוב נוסף: ' + desc + ' — ' + nameDisplay;
    }
    row.innerHTML =
      '<div><span class="p-label">מטופל</span><span class="p-name">' + escapeHtml(nameDisplay) + '</span></div>' +
      '<div><span class="p-label">' + dateCellLabel + '</span><span class="p-val">' + escapeHtml(dateCellVal) + '</span></div>' +
      '<div><span class="p-label">סטטוס</span><select class="billing-status"' + disabled + '>' + statusSelect + '</select></div>' +
      '<div class="billing-paid-wrap ' + (payment.status === 'partial' ? '' : 'hidden') + '">' +
        '<span class="p-label">שולם בפועל</span>' +
        '<input class="billing-paid" type="number" min="0" step="1" value="' + (payment.amountPaid || 0) + '"' + disabled + ' />' +
      '</div>' +
      '<div><span class="p-label">יתרה</span><span class="p-val billing-balance">' + money(Math.max(0, amount - (payment.amountPaid || 0))) + '</span></div>' +
      nextBillHtml;

    var statusSel = row.querySelector('.billing-status');
    var paidWrap  = row.querySelector('.billing-paid-wrap');
    var paidInput = row.querySelector('.billing-paid');
    var balanceEl = row.querySelector('.billing-balance');

    function recompute(newStatus, newPaid) {
      var ap = toNum(newPaid);
      if (ap < 0) ap = 0;
      if (newStatus === 'paid')   ap = amount;
      if (newStatus === 'unpaid') ap = 0;
      var balance = Math.max(0, amount - ap);
      balanceEl.textContent = money(balance);
      paidWrap.classList.toggle('hidden', newStatus !== 'partial');
      paidInput.value = ap;
      return {
        id: payment.id, clientId: payment.clientId || client.id,
        clientName: payment.clientName || client.name || '',
        billingType: payment.billingType || (isExtra && charge && charge.billingType === 'one_time' ? 'one_time' : 'monthly'),
        dueDate: dueDateISO,
        amountDue: amount, amountPaid: ap, status: newStatus,
        paymentDate: newStatus === 'paid' ? today() : (payment.paymentDate || ''),
        method: payment.method || '', notes: payment.notes || '',
        bundleSize: 0, sessionsUsed: 0
      };
    }

    if (statusSel) statusSel.addEventListener('change', function () {
      saveBillingRow(recompute(statusSel.value, paidInput.value));
    });
    if (paidInput) paidInput.addEventListener('change', function () {
      if (statusSel.value !== 'partial') return;
      var v = toNum(paidInput.value);
      if (v >= amount) { statusSel.value = 'paid'; saveBillingRow(recompute('paid', amount)); }
      else { saveBillingRow(recompute('partial', v)); }
    });

    // Orphan row: the payment's patient no longer exists (e.g. a deleted test
    // record). Offer a הסר button to remove the stray payment row from גבייה.
    var clientExists = state.clients.some(function (cc) { return cc.id === payment.clientId; });
    if (state.role === 'editor' && payment.clientId && !clientExists) {
      var rm = document.createElement('button');
      rm.className = 'btn btn-danger billing-remove';
      rm.textContent = 'הסר';
      rm.title = 'מחיקת רשומת גבייה של מטופל שנמחק';
      rm.onclick = function () {
        if (!confirm('להסיר את רשומת הגבייה של ' + (nameDisplay || 'מטופל שנמחק') + '?')) return;
        rm.disabled = true;
        state.payments = state.payments.filter(function (p) { return p.id !== payment.id; });
        removePayment(payment.id)
          .then(function () { toast('הוסר'); renderBilling(); })
          .catch(function (e) { toast('שגיאה: ' + e.message, true); rm.disabled = false; });
      };
      row.appendChild(rm);
    }
    return row;
  }

  function saveBillingRow(updated) {
    if (state.role !== 'editor') return;
    var idx = state.payments.findIndex(function (p) { return p.id === updated.id; });
    var prev = idx >= 0 ? state.payments[idx] : null;
    if (idx >= 0) state.payments[idx] = updated;
    else state.payments.push(updated);
    renderBillingMonthlySummary(state.billingDate || today());
    persistPayment(updated)
      .then(function () { toast('נשמר'); })
      .catch(function (e) {
        if (prev) state.payments[idx] = prev;
        else state.payments = state.payments.filter(function (p) { return p.id !== updated.id; });
        renderBilling();
        toast('שמירה נכשלה: ' + e.message, true);
      });
  }

  // Toggle the CURRENT month's base payment paid/unpaid from the patient card.
  // Mirrors the גבייה recompute() exactly for amount / amountPaid / paymentDate:
  //   paid   -> amountPaid = amountDue, paymentDate = today()
  //   unpaid -> amountPaid = 0,        paymentDate kept (base.paymentDate || '')
  // Writes through the same single path — persistPayment / savePayment — with an
  // optimistic update + rollback. Re-renders the active view. No separate path.
  function setCurrentMonthPaid(c, makePaid) {
    if (state.role !== 'editor') return;
    var dueDateISO = currentMonthBaseDueDate(c);
    var base = paymentForClientOn(c, dueDateISO);
    var newStatus = makePaid ? 'paid' : 'unpaid';
    if (base.status === newStatus) return;
    var amount = base.amountDue || clientAmountDue(c) || 0;
    var updated = {
      id: base.id,
      clientId: base.clientId || c.id,
      clientName: base.clientName || c.name || '',
      billingType: base.billingType || 'monthly',
      dueDate: base.dueDate || dueDateISO,
      amountDue: amount,
      amountPaid: makePaid ? amount : 0,
      status: newStatus,
      paymentDate: makePaid ? today() : (base.paymentDate || ''),
      method: base.method || '', notes: base.notes || '',
      bundleSize: 0, sessionsUsed: 0
    };
    var idx = state.payments.findIndex(function (p) { return p.id === updated.id; });
    var prev = idx >= 0 ? state.payments[idx] : null;
    if (idx >= 0) state.payments[idx] = updated;
    else state.payments.push(updated);
    render();
    persistPayment(updated)
      .then(function () { toast(makePaid ? 'החודש סומן כשולם' : 'בוטל סימון התשלום'); })
      .catch(function (e) {
        if (prev) state.payments[idx] = prev;
        else state.payments = state.payments.filter(function (p) { return p.id !== updated.id; });
        render();
        toast('שמירה נכשלה: ' + e.message, true);
      });
  }

  // Toggle a specific EXTRA CHARGE's paid status. A charge's status lives in its
  // own payment row (id = paymentId(client, today(), 'extra', charge.id)), the
  // same row chargeStatusFor reads. Mirrors setCurrentMonthPaid: optimistic
  // update + persist, rollback on failure. Lets Vered mark an added treatment
  // paid on the spot when money is collected the same day.
  function setChargePaid(c, charge, makePaid) {
    if (state.role !== 'editor') return;
    var id = paymentId(c, today(), 'extra', charge.id);
    var existing = findPaymentById(id);
    var newStatus = makePaid ? 'paid' : 'unpaid';
    if (existing && existing.status === newStatus) return;
    var amount = (existing && existing.amountDue) || charge.amount || 0;
    var updated = {
      id: id,
      clientId: c.id,
      clientName: c.name || '',
      billingType: 'extra',
      dueDate: (existing && existing.dueDate) || today(),
      amountDue: amount,
      amountPaid: makePaid ? amount : 0,
      status: newStatus,
      paymentDate: makePaid ? today() : ((existing && existing.paymentDate) || ''),
      method: (existing && existing.method) || '', notes: (existing && existing.notes) || '',
      bundleSize: 0, sessionsUsed: 0
    };
    var idx = state.payments.findIndex(function (p) { return p.id === id; });
    var prev = idx >= 0 ? state.payments[idx] : null;
    if (idx >= 0) state.payments[idx] = updated;
    else state.payments.push(updated);
    render();
    persistPayment(updated)
      .then(function () { toast(makePaid ? 'החיוב סומן כשולם' : 'בוטל סימון התשלום'); })
      .catch(function (e) {
        if (prev) state.payments[idx] = prev;
        else state.payments = state.payments.filter(function (p) { return p.id !== id; });
        render();
        toast('שמירה נכשלה: ' + e.message, true);
      });
  }

  function renderBillingMonthlySummary(selectedISO) {
    var mk = monthKey(selectedISO);
    $('#billMonthLabel').textContent = '— ' + monthLabel(selectedISO);
    // KPIs stay global (computed from the unfiltered month set). The
    // per-client breakdown below honors state.billingSearch.
    var thisMonth = state.payments.filter(function (p) { return monthKey(p.dueDate) === mk; });
    var collected = thisMonth.reduce(function (s, p) { return s + (p.amountPaid || 0); }, 0);
    var outstanding = thisMonth.filter(function (p) { return p.status !== 'paid'; })
      .reduce(function (s, p) { return s + Math.max(0, (p.amountDue || 0) - (p.amountPaid || 0)); }, 0);
    $('#billMonthCollected').textContent = money(collected);
    $('#billMonthOutstanding').textContent = money(outstanding);
    var q = state.billingSearch.trim().toLowerCase();
    var byClient = {};
    thisMonth.forEach(function (p) {
      if (q && (p.clientName || '').toLowerCase().indexOf(q) === -1) return;
      var key = p.clientId || p.clientName || '—';
      if (!byClient[key]) byClient[key] = { name: p.clientName || '—', collected: 0, outstanding: 0 };
      byClient[key].collected += (p.amountPaid || 0);
      if (p.status !== 'paid') byClient[key].outstanding += Math.max(0, (p.amountDue || 0) - (p.amountPaid || 0));
    });
    var clientEl = $('#billMonthByClient');
    clientEl.innerHTML = '';
    var keys = Object.keys(byClient);
    if (!keys.length) {
      clientEl.innerHTML = '<div class="bd-line muted">אין רישומי גבייה החודש</div>';
      return;
    }
    keys.forEach(function (k) {
      var c = byClient[k];
      var row = document.createElement('div');
      row.className = 'bd-line';
      row.innerHTML =
        '<span>' + escapeHtml(c.name) + '</span>' +
        '<span><span class="bd-col">נגבה ' + money(c.collected) + '</span>' +
        ' · <span class="bd-out">יתרה ' + money(c.outstanding) + '</span></span>';
      clientEl.appendChild(row);
    });
  }

  function renderBars(sel, obj) {
    var el = $(sel);
    el.innerHTML = '';
    var max = 0;
    Object.keys(obj).forEach(function (k) { if (obj[k] > max) max = obj[k]; });
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      var pct = max ? Math.round((v / max) * 100) : 0;
      var row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML =
        '<div class="bar-label">' + k + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="bar-value">' + v + '</div>';
      el.appendChild(row);
    });
  }

  // ---- Retention view (not_relevant + finished clients)
  function retRow(label, val) {
    if (!val) return '';
    return '<div style="display:flex;gap:12px;padding:5px 0;border-bottom:1px solid #1e3a56;font-size:0.85rem;">' +
      '<span style="color:#7a9bbf;font-weight:600;min-width:110px;flex-shrink:0;">' + label + '</span>' +
      '<span style="color:#c5d5e8;">' + val + '</span>' +
      '</div>';
  }

  function renderRetention() {
    var list = $('#retentionList');
    list.innerHTML = '';

    var rq = state.retentionSearch.trim().toLowerCase();
    var notRel = state.leads.filter(function (l) {
      if (l.stage !== 'not_relevant') return false;
      if (rq && l.name.toLowerCase().indexOf(rq) === -1) return false;
      return true;
    });
    var finished = state.clients.filter(function (c) {
      if (c.status !== 'סיים טיפול') return false;
      if (rq && c.name.toLowerCase().indexOf(rq) === -1) return false;
      return true;
    });

    if (!notRel.length && !finished.length) {
      list.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">אין רשומות בשימור לידים</p></div>';
      return;
    }

    if (notRel.length) {
      var h1 = document.createElement('div');
      h1.style.cssText = 'font-size:0.95rem;font-weight:700;color:#9fcfcf;padding:18px 4px 8px;border-bottom:2px solid #2a3f5a;margin-bottom:12px;';
      h1.textContent = 'לא רלוונטים';
      list.appendChild(h1);
      notRel.forEach(function (l) {
        var card = document.createElement('div');
        card.style.cssText = 'background:#1a2e4a;border:1px solid #2a3f5a;border-radius:10px;padding:16px 20px;margin-bottom:12px;display:block;';
        var header = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
          '<span style="font-weight:700;font-size:1rem;color:#fff;">' + escapeHtml(l.name) + '</span>' +
          '<span style="font-size:0.72rem;padding:2px 10px;border-radius:20px;background:#f8d7da;color:#721c24;font-weight:600;">לא רלוונטי</span>' +
          '</div>';
        var body = retRow('טלפון', l.phone ? escapeHtml(String(l.phone)) : '') +
          retRow('סוג טיפול', l.serviceType ? escapeHtml(formatServices(parseServices(l.serviceType))) : '') +
          retRow('סניף', l.location ? escapeHtml(l.location) : '') +
          retRow('בית מוצא', escapeHtml(houseOfOriginLabel(l.house_of_origin))) +
          retRow('תאריך יצירה', l.created ? displayDate(l.created) : '') +
          retRow('סיבה', escapeHtml(notRelevantReasonLabel(l.not_relevant_reason))) +
          retRow('פירוט', escapeHtml(l.not_relevant_note)) +
          retRow('הערה', l.note ? escapeHtml(l.note) : '');
        card.innerHTML = header + body;
        if (state.role === 'editor') {
          var restoreBtn = document.createElement('button');
          restoreBtn.className = 'btn btn-ghost';
          restoreBtn.style.marginTop = '10px';
          restoreBtn.textContent = 'שחזר לליד';
          restoreBtn.onclick = function () {
            l.stage = 'new';
            persist().then(function () { toast('שוחזר'); render(); }).catch(function (e) { toast('שגיאה: ' + e.message, true); });
          };
          card.appendChild(restoreBtn);
        }
        list.appendChild(card);
      });
    }

    if (finished.length) {
      var h2 = document.createElement('div');
      h2.style.cssText = 'font-size:0.95rem;font-weight:700;color:#9fcfcf;padding:18px 4px 8px;border-bottom:2px solid #2a3f5a;margin-bottom:12px;';
      h2.textContent = 'סיימו טיפול';
      list.appendChild(h2);
      finished.forEach(function (c) {
        var card = document.createElement('div');
        card.style.cssText = 'background:#1a2e4a;border:1px solid #2a3f5a;border-radius:10px;padding:16px 20px;margin-bottom:12px;display:block;';
        var header = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
          '<span style="font-weight:700;font-size:1rem;color:#fff;">' + escapeHtml(c.name) + '</span>' +
          '<span style="font-size:0.72rem;padding:2px 10px;border-radius:20px;background:#d4edda;color:#155724;font-weight:600;">סיים טיפול</span>' +
          '</div>';
        var body = retRow('טלפון', c.phone ? escapeHtml(String(c.phone)) : '') +
          retRow('סוג טיפול', c.serviceType ? escapeHtml(formatServices(parseServices(c.serviceType))) : '') +
          retRow('סניף', c.location ? escapeHtml(c.location) : '') +
          retRow('בית מוצא', escapeHtml(houseOfOriginLabel(c.house_of_origin))) +
          retRow('תחילת טיפול', c.startDate ? displayDate(c.startDate) : '') +
          retRow('סיום טיפול', c.exitDate ? displayDate(c.exitDate) : '') +
          retRow('הערות', c.notes ? escapeHtml(c.notes) : '');
        card.innerHTML = header + body;
        list.appendChild(card);
      });
    }
  }

  // ---- Therapist payouts (read-only, step 1 of 4) ----
  // Per-therapist monthly payout summary computed client-side from SessionLog
  // rows via the shared pure module (window.TherapistPayout). Display only — no
  // corrections, no export, no forward-marking (those are steps 2–4).
  var OUTCOME_LABELS = {
    happened: 'התקיים',
    patient_no_show: 'מטופל לא הגיע',
    therapist_cancelled: 'בוטל ע״י מטפל'
  };

  function currentMonthStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // Lazy first-load of SessionLog rows (only when the payout tab is first opened).
  function ensureSessionLogLoaded() {
    if (state.sessionLog !== null || state.sessionLogLoading) return;
    state.sessionLogLoading = true;
    apiGetSessionLog().then(function (data) {
      state.sessionLog = Array.isArray(data.sessionLog) ? data.sessionLog : [];
      state.sessionLogError = '';
    }).catch(function (e) {
      state.sessionLog = [];
      state.sessionLogError = e.message || String(e);
    }).then(function () {
      state.sessionLogLoading = false;
      if (state.view === 'payouts') renderPayouts();
    });
  }

  function setPayoutKpis(therapists, paid, preVat, withVatTotal) {
    var a = $('#payoutTherapistCount'); if (a) a.textContent = therapists;
    var b = $('#payoutPaidCount'); if (b) b.textContent = paid;
    var c = $('#payoutPreVat'); if (c) c.textContent = money(preVat);
    var d = $('#payoutWithVat'); if (d) d.textContent = money(withVatTotal);
  }

  function payoutStat(label, value) {
    return '<div><div style="font-size:0.75rem;color:#7d93b0;">' + escapeHtml(label) + '</div>' +
      '<div style="font-size:1.05rem;font-weight:700;color:#eaf2ff;">' + escapeHtml(String(value)) + '</div></div>';
  }

  // Last summary computed by renderPayouts — reused by the Excel export so it
  // exports EXACTLY what is on screen (same month, same forwarding state).
  var lastPayoutSummary = null;

  // One therapist card. `opts.isDiff` flips it to a הפרש card (no mark-forwarded
  // button — those are caught up by re-forwarding the prior month — and the
  // detail table shows the originating month). Correct buttons stay available so
  // a mis-logged late session can still be fixed.
  function payoutTherapistCard(t, opts) {
    opts = opts || {};
    var expanded = !!state.payoutExpanded[(opts.isDiff ? 'diff:' : '') + t.therapist];
    var toggleKey = (opts.isDiff ? 'diff:' : '') + t.therapist;
    var card = document.createElement('div');
    card.style.cssText = 'background:#1a2e4a;border:1px solid #2a3f5a;border-radius:10px;padding:16px 20px;margin-bottom:12px;';

    var forwardBtn = '';
    if (!opts.isDiff && state.role === 'editor') {
      forwardBtn =
        '<button type="button" class="btn edit-only" data-action="payout-forward" data-therapist="' +
          escapeHtml(t.therapist) + '" title="סמן את החודש של מטפל זה כהועבר לחשבת שכר">הועבר לחשבת שכר</button>';
    }

    var head =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
        '<div style="font-size:1.05rem;font-weight:700;color:#9fcfcf;">' + escapeHtml(t.therapist || '—') + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          forwardBtn +
          '<button type="button" class="btn" data-action="payout-toggle" data-key="' + escapeHtml(toggleKey) + '">' +
            (expanded ? 'הסתר פירוט' : 'הצג פירוט (' + t.sessionCount + ')') + '</button>' +
        '</div>' +
      '</div>';

    var stats =
      '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;">' +
        payoutStat('סשנים משולמים', t.paidCount) +
        payoutStat('לפני מע״מ', money(t.preVatTotal)) +
        payoutStat('כולל מע״מ', money(t.vatTotal)) +
        payoutStat('בוטלו ע״י מטפל', t.excludedCancelledCount) +
        (opts.isDiff ? payoutStat('חודשים', (t.months || []).join(', ') || '—') : '') +
      '</div>';

    var detail = '';
    if (expanded) {
      var canEdit = state.role === 'editor';
      var monthCol = opts.isDiff;
      var rows = t.sessions.map(function (s) {
        var dimmed = s.paid ? '' : 'opacity:0.55;';
        // Stash the session payload on the correct button so the handler can
        // re-send the identity fields (server recomputes pay + reverses credit).
        var correctBtn = canEdit
          ? '<button type="button" class="btn" data-action="payout-correct" ' +
              'data-session=\'' + escapeHtml(JSON.stringify({
                sessionId: s.sessionId, therapist: t.therapist,
                clinicalTreatmentType: s.type, date: fmtDate(s.date),
                outcome: s.outcome, patientName: s.patient, phone: s.phone
              })) + '\' style="padding:2px 10px;font-size:0.8rem;">תקן</button>'
          : '';
        return '<tr style="' + dimmed + '">' +
          (monthCol ? '<td style="padding:6px 10px;">' + escapeHtml(s.month || '—') + '</td>' : '') +
          '<td style="padding:6px 10px;">' + (s.date ? displayDate(s.date) : '—') + '</td>' +
          '<td style="padding:6px 10px;">' + escapeHtml(s.patient || '—') + '</td>' +
          '<td style="padding:6px 10px;">' + escapeHtml(s.type || '—') + '</td>' +
          '<td style="padding:6px 10px;">' + escapeHtml(OUTCOME_LABELS[s.outcome] || s.outcome || '—') + '</td>' +
          '<td style="padding:6px 10px;text-align:left;">' + money(s.pay) + '</td>' +
          (canEdit ? '<td style="padding:6px 10px;text-align:left;">' + correctBtn + '</td>' : '') +
        '</tr>';
      }).join('');
      detail =
        '<div style="margin-top:14px;overflow-x:auto;">' +
          '<table style="width:100%;border-collapse:collapse;font-size:0.9rem;color:#cfe3f5;">' +
            '<thead><tr style="color:#9fcfcf;text-align:right;border-bottom:1px solid #2a3f5a;">' +
              (monthCol ? '<th style="padding:6px 10px;font-weight:600;">חודש</th>' : '') +
              '<th style="padding:6px 10px;font-weight:600;">תאריך</th>' +
              '<th style="padding:6px 10px;font-weight:600;">מטופל</th>' +
              '<th style="padding:6px 10px;font-weight:600;">סוג טיפול</th>' +
              '<th style="padding:6px 10px;font-weight:600;">תוצאה</th>' +
              '<th style="padding:6px 10px;font-weight:600;text-align:left;">תשלום</th>' +
              (state.role === 'editor' ? '<th style="padding:6px 10px;font-weight:600;text-align:left;">תיקון</th>' : '') +
            '</tr></thead><tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    card.innerHTML = head + stats + detail;
    return card;
  }

  function renderPayouts() {
    var listEl = $('#payoutList');
    if (!listEl) return;
    if (!state.payoutMonth) state.payoutMonth = currentMonthStr();
    var monthInput = $('#payoutMonth');
    if (monthInput && monthInput.value !== state.payoutMonth) monthInput.value = state.payoutMonth;

    if (state.sessionLog === null) {
      ensureSessionLogLoaded();
      listEl.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">טוען נתוני סשנים…</p></div>';
      setPayoutKpis(0, 0, 0, 0);
      return;
    }
    if (state.sessionLogError) {
      listEl.innerHTML = '<div class="panel"><p style="color:#e88;padding:20px">שגיאה בטעינת יומן הסשנים: ' +
        escapeHtml(state.sessionLogError) + '</p></div>';
      setPayoutKpis(0, 0, 0, 0);
      return;
    }

    var TPay = (typeof window !== 'undefined' && window.TherapistPayout) || null;
    if (!TPay) {
      listEl.innerHTML = '<div class="panel"><p style="color:#e88;padding:20px">מודול החישוב לא נטען</p></div>';
      return;
    }

    var summary = TPay.monthlyPayoutSummary(state.sessionLog, state.payoutMonth);
    lastPayoutSummary = summary;
    setPayoutKpis(summary.therapists.length, summary.totals.paidCount,
      summary.totals.preVatTotal, summary.totals.vatTotal);

    listEl.innerHTML = '';
    var diffs = (summary.differences && summary.differences.therapists) || [];

    if (!summary.therapists.length && !diffs.length) {
      listEl.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">אין סשנים לחודש זה</p></div>';
      return;
    }

    summary.therapists.forEach(function (t) {
      listEl.appendChild(payoutTherapistCard(t, { isDiff: false }));
    });

    if (diffs.length) {
      var header = document.createElement('div');
      header.style.cssText = 'margin:22px 0 10px;display:flex;align-items:baseline;gap:10px;';
      header.innerHTML =
        '<span style="font-size:1.05rem;font-weight:700;color:#e0b15a;">הפרשים</span>' +
        '<span style="font-size:0.85rem;color:#7d93b0;">סשנים מחודשים שכבר הועברו לחשבת שכר (תשלום משלים)</span>';
      listEl.appendChild(header);
      diffs.forEach(function (t) {
        listEl.appendChild(payoutTherapistCard(t, { isDiff: true }));
      });
    }
  }

  // Re-fetch SessionLog after a write (correct / add / forward) and re-render.
  function reloadSessionLog() {
    state.sessionLog = null;
    state.sessionLogLoading = false;
    ensureSessionLogLoaded();
  }

  // --- Session correct / add-missing modal -----------------------------------
  function populateSessionDropdowns() {
    var tSel = $('#sessionTherapist');
    if (tSel && !tSel.dataset.filled) {
      var names = [];
      var TPay = window.TherapistPay;
      if (TPay) {
        names = Object.keys(TPay.FLAT_RATES || {}).concat(Object.keys(TPay.PSYCHIATRIST_RATES || {}));
      }
      names.sort(function (a, b) { return a.localeCompare(b, 'he'); });
      tSel.innerHTML = names.map(function (n) {
        return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
      }).join('');
      tSel.dataset.filled = '1';
    }
    var cSel = $('#sessionClinicalType');
    if (cSel && !cSel.dataset.filled) {
      var types = [];
      var TMap = window.TreatmentMap;
      if (TMap && TMap.CLINICAL_TO_BILLING) types = Object.keys(TMap.CLINICAL_TO_BILLING);
      cSel.innerHTML = types.map(function (n) {
        return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
      }).join('');
      cSel.dataset.filled = '1';
    }
  }

  function updateSessionFreqVisibility() {
    var cSel = $('#sessionClinicalType');
    var wrap = $('#sessionFreqWrap');
    if (!cSel || !wrap) return;
    var TMap = window.TreatmentMap;
    var billing = TMap && TMap.CLINICAL_TO_BILLING ? TMap.CLINICAL_TO_BILLING[cSel.value] : '';
    var isDay = TMap && TMap.isDayCenterBilling ? TMap.isDayCenterBilling(billing) : false;
    wrap.hidden = !isDay;
  }

  // sessionId === null -> add a missing session (server appends a new row).
  // sessionId set       -> correct an existing one (server upserts, recomputes).
  function openSessionModal(prefill) {
    var form = $('#sessionForm');
    if (!form) return;
    populateSessionDropdowns();
    form.reset();
    prefill = prefill || {};
    form.dataset.sessionId = prefill.sessionId || '';
    var isCorrect = !!prefill.sessionId;
    $('#sessionModalTitle').textContent = isCorrect ? 'תיקון סשן' : 'הוספת סשן חסר';
    $('#sessionModalSub').textContent = isCorrect
      ? 'התיקון מריץ מחדש את חישוב התשלום והקרדיט'
      : 'יירשם כסשן חדש; תשלום וקרדיט יחושבו לפי הכללים';
    if (prefill.therapist) form.therapist.value = prefill.therapist;
    if (prefill.clinicalTreatmentType) form.clinicalTreatmentType.value = prefill.clinicalTreatmentType;
    form.date.value = fmtDate(prefill.date) || today();
    if (prefill.outcome) form.outcome.value = prefill.outcome;
    form.patientName.value = prefill.patientName || '';
    form.phone.value = prefill.phone || '';
    updateSessionFreqVisibility();
    $('#sessionModal').hidden = false;
  }
  function closeSessionModal() {
    var m = $('#sessionModal');
    if (m) m.hidden = true;
  }

  function handlePayoutListClick(e) {
    var toggle = e.target.closest('[data-action="payout-toggle"]');
    if (toggle) {
      var key = toggle.getAttribute('data-key') || '';
      state.payoutExpanded[key] = !state.payoutExpanded[key];
      renderPayouts();
      return;
    }
    var correct = e.target.closest('[data-action="payout-correct"]');
    if (correct) {
      var raw = correct.getAttribute('data-session') || '{}';
      var data = {};
      try { data = JSON.parse(raw); } catch (_) {}
      openSessionModal(data);
      return;
    }
    var forward = e.target.closest('[data-action="payout-forward"]');
    if (forward) {
      var therapist = forward.getAttribute('data-therapist') || '';
      markTherapistForwarded(therapist, forward);
    }
  }

  function markTherapistForwarded(therapist, btn) {
    if (!therapist) return;
    var month = state.payoutMonth || currentMonthStr();
    if (!window.confirm('לסמן את ' + therapist + ' לחודש ' + month + ' כהועבר לחשבת שכר?\nהסשנים יוסרו מהתצוגה ולא יופיעו שוב.')) return;
    if (btn) btn.disabled = true;
    apiPostAction('markForwarded', { therapist: therapist, month: month })
      .then(function (r) {
        toast('הועבר: ' + (r.forwarded || 0) + ' סשנים');
        reloadSessionLog();
      })
      .catch(function (err) {
        toast('שגיאה: ' + err.message, true);
        if (btn) btn.disabled = false;
      });
  }

  // Build a UTF-8-BOM CSV (so Excel renders Hebrew correctly) and download it.
  function exportPayoutCsv() {
    var PE = window.PayoutExport;
    if (!PE || !lastPayoutSummary) { toast('אין נתונים לייצוא', true); return; }
    var csv = PE.buildPayoutCsv(lastPayoutSummary);
    var BOM = '﻿';   // so Excel detects UTF-8 and renders Hebrew correctly
    var blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'payout-' + (lastPayoutSummary.month || state.payoutMonth || '') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Submit the correct / add-missing form. Both routes POST correctSessionOutcome
  // (the internal dashboard path into the recordSessionOutcome rules engine): a
  // new sessionId appends; an existing one upserts and recomputes pay + credit.
  // No amount field — the server prices it from the rules.
  function submitSessionForm(e) {
    e.preventDefault();
    var submit = $('#sessionSubmit');
    if (submit && submit.disabled) return;
    var form = e.target;
    var fd = new FormData(form);
    var therapist = (fd.get('therapist') || '').toString().trim();
    var clinical = (fd.get('clinicalTreatmentType') || '').toString().trim();
    var date = (fd.get('date') || '').toString().trim();
    var outcome = (fd.get('outcome') || '').toString().trim();
    if (!therapist) { toast('יש לבחור מטפל', true); return; }
    if (!clinical) { toast('יש לבחור סוג טיפול', true); return; }
    if (!date) { toast('יש להזין תאריך', true); return; }
    if (!outcome) { toast('יש לבחור תוצאה', true); return; }

    var existingId = (form.dataset.sessionId || '').trim();
    var payload = {
      action: 'correctSessionOutcome',
      sessionId: existingId || uid(),
      therapist: therapist,
      clinicalTreatmentType: clinical,
      date: date,
      outcome: outcome,
      patientName: (fd.get('patientName') || '').toString().trim(),
      phone: (fd.get('phone') || '').toString().trim()
    };
    var freq = (fd.get('freqPerWeek') || '').toString().trim();
    if (freq) payload.freqPerWeek = toNum(freq);

    if (submit) submit.disabled = true;
    apiPostAction('correctSessionOutcome', payload)
      .then(function () {
        toast(existingId ? 'הסשן תוקן' : 'הסשן נוסף');
        closeSessionModal();
        reloadSessionLog();
      })
      .catch(function (err) { toast('שגיאה: ' + err.message, true); })
      .finally(function () { if (submit) submit.disabled = false; });
  }

  // ---- Leads kanban
  function renderLeads() {
    var kanban = $('#kanban');
    kanban.innerHTML = '';
    var q = state.leadSearch.trim().toLowerCase();
    var filtered = state.leads.filter(function (l) {
      if (l.stage === 'not_relevant') return false;
      if (q && l.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    STAGES.forEach(function (stage) {
      var col = document.createElement('div');
      col.className = 'col';
      var colLeads = filtered.filter(function (l) { return l.stage === stage.id; });
      col.innerHTML =
        '<div class="col-head"><div class="col-title">' + stage.he + '</div>' +
        '<div class="col-count">' + colLeads.length + '</div></div>' +
        '<div class="col-body"></div>';
      var body = $('.col-body', col);
      colLeads.forEach(function (l) { body.appendChild(leadCard(l, stage)); });
      kanban.appendChild(col);
    });
  }

  function leadCard(l, stage) {
    var card = document.createElement('div');
    card.className = 'card';
    var services = parseServices(l.serviceType);
    var chipsHtml = services.map(function (s) { return '<span class="chip">' + escapeHtml(serviceLabel(s)) + '</span>'; }).join('');
    if (l.location) {
      chipsHtml += '<span class="chip">' + escapeHtml(l.location) + '</span>';
    }
    var hooLabel = houseOfOriginLabel(l.house_of_origin);
    if (hooLabel) {
      chipsHtml += '<span class="chip">בית מוצא: ' + escapeHtml(hooLabel) + '</span>';
    }
    var agreementFields = '';
    if (stage.id === 'agreement') {
      var breakdown = parseSessionsBreakdown(l.sessionsPerWeek, services);
      var bdChips = Object.keys(breakdown).map(function (k) {
        return '<span class="chip">' + escapeHtml(serviceLabel(k)) + ': ' + breakdown[k] + '/שבוע</span>';
      }).join('');
      agreementFields =
        '<div class="row">' + (bdChips || '<span class="chip">מפגשים לא נקבעו</span>') + '</div>' +
        '<div class="row"><span class="chip">חבילה חודשית: ' + (l.pricePerSession ? money(l.pricePerSession) : '—') + '</span></div>';
    }

    // Show payment info if lead is active
    var paymentInfoHtml = '';
    if (stage.id === 'active' && l.paymentStatus) {
      var psLabel = l.paymentStatus === 'paid' ? 'שולם' : l.paymentStatus === 'partial' ? 'שולם חלקית' : 'לא שולם';
      var psClass = l.paymentStatus === 'paid' ? 'chip chip-paid' : l.paymentStatus === 'partial' ? 'chip chip-partial' : 'chip chip-unpaid';
      paymentInfoHtml =
        '<div class="row">' +
          '<span class="' + psClass + '">תשלום: ' + psLabel + '</span>' +
          (l.paymentDate ? '<span class="chip">שולם ב: ' + displayDate(l.paymentDate) + '</span>' : '') +
          (l.nextBillingDate ? '<span class="chip chip-next">גבייה הבאה: ' + displayDate(l.nextBillingDate) + '</span>' : '') +
        '</div>';
    }

    var createdLine = l.created ? '<div class="meta">נוצר: ' + displayDate(l.created) + '</div>' : '';
    var startLine = l.startDate ? '<div class="meta">תחילת טיפול: ' + displayDate(l.startDate) + '</div>' : '';

    card.innerHTML =
      '<div class="name">' + escapeHtml(l.name) + '</div>' +
      '<div class="meta">' + escapeHtml(l.phone) + '</div>' +
      createdLine + startLine +
      (chipsHtml ? '<div class="row">' + chipsHtml + '</div>' : '') +
      (l.note ? '<div class="note">' + escapeHtml(l.note) + '</div>' : '') +
      agreementFields + paymentInfoHtml +
      '<div class="intro-slot"></div>' +
      '<div class="actions edit-only"></div>';

    if (stage.id === 'intro') {
      var slot = $('.intro-slot', card);
      var wrap = document.createElement('label');
      wrap.className = 'inline-field';
      wrap.innerHTML = 'תאריך ושעת שיחת היכרות';
      var dt = document.createElement('input');
      dt.type = 'datetime-local';
      dt.value = l.introDateTime || '';
      if (state.role !== 'editor') dt.disabled = true;
      dt.addEventListener('click', function () { try { dt.showPicker && dt.showPicker(); } catch (_) {} });
      dt.addEventListener('focus', function () { try { dt.showPicker && dt.showPicker(); } catch (_) {} });
      dt.addEventListener('change', function () {
        l.introDateTime = dt.value;
        persist().then(function () { toast('נשמר'); }).catch(function (e) { toast('שגיאה: ' + e.message, true); });
      });
      wrap.appendChild(dt);
      slot.appendChild(wrap);
    }

    if (state.role === 'editor') {
      var actions = $('.actions', card);
      var idx = STAGES.findIndex(function (s) { return s.id === stage.id; });
      if (idx > 0) {
        var back = document.createElement('button');
        back.className = 'btn btn-ghost';
        back.textContent = 'שלב קודם →';
        back.onclick = function () { moveLead(l.id, STAGES[idx - 1].id); };
        actions.appendChild(back);
      }
      if (stage.id === 'agreement') {
        var setAgree = document.createElement('button');
        setAgree.className = 'btn';
        setAgree.textContent = 'עריכת פרטי טיפול';
        setAgree.onclick = function () { openAgreementModal(l); };
        actions.appendChild(setAgree);
      }
     if (idx < STAGES.length - 1) {
        var next = document.createElement('button');
        next.className = 'btn btn-primary';
        var nextStage = STAGES[idx + 1];
        next.textContent = '← שלב הבא: ' + nextStage.he;
        next.onclick = function () {
          if (nextStage.id === 'agreement') openAgreementModal(l, true);
          else moveLead(l.id, nextStage.id);
        };
        actions.appendChild(next);
      }
      if (stage.id === 'agreement') {
        var convert = document.createElement('button');
        convert.className = 'btn btn-primary';
        convert.textContent = '← הפוך למטופל פעיל';
        convert.onclick = function () { openActivateModal(l); };
        actions.appendChild(convert);
      }
      var edit = document.createElement('button');
      edit.className = 'btn btn-ghost';
      edit.textContent = 'עריכה';
      edit.onclick = function () { openLeadModal(l); };
      actions.appendChild(edit);

      var notRel = document.createElement('button');
      notRel.className = 'btn btn-danger';
      notRel.textContent = 'לא רלוונטי';
      notRel.onclick = function () { openNotRelevantReasonModal(l); };
      actions.appendChild(notRel);

      var remove = document.createElement('button');
      remove.className = 'btn btn-danger';
      remove.textContent = 'הסר';
      remove.onclick = function () { openRemoveLeadModal(l); };
      actions.appendChild(remove);
    }
    return card;
  }

  // ---- Clients
  function renderClients() {
    renderDuplicateReport();
    var tabsEl = $('#clientTabs');
    tabsEl.innerHTML = '';
    var tabs = [{ id: 'all', label: 'הכול' }].concat(SERVICE_TYPES.map(function (s) { return { id: s, label: s }; }));
    tabs.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'ct' + (state.clientTab === t.id ? ' active' : '');
      b.textContent = t.label;
      b.onclick = function () { state.clientTab = t.id; renderClients(); };
      tabsEl.appendChild(b);
    });
    var list = $('#clientsList');
    list.innerHTML = '';
    var q = state.clientSearch.trim().toLowerCase();
    var visible = state.clients.filter(function (c) {
      if (c.status === 'סיים טיפול') return false; // finished go to retention
      if (state.clientTab !== 'all') {
        // Day-center tab carries the new label; match old "מרכז יום" rows too.
        var matchesTab = state.clientTab === DAY_CENTER_LABEL
          ? hasDayCenter(c.serviceType)
          : parseServices(c.serviceType).indexOf(state.clientTab) !== -1;
        if (!matchesTab) return false;
      }
      if (q && c.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    visible.forEach(function (c) { list.appendChild(clientCard(c)); });
    if (!visible.length) list.innerHTML = '<div class="panel">אין מטופלים להצגה.</div>';
  }

  function statusClass(s) {
    if (s === 'פעיל') return 'status-active';
    if (s === 'הפסקה זמנית') return 'status-pause';
    return 'status-done';
  }

  function clientCard(c) {
    var card = document.createElement('div');
    card.className = 'client-card';
    var rev = monthlyRevenue(c);
    var phoneDisp = clientPhone(c);
    var services = parseServices(c.serviceType);
    var serviceChips = services.map(function (s) { return '<span class="chip">' + escapeHtml(serviceLabel(s)) + '</span>'; }).join('');
    var locationChip = c.location ? '<span class="chip">' + escapeHtml(c.location) + '</span>' : '';
    var hooLabelClient = houseOfOriginLabel(c.house_of_origin);
    var hooChip = hooLabelClient ? '<span class="chip">בית מוצא: ' + escapeHtml(hooLabelClient) + '</span>' : '';
    var breakdown = parseSessionsBreakdown(c.sessionsPerWeek, c.serviceType);
    var breakdownChips = Object.keys(breakdown).map(function (k) {
      return '<span class="chip">' + escapeHtml(serviceLabel(k)) + ': ' + breakdown[k] + '/שבוע</span>';
    }).join('');
    var total = totalSessions(c.sessionsPerWeek, c.serviceType);
    var credits = toNum(c.creditsOwed) || 0;
    var statsHtml =
      '<span>סה״כ מפגשים/שבוע: <b>' + total + '</b></span>' +
      '<span>חבילה חודשית: <b>' + money(c.pricePerSession) + '</b></span>' +
      '<span>הכנסה: <b>' + money(rev) + '</b></span>' +
      // Monthly session-credit balance (server-managed): cancelled-by-therapist
      // sessions bank a credit; a session beyond the monthly quota spends one.
      '<span>קרדיט מפגשים: <b' + (credits > 0 ? ' class="credit-pos"' : '') + '>' + credits + '</b></span>';

    // Monthly base-payment status for the CURRENT month. Driven by the same
    // per-month payment row the גבייה tab uses (paymentForClientOn) so both
    // tabs stay consistent. For editors it is a toggle button: unpaid/partial →
    // mark paid, paid → revert to unpaid (both via persistPayment).
    var paymentHtml = '';
    if (c.status !== 'סיים טיפול') {
      var basePay = paymentForClientOn(c, currentMonthBaseDueDate(c));
      var psId = basePay.status === 'paid' ? 'paid' : basePay.status === 'partial' ? 'partial' : 'unpaid';
      var psLabel = psId === 'paid' ? 'שולם' : psId === 'partial' ? 'שולם חלקית' : 'לא שולם';
      var statusEl;
      if (state.role === 'editor') {
        statusEl = psId === 'paid'
          ? '<button type="button" class="chip chip-paid month-pay-btn" data-action="mark-month-unpaid" title="בטל סימון תשלום לחודש הנוכחי">חבילה: ' + psLabel + ' ↺</button>'
          : '<button type="button" class="chip chip-' + psId + ' month-pay-btn" data-action="mark-month-paid" title="סמן את החודש הנוכחי כשולם">חבילה: ' + psLabel + ' ✓</button>';
      } else {
        statusEl = '<span class="chip chip-' + psId + '">חבילה: ' + psLabel + '</span>';
      }
      paymentHtml = '<div class="client-meta">' +
        statusEl +
        (psId === 'paid' && basePay.paymentDate ? '<span class="chip">שולם ב: ' + displayDate(basePay.paymentDate) + '</span>' : '') +
        (c.nextBillingDate
          ? '<span class="chip chip-next">גבייה הבאה: ' + displayDate(c.nextBillingDate) + '</span>'
          : (renewalInfo(c) && renewalInfo(c).renewalDate
              ? '<span class="chip chip-next">גבייה הבאה: ' + displayDate(renewalInfo(c).renewalDate) + '</span>'
              : '')) +
        '</div>';
    }

    // Renewal status banner (overdue / due soon)
    var renewBannerHtml = '';
    var renew = renewalInfo(c);
    if (renew.status === 'overdue') {
      card.classList.add('client-card-stop');
      renewBannerHtml = '<div class="card-banner card-banner-stop">🛑 עצור טיפול — לא שולם עבור החודש הנוכחי</div>';
    } else if (renew.status === 'due_soon') {
      card.classList.add('client-card-warn');
      var dl = renew.daysLeft;
      var txt = dl === 0 ? 'חידוש היום' : dl === 1 ? 'חידוש מחר' : 'חידוש בעוד ' + dl + ' ימים';
      renewBannerHtml = '<div class="card-banner card-banner-warn">⏰ ' + txt + ' (' + displayDate(renew.renewalDate) + ')</div>';
    }

    // Extra charges (active only) shown inline as a compact list.
    var activeCharges = state.charges.filter(function (ch) {
      return ch.clientId === c.id && ch.active !== false;
    });
    var chargesHtml = '';
    if (activeCharges.length) {
      var items = activeCharges.map(function (ch) {
        var label;
        if (ch.billingType === 'monthly') {
          var day = ch.billingDay || dayOfMonth(ch.chargeDate) || '';
          label = 'חודשי: ' + escapeHtml(ch.description) + ' — ' + money(ch.amount) +
                  (day ? ' (יום ' + day + ')' : '');
        } else {
          label = 'חד-פעמי: ' + escapeHtml(ch.description) + ' — ' + money(ch.amount) +
                  (ch.chargeDate ? ' (' + displayDate(ch.chargeDate) + ')' : '');
        }
        var status = chargeStatusFor(c, ch);
        var statusLabel = status === 'paid' ? 'שולם' : status === 'partial' ? 'שולם חלקית' : 'לא שולם';
        // Editors get a clickable toggle (mark paid / revert); viewers see a
        // static badge. Clicking flips this charge's own payment row.
        var statusBadge = (state.role === 'editor')
          ? '<button type="button" class="charge-status charge-status-' + status + ' charge-status-btn edit-only" ' +
              'data-charge-paid="' + escapeHtml(ch.id) + '" data-charge-makepaid="' + (status === 'paid' ? '0' : '1') + '" ' +
              'title="' + (status === 'paid' ? 'בטל סימון תשלום' : 'סמן כשולם') + '">' + statusLabel + '</button>'
          : '<span class="charge-status charge-status-' + status + '">' + statusLabel + '</span>';
        return '<li class="charge-row" data-charge-id="' + escapeHtml(ch.id) + '">' +
          '<span class="charge-label">' + label + '</span>' +
          statusBadge +
          '<button type="button" class="charge-remove edit-only" title="הסר חיוב" data-charge-remove="' + escapeHtml(ch.id) + '">×</button>' +
          '</li>';
      }).join('');
      chargesHtml = '<ul class="client-charges">' + items + '</ul>';
    }

    card.innerHTML =
      renewBannerHtml +
      '<div class="client-head">' +
        '<div class="client-name">' + escapeHtml(c.name) + '</div>' +
        '<span class="status-badge ' + statusClass(c.status) + '">' + escapeHtml(c.status) + '</span>' +
      '</div>' +
      (phoneDisp ? '<div class="client-meta">טלפון: ' + escapeHtml(phoneDisp) + '</div>' : '') +
      '<div class="client-meta">' + serviceChips + locationChip + hooChip + '</div>' +
      (breakdownChips ? '<div class="client-meta">' + breakdownChips + '</div>' : '') +
      '<div class="client-stats">' + statsHtml + '</div>' +
      paymentHtml +
      chargesHtml +
      '<div class="client-meta">' +
        (c.startDate ? 'תחילת טיפול: ' + displayDate(c.startDate) : '') +
      '</div>' +
      '<div class="client-actions edit-only"></div>';

    if (state.role === 'editor') {
      var actions = $('.client-actions', card);

      var editBtn = document.createElement('button');
      editBtn.className = 'btn btn-ghost';
      editBtn.textContent = '✏️ ערוך';
      editBtn.title = 'ערוך פרטי טיפול';
      editBtn.onclick = function () { openEditClientModal(c); };
      actions.appendChild(editBtn);

      var addChargeBtn = document.createElement('button');
      addChargeBtn.className = 'btn btn-ghost edit-only';
      addChargeBtn.textContent = '+ הוסף טיפול';
      addChargeBtn.title = 'הוסף חיוב חד-פעמי או חודשי';
      addChargeBtn.onclick = function () { openAddChargeModal(c); };
      actions.appendChild(addChargeBtn);

      var renewBtn = document.createElement('button');
      renewBtn.className = 'btn btn-ghost edit-only';
      renewBtn.textContent = 'חידוש ותשלום';
      renewBtn.title = 'רשום תשלום מראש לחודש הבא ועדכן את הסכום החודשי';
      renewBtn.onclick = function () { openRenewModal(c); };
      actions.appendChild(renewBtn);

      var changePkgBtn = document.createElement('button');
      changePkgBtn.className = 'btn btn-ghost edit-only';
      changePkgBtn.textContent = 'שינוי חבילה';
      changePkgBtn.title = 'עדכן מחיר למפגש ותדירות שבועית, וקבע תאריך שינוי שמאפס את מועד הגבייה';
      changePkgBtn.onclick = function () { openChangePackageModal(c); };
      actions.appendChild(changePkgBtn);

      // Wire × buttons on the inline charge list.
      $$('[data-charge-remove]', card).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var chargeId = btn.getAttribute('data-charge-remove');
          handleRemoveCharge(chargeId);
        });
      });

      // Wire the per-charge paid toggle (editor only): mark a single charge
      // paid/unpaid on the spot (e.g. an added treatment paid the same day).
      $$('[data-charge-paid]', card).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var chargeId = btn.getAttribute('data-charge-paid');
          var makePaid = btn.getAttribute('data-charge-makepaid') === '1';
          var charge = (state.charges || []).find(function (ch) { return ch.id === chargeId; });
          if (charge) setChargePaid(c, charge, makePaid);
        });
      });

      // Wire the monthly payment toggle button (editor only): paid ⇄ unpaid.
      var payBtn = $('[data-action="mark-month-paid"]', card);
      if (payBtn) payBtn.addEventListener('click', function () { setCurrentMonthPaid(c, true); });
      var unpayBtn = $('[data-action="mark-month-unpaid"]', card);
      if (unpayBtn) unpayBtn.addEventListener('click', function () { setCurrentMonthPaid(c, false); });

      var statusSel = document.createElement('select');
      ['פעיל', 'הפסקה זמנית'].forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (c.status === opt) o.selected = true;
        statusSel.appendChild(o);
      });
      statusSel.onchange = function () {
        c.status = statusSel.value;
        persist().then(function () { toast('עודכן'); render(); }).catch(function (e) { toast('שגיאה: ' + e.message, true); });
      };
      statusSel.className = 'btn';
      actions.appendChild(statusSel);

      var endBtn = document.createElement('button');
      endBtn.className = 'btn btn-danger';
      endBtn.textContent = 'סיים טיפול';
      endBtn.onclick = function () { openExitModal(c); };
      actions.appendChild(endBtn);

      var del = document.createElement('button');
      del.className = 'btn btn-danger';
      del.textContent = '✕';
      del.title = 'מחיקה לצמיתות';
      del.onclick = function () {
        if (!confirm('למחוק לצמיתות את ' + c.name + '?')) return;
        var delId = c.id;
        state.clients = state.clients.filter(function (x) { return x.id !== delId; });
        persist()
          .then(function () { return removePaymentsForClient(delId); })
          .then(function () { toast('נמחק'); render(); })
          .catch(function (e) { toast('שגיאה: ' + e.message, true); });
      };
      actions.appendChild(del);
    }
    return card;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // --- actions -----------------------------------------------------------
  function moveLead(id, newStage) {
    var lead = state.leads.find(function (l) { return l.id === id; });
    if (!lead) return;
    lead.stage = newStage;
    persist().then(function () { toast('הועבר'); render(); }).catch(function (e) { toast('שגיאה: ' + e.message, true); });
  }

  // ---- 'Not relevant' reason flow ----
  // When the user clicks "לא רלוונטי" on a lead, a small modal asks her to
  // pick ONE of three fixed reasons before the lead is moved. The reason
  // is stored on the lead as `not_relevant_reason` for later reporting.
  // See docs/SPEC-lead-not-relevant-reason.md for the full design.
  var NOT_RELEVANT_REASON_LABELS = {
    never_relevant:     'לא היה רלוונטי מלכתחילה',
    stopped_from_house: 'המשיך מאחד הבתים והפסיק',
    stopped_new:        'ליד חדש שהתחיל והפסיק'
  };
  function notRelevantReasonLabel(v) {
    var s = String(v == null ? '' : v).trim();
    return NOT_RELEVANT_REASON_LABELS[s] || '';
  }
  var notRelevantLeadId = null;
  var removingLeadId = null;
  function openNotRelevantReasonModal(lead) {
    notRelevantLeadId = lead.id;
    var form = $('#notRelevantReasonForm');
    if (form) form.reset();
    $('#notRelevantReasonModal').hidden = false;
  }
  function closeNotRelevantReasonModal() {
    var m = $('#notRelevantReasonModal');
    if (m) m.hidden = true;
    notRelevantLeadId = null;
  }

  function openRemoveLeadModal(lead) {
    removingLeadId = lead.id;
    $('#removeLeadModal').hidden = false;
  }

  function closeRemoveLeadModal() {
    var m = $('#removeLeadModal');
    if (m) m.hidden = true;
    removingLeadId = null;
  }

  var pendingDuplicateLead = null;
  function openDuplicateLeadModal(existingLead, onConfirm) {
    pendingDuplicateLead = { existing: existingLead, onConfirm: onConfirm };
    var nameEl = $('#duplicateLeadExistingName');
    if (nameEl) nameEl.textContent = (existingLead && existingLead.name) ? existingLead.name : '';
    var m = $('#duplicateLeadModal');
    if (m) m.hidden = false;
  }
  function closeDuplicateLeadModal() {
    var m = $('#duplicateLeadModal');
    if (m) m.hidden = true;
    pendingDuplicateLead = null;
  }

  function readLeadFormFields(form) {
    var fd = new FormData(form);
    var group = $('[data-group="serviceType"]', form);
    var services = readServiceGroup(group);
    var isDayCenter = hasDayCenter(services);
    return {
      name: (fd.get('name') || '').trim(),
      phone: normalizePhone(fd.get('phone') || ''),
      serviceType: formatServices(services),
      location: (fd.get('location') || ''),
      note: (fd.get('note') || '').trim(),
      created: fd.get('created') || today(),
      house_of_origin: (fd.get('house_of_origin') || '').trim()
    };
  }
  function addLeadFromForm(form) {
    var f = readLeadFormFields(form);
    var lead = {
      id: uid(), name: f.name, phone: f.phone,
      serviceType: f.serviceType, location: f.location,
      note: f.note, stage: 'new', sessionsPerWeek: '',
      pricePerSession: '', startDate: '',
      created: f.created, introDateTime: '',
      paymentStatus: '', paymentDate: '', nextBillingDate: '',
      house_of_origin: f.house_of_origin
    };
    state.leads.push(lead);
    return lead;
  }
  function updateLeadFromForm(lead, form) {
    var f = readLeadFormFields(form);
    lead.name = f.name; lead.phone = f.phone;
    lead.serviceType = f.serviceType; lead.location = f.location;
    lead.note = f.note; lead.created = f.created;
    if (f.house_of_origin) lead.house_of_origin = f.house_of_origin;
  }

  // --- dynamic per-service sessions fields
  function renderSessionsHost(host, services, values) {
    host.innerHTML = '';
    var list = parseServices(services);
    if (!list.length) {
      var msg = document.createElement('div');
      msg.className = 'empty';
      msg.textContent = 'יש לבחור לפחות סוג טיפול אחד לפני קביעת מפגשים.';
      host.appendChild(msg);
      return;
    }
    var current = parseSessionsBreakdown(values, services);
    list.forEach(function (svc) {
      var label = document.createElement('label');
      label.textContent = 'מפגשים בשבוע — ' + svc;
      var input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.step = '1'; input.required = true;
      input.dataset.service = svc;
      input.value = current[svc] != null ? current[svc] : '';
      label.appendChild(input);
      host.appendChild(label);
    });
  }
  function readSessionsHost(host) {
    var out = {};
    $$('input[data-service]', host).forEach(function (inp) { out[inp.dataset.service] = wholeSessions(inp.value); });
    return out;
  }

  // --- service checkbox group
  function populateServiceGroup(group, selected) {
    group.innerHTML = '';
    var picked = parseServices(selected);
    SERVICE_TYPES.forEach(function (s) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = s;
      // Day-center option is alias-aware so legacy "מרכז יום" rows render
      // checked (and heal to DAY_CENTER_LABEL on save). Others stay strict.
      cb.checked = (s === DAY_CENTER_LABEL) ? hasDayCenter(picked) : picked.indexOf(s) !== -1;
      cb.addEventListener('change', function () { updateLocationVisibility(group.closest('form')); });
      var span = document.createElement('span');
      span.textContent = s;
      lab.appendChild(cb); lab.appendChild(span);
      group.appendChild(lab);
    });
  }
  function readServiceGroup(group) {
    return $$('input[type="checkbox"]', group).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
  }
  function formLocationWrap(form) {
    if (!form) return null;
    if (form.id === 'leadForm') return $('#leadLocationWrap');
    if (form.id === 'activateForm') return $('#activateLocationWrap');
    return null;
  }
  function updateLocationVisibility(form) {
    if (!form) return;
    var group = $('[data-group="serviceType"]', form);
    if (!group) return;
    var wrap = formLocationWrap(form);
    if (!wrap) return;
    var picked = readServiceGroup(group);
    wrap.classList.remove('field-hidden');
    var sel = $('select[name="location"]', form);
    if (sel) sel.required = true;
  }

  // --- modals ------------------------------------------------------------
  var editingLeadId = null;
  function openLeadModal(lead) {
    editingLeadId = lead ? lead.id : null;
    var m = $('#leadModal');
    $('#leadModalTitle').textContent = lead ? 'עריכת ליד' : 'ליד חדש';
    var f = $('#leadForm');
    f.reset();
    var group = $('[data-group="serviceType"]', f);
    populateServiceGroup(group, lead ? lead.serviceType : '');
    if (lead) {
      f.name.value = lead.name;
      f.phone.value = lead.phone;
      f.location.value = lead.location || '';
      f.note.value = lead.note;
      f.created.value = lead.created || today();
      f.house_of_origin.value = lead.house_of_origin || '';
      // Don't force backfill: optional when editing a historical lead that lacks a value.
      f.house_of_origin.required = !!lead.house_of_origin;
    } else {
      f.created.value = today();
      f.house_of_origin.value = '';
      f.house_of_origin.required = true;
    }
    updateLocationVisibility(f);
    m.hidden = false;
  }
  function closeLeadModal() { $('#leadModal').hidden = true; editingLeadId = null; }

  var agreementLeadId = null;
  var agreementAdvance = false;
  function openAgreementModal(lead, advance) {
    agreementLeadId = lead.id;
    agreementAdvance = !!advance;
    var f = $('#agreementForm');
    f.reset();
    renderSessionsHost($('[data-host="agreementSessions"]', f), lead.serviceType, lead.sessionsPerWeek);
    f.pricePerSession.value = lead.pricePerSession || '';
    if (f.paymentStatus) f.paymentStatus.value = lead.paymentStatus || 'paid';
    if (f.paymentDate) f.paymentDate.value = lead.paymentDate || today();
    $('#agreementModal').hidden = false;
  }
  function closeAgreementModal() { $('#agreementModal').hidden = true; agreementLeadId = null; }

  var activateLeadId = null;
  function openActivateModal(lead) {
    activateLeadId = lead.id;
    var f = $('#activateForm');
    f.reset();
    var group = $('[data-group="serviceType"]', f);
    populateServiceGroup(group, lead.serviceType);
    if (lead.location) f.location.value = lead.location;
    var host = $('[data-host="activateSessions"]', f);
    renderSessionsHost(host, lead.serviceType, lead.sessionsPerWeek);
    $$('input[type="checkbox"]', group).forEach(function (cb) {
      cb.addEventListener('change', function () {
        var picked = readServiceGroup(group);
        var current = readSessionsHost(host);
        renderSessionsHost(host, formatServices(picked), current);
      });
    });
    f.pricePerSession.value = lead.pricePerSession || '';
    f.startDate.value = lead.startDate || today();
    // pre-fill payment date to today
    if (f.paymentDate) f.paymentDate.value = today();
    updateLocationVisibility(f);
    $('#activateModal').hidden = false;
  }
  function closeActivateModal() { $('#activateModal').hidden = true; activateLeadId = null; }

  function openDirectClientModal() {
    var m = $('#directClientModal');
    var f = $('#directClientForm');
    f.reset();
    var group = $('[data-group="serviceType"]', f);
    populateServiceGroup(group, '');
    f.startDate.value = today();
    if (f.billingDay) f.billingDay.value = '';
    if (f.monthlyAmount) f.monthlyAmount.value = '';
    if (f.paymentDate) f.paymentDate.value = today();
    renderSessionsHost($('[data-host="directSessions"]', f), '', {});
    updateLocationVisibilityForDirect(f);
    m.hidden = false;
  }
  function closeDirectClientModal() { $('#directClientModal').hidden = true; }

  function updateLocationVisibilityForDirect(form) {
    var group = $('[data-group="serviceType"]', form);
    var wrap = $('#directLocationWrap');
    var sel = $('select[name="location"]', form);
    if (!group || !wrap || !sel) return;
    var picked = readServiceGroup(group);
    wrap.classList.remove('field-hidden');
    sel.required = true;
  }

  var exitClientId = null;
  function openExitModal(client) {
    exitClientId = client.id;
    $('#exitForm').reset();
    $('#exitForm').exitDate.value = today();
    $('#exitModal').hidden = false;
  }
  function closeExitModal() { $('#exitModal').hidden = true; exitClientId = null; }

  var editClientId = null;
  function openEditClientModal(client) {
    editClientId = client.id;
    var form = $('#editClientForm');
    form.reset();
    $('#editClientName').textContent = client.name;
    form.clientId.value = client.id;
    if (form.name) form.name.value = client.name || '';
    // Location/סניף is always editable (no day-center lock).
    if (form.location) {
      form.location.value = client.location || '';
      form.location.disabled = false;
      var locWrap = $('#editClientLocationWrap');
      if (locWrap) locWrap.style.opacity = '';
    }
    // Patient's primary phone (the populated `phone` column, with fallback +
    // leading-zero recovery). treatmentContactPhone is edited separately below.
    if (form.phone) form.phone.value = clientPhone(client);
    form.treatmentContactPhone.value = client.treatmentContactPhone || '';
    form.payerName.value = client.payerName || '';
    form.payerPhone.value = client.payerPhone || '';
    form.paymentLink.value = client.paymentLink || '';
    form.paymentStatus.value = client.paymentStatus || 'paid';
    form.paymentDate.value = client.paymentDate || '';
    form.monthlyAmount.value = client.pricePerSession || '';
    if (form.house_of_origin) form.house_of_origin.value = client.house_of_origin || '';
    if (form.notes) form.notes.value = client.notes || '';
    // Treatment plan: service types + sessions per week per treatment
    var ecGroup = $('[data-group="serviceType"]', form);
    var ecHost = $('[data-host="editClientSessions"]', form);
    if (ecGroup && ecHost) {
      populateServiceGroup(ecGroup, client.serviceType);
      renderSessionsHost(ecHost, client.serviceType, client.sessionsPerWeek);
      $$('input[type="checkbox"]', ecGroup).forEach(function (cb) {
        cb.addEventListener('change', function () {
          var picked = readServiceGroup(ecGroup);
          var current = readSessionsHost(ecHost);
          renderSessionsHost(ecHost, formatServices(picked), current);
        });
      });
    }
    $('#editClientModal').hidden = false;
  }
  function closeEditClientModal() { $('#editClientModal').hidden = true; editClientId = null; }

  var addChargeClientId = null;
  function openAddChargeModal(client) {
    addChargeClientId = client.id;
    var form = $('#addChargeForm');
    if (!form) return;
    form.reset();
    $('#addChargeClientName').textContent = client.name || '';
    if (form.chargeDate) form.chargeDate.value = today();
    if (form.billingType) form.billingType.value = 'one_time';
    // Populate the treatment-type dropdown from the canonical service list.
    var typeSel = $('#addChargeTreatmentType');
    if (typeSel) {
      typeSel.innerHTML = '<option value="">—</option>' +
        SERVICE_TYPES.map(function (s) {
          return '<option value="' + escapeHtml(s) + '">' + escapeHtml(serviceLabel(s)) + '</option>';
        }).join('');
    }
    updateAddChargeBillingDayVisibility(form);
    $('#addChargeModal').hidden = false;
  }
  function closeAddChargeModal() {
    var m = $('#addChargeModal');
    if (m) m.hidden = true;
    addChargeClientId = null;
  }
  // --- Renew & pay modal -------------------------------------------------
  // Records next month's base payment as paid-in-advance with a manual amount,
  // and sets that amount as the client's new going-forward monthly default.
  // Service-type / sessions changes stay in the ✏️ ערוך modal — this is amount only.
  var renewClientId = null;
  function openRenewModal(client) {
    renewClientId = client.id;
    var form = $('#renewForm');
    if (!form) return;
    form.reset();
    // The billed month comes from renewalInfo(c).renewalDate via the shared
    // helper, so the modal can never diverge from the renewal banner.
    var renewalDate = nextRenewalDueDate(client);
    $('#renewClientName').textContent = 'חידוש עבור: ' + (client.name || '') +
      (renewalDate ? ' — ' + monthLabel(renewalDate) : '');
    form.renewAmount.value = client.pricePerSession || '';
    $('#renewModal').hidden = false;
  }
  function closeRenewModal() {
    var m = $('#renewModal');
    if (m) m.hidden = true;
    renewClientId = null;
  }

  // --- Change package modal (שינוי חבילה) --------------------------------
  // Updates the client's pricePerSession + sessionsPerWeek and stamps
  // packageChangeDate, which re-anchors the renewal cycle (גבייה הבאה =
  // packageChangeDate + 1 month). paymentDate is left untouched. Weekly sessions
  // use the SAME per-service host as the ✏️ ערוך modal (one input per existing
  // service type) so a multi-service breakdown is preserved, not collapsed to a
  // total. Service TYPES are not editable here — that stays in ✏️ ערוך.
  var changePackageClientId = null;
  function openChangePackageModal(client) {
    changePackageClientId = client.id;
    var form = $('#changePackageForm');
    if (!form) return;
    form.reset();
    $('#changePackageClientName').textContent = 'שינוי חבילה עבור: ' + (client.name || '');
    if (form.changeDate) form.changeDate.value = client.packageChangeDate || today();
    if (form.newPrice) form.newPrice.value = client.pricePerSession || '';
    var host = $('[data-host="changePackageSessions"]', form);
    if (host) renderSessionsHost(host, client.serviceType, client.sessionsPerWeek);
    $('#changePackageModal').hidden = false;
  }
  function closeChangePackageModal() {
    var m = $('#changePackageModal');
    if (m) m.hidden = true;
    changePackageClientId = null;
  }

  function updateAddChargeBillingDayVisibility(form) {
    if (!form) return;
    var type = form.billingType && form.billingType.value;
    var wrap = $('#addChargeBillingDayWrap');
    var freqWrap = $('#addChargeFreqWrap');
    if (wrap) {
      if (type === 'monthly') wrap.classList.remove('field-hidden');
      else wrap.classList.add('field-hidden');
    }
    // Days/week only makes sense for a recurring (monthly) treatment, not a
    // one-time charge.
    if (freqWrap) {
      if (type === 'monthly') freqWrap.classList.remove('field-hidden');
      else freqWrap.classList.add('field-hidden');
    }
  }

  function handleRemoveCharge(chargeId) {
    if (state.role !== 'editor') return;
    var charge = state.charges.find(function (c) { return c.id === chargeId; });
    if (!charge) return;
    if (!confirm('להסיר חיוב זה?\n' + (charge.description || ''))) return;
    var prevCharges = state.charges.slice();
    state.charges = state.charges.filter(function (c) { return c.id !== chargeId; });
    render();
    persistRemoveCharge(chargeId)
      .then(function () { toast('החיוב הוסר'); })
      .catch(function (e) {
        state.charges = prevCharges;
        render();
        toast('שגיאה: ' + e.message, true);
      });
  }

  function openSettingsModal() {
    var form = $('#settingsForm');
    if (!form) return;
    form.reset();
    var s = state.settings || {};
    form.bankName.value = s.bankName || '';
    form.bankBranch.value = s.bankBranch || '';
    form.bankAccount.value = s.bankAccount || '';
    form.bankHolder.value = s.bankHolder || '';
    $('#settingsModal').hidden = false;
  }
  function closeSettingsModal() { $('#settingsModal').hidden = true; }

  // --- auth
  function applyRole() {
    document.body.classList.toggle('viewer', state.role !== 'editor');
  }
  function showPin() {
    $('#pinScreen').hidden = false;
    $('#app').hidden = true;
    $('#pinInput').value = '';
    $('#pinInput').focus();
  }
  function enterApp() {
    var pin = $('#pinScreen');
    var app = $('#app');
    if (pin) pin.hidden = true;
    if (app) app.hidden = false;
    applyRole();
    setView('dashboard');
  }

  // --- init
  // Existing clients predate the Clients `phone` column, so their stored phone
  // is blank. Recover it in memory from the originating lead (Leads keeps its
  // canonical phone) — making them matchable for cross-app flows now, without a
  // destructive migration; it persists on the next normal save.
  function backfillClientPhones() {
    if (!Array.isArray(state.clients) || !Array.isArray(state.leads)) return;
    var leadById = {};
    state.leads.forEach(function (l) { if (l && l.id) leadById[l.id] = l; });
    state.clients.forEach(function (c) {
      if (!c) return;
      var own = recoverPhone(c.phone);
      if (own) { c.phone = own; return; } // already has a stored phone
      var lead = c.fromLead ? leadById[c.fromLead] : null;
      if (lead) c.phone = recoverPhone(lead.phone);
    });
  }

  async function loadAll() {
    try {
      var data = await apiLoad();
      state.leads = (data.leads || []).map(normalizeLeadFromSheet);
      state.clients = (data.clients || []).map(normalizeClientFromSheet);
      // One-time cleanup: a converted lead has no further meaning. Remove any lead
      // that already has a matching client (linked by fromLead). If we removed any,
      // persist the trimmed leads list back so the duplication is fixed permanently.
      (function cleanupConvertedLeads() {
        var clientLeadIds = {};
        state.clients.forEach(function (c) { if (c.fromLead) clientLeadIds[c.fromLead] = true; });
        var before = state.leads.length;
        state.leads = state.leads.filter(function (l) { return !clientLeadIds[l.id]; });
        if (state.leads.length !== before) {
          console.log('[ezone] removed', before - state.leads.length, 'converted leads');
          persist().catch(function (e) { console.warn('[ezone] cleanup persist failed:', e.message); });
        }
      })();
      backfillClientPhones();
      try {
        var pr = await apiGetPayments();
        state.payments = (pr.payments || []).map(normalizePaymentFromSheet).filter(function (p) { return !!p.id; });
      } catch (pe) {
        console.warn('[ezone] getPayments failed, assuming empty:', pe.message);
        state.payments = [];
      }
      try {
        var cr = await apiGetCharges();
        state.charges = (cr.charges || []).map(normalizeChargeFromSheet).filter(function (c) { return !!c.id; });
      } catch (ce) {
        console.warn('[ezone] getCharges failed, assuming empty:', ce.message);
        state.charges = [];
      }
      try {
        var sf = await apiGetStopFlags();
        state.stopFlags = (sf.stopFlags || []).map(normalizeStopFlagFromSheet).filter(function (f) { return !!f.id; });
      } catch (sfe) {
        console.warn('[ezone] getStopFlags failed, assuming empty:', sfe.message);
        state.stopFlags = [];
      }
      try {
        var er = await apiGetExtraRequests();
        state.extraRequests = (er.requests || []).filter(function (r) { return !!r.id; });
      } catch (ere) {
        console.warn('[ezone] getExtraSessionRequests failed, assuming empty:', ere.message);
        state.extraRequests = [];
      }
      try {
        var s = await apiLoadSettings();
        state.settings = {
          bankName: s.bankName || '',
          bankBranch: s.bankBranch || '',
          bankAccount: s.bankAccount || '',
          bankHolder: s.bankHolder || ''
        };
      } catch (_) {}
      state.loaded = true;
      render();
    } catch (e) {
      toast('שגיאה בטעינת הנתונים: ' + e.message, true);
      throw e;
    }
  }

  function on(sel, ev, fn) {
    var el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) { console.warn('[ezone] missing element for', sel); return; }
    el.addEventListener(ev, fn);
  }

  function wireEvents() {
    on('#pinSubmit', 'click', function () {
      var input = $('#pinInput');
      var v = (input && input.value || '').trim();
      if (v === '2107') {
        try { sessionStorage.setItem('ez_role', 'editor'); } catch (_) {}
        state.role = 'editor';
        enterApp();
      } else {
        var err = $('#pinError'); if (err) err.hidden = false;
      }
    });
    on('#pinInput', 'keydown', function (e) {
      var err = $('#pinError'); if (err) err.hidden = true;
      if (e.key === 'Enter') { e.preventDefault(); var btn = $('#pinSubmit'); if (btn) btn.click(); }
    });
    on('#pinViewer', 'click', function () {
      try { sessionStorage.setItem('ez_role', 'viewer'); } catch (_) {}
      state.role = 'viewer';
      enterApp();
    });
    on('#logoutBtn', 'click', function () {
      try { sessionStorage.removeItem('ez_role'); } catch (_) {}
      state.role = 'viewer';
      showPin();
    });

    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { setView(t.dataset.view); }); });
    on('#refreshBtn', 'click', function () { loadAll().then(function () { toast('רועננו'); }).catch(function () {}); });
    on('#settingsBtn', 'click', function () { openSettingsModal(); });
    var renewalsBox = $('#renewalsAlerts');
    if (renewalsBox) renewalsBox.addEventListener('click', handleRenewalActionClick);
    var stopFlagsBox = $('#stopFlagsAlerts');
    if (stopFlagsBox) stopFlagsBox.addEventListener('click', handleStopFlagClick);
    var extraBox = $('#extraRequestsAlerts');
    if (extraBox) extraBox.addEventListener('click', handleExtraRequestClick);
    var dupReportBox = $('#duplicateClientsReport');
    if (dupReportBox) dupReportBox.addEventListener('click', handleDuplicateReportClick);
    var mergeConfirmBtn = $('#mergeClientsConfirm');
    if (mergeConfirmBtn) mergeConfirmBtn.addEventListener('click', performMergeClients);
    on('#leadsSearch', 'input', function (e) { state.leadSearch = e.target.value; renderLeads(); });
    on('#addLeadBtn', 'click', function () { openLeadModal(null); });
    on('#clientsSearch', 'input', function (e) { state.clientSearch = e.target.value; renderClients(); });
    on('#retentionSearch', 'input', function (e) { state.retentionSearch = e.target.value; renderRetention(); });
    on('#billingSearch', 'input', function (e) { state.billingSearch = e.target.value; renderBilling(); });
    on('#addClientBtn', 'click', function () { openDirectClientModal(); });
    on('#billingDate', 'change', function (e) { state.billingDate = e.target.value || today(); renderBilling(); });

    // Therapist payouts: month picker, detail toggle, correct, mark-forwarded,
    // add-missing-session, and Excel export.
    on('#payoutMonth', 'change', function (e) {
      state.payoutMonth = e.target.value || currentMonthStr();
      renderPayouts();
    });
    on('#payoutList', 'click', handlePayoutListClick);
    on('#payoutExportBtn', 'click', exportPayoutCsv);
    on('#payoutAddSessionBtn', 'click', function () { openSessionModal(null); });
    var clinicalSel = $('#sessionClinicalType');
    if (clinicalSel) clinicalSel.addEventListener('change', updateSessionFreqVisibility);
    var sessionForm = $('#sessionForm');
    if (sessionForm) sessionForm.addEventListener('submit', submitSessionForm);

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeLeadModal(); closeAgreementModal(); closeActivateModal(); closeExitModal(); closeDirectClientModal(); closeEditClientModal(); closeSettingsModal(); closeNotRelevantReasonModal(); closeRemoveLeadModal(); closeDuplicateLeadModal(); closeAddChargeModal(); closeRenewModal(); closeChangePackageModal(); closeMergeClientsModal(); closeSessionModal();
      });
    });

    var acTypeSel = $('#addChargeForm select[name="billingType"]');
    if (acTypeSel) acTypeSel.addEventListener('change', function () {
      updateAddChargeBillingDayVisibility($('#addChargeForm'));
    });

    var addChargeForm = $('#addChargeForm');
    if (addChargeForm) addChargeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#addChargeSubmit');
      if (submit.disabled) return;
      if (!addChargeClientId) return;
      var client = state.clients.find(function (c) { return c.id === addChargeClientId; });
      if (!client) { toast('מטופל לא נמצא', true); return; }
      var fd = new FormData(e.target);
      var billingType = (fd.get('billingType') || 'one_time').toString();
      var description = (fd.get('description') || '').trim();
      var amount = toNum(fd.get('amount'));
      var chargeDate = fd.get('chargeDate') || '';
      var billingDay = fd.get('billingDay');
      var notes = (fd.get('notes') || '').trim();
      var treatmentType = (fd.get('treatmentType') || '').toString().trim();
      var frequencyPerWeek = fd.get('frequencyPerWeek');
      var chargePaid = !!fd.get('chargePaid');
      if (!description) { toast('חסר תיאור', true); return; }
      if (!amount || amount <= 0) { toast('יש להזין סכום', true); return; }
      if (!chargeDate) { toast('יש להזין תאריך', true); return; }
      submit.disabled = true;
      var charge = {
        id: uid(),
        clientId: client.id,
        description: description,
        amount: amount,
        billingType: billingType === 'monthly' ? 'monthly' : 'one_time',
        treatmentType: treatmentType,
        frequencyPerWeek: (billingType === 'monthly' && frequencyPerWeek) ? toNum(frequencyPerWeek) : '',
        chargeDate: chargeDate,
        billingDay: billingType === 'monthly' && billingDay ? toNum(billingDay) : '',
        active: true,
        notes: notes,
        created: today()
      };
      state.charges.push(charge);
      // If marked paid, create the charge's payment row up front (same row
      // chargeStatusFor reads), so it shows שולם immediately — no extra click.
      var paidRow = null;
      if (chargePaid) {
        var pid = paymentId(client, today(), 'extra', charge.id);
        paidRow = {
          id: pid, clientId: client.id, clientName: client.name || '',
          billingType: 'extra', dueDate: today(),
          amountDue: amount, amountPaid: amount, status: 'paid',
          paymentDate: today(), method: '', notes: '',
          bundleSize: 0, sessionsUsed: 0
        };
        state.payments.push(paidRow);
      }
      render();
      persistCharge(charge)
        .then(function () {
          if (paidRow) return persistPayment(paidRow).catch(function () {
            toast('הטיפול נוסף, אך סימון התשלום לא נשמר — סמנ/י ידנית', true);
          });
        })
        .then(function () { toast('הטיפול נוסף'); closeAddChargeModal(); })
        .catch(function (err) {
          state.charges = state.charges.filter(function (c) { return c.id !== charge.id; });
          if (paidRow) state.payments = state.payments.filter(function (p) { return p.id !== paidRow.id; });
          render();
          toast('שגיאה: ' + err.message, true);
        })
        .finally(function () { submit.disabled = false; });
    });

    var renewForm = $('#renewForm');
    if (renewForm) renewForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#renewSubmit');
      if (submit.disabled) return;
      if (!renewClientId) return;
      var c = state.clients.find(function (x) { return x.id === renewClientId; });
      if (!c) { toast('מטופל לא נמצא', true); return; }
      // Same shared helper as the renewal banner — never recompute today()+1mo.
      var renewalDate = nextRenewalDueDate(c);
      if (!renewalDate) { toast('לא ניתן לחשב תאריך חידוש', true); return; }
      var fd = new FormData(e.target);
      var amount = toNum(fd.get('renewAmount'));
      if (!amount || amount <= 0) { toast('יש להזין סכום', true); return; }
      submit.disabled = true;

      // ORDERING IS DELIBERATE: persist the client default FIRST, payment
      // SECOND. A half-applied clear-and-rewrite of clients/leads is the worse
      // failure mode; the payment row is idempotent (deterministic id) and
      // safely re-clickable, so it is the safer step to leave for retry.
      var prev = { pricePerSession: c.pricePerSession };
      c.pricePerSession = amount;
      persist()
        .then(function () {
          var payment = {
            id: paymentId(c, renewalDate, 'base'),
            clientId: c.id, clientName: c.name, billingType: 'monthly',
            dueDate: renewalDate, amountDue: amount, amountPaid: amount,
            status: 'paid', paymentDate: today(), method: '', notes: '',
            bundleSize: '', sessionsUsed: ''
          };
          return persistPayment(payment)
            .then(function () {
              // Upsert by id so גבייה reflects it without a reload.
              var idx = state.payments.findIndex(function (p) { return p.id === payment.id; });
              if (idx >= 0) state.payments[idx] = payment;
              else state.payments.push(payment);
              toast('חודש שולם מראש');
              closeRenewModal();
              render();
            })
            .catch(function (err) {
              // The client default change is legitimately saved — do NOT roll
              // it back. The payment can be retried via גבייה or by clicking
              // the button again (same deterministic id, no duplicate).
              toast('הסכום עודכן אך רישום התשלום נכשל, נסה שוב: ' + err.message, true);
              render();
            });
        })
        .catch(function (err) {
          // Client persist failed: roll back the in-memory change and abort
          // (do not write the payment).
          Object.assign(c, prev);
          toast('שגיאה: ' + err.message, true);
          render();
        })
        .finally(function () { submit.disabled = false; });
    });

    var changePackageForm = $('#changePackageForm');
    if (changePackageForm) changePackageForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#changePackageSubmit');
      if (submit.disabled) return;
      if (!changePackageClientId) return;
      var c = state.clients.find(function (x) { return x.id === changePackageClientId; });
      if (!c) { toast('מטופל לא נמצא', true); return; }
      var fd = new FormData(e.target);
      var changeDate = fmtDate(fd.get('changeDate'));
      if (!changeDate) { toast('יש לבחור תאריך שינוי', true); return; }
      var newPrice = toNum(fd.get('newPrice'));
      if (!newPrice || newPrice <= 0) { toast('יש להזין מחיר', true); return; }
      // Per-service breakdown from the host, keyed by the client's existing
      // services (types are fixed in this modal) — same shape as ✏️ ערוך.
      var host = $('[data-host="changePackageSessions"]', e.target);
      var services = parseServices(c.serviceType);
      var raw = host ? readSessionsHost(host) : {};
      var newSessions = {};
      services.forEach(function (s) { newSessions[s] = wholeSessions(raw[s] || 0); });
      var totalSess = services.reduce(function (n, s) { return n + newSessions[s]; }, 0);
      if (!totalSess) { toast('יש להזין מספר מפגשים', true); return; }
      submit.disabled = true;

      // Snapshot for rollback if persist fails.
      var prev = {
        pricePerSession: c.pricePerSession,
        sessionsPerWeek: c.sessionsPerWeek,
        packageChangeDate: c.packageChangeDate
      };
      c.pricePerSession = newPrice;
      c.sessionsPerWeek = newSessions;
      c.packageChangeDate = changeDate;
      persist()
        .then(function () {
          toast('החבילה עודכנה');
          closeChangePackageModal();
          render();
        })
        .catch(function (err) {
          Object.assign(c, prev);
          toast('שגיאה: ' + err.message, true);
          render();
        })
        .finally(function () { submit.disabled = false; });
    });

    // Direct-add client wiring
    (function wireDirectClient() {
      var f = $('#directClientForm');
      if (!f) return;
      var group = $('[data-group="serviceType"]', f);
      if (group) {
        group.addEventListener('change', function () {
          var picked = readServiceGroup(group);
          var host = $('[data-host="directSessions"]', f);
          var current = readSessionsHost(host);
          renderSessionsHost(host, formatServices(picked), current);
          updateLocationVisibilityForDirect(f);
        });
      }
    })();

    var directForm = $('#directClientForm');
    if (directForm) directForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#directClientSubmit');
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        var form = e.target;
        var fd = new FormData(form);
        var group = $('[data-group="serviceType"]', form);
        var services = readServiceGroup(group);
        if (!services.length) { toast('יש לבחור לפחות סוג טיפול אחד', true); submit.disabled = false; return; }
        var isDayCenter = hasDayCenter(services);
        var name = (fd.get('name') || '').trim();
        if (!name) { toast('חסר שם', true); submit.disabled = false; return; }
        var directPhone = acceptPhone(fd.get('phone') || '', 'טלפון', 'mobile', false);
        if (directPhone === false) { submit.disabled = false; return; }
        if (duplicateClientBlock(directPhone, null)) { submit.disabled = false; return; }
        var startDate = fd.get('startDate') || today();
        var monthlyAmount = toNum(fd.get('monthlyAmount'));
        if (!monthlyAmount) { toast('יש להזין סכום חודשי', true); submit.disabled = false; return; }
        var host = $('[data-host="directSessions"]', form);
        var breakdown = readSessionsHost(host);
        var clean = {};
        services.forEach(function (s) { clean[s] = wholeSessions(breakdown[s] || 0); });
        var bd = fd.get('billingDay');
        var bdDay = bd ? dayOfMonth(bd) : null;
        var payStatus = fd.get('paymentStatus') || '';
        var payDate = fd.get('paymentDate') || '';
        if ((payStatus === 'paid' || payStatus === 'partial') && !payDate) {
          toast('יש להזין תאריך תשלום', true);
          submit.disabled = false;
          return;
        }
        var nextBill = payDate ? addDays(payDate, 30) : (startDate ? addDays(startDate, 30) : '');
        var client = {
          id: uid(), name: name, phone: directPhone,
          serviceType: formatServices(services),
          location: (fd.get('location') || ''),
          sessionsPerWeek: clean, pricePerSession: monthlyAmount,
          startDate: startDate, status: 'פעיל', exitDate: '',
          fromLead: '', source: 'direct_admin',
          notes: (fd.get('notes') || '').trim(),
          billingType: 'monthly',
          billingDay: bdDay || dayOfMonth(startDate) || '',
          paymentStatus: payStatus,
          paymentDate: payDate,
          nextBillingDate: nextBill,
          house_of_origin: (fd.get('house_of_origin') || '').trim()
        };
        state.clients.push(client);
        // Mirror an already-paid/partial intake into a current-month payment ROW
        // so the patient-card badge shows paid automatically (it reads payment
        // rows, not client.paymentStatus). Same shape as setCurrentMonthPaid.
        var directIntakePayment = null;
        if (payStatus === 'paid' || payStatus === 'partial') {
          var dDue = currentMonthBaseDueDate(client);
          var dAmount = clientAmountDue(client) || 0;
          directIntakePayment = {
            id: paymentId(client, dDue, 'base'),
            clientId: client.id,
            clientName: client.name || '',
            billingType: 'monthly',
            dueDate: dDue,
            amountDue: dAmount,
            amountPaid: payStatus === 'paid' ? dAmount : 0,
            status: payStatus,
            paymentDate: payDate || today(),
            method: '', notes: '',
            bundleSize: 0, sessionsUsed: 0
          };
          var dIdx = state.payments.findIndex(function (p) { return p.id === directIntakePayment.id; });
          if (dIdx >= 0) state.payments[dIdx] = directIntakePayment;
          else state.payments.push(directIntakePayment);
        }
        persist()
          .then(function () {
            // Save the payment row through its own path (persist() saves only
            // leads+clients). Non-fatal — client is already saved.
            if (directIntakePayment) {
              return persistPayment(directIntakePayment).catch(function () {
                toast('המטופל נוסף, אך סימון התשלום לא נשמר — סמנ/י ידנית', true);
              });
            }
          })
          .then(function () { toast('המטופל נוסף'); closeDirectClientModal(); render(); })
          .catch(function (err) {
            state.clients = state.clients.filter(function (x) { return x.id !== client.id; });
            render(); toast('שגיאה: ' + err.message, true);
          })
          .finally(function () { submit.disabled = false; });
      } catch (e2) { toast('שגיאה: ' + e2.message, true); submit.disabled = false; }
    });

    $('#leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#leadFormSubmit');
      if (submit.disabled) return;
      var form = e.target;
      var group = $('[data-group="serviceType"]', form);
      if (!readServiceGroup(group).length) { toast('יש לבחור לפחות סוג טיפול אחד', true); return; }
      if (acceptPhone((form.phone && form.phone.value) || '', 'טלפון', 'mobile', true) === false) return;
      submit.disabled = true;
      function runAddFlow() {
        submit.disabled = true;
        addLeadFromForm(form);
        persist()
          .then(function () { toast('נשמר'); closeLeadModal(); render(); })
          .catch(function (err) { toast('שגיאה: ' + err.message, true); })
          .finally(function () { submit.disabled = false; });
      }
      if (editingLeadId) {
        var lead = state.leads.find(function (l) { return l.id === editingLeadId; });
        if (!lead) { submit.disabled = false; return; }
        updateLeadFromForm(lead, form);
        persist()
          .then(function () { toast('נשמר'); closeLeadModal(); render(); })
          .catch(function (err) { toast('שגיאה: ' + err.message, true); })
          .finally(function () { submit.disabled = false; });
      } else {
        var newPhoneNorm = normalizePhone((form.phone && form.phone.value) || '');
        var existing = newPhoneNorm ? state.leads.find(function (l) {
          if (!l || l.stage === 'removed') return false;
          return normalizePhone(l.phone || '') === newPhoneNorm;
        }) : null;
        if (existing) {
          submit.disabled = false;
          openDuplicateLeadModal(existing, runAddFlow);
        } else {
          runAddFlow();
        }
      }
    });

    $('#agreementForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#agreementSubmit');
      if (submit.disabled) return;
      submit.disabled = true;
      var lead = state.leads.find(function (l) { return l.id === agreementLeadId; });
      if (!lead) { submit.disabled = false; return; }
      var fd = new FormData(e.target);
      var host = $('[data-host="agreementSessions"]', e.target);
      lead.sessionsPerWeek = readSessionsHost(host);
      lead.pricePerSession = toNum(fd.get('pricePerSession'));
      var agPayStatus = fd.get('paymentStatus') || '';
      var agPayDate = fd.get('paymentDate') || '';
      if ((agPayStatus === 'paid' || agPayStatus === 'partial') && !agPayDate) {
        toast('יש להזין תאריך תשלום', true);
        submit.disabled = false;
        return;
      }
      if (agPayStatus) lead.paymentStatus = agPayStatus;
      if (agPayDate) {
        lead.paymentDate = agPayDate;
        lead.nextBillingDate = addDays(agPayDate, 30);
      }
      if (agreementAdvance) lead.stage = 'agreement';
      persist()
        .then(function () { toast('נשמר'); closeAgreementModal(); render(); })
        .catch(function (err) { toast('שגיאה: ' + err.message, true); })
        .finally(function () { submit.disabled = false; });
    });

    // Activate form — now includes payment fields
    $('#activateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#activateSubmit');
      if (submit.disabled) return;
      submit.disabled = true;
      var lead = state.leads.find(function (l) { return l.id === activateLeadId; });
      if (!lead) { submit.disabled = false; return; }
      if (duplicateClientBlock(lead.phone, null)) { submit.disabled = false; return; }
      var fd = new FormData(e.target);
      var group = $('[data-group="serviceType"]', e.target);
      var services = readServiceGroup(group);
      if (!services.length) { submit.disabled = false; toast('יש לבחור לפחות סוג טיפול אחד', true); return; }
      var host = $('[data-host="activateSessions"]', e.target);
      var breakdown = readSessionsHost(host);
      var cleanBreakdown = {};
      services.forEach(function (s) { cleanBreakdown[s] = wholeSessions(breakdown[s] || 0); });
      var isDayCenter = hasDayCenter(services);
      var startDate = fd.get('startDate') || today();
      var payStatus = fd.get('paymentStatus') || 'unpaid';
      var payDate = fd.get('paymentDate') || '';
      if ((payStatus === 'paid' || payStatus === 'partial') && !payDate) {
        submit.disabled = false;
        toast('יש להזין תאריך תשלום', true);
        return;
      }
      var nextBill = payDate ? addDays(payDate, 30) : addDays(startDate, 30);

      var client = {
        id: uid(), name: lead.name, phone: recoverPhone(lead.phone),
        serviceType: formatServices(services),
        location: (fd.get('location') || lead.location),
        sessionsPerWeek: cleanBreakdown,
        pricePerSession: toNum(fd.get('pricePerSession')),
        startDate: startDate,
        status: 'פעיל', exitDate: '', fromLead: lead.id,
        source: 'lead', notes: '', billingType: 'monthly',
        billingDay: dayOfMonth(startDate) || '',
        paymentStatus: payStatus,
        paymentDate: payDate,
        nextBillingDate: nextBill,
        house_of_origin: lead.house_of_origin || ''
      };
      state.clients.push(client);
      var intakePaymentToPersist = null;
      // When the patient is added already paid/partial, mirror that into a
      // current-month payment ROW — the paid/unpaid badge on the patient page is
      // computed from payment rows, not from client.paymentStatus. Without this
      // the intake «שולם» didn't surface and Vered had to re-mark it manually.
      // Same row shape as setCurrentMonthPaid; the button stays editable after.
      if (payStatus === 'paid' || payStatus === 'partial') {
        var intakeDue = currentMonthBaseDueDate(client);
        var intakeAmount = clientAmountDue(client) || 0;
        var intakePayment = {
          id: paymentId(client, intakeDue, 'base'),
          clientId: client.id,
          clientName: client.name || '',
          billingType: 'monthly',
          dueDate: intakeDue,
          amountDue: intakeAmount,
          amountPaid: payStatus === 'paid' ? intakeAmount : 0,
          status: payStatus,
          paymentDate: payDate || today(),
          method: '', notes: '',
          bundleSize: 0, sessionsUsed: 0
        };
        var exIdx = state.payments.findIndex(function (p) { return p.id === intakePayment.id; });
        if (exIdx >= 0) state.payments[exIdx] = intakePayment;
        else state.payments.push(intakePayment);
        intakePaymentToPersist = intakePayment;
      }
    // Lead has converted to a client. The lead record has no further meaning,
      // so remove it from state — persist() (clear-and-rewrite) drops it from the sheet.
      state.leads = state.leads.filter(function (x) { return x.id !== lead.id; });
      persist()
        .then(function () {
          // Save the intake payment row through its own path (persist() doesn't
          // cover payments). Non-fatal if it fails — the client is already saved.
          if (intakePaymentToPersist) {
            return persistPayment(intakePaymentToPersist).catch(function (e) {
              toast('המטופל נוסף, אך סימון התשלום לא נשמר — סמנ/י ידנית', true);
            });
          }
        })
        .then(function () { toast('המטופל נוסף'); closeActivateModal(); setView('clients'); })
        .catch(function (err) { toast('שגיאה: ' + err.message, true); })
        .finally(function () { submit.disabled = false; });
    });

    $('#exitForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#exitSubmit');
      if (submit.disabled) return;
      submit.disabled = true;
      var client = state.clients.find(function (c) { return c.id === exitClientId; });
      if (!client) { submit.disabled = false; return; }
      var fd = new FormData(e.target);
      var dischargedId = client.id;
      client.status = 'סיים טיפול';
      client.exitDate = fd.get('exitDate') || today();
      persist()
        .then(function () {
          // Vered confirmed the discharge → resolve any pending stop-flags for
          // this client. Best-effort; the discharge itself already succeeded.
          return resolveStopFlagsForClient(dischargedId);
        })
        .then(function () { toast('סיום נשמר'); closeExitModal(); render(); })
        .catch(function (err) { toast('שגיאה: ' + err.message, true); })
        .finally(function () { submit.disabled = false; });
    });

    var nrrForm = $('#notRelevantReasonForm');
    if (nrrForm) nrrForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var reason = (fd.get('not_relevant_reason') || '').trim();
      if (!NOT_RELEVANT_REASON_LABELS[reason]) { toast('יש לבחור סיבה', true); return; }
      var lead = state.leads.find(function (l) { return l.id === notRelevantLeadId; });
      if (!lead) { closeNotRelevantReasonModal(); return; }
      var note = (fd.get('not_relevant_note') || '').trim().slice(0, 500);
      var prev = { stage: lead.stage, not_relevant_reason: lead.not_relevant_reason, not_relevant_note: lead.not_relevant_note };
      lead.stage = 'not_relevant';
      lead.not_relevant_reason = reason;
      lead.not_relevant_note = note;
      persist()
        .then(function () { toast('סומן כלא רלוונטי'); closeNotRelevantReasonModal(); render(); })
        .catch(function (err) {
          // Revert on persist failure so the UI matches what's actually saved.
          lead.stage = prev.stage;
          lead.not_relevant_reason = prev.not_relevant_reason;
          lead.not_relevant_note = prev.not_relevant_note;
          toast('שגיאה: ' + err.message, true);
        });
    });

    var rlForm = $('#removeLeadForm');
    if (rlForm) rlForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var lead = state.leads.find(function (l) { return l.id === removingLeadId; });
      if (!lead) { closeRemoveLeadModal(); return; }
      var prevLeads = state.leads.slice();
      state.leads = state.leads.filter(function (l) { return l.id !== lead.id; });
      persistRemoveLead(lead)
        .then(function () {
          toast('הליד הוסר', true);
          closeRemoveLeadModal();
          render();
        })
        .catch(function (err) {
          state.leads = prevLeads;
          toast('שגיאה: ' + err.message, true);
          render();
        });
    });

    var dupForm = $('#duplicateLeadForm');
    if (dupForm) dupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pending = pendingDuplicateLead;
      closeDuplicateLeadModal();
      if (pending && typeof pending.onConfirm === 'function') pending.onConfirm();
    });

    var editForm = $('#editClientForm');
    if (editForm) editForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#editClientSubmit');
      if (submit.disabled) return;
      submit.disabled = true;
      var client = state.clients.find(function (c) { return c.id === editClientId; });
      if (!client) { submit.disabled = false; return; }
      var fd = new FormData(e.target);
      var ptPhone = acceptPhone(fd.get('phone') || '', 'טלפון מטופל', 'mobile', false);
      if (ptPhone === false) { submit.disabled = false; return; }
      var tcPhone = acceptPhone(fd.get('treatmentContactPhone') || '', 'טלפון אחראי טיפול', 'mobile', false);
      if (tcPhone === false) { submit.disabled = false; return; }
      var pyPhone = acceptPhone(fd.get('payerPhone') || '', 'טלפון גורם משלם', 'payer', false);
      if (pyPhone === false) { submit.disabled = false; return; }
      // Block on the patient-identity phones (the patient's own number and the
      // treatment-contact phone), excluding this client. payerPhone is
      // intentionally not deduped (shared payers).
      if (duplicateClientBlock(ptPhone, client.id)) { submit.disabled = false; return; }
      if (duplicateClientBlock(tcPhone, client.id)) { submit.disabled = false; return; }
      var prev = {
        name: client.name,
        location: client.location,
        phone: client.phone,
        treatmentContactPhone: client.treatmentContactPhone,
        payerName: client.payerName, payerPhone: client.payerPhone,
        paymentLink: client.paymentLink,
        paymentStatus: client.paymentStatus, paymentDate: client.paymentDate,
        pricePerSession: client.pricePerSession,
        serviceType: client.serviceType, sessionsPerWeek: client.sessionsPerWeek,
        nextBillingDate: client.nextBillingDate,
        house_of_origin: client.house_of_origin, notes: client.notes
      };
      var newName = (fd.get('name') || '').trim();
      if (newName) client.name = newName;
      client.phone = ptPhone;
      if (fd.has('location')) {
        client.location = (fd.get('location') || '').trim();
      }
      client.treatmentContactPhone = tcPhone;
      client.payerName = (fd.get('payerName') || '').trim();
      client.payerPhone = pyPhone;
      client.paymentLink = (fd.get('paymentLink') || '').trim();
      var ps = fd.get('paymentStatus') || '';
      if (ps) client.paymentStatus = ps;
      var pd = fd.get('paymentDate') || '';
      if (pd) client.paymentDate = pd;
      var amt = toNum(fd.get('monthlyAmount'));
      if (amt) client.pricePerSession = amt;
      // house_of_origin: allow setting OR clearing (user may correct a wrong value).
      if (fd.has('house_of_origin')) client.house_of_origin = (fd.get('house_of_origin') || '').trim();
      // notes: allow setting OR clearing.
      if (fd.has('notes')) client.notes = (fd.get('notes') || '').trim();
      // Treatment plan: service types + sessions per week
      var ecGroup2 = $('[data-group="serviceType"]', e.target);
      var ecHost2 = $('[data-host="editClientSessions"]', e.target);
      if (ecGroup2 && ecHost2) {
        var pickedSvc = readServiceGroup(ecGroup2);
        if (pickedSvc.length) {
          var bd = readSessionsHost(ecHost2);
          var cleanBd = {};
          pickedSvc.forEach(function (s) { cleanBd[s] = wholeSessions(bd[s] || 0); });
          client.serviceType = formatServices(pickedSvc);
          client.sessionsPerWeek = cleanBd;
        }
      }
      // Recalculate next billing date from payment date (+30 days), as on activate
      if (client.paymentDate) {
        client.nextBillingDate = addDays(client.paymentDate, 30);
      }
      persist()
        .then(function () { toast('נשמר'); closeEditClientModal(); render(); })
        .catch(function (err) {
          Object.assign(client, prev);
          toast('שגיאה: ' + err.message, true);
          render();
        })
        .finally(function () { submit.disabled = false; });
    });

    var settingsForm = $('#settingsForm');
    if (settingsForm) settingsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#settingsSubmit');
      if (submit.disabled) return;
      submit.disabled = true;
      var fd = new FormData(e.target);
      var next = {
        bankName: (fd.get('bankName') || '').trim(),
        bankBranch: (fd.get('bankBranch') || '').trim(),
        bankAccount: (fd.get('bankAccount') || '').trim(),
        bankHolder: (fd.get('bankHolder') || '').trim()
      };
      apiSaveSettings(next)
        .then(function () {
          state.settings = next;
          toast('הגדרות נשמרו');
          closeSettingsModal();
        })
        .catch(function (err) { toast('שגיאה: ' + err.message, true); })
        .finally(function () { submit.disabled = false; });
    });
  }

  function init() {
    try { wireEvents(); } catch (e) { console.error('[ezone] wireEvents failed', e); }
    var saved = null;
    try { saved = sessionStorage.getItem('ez_role'); } catch (_) {}
    if (saved === 'editor' || saved === 'viewer') { state.role = saved; enterApp(); }
    else { showPin(); }
    loadAll().catch(function () {});
  }

  function bootWhenReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  bootWhenReady();
})();
