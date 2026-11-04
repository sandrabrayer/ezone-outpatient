'use strict';
// Offers CRM in «תמחור חבילות» (sections 5–6 of the E-ZONE One brief, 2026-11-03):
//   new offer from the Outpatient app (packages / single treatments / both, quantities), prices computed by the
//   source only, discount = existing adjust (Vered, reason mandatory), statuses draft → ready_to_send → sent →
//   awaiting_decision → approved | rejected (+ expired at read time), WhatsApp «sent» is a manual confirmation,
//   approved creates NO charge / payment / renewal, price-free summaries for the work screen, and the role
//   matrix enforced by the server (ורד / אורן / דנה / forbidden authority fields).
// Real server.js + lib/catalog-admin.js + Code.gs in the in-memory sandbox; no Google, no production data.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 4300 + Math.floor(Math.random() * 300);
const APP_PIN = '424242', OREN_PIN = '515151', DANA_PIN = '626262';
const SESSION_SECRET = 'test-session-secret-offers-crm-0123456789';
const PROXY = 'fixture-proxy-key-with-at-least-32-characters';
const ASSERT = 'catalog-admin-assertion-secret-0123456789-C';
Object.assign(process.env, {
  PORT: String(PORT), APP_PIN, USER_PIN_OREN: OREN_PIN, USER_PIN_DANA: DANA_PIN, SESSION_SECRET, OUTPATIENT_PROXY_SECRET: PROXY,
  CATALOG_ADMIN_ASSERTION_SECRET: ASSERT, SHEETS_URL: 'https://script.example.com/macros/s/AKfycbDUMMY/exec'
});
delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;

const { sandbox } = require('../test-support/apps-script-sandbox');
const { createSessionToken } = require('../lib/session');
const catalogAdmin = require('../lib/catalog-admin');

