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
  var LOCATIONS = ['רעננה הפרדס', 'רמות השבים', 'קיסריה גמילה'];

  var DAY_CENTER = 'מרכז יום';
  var DAY_CENTER_LOCATION = 'רעננה הפרדס';

  // forward stages
  var STAGES = [
    { id: 'new',        he: 'ליד חדש' },
    { id: 'intro',      he: 'שיחת היכרות' },
    { id: 'agreement',  he: 'מתחיל טיפול' },
    { id: 'active',     he: 'מטופל פעיל' }
  ];
  // legacy Hebrew labels that should map back to a stage id
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

  // serviceType serialization: multi-value stored as "A, B" in one cell
  function parseServices(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function formatServices(arr) {
    return (arr || []).join(', ');
  }
  function hasDayCenter(arr) {
    return parseServices(arr).indexOf(DAY_CENTER) !== -1;
  }
  function wholeSessions(v) {
    var n = Math.round(toNum(v));
    return n < 0 ? 0 : n;
  }

  // sessionsPerWeek is stored as JSON object { "פרטני": 3, "קבוצה": 1 }
  // but legacy rows may hold a plain number. parse handles both.
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
    // legacy numeric — bucket under the single service if there is exactly one
    var list = parseServices(services);
    var n = wholeSessions(s);
    if (list.length === 1) { out[list[0]] = n; return out; }
    if (n) out._total = n;
    return out;
  }
  function formatSessionsBreakdown(b) {
    return JSON.stringify(b || {});
  }
  function totalSessions(v, services) {
    var b = parseSessionsBreakdown(v, services);
    return Object.keys(b).reduce(function (s, k) { return s + wholeSessions(b[k]); }, 0);
  }

  // --- state -------------------------------------------------------------
  var state = {
    role: 'viewer',          // 'viewer' | 'editor'
    view: 'dashboard',
    leads: [],               // [{id,name,phone,serviceType,location,note,stage (id), sessionsPerWeek, pricePerSession, startDate, created}]
    clients: [],             // [{id,name,serviceType,location,sessionsPerWeek,pricePerSession,startDate,status,exitDate,fromLead,billingType,billingDay,source,notes}]
    payments: [],            // [{id,clientId,clientName,billingType,dueDate,amountDue,amountPaid,status,paymentDate,method,notes,bundleSize,sessionsUsed}]
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
    // strip time portion if present: "2024-05-11T21:00:00.000Z" → "2024-05-11"
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    return s;
  }
  function money(n) {
    if (!isFinite(n)) return '₪0';
    return '₪' + Math.round(n).toLocaleString('he-IL');
  }
  function toNum(v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function monthlyRevenue(c) {
    // pricePerSession now stores the monthly package price — already monthly
    return toNum(c.pricePerSession);
  }
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // --- API ---------------------------------------------------------------
  async function apiLoad() {
    var r = await fetch('/api/sheets', { cache: 'no-store' });
    var data = await r.json();
    if (!r.ok || data.ok === false) {
      throw new Error(data.error || ('HTTP ' + r.status));
    }
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
    if (!r.ok || data.ok === false) {
      throw new Error(data.error || ('HTTP ' + r.status));
    }
    return data;
  }

  // Map rows from Sheets (Hebrew stage strings, maybe Date-y fields) → internal.
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
      introDateTime: row.introDateTime || ''
    };
  }
  function normalizeClientFromSheet(row) {
    var services = formatServices(parseServices(row.serviceType));
    // All clients are now monthly. Legacy rows with other billingType
    // values (or blanks) are coerced to 'monthly'.
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
      billingDay: row.billingDay === '' || row.billingDay == null ? '' : toNum(row.billingDay)
    };
  }

  // Map internal → rows for Sheets (Hebrew stage strings).
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
      introDateTime: l.introDateTime || ''
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
      billingDay: c.billingDay === '' || c.billingDay == null ? '' : toNum(c.billingDay)
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
    if (!r.ok || data.ok === false) {
      throw new Error(data.error || ('HTTP ' + r.status));
    }
    return data;
  }
  // Non-saveAll POSTs go through here so we don't accidentally wipe the
  // Leads / Clients sheets via a payload without those arrays.
  async function apiPostAction(action, extra) {
    var body = Object.assign({ action: action }, extra || {});
    var r = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) {
      throw new Error(data.error || ('HTTP ' + r.status));
    }
    return data;
  }

  function normalizePaymentFromSheet(row) {
    var amountDue  = toNum(row.amountDue);
    var amountPaid = toNum(row.amountPaid);
    return {
      id: row.id || '',
      clientId: row.clientId || '',
      clientName: row.clientName || '',
      billingType: (row.billingType || 'monthly').toString().toLowerCase(),
      dueDate: fmtDate(row.dueDate),
      amountDue: amountDue,
      amountPaid: amountPaid,
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

  // Billing amount owed for a given billing cycle.
  function clientAmountDue(c) {
    return toNum(c.pricePerSession); // monthly package price, already monthly
  }

  function paymentId(client, dueDateISO) {
    return 'pay::' + client.id + '::' + monthKey(dueDateISO);
  }

  function findPaymentById(id) {
    for (var i = 0; i < state.payments.length; i++) {
      if (state.payments[i].id === id) return state.payments[i];
    }
    return null;
  }

  // Synthesize an in-memory "unpaid" placeholder for a given client + due
  // date. Added to state.payments only when saved.
  function paymentForClientOn(client, dueDateISO) {
    var id = paymentId(client, dueDateISO);
    var existing = findPaymentById(id);
    if (existing) return existing;
    return {
      id: id,
      clientId: client.id,
      clientName: client.name,
      billingType: 'monthly',
      dueDate: dueDateISO,
      amountDue: clientAmountDue(client),
      amountPaid: 0,
      status: 'unpaid',
      paymentDate: '',
      method: '',
      notes: '',
      bundleSize: 0,
      sessionsUsed: 0
    };
  }

  // --- rendering ---------------------------------------------------------
  function setView(view) {
    state.view = view;
    $$('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === view);
    });
    $$('.view').forEach(function (v) {
      v.classList.toggle('active', v.id === 'view-' + view);
    });
    render();
  }

  function render() {
    if (state.view === 'dashboard') renderDashboard();
    else if (state.view === 'leads') renderLeads();
    else if (state.view === 'clients') renderClients();
    else if (state.view === 'billing') renderBilling();
  }

  // ---- Dashboard
  function renderDashboard() {
    var activeClients = state.clients.filter(function (c) { return c.status !== 'סיים טיפול'; });
    $('#kpiActive').textContent = activeClients.filter(function(c){return c.status==='פעיל';}).length;

    var totalRev = activeClients
      .filter(function (c) { return c.status === 'פעיל'; })
      .reduce(function (s, c) { return s + monthlyRevenue(c); }, 0);
    $('#kpiRevenue').textContent = money(totalRev);

    var openLeads = state.leads.filter(function (l) { return l.stage !== 'not_relevant' && l.stage !== 'active'; }).length;
    $('#kpiLeads').textContent = openLeads;

    var activeOnly = activeClients.filter(function (c) { return c.status === 'פעיל'; });

    // By service — a multi-service client counts in each of its services
    var byService = {};
    SERVICE_TYPES.forEach(function (s) { byService[s] = 0; });
    activeOnly.forEach(function (c) {
      parseServices(c.serviceType).forEach(function (s) {
        if (byService[s] === undefined) byService[s] = 0;
        byService[s]++;
      });
    });
    renderBars('#byService', byService);

    // By location — מרכז יום clients always count under רעננה הפרדס
    var byLoc = {};
    LOCATIONS.forEach(function (l) { byLoc[l] = 0; });
    activeOnly.forEach(function (c) {
      var loc = hasDayCenter(c.serviceType) ? DAY_CENTER_LOCATION : c.location;
      if (!loc) return;
      if (byLoc[loc] === undefined) byLoc[loc] = 0;
      byLoc[loc]++;
    });
    renderBars('#byLocation', byLoc);

    // Pipeline counts
    var pipeline = $('#pipeline');
    pipeline.innerHTML = '';
    STAGES.forEach(function (s) {
      var n = state.leads.filter(function (l) { return l.stage === s.id; }).length;
      var div = document.createElement('div');
      div.className = 'pc';
      div.innerHTML = '<div class="n">' + n + '</div><div class="l">' + s.he + '</div>';
      pipeline.appendChild(div);
    });
  }

  // Last day of the calendar month that dateISO belongs to. Used so
  // clients whose billingDay exceeds the current month's length roll
  // onto that month's last day (e.g. bd=31 → Feb 28/29, Apr 30).
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
    dueItems.forEach(function (d) {
      list.appendChild(buildBillingRow(d.client, d.payment, selectedISO, false));
    });
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
        || { id: p.clientId, name: p.clientName, billingType: 'monthly',
             pricePerSession: p.amountDue, startDate: p.dueDate };
      list.appendChild(buildBillingRow(client, p, p.dueDate, true));
    });
  }

  // Uniform billing row builder for the "due today" and "open balances"
  // sections.
  function buildBillingRow(client, payment, dueDateISO, isCarry) {
    var row = document.createElement('div');
    row.className = 'billing-row' + (isCarry ? ' carry' : '');
    var amount = payment.amountDue || clientAmountDue(client) || 0;
    var disabled = state.role === 'editor' ? '' : ' disabled';

    var statusSelect = PAYMENT_STATUSES.map(function (s) {
      return '<option value="' + s.id + '"' + (payment.status === s.id ? ' selected' : '') + '>' + s.he + '</option>';
    }).join('');

    var dateCellLabel = isCarry ? 'תאריך מקורי' : 'סכום חודשי';
    var dateCellVal = isCarry ? fmtDate(dueDateISO) : money(amount);

    row.innerHTML =
      '<div><span class="p-label">מטופל</span><span class="p-name">' + escapeHtml(client.name || payment.clientName) + '</span></div>' +
      '<div><span class="p-label">' + dateCellLabel + '</span><span class="p-val">' + escapeHtml(dateCellVal) + '</span></div>' +
      '<div><span class="p-label">סטטוס</span><select class="billing-status"' + disabled + '>' + statusSelect + '</select></div>' +
      '<div class="billing-paid-wrap ' + (payment.status === 'partial' ? '' : 'hidden') + '">' +
        '<span class="p-label">שולם בפועל</span>' +
        '<input class="billing-paid" type="number" min="0" step="1" value="' + (payment.amountPaid || 0) + '"' + disabled + ' />' +
      '</div>' +
      '<div><span class="p-label">יתרה</span><span class="p-val billing-balance">' + money(Math.max(0, amount - (payment.amountPaid || 0))) + '</span></div>';

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
        id: payment.id,
        clientId: payment.clientId || client.id,
        clientName: payment.clientName || client.name || '',
        billingType: 'monthly',
        dueDate: dueDateISO,
        amountDue: amount,
        amountPaid: ap,
        status: newStatus,
        paymentDate: newStatus === 'paid' ? today() : (payment.paymentDate || ''),
        method: payment.method || '',
        notes: payment.notes || '',
        bundleSize: 0,
        sessionsUsed: 0
      };
    }

    if (statusSel) statusSel.addEventListener('change', function () {
      var updated = recompute(statusSel.value, paidInput.value);
      saveBillingRow(updated);
    });
    if (paidInput) paidInput.addEventListener('change', function () {
      if (statusSel.value !== 'partial') return;
      var v = toNum(paidInput.value);
      if (v >= amount) {
        statusSel.value = 'paid';
        saveBillingRow(recompute('paid', amount));
      } else {
        saveBillingRow(recompute('partial', v));
      }
    });

    return row;
  }

  function saveBillingRow(updated) {
    if (state.role !== 'editor') return;
    // Upsert locally for instant feedback, then persist.
    var idx = state.payments.findIndex(function (p) { return p.id === updated.id; });
    var prev = idx >= 0 ? state.payments[idx] : null;
    if (idx >= 0) state.payments[idx] = updated;
    else state.payments.push(updated);
    renderBillingMonthlySummary(state.billingDate || today());
    persistPayment(updated)
      .then(function () { toast('נשמר'); })
      .catch(function (e) {
        // rollback
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

    // By client
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
    var chipsHtml = services.map(function (s) {
      return '<span class="chip">' + escapeHtml(s) + '</span>';
    }).join('');
    if (l.location && !hasDayCenter(services)) {
      chipsHtml += '<span class="chip">' + escapeHtml(l.location) + '</span>';
    } else if (hasDayCenter(services)) {
      chipsHtml += '<span class="chip">' + escapeHtml(DAY_CENTER_LOCATION) + '</span>';
    }
    var agreementFields = '';
    if (stage.id === 'agreement') {
      var breakdown = parseSessionsBreakdown(l.sessionsPerWeek, services);
      var bdChips = Object.keys(breakdown).map(function (k) {
        return '<span class="chip">' + escapeHtml(k) + ': ' + breakdown[k] + '/שבוע</span>';
      }).join('');
      agreementFields =
        '<div class="row">' +
          (bdChips || '<span class="chip">מפגשים לא נקבעו</span>') +
        '</div>' +
        '<div class="row"><span class="chip">חבילה חודשית: ' + (l.pricePerSession ? money(l.pricePerSession) : '—') + '</span></div>';
    }
    var createdLine = l.created ? '<div class="meta">נוצר: ' + escapeHtml(l.created) + '</div>' : '';
    card.innerHTML =
      '<div class="name">' + escapeHtml(l.name) + '</div>' +
      '<div class="meta">' + escapeHtml(l.phone) + '</div>' +
      createdLine +
      (chipsHtml ? '<div class="row">' + chipsHtml + '</div>' : '') +
      (l.note ? '<div class="note">' + escapeHtml(l.note) + '</div>' : '') +
      agreementFields +
      '<div class="intro-slot"></div>' +
      '<div class="actions edit-only"></div>';

    // Inline datetime field on the intro stage card
    if (stage.id === 'intro') {
      var slot = $('.intro-slot', card);
      var wrap = document.createElement('label');
      wrap.className = 'inline-field';
      wrap.innerHTML = 'תאריך ושעת שיחת היכרות';
      var dt = document.createElement('input');
      dt.type = 'datetime-local';
      dt.value = l.introDateTime || '';
      if (state.role !== 'editor') dt.disabled = true;
      dt.addEventListener('click', function () {
        if (typeof dt.showPicker === 'function') {
          try { dt.showPicker(); } catch (_) {}
        }
      });
      dt.addEventListener('focus', function () {
        if (typeof dt.showPicker === 'function') {
          try { dt.showPicker(); } catch (_) {}
        }
      });
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

      // In Hebrew RTL: → points to previous (right), ← points to next (left)
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
          if (nextStage.id === 'agreement') {
            openAgreementModal(l, true);
          } else if (nextStage.id === 'active') {
            openActivateModal(l);
          } else {
            moveLead(l.id, nextStage.id);
          }
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
    // tabs
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
      if (state.clientTab !== 'all') {
        var svcs = parseServices(c.serviceType);
        if (svcs.indexOf(state.clientTab) === -1) return false;
      }
      if (q && c.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    visible.forEach(function (c) { list.appendChild(clientCard(c)); });
    if (!visible.length) {
      list.innerHTML = '<div class="panel">אין מטופלים להצגה.</div>';
    }
  }

  function statusClass(s) {
    if (s === 'פעיל') return 'status-active';
    if (s === 'הפסקה זמנית') return 'status-pause';
    return 'status-done';
  }

  function clientCard(c) {
    var card = document.createElement('div');
    card.className = 'client-card' + (c.status === 'סיים טיפול' ? ' finished' : '');
    var rev = monthlyRevenue(c);
    var services = parseServices(c.serviceType);
    var serviceChips = services.map(function (s) {
      return '<span class="chip">' + escapeHtml(s) + '</span>';
    }).join('');
    var locationChip = hasDayCenter(services)
      ? '<span class="chip">' + escapeHtml(DAY_CENTER_LOCATION) + '</span>'
      : (c.location ? '<span class="chip">' + escapeHtml(c.location) + '</span>' : '');
    var breakdown = parseSessionsBreakdown(c.sessionsPerWeek, c.serviceType);
    var breakdownChips = Object.keys(breakdown).map(function (k) {
      return '<span class="chip">' + escapeHtml(k) + ': ' + breakdown[k] + '/שבוע</span>';
    }).join('');
    var total = totalSessions(c.sessionsPerWeek, c.serviceType);
    var statsHtml =
      '<span>סה״כ מפגשים/שבוע: <b>' + total + '</b></span>' +
      '<span>חבילה חודשית: <b>' + money(c.pricePerSession) + '</b></span>' +
      '<span>הכנסה: <b>' + money(rev) + '</b></span>';

    card.innerHTML =
      '<div class="client-head">' +
        '<div class="client-name">' + escapeHtml(c.name) + '</div>' +
        '<span class="status-badge ' + statusClass(c.status) + '">' + escapeHtml(c.status) + '</span>' +
      '</div>' +
      '<div class="client-meta">' + serviceChips + locationChip + '</div>' +
      (breakdownChips ? '<div class="client-meta">' + breakdownChips + '</div>' : '') +
      '<div class="client-stats">' + statsHtml + '</div>' +
      '<div class="client-meta">' +
        (c.startDate ? 'החל: ' + escapeHtml(c.startDate) : '') +
        (c.exitDate ? ' · סיים: ' + escapeHtml(c.exitDate) : '') +
      '</div>' +
      '<div class="client-actions edit-only"></div>';

    if (state.role === 'editor') {
      var actions = $('.client-actions', card);

      if (c.status !== 'סיים טיפול') {
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
      }

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
    persist().then(function () { toast('הועבר'); render(); }).catch(function (e) {
      toast('שגיאה: ' + e.message, true);
    });
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
      created: fd.get('created') || today()
    };
  }
  function addLeadFromForm(form) {
    var f = readLeadFormFields(form);
    var lead = {
      id: uid(),
      name: f.name,
      phone: f.phone,
      serviceType: f.serviceType,
      location: f.location,
      note: f.note,
      stage: 'new',
      sessionsPerWeek: '',
      pricePerSession: '',
      startDate: '',
      created: f.created,
      introDateTime: ''
    };
    state.leads.push(lead);
    return lead;
  }
  function updateLeadFromForm(lead, form) {
    var f = readLeadFormFields(form);
    lead.name = f.name;
    lead.phone = f.phone;
    lead.serviceType = f.serviceType;
    lead.location = f.location;
    lead.note = f.note;
    lead.created = f.created;
  }

  // --- dynamic per-service sessions fields ------------------------------
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
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.required = true;
      input.dataset.service = svc;
      input.value = current[svc] != null ? current[svc] : '';
      label.appendChild(input);
      host.appendChild(label);
    });
  }
  function readSessionsHost(host) {
    var out = {};
    $$('input[data-service]', host).forEach(function (inp) {
      out[inp.dataset.service] = wholeSessions(inp.value);
    });
    return out;
  }

  // --- service checkbox group -------------------------------------------
  function populateServiceGroup(group, selected) {
    group.innerHTML = '';
    var picked = parseServices(selected);
    SERVICE_TYPES.forEach(function (s) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = s;
      cb.checked = picked.indexOf(s) !== -1;
      cb.addEventListener('change', function () {
        updateLocationVisibility(group.closest('form'));
      });
      var span = document.createElement('span');
      span.textContent = s;
      lab.appendChild(cb);
      lab.appendChild(span);
      group.appendChild(lab);
    });
  }
  function readServiceGroup(group) {
    return $$('input[type="checkbox"]', group)
      .filter(function (cb) { return cb.checked; })
      .map(function (cb) { return cb.value; });
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
      if (sel) {
        sel.required = false;
        sel.value = DAY_CENTER_LOCATION;
      }
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
    } else {
      f.created.value = today();
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
    // keep the per-service sessions in sync when checkboxes change
    $$('input[type="checkbox"]', group).forEach(function (cb) {
      cb.addEventListener('change', function () {
        var picked = readServiceGroup(group);
        var current = readSessionsHost(host);
        renderSessionsHost(host, formatServices(picked), current);
      });
    });
    f.pricePerSession.value = lead.pricePerSession || '';
    f.startDate.value = lead.startDate || today();
    updateLocationVisibility(f);
    $('#activateModal').hidden = false;
  }
  function closeActivateModal() { $('#activateModal').hidden = true; activateLeadId = null; }

  // --- Direct-add client modal (admin bypass of Lead → Client flow) ----
  function openDirectClientModal() {
    var m = $('#directClientModal');
    var f = $('#directClientForm');
    f.reset();
    var group = $('[data-group="serviceType"]', f);
    populateServiceGroup(group, '');
    f.startDate.value = today();
    if (f.billingDay) f.billingDay.value = '';
    if (f.monthlyAmount) f.monthlyAmount.value = '';
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

  // --- auth --------------------------------------------------------------
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
    console.log('[ezone] enterApp: hiding #pinScreen, showing #app');
    var pin = $('#pinScreen');
    var app = $('#app');
    console.log('[ezone] enterApp elements: pinScreen=%o app=%o', !!pin, !!app);
    if (pin) pin.hidden = true;
    if (app) app.hidden = false;
    console.log('[ezone] enterApp after toggle: pinScreen.hidden=%o app.hidden=%o',
      pin && pin.hidden, app && app.hidden);
    applyRole();
    console.log('[ezone] enterApp: role applied, calling setView(dashboard)');
    setView('dashboard');
    console.log('[ezone] enterApp: setView done');
  }

  // --- init --------------------------------------------------------------
  async function loadAll() {
    try {
      var data = await apiLoad();
      state.leads = (data.leads || []).map(normalizeLeadFromSheet);
      state.clients = (data.clients || []).map(normalizeClientFromSheet);
      // Payments live on their own sheet / action. Treat load failure as
      // empty list so the rest of the app still renders.
      try {
        var pr = await apiGetPayments();
        state.payments = (pr.payments || []).map(normalizePaymentFromSheet)
          .filter(function (p) { return !!p.id; });
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
    console.log('[ezone] wireEvents: start');

    // PIN  — wired first so it survives any later wiring failure
    on('#pinSubmit', 'click', function (ev) {
      console.log('[ezone] PIN key clicked:', 'submit');
      var input = $('#pinInput');
      var raw = input ? input.value : '(no input)';
      var v = (input && input.value || '').trim();
      var match = (v === '2107');
      console.log('[ezone] PIN submit: raw=%o trimmed=%o length=%d match=%o',
        raw, v, v.length, match);
      if (match) {
        try { sessionStorage.setItem('ez_role', 'editor'); }
        catch (e) { console.warn('[ezone] sessionStorage set failed', e); }
        state.role = 'editor';
        console.log('[ezone] PIN ok → calling enterApp()');
        try {
          enterApp();
          console.log('[ezone] enterApp returned OK');
        } catch (e) {
          console.error('[ezone] enterApp threw', e);
        }
      } else {
        console.log('[ezone] PIN mismatch — char codes:',
          Array.prototype.map.call(v, function (c) { return c.charCodeAt(0); }));
        var err = $('#pinError'); if (err) err.hidden = false;
      }
    });
    on('#pinInput', 'keydown', function (e) {
      console.log('[ezone] PIN key clicked:', e.key);
      var err = $('#pinError'); if (err) err.hidden = true;
      if (e.key === 'Enter') {
        e.preventDefault();
        var btn = $('#pinSubmit'); if (btn) btn.click();
      }
    });
    on('#pinViewer', 'click', function () {
      console.log('[ezone] PIN key clicked:', 'viewer');
      try { sessionStorage.setItem('ez_role', 'viewer'); } catch (_) {}
      state.role = 'viewer';
      enterApp();
    });
    on('#logoutBtn', 'click', function () {
      try { sessionStorage.removeItem('ez_role'); } catch (_) {}
      state.role = 'viewer';
      showPin();
    });

    console.log('[ezone] wireEvents: PIN bound');

    // Tabs
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.dataset.view); });
    });
    on('#refreshBtn', 'click', function () {
      loadAll().then(function () { toast('רועננו'); }).catch(function () {});
    });

    // Leads
    on('#leadsSearch', 'input', function (e) {
      state.leadSearch = e.target.value; renderLeads();
    });
    on('#addLeadBtn', 'click', function () { openLeadModal(null); });

    // Clients
    on('#clientsSearch', 'input', function (e) {
      state.clientSearch = e.target.value; renderClients();
    });
    on('#addClientBtn', 'click', function () { openDirectClientModal(); });

    // Billing
    on('#billingDate', 'change', function (e) {
      state.billingDate = e.target.value || today();
      renderBilling();
    });

    // Modals close
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeLeadModal(); closeAgreementModal(); closeActivateModal(); closeExitModal();
        closeDirectClientModal();
      });
    });

    // Direct-add client: service-group changes re-render the per-service
    // sessions host and the location-visibility rule.
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

    // Direct-add client: form submit
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
        var client = {
          id: uid(),
          name: name,
          phone: (fd.get('phone') || '').trim(),
          serviceType: formatServices(services),
          location: isDayCenter ? DAY_CENTER_LOCATION : (fd.get('location') || ''),
          sessionsPerWeek: clean,
          pricePerSession: monthlyAmount,
          startDate: startDate,
          status: 'פעיל',
          exitDate: '',
          fromLead: '',
          source: 'direct_admin',
          notes: (fd.get('notes') || '').trim(),
          billingType: 'monthly',
          billingDay: bdDay || dayOfMonth(startDate) || ''
        };

        state.clients.push(client);

        persist()
          .then(function () {
            toast('המטופל נוסף');
            closeDirectClientModal();
            render();
          })
          .catch(function (err) {
            state.clients = state.clients.filter(function (x) { return x.id !== client.id; });
            render();
            toast('שגיאה: ' + err.message, true);
          })
          .finally(function () { submit.disabled = false; });
      } catch (e) {
        toast('שגיאה: ' + e.message, true);
        submit.disabled = false;
      }
    });

    // Lead form submit
    $('#leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#leadFormSubmit');
      if (submit.disabled) return;
      var form = e.target;
      var group = $('[data-group="serviceType"]', form);
      if (!readServiceGroup(group).length) {
        toast('יש לבחור לפחות סוג טיפול אחד', true);
        return;
      }
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

    // Agreement form submit
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

    // Activate form submit
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
      if (!services.length) {
        submit.disabled = false;
        toast('יש לבחור לפחות סוג טיפול אחד', true);
        return;
      }
      var host = $('[data-host="activateSessions"]', e.target);
      var breakdown = readSessionsHost(host);
      // trim to selected services only
      var cleanBreakdown = {};
      services.forEach(function (s) { cleanBreakdown[s] = wholeSessions(breakdown[s] || 0); });
      var isDayCenter = services.indexOf(DAY_CENTER) !== -1;
      var client = {
        id: uid(),
        name: lead.name,
        serviceType: formatServices(services),
        location: isDayCenter ? DAY_CENTER_LOCATION : (fd.get('location') || lead.location),
        sessionsPerWeek: cleanBreakdown,
        pricePerSession: toNum(fd.get('pricePerSession')),
        startDate: fd.get('startDate') || today(),
        status: 'פעיל',
        exitDate: '',
        fromLead: lead.id
      };
      state.clients.push(client);
      lead.stage = 'active';
      lead.serviceType = client.serviceType;
      lead.location = client.location;
      lead.sessionsPerWeek = client.sessionsPerWeek;
      lead.pricePerSession = client.pricePerSession;
      lead.startDate = client.startDate;
      persist()
        .then(function () { toast('המטופל נוסף'); closeActivateModal(); setView('clients'); })
        .catch(function (err) { toast('שגיאה: ' + err.message, true); })
        .finally(function () { submit.disabled = false; });
    });

    // Exit form submit
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
  }

  function init() {
    console.log('[ezone] init');
    try { wireEvents(); }
    catch (e) { console.error('[ezone] wireEvents failed', e); }

    var saved = null;
    try { saved = sessionStorage.getItem('ez_role'); } catch (_) {}
    if (saved === 'editor' || saved === 'viewer') {
      state.role = saved;
      enterApp();
    } else {
      showPin();
    }
    loadAll().catch(function () { /* toast already shown */ });
  }

  function bootWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
  bootWhenReady();
})();
