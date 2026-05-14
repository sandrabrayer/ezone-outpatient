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
  var SERVICE_TYPES = [
    'פרטני',
    'פרטני CBT',
    'פרטני EMDR',
    'קבוצה',
    'טיפול משפחתי',
    'מרכז יום',
    'מעקב פסיכיאטרי'
  ];
  var LOCATIONS = ['רעננה הפרדס', 'רמות השבים', 'קיסריה גמילה', 'קיסריה עפרוני'];

  var HOUSE_OF_ORIGIN_LABELS = {
    raanana:  'רעננה אשר',
    ramot:    'רמות השבים',
    efroni:   'קיסריה עפרוני',
    rehab:    'קיסריה ריהאב',
    external: 'חיצוני'
  };
  function houseOfOriginLabel(v) {
    var s = String(v == null ? '' : v).trim();
    return HOUSE_OF_ORIGIN_LABELS[s] || '';
  }

  var DAY_CENTER = 'מרכז יום';
  var DAY_CENTER_LOCATION = 'רעננה הפרדס';

  var STAGES = [
    { id: 'new',        he: 'ליד חדש' },
    { id: 'intro',      he: 'שיחת היכרות' },
    { id: 'agreement',  he: 'מתחיל טיפול' },
    { id: 'active',     he: 'מטופל פעיל' }
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
  function hasDayCenter(arr) { return parseServices(arr).indexOf(DAY_CENTER) !== -1; }
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
    retained: [],   // lead-retention list (not_relevant + finished)
    leadSearch: '',
    clientSearch: '',
    clientTab: 'all',
    billingDate: '',
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
  // Logic: payment is always paid in advance for the next month.
  //   - If paymentStatus === 'paid' and paymentDate exists: next renewal = paymentDate + 1 month
  //   - If paymentStatus is partial/unpaid: client is already in trouble -> overdue immediately if past start
  //   - If no paymentDate at all: use startDate as fallback
  function renewalInfo(c) {
    if (!c || c.status === 'סיים טיפול') return { status: 'unknown' };
    var anchor = c.paymentDate || c.startDate || '';
    if (!anchor) return { status: 'unknown' };
    var renewal = addMonth(anchor);
    var daysLeft = daysBetween(today(), renewal);
    var paid = c.paymentStatus === 'paid';
    var status;
    if (!paid) {
      // Not fully paid for current cycle - treat as overdue
      status = 'overdue';
    } else if (daysLeft === null) {
      status = 'unknown';
    } else if (daysLeft < 0) {
      status = 'overdue';
    } else if (daysLeft <= 7) {
      status = 'due_soon';
    } else {
      status = 'ok';
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

  function normalizeLeadFromSheet(row) {
    var services = formatServices(parseServices(row.serviceType));
    return {
      id: row.id || uid(),
      name: row.name || '',
      phone: row.phone || '',
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
      phone: row.phone || '',
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
      responsiblePerson: row.responsiblePerson || '',
      serviceScope: row.serviceScope || ''
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
      responsiblePerson: c.responsiblePerson || '',
      serviceScope: c.serviceScope || ''
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
  function paymentId(client, dueDateISO) { return 'pay::' + client.id + '::' + monthKey(dueDateISO); }
  function findPaymentById(id) {
    for (var i = 0; i < state.payments.length; i++) {
      if (state.payments[i].id === id) return state.payments[i];
    }
    return null;
  }
  function paymentForClientOn(client, dueDateISO) {
    var id = paymentId(client, dueDateISO);
    var existing = findPaymentById(id);
    if (existing) return existing;
    return {
      id: id, clientId: client.id, clientName: client.name,
      billingType: 'monthly', dueDate: dueDateISO,
      amountDue: clientAmountDue(client), amountPaid: 0,
      status: 'unpaid', paymentDate: '', method: '', notes: '',
      bundleSize: 0, sessionsUsed: 0
    };
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
      var loc = hasDayCenter(c.serviceType) ? DAY_CENTER_LOCATION : c.location;
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

    renderRenewalAlerts(activeOnly);
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
    var responsible = c.responsiblePerson || '— לא הוגדר אחראי —';
    var scope = c.serviceScope === 'individual' ? 'טיפול פרטני'
              : c.serviceScope === 'program' ? 'תוכנית מורחבת' : '';
    var roleLabel = c.serviceScope === 'individual' ? 'מטפל'
                  : c.serviceScope === 'program' ? 'מנהל בית' : 'אחראי';
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
    return '<div class="renewal-row renewal-' + kind + '">' +
      '<div class="renewal-main">' +
        '<div class="renewal-name">' + escapeHtml(c.name) + '</div>' +
        (scope ? '<span class="chip">' + scope + '</span>' : '') +
        '<span class="chip">' + roleLabel + ': ' + escapeHtml(responsible) + '</span>' +
      '</div>' +
      '<div class="renewal-meta">' +
        '<span class="renewal-date">' + (info.renewalDate ? displayDate(info.renewalDate) : '') + '</span>' +
        '<span class="renewal-days">' + daysText + '</span>' +
        '<span class="chip chip-amount">' + money(c.pricePerSession) + '</span>' +
      '</div>' +
    '</div>';
  }

  function lastDayOfMonth(dateISO) {
    var parts = String(dateISO).slice(0, 10).split('-');
    if (parts.length < 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!isFinite(y) || !isFinite(m)) return null;
    return new Date(y, m, 0).getDate();
  }

  // ---- Billing
  function clientsDueOn(dateISO) {
    var d = dayOfMonth(dateISO);
    var last = lastDayOfMonth(dateISO);
    var out = [];
    state.clients.forEach(function (c) {
      if (c.status === 'סיים טיפול') return;
      var bd = c.billingDay ? toNum(c.billingDay) : dayOfMonth(c.startDate);
      if (!bd) return;
      var effective = (last && bd > last) ? last : bd;
      if (effective === d) out.push(c);
    });
    return out;
  }

  function renderBilling() {
    if (!state.billingDate) state.billingDate = today();
    var dateInput = $('#billingDate');
    if (dateInput && dateInput.value !== state.billingDate) dateInput.value = state.billingDate;
    var selected = state.billingDate;
    var due = clientsDueOn(selected).map(function (c) {
      return { client: c, payment: paymentForClientOn(c, selected) };
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
    dueItems.forEach(function (d) { list.appendChild(buildBillingRow(d.client, d.payment, selectedISO, false)); });
  }

  function renderBillingOpenList(selectedISO) {
    var list = $('#billingOpenList');
    list.innerHTML = '';
    var open = state.payments.filter(function (p) {
      if (p.status === 'paid') return false;
      if (!p.dueDate) return false;
      return p.dueDate < selectedISO;
    }).sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    if (!open.length) {
      list.innerHTML = '<div class="billing-empty">אין יתרות פתוחות מתאריכים קודמים</div>';
      return;
    }
    open.forEach(function (p) {
      var client = state.clients.find(function (c) { return c.id === p.clientId; })
        || { id: p.clientId, name: p.clientName, billingType: 'monthly', pricePerSession: p.amountDue, startDate: p.dueDate };
      list.appendChild(buildBillingRow(client, p, p.dueDate, true));
    });
  }

  function buildBillingRow(client, payment, dueDateISO, isCarry) {
    var row = document.createElement('div');
    row.className = 'billing-row' + (isCarry ? ' carry' : '');
    var amount = payment.amountDue || clientAmountDue(client) || 0;
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

    row.innerHTML =
      '<div><span class="p-label">מטופל</span><span class="p-name">' + escapeHtml(client.name || payment.clientName) + '</span></div>' +
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
        billingType: 'monthly', dueDate: dueDateISO,
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

  function renderBillingMonthlySummary(selectedISO) {
    var mk = monthKey(selectedISO);
    $('#billMonthLabel').textContent = '— ' + monthLabel(selectedISO);
    var thisMonth = state.payments.filter(function (p) { return monthKey(p.dueDate) === mk; });
    var collected = thisMonth.reduce(function (s, p) { return s + (p.amountPaid || 0); }, 0);
    var outstanding = thisMonth.filter(function (p) { return p.status !== 'paid'; })
      .reduce(function (s, p) { return s + Math.max(0, (p.amountDue || 0) - (p.amountPaid || 0)); }, 0);
    $('#billMonthCollected').textContent = money(collected);
    $('#billMonthOutstanding').textContent = money(outstanding);
    var byClient = {};
    thisMonth.forEach(function (p) {
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

    var notRel = state.leads.filter(function (l) { return l.stage === 'not_relevant'; });
    var finished = state.clients.filter(function (c) { return c.status === 'סיים טיפול'; });

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

  // ---- Leads kanban
  function renderLeads() {
    var kanban = $('#kanban');
    kanban.innerHTML = '';
    var q = state.leadSearch.trim();
    var filtered = state.leads.filter(function (l) {
      if (l.stage === 'not_relevant') return false;
      if (!q) return true;
      var hay = (l.name + ' ' + l.phone).toLowerCase();
      return hay.indexOf(q.toLowerCase()) !== -1;
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
    var chipsHtml = services.map(function (s) { return '<span class="chip">' + escapeHtml(s) + '</span>'; }).join('');
    if (l.location && !hasDayCenter(services)) {
      chipsHtml += '<span class="chip">' + escapeHtml(l.location) + '</span>';
    } else if (hasDayCenter(services)) {
      chipsHtml += '<span class="chip">' + escapeHtml(DAY_CENTER_LOCATION) + '</span>';
    }
    var hooLabel = houseOfOriginLabel(l.house_of_origin);
    if (hooLabel) {
      chipsHtml += '<span class="chip">בית מוצא: ' + escapeHtml(hooLabel) + '</span>';
    }
    var agreementFields = '';
    if (stage.id === 'agreement') {
      var breakdown = parseSessionsBreakdown(l.sessionsPerWeek, services);
      var bdChips = Object.keys(breakdown).map(function (k) {
        return '<span class="chip">' + escapeHtml(k) + ': ' + breakdown[k] + '/שבוע</span>';
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
          else if (nextStage.id === 'active') openActivateModal(l);
          else moveLead(l.id, nextStage.id);
        };
        actions.appendChild(next);
      }
      var edit = document.createElement('button');
      edit.className = 'btn btn-ghost';
      edit.textContent = 'עריכה';
      edit.onclick = function () { openLeadModal(l); };
      actions.appendChild(edit);

      var notRel = document.createElement('button');
      notRel.className = 'btn btn-danger';
      notRel.textContent = 'לא רלוונטי';
      notRel.onclick = function () { moveLead(l.id, 'not_relevant'); };
      actions.appendChild(notRel);
    }
    return card;
  }

  // ---- Clients
  function renderClients() {
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
        var svcs = parseServices(c.serviceType);
        if (svcs.indexOf(state.clientTab) === -1) return false;
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
    var services = parseServices(c.serviceType);
    var serviceChips = services.map(function (s) { return '<span class="chip">' + escapeHtml(s) + '</span>'; }).join('');
    var locationChip = hasDayCenter(services)
      ? '<span class="chip">' + escapeHtml(DAY_CENTER_LOCATION) + '</span>'
      : (c.location ? '<span class="chip">' + escapeHtml(c.location) + '</span>' : '');
    var hooLabelClient = houseOfOriginLabel(c.house_of_origin);
    var hooChip = hooLabelClient ? '<span class="chip">בית מוצא: ' + escapeHtml(hooLabelClient) + '</span>' : '';
    var breakdown = parseSessionsBreakdown(c.sessionsPerWeek, c.serviceType);
    var breakdownChips = Object.keys(breakdown).map(function (k) {
      return '<span class="chip">' + escapeHtml(k) + ': ' + breakdown[k] + '/שבוע</span>';
    }).join('');
    var total = totalSessions(c.sessionsPerWeek, c.serviceType);
    var statsHtml =
      '<span>סה״כ מפגשים/שבוע: <b>' + total + '</b></span>' +
      '<span>חבילה חודשית: <b>' + money(c.pricePerSession) + '</b></span>' +
      '<span>הכנסה: <b>' + money(rev) + '</b></span>';

    // Payment status badge
    var paymentHtml = '';
    if (c.paymentStatus) {
      var psLabel = c.paymentStatus === 'paid' ? 'שולם' : c.paymentStatus === 'partial' ? 'שולם חלקית' : 'לא שולם';
      var psClass = c.paymentStatus === 'paid' ? 'chip chip-paid' : c.paymentStatus === 'partial' ? 'chip chip-partial' : 'chip chip-unpaid';
      paymentHtml = '<div class="client-meta">' +
        '<span class="' + psClass + '">חבילה: ' + psLabel + '</span>' +
        (c.paymentDate ? '<span class="chip">שולם ב: ' + displayDate(c.paymentDate) + '</span>' : '') +
        (c.nextBillingDate ? '<span class="chip chip-next">גבייה הבאה: ' + displayDate(c.nextBillingDate) + '</span>' : '') +
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

    // Responsible person + scope chips (always show if filled)
    var responsibleHtml = '';
    if (c.responsiblePerson || c.serviceScope) {
      var scopeLbl = c.serviceScope === 'individual' ? 'טיפול פרטני'
                   : c.serviceScope === 'program' ? 'תוכנית מורחבת' : '';
      var roleLbl = c.serviceScope === 'individual' ? 'מטפל'
                  : c.serviceScope === 'program' ? 'מנהל בית' : 'אחראי';
      responsibleHtml = '<div class="client-meta">' +
        (scopeLbl ? '<span class="chip chip-scope">' + scopeLbl + '</span>' : '') +
        (c.responsiblePerson ? '<span class="chip chip-resp">' + roleLbl + ': ' + escapeHtml(c.responsiblePerson) + '</span>' : '') +
        '</div>';
    }

    card.innerHTML =
      renewBannerHtml +
      '<div class="client-head">' +
        '<div class="client-name">' + escapeHtml(c.name) + '</div>' +
        '<span class="status-badge ' + statusClass(c.status) + '">' + escapeHtml(c.status) + '</span>' +
      '</div>' +
      '<div class="client-meta">' + serviceChips + locationChip + hooChip + '</div>' +
      responsibleHtml +
      (breakdownChips ? '<div class="client-meta">' + breakdownChips + '</div>' : '') +
      '<div class="client-stats">' + statsHtml + '</div>' +
      paymentHtml +
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
        state.clients = state.clients.filter(function (x) { return x.id !== c.id; });
        persist().then(function () { toast('נמחק'); render(); }).catch(function (e) { toast('שגיאה: ' + e.message, true); });
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

  function readLeadFormFields(form) {
    var fd = new FormData(form);
    var group = $('[data-group="serviceType"]', form);
    var services = readServiceGroup(group);
    var isDayCenter = services.indexOf(DAY_CENTER) !== -1;
    return {
      name: (fd.get('name') || '').trim(),
      phone: (fd.get('phone') || '').trim(),
      serviceType: formatServices(services),
      location: isDayCenter ? DAY_CENTER_LOCATION : (fd.get('location') || ''),
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
      cb.type = 'checkbox'; cb.value = s; cb.checked = picked.indexOf(s) !== -1;
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
    if (picked.indexOf(DAY_CENTER) !== -1) {
      wrap.classList.add('field-hidden');
      var sel = $('select[name="location"]', form);
      if (sel) { sel.required = false; sel.value = DAY_CENTER_LOCATION; }
    } else {
      wrap.classList.remove('field-hidden');
      var sel2 = $('select[name="location"]', form);
      if (sel2) sel2.required = true;
    }
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
    if (picked.indexOf(DAY_CENTER) !== -1) {
      wrap.classList.add('field-hidden');
      sel.required = false;
      sel.value = DAY_CENTER_LOCATION;
    } else {
      wrap.classList.remove('field-hidden');
      sel.required = true;
    }
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
    form.serviceScope.value = client.serviceScope || '';
    form.responsiblePerson.value = client.responsiblePerson || '';
    form.paymentStatus.value = client.paymentStatus || 'paid';
    form.paymentDate.value = client.paymentDate || '';
    form.monthlyAmount.value = client.pricePerSession || '';
    $('#editClientModal').hidden = false;
  }
  function closeEditClientModal() { $('#editClientModal').hidden = true; editClientId = null; }

  // --- auth
  function applyRole() {
    document.body.classList.toggle('viewer', state.role !== 'editor');
    var badge = $('#roleBadge');
    badge.textContent = state.role === 'editor' ? 'עורך' : 'צופה';
    badge.classList.toggle('editor', state.role === 'editor');
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
  async function loadAll() {
    try {
      var data = await apiLoad();
      state.leads = (data.leads || []).map(normalizeLeadFromSheet);
      state.clients = (data.clients || []).map(normalizeClientFromSheet);
      try {
        var pr = await apiGetPayments();
        state.payments = (pr.payments || []).map(normalizePaymentFromSheet).filter(function (p) { return !!p.id; });
      } catch (pe) {
        console.warn('[ezone] getPayments failed, assuming empty:', pe.message);
        state.payments = [];
      }
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
    on('#leadsSearch', 'input', function (e) { state.leadSearch = e.target.value; renderLeads(); });
    on('#addLeadBtn', 'click', function () { openLeadModal(null); });
    on('#clientsSearch', 'input', function (e) { state.clientSearch = e.target.value; renderClients(); });
    on('#addClientBtn', 'click', function () { openDirectClientModal(); });
    on('#billingDate', 'change', function (e) { state.billingDate = e.target.value || today(); renderBilling(); });

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeLeadModal(); closeAgreementModal(); closeActivateModal(); closeExitModal(); closeDirectClientModal(); closeEditClientModal();
      });
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
        var isDayCenter = services.indexOf(DAY_CENTER) !== -1;
        var name = (fd.get('name') || '').trim();
        if (!name) { toast('חסר שם', true); submit.disabled = false; return; }
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
          id: uid(), name: name, phone: (fd.get('phone') || '').trim(),
          serviceType: formatServices(services),
          location: isDayCenter ? DAY_CENTER_LOCATION : (fd.get('location') || ''),
          sessionsPerWeek: clean, pricePerSession: monthlyAmount,
          startDate: startDate, status: 'פעיל', exitDate: '',
          fromLead: '', source: 'direct_admin',
          notes: (fd.get('notes') || '').trim(),
          billingType: 'monthly',
          billingDay: bdDay || dayOfMonth(startDate) || '',
          paymentStatus: payStatus,
          paymentDate: payDate,
          nextBillingDate: nextBill,
          house_of_origin: (fd.get('house_of_origin') || '').trim(),
          responsiblePerson: (fd.get('responsiblePerson') || '').trim(),
          serviceScope: fd.get('serviceScope') || ''
        };
        state.clients.push(client);
        persist()
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
      submit.disabled = true;
      var lead;
      if (editingLeadId) {
        lead = state.leads.find(function (l) { return l.id === editingLeadId; });
        if (!lead) { submit.disabled = false; return; }
        updateLeadFromForm(lead, form);
      } else {
        lead = addLeadFromForm(form);
      }
      persist()
        .then(function () { toast('נשמר'); closeLeadModal(); render(); })
        .catch(function (err) { toast('שגיאה: ' + err.message, true); })
        .finally(function () { submit.disabled = false; });
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
      var fd = new FormData(e.target);
      var group = $('[data-group="serviceType"]', e.target);
      var services = readServiceGroup(group);
      if (!services.length) { submit.disabled = false; toast('יש לבחור לפחות סוג טיפול אחד', true); return; }
      var host = $('[data-host="activateSessions"]', e.target);
      var breakdown = readSessionsHost(host);
      var cleanBreakdown = {};
      services.forEach(function (s) { cleanBreakdown[s] = wholeSessions(breakdown[s] || 0); });
      var isDayCenter = services.indexOf(DAY_CENTER) !== -1;
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
        id: uid(), name: lead.name, phone: lead.phone || '',
        serviceType: formatServices(services),
        location: isDayCenter ? DAY_CENTER_LOCATION : (fd.get('location') || lead.location),
        sessionsPerWeek: cleanBreakdown,
        pricePerSession: toNum(fd.get('pricePerSession')),
        startDate: startDate,
        status: 'פעיל', exitDate: '', fromLead: lead.id,
        source: 'lead', notes: '', billingType: 'monthly',
        billingDay: dayOfMonth(startDate) || '',
        paymentStatus: payStatus,
        paymentDate: payDate,
        nextBillingDate: nextBill,
        house_of_origin: lead.house_of_origin || '',
        responsiblePerson: (fd.get('responsiblePerson') || '').trim(),
        serviceScope: fd.get('serviceScope') || ''
      };
      state.clients.push(client);
      lead.stage = 'active';
      lead.serviceType = client.serviceType;
      lead.location = client.location;
      lead.sessionsPerWeek = client.sessionsPerWeek;
      lead.pricePerSession = client.pricePerSession;
      lead.startDate = client.startDate;
      lead.paymentStatus = payStatus;
      lead.paymentDate = payDate;
      lead.nextBillingDate = nextBill;
      persist()
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
      client.status = 'סיים טיפול';
      client.exitDate = fd.get('exitDate') || today();
      persist()
        .then(function () { toast('סיום נשמר'); closeExitModal(); render(); })
        .catch(function (err) { toast('שגיאה: ' + err.message, true); })
        .finally(function () { submit.disabled = false; });
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
      var scope = fd.get('serviceScope') || '';
      var resp = (fd.get('responsiblePerson') || '').trim();
      if (!scope) { toast('יש לבחור היקף טיפול', true); submit.disabled = false; return; }
      if (!resp) { toast('יש להזין שם איש קשר אחראי', true); submit.disabled = false; return; }
      var prev = {
        serviceScope: client.serviceScope, responsiblePerson: client.responsiblePerson,
        paymentStatus: client.paymentStatus, paymentDate: client.paymentDate,
        pricePerSession: client.pricePerSession
      };
      client.serviceScope = scope;
      client.responsiblePerson = resp;
      var ps = fd.get('paymentStatus') || '';
      if (ps) client.paymentStatus = ps;
      var pd = fd.get('paymentDate') || '';
      if (pd) client.paymentDate = pd;
      var amt = toNum(fd.get('monthlyAmount'));
      if (amt) client.pricePerSession = amt;
      persist()
        .then(function () { toast('נשמר'); closeEditClientModal(); render(); })
        .catch(function (err) {
          // rollback
          Object.assign(client, prev);
          toast('שגיאה: ' + err.message, true);
          render();
        })
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
