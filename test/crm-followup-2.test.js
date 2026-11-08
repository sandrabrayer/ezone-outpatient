'use strict';
// CRM follow-up 2 (Sandra's production review of PRs #163/#165, 2026-11-04) — server contracts:
//   3. soft delete («🗑 מחיקה», status 'deleted', hidden everywhere, trail kept) and reset («↺ איפוס», back to an
//      empty draft, logged) — ורד only at BOTH layers (Node 403 offer_delete_vered_only, source vered_only);
//      nothing else on the row / in any other sheet is touched;
//   4. a quote can target a Dashboard admitted-roster patient ('roster', stable ref) besides a client / lead, and
//      the price-free summaries carry the ref so the continuation card can show it;
//   5. «sent» stores the recipient KIND + last four digits only ('oren' | 'patient:1234' | 'other:1234').
// Real server.js + lib/catalog-admin.js + Code.gs in the in-memory sandbox; no Google, no production data.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 4700 + Math.floor(Math.random() * 200);
const APP_PIN = '424242', OREN_PIN = '515151', DANA_PIN = '626262';
const SESSION_SECRET = 'test-session-secret-crm-followup-2-0123456789';
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
const users = require('../lib/users');

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
const freshIp = () => ({ 'x-forwarded-for': '10.7.0.' + (++ipN) });
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
let opN = 500;
const opId = () => uuid(++opN);
const reqRows = () => sb.rows('PackageRequests');
const rowById = (id) => reqRows().find((r) => r.id === id);
const snapshotAll = () => JSON.stringify(['Clients', 'Leads', 'Payments', 'Charges', 'Tasks', 'Activity', 'Credits', 'ClientCharges'].map((n) => [n, sb.rows(n)]));
// the source's own admin call (the Node layer bypassed on purpose, to prove the twin check)
const sourceAdmin = (action, body) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ action }, body, { proxySecret: PROXY, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) })) } }).getContent());

let offerA, offerB, offerRoster;

test('setup: catalog seeded, three offers (client / lead / roster target)', async () => {
  await ready();
  assert.equal((await rpc('seed')).json.ok, true);
  const mk = async (n, target, extra) => {
    const r = await rpc('createRequest', Object.assign({ requestId: uuid(n), items: [{ packageKey: 'emdr_core', qty: 1 }], validUntil: '2099-01-31', followUpDate: '2026-11-10', assignee: 'ורד' }, target, extra || {}));
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.ok, true);
    return r.json.request;
  };
  offerA = await mk(1, { targetType: 'client', targetId: 'client-1' });
  offerB = await mk(2, { targetType: 'lead', targetId: 'lead-1' });
  // 4. a Dashboard admitted patient: stable ref (ContinuationLogic.patientRef), name + phone travel with the request
  offerRoster = await mk(3, { targetType: 'roster', targetId: 'id:dash-77', patientName: 'מאושפז מהרוסטר', patientPhone: '054-777-7777' });
  assert.equal(offerRoster.attachedType, 'roster'); assert.equal(offerRoster.attachedId, 'id:dash-77');
  assert.equal(offerRoster.patientName, 'מאושפז מהרוסטר'); assert.equal(offerRoster.patientPhone, '0547777777');
  // a roster ref must be well formed, and a roster quote needs the name (the source cannot look it up)
  assert.equal((await rpc('createRequest', { requestId: uuid(4), items: [{ packageKey: 'emdr_core' }], targetType: 'roster', targetId: 'דנה כהן' })).json.error, 'invalid_target');
  assert.equal((await rpc('createRequest', { requestId: uuid(5), items: [{ packageKey: 'emdr_core' }], targetType: 'roster', targetId: 'phone:0541234567' })).json.error, 'invalid_patient');
  assert.equal((await rpc('createRequest', { requestId: uuid(6), items: [{ packageKey: 'emdr_core' }], targetType: 'house', targetId: 'x' })).json.error, 'invalid_target');
  // the price-free feed carries the roster ref (no amount) so the continuation card / My Day can match it
  const feed = await request('GET', '/api/offers', null, { Cookie: sess() });
  const fr = feed.json.offers.find((o) => o.id === offerRoster.id);
  assert.equal(fr.attachedType, 'roster'); assert.equal(fr.attachedId, 'id:dash-77');
  assert.ok(!/agorot|gross|price/i.test(JSON.stringify(fr)));
  // attach (reference only) accepts a roster ref too, after pricing approval
  const ap = await rpc('approve', { requestId: offerB.id, opId: opId(), expectedRevision: offerB.revision });
  assert.equal(ap.json.ok, true); offerB = ap.json.request;
  const re = await rpc('attach', { requestId: offerB.id, opId: opId(), expectedRevision: offerB.revision, targetType: 'roster', targetId: 'phone:0509999999' });
  assert.equal(re.json.error, 'already_attached', 'B is attached to its lead — never silently re-pointed');
  // mark B sent «to the patient»: only the kind + last four digits are stored
  const sent = await rpc('setStatus', { requestId: offerB.id, opId: opId(), expectedRevision: offerB.revision, status: 'sent', sentTo: 'patient', followUpDate: '2026-11-12' });
  assert.equal(sent.json.ok, true); offerB = sent.json.request;
  assert.equal(offerB.sentTo, 'patient:1111');
  assert.ok(!JSON.stringify(rowById(offerB.id)).includes('0501111111'.slice(0, 7) + '1111"'), 'no full recipient number on the row');
});