const LEAD = { id: 'lead-1', name: 'ליד להצעה', phone: '0501111111', stage: 'new', assignedTo: 'ורד' };
const CLIENT = { id: 'client-1', name: 'מטופל להצעה', phone: '0502222222', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, paymentStatus: 'unpaid', nextBillingDate: '2026-11-05', startDate: '2026-10-01', assignedTo: 'ורד' };
const sb = sandbox([LEAD], [CLIENT]);
Object.assign(sb.props, { PACKAGE_CATALOG_SECRET: 'package-catalog-secret-0123456789abcdef-A', PACKAGE_REQUEST_SECRET: 'package-request-secret-0123456789abcdef-B', CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
let upstream = [];
global.fetch = async (url, init) => {
  if (init && init.method === 'POST') {
    upstream.push(JSON.parse(init.body));
    return { status: 200, text: async () => sb.ctx.doPost({ postData: { contents: init.body }, parameter: {} }).getContent() };
  }
  const u = new URL(String(url));
  return { status: 200, text: async () => sb.ctx.doGet({ parameter: Object.fromEntries(u.searchParams) }).getContent() };
};
const server = require('../server');
let httpServer;
test.before(() => { httpServer = server.start(PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

function request(method, urlPath, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {}) },
    (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch (_) {} resolve({ status: res.statusCode, json, body: d, headers: res.headers }); });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
async function ready() { for (let i = 0; i < 50; i++) { try { await request('GET', '/healthz'); return; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } } throw new Error('no listen'); }
const sessions = {};
const sess = (user = 'ורד') => (sessions[user] = sessions[user] || ('ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, user)));
let ipN = 0;
const freshIp = () => ({ 'x-forwarded-for': '10.2.0.' + (++ipN) });
const admins = {};
async function adminFor(user = 'ורד') {
  if (!admins[user]) {
    const r = await request('POST', '/api/catalog-admin/login', {}, { Cookie: sess(user), ...freshIp() });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    admins[user] = sess(user) + '; ' + r.headers['set-cookie'][0].split(';')[0];
  }
  return admins[user];
}
const rpc = async (op, extra, cookie) => request('POST', '/api/catalog-admin/rpc', { op, ...extra }, { Cookie: cookie || await adminFor() });
const uuid = (n) => n.toString(16).padStart(8, '0') + '-0000-4000-8000-00000000000' + (n % 10);
let opN = 100;
const opId = () => uuid(++opN);
const lastReq = async () => (await rpc('list')).json.items[0];

test('setup: Vered seeds the catalog; the manager side still works unchanged', async () => {
  await ready();
  assert.equal((await rpc('seed')).json.ok, true);
  assert.equal((await rpc('catalog')).json.items.length, 15);
  upstream = [];
});

test('new offer: packages + single treatments + quantities in ONE offer; prices from the catalog only; double click = one row; attached to the lead', async () => {
  const id = uuid(1);
  const body = { requestId: id, items: [{ packageKey: 'emdr_core', qty: 2, grossAgorot: 1, lineGrossAgorot: 1 }, { packageKey: 'solo_housing', months: 3, selectedMonthlyAgorot: 900000 }],
    targetType: 'lead', targetId: 'lead-1', validUntil: '2099-01-31', followUpDate: '2026-11-10', assignee: 'ורד', notes: 'הצעה ראשונה' };
  const r1 = await rpc('createRequest', body);
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.ok, true); assert.equal(r1.json.duplicate, false);
  const q = r1.json.request;
  assert.equal(q.crmStatus, 'draft'); assert.equal(q.status, 'pending');
  assert.equal(q.items.length, 2);
  assert.equal(q.quote.grossAgorot, 2 * 340000 + 3 * 900000, 'computed by the source from the catalog');
  assert.equal(q.items[0].lineGrossAgorot, 680000, 'the browser "grossAgorot: 1" was never read');
  assert.equal(q.patientName, 'ליד להצעה'); assert.equal(q.patientPhone, '0501111111', 'name/phone from the attached lead');
  assert.equal(q.attachedType, 'lead'); assert.equal(q.attachedId, 'lead-1');
  assert.equal(q.requesterKey, 'outpatient'); assert.equal(q.createdFrom, 'outpatient'); assert.equal(q.assignee, 'ורד');
  // what reached the source: allowlisted item keys only, actor from the session
  const sent = upstream.find((u) => u.action === 'adminCreatePackageRequest');
  assert.deepEqual(Object.keys(sent.items[0]).sort(), ['packageKey', 'qty']);
  assert.equal(sent.user, 'ורד');
  // the same requestId again (double click / retry) → the same single row
  const r2 = await rpc('createRequest', body);
  assert.equal(r2.json.duplicate, true);
  assert.equal(sb.rows('PackageRequests').length, 1);
});

test('new offer: inactive package, bad quantity, Solo without a tier, bad dates / assignee / target are refused; nothing written', async () => {
  const before = sb.rows('PackageRequests').length;
  const cases = [
    [{ items: [{ packageKey: 'no_such_pkg' }] }, 'invalid_package'],
    [{ items: [{ packageKey: 'emdr_core', qty: 0 }] }, 'invalid_quantity'],
    [{ items: [{ packageKey: 'emdr_core', qty: 21 }] }, 'invalid_quantity'],
    [{ items: [{ packageKey: 'solo_housing', months: 3 }] }, 'selection_required'],
    [{ items: [{ packageKey: 'solo_housing', months: 3, selectedMonthlyAgorot: 1 }] }, 'selection_out_of_range'],
    [{ items: [] }, 'items_required'],
    [{ items: [{ packageKey: 'emdr_core' }], validUntil: '31/12/2026' }, 'invalid_date'],
    [{ items: [{ packageKey: 'emdr_core' }], assignee: 'ירדן' }, 'invalid_assignee'],
    [{ items: [{ packageKey: 'emdr_core' }], targetType: 'client', targetId: 'nope' }, 'target_not_found'],
    [{ items: [{ packageKey: 'emdr_core' }], patientName: '' }, 'invalid_patient']
  ];
  let n = 10;
  for (const [extra, err] of cases) {
    const r = await rpc('createRequest', Object.assign({ requestId: uuid(++n), patientName: 'בדיקה' }, extra));
    assert.equal(r.json.ok, false, JSON.stringify(extra));
    assert.equal(r.json.error, err, JSON.stringify(extra));
  }
  // an inactive catalog row is refused even though it exists
  const cat = (await rpc('catalog')).json.items.find((i) => i.key === 'emdr_standard');
  const saved = await rpc('saveRow', { key: 'emdr_standard', expectedVersion: cat.version, fields: Object.assign({}, cat, { active: false, pricePerSessionAgorot: 85000 }) });
  assert.equal(saved.json.ok, true, JSON.stringify(saved.json));
  // (saveRow appends a new active version; deactivation of a package is a catalog-owner operation — here we only
  //  assert that a key that is not in the ACTIVE catalog is refused)
  const r = await rpc('createRequest', { requestId: uuid(++n), patientName: 'בדיקה', items: [{ packageKey: 'day_track_extended_v9' }] });
  assert.equal(r.json.error, 'invalid_package');
  assert.equal(sb.rows('PackageRequests').length, before);
});

test('flow: draft → (discount with reason, Vered) → approve = ready_to_send → mark sent (manual) → awaiting → approved; no charge, no payment; Activity trail', async () => {
  let r = await lastReq();
  assert.equal(r.crmStatus, 'draft');
  // a status change before the pricing is approved is refused
  const early = await rpc('setStatus', { requestId: r.id, opId: opId(), expectedRevision: r.revision, status: 'sent', sentTo: 'oren' });
  assert.equal(early.json.error, 'not_priced');
  // discount: reason mandatory (existing rule), recorded in adjustLog
  const noReason = await rpc('adjust', { requestId: r.id, opId: opId(), expectedRevision: r.revision, adjustedTotalAgorot: 3000000 });
  assert.equal(noReason.json.error, 'reason_required');
  const adj = await rpc('adjust', { requestId: r.id, opId: opId(), expectedRevision: r.revision, adjustedTotalAgorot: 3000000, reason: 'הנחת היכרות' });
  assert.equal(adj.json.ok, true); r = adj.json.request;
  assert.equal(r.adjustLog[0].reason, 'הנחת היכרות'); assert.equal(r.effectiveTotalAgorot, 3000000);
  const ap = await rpc('approve', { requestId: r.id, opId: opId(), expectedRevision: r.revision });
  assert.equal(ap.json.ok, true); r = ap.json.request;
  assert.equal(r.crmStatus, 'ready_to_send'); assert.equal(r.status, 'priced'); assert.equal(r.approvedTotalAgorot, 3000000);
  // opening WhatsApp is a browser action only — nothing here; «sent» needs a valid recipient
  const badTo = await rpc('setStatus', { requestId: r.id, opId: opId(), expectedRevision: r.revision, status: 'sent', sentTo: '12' });
  assert.equal(badTo.json.error, 'invalid_recipient');
  assert.equal((await lastReq()).crmStatus, 'ready_to_send', 'a refused send changed nothing');
  const sent = await rpc('setStatus', { requestId: r.id, opId: opId(), expectedRevision: r.revision, status: 'sent', sentTo: '050-333-3333', followUpDate: '2026-11-12' });
  assert.equal(sent.json.ok, true); r = sent.json.request;
  assert.equal(r.crmStatus, 'sent'); assert.equal(r.sentTo, '0503333333'); assert.equal(r.followUpDate, '2026-11-12'); assert.ok(r.sentAt);
  // the same op id again = replay, no second event
  const replay = await rpc('setStatus', { requestId: r.id, opId: upstream.at(-1).opId, expectedRevision: r.revision - 1, status: 'sent', sentTo: '0503333333' });
  assert.equal(replay.json.replay, true);
  // illegal transitions
  const back = await rpc('setStatus', { requestId: r.id, opId: opId(), expectedRevision: r.revision, status: 'ready_to_send' });
  assert.equal(back.json.error, 'invalid_transition');
  const wait = await rpc('setStatus', { requestId: r.id, opId: opId(), expectedRevision: r.revision, status: 'awaiting_decision' });
  assert.equal(wait.json.ok, true); r = wait.json.request; assert.equal(r.crmStatus, 'awaiting_decision');
  const ok = await rpc('setStatus', { requestId: r.id, opId: opId(), expectedRevision: r.revision, status: 'approved' });
  assert.equal(ok.json.ok, true); r = ok.json.request;
  assert.equal(r.crmStatus, 'approved'); assert.ok(r.decisionAt);
  const closed = await rpc('setStatus', { requestId: r.id, opId: opId(), expectedRevision: r.revision, status: 'rejected' });
  assert.equal(closed.json.error, 'offer_closed');
  // «approved» = the client accepted — NOT billing
  assert.equal(sb.rows('Charges').length, 0); assert.equal(sb.rows('Payments').length, 0);
  assert.equal(sb.rows('Clients')[0].pricePerSession, CLIENT.pricePerSession);
  const kinds = sb.rows('Activity').filter((e) => e.leadId === 'lead-1').map((e) => e.kind);
  assert.deepEqual(kinds, ['offer_sent', 'offer_awaiting_decision', 'offer_approved']);
  assert.ok(sb.rows('Activity').every((e) => !/\d{1,3},\d{3}|₪/.test(String(e.summary))), 'no amount in the activity summary');
  const money = sb.rows('Activity').map((e) => JSON.parse(e.detailsJson).money);
  assert.ok(money.every((m) => m === true), 'offer events are money-flagged (hidden from an ops session)');
});

test('expired is computed at read time from validUntil (not stored); follow-up alone can be updated; legacy row reads as one item', async () => {
  const id = uuid(2);
  const r1 = await rpc('createRequest', { requestId: id, patientName: 'פג תוקף', items: [{ packageKey: 'emdr_core' }], validUntil: '2020-01-01' });
  assert.equal(r1.json.request.crmStatus, 'expired');
  assert.equal(sb.rows('PackageRequests').find((x) => x.id === id).status, 'pending', 'the stored status is untouched');
  const ext = await rpc('setStatus', { requestId: id, opId: opId(), expectedRevision: 1, validUntil: '2099-12-31' });
  assert.equal(ext.json.request.crmStatus, 'draft', 'extending the validity revives it');
  const fu = await rpc('setStatus', { requestId: id, opId: opId(), expectedRevision: 2, followUpDate: '2026-12-01' });
  assert.equal(fu.json.request.followUpDate, '2026-12-01');
  const noop = await rpc('setStatus', { requestId: id, opId: opId(), expectedRevision: 3, followUpDate: '2026-12-01' });
  assert.equal(noop.json.noop, true);
  // a manager request (one package, no items column) reads as ONE item
  const epoch = (await rpc('catalog')).json.items.reduce((m, i) => Math.max(m, i.epoch), 0);
  const mgr = sb.post({ action: 'createPackageRequest', secret: 'package-request-secret-0123456789abcdef-B', requestId: uuid(3), requesterKey: 'oren', patientName: 'מטופל אורן', packageKey: 'emdr_core', catalogEpoch: epoch });
  assert.equal(mgr.ok, true, JSON.stringify(mgr));
  const legacy = (await rpc('list')).json.items.find((x) => x.id === uuid(3));
  assert.deepEqual(legacy.items.map((i) => [i.packageKey, i.qty, i.lineGrossAgorot]), [['emdr_core', 1, 340000]]);
  assert.equal(legacy.crmStatus, 'draft'); assert.equal(legacy.createdFrom, 'manager');
});

test('roles: אורן / דנה cannot create or move offers; authority fields in the body are refused; price-free /api/offers only for a full-money session', async () => {
  // Oren: the catalog login itself is refused (vered_only); the rpc without the admin cookie is 401
  const oren = await request('POST', '/api/catalog-admin/login', {}, { Cookie: sess('אורן'), ...freshIp() });
  assert.equal(oren.status, 403); assert.equal(oren.json.error, 'vered_only');
  const orenRpc = await rpc('createRequest', { requestId: uuid(4), patientName: 'x', items: [{ packageKey: 'emdr_core' }] }, sess('אורן'));
  assert.equal(orenRpc.status, 401);
  const dana = await request('POST', '/api/catalog-admin/login', {}, { Cookie: sess('דנה'), ...freshIp() });
  assert.equal(dana.status, 403);
  const danaRpc = await rpc('setStatus', { requestId: uuid(1), opId: opId(), expectedRevision: 1, status: 'approved' }, sess('דנה'));
  assert.equal(danaRpc.status, 401);
  // authority fields never travel, whoever sends them
  for (const k of ['user', 'actor', 'role', 'actorRole', 'requesterKey', 'isAdmin']) {
    const r = await rpc('createRequest', { requestId: uuid(5), patientName: 'x', items: [{ packageKey: 'emdr_core' }], [k]: 'ורד' });
    assert.equal(r.status, 400, k); assert.equal(r.json.error, 'forbidden_field', k);
  }
  // the generic proxy refuses every package action, for everyone
  for (const a of ['adminCreatePackageRequest', 'adminSetPackageRequestStatus', 'getPackageOfferSummaries']) {
    assert.equal((await request('POST', '/api/sheets', { action: a }, { Cookie: sess() })).status, 403, a);
    assert.equal((await request('GET', '/api/sheets?action=' + a, null, { Cookie: sess('דנה') })).status, 403, a);
  }
  // price-free summaries: Vered and Oren (full scope) yes, Dana (ops) no, no session no
  assert.equal((await request('GET', '/api/offers')).status, 401);
  const danaOffers = await request('GET', '/api/offers', null, { Cookie: sess('דנה') });
  assert.equal(danaOffers.status, 403); assert.equal(danaOffers.json.error, 'forbidden_money_action');
  const v = await request('GET', '/api/offers', null, { Cookie: sess() });
  assert.equal(v.status, 200); assert.ok(v.json.offers.length >= 2);
  const o = v.json.offers.find((x) => x.id === uuid(1));
  assert.equal(o.crmStatus, 'approved'); assert.equal(o.attachedType, 'lead'); assert.equal(o.attachedId, 'lead-1'); assert.equal(o.itemCount, 2);
  assert.ok(!/agorot|gross|net|vat|price|amount/i.test(v.body), 'no amount, VAT, discount or price constant in the summary feed: ' + v.body.slice(0, 200));
  assert.equal(v.headers['cache-control'], 'no-store');
  // the money-flagged offer events never reach an ops session's activity read
  const danaAct = await request('GET', '/api/sheets?action=getActivity', null, { Cookie: sess('דנה') });
  assert.equal(danaAct.status, 200);
  assert.deepEqual(danaAct.json.events.filter((e) => /^offer_/.test(e.kind)), []);
});

test('static guards: allowlist, dispatch, UI wiring, WhatsApp rules', () => {
  const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'package-pricing.js'), 'utf8');
  const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.deepEqual(Object.keys(catalogAdmin.ADMIN_OPS).sort(), ['adjust', 'approve', 'attach', 'catalog', 'createRequest', 'list', 'quote', 'saveRow', 'seed', 'setStatus']);
  assert.deepEqual(catalogAdmin.ITEM_FIELDS, ['packageKey', 'months', 'selectedMonthlyAgorot', 'qty']);
  assert.match(GS, /var PACKAGE_CRM_STATUSES = \['draft', 'ready_to_send', 'sent', 'awaiting_decision', 'approved', 'rejected', 'expired'\]/);
  assert.match(GS, /adminCreatePackageRequest: true, adminSetPackageRequestStatus: true/);
  assert.match(GS, /if \(action === 'adminCreatePackageRequest'\) return _json\(_pkgAdminCreate\(payload\)\);/);
  assert.match(GS, /if \(action === 'getPackageOfferSummaries'\) return _json\(_pkgOfferSummaries\(\)\);/);
  // the Hebrew labels live in the UI only; the UI never writes HTML strings and never computes a price it sends
  assert.match(UI, /var CRM_STATUS = \{ draft: 'טיוטה'/);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(UI));
  assert.match(UI, /https:\/\/wa\.me\/' \+ n \+ '\?text=' \+ encodeURIComponent/);
  assert.match(UI, /פתיחת WhatsApp אינה מסמנת את ההצעה כנשלחה/);
  assert.match(UI, /status: 'sent', sentTo: W\.to === 'oren' \? 'oren' : /, 'only «סמן כנשלחה» moves to sent');
  assert.ok(!/0\d{2}-?\d{7}|9725\d{8}/.test(UI), 'no phone number in the code: Oren\'s number is a setting');
  assert.match(APP, /orenWhatsapp: \(fd\.get\('orenWhatsapp'\)/);
  assert.match(APP, /function offersFor\(subj\)/);
  assert.match(APP, /data-offer-open=/);
  const PP = require('../public/package-pricing.js');
  assert.equal(PP.waNumber('052-765-4321'), '972527654321');
  assert.equal(PP.waNumber('+972 52 765 4321'), '972527654321');
  assert.equal(PP.waNumber('1-800-555'), '');
  const msg = PP.offerMessage({ patientName: 'דנה', items: [{ packageKey: 'emdr_core', qty: 2 }], effectiveTotalAgorot: 680000, validUntil: '2026-11-30' });
  assert.match(msg, /6,800 ₪/); assert.match(msg, /30\/11\/2026/);
  assert.ok(!/אבחנה|תרופ|פסיכיאט/.test(msg), 'no medical detail in the prepared message');
});
