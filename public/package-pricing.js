/**
 * package-pricing.js — the "תמחור חבילות" tab (Vered only).
 * -----------------------------------------------------------------------------
 * CONFIDENTIALITY: this file ships to every browser, so it carries LABELS ONLY
 * (Hebrew names for stable English keys) — never a price, rate or catalog row.
 * Every amount shown here was returned by /api/catalog-admin/rpc after the
 * server verified the catalog-admin PIN (a short-lived HttpOnly cookie). A picked
 * display name, a stored browser flag, or this file's own state grants nothing; if the
 * cookie is missing/expired the server answers 401 and the gate comes back.
 *
 * Money is integer agorot end to end. The only conversion is parseShekels()
 * (string -> integer agorot, no floating point) for what Vered types.
 *
 * Mutations (adjust / select / approve / attach) carry a client-generated op id
 * that is REUSED when the same action is retried, plus the revision the screen
 * was showing; the server replays a seen op id and refuses a stale revision.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PackagePricing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Hebrew labels for stable keys (render-time only) ---------------------
  var FAMILY = { day_track: 'מסלול יום', emdr: 'EMDR', cbt: 'CBT', emdr_cbt: 'EMDR + CBT', continuation: 'טיפולי המשך', psychiatric: 'פסיכיאטריה', solo_housing: 'Solo — דיור' };
  var TIER = { basic: 'בסיסי', extended: 'מורחב', core: 'Core', standard: 'Standard', complex: 'Complex', single: 'טיפול בודד', combined: 'משולב', monthly: 'חודשי', consult: 'ייעוץ', diagnosis: 'אבחון', range: 'טווח מחיר' };
  var UNIT = { per_session_pack: 'חבילת טיפולים', flat: 'מחיר כולל קבוע', per_month: 'מחיר חודשי', per_month_range: 'טווח חודשי (בחירה)' };
  var STATUS = { pending: 'ממתין לתמחור', priced: 'תומחר (לא שולם)' };
  // Offer CRM statuses (stable keys; pending ≙ draft and priced ≙ ready_to_send are mapped by the server at read time)
  var CRM_STATUS = { draft: 'טיוטה', ready_to_send: 'מוכנה לשליחה', sent: 'נשלחה', awaiting_decision: 'ממתינה להחלטה', approved: 'אושרה', rejected: 'נדחתה', expired: 'פג תוקף' };
  // target kinds of an offer (stable keys): outpatient client · Dashboard admitted-roster patient · open lead
  var TARGET_HE = { client: 'מטופל', roster: 'מאושפז/ת', lead: 'ליד' };
  var TARGET_SECTIONS = [['client', 'מטופלים'], ['roster', 'מאושפזים'], ['lead', 'לידים פתוחים']];
  var CRM_ORDER = ['draft', 'ready_to_send', 'sent', 'awaiting_decision', 'approved', 'rejected', 'expired'];
  var REQUESTER = { oren: 'אורן', shahar: 'שחר', outpatient: 'ורד (טיפולי חוץ)' };
  var ASSIGNEES = ['ורד', 'אורן', 'דנה'];
  var ERRORS = {
    vered_only: 'האזור הזה מיועד לורד בלבד', named_session_required: 'יש להיכנס עם שם משתמש (לא כניסה אנונימית) כדי לגשת לתמחור', too_many_attempts: 'יותר מדי ניסיונות — נסי שוב מאוחר יותר',
    catalog_admin_not_configured: 'התמחור עדיין לא הוגדר בשרת', admin_required: 'נדרשת כניסה מחדש',
    revision_conflict: 'הבקשה עודכנה — נטענה מחדש', version_conflict: 'השורה עודכנה — נטענה מחדש',
    already_priced: 'הבקשה כבר תומחרה', selection_required: 'יש לבחור מחיר חודשי לפני אישור',
    selection_out_of_range: 'המחיר מחוץ לטווח', selection_not_required: 'אין צורך בבחירת מחיר',
    reason_required: 'חובה לרשום סיבה לשינוי', invalid_adjustment: 'סכום לא תקין',
    not_priced: 'אפשר לשייך רק בקשה שתומחרה', already_attached: 'הבקשה כבר משויכת למטופל אחר',
    target_not_found: 'המטופל/הליד לא נמצא', invalid_target: 'יעד שיוך לא תקין', invalid_fields: 'שדות לא תקינים',
    upstream_unavailable: 'השרת לא זמין, נסי שוב', busy: 'המערכת עסוקה, נסי שוב', unauthorized: 'אין הרשאה',
    items_required: 'יש להוסיף לפחות פריט אחד', too_many_items: 'יותר מדי פריטים בהצעה', invalid_quantity: 'כמות לא מותרת (1–20)',
    invalid_package: 'חבילה לא פעילה או לא קיימת', invalid_months: 'משך לא מותר לחבילה זו', invalid_patient: 'יש לבחור לקוח או להזין שם',
    invalid_phone: 'טלפון לא תקין', invalid_date: 'תאריך לא תקין', invalid_assignee: 'אחראי/ת לא מוכר/ת', not_found: 'הבקשה לא נמצאה',
    invalid_transition: 'המעבר הזה לא אפשרי במצב הנוכחי', offer_closed: 'ההצעה כבר נסגרה', invalid_recipient: 'יש לבחור יעד תקין (אורן או מספר 05X)',
    recovery_pending: 'המערכת בשחזור — נסי מאוחר יותר',
    invalid_amount: 'מחיר לא תקין', invalid_custom_item: 'יש להזין שם טיפול (2 תווים לפחות) ומחיר ליחידה',
    pricing_override_vered_only: 'פריט מותאם / מחיר ידני — ורד בלבד'
  };
  var MAX_SHEKELS_DIGITS = 7;

  function label(map, key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : String(key); }
  function errorText(code) { return label(ERRORS, code) === code ? 'שגיאה (' + code + ')' : label(ERRORS, code); }

  // ---- money (integer agorot) ------------------------------------------------
  function formatAgorot(a) {
    if (a === null || a === undefined || !isFinite(a)) return '—';
    var neg = a < 0; a = Math.abs(a);
    var whole = Math.floor(a / 100), frac = a % 100;
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s + (frac ? '.' + (frac < 10 ? '0' : '') + frac : '') + ' ₪';
  }
  // "3400" / "3,400.5" -> agorot integer; anything else -> null. No floats.
  function parseShekels(text) {
    var t = String(text == null ? '' : text).replace(/[,\s₪]/g, '');
    var m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return null;
    var frac = m[2] ? (m[2] + '0').slice(0, 2) : '00';
    return parseInt(m[1], 10) * 100 + parseInt(frac, 10);
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // One op id per (action, request, revision, payload): a retry after a timeout
  // reuses it (server replays), a different intent gets a new one.
  var ops = {};
  function opIdFor(sig) { return ops[sig] || (ops[sig] = uuid()); }
  function forgetOp(sig) { delete ops[sig]; }

  // ---- DOM helper (textContent only — never HTML strings) -----------------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    });
    [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  // ---- state -----------------------------------------------------------------
  var S = { onUnauthorized: function () {}, root: null, phase: 'loading', tab: 'requests', configured: true, catalog: null, requests: null, error: '',
    targets: function () { return []; }, notify: function () {}, onPending: function () {}, settings: function () { return {}; }, signedInName: '',
    filter: 'open', newForm: null, wa: {}, confirm: {}, openSettings: null };
  /* Offer forms embedded in a client card («💰 הצעת מחיר», app.js): hostEl -> { F, onDone }. The SAME
   * newRequestView renders there with the target locked; nothing is duplicated. */
  var embedded = [];
  // yyyy-mm-dd of today (+n days), local calendar (the server validates; display only)
  function isoPlus(n) { var d = new Date(); d.setDate(d.getDate() + (n || 0)); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  // 0XXXXXXXXX -> 972XXXXXXXXX for wa.me; '' when not an Israeli mobile/landline
  function waNumber(v) { var d = String(v == null ? '' : v).replace(/\D/g, ''); if (/^972\d{9}$/.test(d)) d = '0' + d.slice(3); return /^0\d{9}$/.test(d) ? '972' + d.slice(1) : ''; }

  function say(msg, isErr) { try { S.notify(msg, !!isErr); } catch (_) {} }

  // One fetch; a 401 that is NOT the catalog privilege means the base session is gone.
  async function rawCall(path, method, body) {
    var r = await fetch(path, { method: method || 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    if (r.status === 401 && !(j && j.error === 'admin_required')) { S.onUnauthorized(); throw new Error('unauthorized'); }
    if (!j) throw new Error('upstream_unavailable');
    return j;
  }
  /* The catalog privilege is a 15-minute server-side session. SINGLE-FLIGHT: however many callers ask at once
   * (two mounts during the first load, a click after the privilege expired), ONE status/login round-trip runs.
   * Two parallel logins would revoke each other (the server keeps one admin session per base session), every
   * following call would answer 401 and the screen would be redrawn under the user's hands (the 2026-11 "buttons
   * do nothing" report). Resolves true when the privilege is live. */
  var adminFlight = null;
  function ensureAdmin() {
    if (adminFlight) return adminFlight;
    adminFlight = (async function () {
      var st = await rawCall('/api/catalog-admin/status');
      S.configured = !!st.configured; S.eligible = !!st.eligible;
      if (st.admin) return true;
      // Vered's signed-in name is the authorization: no second code. The server decides; this only asks.
      if (!st.configured || !st.eligible) return false;
      var r = await rawCall('/api/catalog-admin/login', 'POST', {});
      return !!(r && r.ok);
    })().catch(function (e) { if (e.message === 'unauthorized') throw e; return false; })
      .finally(function () { adminFlight = null; });
    return adminFlight;
  }
  /* A privileged call. When the privilege has lapsed (admin_required) it is renewed ONCE and the same call is
   * retried, so the click that found an expired privilege still does its work instead of vanishing. */
  async function call(path, method, body, retried) {
    var j = await rawCall(path, method, body);
    if (j && j.error === 'admin_required' && !j.ok) {
      if (!retried && (await ensureAdmin())) return call(path, method, body, true);
      S.phase = 'gate'; S.catalog = null; S.requests = null; draw();
      throw new Error('admin_required');
    }
    return j;
  }
  function rpc(op, fields) { return call('/api/catalog-admin/rpc', 'POST', Object.assign({ op: op }, fields || {})); }

  // Single-flight too: a second mount while the first load is running joins it instead of starting another.
  var bootFlight = null;
  function boot() {
    if (bootFlight) return bootFlight;
    bootFlight = (async function () {
      var ok = false;
      try { ok = await ensureAdmin(); } catch (_) { ok = false; }
      S.phase = ok ? 'admin' : 'gate';
      if (ok) await loadAll();
      draw();
    })().finally(function () { bootFlight = null; });
    return bootFlight;
  }
  /* Loads catalog + requests. A failure is REPORTED (S.loadError, drawn with a retry button) — never shown as an
   * empty catalog / "no requests", which looked like dead buttons. */
  async function loadAll() {
    S.loadError = '';
    try {
      var res = await Promise.all([rpc('catalog'), rpc('list')]);
      S.catalog = res[0] && res[0].ok ? res[0] : null;
      S.requests = res[1] && res[1].ok ? res[1] : null;
      if (!S.catalog || !S.requests) S.loadError = errorText(((S.catalog ? res[1] : res[0]) || {}).error || 'upstream_unavailable');
      S.onPending(S.requests ? S.requests.counts.pending : 0);
    } catch (e) {
      if (e.message === 'unauthorized' || e.message === 'admin_required') return;
      S.catalog = null; S.requests = null; S.loadError = errorText(e.message);
    }
  }

  // ---- views -----------------------------------------------------------------
  function draw() {
    if (!S.root) return;
    while (S.root.firstChild) S.root.removeChild(S.root.firstChild);
    if (S.phase === 'loading') { S.root.appendChild(h('p', { class: 'muted', text: 'טוען…' })); return; }
    if (S.phase === 'gate') { S.root.appendChild(gateView()); return; }
    S.root.appendChild(adminView());
  }

  function gateView() {
    var text = !S.configured ? 'התמחור עדיין לא הוגדר בשרת. פני לסנדרה.'
      : (S.eligible ? 'לא ניתן לפתוח את התמחור כרגע. נסי לרענן או להיכנס מחדש.' : 'האזור הזה מיועד לורד בלבד.');
    return h('div', { class: 'pkg-gate card' }, [
      h('h2', { text: 'תמחור חבילות' }),
      h('p', { class: 'muted', text: text })
    ]);
  }

  function adminView() {
    var counts = S.requests ? S.requests.counts : { pending: 0, priced: 0 };
    var tabs = [['requests', 'בקשות' + (counts.pending ? ' (' + counts.pending + ')' : '')], ['calc', 'מחשבון'], ['catalog', 'קטלוג']];
    var bar = h('div', { class: 'pkg-tabs' }, tabs.map(function (t) {
      return h('button', { type: 'button', class: 'btn' + (S.tab === t[0] ? ' btn-primary' : ''), text: t[1], onclick: function () { S.tab = t[0]; draw(); } });
    }).concat([
      h('button', { type: 'button', class: 'btn', text: 'רענון', onclick: async function () { S.loading = true; draw(); await loadAll(); S.loading = false; draw(); } }),
      h('button', { type: 'button', class: 'btn', text: 'יציאה מתמחור', onclick: lock })
    ]));
    var body = S.loading ? h('p', { class: 'muted', text: 'טוען…' }) : S.tab === 'requests' ? requestsView() : S.tab === 'calc' ? calcView() : catalogView();
    var loadErr = S.loadError ? h('div', { class: 'pkg-msg pkg-load-error', role: 'alert' }, [
      'הנתונים לא נטענו: ' + S.loadError + ' ',
      h('button', { type: 'button', class: 'btn', text: 'נסי שוב', onclick: async function () { S.loading = true; draw(); await loadAll(); S.loading = false; draw(); } })
    ]) : null;
    return h('div', { class: 'pkg-admin' }, [bar, loadErr, S.error ? h('p', { class: 'pkg-msg', role: 'alert', text: S.error }) : null, body]);
  }

  async function lock() {
    try { await call('/api/catalog-admin/logout', 'POST', {}); } catch (_) {}
    S.catalog = null; S.requests = null; S.calc = null; S.phase = 'gate'; S.error = ''; S.loadError = ''; S.newForm = null; S.wa = {}; S.confirm = {}; ops = {}; draw();
  }

  function pkgName(key) {
    var it = S.catalog && S.catalog.items.filter(function (i) { return i.key === key; })[0];
    return it ? label(FAMILY, it.family) + ' — ' + label(TIER, it.tier) : key;
  }

  // -- requests --
  function crmOf(r) { return r.crmStatus || (r.status === 'priced' ? 'ready_to_send' : 'draft'); }
  function requestsView() {
    if (!S.requests) return h('p', { class: 'muted', text: 'רשימת הבקשות לא נטענה.' });
    var items = S.requests.items;
    var counts = {}; items.forEach(function (r) { var k = crmOf(r); counts[k] = (counts[k] || 0) + 1; });
    var openN = items.filter(function (r) { return ['approved', 'rejected', 'expired'].indexOf(crmOf(r)) < 0; }).length;
    var filters = [['open', 'פתוחות' + (openN ? ' (' + openN + ')' : '')], ['all', 'הכל (' + items.length + ')']].concat(CRM_ORDER.map(function (k) { return [k, CRM_STATUS[k] + (counts[k] ? ' (' + counts[k] + ')' : '')]; }));
    var bar = h('div', { class: 'pkg-row pkg-filters' }, [
      h('button', { type: 'button', class: 'btn btn-primary pkg-new-btn', text: '➕ הצעת מחיר חדשה', 'aria-expanded': S.newForm ? 'true' : 'false', onclick: function () { S.newForm = S.newForm ? null : newFormState(); S.error = ''; draw(); } })
    ].concat(filters.map(function (f) {
      return h('button', { type: 'button', class: 'btn btn-ghost pkg-chip' + (S.filter === f[0] ? ' pkg-chip-on' : ''), 'aria-pressed': S.filter === f[0] ? 'true' : 'false', text: f[1], onclick: function () { S.filter = f[0]; draw(); } });
    })));
    var shown = items.filter(function (r) {
      var k = crmOf(r);
      return S.filter === 'all' ? true : S.filter === 'open' ? ['approved', 'rejected', 'expired'].indexOf(k) < 0 : k === S.filter;
    });
    var kids = [bar];
    if (S.newForm) kids.push(newRequestView(S.newForm, function () { S.newForm = null; S.filter = 'open'; draw(); }));
    if (!items.length) kids.push(h('p', { class: 'muted', text: 'אין בקשות תמחור.' }));
    else if (!shown.length) kids.push(h('p', { class: 'muted', text: 'אין הצעות במצב הזה.' }));
    else kids.push(h('div', { class: 'pkg-list' }, shown.map(requestCard)));
    return h('div', {}, kids);
  }

  // ---- new offer (Vered): packages, single treatments or both; prices come back from the server only ----
  function newFormState(target, locked) {
    return { requestId: uuid(), target: target || '', locked: !!(target && locked), search: '', name: '', phone: '', items: [], pick: { key: '', months: '', tier: '', qty: 1, quote: null },
      custom: { title: '', qty: 1, price: '' }, overrideIdx: -1,
      validUntil: isoPlus(14), followUpDate: isoPlus(3), assignee: S.signedInName || 'ורד', notes: '', busy: false, closed: false };
  }
  function itemLabel(it) {
    if (it.custom) return String(it.title || 'פריט מותאם') + (it.qty > 1 ? ' × ' + it.qty : '');
    return pkgName(it.packageKey) + (it.months ? ' · ' + it.months + ' חודשים' : '') + (it.selectedMonthlyAgorot ? ' · ' + formatAgorot(it.selectedMonthlyAgorot) + ' לחודש' : '') + (it.qty > 1 ? ' × ' + it.qty : '');
  }
  /* Display rule only (the server decides): custom lines / manual overrides are offered to ורד. */
  var PRICE_OVERRIDE_USERS = ['ורד'];
  function canOverridePrices() { return PRICE_OVERRIDE_USERS.indexOf(S.signedInName) >= 0; }
  function lineUnit(it) { return it.custom ? it.unitAgorot : (it.overrideUnitAgorot !== undefined ? it.overrideUnitAgorot : it.unitGross); }
  /* Browser ESTIMATE of the form's lines (18% VAT-inclusive split, integer agorot). Never sent: the server recomputes. */
  var VAT_BP_DISPLAY = 1800;
  function estimateTotals(items) {
    var gross = (items || []).reduce(function (a, it) { return a + lineUnit(it) * it.qty; }, 0);
    var denom = 10000 + VAT_BP_DISPLAY, net = Math.floor((gross * 10000 + Math.floor(denom / 2)) / denom);
    return { gross: gross, net: net, vat: gross - net };
  }
  /* ONE form implementation: the pricing tab («➕ הצעת מחיר חדשה») and the client card («💰 הצעת מחיר», target
   * locked) both render it. `done(created)` runs when the form closes (created = the server's request, or null). */
  function newRequestView(F, done) {
    var box = h('div', { class: 'pkg-new card' + (F.locked ? ' pkg-new-embedded' : '') });
    var active = S.catalog ? S.catalog.items.filter(function (i) { return i.active; }) : [];
    var targets = S.targets() || [];
    function paint() {
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(h('h3', { text: 'הצעת מחיר חדשה' }));
      // who — a large full-width searchable picker (name or phone), then the unregistered-client row beneath
      box.appendChild(h('div', { class: 'pkg-fam pkg-who' }, [h('div', { class: 'pkg-fam-title', text: 'למי ההצעה' }), whoPicker(F, targets, paint)]));
      // items picker (same visible-buttons pattern as the calculator)
      var P = F.pick;
      var order = [], byFam = {};
      active.forEach(function (i) { if (!byFam[i.family]) { byFam[i.family] = []; order.push(i.family); } byFam[i.family].push(i); });
      var pickBox = h('div', { class: 'pkg-pick' });
      order.forEach(function (fam) {
        pickBox.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: label(FAMILY, fam) }),
          chips(byFam[fam].map(function (i) { return { value: i.key, text: label(TIER, i.tier) }; }), P.key, function (key) {
            var it = active.filter(function (x) { return x.key === key; })[0];
            P.key = key; P.tier = ''; P.quote = null; P.months = it && it.allowedMonths.length ? String(it.allowedMonths[0]) : ''; preview();
          }, label(FAMILY, fam))]));
      });
      var cur = active.filter(function (x) { return x.key === P.key; })[0] || null;
      if (cur && cur.allowedMonths.length > 1) pickBox.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: 'משך (חודשים)' }), chips(cur.allowedMonths.map(function (m) { return { value: String(m), text: m + ' חודשים' }; }), P.months, function (v) { P.months = v; preview(); }, 'משך')]));
      if (cur && cur.unit === 'per_month_range') pickBox.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: 'מדרגת מחיר חודשי' }), chips(rangeTiers(cur).map(function (t) { return { value: String(t.agorot), text: t.text + ' · ' + formatAgorot(t.agorot) }; }), P.tier, function (v) { P.tier = v; preview(); }, 'מדרגת מחיר חודשי')]));
      var qtyIn = h('input', { type: 'number', min: '1', max: '20', value: String(P.qty), 'aria-label': 'כמות', class: 'pkg-qty', onchange: function () { P.qty = parseInt(qtyIn.value, 10) || 1; } });
      var qtxt = !cur ? 'בחרי פריט מהקטלוג (חבילה או טיפול בודד).' : P.quote === null ? '…' : !P.quote.ok ? errorText(P.quote.error) : (P.quote.quote.needsSelection ? 'יש לבחור מדרגת מחיר (מינימום / אמצע / מקסימום).' : 'מחיר ליחידה: ' + formatAgorot(P.quote.quote.grossAgorot) + ' כולל מע״מ');
      pickBox.appendChild(h('div', { class: 'pkg-row' }, [h('span', { class: 'muted', text: 'כמות' }), qtyIn,
        h('button', { type: 'button', class: 'btn', text: '➕ הוספה להצעה', disabled: cur && P.quote && P.quote.ok && !P.quote.quote.needsSelection ? false : 'disabled', onclick: function () {
          F.items.push({ packageKey: cur.key, months: cur.allowedMonths.length ? parseInt(P.months, 10) : undefined, selectedMonthlyAgorot: cur.unit === 'per_month_range' ? parseInt(P.tier, 10) : undefined, qty: P.qty, unitGross: P.quote.quote.grossAgorot });
          P.key = ''; P.tier = ''; P.months = ''; P.qty = 1; P.quote = null; paint();
        } }),
        h('span', { class: 'muted pkg-pick-quote', 'aria-live': 'polite', text: qtxt })]));
      // custom line (ורד only — the server refuses anyone else): a treatment that is not in the catalog
      if (canOverridePrices()) {
        var C = F.custom;
        var cTitle = h('input', { type: 'text', maxlength: '120', placeholder: 'שם הטיפול (לא בקטלוג)', 'aria-label': 'שם טיפול מותאם', value: C.title, oninput: function () { C.title = cTitle.value; } });
        var cQty = h('input', { type: 'number', min: '1', max: '20', value: String(C.qty), 'aria-label': 'כמות (פריט מותאם)', class: 'pkg-qty pkg-custom-qty', onchange: function () { C.qty = parseInt(cQty.value, 10) || 1; } });
        var cPrice = h('input', { type: 'text', inputmode: 'decimal', maxlength: '10', placeholder: 'מחיר ליחידה ₪ (כולל מע״מ)', 'aria-label': 'מחיר ליחידה (פריט מותאם)', value: C.price, oninput: function () { C.price = cPrice.value; } });
        pickBox.appendChild(h('div', { class: 'pkg-fam pkg-custom' }, [h('div', { class: 'pkg-fam-title', text: 'פריט מותאם (לא בקטלוג) — ורד בלבד' }),
          h('div', { class: 'pkg-row' }, [cTitle, h('span', { class: 'muted', text: 'כמות' }), cQty, cPrice,
            h('button', { type: 'button', class: 'btn pkg-custom-add', text: '➕ הוספת פריט מותאם', onclick: function () {
              var agorot = parseShekels(C.price);
              if (C.title.trim().length < 2) { say(errorText('invalid_custom_item'), true); return; }
              if (agorot === null || agorot < 1) { say(errorText('invalid_amount'), true); return; }
              F.items.push({ custom: true, title: C.title.trim(), qty: C.qty, unitAgorot: agorot, unitGross: agorot });
              F.custom = { title: '', qty: 1, price: '' }; paint();
            } })])]));
      }
      box.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: 'פריטים' }), pickBox]));
      // chosen items — each line: label, catalog price (struck through when overridden), effective line sum, ✏️ / ✕
      var est = estimateTotals(F.items);
      box.appendChild(h('div', { class: 'pkg-items' }, F.items.length ? F.items.map(function (it, idx) {
        var unit = lineUnit(it), overridden = !it.custom && it.overrideUnitAgorot !== undefined;
        var kids = [h('span', { class: 'pkg-item-label' }, [h('span', { text: itemLabel(it) }), it.custom ? h('span', { class: 'chip pkg-chip-custom', text: 'מותאם' }) : null,
          overridden ? h('span', { class: 'muted pkg-item-why', text: ' — ' + it.overrideReason }) : null]),
          h('span', { class: 'pkg-item-sum' }, [overridden ? h('s', { class: 'pkg-item-catalog', text: formatAgorot(it.unitGross * it.qty) }) : null, h('span', { text: formatAgorot(unit * it.qty) })])];
        if (canOverridePrices() && !it.custom) kids.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm pkg-override-btn', text: '✏️ מחיר ידני', 'aria-label': 'מחיר ידני לפריט', 'aria-expanded': F.overrideIdx === idx ? 'true' : 'false', onclick: function () { F.overrideIdx = F.overrideIdx === idx ? -1 : idx; paint(); } }));
        kids.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '✕', 'aria-label': 'הסרת פריט', onclick: function () { F.items.splice(idx, 1); F.overrideIdx = -1; paint(); } }));
        var row = h('div', { class: 'pkg-item-row' + (overridden ? ' pkg-item-overridden' : '') }, kids);
        if (F.overrideIdx !== idx || it.custom) return row;
        // inline override editor: new unit price + mandatory reason (server rejects a missing reason with 400)
        var oPrice = h('input', { type: 'text', inputmode: 'decimal', maxlength: '10', placeholder: 'מחיר ליחידה ₪ (כולל מע״מ)', 'aria-label': 'מחיר ידני ליחידה', value: it.overrideUnitAgorot !== undefined ? String(it.overrideUnitAgorot / 100) : '' });
        var oWhy = h('input', { type: 'text', maxlength: '200', placeholder: 'סיבה (חובה) — הנחה / מחיר חבילה', 'aria-label': 'סיבת המחיר הידני', value: it.overrideReason || '' });
        return h('div', { class: 'pkg-item-wrap' }, [row, h('div', { class: 'pkg-row pkg-override' }, [h('span', { class: 'muted', text: 'מחיר קטלוג ליחידה ' + formatAgorot(it.unitGross) }), oPrice, oWhy,
          h('button', { type: 'button', class: 'btn btn-primary btn-sm pkg-override-save', text: 'אישור מחיר ידני', onclick: function () {
            var agorot = parseShekels(oPrice.value);
            if (agorot === null) { say(errorText('invalid_amount'), true); return; }
            if (oWhy.value.trim().length < 2) { say(errorText('reason_required'), true); return; }
            it.overrideUnitAgorot = agorot; it.overrideReason = oWhy.value.trim(); F.overrideIdx = -1; paint();
          } }),
          it.overrideUnitAgorot !== undefined ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'חזרה למחיר קטלוג', onclick: function () { delete it.overrideUnitAgorot; delete it.overrideReason; F.overrideIdx = -1; paint(); } }) : null])]);
      }).concat([h('div', { class: 'pkg-total' }, [h('div', { text: 'סה״כ משוער (כולל מע״מ): ' + formatAgorot(est.gross) + ' — המחיר הסופי מחושב בשרת' }),
        h('div', { class: 'muted pkg-total-split', text: 'לפני מע״מ ' + formatAgorot(est.net) + ' · מע״מ 18% ' + formatAgorot(est.vat) + ' · סה״כ ' + formatAgorot(est.gross) })])]) : [h('p', { class: 'muted', text: 'עדיין אין פריטים.' })]));
      // terms
      var vu = h('input', { type: 'date', value: F.validUntil, 'aria-label': 'תוקף ההצעה', onchange: function () { F.validUntil = vu.value; } });
      var fu = h('input', { type: 'date', value: F.followUpDate, 'aria-label': 'מועד מעקב', onchange: function () { F.followUpDate = fu.value; } });
      var asg = h('select', { 'aria-label': 'אחראי/ת', onchange: function () { F.assignee = asg.value; } }, ASSIGNEES.map(function (n) { return h('option', { value: n, text: n, selected: n === F.assignee ? 'selected' : false }); }));
      var notes = h('input', { type: 'text', maxlength: '500', placeholder: 'הערות (ללא פרטים רפואיים)', 'aria-label': 'הערות', value: F.notes, oninput: function () { F.notes = notes.value; } });
      box.appendChild(h('div', { class: 'pkg-row pkg-terms' }, [h('label', { class: 'pkg-lbl' }, ['תוקף עד ', vu]), h('label', { class: 'pkg-lbl' }, ['מעקב ב-', fu]), h('label', { class: 'pkg-lbl' }, ['אחראי/ת ', asg]), notes]));
      box.appendChild(h('div', { class: 'pkg-row' }, [
        h('button', { type: 'button', class: 'btn btn-primary pkg-create-btn', text: F.busy ? 'יוצרת…' : 'יצירת הצעה (טיוטה)', disabled: F.busy ? 'disabled' : false, onclick: create }),
        h('button', { type: 'button', class: 'btn btn-ghost', text: 'ביטול', onclick: function () { F.closed = true; done(null); } }),
        h('span', { class: 'muted', text: 'ההצעה נוצרת כטיוטה; אישור התמחור הופך אותה ל«מוכנה לשליחה». אין חיוב ואין תשלום.' })
      ]));
    }
    async function preview() {
      var P = F.pick, cur = active.filter(function (x) { return x.key === P.key; })[0];
      paint();
      if (!cur) return;
      var f = { packageKey: cur.key };
      if (cur.allowedMonths.length) f.months = parseInt(P.months, 10);
      if (cur.unit === 'per_month_range' && P.tier) f.selectedMonthlyAgorot = parseInt(P.tier, 10);
      var res = await rpc('quote', f).catch(function (e) { return { ok: false, error: e.message }; });
      if (F.closed || F.pick.key !== cur.key) return;
      P.quote = res; paint();
    }
    async function create() {
      if (F.busy) return; // double click = one request (and the same requestId would be replayed anyway)
      if (!F.items.length) { say(errorText('items_required'), true); return; }
      if (!F.target && F.name.trim().length < 2) { say(errorText('invalid_patient'), true); return; }
      F.busy = true; paint();
      // lines only — no total ever travels (the server derives before-VAT / VAT / total from the lines it priced)
      var body = { requestId: F.requestId, items: F.items.map(function (it) {
        if (it.custom) return { custom: true, title: it.title, qty: it.qty, unitAgorot: it.unitAgorot };
        var line = { packageKey: it.packageKey, months: it.months, selectedMonthlyAgorot: it.selectedMonthlyAgorot, qty: it.qty };
        if (it.overrideUnitAgorot !== undefined) { line.overrideUnitAgorot = it.overrideUnitAgorot; line.overrideReason = it.overrideReason; }
        return line;
      }),
        validUntil: F.validUntil, followUpDate: F.followUpDate, assignee: F.assignee, notes: F.notes.trim() };
      if (F.target) {
        var v = F.target.split(':'); body.targetType = v[0]; body.targetId = v.slice(1).join(':');
        // a roster (admitted) patient lives in the Dashboard: this source cannot look the name / phone up, so the
        // picked roster values travel with the request (the server still validates the phone shape)
        var picked = targets.filter(function (t) { return t.type + ':' + t.id === F.target; })[0];
        if (picked && v[0] === 'roster') { body.patientName = picked.name || ''; body.patientPhone = picked.phone || ''; }
      } else { body.patientName = F.name.trim(); body.patientPhone = F.phone.trim(); }
      var res = await rpc('createRequest', body).catch(function (e) { return { ok: false, error: e.message }; });
      if (res.ok) { say(res.duplicate ? 'ההצעה כבר נוצרה' : 'ההצעה נוצרה כטיוטה'); F.closed = true; await loadAll(); done(res.request || null); return; }
      F.busy = false; S.error = errorText(res.error); say(S.error, true); paint();
    }
    paint();
    return box;
  }

  // ---- target picker: type a name or a phone, pick from the matches (name · phone · house/type) ----
  function targetText(t) { return label(TARGET_HE, t.type) + (t.sub ? ' · ' + t.sub : ''); }
  function whoPicker(F, targets, repaint) {
    var picked = F.target ? targets.filter(function (t) { return t.type + ':' + t.id === F.target; })[0] : null;
    var wrap = h('div', { class: 'pkg-who-box' });
    if (picked) {
      wrap.appendChild(h('div', { class: 'pkg-who-picked' + (F.locked ? ' pkg-who-locked' : ''), 'data-target': F.target }, [
        h('span', { class: 'pkg-who-name', text: picked.name || '—' }),
        h('span', { class: 'muted', text: [picked.phone, targetText(picked)].filter(Boolean).join(' · ') }),
        // from a client card the target is fixed: no «החלפה»
        F.locked ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '✕ החלפה', 'aria-label': 'ביטול הבחירה', onclick: function () { F.target = ''; F.search = ''; repaint(); } })
      ]));
      return wrap;
    }
    var list = h('div', { class: 'pkg-who-list', role: 'listbox', 'aria-label': 'תוצאות חיפוש' });
    var input = h('input', { type: 'search', class: 'pkg-who-input', autocomplete: 'off', maxlength: '60', placeholder: 'חיפוש מטופל, מאושפז או ליד פתוח — שם או טלפון…', 'aria-label': 'חיפוש מטופל / מאושפז / ליד', value: F.search || '',
      oninput: function () { F.search = input.value; fill(); } });
    function fill() {
      while (list.firstChild) list.removeChild(list.firstChild);
      var q = String(F.search || '').trim();
      if (q.length < 2) { list.hidden = true; return; }
      // ONE search field, three sources with section headers: מטופלים · מאושפזים · לידים פתוחים
      var groups = matchTargetsGrouped(targets, q, 6);
      list.hidden = false;
      if (!groups.length) { list.appendChild(h('div', { class: 'muted pkg-who-none', text: 'לא נמצא — אפשר להזין שם וטלפון למטה (לקוח שאינו במערכת)' })); return; }
      groups.forEach(function (g) {
        list.appendChild(h('div', { class: 'pkg-who-section', role: 'presentation', 'data-section': g.type, text: g.label + ' (' + g.total + ')' }));
        g.items.forEach(function (t) {
          list.appendChild(h('button', { type: 'button', role: 'option', class: 'pkg-who-opt pkg-who-opt-' + t.type, 'data-target': t.type + ':' + t.id, onclick: function () { F.target = t.type + ':' + t.id; F.search = ''; repaint(); } }, [
            h('span', { class: 'pkg-who-name', text: t.name || '—' }),
            h('span', { class: 'muted', text: [t.phone, targetText(t)].filter(Boolean).join(' · ') })
          ]));
        });
      });
    }
    fill();
    wrap.appendChild(input); wrap.appendChild(list);
    var nameIn = h('input', { type: 'text', maxlength: '120', placeholder: 'שם לקוח לא רשום', 'aria-label': 'שם הלקוח', value: F.name, oninput: function () { F.name = nameIn.value; } });
    var phoneIn = h('input', { type: 'tel', maxlength: '20', placeholder: 'טלפון 05X-XXXXXXX', 'aria-label': 'טלפון הלקוח', value: F.phone, oninput: function () { F.phone = phoneIn.value; } });
    wrap.appendChild(h('div', { class: 'pkg-who-manual' }, [h('span', { class: 'muted pkg-who-or', text: 'או לקוח שאינו במערכת (פנייה חד-פעמית בלבד):' }), nameIn, phoneIn]));
    return wrap;
  }
  /* Pure: the matches of ONE query grouped by source, in the fixed section order (clients, roster, leads), each
   * capped at `perType`; a section with no match is omitted. `total` is the uncapped count of that section. */
  function matchTargetsGrouped(targets, query, perType) {
    var all = matchTargets(targets, query, Infinity);
    return TARGET_SECTIONS.map(function (sec) {
      var items = all.filter(function (t) { return t.type === sec[0]; });
      return { type: sec[0], label: sec[1], total: items.length, items: items.slice(0, perType || 6) };
    }).filter(function (g) { return g.items.length; });
  }
  /* Pure: targets matching a typed name (case-insensitive substring) or phone (digits, 3+). Clients before leads, then by name. */
  function matchTargets(targets, query, limit) {
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    var digits = q.replace(/\D/g, '');
    var byPhone = digits.length >= 3 && /^[\d\s\-+()]+$/.test(q);
    var out = (targets || []).filter(function (t) {
      if (!t) return false;
      if (byPhone) return String(t.phone || '').replace(/\D/g, '').indexOf(digits) >= 0;
      return String(t.name || '').toLowerCase().indexOf(q) >= 0;
    });
    var rank = { client: 0, roster: 1, lead: 2 };
    out.sort(function (a, b) { return ((rank[a.type] === undefined ? 9 : rank[a.type]) - (rank[b.type] === undefined ? 9 : rank[b.type])) || String(a.name || '').localeCompare(String(b.name || ''), 'he'); });
    return limit === Infinity ? out : out.slice(0, limit || 8);
  }

  function requestCard(r) {
    var q = r.quote || {};
    var monthly = q.monthlyAgorot, total = r.effectiveTotalAgorot;
    var priceLines = [];
    if (r.needsSelection && r.selectedMonthlyAgorot === null) priceLines.push(h('div', { class: 'chip warn', text: 'נדרשת בחירת מחיר חודשי' }));
    else {
      if (monthly !== null && monthly !== undefined) priceLines.push(h('div', { text: 'מחיר חודשי: ' + formatAgorot(monthly) }));
      priceLines.push(h('div', { text: (q.commitmentMonths ? 'סה״כ ל-' + q.commitmentMonths + ' חודשים' : 'סה״כ') + ': ' + formatAgorot(total) + (r.adjustedTotalAgorot !== null ? ' (מתואם)' : '') }));
      if (q.netAgorot !== null && q.netAgorot !== undefined && r.adjustedTotalAgorot === null)
        priceLines.push(h('div', { class: 'muted', text: 'לפני מע״מ ' + formatAgorot(q.netAgorot) + ' · מע״מ ' + formatAgorot(q.vatAgorot) + ' (מחיר כולל מע״מ)' }));
    }
    if (r.status === 'priced') priceLines.push(h('div', { class: 'pkg-approved', text: 'אושר: ' + formatAgorot(r.approvedTotalAgorot) + ' — טרם שולם' }));
    var crm = crmOf(r);
    var items = Array.isArray(r.items) && r.items.length ? r.items : null;
    var kids = [
      h('div', { class: 'pkg-head' }, [
        h('strong', { text: r.patientName }), h('span', { class: 'chip pkg-st pkg-st-' + crm, text: label(CRM_STATUS, crm) }),
        h('span', { class: 'muted', text: 'מבקש/ת: ' + label(REQUESTER, r.requesterKey) + (r.patientPhone ? ' · ' + r.patientPhone : '') + (r.assignee ? ' · אחראי/ת: ' + r.assignee : '') })
      ])
    ];
    if (items && (items.length > 1 || items[0].qty > 1 || items[0].custom || items[0].overrideReason)) kids.push(h('ul', { class: 'pkg-items-list' }, items.map(function (it) {
      var overridden = !it.custom && it.catalogUnitAgorot != null && it.grossAgorot != null && it.catalogUnitAgorot !== it.grossAgorot;
      return h('li', { class: overridden ? 'pkg-item-overridden' : (it.custom ? 'pkg-item-custom' : '') }, [
        h('span', { text: itemLabel({ custom: !!it.custom, title: it.title, packageKey: it.packageKey || it.key, months: it.months, selectedMonthlyAgorot: it.selectedMonthlyAgorot, qty: it.qty || 1 }) + ' — ' }),
        overridden ? h('s', { class: 'pkg-item-catalog', text: formatAgorot(it.catalogUnitAgorot * (it.qty || 1)) }) : null,
        overridden ? ' ' : null,
        h('span', { text: it.lineGrossAgorot != null ? formatAgorot(it.lineGrossAgorot) : '' }),
        it.custom ? h('span', { class: 'chip pkg-chip-custom', text: 'מותאם' }) : null,
        it.overrideReason ? h('span', { class: 'muted', text: ' · ' + it.overrideReason }) : null]);
    })));
    else kids.push(h('div', { text: pkgName(r.packageKey) + (r.months ? ' · ' + r.months + ' חודשים' : '') }));
    kids.push(h('div', { class: 'pkg-price' }, priceLines));
    var terms = [];
    if (r.validUntil) terms.push('תוקף עד ' + fmtDay(r.validUntil));
    if (r.followUpDate) terms.push('מעקב ב-' + fmtDay(r.followUpDate));
    if (r.sentAt) terms.push('נשלחה ' + fmtDay(r.sentAt) + (r.sentTo ? (r.sentTo === 'oren' ? ' לאורן' : ' ל-' + r.sentTo) : ''));
    if (r.decisionAt) terms.push('החלטה ' + fmtDay(r.decisionAt));
    if (r.attachedType) terms.push('משויך ל' + label(TARGET_HE, r.attachedType) + ' (מזהה ' + r.attachedId + ')');
    if (terms.length) kids.push(h('div', { class: 'muted pkg-terms-line', text: terms.join(' · ') }));
    if (r.notes) kids.push(h('div', { class: 'muted', text: 'הערות: ' + r.notes }));
    if (r.adjustLog && r.adjustLog.length) kids.push(h('ul', { class: 'pkg-log muted' }, r.adjustLog.map(function (e) {
      var what = e.kind === 'select' ? 'נבחר מחיר חודשי ' + formatAgorot(e.to)
        : e.kind === 'override' ? 'מחיר ידני ל' + pkgName(e.item) + ': ' + formatAgorot(e.from) + ' → ' + formatAgorot(e.to) + ' ליחידה'
        : e.kind === 'custom' ? 'פריט מותאם «' + String(e.item || '') + '» ' + formatAgorot(e.to) + ' ליחידה' + (e.qty > 1 ? ' × ' + e.qty : '')
        : 'תואם מ-' + formatAgorot(e.from) + ' ל-' + formatAgorot(e.to);
      return h('li', { text: what + (e.reason ? ' — ' + e.reason : '') + ' (' + e.by + (e.at ? ' · ' + fmtDay(e.at) : '') + ')' });
    })));
    if (crm === 'draft') kids.push(pendingControls(r));
    if (crm !== 'draft' && !r.attachedType && ['approved', 'rejected', 'expired'].indexOf(crm) < 0) kids.push(attachControls(r));
    if (crm !== 'draft') kids.push(crmControls(r, crm));
    if (S.wa[r.id]) kids.push(whatsappPanel(r));
    return h('div', { class: 'pkg-card card pkg-crm-' + crm, 'data-request-id': r.id }, kids);
  }
  // ---- offer CRM actions (ready_to_send → sent → awaiting_decision → approved | rejected; expired = extend) ----
  function crmControls(r, crm) {
    var box = [];
    var fu = h('input', { type: 'date', value: r.followUpDate || '', 'aria-label': 'מועד מעקב' });
    var saveFu = h('button', { type: 'button', class: 'btn btn-sm', text: 'עדכון מעקב', onclick: function () { mutate('setStatus', r, { followUpDate: fu.value }, 'מועד המעקב עודכן'); } });
    if (crm === 'ready_to_send' || crm === 'sent' || crm === 'awaiting_decision') {
      box.push(h('button', { type: 'button', class: 'btn', text: '💬 הכן הודעת WhatsApp', 'aria-expanded': S.wa[r.id] ? 'true' : 'false', onclick: function () { S.wa[r.id] = S.wa[r.id] ? null : { to: '', custom: '', followUp: r.followUpDate || isoPlus(3) }; draw(); } }));
    }
    if (crm === 'ready_to_send') box.push(h('button', { type: 'button', class: 'btn btn-primary', text: '✔ סמן כנשלחה', onclick: function () { S.wa[r.id] = S.wa[r.id] || { to: '', custom: '', followUp: r.followUpDate || isoPlus(3) }; S.wa[r.id].confirm = true; draw(); } }));
    if (crm === 'sent') box.push(h('button', { type: 'button', class: 'btn', text: '⏳ ממתינה להחלטה', onclick: function () { mutate('setStatus', r, { status: 'awaiting_decision' }, 'סומן: ממתינה להחלטה'); } }));
    if (crm === 'sent' || crm === 'awaiting_decision') {
      box.push(h('button', { type: 'button', class: 'btn btn-primary', text: '✅ הלקוח אישר', title: 'אישור ההצעה בלבד — ללא חיוב, תשלום או חידוש', onclick: function () { if (confirm('לסמן שהלקוח אישר את ההצעה? (אין חיוב ואין תשלום — הגבייה נעשית בכרטיס המטופל)')) mutate('setStatus', r, { status: 'approved' }, 'ההצעה אושרה — ללא חיוב'); } }));
    }
    if (['ready_to_send', 'sent', 'awaiting_decision'].indexOf(crm) >= 0) {
      box.push(h('button', { type: 'button', class: 'btn btn-danger', text: '✕ נדחתה', onclick: function () { if (confirm('לסמן את ההצעה כנדחתה?')) mutate('setStatus', r, { status: 'rejected' }, 'ההצעה סומנה כנדחתה'); } }));
      box.push(h('span', { class: 'pkg-row pkg-fu' }, [fu, saveFu]));
    }
    if (crm === 'expired') {
      var vu = h('input', { type: 'date', value: isoPlus(14), 'aria-label': 'תוקף חדש' });
      box.push(h('span', { class: 'pkg-row pkg-fu' }, [h('span', { class: 'muted', text: 'הארכת תוקף עד' }), vu, h('button', { type: 'button', class: 'btn btn-sm', text: 'הארכה', onclick: function () { mutate('setStatus', r, { validUntil: vu.value }, 'התוקף הוארך'); } })]));
    }
    if (!box.length) return null;
    return h('div', { class: 'pkg-controls pkg-crm-actions' }, [h('div', { class: 'pkg-row' }, box)]);
  }

  // ---- WhatsApp: a message PREPARED for a human to send from the device's connected WhatsApp account.
  // wa.me cannot choose the sending number, nothing is sent automatically, and opening WhatsApp never
  // changes the status — only «סמן כנשלחה» does, recording when / to whom / follow-up. No medical details.
  function offerMessage(r) {
    var items = Array.isArray(r.items) && r.items.length ? r.items : [{ packageKey: r.packageKey, months: r.months, qty: 1 }];
    var lines = ['שלום ' + (r.patientName || '') + ',', 'להלן הצעת המחיר מ-E-ZONE לטיפולי חוץ:'];
    items.forEach(function (it) { lines.push('• ' + itemLabel({ custom: !!it.custom, title: it.title, packageKey: it.packageKey || it.key, months: it.months, selectedMonthlyAgorot: it.selectedMonthlyAgorot, qty: it.qty || 1 })); });
    var total = r.approvedTotalAgorot !== null && r.approvedTotalAgorot !== undefined ? r.approvedTotalAgorot : r.effectiveTotalAgorot;
    if (total !== null && total !== undefined) lines.push('סה״כ: ' + formatAgorot(total) + ' (כולל מע״מ)');
    if (r.validUntil) lines.push('ההצעה בתוקף עד ' + fmtDay(r.validUntil) + '.');
    lines.push('נשמח לעמוד לרשותך לכל שאלה.', 'צוות E-ZONE');
    return lines.join('\n');
  }
  function whatsappPanel(r) {
    var W = S.wa[r.id];
    var orenNum = waNumber((S.settings() || {}).orenWhatsapp);
    var toSel = h('select', { 'aria-label': 'יעד ההודעה', onchange: function () { W.to = toSel.value; draw(); } }, [
      h('option', { value: '', text: 'בחרי יעד…' }),
      h('option', { value: 'oren', text: 'אורן' + (orenNum ? '' : ' (מספר לא הוגדר בהגדרות)'), disabled: orenNum ? false : 'disabled', selected: W.to === 'oren' ? 'selected' : false }),
      h('option', { value: 'custom', text: 'מספר אחר…', selected: W.to === 'custom' ? 'selected' : false })
    ]);
    var custom = h('input', { type: 'tel', placeholder: '05X-XXXXXXX', 'aria-label': 'מספר טלפון ליעד', value: W.custom || '', oninput: function () { W.custom = custom.value; } });
    var msg = h('textarea', { rows: '7', 'aria-label': 'נוסח ההודעה', class: 'pkg-wa-text' }); msg.value = W.text || offerMessage(r);
    msg.addEventListener('input', function () { W.text = msg.value; });
    var fu = h('input', { type: 'date', value: W.followUp || '', 'aria-label': 'מועד מעקב אחרי השליחה', onchange: function () { W.followUp = fu.value; } });
    function targetNumber() { return W.to === 'oren' ? orenNum : W.to === 'custom' ? waNumber(custom.value) : ''; }
    return h('div', { class: 'pkg-wa card' }, [
      h('div', { class: 'pkg-fam-title', text: 'הודעת WhatsApp — לאישור אנושי' }),
      h('div', { class: 'pkg-row' }, [toSel, W.to === 'custom' ? custom : null]),
      msg,
      h('p', { class: 'muted', text: 'ההודעה תיפתח ב-WhatsApp מחשבון ה-WhatsApp המחובר במכשיר זה (לא ניתן לבחור מספר שולח). פתיחת WhatsApp אינה מסמנת את ההצעה כנשלחה.' }),
      h('div', { class: 'pkg-row' }, [
        h('label', { class: 'pkg-lbl' }, ['מעקב ב-', fu]),
        h('button', { type: 'button', class: 'btn', text: '📲 פתיחת WhatsApp', onclick: function () {
          var n = targetNumber(); if (!n) { say(errorText('invalid_recipient'), true); return; }
          window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(msg.value), '_blank', 'noopener');
        } }),
        h('button', { type: 'button', class: 'btn btn-primary', text: '✔ סמן כנשלחה', onclick: function () {
          var n = targetNumber(); if (!n) { say(errorText('invalid_recipient'), true); return; }
          if (!fu.value) { say('יש לקבוע מועד מעקב', true); return; }
          var fields = { status: 'sent', sentTo: W.to === 'oren' ? 'oren' : ('0' + n.slice(3)), followUpDate: fu.value };
          if (crmOf(r) !== 'ready_to_send') { mutate('setStatus', r, { followUpDate: fu.value }, 'מועד המעקב עודכן'); return; }
          delete S.wa[r.id];
          mutate('setStatus', r, fields, 'ההצעה סומנה כנשלחה — המעקב נקבע ל-' + fmtDay(fu.value));
        } }),
        h('button', { type: 'button', class: 'btn btn-ghost', text: 'סגירה', onclick: function () { delete S.wa[r.id]; draw(); } })
      ])
    ]);
  }

  async function mutate(op, r, fields, okMsg) {
    var sig = op + '|' + r.id + '|' + r.revision + '|' + JSON.stringify(fields);
    S.error = '';
    try {
      var res = await rpc(op, Object.assign({ requestId: r.id, opId: opIdFor(sig), expectedRevision: r.revision }, fields));
      if (res.ok) { forgetOp(sig); say(okMsg || 'נשמר'); await loadAll(); draw(); return; }
      if (res.error === 'revision_conflict') { forgetOp(sig); await loadAll(); }
      S.error = errorText(res.error); say(S.error, true); draw();
    } catch (e) { if (e.message !== 'unauthorized') { S.error = errorText(e.message); say(S.error, true); draw(); } }
  }

  // Range items (Solo): Vered picks one of three fixed tiers — minimum, midpoint, maximum (whole agorot, midpoint rounded down).
  function rangeTiers(item) {
    var lo = item && item.priceMinAgorot, hi = item && item.priceMaxAgorot;
    if (!(lo > 0) || !(hi >= lo)) return [];
    var mid = Math.floor((lo + hi) / 2);
    var out = [{ id: 'min', text: 'מינימום', agorot: lo }, { id: 'mid', text: 'אמצע', agorot: mid }, { id: 'max', text: 'מקסימום', agorot: hi }];
    return out.filter(function (t, i) { return i === 0 || t.agorot !== out[i - 1].agorot; });
  }
  function tierSelect(item, aria) {
    return h('select', { 'aria-label': aria }, [h('option', { value: '', text: 'בחירת מדרגת מחיר…' })].concat(rangeTiers(item).map(function (t) {
      return h('option', { value: String(t.agorot), text: t.text + ' · ' + formatAgorot(t.agorot) });
    })));
  }

  function pendingControls(r) {
    var box = [];
    if (r.needsSelection) {
      var item = S.catalog && S.catalog.items.filter(function (i) { return i.key === r.packageKey && i.active; })[0];
      var sel = tierSelect(item, 'מדרגת מחיר חודשי');
      box.push(h('div', { class: 'pkg-row' }, [sel, h('button', { type: 'button', class: 'btn', text: 'בחירת מחיר חודשי', onclick: function () {
        var a = parseInt(sel.value, 10); if (!(a > 0)) { say('יש לבחור מדרגת מחיר', true); return; }
        mutate('adjust', r, { selectedMonthlyAgorot: a }, 'המחיר נבחר');
      } })]));
    } else {
      var amt = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'סכום מתואם ב-₪', 'aria-label': 'סכום מתואם' });
      var why = h('input', { type: 'text', maxlength: '200', placeholder: 'סיבה (חובה)', 'aria-label': 'סיבת התאמה' });
      box.push(h('div', { class: 'pkg-row' }, [amt, why, h('button', { type: 'button', class: 'btn', text: 'התאמת סכום', onclick: function () {
        var a = parseShekels(amt.value); if (a === null) { say('סכום לא תקין', true); return; }
        if (why.value.trim().length < 2) { say('חובה לרשום סיבה', true); return; }
        mutate('adjust', r, { adjustedTotalAgorot: a, reason: why.value.trim() }, 'הסכום הותאם');
      } })]));
    }
    var canApprove = !(r.needsSelection && r.selectedMonthlyAgorot === null);
    box.push(h('button', { type: 'button', class: 'btn btn-primary', disabled: canApprove ? false : 'disabled', text: 'אישור תמחור → מוכנה לשליחה',
      onclick: function () { mutate('approve', r, {}, 'התמחור אושר — ההצעה מוכנה לשליחה'); } }));
    return h('div', { class: 'pkg-controls' }, box);
  }

  function attachControls(r) {
    if (r.attachedType) return h('div', { class: 'muted', text: 'משויך ל' + label(TARGET_HE, r.attachedType) + ' (מזהה ' + r.attachedId + ')' });
    var targets = S.targets() || [];
    var sel = h('select', { 'aria-label': 'שיוך למטופל' }, [h('option', { value: '', text: 'שיוך למטופל/ליד…' })].concat(targets.map(function (t) {
      return h('option', { value: t.type + ':' + t.id, text: label(TARGET_HE, t.type) + ' · ' + t.name });
    })));
    return h('div', { class: 'pkg-row' }, [sel, h('button', { type: 'button', class: 'btn', text: 'שיוך (ללא חיוב)', onclick: function () {
      var v = sel.value.split(':'); if (v.length < 2) { say('בחרי מטופל או ליד', true); return; }
      mutate('attach', r, { targetType: v[0], targetId: v.slice(1).join(':') }, 'שויך — לא נוצר חיוב או תשלום');
    } })]);
  }

  // -- calculator (compute-only; creates nothing) --
  // Every option is visible at once as a button (no hidden dropdowns): all packages grouped by family, then the months and,
  // for range items (Solo), the minimum / midpoint / maximum tiers. The quote is computed on every choice.
  function chips(options, selected, onPick, aria) {
    return h('div', { class: 'pkg-chips', role: 'group', 'aria-label': aria }, options.map(function (o) {
      var on = String(o.value) === String(selected);
      return h('button', { type: 'button', class: 'btn ' + (on ? 'btn-primary' : 'btn-ghost') + ' pkg-chip', 'aria-pressed': on ? 'true' : 'false', text: o.text, onclick: function () { onPick(o.value); } });
    }));
  }
  function calcView() {
    if (!S.catalog) return h('p', { class: 'muted', text: 'הקטלוג לא נטען.' });
    var items = S.catalog.items.filter(function (i) { return i.active; });
    if (!items.length) return h('p', { class: 'muted', text: 'הקטלוג ריק. עברי ללשונית קטלוג.' });
    var C = S.calc = S.calc || { key: '', months: '', tier: '', out: null };
    var box = h('div', { class: 'pkg-calc card' });
    function cur() { return items.filter(function (i) { return i.key === C.key; })[0] || null; }
    function pickItem(key) {
      var it = items.filter(function (i) { return i.key === key; })[0];
      C.key = key; C.tier = ''; C.out = null;
      C.months = it && it.allowedMonths.length ? String(it.allowedMonths[0]) : '';
      run();
    }
    async function run() {
      var it = cur();
      if (!it) { paint(); return; }
      var f = { packageKey: it.key };
      if (it.allowedMonths.length) f.months = parseInt(C.months, 10);
      if (it.unit === 'per_month_range' && C.tier) f.selectedMonthlyAgorot = parseInt(C.tier, 10);
      var res = await rpc('quote', f).catch(function (e) { return { ok: false, error: e.message }; });
      C.out = res; paint();
    }
    function resultView() {
      var res = C.out, it = cur();
      if (!it) return h('p', { class: 'muted', text: 'בחרי חבילה כדי לראות מחיר.' });
      if (!res) return h('p', { class: 'muted', text: '…' });
      if (!res.ok) return h('p', { class: 'pkg-msg', role: 'alert', text: errorText(res.error) });
      var q = res.quote, kids = [];
      if (q.needsSelection) return h('p', { class: 'muted', text: 'זהו טווח מחירים — יש לבחור מדרגת מחיר: מינימום / אמצע / מקסימום (אין מחיר ברירת מחדל).' });
      if (q.monthlyAgorot !== null) kids.push(h('div', { text: 'מחיר חודשי: ' + formatAgorot(q.monthlyAgorot) }));
      kids.push(h('div', { class: 'pkg-total', text: (q.commitmentMonths ? 'סה״כ התחייבות ל-' + q.commitmentMonths + ' חודשים' : 'סה״כ') + ': ' + formatAgorot(q.grossAgorot) }));
      kids.push(h('div', { class: 'muted', text: 'לפני מע״מ ' + formatAgorot(q.netAgorot) + ' · מע״מ ' + formatAgorot(q.vatAgorot) + ' (מחיר כולל מע״מ ' + (q.vatRateBp / 100) + '%)' }));
      return h('div', { class: 'pkg-calc-out', 'aria-live': 'polite' }, kids);
    }
    function paint() {
      while (box.firstChild) box.removeChild(box.firstChild);
      var order = [], byFam = {};
      items.forEach(function (i) { if (!byFam[i.family]) { byFam[i.family] = []; order.push(i.family); } byFam[i.family].push(i); });
      order.forEach(function (fam) {
        box.appendChild(h('div', { class: 'pkg-fam' }, [
          h('div', { class: 'pkg-fam-title', text: label(FAMILY, fam) }),
          chips(byFam[fam].map(function (i) { return { value: i.key, text: label(TIER, i.tier) }; }), C.key, pickItem, label(FAMILY, fam))
        ]));
      });
      var it = cur();
      if (it && it.allowedMonths.length > 1) {
        box.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: 'משך (חודשים)' }),
          chips(it.allowedMonths.map(function (m) { return { value: String(m), text: m + ' חודשים' }; }), C.months, function (v) { C.months = v; run(); }, 'משך')]));
      } else if (it && it.allowedMonths.length === 1) {
        box.appendChild(h('div', { class: 'muted', text: 'משך: ' + it.allowedMonths[0] + ' חודשים' }));
      }
      if (it && it.unit === 'per_month_range') {
        box.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: 'מדרגת מחיר חודשי' }),
          chips(rangeTiers(it).map(function (t) { return { value: String(t.agorot), text: t.text + ' · ' + formatAgorot(t.agorot) }; }), C.tier, function (v) { C.tier = v; run(); }, 'מדרגת מחיר חודשי')]));
      }
      box.appendChild(resultView());
      box.appendChild(h('p', { class: 'muted', text: 'המחשבון לא יוצר בקשה, חיוב או תשלום.' }));
    }
    paint();
    return box;
  }

  // -- catalog --
  function catalogView() {
    var cat = S.catalog;
    if (!cat) return h('p', { class: 'muted', text: 'לא ניתן לטעון את הקטלוג.' });
    if (!cat.items.length) return h('div', { class: 'card' }, [h('p', { text: 'הקטלוג ריק.' }), h('button', { type: 'button', class: 'btn btn-primary', text: 'ייבוא ראשוני מקטלוג השירותים (PDF)', onclick: async function () {
      var res = await rpc('seed').catch(function (e) { return { ok: false, error: e.message }; });
      if (res.ok) { say('הקטלוג יובא'); await loadAll(); } else { S.error = errorText(res.error); }
      draw();
    } })]);
    var active = cat.items.filter(function (i) { return i.active; });
    return h('div', { class: 'pkg-list' }, active.map(catalogRow));
  }

  function priceText(i) {
    if (i.unit === 'per_session_pack') return i.sessions + ' טיפולים × ' + formatAgorot(i.pricePerSessionAgorot) + ' = ' + formatAgorot(i.sessions * i.pricePerSessionAgorot);
    if (i.unit === 'flat') return 'מחיר כולל: ' + formatAgorot(i.priceTotalAgorot);
    if (i.unit === 'per_month') return 'לחודש: ' + formatAgorot(i.monthlyPriceAgorot);
    return 'לחודש: ' + formatAgorot(i.priceMinAgorot) + ' – ' + formatAgorot(i.priceMaxAgorot) + ' (בחירה בעת התמחור)';
  }
  var PRICE_FIELD = { per_session_pack: 'pricePerSessionAgorot', flat: 'priceTotalAgorot', per_month: 'monthlyPriceAgorot' };

  function catalogRow(i) {
    var edit = h('div', { class: 'pkg-row', hidden: true });
    var inputs = {};
    function field(name, ph) { inputs[name] = h('input', { type: 'text', inputmode: 'decimal', placeholder: ph, 'aria-label': ph }); return inputs[name]; }
    if (i.unit === 'per_month_range') edit.append(field('priceMinAgorot', 'מינימום ₪'), field('priceMaxAgorot', 'מקסימום ₪'));
    else edit.append(field(PRICE_FIELD[i.unit], i.unit === 'per_session_pack' ? 'מחיר לטיפול ₪' : 'מחיר ₪'));
    edit.appendChild(h('button', { type: 'button', class: 'btn btn-primary', text: 'שמירה כגרסה חדשה', onclick: async function () {
      var fields = { family: i.family, tier: i.tier, unit: i.unit, sessions: i.sessions, sessionMinutes: i.sessionMinutes,
        allowedMonths: i.allowedMonths, vatRateBp: i.vatRateBp, sourceRef: i.sourceRef, sortOrder: i.sortOrder,
        pricePerSessionAgorot: i.pricePerSessionAgorot, priceTotalAgorot: i.priceTotalAgorot, monthlyPriceAgorot: i.monthlyPriceAgorot,
        priceMinAgorot: i.priceMinAgorot, priceMaxAgorot: i.priceMaxAgorot, active: true };
      for (var k in inputs) { var a = parseShekels(inputs[k].value); if (a === null) { say('סכום לא תקין', true); return; } fields[k] = a; }
      var res = await rpc('saveRow', { key: i.key, expectedVersion: i.version, fields: fields }).catch(function (e) { return { ok: false, error: e.message }; });
      if (res.ok) { say('נשמרה גרסה ' + res.version + ' — בקשות קיימות לא משתנות'); await loadAll(); S.error = ''; }
      else { S.error = errorText(res.error); if (res.error === 'version_conflict') await loadAll(); }
      draw();
    } }));
    return h('div', { class: 'pkg-card card' }, [
      h('div', { class: 'pkg-head' }, [h('strong', { text: label(FAMILY, i.family) + ' — ' + label(TIER, i.tier) }), h('span', { class: 'chip', text: label(UNIT, i.unit) }), h('span', { class: 'muted', text: 'גרסה ' + i.version })]),
      h('div', { text: priceText(i) }),
      i.allowedMonths.length ? h('div', { class: 'muted', text: 'התחייבות אפשרית: ' + i.allowedMonths.join(', ') + ' חודשים' }) : null,
      h('div', { class: 'muted', text: i.sourceRef }),
      h('button', { type: 'button', class: 'btn', text: 'עריכת מחיר', onclick: function () { edit.hidden = !edit.hidden; } }), edit
    ]);
  }

  // ---- public API --------------------------------------------------------------
  function applyOpts(opts) {
    opts = opts || {};
    S.targets = opts.targets || S.targets; S.notify = opts.notify || S.notify; S.onPending = opts.onPending || S.onPending; S.onUnauthorized = opts.onUnauthorized || S.onUnauthorized;
    S.settings = opts.settings || S.settings; S.signedInName = opts.signedInName || S.signedInName; // display default for the owner select only — authority stays server-side
    S.openSettings = opts.openSettings || S.openSettings;
  }
  /* «💰 הצעת מחיר» on a client card (app.js): render the SAME new-offer form into `hostEl` with the target
   * locked to `opts.target` ('client:<id>'). Loads the catalog (privilege + data) if the pricing tab never did.
   * `opts.onDone(created)` fires when the form closes; the host re-reads the price-free summaries. */
  function mountOfferForm(hostEl, opts) {
    applyOpts(opts);
    while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
    var F = newFormState(opts.target, true);
    var entry = { host: hostEl, F: F };
    embedded.push(entry);
    hostEl.appendChild(h('p', { class: 'muted', text: 'טוען תמחור…' }));
    (async function () {
      var ok = false;
      try { ok = await ensureAdmin(); } catch (_) { ok = false; }
      if (ok && !S.catalog) await loadAll();
      if (F.closed) return;
      while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
      if (!ok || !S.catalog) { hostEl.appendChild(h('p', { class: 'pkg-msg', role: 'alert', text: !ok ? errorText('vered_only') : (S.loadError || errorText('upstream_unavailable')) })); return; }
      hostEl.appendChild(newRequestView(F, function (created) {
        embedded = embedded.filter(function (e) { return e !== entry; });
        while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
        if (typeof opts.onDone === 'function') opts.onDone(created);
      }));
    })();
    return { close: function () { F.closed = true; embedded = embedded.filter(function (e) { return e !== entry; }); while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild); } };
  }
  function mount(rootEl, opts) {
    var sameRoot = S.root === rootEl; S.root = rootEl;
    applyOpts(opts);
    if (S.phase === 'loading' || S.phase === 'gate') { boot(); return; }
    // Already showing the admin screen in this very root: keep what the user has open (an edit row, a calculator
    // choice) instead of wiping it on every unrelated re-render of the host app. «רענון» redraws on demand.
    if (sameRoot && rootEl.firstChild && rootEl.querySelector('.pkg-admin')) return;
    draw();
  }
  function reset() { S.phase = 'loading'; S.catalog = null; S.requests = null; S.calc = null; S.error = ''; S.loadError = ''; S.loading = false; S.newForm = null; S.wa = {}; S.confirm = {}; embedded = []; ops = {}; if (S.root) draw(); }

  return { mount: mount, mountOfferForm: mountOfferForm, reset: reset, formatAgorot: formatAgorot, parseShekels: parseShekels, label: label, rangeTiers: rangeTiers, waNumber: waNumber, offerMessage: offerMessage, matchTargets: matchTargets, matchTargetsGrouped: matchTargetsGrouped, estimateTotals: estimateTotals, lineUnit: lineUnit, TARGET_HE: TARGET_HE, TARGET_SECTIONS: TARGET_SECTIONS,
    FAMILY: FAMILY, TIER: TIER, UNIT: UNIT, STATUS: STATUS, CRM_STATUS: CRM_STATUS, CRM_ORDER: CRM_ORDER, REQUESTER: REQUESTER, ASSIGNEES: ASSIGNEES, ERRORS: ERRORS };
});