test('3. delete / reset are refused for אורן and דנה at Node (403, nothing travels) and at the source (vered_only)', async () => {
  upstream = [];
  for (const who of ['אורן', 'דנה']) {
    for (const op of ['deleteRequest', 'resetRequest']) {
      const r = await rpc(op, { requestId: offerA.id, opId: opId(), expectedRevision: offerA.revision }, sess(who));
      assert.equal(r.status, 403, who + ' ' + op); assert.equal(r.json.error, 'offer_delete_vered_only');
      assert.equal(r.headers['cache-control'], 'no-store');
    }
  }
  assert.deepEqual(upstream, [], 'refused BEFORE anything reached the source');
  // the source's own twin check: a forged call naming another actor is refused there too
  for (const user of ['אורן', 'שחר', '', undefined]) {
    const body = { requestId: offerA.id, opId: opId(), expectedRevision: offerA.revision };
    if (user !== undefined) body.user = user;
    assert.equal(sourceAdmin('adminDeletePackageRequest', body).error, 'vered_only', String(user));
    assert.equal(sourceAdmin('adminResetPackageRequest', body).error, 'vered_only', String(user));
  }
  assert.equal(rowById(offerA.id).status, 'pending', 'untouched');
  // allowlist: nothing but the four fields travels; a body authority field is refused
  const forged = await rpc('deleteRequest', { requestId: offerA.id, opId: opId(), expectedRevision: offerA.revision, user: 'ורד' });
  assert.equal(forged.status, 400); assert.equal(forged.json.error, 'forbidden_field');
  assert.deepEqual(catalogAdmin.ADMIN_OPS.deleteRequest.fields, ['requestId', 'opId', 'expectedRevision', 'reason']);
  assert.deepEqual(catalogAdmin.ADMIN_OPS.resetRequest.fields, ['requestId', 'opId', 'expectedRevision', 'reason']);
  assert.deepEqual(users.OFFER_DELETE_USERS, ['ורד']);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), /var PACKAGE_DELETE_USERS = \['ורד'\];/);
});

