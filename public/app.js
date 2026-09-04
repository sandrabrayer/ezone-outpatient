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
    external: 'חיצוני',
    // 'pardes' is the ecosystem's canonical id for רעננה הפרדס (what the
    // dashboard sends); the stable stored key here is raanana_pardes
    // (Code.gs remaps inbound createLead). Display alias so rows written
    // verbatim before the remap still label.
    pardes:   'רעננה הפרדס'
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
      Object.keys(v).forEach(function (k) { if (k !== '_units') out[k] = wholeSessions(v[k]); });
      return out;
    }
    var s = String(v).trim();
    if (s && s.charAt(0) === '{') {
      try {
        var parsed = JSON.parse(s);
        Object.keys(parsed).forEach(function (k) { if (k !== '_units') out[k] = wholeSessions(parsed[k]); });
        return out;
      } catch (_) {}
    }
    var list = parseServices(services);
    var n = wholeSessions(s);
    if (list.length === 1) { out[list[0]] = n; return out; }
    if (n) out._total = n;
    return out;
  }
  // Serialize the service→count breakdown, attaching any valid per-service unit
  // overrides under the reserved `_units` key (omitted when none apply, so
  // override-free records are unchanged). Mirrors charges-logic attachSessionsUnits.
  function formatSessionsBreakdown(b, units) {
    var obj = {};
    Object.keys(b || {}).forEach(function (k) { if (k !== '_units') obj[k] = b[k]; });
    var u = {};
    Object.keys(units || {}).forEach(function (k) {
      var val = String(units[k] == null ? '' : units[k]).trim();
      if (val === 'שבוע' || val === 'חודש') u[k] = val;
    });
    if (Object.keys(u).length) obj._units = u;
    return JSON.stringify(obj);
  }
  function totalSessions(v, services) {
    var b = parseSessionsBreakdown(v, services);
    return Object.keys(b).reduce(function (s, k) { return s + wholeSessions(b[k]); }, 0);
  }

  // --- state -------------------------------------------------------------
  var state = {
    role: 'viewer',
    user: '',       // the name inside this device's session cookie (GET /api/me); '' = user-less (legacy) session
    view: 'dashboard',
    leads: [],
    clients: [],
    payments: [],
    charges: [],
    stopFlags: [],  // stop-treatment flags from the therapists app (await confirmation)
    myStopAlerts: [], // this app's own stop/resume alert rows (id/clientId/status/type), seeded cross-session from getMyStopAlerts and updated optimistically — drives the sent/standing chip on overdue rows
    extraRequests: [], // over-package extra-session requests from the therapists app (await Vered approval)
    retained: [],   // lead-retention list (not_relevant + finished)
    removedClients: null, // un-restored Clients-removed tombstones; null = not yet fetched, 'loading' = in flight
    dataVersion: null, // Clients data version from getData, echoed back on saveAll (staleness signal); null = server didn't send one (fail-open: save never flagged stale)
    leadSearch: '',
    dashSearch: '',   // cross-tab patient locator on the dashboard (איתור מטופל)
    clientSearch: '',
    retentionSearch: '',
    inactiveSearch: '',
    billingSearch: '',
    clientTab: 'all',
    billingDate: '',
    sessionLog: null,    // SessionLog rows for the payout view; null = not yet fetched
    sessionLogLoading: false,
    sessionLogError: '',
    payoutMonth: '',     // 'YYYY-MM' for the payout view; defaults to current month
    payoutSearch: '',    // per-tab name search (therapist name) for the payout view
    payoutExpanded: {},  // therapist name -> expanded session detail (bool)
    continuationRoster: null, // admitted-patient roster (from dashboard); null = not yet fetched
    continuationRows: [],     // מסלול המשך workflow rows (from getContinuation)
    continuationLoading: false,
    continuationError: '',
    continuationSearch: '',
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
  // Session-frequency unit per treatment type — psychiatric follow-up is monthly,
  // all others weekly. Mirrors sessionFrequencyUnit in public/charges-logic.js.
  function sessionFrequencyUnit(serviceType) {
    return serviceType === 'מעקב פסיכיאטרי' ? 'חודש' : 'שבוע';
  }
  // Resolve the unit for a service: a valid per-patient override wins, else the
  // by-type default. Mirrors sessionUnitFor in public/charges-logic.js.
  function sessionUnitFor(serviceType, units) {
    var u = units && units[serviceType];
    return (u === 'שבוע' || u === 'חודש') ? u : sessionFrequencyUnit(serviceType);
  }
  // Extract per-service unit overrides from a stored sessionsPerWeek value
  // (object or JSON string); overrides live under the reserved `_units` key.
  // Mirrors parseSessionsUnits in public/charges-logic.js.
  function parseSessionsUnits(v) {
    var out = {};
    if (!v) return out;
    var obj = null;
    if (typeof v === 'object' && !Array.isArray(v)) obj = v;
    else {
      var s = String(v).trim();
      if (s && s.charAt(0) === '{') { try { obj = JSON.parse(s); } catch (_) {} }
    }
    if (obj && obj._units && typeof obj._units === 'object') {
      Object.keys(obj._units).forEach(function (k) {
        var u = String(obj._units[k] == null ? '' : obj._units[k]).trim();
        if (u === 'שבוע' || u === 'חודש') out[k] = u;
      });
    }
    return out;
  }
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

  // The ISO due-date of a client's next monthly renewal. Prefers the stored
  // nextBillingDate — the SAME value the גבייה הבאה chip shows — so the renewal
  // alert/button never diverge from the chip. Falls back to anchor + 1 month with
  // short-month clamp for legacy rows saved before nextBillingDate was persisted.
  // Anchor precedence: packageChangeDate (a שינוי חבילה re-anchors the cycle),
  // else last payment date, else start date. Mirrors nextRenewalDueDate in
  // public/charges-logic.js — keep both in sync. Shared by renewalInfo()'s banner
  // and the "חידוש ותשלום" button so they never diverge.
  function nextRenewalDueDate(c) {
    if (!c) return '';
    if (c.nextBillingDate) return c.nextBillingDate;
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
  // The renewal date anchors on nextRenewalDueDate(c) — i.e. the stored
  // nextBillingDate, the SAME value the גבייה הבאה chip shows — so the alert and
  // the chip read one source and never diverge. No independent addMonth recompute.
  // Source of truth for "is the current month settled?" is the actual base
  // payment row — the SAME lookup the paid/unpaid badge uses — not the
  // denormalized paymentStatus flag. Without this the banner screamed "overdue"
  // on a month that was already paid (the row says paid, but the next-billing
  // date had quietly slipped into the past).
  //   - If the current month's base row is paid: that month is settled. The
  //     banner counts toward the stored next-billing date (ok/due_soon), clamps a
  //     negative gap to 0, and is NEVER overdue.
  //   - If the current month is not yet due (today < its base due date) and the
  //     PREVIOUS month's base row is paid: the client is simply between cycles —
  //     due_soon counting to the current-month due date, never overdue. Without
  //     this, a stale stored date turned every card red on the 1st.
  //   - Otherwise: stored next-billing date + hasBillingProblem. Overdue stays
  //     reserved for an explicit unpaid/partial paymentStatus, or a due date
  //     that already passed without a paid row.
  function renewalInfo(c) {
    if (!c || c.status === 'סיים טיפול' || c.status === 'לא פעיל') return { status: 'unknown' };
    var renewal = nextRenewalDueDate(c);
    if (!renewal) return { status: 'unknown' };
    var daysLeft = daysBetween(today(), renewal);
    var curDue = currentMonthBaseDueDate(c);
    // Paid-up follows the billing CYCLE (packagePaidState: nextBillingDate
    // still ahead), not a calendar-month Payments row — a cycle paid across a
    // month boundary has no current-calendar-month row yet is fully settled.
    var paidThisMonth = packagePaidState(c, today()).paid;
    var status;
    if (paidThisMonth) {
      // The current cycle is settled. Clamp a negative gap to 0 ("renew today")
      // so stale data can't produce nonsense like "renew in -5 days", and so
      // paid never => overdue.
      if (daysLeft === null) {
        status = 'unknown';
      } else {
        if (daysLeft < 0) daysLeft = 0;
        status = daysLeft <= 7 ? 'due_soon' : 'ok';
      }
    } else {
      if (hasBillingProblem(c)) {
        // Explicitly marked partial/unpaid - overdue
        status = 'overdue';
      } else if (today() < curDue && prevMonthBasePaid(c)) {
        // Between cycles: this month's payment simply hasn't come due yet and
        // last month is settled. Count to the CURRENT month's due date (the
        // stored renewal anchor may be stale — repaired separately server-side).
        renewal = curDue;
        daysLeft = daysBetween(today(), curDue);
        status = 'due_soon';
      } else if (daysLeft === null) {
        status = 'unknown';
      } else if (daysLeft < 0) {
        status = 'overdue';
      } else if (daysLeft <= 7) {
        status = 'due_soon';
      } else {
        status = 'ok';
      }
    }
    return { renewalDate: renewal, daysLeft: daysLeft, status: status };
  }

  // Is the PREVIOUS month's base package row paid? The base payment id keys on
  // the month only, so the 1st of the previous month addresses the same row as
  // any other day of it.
  function prevMonthBasePaid(c) {
    var t = today();
    var y = parseInt(t.slice(0, 4), 10);
    var m = parseInt(t.slice(5, 7), 10);
    if (!isFinite(y) || !isFinite(m)) return false;
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    var prevIso = y + '-' + ('0' + m).slice(-2) + '-01';
    return paymentForClientOn(c, prevIso).status === 'paid';
  }

  // Urgency tier from a renewalInfo() status: 0 = overdue/red, 1 = due_soon,
  // 2 = everyone else. Mirrors urgencyTier in public/charges-logic.js.
  function urgencyTier(status) {
    if (status === 'overdue') return 0;
    if (status === 'due_soon') return 1;
    return 2;
  }
  // Stable comparator over decorated card entries { tier, daysLeft, index }:
  // lower tier first; within red + due_soon ascending daysLeft (most overdue /
  // soonest first, null last); ties fall back to original index (stable).
  // Mirrors compareCardUrgency in public/charges-logic.js.
  function compareCardUrgency(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier !== 2) {
      var da = a.daysLeft == null ? Infinity : a.daysLeft;
      var db = b.daysLeft == null ? Infinity : b.daysLeft;
      if (da !== db) return da - db;
    }
    return a.index - b.index;
  }

  // --- API ---------------------------------------------------------------
  // Auth is a server-signed HttpOnly session cookie minted by POST
  // /api/verify-pin (7 days). Every data route requires it; there is no
  // client-trusted "logged in" flag. If the cookie is missing or expired the
  // server answers 401 and the ONE handler below sends the user back to the
  // PIN screen — on load, and whenever a session expires mid-use.
  function handleUnauthorized() {
    try { sessionStorage.removeItem('ez_role'); } catch (_) {}
    state.role = 'viewer';
    state.user = '';
    showPin();
  }
  // fetch() wrapper for the app's own API routes: a 401 flips to the PIN
  // screen and throws, so no caller ever tries to parse an unauthorized
  // response as data. /api/verify-pin does NOT use it (there a 401 simply
  // means "wrong PIN").
  async function apiFetch(url, opts) {
    var r = await fetch(url, opts);
    if (r.status === 401) { handleUnauthorized(); throw new Error('unauthorized'); }
    return r;
  }
  async function apiLoad() {
    var r = await apiFetch('/api/sheets', { cache: 'no-store' });
    var data = await r.json();
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiSave(payload) {
    var r = await apiFetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  // `user` (optional) is the name the picker chose: the server re-issues the
  // cookie with that name inside the signed token (same 7-day TTL), accepting
  // it ONLY from its own allow-list. Without it the body is exactly {pin}.
  async function apiVerifyPin(pin, user) {
    var body = user ? { pin: pin, user: user } : { pin: pin };
    var r = await fetch('/api/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    return r.ok && data.ok === true;
  }
  // The name inside this session's cookie ('' for a user-less session).
  // Session-gated: a 401 flips to the PIN screen like every data call.
  async function apiMe() {
    var r = await apiFetch('/api/me', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return typeof data.user === 'string' ? data.user : '';
  }
  // The allow-listed names the picker offers (lib/users.js, via the server —
  // the client keeps no copy that could drift).
  async function apiUsers() {
    var r = await apiFetch('/api/users', { cache: 'no-store' });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return Array.isArray(data.users) ? data.users.filter(function (u) { return typeof u === 'string' && u; }) : [];
  }

  async function apiLoadSettings() {
    try {
      var r = await apiFetch('/api/sheets?action=getSettings', { cache: 'no-store' });
      var data = await r.json();
      if (!r.ok || data.ok === false) return {};
      return data.settings || {};
    } catch (_) { return {}; }
  }
  async function apiSaveSettings(settings) {
    var r = await apiFetch('/api/sheets', {
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
      sessionsUnit: parseSessionsUnits(row.sessionsPerWeek),
      pricePerSession: row.pricePerSession === '' ? '' : toNum(row.pricePerSession),
      startDate: fmtDate(row.startDate),
      created: fmtDate(row.created) || today(),
      introDateTime: row.introDateTime || '',
      // billing info when lead becomes active
      paymentStatus: row.paymentStatus || '',   // 'paid' | 'partial' | 'unpaid'
      paymentDate: fmtDate(row.paymentDate),
      nextBillingDate: fmtDate(row.nextBillingDate),
      house_of_origin: row.house_of_origin || '',
      // משוייך ל (assigned-to): staff member the lead is assigned to.
      assignedTo: row.assignedTo || '',
      // who/when stamps (SERVER-OWNED, read-only here): carried so the tab
      // knows the version it loaded — the echoed updatedAt is what the
      // server compares for stale-save conflict refusal. Client-sent stamps
      // are never written as-is.
      updatedAt: row.updatedAt || '',
      updatedBy: row.updatedBy || ''
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
      sessionsUnit: parseSessionsUnits(row.sessionsPerWeek),
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
      packageChangeDate: fmtDate(row.packageChangeDate),
      // משוייך ל (assigned-to): staff member responsible, carried from the lead.
      assignedTo: row.assignedTo || '',
      // סכום גבייה ידני: manual collection-amount overrides, a { paymentId: amount }
      // map layered over the computed amount on גבייה open-balance rows. Parsed from
      // the JSON cell; blank/garbage -> {}. Read via effectivePaymentAmount(); the
      // package price / charge source rows are never touched.
      paymentAmountOverrides: parseAmountOverrides(row.paymentAmountOverrides),
      // who/when stamps (SERVER-OWNED, read-only here): carried so the tab
      // knows the version it loaded — the echoed updatedAt is what the
      // server compares for stale-save conflict refusal. Client-sent stamps
      // are never written as-is.
      updatedAt: row.updatedAt || '',
      updatedBy: row.updatedBy || ''
    };
  }

  // Parse a paymentAmountOverrides cell (JSON string) into a plain map. Tolerates
  // blank, an already-parsed object, or malformed JSON (-> {}).
  function parseAmountOverrides(v) {
    if (v == null || v === '') return {};
    if (typeof v === 'object') return v;
    try {
      var o = JSON.parse(String(v));
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (_) {
      return {};
    }
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
      sessionsPerWeek: Object.keys(breakdown).length ? formatSessionsBreakdown(breakdown, l.sessionsUnit) : '',
      pricePerSession: l.pricePerSession === '' ? '' : toNum(l.pricePerSession),
      startDate: l.startDate || '',
      created: l.created || today(),
      introDateTime: l.introDateTime || '',
      paymentStatus: l.paymentStatus || '',
      paymentDate: l.paymentDate || '',
      nextBillingDate: l.nextBillingDate || '',
      not_relevant_reason: l.not_relevant_reason || '',
      not_relevant_note: l.not_relevant_note || '',
      house_of_origin: l.house_of_origin || '',
      // משוייך ל (assigned-to): preserve the lead's assignee on save.
      assignedTo: l.assignedTo || '',
      // who/when echo (the stamps this tab loaded). The server NEVER writes
      // them as-is — it stamps changed rows itself and carries the sheet's
      // stamps for unchanged ones — but it COMPARES the echoed updatedAt with
      // the sheet's: a changed row whose echo is stale is refused (conflict).
      updatedAt: l.updatedAt || '',
      updatedBy: l.updatedBy || ''
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
      sessionsPerWeek: formatSessionsBreakdown(breakdown, c.sessionsUnit),
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
      packageChangeDate: c.packageChangeDate || '',
      // משוייך ל (assigned-to): preserve the patient's assignee on save.
      assignedTo: c.assignedTo || '',
      // סכום גבייה ידני: serialize the override map back to a JSON string so a full
      // client save keeps the column aligned. The server preserves its own on-sheet
      // value by id (like creditsOwed), so this is only authoritative for a brand-new
      // client with no existing row. Empty map -> '' (blank cell).
      paymentAmountOverrides: (function () {
        var m = c.paymentAmountOverrides;
        return (m && typeof m === 'object' && Object.keys(m).length) ? JSON.stringify(m) : '';
      })(),
      // who/when echo (the stamps this tab loaded). The server NEVER writes
      // them as-is — it stamps changed rows itself and carries the sheet's
      // stamps for unchanged ones — but it COMPARES the echoed updatedAt with
      // the sheet's: a changed row whose echo is stale is refused (conflict).
      updatedAt: c.updatedAt || '',
      updatedBy: c.updatedBy || ''
    };
  }

  async function persist(opts) {
    var payload = {
      leads: state.leads.map(leadForSheet),
      clients: state.clients.map(clientForSheet)
    };
    // Client ids removed ON PURPOSE by this save (the ✕ permanent-delete
    // flow). The server tombstones EVERY client row missing from the payload
    // (Clients-removed sheet); declaring the deliberate ones here records them
    // as removedVia='explicit-delete' instead of the stale-tab clobber
    // signature 'saveAll-diff'.
    if (opts && opts.explicitRemovedIds && opts.explicitRemovedIds.length) {
      payload.explicitRemovedIds = opts.explicitRemovedIds;
    }
    // Staleness signal: echo the version this tab loaded. The server flags
    // the response staleSave:true when another device wrote Clients since —
    // the save itself is safe (merge-don't-drop preserves the rows this tab
    // never loaded), but the tab is showing an incomplete picture.
    if (state.dataVersion != null) payload.dataVersion = state.dataVersion;
    var data = await apiSave(payload);
    if (data && data.dataVersion != null) state.dataVersion = Number(data.dataVersion);
    // Conflict refusal (PR 2): the server REFUSED the rows another person
    // edited after this tab loaded them (the sheet row was kept, the rest of
    // the save went through) and lists them in `conflicts`. Show the banner
    // and reload so the tab shows the sheet's version. NEVER retried — the
    // person re-applies their change on top of the fresh data if still needed.
    var conflictMsg = conflictsMessage(data);
    if (conflictMsg) {
      showConflictBanner(conflictMsg);
      loadAll().catch(function (e) { console.warn('[ezone] conflict reload failed:', e.message); });
      return;
    }
    hideConflictBanner();
    if (data && data.staleSave) {
      toast('הנתונים עודכנו ממכשיר אחר — רענני לראות את המצב המלא');
      loadAll().catch(function (e) { console.warn('[ezone] stale-save reload failed:', e.message); });
    }
  }
  // Pure wording helper (public/conflicts.js, unit-tested): '' when the
  // response carries no conflicts. Defensive if the module failed to load.
  function conflictsMessage(res) {
    var mod = (typeof self !== 'undefined' && self.EzoneConflicts) || null;
    if (mod && typeof mod.conflictsMessage === 'function') return mod.conflictsMessage(res);
    var list = res && Array.isArray(res.conflicts) ? res.conflicts : [];
    return list.length ? 'השינוי לא נשמר — מישהו/י עדכן/ה קודם. הנתונים רועננו.' : '';
  }
  function showConflictBanner(msg) {
    var box = $('#conflictBanner');
    var txt = $('#conflictBannerText');
    if (!box || !txt) { toast(msg, true); return; }
    txt.textContent = msg; // plain text only — never innerHTML
    box.hidden = false;
  }
  function hideConflictBanner() {
    var box = $('#conflictBanner');
    if (box) box.hidden = true;
  }

  // --- Payments API / serialization -------------------------------------
  async function apiGetPayments() {
    var r = await apiFetch('/api/sheets?action=getPayments', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetCharges() {
    var r = await apiFetch('/api/sheets?action=getCharges', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetStopFlags() {
    var r = await apiFetch('/api/sheets?action=getStopFlags', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetExtraRequests() {
    var r = await apiFetch('/api/sheets?action=getExtraSessionRequests', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiApproveExtra(id, approvedBy) {
    var r = await apiFetch('/api/sheets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approveExtraSession', id: id, approvedBy: approvedBy })
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetSessionLog() {
    var r = await apiFetch('/api/sheets?action=getSessionLog', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  // Minimal INTERNAL read of this app's own stop/resume alerts (id/clientId/status/
  // type only — no secret, no notes/reasons). Used to know the sent-state across
  // sessions, not just the current optimistic one.
  async function apiGetMyStopAlerts() {
    var r = await apiFetch('/api/sheets?action=getMyStopAlerts', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  // Un-restored Clients-removed tombstones (the _saveAll row-loss guard's
  // audit sheet). INTERNAL read, same trust level as the main load.
  async function apiGetRemovedClients() {
    var r = await apiFetch('/api/sheets?action=getRemovedClients', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiPostAction(action, extra) {
    var body = Object.assign({ action: action }, extra || {});
    var r = await apiFetch('/api/sheets', {
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

  // Persist one manual collection-amount override (single-cell server write). Pass
  // amount === '' / null to clear the override and revert the row to computed.
  async function persistPaymentAmountOverride(clientId, paymentId, amount) {
    await apiPostAction('savePaymentAmountOverride', {
      clientId: clientId, paymentId: paymentId,
      amount: (amount === '' || amount == null) ? '' : toNum(amount)
    });
  }

  // Remove every payment row tied to a clientId (used when a patient is
  // deleted). One server-side bulk round-trip against the SHEET — the old
  // client-side loop iterated state.payments (empty whenever getPayments had
  // failed at load, leaving every row orphaned) and console.warn-swallowed
  // per-row failures. A failure now PROPAGATES to the caller's catch so the
  // delete flow surfaces it instead of silently leaving orphans.
  async function removePaymentsForClient(clientId) {
    state.payments = state.payments.filter(function (p) { return p.clientId !== clientId; });
    var res = await apiPostAction('removePaymentsForClient', { clientId: clientId });
    return res.removed || 0;
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
  // Bulk-delete every ClientCharges row for a deleted patient in one round-trip.
  async function persistRemoveChargesForClient(clientId) {
    await apiPostAction('removeChargesForClient', { clientId: clientId });
  }

  // Drop "orphan" charges — rows whose clientId no longer matches any patient
  // (the patient was deleted, the charge row survived). Mirrors
  // excludeOrphanCharges in public/charges-logic.js — keep both in sync.
  function excludeOrphanCharges(charges, clients) {
    var live = {};
    (clients || []).forEach(function (c) {
      if (c && c.id != null && String(c.id) !== '') live[String(c.id)] = true;
    });
    return (charges || []).filter(function (ch) {
      return ch && ch.clientId != null && live[String(ch.clientId)] === true;
    });
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

  // --- Manual collection-amount override (סכום גבייה) -------------------------
  // The override is an append-only LAYER keyed by payment id, stored as a JSON map
  // on the owning client's row (paymentAmountOverrides). The read side prefers the
  // override over the computed/billed amount; nothing here mutates the package price
  // or a charge source row.
  function overrideAmountFor(payment) {
    if (!payment || !payment.clientId) return null;
    var c = state.clients.find(function (x) { return x.id === payment.clientId; });
    if (!c || !c.paymentAmountOverrides) return null;
    var v = c.paymentAmountOverrides[payment.id];
    if (v == null || v === '') return null;
    var n = toNum(v);
    return isFinite(n) ? n : null;
  }
  // Effective collection amount for a payment: override if present, else the given
  // computed fallback (or the payment's own amountDue when no fallback is passed).
  function effectivePaymentAmount(payment, computedFallback) {
    var o = overrideAmountFor(payment);
    if (o != null) return o;
    if (computedFallback != null) return computedFallback;
    return toNum(payment && payment.amountDue);
  }

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
  // Build a fully-paid base monthly payment row for dueDateISO, stamped with an
  // explicit paidDateISO (NOT today) so a backdated payment round-trips through
  // persistPayment unchanged. Mirrors basePaymentPaidOn in public/charges-logic.js
  // — keep both in sync. Shared by the edit-modal paid-date propagation (Bug A)
  // and renew-and-pay (Bug C).
  function basePaymentPaidOn(client, dueDateISO, amount, paidDateISO, notes) {
    return {
      id: paymentId(client, dueDateISO, 'base'),
      clientId: client.id, clientName: client.name || '',
      billingType: 'monthly', dueDate: dueDateISO,
      amountDue: amount, amountPaid: amount, status: 'paid',
      paymentDate: paidDateISO || '', method: '', notes: notes || '',
      bundleSize: '', sessionsUsed: ''
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
    else if (state.view === 'inactive') renderInactive();
    else if (state.view === 'payouts') renderPayouts();
    else if (state.view === 'continuation') renderContinuation();
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
    renderDashPatientSearch();
  }

  // ---- Cross-tab patient locator (איתור מטופל, dashboard) ----
  // Searches Clients (any status), the Clients-removed tombstones and orphan
  // billing rows AT ONCE via the pure PatientSearch module, so a patient is
  // findable even when no tab shows a card (the 2026-08-26 dropped-row
  // incident: orphan payments in גבייה, no card anywhere). This layer does
  // rendering + navigation only — classification lives in
  // public/patient-search.js.
  function dashStatusChip(row) {
    var bg = '#d4edda', fg = '#155724', label = row.status || 'פעיל';
    if (row.kind === 'removed') { bg = '#e2d6f8'; fg = '#4a2a80'; label = 'נמחק'; }
    else if (row.kind === 'billing-only') { bg = '#f8d7da'; fg = '#721c24'; label = 'גבייה בלבד'; }
    else if (row.status === 'סיים טיפול') { bg = '#e2e3e5'; fg = '#41464b'; }
    else if (row.status === 'לא פעיל') { bg = '#f8d7da'; fg = '#721c24'; }
    else if (row.status === 'הפסקה זמנית') { bg = '#fff3cd'; fg = '#856404'; }
    return '<span style="font-size:0.72rem;padding:2px 10px;border-radius:20px;background:' + bg +
      ';color:' + fg + ';font-weight:600;">' + escapeHtml(label) + '</span>';
  }

  // Jump to the tab that owns this result, with its per-tab search prefilled
  // so the patient is already isolated when the tab opens.
  function dashOpenInTab(row) {
    var name = row.name || '';
    if (row.tab === 'clients') {
      state.clientSearch = name;
      state.clientTab = 'all';
      var ci = $('#clientsSearch'); if (ci) ci.value = name;
      setView('clients');
    } else if (row.tab === 'inactive') {
      state.inactiveSearch = name;
      var ii = $('#inactiveSearch'); if (ii) ii.value = name;
      setView('inactive');
    } else {
      state.billingSearch = name;
      var bi = $('#billingSearch'); if (bi) bi.value = name;
      setView('billing');
    }
  }

  function dashSearchRow(row) {
    var el = document.createElement('div');
    el.className = 'bd-line';
    var detail = '';
    if (row.kind === 'removed') {
      var viaLabel = row.removedVia === 'explicit-delete' ? 'נמחק ידנית (✕)' : 'נשמט בשמירה';
      detail = '<span class="bd-out">' + viaLabel +
        (row.removedAt ? ' · ' + displayDate(row.removedAt) : '') + '</span> ';
    } else if (row.kind === 'billing-only') {
      detail = '<span class="bd-out">מטופל ללא כרטיס — ' + row.paymentsCount +
        ' רשומות גבייה, נגבה ' + money(row.collected) + '</span> ';
    }
    el.innerHTML =
      '<span>' + escapeHtml(row.name || '—') + ' ' + dashStatusChip(row) + '</span>' +
      '<span>' + detail + '</span>';
    var actions = el.lastChild;
    if (row.kind === 'removed') {
      // No card to open — the recovery action IS the destination.
      if (state.role === 'editor') {
        var rb = document.createElement('button');
        rb.className = 'btn btn-ghost';
        rb.textContent = 'שחזר מטופל';
        rb.onclick = function () { performRestoreRemovedClient(String(row.id), row.name); };
        actions.appendChild(rb);
      }
    } else {
      var ob = document.createElement('button');
      ob.className = 'btn btn-ghost';
      ob.textContent = row.tab === 'clients' ? 'פתח במטופלים'
        : row.tab === 'inactive' ? 'פתח בלא פעילים'
        : 'פתח בגבייה';
      ob.onclick = function () { dashOpenInTab(row); };
      actions.appendChild(ob);
    }
    return el;
  }

  function renderDashPatientSearch() {
    var box = $('#dashPatientResults');
    if (!box) return;
    var q = state.dashSearch.trim();
    if (!q) { box.innerHTML = ''; return; }
    // Deleted patients must be findable here too → lazily pull the tombstones
    // on the first search and re-render when they land.
    ensureRemovedClients(function () { if (state.view === 'dashboard') renderDashPatientSearch(); });
    var rows = PatientSearch.searchPatients(q, {
      clients: state.clients,
      removedClients: Array.isArray(state.removedClients) ? state.removedClients : [],
      payments: state.payments
    });
    box.innerHTML = '';
    if (!rows.length) {
      box.innerHTML = '<div class="bd-line muted">לא נמצא מטופל בשם הזה — בשום לשונית</div>';
      return;
    }
    rows.forEach(function (rw) { box.appendChild(dashSearchRow(rw)); });
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
  // Patient-IDENTITY phone: the patient's own number. payerPhone is deliberately
  // EXCLUDED — a payer (parent / institution) is legitimately shared across
  // siblings, so a hard block on it would reject real patients. The אחראי-טיפול
  // contact phone is likewise no longer part of identity (that role was removed
  // from the product). Identity uniqueness on the patient phone is what stops the
  // same person being entered twice (the ליעם בריאר / נועם duplicates).
  function clientIdentityPhones(c) {
    if (!c) return [];
    return [c.phone].map(recoverPhone).filter(function (p) { return !!p; });
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
      [c.phone].forEach(function (p) {
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
            renderStopAlertControl(c)
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
    } else if (action === 'stop-alert') {
      sendStopAlert(c);
    } else if (action === 'resume-treatment') {
      resumeTreatment(c);
    }
  }

  // Stable reason keys → render-time Hebrew labels (existing convention, mirrors
  // NOT_RELEVANT_REASON_LABELS). The keys are the wire format shared with the
  // backend + therapists app; the Hebrew never leaves the render layer.
  var STOP_ALERT_REASON_LABELS = {
    no_payment: 'חוסר תשלום',
    mismatch:   'אי התאמה',
    other:      'אחר'
  };

  // Two-way treatment alerts — Vered's sent-state is driven by state.myStopAlerts
  // (id/clientId/status/type rows, seeded cross-session from getMyStopAlerts and
  // updated optimistically). The LATEST alert row for a client (append order =
  // chronological) decides the control on its overdue row:
  //   • latest is a 'stop' still unread/read → standing → 'נשלחה התראת עצירה' chip + חידוש טיפול
  //   • latest is a 'stop' that was cancelled → 'ההתראה בוטלה' chip + the stop-send button
  //   • latest is a 'resume' (unread/read)    → 'נשלח חידוש' chip + the stop-send button
  //   • no alert                              → the stop-send button only
  function latestAlertFor(clientId) {
    var list = state.myStopAlerts || [];
    var latest = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].clientId === clientId) latest = list[i];
    }
    return latest;
  }
  // A stop alert is "standing" (sent, awaiting/seen by Yarden, not yet resolved)
  // when the latest alert for the client is a 'stop' that is unread or read.
  function stopAlertStanding(clientId) {
    var a = latestAlertFor(clientId);
    return !!a && (a.type || 'stop') === 'stop' && (a.status === 'unread' || a.status === 'read');
  }
  // Re-render only the overdue/renewals panel after an optimistic change — cheaper
  // than a full render() and enough, since the controls live only in that panel.
  function refreshRenewalsPanel() {
    var activeOnly = state.clients.filter(function (c) { return c.status === 'פעיל'; });
    renderRenewalAlerts(activeOnly);
  }
  // The stop-alert control (status chip + action) for one overdue row.
  function renderStopAlertControl(c) {
    var a = latestAlertFor(c.id);
    var type = a ? (a.type || 'stop') : '';
    var active = !!a && (a.status === 'unread' || a.status === 'read');
    if (a && type === 'stop' && active) {
      return '<span class="chip stop-chip stop-chip-sent">נשלחה התראת עצירה</span>' +
        (state.role === 'editor'
          ? '<button class="btn btn-resume" data-action="resume-treatment">חידוש טיפול</button>'
          : '');
    }
    var chip = '';
    if (a && type === 'resume' && active) {
      chip = '<span class="chip stop-chip stop-chip-resumed">נשלח חידוש</span>';
    } else if (a && type === 'stop' && a.status === 'cancelled') {
      chip = '<span class="chip stop-chip stop-chip-cancelled">ההתראה בוטלה</span>';
    }
    return chip + '<button class="btn btn-wa-stop" data-action="stop-alert">🛑 הודעת עצירת טיפול</button>';
  }

  // "הודעת עצירת טיפול" CREATES a persistent stop-treatment alert for the E-Zone
  // Therapists app (Yarden's "עצירת טיפול" tab) — a PAUSE signal, distinct from
  // סיים טיפול (final discharge). No treatmentContactPhone read, no WhatsApp link.
  // Opening the confirm modal collects a REQUIRED reason (+ optional note); the
  // actual createStopAlert fires from the form submit below.
  var stopAlertClientId = null;
  function sendStopAlert(c) {
    if (state.role !== 'editor') return;
    openStopAlertModal(c);
  }
  function openStopAlertModal(c) {
    stopAlertClientId = c.id;
    var form = $('#stopAlertForm');
    if (form) form.reset();
    var nameEl = $('#stopAlertClientName');
    if (nameEl) nameEl.textContent = c.name || '';
    // Duplicate guard: warn (do not block) if a stop alert is already standing.
    // (The send button only shows when none is standing, so this is a belt-and-
    // braces guard for direct/programmatic opens.)
    var pendingExists = stopAlertStanding(c.id);
    var warn = $('#stopAlertPending');
    if (warn) warn.hidden = !pendingExists;
    var hint = $('#stopAlertOtherHint');
    if (hint) hint.hidden = true;
    // Save stays disabled until a reason is chosen (empty '—' default).
    var submit = $('#stopAlertSubmit');
    if (submit) submit.disabled = true;
    $('#stopAlertModal').hidden = false;
  }
  function closeStopAlertModal() {
    var m = $('#stopAlertModal');
    if (m) m.hidden = true;
    stopAlertClientId = null;
  }
  // Actual create — called from the modal's submit once a valid reason is chosen.
  // Optimistic: the alert is pushed to local state so a repeat click warns that
  // one is already pending, and removed again on failure.
  function submitStopAlert(reason, note) {
    var c = state.clients.find(function (x) { return x.id === stopAlertClientId; });
    if (!c) return;
    // Optimistic: append a minimal 'stop' row so the row flips to the sent chip
    // immediately (the toast alone was too transient). Rolled back on failure.
    var optimistic = { id: 'stop-pending-' + Date.now(), clientId: c.id, status: 'unread', type: 'stop' };
    state.myStopAlerts.push(optimistic);
    refreshRenewalsPanel();
    apiPostAction('createStopAlert', {
      clientId: c.id, clientName: c.name, createdBy: 'Vered', note: note, reason: reason
    })
      .then(function (res) {
        if (res && res.alert && res.alert.id) optimistic.id = res.alert.id;
        toast('נשלחה התראת עצירה לירדן');
      })
      .catch(function (err) {
        var idx = state.myStopAlerts.indexOf(optimistic);
        if (idx !== -1) state.myStopAlerts.splice(idx, 1);
        refreshRenewalsPanel(); // roll back — the send did not land
        toast('ההתראה לא נשלחה: ' + err.message, true);
      });
  }

  // "חידוש טיפול" — the resume side of the two-way flow. Opens a confirm modal
  // that explains the branch (cancel the stop if Yarden hasn't read it; otherwise
  // send her a resume alert). The actual write fires from the modal confirm below.
  var resumeTreatmentClientId = null;
  function resumeTreatment(c) {
    if (state.role !== 'editor') return;
    if (!stopAlertStanding(c.id)) return; // nothing to resume
    resumeTreatmentClientId = c.id;
    var nameEl = $('#resumeTreatmentClientName');
    if (nameEl) nameEl.textContent = c.name || '';
    var m = $('#resumeTreatmentModal');
    if (m) m.hidden = false;
  }
  function closeResumeTreatmentModal() {
    var m = $('#resumeTreatmentModal');
    if (m) m.hidden = true;
    resumeTreatmentClientId = null;
  }
  function submitResumeTreatment() {
    var c = state.clients.find(function (x) { return x.id === resumeTreatmentClientId; });
    if (!c) { closeResumeTreatmentModal(); return; }
    // Optimistic mirror of _resumeTreatmentAlert on the local minimal rows: cancel
    // this client's UNREAD 'stop' rows; if any 'stop' was already READ, append an
    // optimistic 'resume' row. Snapshot (deep copy) for a clean rollback.
    var snapshot = (state.myStopAlerts || []).map(function (a) { return Object.assign({}, a); });
    var hadReadStop = false;
    (state.myStopAlerts || []).forEach(function (a) {
      if (a.clientId !== c.id) return;
      if ((a.type || 'stop') !== 'stop') return;
      if (a.status === 'unread') a.status = 'cancelled';
      else if (a.status === 'read') hadReadStop = true;
    });
    if (hadReadStop) {
      state.myStopAlerts.push({ id: 'resume-pending-' + Date.now(), clientId: c.id, status: 'unread', type: 'resume' });
    }
    refreshRenewalsPanel();
    closeResumeTreatmentModal();
    apiPostAction('resumeTreatmentAlert', { clientId: c.id, clientName: c.name, createdBy: 'Vered' })
      .then(function (res) {
        toast(res && res.resumeCreated ? 'נשלח חידוש טיפול לירדן' : 'התראת העצירה בוטלה');
      })
      .catch(function (err) {
        state.myStopAlerts = snapshot; // roll back to the pre-click state
        refreshRenewalsPanel();
        toast('חידוש הטיפול נכשל: ' + err.message, true);
      });
  }

  // "שחזר לטיפול" — reverses סיים טיפול from the retention tab (mirrors the
  // שחזר לליד pattern on not-relevant leads). Opens a confirm modal that also
  // lists the patient's ACTIVE extra charges: restore leaves them untouched and
  // they resume billing, so Vered sees them up front and can remove stale ones.
  // The actual write fires from the modal confirm below.
  var restoreClientId = null;
  function openRestoreClientModal(c) {
    if (state.role !== 'editor') return;
    restoreClientId = c.id;
    $('#restoreClientName').textContent = c.name || '';
    var host = $('#restoreClientCharges');
    if (host) {
      var activeCharges = state.charges.filter(function (ch) {
        return ch.clientId === c.id && ch.active !== false;
      });
      host.innerHTML = activeCharges.length
        ? '<div style="font-weight:600;color:#f0ad4e;margin-bottom:4px;">חיובים נוספים פעילים שימשיכו להיגבות:</div>' +
          activeCharges.map(function (ch) {
            return '<div>• ' + escapeHtml(ch.description || 'חיוב נוסף') + ' — ' +
              money(toNum(ch.amount)) + (ch.billingType === 'monthly' ? ' (חודשי)' : ' (חד פעמי)') + '</div>';
          }).join('')
        : '';
    }
    $('#restoreClientModal').hidden = false;
  }
  function closeRestoreClientModal() {
    var m = $('#restoreClientModal');
    if (m) m.hidden = true;
    restoreClientId = null;
  }
  function submitRestoreClient() {
    var c = state.clients.find(function (x) { return x.id === restoreClientId; });
    closeRestoreClientModal();
    // Both inactive kinds restore: סיים טיפול (manual discharge) and לא פעיל
    // (cross-app deactivated — flipping the status re-adds the patient to the
    // getTreatmentPlans/getDebtStatus projections, so the therapists roster
    // union picks them up again on its next build; no sender call needed).
    if (!c || (c.status !== 'סיים טיפול' && c.status !== 'לא פעיל')) return;
    // Optimistic: flip + re-anchor now, persist in background, roll back on
    // failure. packageChangeDate = today re-anchors גבייה הבאה to the restore
    // date + 1 month (anchor precedence in nextRenewalDueDate); the stale
    // nextBillingDate must be cleared or it would outrank the re-anchor and
    // flag the patient overdue immediately. exitDate is cleared — a future
    // discharge re-sets it from the exit modal.
    var prev = {
      status: c.status, exitDate: c.exitDate,
      packageChangeDate: c.packageChangeDate, nextBillingDate: c.nextBillingDate
    };
    c.status = 'פעיל';
    c.exitDate = '';
    c.packageChangeDate = today();
    c.nextBillingDate = '';
    render();
    persist()
      .then(function () { toast('המטופל שוחזר לטיפול'); })
      .catch(function (err) {
        c.status = prev.status; c.exitDate = prev.exitDate;
        c.packageChangeDate = prev.packageChangeDate; c.nextBillingDate = prev.nextBillingDate;
        render();
        toast('שחזור נכשל: ' + err.message, true);
      });
  }

  function lastDayOfMonth(dateISO) {
    var parts = String(dateISO).slice(0, 10).split('-');
    if (parts.length < 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!isFinite(y) || !isFinite(m)) return null;
    return new Date(y, m, 0).getDate();
  }

  // ISO date of the CURRENT month's base billing day for a client
  // (c.billingDay, else the start-date day-of-month), clamped to the last day
  // of the month. Falls back to today() when neither is known. Used as the
  // blank-anchor fallback for the cycle row (cyclePaymentDueDate) — the גבייה
  // tab itself is due-dated by the stored nextBillingDate since the cycle fix.
  function currentMonthBaseDueDate(c) {
    var t = today();
    var bd = c.billingDay ? toNum(c.billingDay) : dayOfMonth(c.startDate);
    if (!bd) return t;
    var last = lastDayOfMonth(t);
    var eff = (last && bd > last) ? last : bd;
    return t.slice(0, 7) + '-' + String(eff).padStart(2, '0');
  }

  // 'yyyy-MM-dd' for (year, month 1-12, day), day clamped to the month's last
  // day — the same clamp currentMonthBaseDueDate applies.
  function clampedCycleIso(y, m, day) {
    var last = new Date(y, m, 0).getDate();
    var d = day > last ? last : day;
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  // Next cycle due date ON OR AFTER fromIso: the client's billing day (numeric
  // billingDay, else the startDate day-of-month; neither -> '') in fromIso's
  // month, clamped to the month's last day; a candidate before fromIso rolls to
  // the same day next month (clamped again). Mirrors _nextCycleDueDate in
  // apps-script/Code.gs and nextCycleDueDate in public/charges-logic.js — keep
  // all three in sync.
  function nextCycleDueDate(c, fromIso) {
    var bd = null;
    var raw = c && c.billingDay;
    if (raw !== '' && raw != null && isFinite(Number(raw)) && Number(raw) >= 1) {
      bd = Math.floor(Number(raw));
    }
    if (!bd) {
      var d = dayOfMonth(c && c.startDate);
      if (d && d >= 1) bd = d;
    }
    if (!bd) return '';
    var t = String(fromIso || '').slice(0, 10).split('-');
    var y = parseInt(t[0], 10);
    var m = parseInt(t[1], 10);
    if (!isFinite(y) || !isFinite(m)) return '';
    var candidate = clampedCycleIso(y, m, bd);
    if (candidate < fromIso) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      candidate = clampedCycleIso(y, m, bd);
    }
    return candidate;
  }

  // The next cycle due date AFTER the cycle billed at cycleDueIso: the billing
  // day in the month AFTER cycleDueIso's month, clamped. Anchors on the DUE
  // date being paid, NEVER on the paid date, so the billing day stops drifting
  // (paying the 04/09 cycle on 30/08 advances to 04/10, not 29/09). A client
  // with no billing-day anchor falls back to due date + 1 calendar month
  // (keeps its day-of-month, short-month clamp). Mirrors nextCycleDueDateAfter
  // in public/charges-logic.js — keep both in sync.
  function nextCycleDueDateAfter(c, cycleDueIso) {
    var due = fmtDate(cycleDueIso);
    var p = due.split('-');
    if (p.length < 3) return '';
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    if (!isFinite(y) || !isFinite(m)) return '';
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return nextCycleDueDate(c, y + '-' + ('0' + m).slice(-2) + '-01') || addMonth(due);
  }

  // Package paid-up state from the SINGLE source of truth. Packages are billing
  // CYCLES (paid date -> next billing date), not calendar months, and every
  // payment path (month-paid chip, חידוש ותשלום, intake, activation, agreement)
  // advances nextBillingDate exactly when a payment is recorded. Therefore:
  //   paid-up ⇔ nextBillingDate non-blank AND >= today   (until = that date)
  //   unpaid  ⇔ blank or < today
  // renewalInfo counts to the same date, so chip and banner agree. Mirrors
  // packagePaidState in public/charges-logic.js — keep both in sync.
  function packagePaidState(c, todayIso) {
    var until = fmtDate(c && c.nextBillingDate);
    var paid = !!until && until >= todayIso;
    return { paid: paid, until: paid ? until : '' };
  }

  // The due date of the CYCLE a payment settles right now: the stored
  // nextBillingDate when it is already due (past/today), else the current
  // month's base due date (blank/legacy anchor fallback). This is the SAME
  // date חידוש ותשלום bills when the anchor is due (nextRenewalDueDate prefers
  // the stored nextBillingDate), so the chip, the edit-modal propagation and
  // the renew modal all converge on ONE Payments row id.
  function cyclePaymentDueDate(c, todayIso) {
    var nbd = fmtDate(c && c.nextBillingDate);
    if (nbd && nbd <= todayIso) return nbd;
    return currentMonthBaseDueDate(c);
  }

  // The cycle due date one month BEFORE the given anchor (billing day kept,
  // clamped) — the inverse of nextCycleDueDateAfter. Used to find the row that
  // covers the CURRENT cycle once the anchor has been advanced (the שולם ב
  // line, and the chip's unmark after a reload lost the pre-mark memory).
  function prevCycleDueDateBefore(c, anchorIso) {
    var a = fmtDate(anchorIso);
    var p = a.split('-');
    if (p.length < 3) return '';
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    var day = parseInt(p[2], 10);
    if (!isFinite(y) || !isFinite(m)) return '';
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    return nextCycleDueDate(c, y + '-' + ('0' + m).slice(-2) + '-01') ||
      clampedCycleIso(y, m, isFinite(day) ? day : 1);
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
      // No due items for either inactive kind — a לא פעיל patient (deleted in
      // the therapists app) must stop billing exactly like a discharged one.
      if (c.status === 'סיים טיפול' || c.status === 'לא פעיל') return;
      // Base monthly: a client is due on X iff their גבייה הבאה is X — the
      // stored nextBillingDate (the billing-cycle anchor every payment path
      // advances), NOT a billing-day calendar match. The base row lookup then
      // resolves to the cycle row automatically (dueDate = the anchor).
      // Mirrors dueItemsOn in public/charges-logic.js — keep both in sync.
      if (fmtDate(c.nextBillingDate) === dateISO) {
        out.push({ client: c, kind: 'base', dueDate: dateISO, amount: clientAmountDue(c) });
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
    // Computed/billed amount, then the effective amount (manual override wins).
    var computedAmount = payment.amountDue || (isExtra ? toNum(charge && charge.amount) : clientAmountDue(client)) || 0;
    var amount = effectivePaymentAmount(payment, computedAmount);
    var isOverridden = overrideAmountFor(payment) != null;
    // ✏️ to edit the collection amount (סכום גבייה) — on every billing row for
    // editors: next to "סכום חודשי" on due rows, next to "יתרה" on open-balance
    // (carry) rows. One pencil per row, beside the amount it edits.
    var canEditAmount = state.role === 'editor';
    var amountEditHtml = canEditAmount
      ? ' <button type="button" class="billing-amount-edit edit-only" title="עריכת סכום גבייה">✏️</button>'
        + (isOverridden ? '<span class="billing-amount-overridden" title="סכום גבייה עודכן ידנית">✎</span>' : '')
      : '';
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
      '<div><span class="p-label">' + dateCellLabel + '</span><span class="p-val">' + escapeHtml(dateCellVal) + '</span>' +
        (isCarry ? '' : amountEditHtml) +
      '</div>' +
      '<div><span class="p-label">סטטוס</span><select class="billing-status"' + disabled + '>' + statusSelect + '</select></div>' +
      '<div class="billing-paid-wrap ' + (payment.status === 'partial' ? '' : 'hidden') + '">' +
        '<span class="p-label">שולם בפועל</span>' +
        '<input class="billing-paid" type="number" min="0" step="1" value="' + (payment.amountPaid || 0) + '"' + disabled + ' />' +
      '</div>' +
      '<div><span class="p-label">יתרה</span><span class="p-val billing-balance">' + money(Math.max(0, amount - (payment.amountPaid || 0))) + '</span>' +
        (isCarry ? amountEditHtml : '') +
      '</div>' +
      '<div class="billing-paid-date-wrap"><span class="p-label">תאריך תשלום</span>' +
        '<input class="billing-paid-date" type="date" value="' + (payment.paymentDate || today()) + '"' + disabled + ' /></div>' +
      nextBillHtml;

    var statusSel = row.querySelector('.billing-status');
    var paidWrap  = row.querySelector('.billing-paid-wrap');
    var paidInput = row.querySelector('.billing-paid');
    var paidDateInput = row.querySelector('.billing-paid-date');
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
        paymentDate: newStatus === 'paid'
          ? ((paidDateInput && paidDateInput.value) || today())
          : (payment.paymentDate || ''),
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
    // Backdating: when the row is already marked paid, editing the date persists
    // it through the same single save path (no effect while unpaid/partial).
    if (paidDateInput) paidDateInput.addEventListener('change', function () {
      if (statusSel.value !== 'paid') return;
      saveBillingRow(recompute('paid', paidInput.value));
    });

    // ✏️ edit the collection amount (open-balance rows, editor only). Opens the
    // small edit-amount modal prefilled with the current EFFECTIVE amount.
    var amountEditBtn = row.querySelector('.billing-amount-edit');
    if (amountEditBtn) amountEditBtn.addEventListener('click', function () {
      openEditAmountModal(client, payment, amount, computedAmount);
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
  //
  // Marking paid ALSO advances the client (this was the stale-nextBillingDate
  // bug: the chip settled the month but the stored renewal anchor never moved,
  // so on the 1st every such card turned red 🛑):
  //   nextBillingDate -> the next cycle due date AFTER the cycle being marked
  //                      (nextCycleDueDateAfter — anchored on the due date)
  //   paymentDate     -> today()
  // Unmarking restores the pre-mark values, remembered per client below for
  // this session; after a reload the fallback is the settled cycle's own due
  // date (the cycle is unpaid again, so that IS the next collection). Client fields
  // persist only through the saveAll path, so the client list is RELOADED
  // first (loadAll) and the advance re-applied to the fresh row — a possibly
  // stale tab never clear-and-rewrites Clients from old state.
  var monthPaidPrevClient = {}; // clientId -> { nextBillingDate, paymentDate, dueDateISO } before the mark
  // The due date of the client's LATEST paid base row. Used to find the row
  // that covers the paid-up cycle when the pre-mark memory is gone (the renew
  // modal may have billed a different month than the computed previous cycle).
  function latestPaidBaseDueDate(c) {
    var latest = '';
    state.payments.forEach(function (p) {
      if (!p || p.clientId !== c.id || p.status !== 'paid') return;
      if (paymentKindFromId(p.id).kind !== 'base') return;
      var d = fmtDate(p.dueDate);
      if (d && d > latest) latest = d;
    });
    return latest;
  }
  function setCurrentMonthPaid(c, makePaid) {
    if (state.role !== 'editor') return;
    var todayIso = today();
    // The chip toggles the PACKAGE state (packagePaidState — the same anchor
    // it renders from), so the toggle is gated on that state, never on a
    // Payments row: a legacy paid row whose anchor never advanced, or a paid
    // row filed under a different month, must not turn the click into a
    // silent no-op.
    var pkg = packagePaidState(c, todayIso);
    if (pkg.paid === !!makePaid) return; // already in the requested state
    // The row settled/reverted is the CYCLE row — the same one חידוש ותשלום
    // writes — not the calendar-month row (packages are cycles; a cycle that
    // straddles a month boundary has no current-calendar-month row at all):
    //   mark   -> the due cycle (cyclePaymentDueDate: the stored
    //             nextBillingDate when past/today, else the month's base due)
    //   unmark -> the row the mark wrote: remembered from this session's mark,
    //             else the latest paid base row, else the cycle one month
    //             before the advanced anchor
    var prevRemembered = monthPaidPrevClient[c.id];
    var dueDateISO;
    if (makePaid) {
      dueDateISO = cyclePaymentDueDate(c, todayIso);
    } else {
      dueDateISO = (prevRemembered && prevRemembered.dueDateISO) ||
        latestPaidBaseDueDate(c) ||
        prevCycleDueDateBefore(c, c.nextBillingDate) ||
        currentMonthBaseDueDate(c);
    }
    var base = paymentForClientOn(c, dueDateISO);
    var newStatus = makePaid ? 'paid' : 'unpaid';
    // Write the row only when it actually changes; when it already says so
    // (legacy paid row, already-reverted row) only the anchor moves — the
    // row's own paymentDate/amount history is left untouched.
    var rowNeedsWrite = base.status !== newStatus;
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
    // Client advance/revert, computed ONCE so the optimistic update and the
    // post-reload save write the same values.
    var clientPatch;
    if (makePaid) {
      monthPaidPrevClient[c.id] = { nextBillingDate: c.nextBillingDate, paymentDate: c.paymentDate, dueDateISO: dueDateISO };
      var advanced = nextCycleDueDateAfter(c, dueDateISO);
      // An anchor several cycles stale advances one cycle into the PAST; the
      // mark must land strictly ahead so the package reads paid-up (the first
      // cycle after today).
      if (advanced && advanced <= todayIso) {
        advanced = nextCycleDueDate(c, addDays(todayIso, 1)) || advanced;
      }
      clientPatch = {
        nextBillingDate: advanced,
        paymentDate: (!rowNeedsWrite && base.paymentDate) || today()
      };
    } else {
      // The revert must land strictly BEHIND today so the package reads
      // unpaid — an advance-paid row's own due date can still be ahead.
      var revertTo = (dueDateISO && dueDateISO < todayIso)
        ? dueDateISO
        : prevCycleDueDateBefore(c, dueDateISO || c.nextBillingDate);
      clientPatch = prevRemembered
        ? { nextBillingDate: prevRemembered.nextBillingDate, paymentDate: prevRemembered.paymentDate }
        : { nextBillingDate: revertTo, paymentDate: c.paymentDate };
      delete monthPaidPrevClient[c.id];
    }
    var prevClient = { nextBillingDate: c.nextBillingDate, paymentDate: c.paymentDate };
    var idx = state.payments.findIndex(function (p) { return p.id === updated.id; });
    var prev = idx >= 0 ? state.payments[idx] : null;
    if (rowNeedsWrite) {
      if (idx >= 0) state.payments[idx] = updated;
      else state.payments.push(updated);
    }
    c.nextBillingDate = clientPatch.nextBillingDate;
    c.paymentDate = clientPatch.paymentDate;
    render();
    (rowNeedsWrite ? persistPayment(updated) : Promise.resolve())
      .then(function () {
        // The month's payment row is saved. Persist the client advance: reload
        // first, patch the FRESH row, then save — never saveAll from old state.
        return loadAll()
          .then(function () {
            var fresh = state.clients.find(function (x) { return x.id === c.id; });
            if (!fresh) return; // client removed server-side; nothing to advance
            fresh.nextBillingDate = clientPatch.nextBillingDate;
            fresh.paymentDate = clientPatch.paymentDate;
            return persist();
          })
          .then(function () {
            render();
            toast(makePaid ? 'החודש סומן כשולם' : 'בוטל סימון התשלום');
          })
          .catch(function (e2) {
            // The payment row IS saved; only the client advance failed. Keep
            // the optimistic values on-screen (they ride along on the next
            // successful save) and say what happened.
            render();
            toast('התשלום נשמר אך עדכון תאריך הגבייה נכשל: ' + e2.message, true);
          });
      })
      .catch(function (e) {
        // Payment save failed: nothing was written — roll back the payment row
        // AND the client advance/revert (incl. the remembered pre-mark values).
        if (rowNeedsWrite) {
          if (prev) state.payments[idx] = prev;
          else state.payments = state.payments.filter(function (p) { return p.id !== updated.id; });
        }
        c.nextBillingDate = prevClient.nextBillingDate;
        c.paymentDate = prevClient.paymentDate;
        if (makePaid) delete monthPaidPrevClient[c.id];
        else if (prevRemembered) monthPaidPrevClient[c.id] = prevRemembered;
        render();
        toast('שמירה נכשלה: ' + e.message, true);
      });
  }

  // Toggle an extra charge's CURRENT-month (or ::once) payment paid/unpaid from
  // the patient card. Same single write path as the גבייה tab (persistPayment /
  // savePayment) and the same paid/unpaid rules as setCurrentMonthPaid — a plain
  // toggle stamped with today() on pay (no backdate; that stays in גבייה).
  // partial → paid. Optimistic update + rollback. Mirrors togglePaymentRow in
  // public/charges-logic.js — keep both in sync.
  function setChargePaid(c, ch) {
    if (state.role !== 'editor') return;
    var ex = paymentForExtraOn(c, ch, today());
    var makePaid = ex.status !== 'paid';   // paid → unpaid; unpaid/partial → paid
    var amount = ex.amountDue || toNum(ch.amount) || 0;
    var updated = {
      id: ex.id,
      clientId: ex.clientId || c.id,
      clientName: ex.clientName || c.name || '',
      billingType: ex.billingType || (ch.billingType === 'one_time' ? 'one_time' : 'monthly'),
      dueDate: ex.dueDate || today(),
      amountDue: amount,
      amountPaid: makePaid ? amount : 0,
      status: makePaid ? 'paid' : 'unpaid',
      paymentDate: makePaid ? today() : (ex.paymentDate || ''),
      method: ex.method || '', notes: ex.notes || ch.description || '',
      bundleSize: 0, sessionsUsed: 0
    };
    var idx = state.payments.findIndex(function (p) { return p.id === updated.id; });
    var prev = idx >= 0 ? state.payments[idx] : null;
    if (idx >= 0) state.payments[idx] = updated;
    else state.payments.push(updated);
    render();
    persistPayment(updated)
      .then(function () { toast(makePaid ? 'החיוב סומן כשולם' : 'בוטל סימון התשלום'); })
      .catch(function (e) {
        if (prev) state.payments[idx] = prev;
        else state.payments = state.payments.filter(function (p) { return p.id !== updated.id; });
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
    // Outstanding uses the EFFECTIVE amount (manual override wins over computed) so
    // the monthly summary matches what each open-balance row shows.
    var outstanding = thisMonth.filter(function (p) { return p.status !== 'paid'; })
      .reduce(function (s, p) { return s + Math.max(0, effectivePaymentAmount(p, p.amountDue || 0) - (p.amountPaid || 0)); }, 0);
    $('#billMonthCollected').textContent = money(collected);
    $('#billMonthOutstanding').textContent = money(outstanding);
    var q = state.billingSearch.trim().toLowerCase();
    var byClient = {};
    thisMonth.forEach(function (p) {
      if (q && (p.clientName || '').toLowerCase().indexOf(q) === -1) return;
      var key = p.clientId || p.clientName || '—';
      if (!byClient[key]) byClient[key] = { name: p.clientName || '—', collected: 0, outstanding: 0 };
      byClient[key].collected += (p.amountPaid || 0);
      if (p.status !== 'paid') byClient[key].outstanding += Math.max(0, effectivePaymentAmount(p, p.amountDue || 0) - (p.amountPaid || 0));
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

  // Leads ONLY — a lead is someone who has not started treatment. Patients who
  // left (discharged or cross-app deactivated) live in the dedicated
  // מטופלים לא פעילים tab (renderInactive), not here.
  function renderRetention() {
    var list = $('#retentionList');
    list.innerHTML = '';

    var rq = state.retentionSearch.trim().toLowerCase();
    var notRel = state.leads.filter(function (l) {
      if (l.stage !== 'not_relevant') return false;
      if (rq && l.name.toLowerCase().indexOf(rq) === -1) return false;
      return true;
    });

    if (!notRel.length) {
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
  }

  // Lazily fetch the Clients-removed tombstones the first time a surface
  // needs them; onDone re-renders the calling view once they arrive.
  // state.removedClients: null = not fetched, 'loading' = in flight,
  // array = loaded (empty on failure so the calling view still renders).
  function ensureRemovedClients(onDone) {
    if (state.removedClients !== null) return;
    state.removedClients = 'loading';
    apiGetRemovedClients()
      .then(function (d) { state.removedClients = d.removed || []; })
      .catch(function (e) {
        console.warn('[ezone] getRemovedClients failed:', e.message);
        state.removedClients = [];
      })
      .then(function () { if (onDone) onDone(); });
  }

  // Restore one tombstoned client (editor-only): confirm → the server copies
  // the latest un-restored tombstone back to Clients and stamps restoredAt →
  // full reload so the restored card shows everywhere. The tombstone row
  // itself is never deleted (append-only audit trail).
  function performRestoreRemovedClient(id, name) {
    if (state.role !== 'editor') return;
    if (!confirm('לשחזר את ' + (name || 'המטופל') + ' לרשימת המטופלים?')) return;
    apiPostAction('restoreRemovedClient', { id: id })
      .then(function () {
        state.removedClients = null; // refetch on next need
        return loadAll();
      })
      .then(function () { toast('שוחזר'); })
      .catch(function (e) { toast('שגיאה בשחזור: ' + e.message, true); });
  }

  // ---- Inactive patients (מטופלים לא פעילים) ----
  // Patients only — never leads. Two sections:
  //   סיימו טיפול — Vered's manual discharge (exit modal), win-back candidates.
  //   לא פעיל     — cross-app deactivated: the patient was DELETED in the
  //                 E-Zone Therapists app and the deactivateClient receiver
  //                 soft-marked the Client row here.
  // Both card kinds carry the שחזר לטיפול button (editor-only) into the same
  // restore confirm modal.
  // A third section, מטופלים שנמחקו, lists un-restored Clients-removed
  // tombstones (patients with NO Clients row anymore — deleted or clobbered);
  // their שחזר מטופל goes through restoreRemovedClient instead.
  function renderInactive() {
    var list = $('#inactiveList');
    if (!list) return;
    list.innerHTML = '';

    var iq = state.inactiveSearch.trim().toLowerCase();
    function matches(c) { return !iq || c.name.toLowerCase().indexOf(iq) !== -1; }
    var finished = state.clients.filter(function (c) {
      return c.status === 'סיים טיפול' && matches(c);
    });
    var deactivated = state.clients.filter(function (c) {
      return c.status === 'לא פעיל' && matches(c);
    });
    // Deleted patients: un-restored Clients-removed tombstones (the _saveAll
    // row-loss guard). Lazily fetched on first render of this tab.
    ensureRemovedClients(function () { if (state.view === 'inactive') renderInactive(); });
    var removedRows = Array.isArray(state.removedClients)
      ? state.removedClients.filter(function (t) {
          return !iq || String(t.name || '').toLowerCase().indexOf(iq) !== -1;
        })
      : [];

    if (!finished.length && !deactivated.length && !removedRows.length) {
      list.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">אין מטופלים לא פעילים</p></div>';
      return;
    }

    function inactiveSection(title, patients, badgeHtml, extraRowsFor) {
      if (!patients.length) return;
      var h = document.createElement('div');
      h.style.cssText = 'font-size:0.95rem;font-weight:700;color:#9fcfcf;padding:18px 4px 8px;border-bottom:2px solid #2a3f5a;margin-bottom:12px;';
      h.textContent = title;
      list.appendChild(h);
      patients.forEach(function (c) {
        var card = document.createElement('div');
        card.style.cssText = 'background:#1a2e4a;border:1px solid #2a3f5a;border-radius:10px;padding:16px 20px;margin-bottom:12px;display:block;';
        var header = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
          '<span style="font-weight:700;font-size:1rem;color:#fff;">' + escapeHtml(c.name) + '</span>' +
          badgeHtml +
          '</div>';
        var body = retRow('טלפון', c.phone ? escapeHtml(String(c.phone)) : '') +
          retRow('סוג טיפול', c.serviceType ? escapeHtml(formatServices(parseServices(c.serviceType))) : '') +
          retRow('סניף', c.location ? escapeHtml(c.location) : '') +
          retRow('בית מוצא', escapeHtml(houseOfOriginLabel(c.house_of_origin))) +
          retRow('תחילת טיפול', c.startDate ? displayDate(c.startDate) : '') +
          extraRowsFor(c) +
          retRow('הערות', c.notes ? escapeHtml(c.notes) : '');
        card.innerHTML = header + body;
        if (state.role === 'editor') {
          var restorePatientBtn = document.createElement('button');
          restorePatientBtn.className = 'btn btn-ghost';
          restorePatientBtn.style.marginTop = '10px';
          restorePatientBtn.textContent = 'שחזר לטיפול';
          restorePatientBtn.onclick = function () { openRestoreClientModal(c); };
          card.appendChild(restorePatientBtn);
        }
        list.appendChild(card);
      });
    }

    inactiveSection('סיימו טיפול', finished,
      '<span style="font-size:0.72rem;padding:2px 10px;border-radius:20px;background:#d4edda;color:#155724;font-weight:600;">סיים טיפול</span>',
      function (c) { return retRow('סיום טיפול', c.exitDate ? displayDate(c.exitDate) : ''); });

    inactiveSection('לא פעילים', deactivated,
      '<span style="font-size:0.72rem;padding:2px 10px;border-radius:20px;background:#f8d7da;color:#721c24;font-weight:600;">לא פעיל</span>',
      function () { return retRow('מקור', 'הוסר באפליקציית המטפלים'); });

    // מטופלים שנמחקו — Clients-removed tombstones. Same card look as the two
    // sections above, but the restore path is different: these patients have
    // NO Clients row anymore, so שחזר מטופל goes through restoreRemovedClient
    // (the server copies the tombstone back to Clients), not the status-based
    // restore modal.
    if (removedRows.length) {
      var rh = document.createElement('div');
      rh.style.cssText = 'font-size:0.95rem;font-weight:700;color:#9fcfcf;padding:18px 4px 8px;border-bottom:2px solid #2a3f5a;margin-bottom:12px;';
      rh.textContent = 'מטופלים שנמחקו';
      list.appendChild(rh);
      removedRows.forEach(function (t) {
        var card = document.createElement('div');
        card.style.cssText = 'background:#1a2e4a;border:1px solid #2a3f5a;border-radius:10px;padding:16px 20px;margin-bottom:12px;display:block;';
        var viaLabel = t.removedVia === 'explicit-delete' ? 'נמחק ידנית (✕)' : 'נשמט בשמירה — שחזור זמין';
        var header = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
          '<span style="font-weight:700;font-size:1rem;color:#fff;">' + escapeHtml(t.name || '') + '</span>' +
          '<span style="font-size:0.72rem;padding:2px 10px;border-radius:20px;background:#e2d6f8;color:#4a2a80;font-weight:600;">נמחק</span>' +
          '</div>';
        var body = retRow('טלפון', t.phone ? escapeHtml(String(t.phone)) : '') +
          retRow('סוג טיפול', t.serviceType ? escapeHtml(formatServices(parseServices(t.serviceType))) : '') +
          retRow('סניף', t.location ? escapeHtml(t.location) : '') +
          retRow('סטטוס בעת המחיקה', t.status ? escapeHtml(t.status) : '') +
          retRow('נמחק ב', t.removedAt ? displayDate(t.removedAt) : '') +
          retRow('אופן המחיקה', viaLabel) +
          retRow('הערות', t.notes ? escapeHtml(t.notes) : '');
        card.innerHTML = header + body;
        if (state.role === 'editor') {
          var restoreRemovedBtn = document.createElement('button');
          restoreRemovedBtn.className = 'btn btn-ghost';
          restoreRemovedBtn.style.marginTop = '10px';
          restoreRemovedBtn.textContent = 'שחזר מטופל';
          restoreRemovedBtn.onclick = function () { performRestoreRemovedClient(String(t.id), t.name); };
          card.appendChild(restoreRemovedBtn);
        }
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
    // KPIs stay GLOBAL — they are the month overview (therapist count, paid
    // sessions, totals) and, like the billing-tab KPIs, must not move when the
    // user types a name. Only the rendered card list narrows.
    setPayoutKpis(summary.therapists.length, summary.totals.paidCount,
      summary.totals.preVatTotal, summary.totals.vatTotal);

    listEl.innerHTML = '';
    var diffs = (summary.differences && summary.differences.therapists) || [];

    if (!summary.therapists.length && !diffs.length) {
      listEl.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">אין סשנים לחודש זה</p></div>';
      return;
    }

    // Per-tab name search: match the therapist name (the card's identity).
    // Empty query -> every card, exactly as before.
    var byName = function (t) { return t.therapist; };
    var visibleTherapists = NameSearch.filterByName(summary.therapists, state.payoutSearch, byName);
    var visibleDiffs = NameSearch.filterByName(diffs, state.payoutSearch, byName);

    if (!visibleTherapists.length && !visibleDiffs.length) {
      listEl.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">אין מטפלים התואמים לחיפוש</p></div>';
      return;
    }

    visibleTherapists.forEach(function (t) {
      listEl.appendChild(payoutTherapistCard(t, { isDiff: false }));
    });

    if (visibleDiffs.length) {
      var header = document.createElement('div');
      header.style.cssText = 'margin:22px 0 10px;display:flex;align-items:baseline;gap:10px;';
      header.innerHTML =
        '<span style="font-size:1.05rem;font-weight:700;color:#e0b15a;">הפרשים</span>' +
        '<span style="font-size:0.85rem;color:#7d93b0;">סשנים מחודשים שכבר הועברו לחשבת שכר (תשלום משלים)</span>';
      listEl.appendChild(header);
      visibleDiffs.forEach(function (t) {
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

  // ===== Continuation track (מסלול המשך) ====================================
  // A roster of currently-admitted DASHBOARD patients (potential outpatient
  // leads), joined to workflow rows persisted in the OUTPATIENT sheet by
  // key = name|house|entryDate. Yarden records a meeting date + outcome per
  // patient. Roster house ids come from the dashboard (arfoni/asher/…); labels
  // below mirror the dashboard's HOUSES so sections read the same everywhere.
  var CONTINUATION_HOUSE_LABELS = {
    arfoni: 'קיסריה עפרוני',
    rehab:  'קיסריה ריהאב',
    asher:  'רעננה אשר',
    pardes: 'רעננה הפרדס',
    ramot:  'רמות השבים',
    sde:    'שדה אליעזר'
  };
  function continuationHouseLabel(h) {
    var s = String(h == null ? '' : h).trim();
    return CONTINUATION_HOUSE_LABELS[s] || s || 'ללא בית';
  }
  // Stable outcome key -> Hebrew display label (render-time only).
  var CONTINUATION_OUTCOME_LABELS = {
    '': '—',
    continuing:    'ממשיך באשפוז',
    to_outpatient: 'מועבר לטיפול חוץ',
    stopping:      'מפסיק טיפול'
  };
  var CONTINUATION_OUTCOME_OPTIONS = [
    { v: '',              he: '—' },
    { v: 'continuing',    he: 'ממשיך באשפוז' },
    { v: 'to_outpatient', he: 'מועבר לטיפול חוץ' },
    { v: 'stopping',      he: 'מפסיק טיפול' }
  ];

  // key -> patient view-model, rebuilt each render so save handlers can look up
  // the roster fields (name/phone/house/entryDate) a row was rendered from.
  var continuationVM = {};

  async function apiGetContinuationRoster() {
    var r = await apiFetch('/api/continuation-roster', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function apiGetContinuation() {
    var r = await apiFetch('/api/sheets?action=getContinuation', { cache: 'no-store' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function persistContinuationRow(row) {
    return apiPostAction('saveContinuation', row);
  }

  function ensureContinuationLoaded() {
    if (state.continuationRoster !== null || state.continuationLoading) return;
    state.continuationLoading = true;
    state.continuationError = '';
    Promise.all([
      apiGetContinuationRoster()
        .then(function (d) { return { patients: Array.isArray(d.patients) ? d.patients : [] }; })
        .catch(function (e) { state.continuationError = e.message || String(e); return { patients: [] }; }),
      apiGetContinuation()
        .then(function (d) { return { rows: Array.isArray(d.rows) ? d.rows : [] }; })
        .catch(function () { return { rows: [] }; })
    ]).then(function (res) {
      state.continuationRoster = res[0].patients;
      state.continuationRows = res[1].rows;
      state.continuationLoading = false;
      if (state.view === 'continuation') renderContinuation();
    });
  }

  function upsertContinuationLocal(row) {
    var key = String(row.key || '').trim();
    var i = state.continuationRows.findIndex(function (r) { return String(r.key || '').trim() === key; });
    if (i === -1) state.continuationRows.push(row);
    else state.continuationRows[i] = row;
  }

  function continuationTenureBadge(p) {
    if (p.months == null) {
      return '<span class="chip continuation-tenure continuation-tenure-0">—</span>';
    }
    var label = p.months === 1 ? '1 חודש' : (p.months + ' חודשים');
    return '<span class="chip continuation-tenure continuation-tenure-' + p.bucket + '">' +
      escapeHtml(label) + '</span>';
  }

  function continuationRowHtml(p, editor) {
    var badge = continuationTenureBadge(p);
    // Admission date beside the tenure badge (dd/mm/yyyy), blank when the roster
    // carries no entryDate. Reuses the app-wide displayDate() helper.
    var entryHtml = p.entryDate
      ? '<span class="continuation-entrydate">' + escapeHtml(displayDate(p.entryDate)) + '</span>'
      : '';
    var outcomeChip = p.outcome
      ? '<span class="chip continuation-outcome-chip continuation-oc-' + p.outcome + '">' +
          escapeHtml(CONTINUATION_OUTCOME_LABELS[p.outcome]) + '</span>'
      : '';
    var keyAttr = escapeHtml(p.key);
    var phoneHtml = p.phone
      ? '<a class="continuation-phone" href="tel:' + escapeHtml(p.phone) + '">' + escapeHtml(p.phone) + '</a>'
      : '';
    var head = '<div class="continuation-main">' +
      '<span class="continuation-name">' + escapeHtml(p.name) + '</span>' +
      phoneHtml + badge + entryHtml + outcomeChip +
    '</div>';

    var body;
    if (editor) {
      var options = CONTINUATION_OUTCOME_OPTIONS.map(function (o) {
        return '<option value="' + o.v + '"' + (o.v === p.outcome ? ' selected' : '') + '>' +
          escapeHtml(o.he) + '</option>';
      }).join('');
      body = '<div class="continuation-controls">' +
        '<label class="continuation-ctl">תאריך לפגישה' +
          '<input type="date" data-cfield="meetingDate" value="' + escapeHtml(p.meetingDate) + '"></label>' +
        '<label class="continuation-ctl">תוצאת פגישה' +
          '<select data-cfield="outcome">' + options + '</select></label>' +
        '<label class="continuation-ctl continuation-note-ctl">הערה' +
          '<input type="text" data-cfield="note" value="' + escapeHtml(p.note) + '" placeholder="הערה קצרה"></label>' +
        '<button type="button" class="btn btn-primary continuation-save" data-caction="save">שמור</button>' +
      '</div>';
    } else {
      var ro = [];
      if (p.meetingDate) ro.push('פגישה: ' + escapeHtml(p.meetingDate));
      if (p.note) ro.push(escapeHtml(p.note));
      body = ro.length ? '<div class="continuation-controls-ro">' + ro.join(' · ') + '</div>' : '';
    }
    return '<div class="continuation-row" data-key="' + keyAttr + '">' + head + body + '</div>';
  }

  function continuationCollapsedGroup(kind, title, rows, editor) {
    return '<details class="continuation-collapsed continuation-grp-' + kind + '">' +
      '<summary>' + escapeHtml(title) + ' (' + rows.length + ')</summary>' +
      '<div class="continuation-rows">' +
        rows.map(function (p) { return continuationRowHtml(p, editor); }).join('') +
      '</div>' +
    '</details>';
  }

  // Longest-tenure first; missing entryDate (months == null) sorts last;
  // Hebrew-alphabetical tiebreak. The comparator is the single source of truth
  // in continuation-logic.js (pure + unit-tested); renderContinuation() has
  // already bailed if the module failed to load, so it is always present here.
  function continuationSort(a, b) {
    return window.ContinuationLogic.compareByTenure(a, b);
  }

  function continuationSection(house, rows, editor) {
    var section = document.createElement('div');
    section.className = 'panel continuation-section';
    var active = [], toLeads = [], stopped = [];
    rows.forEach(function (p) {
      if (p.outcome === 'stopping') stopped.push(p);
      else if (p.outcome === 'to_outpatient') toLeads.push(p);
      else active.push(p);
    });
    active.sort(continuationSort);
    toLeads.sort(continuationSort);
    stopped.sort(continuationSort);

    var html = '<div class="continuation-house-title">' + escapeHtml(continuationHouseLabel(house)) +
      ' <span class="continuation-house-count">(' + active.length + ')</span></div>';
    html += '<div class="continuation-rows">' +
      active.map(function (p) { return continuationRowHtml(p, editor); }).join('') +
    '</div>';
    if (toLeads.length) html += continuationCollapsedGroup('to_outpatient', 'הועברו ללידים', toLeads, editor);
    if (stopped.length) html += continuationCollapsedGroup('stopping', 'הפסיקו טיפול', stopped, editor);
    section.innerHTML = html;
    return section;
  }

  function renderContinuation() {
    var listEl = $('#continuationList');
    if (!listEl) return;
    var CL = (typeof window !== 'undefined' && window.ContinuationLogic) || null;
    if (!CL) {
      listEl.innerHTML = '<div class="panel"><p style="color:#e88;padding:20px">מודול הלוגיקה לא נטען</p></div>';
      return;
    }
    if (state.continuationRoster === null) {
      ensureContinuationLoaded();
      listEl.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">טוען רוסטר…</p></div>';
      return;
    }
    if (state.continuationError && !state.continuationRoster.length) {
      listEl.innerHTML = '<div class="panel"><p style="color:#e88;padding:20px">שגיאה בטעינת הרוסטר: ' +
        escapeHtml(state.continuationError) + '</p></div>';
      return;
    }

    var editor = state.role === 'editor';
    var q = (state.continuationSearch || '').trim().toLowerCase();
    var todayISO = today();

    var byKey = {};
    state.continuationRows.forEach(function (row) {
      if (row && row.key != null) byKey[String(row.key).trim()] = row;
    });

    continuationVM = {};
    var patients = state.continuationRoster.map(function (p) {
      var name = String(p.name || '').trim();
      var house = String(p.house || '').trim();
      var entryDate = String(p.entryDate || '').trim();
      var key = CL.buildKey(name, house, entryDate);
      var row = byKey[key] || {};
      var months = CL.monthsSince(entryDate, todayISO);
      var vm = {
        key: key, name: name, phone: String(p.phone || '').trim(),
        house: house, entryDate: entryDate,
        months: months, bucket: CL.bucketOf(months),
        meetingDate: row.meetingDate || '',
        outcome: CL.isValidOutcome(row.outcome) ? row.outcome : '',
        note: row.note || ''
      };
      continuationVM[key] = vm;
      return vm;
    });

    if (q) patients = patients.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });

    if (!patients.length) {
      listEl.innerHTML = '<div class="panel"><p style="color:#888;padding:20px">אין מטופלים מאושפזים להצגה</p></div>';
      return;
    }

    var groups = {};
    var houseOrder = [];
    patients.forEach(function (p) {
      if (!groups[p.house]) { groups[p.house] = []; houseOrder.push(p.house); }
      groups[p.house].push(p);
    });
    houseOrder.sort(function (a, b) {
      return continuationHouseLabel(a).localeCompare(continuationHouseLabel(b), 'he');
    });

    listEl.innerHTML = '';
    houseOrder.forEach(function (house) {
      listEl.appendChild(continuationSection(house, groups[house], editor));
    });
  }

  // Persist one workflow row (optimistic + rollback). outcomeDate is stamped
  // server-relative today whenever an outcome is set.
  function saveContinuationRow(key, patch) {
    var vm = continuationVM[key];
    if (!vm) return;
    var outcome = CONTINUATION_OUTCOME_LABELS[patch.outcome] !== undefined ? patch.outcome : '';
    var row = {
      key: key,
      name: vm.name, house: vm.house, entryDate: vm.entryDate,
      meetingDate: patch.meetingDate || '',
      outcome: outcome,
      outcomeDate: outcome ? today() : '',
      note: patch.note || ''
    };
    var prevRows = state.continuationRows.slice();
    upsertContinuationLocal(row);
    renderContinuation();
    persistContinuationRow(row)
      .then(function () { toast('נשמר'); })
      .catch(function (err) {
        state.continuationRows = prevRows;
        renderContinuation();
        toast('שמירה נכשלה: ' + err.message, true);
      });
  }

  // to_outpatient: create a lead through the EXACT manual add-lead path (so the
  // duplicate-phone soft warning + _writeAll semantics apply), then — only if the
  // lead was actually created — save the outcome row.
  function continuationCreateLead(vm, meetingDate, done) {
    var phone = normalizePhone(vm.phone || '');
    var CL = (typeof window !== 'undefined' && window.ContinuationLogic) || null;
    // Map the dashboard houseId to the outpatient house_of_origin key. An
    // unmapped id (e.g. 'sde') → house_of_origin '' and the raw id kept in the
    // note so the provenance isn't lost.
    var origin = CL ? CL.houseToOrigin(vm.house) : '';
    var note = 'מקור: מסלול המשך | פגישה: ' + (meetingDate || '—');
    if (!origin && vm.house) note += ' | בית: ' + vm.house;
    var lead = {
      id: uid(), name: vm.name, phone: phone,
      serviceType: '', location: '',
      note: note,
      stage: 'new', sessionsPerWeek: '', pricePerSession: '',
      startDate: '', created: today(), introDateTime: '',
      paymentStatus: '', paymentDate: '', nextBillingDate: '',
      house_of_origin: origin,
      source: 'מסלול המשך',
      assignedTo: ''
    };
    function doAdd() {
      state.leads.push(lead);
      persist()
        .then(function () { toast('נוצר ליד חדש'); done(true); })
        .catch(function (err) {
          state.leads = state.leads.filter(function (l) { return l.id !== lead.id; });
          toast('יצירת הליד נכשלה: ' + err.message, true);
          done(false);
        });
    }
    var existing = phone ? state.leads.find(function (l) {
      if (!l || l.stage === 'removed') return false;
      return normalizePhone(l.phone || '') === phone;
    }) : null;
    if (existing) openDuplicateLeadModal(existing, doAdd);
    else doAdd();
  }

  var pendingContinuationLead = null;
  function openContinuationToOutpatientModal(vm, meetingDate, note) {
    pendingContinuationLead = { key: vm.key, meetingDate: meetingDate, note: note };
    var nameEl = $('#continuationToOutpatientName');
    if (nameEl) nameEl.textContent = vm.name || '';
    var m = $('#continuationToOutpatientModal');
    if (m) m.hidden = false;
  }
  function closeContinuationToOutpatientModal() {
    var m = $('#continuationToOutpatientModal');
    if (m) m.hidden = true;
    pendingContinuationLead = null;
  }

  function handleContinuationListClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-caction="save"]') : null;
    if (!btn) return;
    if (state.role !== 'editor') return;
    var rowEl = e.target.closest('.continuation-row');
    if (!rowEl) return;
    var key = rowEl.getAttribute('data-key');
    var vm = continuationVM[key];
    if (!vm) return;
    var mEl = rowEl.querySelector('[data-cfield="meetingDate"]');
    var oEl = rowEl.querySelector('[data-cfield="outcome"]');
    var nEl = rowEl.querySelector('[data-cfield="note"]');
    var patch = {
      meetingDate: mEl ? mEl.value : '',
      outcome: oEl ? oEl.value : '',
      note: nEl ? nEl.value : ''
    };
    // Transition INTO to_outpatient: confirm + create the lead first.
    if (patch.outcome === 'to_outpatient' && vm.outcome !== 'to_outpatient') {
      openContinuationToOutpatientModal(vm, patch.meetingDate, patch.note);
      return;
    }
    saveContinuationRow(key, patch);
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
    if (l.assignedTo) {
      chipsHtml += '<span class="chip">משוייך: ' + escapeHtml(l.assignedTo) + '</span>';
    }
    var agreementFields = '';
    if (stage.id === 'agreement') {
      var breakdown = parseSessionsBreakdown(l.sessionsPerWeek, services);
      var bdUnits = l.sessionsUnit || parseSessionsUnits(l.sessionsPerWeek);
      var bdChips = Object.keys(breakdown).map(function (k) {
        return '<span class="chip">' + escapeHtml(serviceLabel(k)) + ': ' + breakdown[k] + '/' + sessionUnitFor(k, bdUnits) + '</span>';
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
      // תוכנית טיפול is now the terminal lead stage: converting to an active
      // patient happens here via the activate modal (creates the client record).
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
      // Both inactive kinds live in the מטופלים לא פעילים tab, not here.
      if (c.status === 'סיים טיפול' || c.status === 'לא פעיל') return false;
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
    // Urgency sort: red (overdue) first, then renewals by soonest, everyone
    // else stable. renewalInfo() is computed ONCE per card here and reused —
    // the sort never recomputes urgency independently of the banner.
    var decorated = visible.map(function (c, i) {
      var info = renewalInfo(c);
      return { client: c, tier: urgencyTier(info.status), daysLeft: info.daysLeft, index: i };
    });
    decorated.sort(compareCardUrgency);
    decorated.forEach(function (d) { list.appendChild(clientCard(d.client)); });
    if (!decorated.length) list.innerHTML = '<div class="panel">אין מטופלים להצגה.</div>';
  }

  function statusClass(s) {
    if (s === 'פעיל') return 'status-active';
    if (s === 'הפסקה זמנית') return 'status-pause';
    return 'status-done';
  }

  function clientCard(c) {
    var card = document.createElement('div');
    card.className = 'client-card';
    var services = parseServices(c.serviceType);
    var locationChip = c.location ? '<span class="chip">' + escapeHtml(c.location) + '</span>' : '';
    var phoneChip = c.phone ? '<span class="chip">📞 ' + escapeHtml(c.phone) + '</span>' : '';
    var assignedChip = c.assignedTo ? '<span class="chip">משוייך: ' + escapeHtml(c.assignedTo) + '</span>' : '';

    // Monthly session-credit balance (server-managed): cancelled-by-therapist
    // sessions bank a credit; a session beyond the monthly quota spends one.
    var credits = toNum(c.creditsOwed) || 0;
    var creditRow = '<div class="cc-line"><span class="cc-k">קרדיט מפגשים</span>' +
      '<span class="cc-v' + (credits > 0 ? ' credit-pos' : '') + '">' + credits + '</span></div>';

    // Treatment-type rows (name + frequency). Weekly unit here is corrected to a
    // per-type unit (psychiatric = monthly) in the dedicated unit-fix commit.
    var breakdown = parseSessionsBreakdown(c.sessionsPerWeek, c.serviceType);
    var planUnits = c.sessionsUnit || parseSessionsUnits(c.sessionsPerWeek);
    var planRows = services.map(function (s) {
      var n = breakdown[s];
      var freq = (n || n === 0) ? n + '/' + sessionUnitFor(s, planUnits) : '';
      return '<div class="cc-line"><span class="cc-k">' + escapeHtml(serviceLabel(s)) + '</span>' +
             '<span class="cc-v">' + freq + '</span></div>';
    }).join('');
    if (!planRows) planRows = '<div class="cc-line cc-muted">לא נקבעו מפגשים</div>';

    var hooLabelClient = houseOfOriginLabel(c.house_of_origin);
    var hooRow = hooLabelClient
      ? '<div class="cc-line"><span class="cc-k">בית מוצא</span><span class="cc-v">' + escapeHtml(hooLabelClient) + '</span></div>'
      : '';

    // Monthly base-payment status for the CURRENT month. Driven by the same
    // per-month payment row the גבייה tab uses (paymentForClientOn) so both
    // tabs stay consistent. For editors it is a toggle button: unpaid/partial →
    // mark paid, paid → revert to unpaid (both via persistPayment).
    var paidChipHtml = '';
    var paidOnRow = '';
    if (c.status !== 'סיים טיפול') {
      // Paid-up follows the BILLING CYCLE, not the calendar month: a cycle
      // paid on 31/8 that runs to 30/09 has no September calendar-month row,
      // yet the package is fully paid. packagePaidState reads the same
      // nextBillingDate anchor the renewal banner counts to, so the chip and
      // the banner can never disagree again.
      var pkg = packagePaidState(c, today());
      var untilDM = pkg.until ? pkg.until.slice(8, 10) + '/' + pkg.until.slice(5, 7) : '';
      if (state.role === 'editor') {
        paidChipHtml = pkg.paid
          ? '<button type="button" class="chip chip-paid month-pay-btn" data-action="mark-month-unpaid" title="החבילה הנוכחית שולמה; גבייה הבאה ' + displayDate(pkg.until) + '">שולם עד ' + untilDM + ' ✓</button>'
          : '<button type="button" class="chip chip-unpaid month-pay-btn" data-action="mark-month-paid" title="סמן את החבילה כשולמה — יזיז את גבייה הבאה למחזור הבא">לא שולם ✓</button>';
      } else {
        paidChipHtml = pkg.paid
          ? '<span class="chip chip-paid">שולם עד ' + untilDM + '</span>'
          : '<span class="chip chip-unpaid">לא שולם</span>';
      }
      // שולם ב: the payment date of the row covering the CURRENT cycle — the
      // cycle one month before the advanced anchor (that row's due date is the
      // pre-advance anchor). Falls back to the client's own stamped paymentDate.
      var cyclePaidOn = '';
      if (pkg.paid) {
        var cycleRow = paymentForClientOn(c, prevCycleDueDateBefore(c, pkg.until) || pkg.until);
        cyclePaidOn = (cycleRow.status === 'paid' && cycleRow.paymentDate) || c.paymentDate || '';
      }
      paidOnRow = cyclePaidOn
        ? '<div class="cc-line"><span class="cc-k">שולם ב</span><span class="cc-v">' + displayDate(cyclePaidOn) + '</span></div>'
        : '';
    }
    var nextBillRow = c.nextBillingDate
      ? '<div class="cc-line cc-line-hot"><span class="cc-k">גבייה הבאה</span><span class="cc-v">' + displayDate(c.nextBillingDate) + '</span></div>'
      : '';
    var startRow = c.startDate
      ? '<div class="cc-line"><span class="cc-k">תחילת טיפול</span><span class="cc-v">' + displayDate(c.startDate) + '</span></div>'
      : '';

    // Extra charges (active only) — additional treatments layered on the base
    // package. Rendered INSIDE the treatment panel; only present when the patient
    // has active charges, so empty cards stay clean. Carries the × remove control.
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
        // Editors get a clickable toggle (paid ⇄ unpaid); viewers see a static badge.
        var statusBadge = state.role === 'editor'
          ? '<button type="button" class="charge-status charge-status-' + status + ' charge-status-toggle" data-charge-toggle="' + escapeHtml(ch.id) + '" title="' + (status === 'paid' ? 'בטל סימון תשלום' : 'סמן כשולם') + '">' + statusLabel + '</button>'
          : '<span class="charge-status charge-status-' + status + '">' + statusLabel + '</span>';
        // Editors also get an ✏️ edit action (correct a wrong amount/type/etc.);
        // it opens a small modal and saves via the SAME charge row (stable id).
        var editBtn = state.role === 'editor'
          ? '<button type="button" class="charge-edit edit-only" title="ערוך חיוב" data-charge-edit="' + escapeHtml(ch.id) + '">✏️</button>'
          : '';
        return '<li class="charge-row" data-charge-id="' + escapeHtml(ch.id) + '">' +
          '<span class="charge-label">' + label + '</span>' +
          statusBadge +
          editBtn +
          '<button type="button" class="charge-remove edit-only" title="הסר חיוב" data-charge-remove="' + escapeHtml(ch.id) + '">×</button>' +
          '</li>';
      }).join('');
      chargesHtml = '<ul class="client-charges">' + items + '</ul>';
    }

    // כספים (right, RTL reads first): ALL money/financial content lives here —
    // the monthly package amount + paid chip + dated rows AND the extra-charge
    // rows (חד-פעמי/חודשי chips with paid-toggle + edit/remove). Nothing financial
    // renders in the left plan panel anymore.
    var moneyPanel =
      '<div class="cc-panel cc-money">' +
        '<div class="cc-panel-title">כספים</div>' +
        '<div class="cc-amount">' + money(c.pricePerSession) +
          '<span class="cc-amount-sub">חבילה חודשית</span></div>' +
        (paidChipHtml ? '<div class="cc-chips">' + paidChipHtml + '</div>' : '') +
        paidOnRow + nextBillRow + startRow +
        chargesHtml +
      '</div>';

    // תוכנית טיפול (left): treatment-type rows, session credit, בית מוצא. Purely
    // clinical/plan content — money moved out to the right כספים panel.
    var planPanel =
      '<div class="cc-panel cc-plan">' +
        '<div class="cc-panel-title">תוכנית טיפול</div>' +
        planRows +
        creditRow +
        hooRow +
      '</div>';

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

    card.innerHTML =
      renewBannerHtml +
      '<div class="cc-top">' +
        '<div class="client-head">' +
          '<div class="client-name">' + escapeHtml(c.name) + '</div>' +
          '<span class="status-badge ' + statusClass(c.status) + '">' + escapeHtml(c.status) + '</span>' +
        '</div>' +
        ((phoneChip || locationChip || assignedChip) ? '<div class="client-meta">' + phoneChip + locationChip + assignedChip + '</div>' : '') +
      '</div>' +
      '<div class="cc-body">' + moneyPanel + planPanel + '</div>' +
      '<div class="client-actions edit-only"></div>';

    if (state.role === 'editor') {
      var actions = $('.client-actions', card);

      // Consolidated card actions — exactly three primary buttons, in this order:
      //   עריכה | חידוש ותשלום | + הוסף טיפול
      // The former standalone "שינוי חבילה" button is gone; package changes now live
      // inside the חידוש ותשלום modal (one save = renewal + any package change).
      var editBtn = document.createElement('button');
      editBtn.className = 'btn btn-ghost';
      editBtn.textContent = 'עריכה';
      editBtn.title = 'ערוך פרטי טיפול';
      editBtn.onclick = function () { openEditClientModal(c); };
      actions.appendChild(editBtn);

      var renewBtn = document.createElement('button');
      renewBtn.className = 'btn btn-ghost edit-only';
      renewBtn.textContent = 'חידוש ותשלום';
      renewBtn.title = 'רשום תשלום מראש לחודש הבא, עדכן את הסכום החודשי ואת החבילה';
      renewBtn.onclick = function () { openRenewModal(c); };
      actions.appendChild(renewBtn);

      var addChargeBtn = document.createElement('button');
      addChargeBtn.className = 'btn btn-ghost edit-only';
      addChargeBtn.textContent = '+ הוסף טיפול';
      addChargeBtn.title = 'הוסף חיוב חד-פעמי או חודשי';
      addChargeBtn.onclick = function () { openAddChargeModal(c); };
      actions.appendChild(addChargeBtn);

      // Wire × buttons on the inline charge list.
      $$('[data-charge-remove]', card).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var chargeId = btn.getAttribute('data-charge-remove');
          handleRemoveCharge(chargeId);
        });
      });

      // Wire the extra-charge status badges as paid ⇄ unpaid toggles (editor only).
      $$('[data-charge-toggle]', card).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var chargeId = btn.getAttribute('data-charge-toggle');
          var ch = state.charges.find(function (x) { return x.id === chargeId; });
          if (ch) setChargePaid(c, ch);
        });
      });

      // Wire the ✏️ edit action on each charge row (editor only) → prefilled modal.
      $$('[data-charge-edit]', card).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var chargeId = btn.getAttribute('data-charge-edit');
          var ch = state.charges.find(function (x) { return x.id === chargeId; });
          if (ch) openEditChargeModal(c, ch);
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
        // Optimistic: apply + render now, persist in background, roll back the
        // status (and re-sync the select) on failure.
        var prevStatus = c.status;
        c.status = statusSel.value;
        render();
        persist()
          .then(function () { toast('עודכן'); })
          .catch(function (e) {
            c.status = prevStatus;
            render();
            toast('שמירה נכשלה: ' + e.message, true);
          });
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
        var deletedId = c.id;
        state.clients = state.clients.filter(function (x) { return x.id !== deletedId; });
        // Also drop this patient's charge rows so they can't become orphans.
        state.charges = state.charges.filter(function (ch) { return ch.clientId !== deletedId; });
        persist({ explicitRemovedIds: [deletedId] })
          .then(function () { return persistRemoveChargesForClient(deletedId); })
          .then(function () { return removePaymentsForClient(deletedId); })
          .then(function () { toast('נמחק'); render(); })
          .catch(function (e) { toast('שגיאה: ' + e.message, true); render(); });
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
    return {
      name: (fd.get('name') || '').trim(),
      phone: normalizePhone(fd.get('phone') || ''),
      serviceType: formatServices(services),
      location: (fd.get('location') || ''),
      note: (fd.get('note') || '').trim(),
      created: fd.get('created') || today(),
      house_of_origin: (fd.get('house_of_origin') || '').trim(),
      assignedTo: (fd.get('assignedTo') || '').trim()
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
      house_of_origin: f.house_of_origin,
      assignedTo: f.assignedTo
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
    if (f.assignedTo) lead.assignedTo = f.assignedTo;
  }

  // --- dynamic per-service sessions fields
  function renderSessionsHost(host, services, values, unitValues) {
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
    var units = unitValues || parseSessionsUnits(values);
    list.forEach(function (svc) {
      var label = document.createElement('label');
      label.textContent = 'תדירות הטיפול — ' + svc;
      var input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.step = '1'; input.required = true;
      input.dataset.service = svc;
      input.value = current[svc] != null ? current[svc] : '';
      label.appendChild(input);
      // Unit selector (per service). Defaults to the stored override if present,
      // else the by-type default (psychiatric → חודש, all others → שבוע).
      var unitSel = document.createElement('select');
      unitSel.dataset.serviceUnit = svc;
      ['שבוע', 'חודש'].forEach(function (unit) {
        var o = document.createElement('option');
        o.value = unit; o.textContent = unit;
        unitSel.appendChild(o);
      });
      unitSel.value = sessionUnitFor(svc, units);
      label.appendChild(unitSel);
      host.appendChild(label);
    });
  }
  function readSessionsHost(host) {
    var out = {};
    $$('input[data-service]', host).forEach(function (inp) { out[inp.dataset.service] = wholeSessions(inp.value); });
    return out;
  }
  // Read the per-service unit selections from a sessions host. Returns only
  // services whose select carries a valid unit ('שבוע'|'חודש').
  function readSessionsUnits(host) {
    var out = {};
    $$('select[data-service-unit]', host).forEach(function (sel) {
      if (sel.value === 'שבוע' || sel.value === 'חודש') out[sel.dataset.serviceUnit] = sel.value;
    });
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
    // סניף is always visible and selectable, regardless of service type — the
    // branch the user picks is the single source of truth (incl. day-center).
    var wrap = formLocationWrap(form);
    if (wrap) wrap.classList.remove('field-hidden');
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
      if (f.assignedTo) {
        f.assignedTo.value = lead.assignedTo || '';
        // Same relax-on-edit rule: a historical lead without an assignee is not
        // blocked, but a new/already-assigned lead must keep one.
        f.assignedTo.required = !!lead.assignedTo;
      }
    } else {
      f.created.value = today();
      f.house_of_origin.value = '';
      f.house_of_origin.required = true;
      if (f.assignedTo) { f.assignedTo.value = ''; f.assignedTo.required = true; }
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
    renderSessionsHost($('[data-host="agreementSessions"]', f), lead.serviceType, lead.sessionsPerWeek, lead.sessionsUnit);
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
    renderSessionsHost(host, lead.serviceType, lead.sessionsPerWeek, lead.sessionsUnit);
    $$('input[type="checkbox"]', group).forEach(function (cb) {
      cb.addEventListener('change', function () {
        var picked = readServiceGroup(group);
        var current = readSessionsHost(host);
        renderSessionsHost(host, formatServices(picked), current, readSessionsUnits(host));
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
    renderSessionsHost($('[data-host="directSessions"]', f), '', {}, {});
    updateLocationVisibilityForDirect(f);
    m.hidden = false;
  }
  function closeDirectClientModal() { $('#directClientModal').hidden = true; }

  function updateLocationVisibilityForDirect(form) {
    // סניף is always visible and selectable, regardless of service type.
    var wrap = $('#directLocationWrap');
    var sel = $('select[name="location"]', form);
    if (!wrap || !sel) return;
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
    // leading-zero recovery). The אחראי-טיפול contact phone is no longer edited
    // here — that role was removed from the product (the legacy sheet column is
    // kept but never written from the UI).
    if (form.phone) form.phone.value = clientPhone(client);
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
      renderSessionsHost(ecHost, client.serviceType, client.sessionsPerWeek, client.sessionsUnit);
      $$('input[type="checkbox"]', ecGroup).forEach(function (cb) {
        cb.addEventListener('change', function () {
          var picked = readServiceGroup(ecGroup);
          var current = readSessionsHost(ecHost);
          renderSessionsHost(ecHost, formatServices(picked), current, readSessionsUnits(ecHost));
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

  // --- Edit an existing extra charge (correct wrong amount/type/date/etc.) ----
  // Prefills a small modal from the charge and saves back through the SAME charge
  // row — persistCharge upserts by the charge's stable id (chg-<id> on the card),
  // so an edit updates the row and never creates a duplicate. Optimistic update +
  // rollback; the paid-toggle and × delete on the card are unchanged.
  var editChargeIds = { clientId: null, chargeId: null };
  function updateEditChargeBillingDayVisibility(form) {
    if (!form) return;
    var type = form.billingType && form.billingType.value;
    var wrap = $('#editChargeBillingDayWrap');
    var freqWrap = $('#editChargeFreqWrap');
    if (wrap) wrap.classList.toggle('field-hidden', type !== 'monthly');
    if (freqWrap) freqWrap.classList.toggle('field-hidden', type !== 'monthly');
  }
  function openEditChargeModal(client, charge) {
    if (state.role !== 'editor') return;
    if (!client || !charge) return;
    editChargeIds = { clientId: client.id, chargeId: charge.id };
    var form = $('#editChargeForm');
    if (!form) return;
    form.reset();
    $('#editChargeClientName').textContent = client.name || '';
    form.chargeId.value = charge.id;
    // Populate the treatment-type dropdown from the canonical service list, then
    // select the charge's current value.
    var typeSel = $('#editChargeTreatmentType');
    if (typeSel) {
      typeSel.innerHTML = '<option value="">—</option>' +
        SERVICE_TYPES.map(function (s) {
          return '<option value="' + escapeHtml(s) + '">' + escapeHtml(serviceLabel(s)) + '</option>';
        }).join('');
    }
    form.billingType.value = charge.billingType === 'monthly' ? 'monthly' : 'one_time';
    if (form.treatmentType) form.treatmentType.value = charge.treatmentType || '';
    form.amount.value = charge.amount || '';
    form.description.value = charge.description || '';
    form.chargeDate.value = charge.chargeDate || '';
    if (form.billingDay) form.billingDay.value = (charge.billingDay === '' || charge.billingDay == null) ? '' : charge.billingDay;
    if (form.frequencyPerWeek) form.frequencyPerWeek.value = (charge.frequencyPerWeek === '' || charge.frequencyPerWeek == null) ? '' : charge.frequencyPerWeek;
    if (form.notes) form.notes.value = charge.notes || '';
    updateEditChargeBillingDayVisibility(form);
    $('#editChargeModal').hidden = false;
  }
  function closeEditChargeModal() {
    var m = $('#editChargeModal');
    if (m) m.hidden = true;
    editChargeIds = { clientId: null, chargeId: null };
  }

  // --- Edit collection amount (סכום גבייה) on an open-balance row -------------
  // Writes a manual override keyed by payment id (append-only LAYER on the client
  // row) — never rewrites the package price or a charge source row. Optimistic
  // update of the in-memory override map + re-render, single-cell server write,
  // rollback on failure. Mirrors the openEditChargeModal pattern.
  var editAmountCtx = { clientId: null, paymentId: null, computed: 0 };
  function openEditAmountModal(client, payment, currentEffective, computedAmount) {
    if (state.role !== 'editor') return;
    if (!client || !payment) return;
    editAmountCtx = { clientId: client.id, paymentId: payment.id, computed: toNum(computedAmount) };
    var form = $('#editAmountForm');
    if (!form) return;
    form.reset();
    $('#editAmountClientName').textContent = client.name || payment.clientName || '';
    var hint = $('#editAmountComputedHint');
    if (hint) hint.textContent = 'סכום מחושב: ' + money(toNum(computedAmount));
    var isOv = overrideAmountFor(payment) != null;
    var revertBtn = $('#editAmountRevert');
    if (revertBtn) revertBtn.hidden = !isOv;
    if (form.amount) form.amount.value = toNum(currentEffective);
    $('#editAmountModal').hidden = false;
  }
  function closeEditAmountModal() {
    var m = $('#editAmountModal');
    if (m) m.hidden = true;
    editAmountCtx = { clientId: null, paymentId: null, computed: 0 };
  }
  // Apply an override value (a positive number to set, or '' to revert to computed)
  // optimistically and persist it. Shared by the form submit and the revert button.
  function applyAmountOverride(newAmount) {
    var ctx = editAmountCtx;
    if (!ctx.clientId || !ctx.paymentId) return;
    var client = state.clients.find(function (c) { return c.id === ctx.clientId; });
    if (!client) { toast('מטופל לא נמצא', true); return; }
    var submit = $('#editAmountSubmit');
    var revertBtn = $('#editAmountRevert');
    if (submit) submit.disabled = true;
    if (revertBtn) revertBtn.disabled = true;
    if (!client.paymentAmountOverrides || typeof client.paymentAmountOverrides !== 'object') {
      client.paymentAmountOverrides = {};
    }
    var prev = Object.prototype.hasOwnProperty.call(client.paymentAmountOverrides, ctx.paymentId)
      ? client.paymentAmountOverrides[ctx.paymentId] : undefined;
    if (newAmount === '' || newAmount == null) {
      delete client.paymentAmountOverrides[ctx.paymentId];
    } else {
      client.paymentAmountOverrides[ctx.paymentId] = toNum(newAmount);
    }
    renderBilling();
    persistPaymentAmountOverride(ctx.clientId, ctx.paymentId, newAmount)
      .then(function () { toast('סכום הגבייה עודכן'); closeEditAmountModal(); })
      .catch(function (err) {
        if (prev === undefined) delete client.paymentAmountOverrides[ctx.paymentId];
        else client.paymentAmountOverrides[ctx.paymentId] = prev;
        renderBilling();
        toast('שגיאה: ' + err.message, true);
      })
      .finally(function () {
        if (submit) submit.disabled = false;
        if (revertBtn) revertBtn.disabled = false;
      });
  }

  // --- Renew & pay modal (חידוש ותשלום) ----------------------------------
  // Records next month's base payment as paid-in-advance with a manual amount,
  // and sets that amount as the client's new going-forward monthly default. Also
  // absorbs the former "שינוי חבילה" flow: the per-service weekly-frequency host
  // is prefilled from the current plan; editing it makes the SAME save apply a
  // package change (new frequency + packageChangeDate re-anchor). One save =
  // renewal + any package change. Service TYPES stay in the עריכה modal.
  var renewClientId = null;
  function openRenewModal(client) {
    renewClientId = client.id;
    var form = $('#renewForm');
    if (!form) return;
    form.reset();
    // Always show the billed month. Prefer the anchored renewal date (the same
    // value the גבייה הבאה chip shows); fall back to the current-month base due
    // date so a client with NO stored anchor still shows a concrete month and can
    // renew (Bug B: this used to hard-fail with "לא ניתן לחשב תאריך חידוש").
    var renewalDate = nextRenewalDueDate(client) || currentMonthBaseDueDate(client);
    $('#renewClientName').textContent = 'חידוש עבור: ' + (client.name || '') +
      (renewalDate ? ' — ' + monthLabel(renewalDate) : '');
    form.renewAmount.value = client.pricePerSession || '';
    if (form.renewDate) form.renewDate.value = today();
    // Prefill the package/plan frequency from the current plan (former שינוי חבילה
    // host). Left unchanged → renew only; changed → save also updates the package.
    var host = $('[data-host="renewSessions"]', form);
    if (host) renderSessionsHost(host, client.serviceType, client.sessionsPerWeek, client.sessionsUnit);
    $('#renewModal').hidden = false;
  }
  function closeRenewModal() {
    var m = $('#renewModal');
    if (m) m.hidden = true;
    renewClientId = null;
  }

  // --- Shared package-change core (single implementation) ----------------
  // Formerly the body of the standalone שינוי חבילה modal; kept as pure-ish
  // helpers so the חידוש ותשלום modal reuses ONE implementation of the rule
  // (no forked second copy). readPackageSessionsFromForm reads the per-service
  // frequency host keyed by the client's existing services; packageSessionsChanged
  // reports whether that differs from the stored plan (counts or units).
  function readPackageSessionsFromForm(client, form) {
    var services = parseServices(client.serviceType);
    var host = $('[data-host="renewSessions"]', form);
    if (!services.length || !host) return null;
    var raw = readSessionsHost(host);
    var units = readSessionsUnits(host);
    var sessions = {};
    var total = 0;
    services.forEach(function (s) { sessions[s] = wholeSessions(raw[s] || 0); total += sessions[s]; });
    if (!total) return null; // nothing meaningful entered → renew without a package change
    return { sessions: sessions, units: units };
  }
  function packageSessionsChanged(client, pkg) {
    if (!pkg) return false;
    var services = parseServices(client.serviceType);
    var cur = parseSessionsBreakdown(client.sessionsPerWeek, client.serviceType);
    var curUnits = client.sessionsUnit || parseSessionsUnits(client.sessionsPerWeek);
    for (var i = 0; i < services.length; i++) {
      var s = services[i];
      if (wholeSessions(cur[s] || 0) !== wholeSessions(pkg.sessions[s] || 0)) return true;
      if (sessionUnitFor(s, curUnits) !== sessionUnitFor(s, pkg.units)) return true;
    }
    return false;
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
    var picker = $('#userScreen');
    if (picker) picker.hidden = true;
    $('#pinScreen').hidden = false;
    $('#app').hidden = true;
    $('#pinInput').value = '';
    $('#pinInput').focus();
  }
  function enterApp() {
    var pin = $('#pinScreen');
    var picker = $('#userScreen');
    var app = $('#app');
    if (pin) pin.hidden = true;
    if (picker) picker.hidden = true;
    if (app) app.hidden = false;
    applyRole();
    renderSessionUser();
    setView('dashboard');
  }
  // Header: "מחובר/ת כ: <name> · החלף" — only when the session carries a name.
  // The name is written with textContent (it is allow-listed server-side, but
  // never interpolated into HTML regardless).
  function renderSessionUser() {
    var box = $('#sessionUser');
    var nameEl = $('#sessionUserName');
    if (!box || !nameEl) return;
    if (state.user) { nameEl.textContent = state.user; box.hidden = false; }
    else { nameEl.textContent = ''; box.hidden = true; }
  }
  // After a correct PIN: read the cookie's name; empty -> the picker (the
  // PIN is handed to it in a closure for ONE re-issue call, never stored).
  // Any name -> straight into the app.
  function finishLogin(pin) {
    return apiMe().then(function (user) {
      if (user) { state.user = user; enterEditor(); return; }
      showUserPicker(pin);
    });
  }
  function enterEditor() {
    try { sessionStorage.setItem('ez_role', 'editor'); } catch (_) {}
    state.role = 'editor';
    enterApp();
    // The data routes are session-gated: the load fired at init was
    // refused (401) until this PIN minted the cookie, so load now.
    if (!state.loaded) loadAll().catch(function () {});
  }
  // Name picker: one tappable button per allow-listed name (GET /api/users),
  // no free text. Picking re-posts {pin, user} to /api/verify-pin so the
  // cookie is re-issued with the name inside the signed token. `pin` lives
  // only in this closure and is dropped after the single call.
  function showUserPicker(pin) {
    var screen = $('#userScreen');
    var box = $('#userButtons');
    var err = $('#userError');
    if (!screen || !box) { enterEditor(); return; }
    $('#pinScreen').hidden = true;
    $('#app').hidden = true;
    screen.hidden = false;
    if (err) err.hidden = true;
    box.textContent = '';
    apiUsers().then(function (users) {
      if (!users.length) { enterEditor(); return; } // nothing to pick — user-less session, as before
      users.forEach(function (name) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-primary user-btn';
        b.textContent = name;
        b.addEventListener('click', function () {
          if (pin == null) return; // already used
          var chosen = pin;
          pin = null;
          if (err) err.hidden = true;
          $$('#userButtons .user-btn').forEach(function (x) { x.disabled = true; });
          apiVerifyPin(chosen, name).then(function (ok) {
            chosen = null;
            if (!ok) throw new Error('verify-pin refused');
            return apiMe();
          }).then(function (user) {
            state.user = user;
            enterEditor();
          }).catch(function () {
            // Re-issue failed (network / PIN changed meanwhile): back to the
            // PIN screen — the PIN is gone from memory, so it must be retyped.
            if (err) err.hidden = false;
            setTimeout(showPin, 900);
          });
        });
        box.appendChild(b);
      });
    }).catch(function (e) {
      // 401 already flipped to the PIN screen; any other failure must not
      // lock anyone out — continue user-less (today's behaviour).
      if (!(e && e.message === 'unauthorized')) enterEditor();
    });
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

  // Bug B: legacy clients saved before the nextBillingDate column have it blank,
  // so renewalInfo would fall back to startDate (banner counts from תחילת טיפול).
  // Reconstruct it from the latest PAID base payment row on load — the next
  // cycle after the DUE date it settled (anchored on the due date, never the
  // paid date, so the billing day doesn't drift) — without overwriting a
  // populated value. Mirrors deriveNextBillingDate in public/charges-logic.js.
  function deriveNextBillingDates() {
    if (!Array.isArray(state.clients) || !Array.isArray(state.payments)) return;
    state.clients.forEach(function (c) {
      if (!c || c.nextBillingDate) return;
      var latest = '';
      state.payments.forEach(function (p) {
        if (!p || p.clientId !== c.id || p.status !== 'paid') return;
        if (paymentKindFromId(p.id).kind !== 'base') return;
        var anchor = p.dueDate || p.paymentDate || '';
        if (anchor && anchor > latest) latest = anchor;
      });
      if (latest) c.nextBillingDate = nextCycleDueDateAfter(c, latest);
    });
  }

  async function loadAll() {
    try {
      // All six reads are independent Apps Script round-trips (~1-3s each).
      // Fired in PARALLEL: total load = slowest call, not the sum (was serial,
      // 6-18s worst case). Non-critical reads fall back to empty on failure —
      // same semantics as before; only the main load (apiLoad) is fatal.
      var results = await Promise.all([
        apiLoad(),
        apiGetPayments().catch(function (pe) {
          console.warn('[ezone] getPayments failed, assuming empty:', pe.message);
          return { payments: [] };
        }),
        apiGetCharges().catch(function (ce) {
          console.warn('[ezone] getCharges failed, assuming empty:', ce.message);
          return { charges: [] };
        }),
        apiGetStopFlags().catch(function (sfe) {
          console.warn('[ezone] getStopFlags failed, assuming empty:', sfe.message);
          return { stopFlags: [] };
        }),
        apiGetExtraRequests().catch(function (ere) {
          console.warn('[ezone] getExtraSessionRequests failed, assuming empty:', ere.message);
          return { requests: [] };
        }),
        apiLoadSettings().catch(function () { return {}; }),
        apiGetMyStopAlerts().catch(function (mse) {
          console.warn('[ezone] getMyStopAlerts failed, assuming empty:', mse.message);
          return { myStopAlerts: [] };
        })
      ]);
      var data = results[0];
      // Staleness signal: remember the version this tab loaded; persist()
      // echoes it back so the server can flag a save from a stale tab.
      state.dataVersion = (data.dataVersion == null || data.dataVersion === '') ? null : Number(data.dataVersion);
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
      state.payments = (results[1].payments || []).map(normalizePaymentFromSheet).filter(function (p) { return !!p.id; });
      // Derive nextBillingDate for legacy clients now that payments are loaded.
      deriveNextBillingDates();
      state.charges = (results[2].charges || []).map(normalizeChargeFromSheet).filter(function (c) { return !!c.id; });
      // Display-time safety net: never surface charges whose patient was deleted
      // (orphans). Root-cause cleanup runs server-side via removeChargesForClient.
      state.charges = excludeOrphanCharges(state.charges, state.clients);
      state.stopFlags = (results[3].stopFlags || []).map(normalizeStopFlagFromSheet).filter(function (f) { return !!f.id; });
      state.extraRequests = (results[4].requests || []).filter(function (r) { return !!r.id; });
      var s = results[5];
      state.settings = {
        bankName: s.bankName || '',
        bankBranch: s.bankBranch || '',
        bankAccount: s.bankAccount || '',
        bankHolder: s.bankHolder || ''
      };
      // This app's own stop/resume alerts (minimal fields) — sent-state source of
      // truth across sessions. Replaces any in-session optimistic entries with the
      // real server rows on each load.
      state.myStopAlerts = (results[6].myStopAlerts || []).filter(function (a) { return a && a.clientId; });
      state.loaded = true;
      render();
    } catch (e) {
      // A 401 already flipped to the PIN screen (apiFetch) — no error toast
      // on top of it; every other failure is surfaced as before.
      if (!(e && e.message === 'unauthorized')) toast('שגיאה בטעינת הנתונים: ' + e.message, true);
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
      var btn = $('#pinSubmit');
      var err = $('#pinError');
      if (err) err.hidden = true;
      if (btn) btn.disabled = true;
      apiVerifyPin(v).then(function (ok) {
        if (ok) {
          // Cookie minted. Name picker next unless the session already
          // carries a name (finishLogin); the PIN goes with it in a closure.
          return finishLogin(v).catch(function () { enterEditor(); });
        }
        if (err) err.hidden = false;
      }).catch(function () {
        if (err) err.hidden = false;
      }).finally(function () {
        if (btn) btn.disabled = false;
      });
    });
    on('#pinInput', 'keydown', function (e) {
      var err = $('#pinError'); if (err) err.hidden = true;
      if (e.key === 'Enter') { e.preventDefault(); var btn = $('#pinSubmit'); if (btn) btn.click(); }
    });
    on('#pinViewer', 'click', function () {
      try { sessionStorage.setItem('ez_role', 'viewer'); } catch (_) {}
      state.role = 'viewer';
      enterApp();
      // Viewer mode rides the same session cookie (the data routes are
      // gated): with a live cookie on this device the data loads; without
      // one the 401 handler returns to the PIN screen.
      if (!state.loaded) loadAll().catch(function () {});
    });
    function logout() {
      // Expire the server session cookie too (fire-and-forget) so a shared
      // device does not keep a live 7-day session after יציאה.
      try { fetch('/api/logout', { method: 'POST' }).catch(function () {}); } catch (_) {}
      try { sessionStorage.removeItem('ez_role'); } catch (_) {}
      state.role = 'viewer';
      state.user = '';
      renderSessionUser();
      showPin();
    }
    on('#logoutBtn', 'click', logout);
    // החלף (switch user) = logout -> PIN -> name picker.
    on('#switchUserBtn', 'click', logout);
    on('#conflictBannerClose', 'click', hideConflictBanner);

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
    on('#dashPatientSearch', 'input', function (e) { state.dashSearch = e.target.value; renderDashPatientSearch(); });
    on('#leadsSearch', 'input', function (e) { state.leadSearch = e.target.value; renderLeads(); });
    on('#addLeadBtn', 'click', function () { openLeadModal(null); });
    on('#clientsSearch', 'input', function (e) { state.clientSearch = e.target.value; renderClients(); });
    on('#retentionSearch', 'input', function (e) { state.retentionSearch = e.target.value; renderRetention(); });
    on('#inactiveSearch', 'input', function (e) { state.inactiveSearch = e.target.value; renderInactive(); });
    on('#billingSearch', 'input', function (e) { state.billingSearch = e.target.value; renderBilling(); });
    on('#continuationSearch', 'input', function (e) { state.continuationSearch = e.target.value; renderContinuation(); });
    var continuationListEl = $('#continuationList');
    if (continuationListEl) continuationListEl.addEventListener('click', handleContinuationListClick);
    on('#continuationToOutpatientConfirm', 'click', function () {
      var p = pendingContinuationLead;
      if (!p) return;
      closeContinuationToOutpatientModal();
      var vm = continuationVM[p.key];
      if (!vm) return;
      continuationCreateLead(vm, p.meetingDate, function (ok) {
        if (!ok) return; // lead not created (failed) → do not record the outcome
        saveContinuationRow(p.key, { meetingDate: p.meetingDate, outcome: 'to_outpatient', note: p.note });
      });
    });
    on('#addClientBtn', 'click', function () { openDirectClientModal(); });
    on('#billingDate', 'change', function (e) { state.billingDate = e.target.value || today(); renderBilling(); });

    // Therapist payouts: month picker, detail toggle, correct, mark-forwarded,
    // add-missing-session, and Excel export.
    on('#payoutMonth', 'change', function (e) {
      state.payoutMonth = e.target.value || currentMonthStr();
      renderPayouts();
    });
    on('#payoutSearch', 'input', function (e) { state.payoutSearch = e.target.value; renderPayouts(); });
    on('#payoutList', 'click', handlePayoutListClick);
    on('#payoutExportBtn', 'click', exportPayoutCsv);
    on('#payoutAddSessionBtn', 'click', function () { openSessionModal(null); });
    var clinicalSel = $('#sessionClinicalType');
    if (clinicalSel) clinicalSel.addEventListener('change', updateSessionFreqVisibility);
    var sessionForm = $('#sessionForm');
    if (sessionForm) sessionForm.addEventListener('submit', submitSessionForm);

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeLeadModal(); closeAgreementModal(); closeActivateModal(); closeExitModal(); closeDirectClientModal(); closeEditClientModal(); closeSettingsModal(); closeNotRelevantReasonModal(); closeRemoveLeadModal(); closeDuplicateLeadModal(); closeAddChargeModal(); closeEditChargeModal(); closeEditAmountModal(); closeRenewModal(); closeMergeClientsModal(); closeSessionModal(); closeContinuationToOutpatientModal(); closeStopAlertModal(); closeResumeTreatmentModal(); closeRestoreClientModal();
      });
    });

    var acTypeSel = $('#addChargeForm select[name="billingType"]');
    if (acTypeSel) acTypeSel.addEventListener('change', function () {
      updateAddChargeBillingDayVisibility($('#addChargeForm'));
    });

    var ecTypeSel = $('#editChargeForm select[name="billingType"]');
    if (ecTypeSel) ecTypeSel.addEventListener('change', function () {
      updateEditChargeBillingDayVisibility($('#editChargeForm'));
    });

    var editChargeForm = $('#editChargeForm');
    if (editChargeForm) editChargeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#editChargeSubmit');
      if (submit.disabled) return;
      var charge = state.charges.find(function (c) { return c.id === editChargeIds.chargeId; });
      if (!charge) { toast('חיוב לא נמצא', true); return; }
      var fd = new FormData(e.target);
      var billingType = (fd.get('billingType') || 'one_time').toString();
      var description = (fd.get('description') || '').trim();
      var amount = toNum(fd.get('amount'));
      var chargeDate = fd.get('chargeDate') || '';
      var billingDay = fd.get('billingDay');
      var notes = (fd.get('notes') || '').trim();
      var treatmentType = (fd.get('treatmentType') || '').toString().trim();
      var frequencyPerWeek = fd.get('frequencyPerWeek');
      if (!description) { toast('חסר תיאור', true); return; }
      if (!amount || amount <= 0) { toast('יש להזין סכום', true); return; }
      if (!chargeDate) { toast('יש להזין תאריך', true); return; }
      submit.disabled = true;
      // Snapshot the editable fields for rollback; the row's id/clientId/created
      // (the identity + the paid-row key chg-<id>) are never touched by an edit.
      var prev = {
        description: charge.description, amount: charge.amount,
        billingType: charge.billingType, treatmentType: charge.treatmentType,
        frequencyPerWeek: charge.frequencyPerWeek, chargeDate: charge.chargeDate,
        billingDay: charge.billingDay, notes: charge.notes
      };
      charge.description = description;
      charge.amount = amount;
      charge.billingType = billingType === 'monthly' ? 'monthly' : 'one_time';
      charge.treatmentType = treatmentType;
      charge.frequencyPerWeek = (charge.billingType === 'monthly' && frequencyPerWeek) ? toNum(frequencyPerWeek) : '';
      charge.chargeDate = chargeDate;
      charge.billingDay = charge.billingType === 'monthly' && billingDay ? toNum(billingDay) : '';
      charge.notes = notes;
      render();
      persistCharge(charge)
        .then(function () { toast('החיוב עודכן'); closeEditChargeModal(); })
        .catch(function (err) {
          Object.assign(charge, prev);
          render();
          toast('שגיאה: ' + err.message, true);
        })
        .finally(function () { submit.disabled = false; });
    });

    var editAmountForm = $('#editAmountForm');
    if (editAmountForm) editAmountForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#editAmountSubmit');
      if (submit && submit.disabled) return;
      var amount = toNum(new FormData(e.target).get('amount'));
      if (!amount || amount <= 0) { toast('יש להזין סכום חיובי', true); return; }
      applyAmountOverride(amount);
    });
    var editAmountRevert = $('#editAmountRevert');
    if (editAmountRevert) editAmountRevert.addEventListener('click', function () {
      applyAmountOverride('');   // clear the override -> revert to the computed amount
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
      // Billed month: prefer the anchored renewal date (same value the גבייה הבאה
      // chip / renewal banner show); fall back to the current-month base due date
      // so a client with NO stored anchor still renews (Bug B — was a hard fail).
      var renewalDate = nextRenewalDueDate(c) || currentMonthBaseDueDate(c);
      if (!renewalDate) { toast('לא ניתן לחשב תאריך חידוש', true); return; }
      var fd = new FormData(e.target);
      var amount = toNum(fd.get('renewAmount'));
      if (!amount || amount <= 0) { toast('יש להזין סכום', true); return; }
      // Editable paid date (default today, backdatable) + free-text notes.
      var paidDate = fd.get('renewDate') || today();
      var notes = (fd.get('renewNotes') || '').trim();
      // Optional package change folded in: read the per-service frequency host and
      // apply it only if it actually differs from the stored plan. Reuses the
      // shared package helpers so there is ONE change-package implementation.
      var pkg = readPackageSessionsFromForm(c, e.target);
      var pkgChanged = packageSessionsChanged(c, pkg);
      submit.disabled = true;

      // ORDERING IS DELIBERATE: persist the client default FIRST, payment
      // SECOND. A half-applied clear-and-rewrite of clients/leads is the worse
      // failure mode; the payment row is idempotent (deterministic id) and
      // safely re-clickable, so it is the safer step to leave for retry.
      var prev = {
        pricePerSession: c.pricePerSession, paymentDate: c.paymentDate,
        nextBillingDate: c.nextBillingDate, sessionsPerWeek: c.sessionsPerWeek,
        sessionsUnit: c.sessionsUnit, packageChangeDate: c.packageChangeDate
      };
      c.pricePerSession = amount;
      c.paymentDate = paidDate;
      // Advance to the cycle AFTER the month being billed — anchored on the DUE
      // date (renewalDate), never the paid date, so the billing day doesn't
      // drift (paying the 04/09 cycle on 30/08 advances to 04/10, not 29/09).
      c.nextBillingDate = nextCycleDueDateAfter(c, renewalDate);
      if (pkgChanged) {
        // Same fields the former שינוי חבילה flow wrote: new weekly frequency and
        // the packageChangeDate re-anchor (stamped to the payment date).
        c.sessionsPerWeek = pkg.sessions;
        c.sessionsUnit = pkg.units;
        c.packageChangeDate = paidDate;
      }
      persist()
        .then(function () {
          // Single paid-date path: same builder as the edit-modal propagation.
          var payment = basePaymentPaidOn(c, renewalDate, amount, paidDate, notes);
          return persistPayment(payment)
            .then(function () {
              // Upsert by id so גבייה reflects it without a reload.
              var idx = state.payments.findIndex(function (p) { return p.id === payment.id; });
              if (idx >= 0) state.payments[idx] = payment;
              else state.payments.push(payment);
              toast(pkgChanged ? 'חודש שולם מראש והחבילה עודכנה' : 'חודש שולם מראש');
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

    // "שולם" quick action inside the חידוש ותשלום modal: mark the CURRENT month
    // paid via the EXACT existing setCurrentMonthPaid path (optimistic + rollback).
    // Distinct from the renewal save, which pays the upcoming renewal month.
    var renewMarkPaid = $('#renewMarkPaid');
    if (renewMarkPaid) renewMarkPaid.addEventListener('click', function () {
      if (!renewClientId) return;
      var c = state.clients.find(function (x) { return x.id === renewClientId; });
      if (!c) { toast('מטופל לא נמצא', true); return; }
      setCurrentMonthPaid(c, true);
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
          renderSessionsHost(host, formatServices(picked), current, readSessionsUnits(host));
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
        var cleanUnits = readSessionsUnits(host);
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
        // Next collection = the cycle AFTER the intake month, on the client's
        // billing day (else the startDate day-of-month, clamped) — anchored on
        // the startDate cycle, never payDate+30, so the billing day never drifts.
        var nextBill = startDate
          ? nextCycleDueDateAfter({ billingDay: bdDay || '', startDate: startDate }, startDate)
          : '';
        var client = {
          id: uid(), name: name, phone: directPhone,
          serviceType: formatServices(services),
          location: (fd.get('location') || ''),
          sessionsPerWeek: clean, sessionsUnit: cleanUnits, pricePerSession: monthlyAmount,
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
        // Optimistic: show the new patient + close the modal before the network;
        // on failure remove the just-added client (and intake payment) and toast.
        closeDirectClientModal();
        render();
        submit.disabled = false;
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
          .then(function () { toast('המטופל נוסף'); })
          .catch(function (err) {
            state.clients = state.clients.filter(function (x) { return x.id !== client.id; });
            if (directIntakePayment) state.payments = state.payments.filter(function (p) { return p.id !== directIntakePayment.id; });
            render();
            toast('שמירה נכשלה: ' + err.message, true);
          });
      } catch (e2) { toast('שגיאה: ' + e2.message, true); submit.disabled = false; }
    });

    $('#leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#leadFormSubmit');
      if (submit.disabled) return;
      var form = e.target;
      var group = $('[data-group="serviceType"]', form);
      if (!readServiceGroup(group).length) { toast('יש לבחור לפחות סוג טיפול אחד', true); return; }
      if (form.assignedTo && form.assignedTo.required && !(form.assignedTo.value || '').trim()) {
        toast('יש לבחור למי הליד משוייך', true); return;
      }
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
      lead.sessionsUnit = readSessionsUnits(host);
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
        // The agreement payment opens the cycle anchored on its own date; the
        // next collection is one cycle later (billing day / day-of-month kept,
        // short-month clamp — one MONTH, not 30 days).
        lead.nextBillingDate = nextCycleDueDateAfter(lead, agPayDate);
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
      var cleanUnits = readSessionsUnits(host);
      var cleanBreakdown = {};
      services.forEach(function (s) { cleanBreakdown[s] = wholeSessions(breakdown[s] || 0); });
      var startDate = fd.get('startDate') || today();
      var payStatus = fd.get('paymentStatus') || 'unpaid';
      var payDate = fd.get('paymentDate') || '';
      if ((payStatus === 'paid' || payStatus === 'partial') && !payDate) {
        submit.disabled = false;
        toast('יש להזין תאריך תשלום', true);
        return;
      }
      // Next collection = the cycle AFTER the activation month, on the
      // startDate day-of-month (clamped) — anchored on the startDate cycle,
      // never payDate+30, so the billing day never drifts.
      var nextBill = nextCycleDueDateAfter({ billingDay: '', startDate: startDate }, startDate);

      var client = {
        id: uid(), name: lead.name, phone: recoverPhone(lead.phone),
        serviceType: formatServices(services),
        location: (fd.get('location') || lead.location),
        sessionsPerWeek: cleanBreakdown,
        sessionsUnit: cleanUnits,
        pricePerSession: toNum(fd.get('pricePerSession')),
        startDate: startDate,
        status: 'פעיל', exitDate: '', fromLead: lead.id,
        source: 'lead', notes: '', billingType: 'monthly',
        billingDay: dayOfMonth(startDate) || '',
        paymentStatus: payStatus,
        paymentDate: payDate,
        nextBillingDate: nextBill,
        house_of_origin: lead.house_of_origin || '',
        // משוייך ל: the assignee follows the person from lead to patient.
        assignedTo: lead.assignedTo || ''
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
      // so remove it from state — persist() (clear-and-rewrite) drops it from the
      // sheet, and loadAll's cleanupConvertedLeads keeps it gone. Snapshot the
      // index so an optimistic-activate failure can restore it.
      var leadIdx = state.leads.findIndex(function (x) { return x.id === lead.id; });
      state.leads = state.leads.filter(function (x) { return x.id !== lead.id; });
      // Optimistic: navigate to the clients view + close the modal before the
      // network; on failure remove the new client (+ intake payment), restore the
      // lead, re-render.
      closeActivateModal();
      setView('clients');
      submit.disabled = false;
      persist()
        .then(function () {
          // Save the intake payment row through its own path (persist() doesn't
          // cover payments). Non-fatal if it fails — the client is already saved.
          if (intakePaymentToPersist) {
            return persistPayment(intakePaymentToPersist).catch(function () {
              toast('המטופל נוסף, אך סימון התשלום לא נשמר — סמנ/י ידנית', true);
            });
          }
        })
        .then(function () { toast('המטופל נוסף'); })
        .catch(function (err) {
          state.clients = state.clients.filter(function (x) { return x.id !== client.id; });
          if (intakePaymentToPersist) state.payments = state.payments.filter(function (p) { return p.id !== intakePaymentToPersist.id; });
          if (leadIdx >= 0) state.leads.splice(leadIdx, 0, lead);
          render();
          toast('שמירה נכשלה: ' + err.message, true);
        });
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

    // Stop-alert reason select: enable save only when a valid reason is chosen;
    // when 'other' is picked, focus the note and reveal the "please detail" hint.
    var stopReasonSel = $('#stopAlertReason');
    if (stopReasonSel) stopReasonSel.addEventListener('change', function () {
      var reason = stopReasonSel.value;
      var submit = $('#stopAlertSubmit');
      if (submit) submit.disabled = !STOP_ALERT_REASON_LABELS[reason];
      var hint = $('#stopAlertOtherHint');
      if (reason === 'other') {
        if (hint) hint.hidden = false;
        var note = $('#stopAlertNote');
        if (note) note.focus();
      } else if (hint) {
        hint.hidden = true;
      }
    });

    var saForm = $('#stopAlertForm');
    if (saForm) saForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var reason = String(fd.get('stop_reason') || '').trim();
      // Required + fail-closed on the client too (submit is disabled until a
      // reason is picked; this guards direct/programmatic submits as a fallback).
      if (!STOP_ALERT_REASON_LABELS[reason]) { toast('יש לבחור סיבת עצירה', true); return; }
      var note = String(fd.get('stop_note') || '').trim().slice(0, 1000);
      submitStopAlert(reason, note);
      closeStopAlertModal();
    });

    var restoreClientConfirmBtn = $('#restoreClientConfirm');
    if (restoreClientConfirmBtn) restoreClientConfirmBtn.addEventListener('click', function () {
      submitRestoreClient();
    });

    var resumeConfirmBtn = $('#resumeTreatmentConfirm');
    if (resumeConfirmBtn) resumeConfirmBtn.addEventListener('click', function () {
      submitResumeTreatment();
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
      var pyPhone = acceptPhone(fd.get('payerPhone') || '', 'טלפון גורם משלם', 'payer', false);
      if (pyPhone === false) { submit.disabled = false; return; }
      // Duplicate-identity guard (Bug A fix). Only block when the user actually
      // CHANGED the patient's OWN phone to a number another client already owns.
      // The patient phone was re-checked on every save, so an UNCHANGED prefilled
      // number that happened to collide with another row aborted an edit that only
      // touched name/amount. Gating on an actual change fixes that. Direct-add
      // already guards only the patient's own phone — this makes edit consistent
      // with it. (The אחראי-טיפול contact phone is no longer part of identity —
      // that role was removed from the product.)
      var ptPhoneChanged = recoverPhone(ptPhone) !== recoverPhone(client.phone);
      if (ptPhoneChanged && duplicateClientBlock(ptPhone, client.id)) { submit.disabled = false; return; }
      var prev = {
        name: client.name,
        location: client.location,
        phone: client.phone,
        payerName: client.payerName, payerPhone: client.payerPhone,
        paymentLink: client.paymentLink,
        paymentStatus: client.paymentStatus, paymentDate: client.paymentDate,
        pricePerSession: client.pricePerSession,
        serviceType: client.serviceType, sessionsPerWeek: client.sessionsPerWeek,
        sessionsUnit: client.sessionsUnit,
        nextBillingDate: client.nextBillingDate,
        house_of_origin: client.house_of_origin, notes: client.notes
      };
      var newName = (fd.get('name') || '').trim();
      if (newName) client.name = newName;
      client.phone = ptPhone;
      if (fd.has('location')) {
        client.location = (fd.get('location') || '').trim();
      }
      client.payerName = (fd.get('payerName') || '').trim();
      client.payerPhone = pyPhone;
      client.paymentLink = (fd.get('paymentLink') || '').trim();
      var ps = fd.get('paymentStatus') || '';
      if (ps) client.paymentStatus = ps;
      var pd = fd.get('paymentDate') || '';
      var paidDateChanged = pd && pd !== (prev.paymentDate || '');
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
          var bdUnits = readSessionsUnits(ecHost2);
          var cleanBd = {};
          pickedSvc.forEach(function (s) { cleanBd[s] = wholeSessions(bd[s] || 0); });
          client.serviceType = formatServices(pickedSvc);
          client.sessionsPerWeek = cleanBd;
          client.sessionsUnit = bdUnits;
        }
      }
      // Bug A: a deliberately changed paid-date with status=paid must reach the
      // per-cycle base payment row (the single source the card chip + גבייה read)
      // via persistPayment — otherwise the chip keeps showing the old/today date.
      var propagatePaid = paidDateChanged && client.paymentStatus === 'paid';
      // nextBillingDate is recomputed ONLY on that same deliberate change: an
      // ordinary edit must never touch the stored renewal anchor (it used to
      // unconditionally re-stamp paymentDate + 30 days, silently dragging the
      // billing day around). The row written and the advance are the SAME
      // cycle the chip settles (cyclePaymentDueDate, resolved BEFORE the
      // anchor moves) — one implementation, one row id, never the paid date.
      var cycleDueISO = '';
      if (propagatePaid) {
        cycleDueISO = cyclePaymentDueDate(client, today());
        client.nextBillingDate = nextCycleDueDateAfter(client, cycleDueISO);
      }
      // Optimistic base-payment propagation: apply to state.payments NOW so the
      // card chip reflects it immediately; snapshot for rollback on failure.
      var basePay = null;
      var payPrev = null;   // { index, value } — value null means the row was newly pushed
      if (propagatePaid) {
        basePay = basePaymentPaidOn(client, cycleDueISO, clientAmountDue(client) || 0, client.paymentDate, '');
        var pi = state.payments.findIndex(function (p) { return p.id === basePay.id; });
        var existing = pi >= 0 ? state.payments[pi] : null;
        // Keep any existing notes/method when re-stamping the paid date.
        if (existing) { basePay.notes = existing.notes || ''; basePay.method = existing.method || ''; }
        payPrev = { index: pi, value: existing };
        if (pi >= 0) state.payments[pi] = basePay; else state.payments.push(basePay);
      }
      // Optimistic UI: reflect the change and close the modal BEFORE awaiting the
      // network, so the ~5s save is not felt. Persist in the background; on
      // failure roll back client + payment and surface an error toast. Mirrors
      // the setCurrentMonthPaid optimistic pattern.
      closeEditClientModal();
      render();
      submit.disabled = false;
      persist()
        .then(function () { return propagatePaid ? persistPayment(basePay) : null; })
        .then(function () { toast('נשמר'); })
        .catch(function (err) {
          Object.assign(client, prev);
          if (propagatePaid && payPrev) {
            if (payPrev.value) state.payments[payPrev.index] = payPrev.value;
            else state.payments = state.payments.filter(function (p) { return p !== basePay; });
          }
          render();
          toast('שמירה נכשלה: ' + err.message, true);
        });
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
    if (saved === 'editor' || saved === 'viewer') {
      state.role = saved;
      enterApp();
      // Read the session's name first (a 401 here flips to the PIN screen
      // and the load is skipped). An EDITOR session minted before the name
      // picker existed has no name: send it through PIN -> picker once, so
      // its saves stamp updatedBy from now on. Viewers never pick.
      apiMe().then(function (user) {
        state.user = user;
        renderSessionUser();
        if (state.role === 'editor' && !user) { showPin(); return; }
        loadAll().catch(function () {});
      }).catch(function (e) {
        // The name is a stamping nicety, never a gate: any failure other
        // than a 401 (which already showed the PIN screen) loads user-less.
        if (!(e && e.message === 'unauthorized')) loadAll().catch(function () {});
      });
    } else {
      showPin();
      loadAll().catch(function () {});
    }
  }

  function bootWhenReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  bootWhenReady();
})();
