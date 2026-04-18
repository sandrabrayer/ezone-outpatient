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
    'מרכז יום'
  ];
  var LOCATIONS = ['רעננה הפרדס', 'רמות השבים', 'קיסריה גמילה'];

  // forward stages
  var STAGES = [
    { id: 'new',        he: 'ליד חדש' },
    { id: 'intro',      he: 'שיחת היכרות' },
    { id: 'agreement',  he: 'הסכם נחתם' },
    { id: 'active',     he: 'מטופל פעיל' }
  ];
  var NOT_RELEVANT_HE = 'לא רלוונטי';

  function heToId(he) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].he === he) return STAGES[i].id;
    if (he === NOT_RELEVANT_HE) return 'not_relevant';
    return 'new';
  }
  function idToHe(id) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return STAGES[i].he;
    if (id === 'not_relevant') return NOT_RELEVANT_HE;
    return STAGES[0].he;
  }

  var AVG_WEEKS_PER_MONTH = 4.3;

  // --- state -------------------------------------------------------------
  var state = {
    role: 'viewer',          // 'viewer' | 'editor'
    view: 'dashboard',
    leads: [],               // [{id,name,phone,serviceType,location,note,stage (id), sessionsPerWeek, pricePerSession, startDate, created}]
    clients: [],             // [{id,name,serviceType,location,sessionsPerWeek,pricePerSession,startDate,status,exitDate,fromLead}]
    leadSearch: '',
    clientSearch: '',
    clientTab: 'all',
    loaded: false
  };

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
    return toNum(c.sessionsPerWeek) * toNum(c.pricePerSession) * AVG_WEEKS_PER_MONTH;
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
    return {
      id: row.id || uid(),
      name: row.name || '',
      phone: row.phone || '',
      serviceType: row.serviceType || '',
      location: row.location || '',
      note: row.note || '',
      stage: heToId(row.stage || ''),
      sessionsPerWeek: row.sessionsPerWeek === '' ? '' : toNum(row.sessionsPerWeek),
      pricePerSession: row.pricePerSession === '' ? '' : toNum(row.pricePerSession),
      startDate: fmtDate(row.startDate),
      created: fmtDate(row.created) || today()
    };
  }
  function normalizeClientFromSheet(row) {
    return {
      id: row.id || uid(),
      name: row.name || '',
      serviceType: row.serviceType || '',
      location: row.location || '',
      sessionsPerWeek: toNum(row.sessionsPerWeek),
      pricePerSession: toNum(row.pricePerSession),
      startDate: fmtDate(row.startDate),
      status: row.status || 'פעיל',
      exitDate: fmtDate(row.exitDate),
      fromLead: row.fromLead || ''
    };
  }

  // Map internal → rows for Sheets (Hebrew stage strings).
  function leadForSheet(l) {
    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      serviceType: l.serviceType,
      location: l.location,
      note: l.note,
      stage: idToHe(l.stage),
      sessionsPerWeek: l.sessionsPerWeek === '' ? '' : toNum(l.sessionsPerWeek),
      pricePerSession: l.pricePerSession === '' ? '' : toNum(l.pricePerSession),
      startDate: l.startDate || '',
      created: l.created || today()
    };
  }
  function clientForSheet(c) {
    return {
      id: c.id,
      name: c.name,
      serviceType: c.serviceType,
      location: c.location,
      sessionsPerWeek: toNum(c.sessionsPerWeek),
      pricePerSession: toNum(c.pricePerSession),
      startDate: c.startDate || '',
      status: c.status || 'פעיל',
      exitDate: c.exitDate || '',
      fromLead: c.fromLead || ''
    };
  }

  async function persist() {
    var payload = {
      leads: state.leads.map(leadForSheet),
      clients: state.clients.map(clientForSheet)
    };
    await apiSave(payload);
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

    // By service
    var byService = {};
    SERVICE_TYPES.forEach(function (s) { byService[s] = 0; });
    activeClients.filter(function(c){return c.status==='פעיל';}).forEach(function (c) {
      if (byService[c.serviceType] === undefined) byService[c.serviceType] = 0;
      byService[c.serviceType]++;
    });
    renderBars('#byService', byService);

    // By location
    var byLoc = {};
    LOCATIONS.forEach(function (l) { byLoc[l] = 0; });
    activeClients.filter(function(c){return c.status==='פעיל';}).forEach(function (c) {
      if (byLoc[c.location] === undefined) byLoc[c.location] = 0;
      byLoc[c.location]++;
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
    var chips = '';
    if (l.serviceType) chips += '<span class="chip">' + l.serviceType + '</span>';
    if (l.location) chips += '<span class="chip">' + l.location + '</span>';
    var agreementFields = '';
    if (stage.id === 'agreement') {
      agreementFields =
        '<div class="row"><span class="chip">מפגשים/שבוע: ' + (l.sessionsPerWeek || '—') + '</span>' +
        '<span class="chip">מחיר למפגש: ' + (l.pricePerSession ? money(l.pricePerSession) : '—') + '</span></div>';
    }
    card.innerHTML =
      '<div class="name">' + escapeHtml(l.name) + '</div>' +
      '<div class="meta">' + escapeHtml(l.phone) + '</div>' +
      (chips ? '<div class="row">' + chips + '</div>' : '') +
      (l.note ? '<div class="note">' + escapeHtml(l.note) + '</div>' : '') +
      agreementFields +
      '<div class="actions edit-only"></div>';

    if (state.role === 'editor') {
      var actions = $('.actions', card);
      var idx = STAGES.findIndex(function (s) { return s.id === stage.id; });

      if (idx > 0) {
        var back = document.createElement('button');
        back.className = 'btn btn-ghost';
        back.textContent = '← ' + STAGES[idx - 1].he;
        back.onclick = function () { moveLead(l.id, STAGES[idx - 1].id); };
        actions.appendChild(back);
      }

      if (stage.id === 'agreement') {
        var setAgree = document.createElement('button');
        setAgree.className = 'btn';
        setAgree.textContent = 'עריכת הסכם';
        setAgree.onclick = function () { openAgreementModal(l); };
        actions.appendChild(setAgree);
      }

      if (idx < STAGES.length - 1) {
        var next = document.createElement('button');
        next.className = 'btn btn-primary';
        var nextStage = STAGES[idx + 1];
        next.textContent = nextStage.he + ' →';
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
      if (state.clientTab !== 'all' && c.serviceType !== state.clientTab) return false;
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
    card.innerHTML =
      '<div class="client-head">' +
        '<div class="client-name">' + escapeHtml(c.name) + '</div>' +
        '<span class="status-badge ' + statusClass(c.status) + '">' + escapeHtml(c.status) + '</span>' +
      '</div>' +
      '<div class="client-meta">' +
        '<span class="chip">' + escapeHtml(c.serviceType) + '</span>' +
        '<span class="chip">' + escapeHtml(c.location) + '</span>' +
      '</div>' +
      '<div class="client-stats">' +
        '<span>מפגשים/שבוע: <b>' + c.sessionsPerWeek + '</b></span>' +
        '<span>מחיר: <b>' + money(c.pricePerSession) + '</b></span>' +
        '<span>הכנסה חודשית: <b>' + money(rev) + '</b></span>' +
      '</div>' +
      '<div class="client-meta">' +
        (c.startDate ? 'החל: ' + c.startDate : '') +
        (c.exitDate ? ' · סיים: ' + c.exitDate : '') +
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

  function addLeadFromForm(form) {
    var fd = new FormData(form);
    var lead = {
      id: uid(),
      name: (fd.get('name') || '').trim(),
      phone: (fd.get('phone') || '').trim(),
      serviceType: fd.get('serviceType') || '',
      location: fd.get('location') || '',
      note: (fd.get('note') || '').trim(),
      stage: 'new',
      sessionsPerWeek: '',
      pricePerSession: '',
      startDate: '',
      created: today()
    };
    state.leads.push(lead);
    return lead;
  }
  function updateLeadFromForm(lead, form) {
    var fd = new FormData(form);
    lead.name = (fd.get('name') || '').trim();
    lead.phone = (fd.get('phone') || '').trim();
    lead.serviceType = fd.get('serviceType') || '';
    lead.location = fd.get('location') || '';
    lead.note = (fd.get('note') || '').trim();
  }

  // --- modals ------------------------------------------------------------
  var editingLeadId = null;
  function openLeadModal(lead) {
    editingLeadId = lead ? lead.id : null;
    var m = $('#leadModal');
    $('#leadModalTitle').textContent = lead ? 'עריכת ליד' : 'ליד חדש';
    var f = $('#leadForm');
    f.reset();
    if (lead) {
      f.name.value = lead.name;
      f.phone.value = lead.phone;
      f.serviceType.value = lead.serviceType;
      f.location.value = lead.location;
      f.note.value = lead.note;
    }
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
    f.sessionsPerWeek.value = lead.sessionsPerWeek || '';
    f.pricePerSession.value = lead.pricePerSession || '';
    $('#agreementModal').hidden = false;
  }
  function closeAgreementModal() { $('#agreementModal').hidden = true; agreementLeadId = null; }

  var activateLeadId = null;
  function openActivateModal(lead) {
    activateLeadId = lead.id;
    var f = $('#activateForm');
    f.reset();
    if (lead.serviceType) f.serviceType.value = lead.serviceType;
    if (lead.location) f.location.value = lead.location;
    f.sessionsPerWeek.value = lead.sessionsPerWeek || '';
    f.pricePerSession.value = lead.pricePerSession || '';
    f.startDate.value = lead.startDate || today();
    $('#activateModal').hidden = false;
  }
  function closeActivateModal() { $('#activateModal').hidden = true; activateLeadId = null; }

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
    $('#pinScreen').hidden = true;
    $('#app').hidden = false;
    applyRole();
    setView('dashboard');
  }

  // --- init --------------------------------------------------------------
  async function loadAll() {
    try {
      var data = await apiLoad();
      state.leads = (data.leads || []).map(normalizeLeadFromSheet);
      state.clients = (data.clients || []).map(normalizeClientFromSheet);
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
      if (e.key === 'Enter') {
        e.preventDefault();
        var btn = $('#pinSubmit'); if (btn) btn.click();
      }
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

    // Modals close
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeLeadModal(); closeAgreementModal(); closeActivateModal(); closeExitModal();
      });
    });

    // Lead form submit
    $('#leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = $('#leadFormSubmit');
      if (submit.disabled) return;
      submit.disabled = true;
      var form = e.target;
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
      lead.sessionsPerWeek = toNum(fd.get('sessionsPerWeek'));
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
      var client = {
        id: uid(),
        name: lead.name,
        serviceType: fd.get('serviceType') || lead.serviceType,
        location: fd.get('location') || lead.location,
        sessionsPerWeek: toNum(fd.get('sessionsPerWeek')),
        pricePerSession: toNum(fd.get('pricePerSession')),
        startDate: fd.get('startDate') || today(),
        status: 'פעיל',
        exitDate: '',
        fromLead: lead.id
      };
      state.clients.push(client);
      lead.stage = 'active';
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