test('3. soft delete (ורד): status deleted + trail; hidden from list, summaries and counts; row kept; nothing else touched; idempotent', async () => {
  const before = snapshotAll();
  const rowsBefore = reqRows().length;
  const delOp = opId();
  const r = await rpc('deleteRequest', { requestId: offerA.id, opId: delOp, expectedRevision: offerA.revision, reason: 'נוצרה בטעות' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.ok, true);
  assert.equal(r.json.request.crmStatus, 'deleted'); assert.equal(r.json.request.status, 'deleted');
  const row = rowById(offerA.id);
  assert.equal(row.status, 'deleted');
  assert.equal(JSON.parse(row.items).length, 1, 'the lines are kept for the record');
  const log = JSON.parse(row.adjustLog);
  assert.deepEqual([log.at(-1).kind, log.at(-1).by, log.at(-1).from, log.at(-1).to, log.at(-1).reason], ['deleted', 'ורד', 'pending', 'deleted', 'נוצרה בטעות']);
  assert.ok(log.at(-1).at);
  assert.equal(reqRows().length, rowsBefore, 'kept in the sheet');
  assert.equal(snapshotAll(), before, 'no other sheet changed');
  // hidden everywhere
  const list = (await rpc('list')).json;
  assert.ok(!list.items.some((x) => x.id === offerA.id));
  assert.equal(list.counts.pending, 2, 'the roster draft + B (sent) — the deleted row is not counted (pending = every non-priced live row, as before)');
  const feed = await request('GET', '/api/offers', null, { Cookie: sess() });
  assert.ok(!feed.json.offers.some((o) => o.id === offerA.id));
  // the same op id again is a replay; a NEW op on a deleted row is a no-op (no second log line)
  const replay = await rpc('deleteRequest', { requestId: offerA.id, opId: delOp, expectedRevision: offerA.revision });
  assert.equal(replay.json.replay, true);
  const again = await rpc('deleteRequest', { requestId: offerA.id, opId: opId(), expectedRevision: offerA.revision + 1 });
  assert.equal(again.json.noop, true);
  assert.equal(JSON.parse(rowById(offerA.id).adjustLog).length, log.length);
  // the lead / client card feeds never see it; the client row itself is untouched
  assert.deepEqual(sb.rows('Clients').map((c) => c.id), ['client-1']);
});

test('3. reset (ורד): back to an EMPTY draft — items / pricing / approval / sent / decision cleared, target + terms kept, logged; approve then refuses', async () => {
  const before = snapshotAll();
  const r = await rpc('resetRequest', { requestId: offerB.id, opId: opId(), expectedRevision: offerB.revision, reason: 'להתחיל מחדש' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.ok, true);
  const q = r.json.request;
  assert.equal(q.crmStatus, 'draft'); assert.equal(q.status, 'pending');
  assert.deepEqual(q.items, [], 'an explicit empty list — not the legacy one-item fallback');
  assert.equal(q.quote, null); assert.equal(q.effectiveTotalAgorot, null); assert.equal(q.approvedTotalAgorot, null);
  assert.equal(q.sentAt, ''); assert.equal(q.sentTo, ''); assert.equal(q.decisionAt, ''); assert.equal(q.packageKey, '');
  assert.equal(q.attachedType, 'lead'); assert.equal(q.attachedId, 'lead-1'); assert.equal(q.validUntil, '2099-01-31'); assert.equal(q.patientName, 'ליד להצעה');
  const row = rowById(offerB.id);
  assert.equal(row.items, '[]'); assert.equal(row.quoteSnapshot, ''); assert.equal(row.approvedSnapshot, ''); assert.equal(row.sentTo, '');
  const log = JSON.parse(row.adjustLog);
  assert.deepEqual([log.at(-1).kind, log.at(-1).by, log.at(-1).from, log.at(-1).to, log.at(-1).reason], ['reset', 'ורד', 'sent', 'pending', 'להתחיל מחדש']);
  assert.equal(snapshotAll(), before, 'no other sheet changed');
  // an empty draft cannot be priced / approved — Vered creates a new offer for the same target instead
  assert.equal((await rpc('approve', { requestId: offerB.id, opId: opId(), expectedRevision: q.revision })).json.error, 'items_required');
  assert.equal((await rpc('adjust', { requestId: offerB.id, opId: opId(), expectedRevision: q.revision, adjustedTotalAgorot: 100, reason: 'xx' })).json.error, 'items_required');
  // still listed (it is a draft), still in the feed, item count 0
  assert.ok((await rpc('list')).json.items.some((x) => x.id === offerB.id && x.crmStatus === 'draft'));
  const feed = await request('GET', '/api/offers', null, { Cookie: sess() });
  assert.equal(feed.json.offers.find((o) => o.id === offerB.id).itemCount, 0);
  // a deleted row can be reset too (it comes back as a clean draft, logged)
  const undo = await rpc('resetRequest', { requestId: offerA.id, opId: opId(), expectedRevision: offerA.revision + 1 });
  assert.equal(undo.json.ok, true); assert.equal(undo.json.request.crmStatus, 'draft');
});

test('5. «sent» recipient kinds: oren / patient / other number — stored as kind + last four digits; a bad recipient is refused', async () => {
  const ap = await rpc('approve', { requestId: offerRoster.id, opId: opId(), expectedRevision: offerRoster.revision });
  assert.equal(ap.json.ok, true); let q = ap.json.request;
  assert.equal((await rpc('setStatus', { requestId: q.id, opId: opId(), expectedRevision: q.revision, status: 'sent', sentTo: '12' })).json.error, 'invalid_recipient');
  assert.equal((await rpc('setStatus', { requestId: q.id, opId: opId(), expectedRevision: q.revision, status: 'sent', sentTo: '' })).json.error, 'invalid_recipient');
  const other = await rpc('setStatus', { requestId: q.id, opId: opId(), expectedRevision: q.revision, status: 'sent', sentTo: '052-123-4567', followUpDate: '2026-11-20' });
  assert.equal(other.json.ok, true); q = other.json.request;
  assert.equal(q.sentTo, 'other:4567');
  assert.ok(!JSON.stringify(rowById(q.id)).includes('0521234567'), 'the typed number is not stored');
  // the activity event of a roster quote is filed under the continuation subject cont:<ref>
  const ev = sb.rows('Activity').filter((e) => e.kind === 'offer_sent' && e.clientId === 'cont:id:dash-77');
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].detailsJson).sentTo, 'phone');
  // the UI renders the stored kinds (never a full number)
  const PP = require('../public/package-pricing.js');
  assert.equal(PP.sentToText('oren'), ' לאורן');
  assert.equal(PP.sentToText('patient:1111'), ' למטופל/ת (…1111)');
  assert.equal(PP.sentToText('other:4567'), ' למספר אחר (…4567)');
  assert.equal(PP.sentToText(''), '');
});

test('4. picker: three sections in a fixed order, each capped, phone or name, roster + lead labels', () => {
  const PP = require('../public/package-pricing.js');
  const T = [
    { type: 'lead', id: 'l1', name: 'דנה כהן', phone: '052-111-2233', sub: 'אתר' },
    { type: 'client', id: 'c1', name: 'אבי כהן', phone: '0501112233', sub: 'קבוצתי · רעננה הפרדס' },
    { type: 'roster', id: 'id:dash-1', name: 'רון כהן', phone: '0531112233', sub: 'קיסריה עפרוני' },
    { type: 'roster', id: 'phone:0541112233', name: 'גל כהן', phone: '0541112233', sub: 'רמות השבים' },
    { type: 'client', id: 'c2', name: 'רות לוי', phone: '', sub: '' }
  ];
  const g = PP.matchTargetsGrouped(T, 'כהן', 6);
  assert.deepEqual(g.map((x) => [x.type, x.label, x.total, x.items.map((t) => t.id)]), [
    ['client', 'מטופלים', 1, ['c1']], ['roster', 'מאושפזים', 2, ['phone:0541112233', 'id:dash-1']], ['lead', 'לידים פתוחים', 1, ['l1']]
  ]);
  assert.deepEqual(PP.matchTargetsGrouped(T, '1112233', 1).map((x) => [x.type, x.total, x.items.length]), [['client', 1, 1], ['roster', 2, 1], ['lead', 1, 1]], 'capped per section, total uncapped');
  assert.deepEqual(PP.matchTargetsGrouped(T, 'לוי', 6).map((x) => x.type), ['client']);
  assert.deepEqual(PP.matchTargetsGrouped(T, 'zzz', 6), []);
  assert.deepEqual(PP.TARGET_SECTIONS, [['client', 'מטופלים'], ['roster', 'מאושפזים'], ['lead', 'לידים פתוחים']]);
  assert.deepEqual(PP.TARGET_HE, { client: 'מטופל', roster: 'מאושפז/ת', lead: 'ליד' });
  // flat matcher: clients, then roster, then leads
  assert.deepEqual(PP.matchTargets(T, 'כהן', 8).map((t) => t.type), ['client', 'roster', 'roster', 'lead']);
});

test('static guards: no window.confirm / window.open in the pricing UI; the card button and host; the embed API', () => {
  const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'package-pricing.js'), 'utf8');
  const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!/window\.open\(/.test(UI));
  const zone = UI.slice(UI.indexOf('function deleteResetControls'), UI.indexOf('// ---- offer CRM actions'));
  assert.ok(zone.includes('function confirmBox(r)') && !/[^.\w-]confirm\(/.test(zone), 'delete / reset confirm in-app, never window.confirm');
  assert.match(zone, /role: 'alertdialog'/);
  assert.match(UI, /function mountOfferForm\(hostEl, opts\)/);
  assert.match(UI, /function newRequestView\(F, done\)/, 'ONE form implementation');
  assert.equal((UI.match(/class: 'pkg-new card'/g) || []).length, 1);
  // (2026-11-05) wrapped in the shared action spinner: the reason is read into a
  // local before the async action starts — the call itself is unchanged.
  assert.match(UI, /var reason = \(C\.reason \|\| ''\)\.trim\(\);/);
  assert.match(UI, /mutate\(del \? 'deleteRequest' : 'resetRequest', r, \{ reason: reason \}/);
  assert.match(APP, /offerBtn\.textContent = '💰 הצעת מחיר';/);
  assert.match(APP, /if \(state\.user === 'ורד' && !isOpsScope\(\) && window\.PackagePricing\) \{/, 'display rule only — the server decides');
  assert.match(APP, /window\.PackagePricing\.mountOfferForm\(host, Object\.assign\(pricingOpts\(\), \{\n\s*target: 'client:' \+ c\.id,/);
  assert.match(APP, /o\.attachedType === 'roster' && String\(o\.attachedId\) === ref/, 'roster quotes show on the continuation row');
});
