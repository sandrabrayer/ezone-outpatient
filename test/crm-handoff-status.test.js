'use strict';
/* OP-CRM-2 / G2 (Phase D) — getHandoffStatus read-only feed for the Dashboard. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const SECRET = 'handoff-status-fixture-secret-0123456789';
const T = new Date().toISOString().slice(0, 10);
const plain = (x) => JSON.parse(JSON.stringify(x));
function leads() {
  return [
    { id: 'L-new', name: 'חדש', phone: '0501111111', stage: 'פרטים אישיים', created: '2026-10-28', assignedTo: 'ורד', pricePerSession: 900, note: 'סודי' },
    { id: 'L-intro', name: 'היכרות', phone: '0502222222', stage: 'שיחת היכרות', introDateTime: '2099-01-05T10:00', assignedTo: 'דנה' },
    { id: 'L-passed', name: 'עברה', phone: '0503333333', stage: 'שיחת היכרות', introDateTime: '2026-10-01T10:00' },
    { id: 'L-plan', name: 'תוכנית', phone: '0504444444', stage: 'תוכנית טיפול', startDate: '2026-11-15' },
    { id: 'L-nr', name: 'לא רלוונטי', phone: '0505555555', stage: 'לא רלוונטי', not_relevant_reason: 'price', updatedAt: '2026-10-20T08:00:00.000Z' },
    { id: 'L-conv', name: 'הומר', phone: '0506666666', stage: 'תוכנית טיפול' }
  ];
}
function clients() {
  return [
    { id: 'C-active', name: 'פעיל', phone: '0506666666', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', startDate: '2026-10-10', fromLead: 'L-conv', assignedTo: 'ורד', pricePerSession: 2000, paymentStatus: 'unpaid' },
    { id: 'C-adm', name: 'מתחיל', phone: '0507777777', status: 'פעיל', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', startDate: '2099-02-01' },
    { id: 'C-end', name: 'סיים', phone: '0508888888', status: 'סיים טיפול', serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', exitDate: '2026-09-30' }
  ];
}
function sb0() { const sb = sandbox(leads(), clients()); sb.props.HANDOFF_STATUS_SECRET = SECRET; return sb; }
const get = (sb, params) => sb.get(params);
const post = (sb, body) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(body) } }).getContent());

test('auth: fail closed — unconfigured, missing, wrong-length, wrong secret all 401; no other secret opens it', () => {
  const sb = sandbox(leads(), clients());
  assert.equal(get(sb, { action: 'getHandoffStatus', secret: SECRET, outpatientIds: 'L-new' }).error, 'unauthorized', 'not configured');
  sb.props.HANDOFF_STATUS_SECRET = SECRET;
  assert.equal(get(sb, { action: 'getHandoffStatus', outpatientIds: 'L-new' }).error, 'unauthorized');
  assert.equal(get(sb, { action: 'getHandoffStatus', secret: 'x', outpatientIds: 'L-new' }).error, 'unauthorized');
  assert.equal(get(sb, { action: 'getHandoffStatus', secret: SECRET.slice(0, -1) + 'X', outpatientIds: 'L-new' }).error, 'unauthorized');
  sb.props.CREATE_LEAD_SECRET = 'cl'; sb.props.TREATMENT_PLANS_SECRET = 'tp';
  assert.equal(get(sb, { action: 'getHandoffStatus', secret: 'cl', outpatientIds: 'L-new' }).error, 'unauthorized');
  assert.equal(get(sb, { action: 'getHandoffStatus', secret: 'tp', outpatientIds: 'L-new' }).error, 'unauthorized');
  // the proxy key never authorizes a cross-app read
  assert.equal(get(sb, { action: 'getHandoffStatus', proxySecret: sb.props.OUTPATIENT_PROXY_SECRET, outpatientIds: 'L-new' }).error, 'unauthorized');
  assert.equal(plain(sb.ctx.SOURCE_GET_AUTH).getHandoffStatus, 'HANDOFF_STATUS_SECRET');
  assert.equal(plain(sb.ctx.SOURCE_POST_AUTH).getHandoffStatus, 'HANDOFF_STATUS_SECRET');
  assert.equal(get(sb, { action: 'getHandoffStatus', secret: SECRET }).error, 'missing_ids');
});

test('states: referred / contacted / intro_scheduled / intro_passed / plan / not_relevant / admitted / active / ended; a converted lead answers as its client', () => {
  const sb = sb0();
  sb.post({ action: 'logContact', user: 'דנה', moneyScope: 'ops', submissionId: 'k1', contact: { leadId: 'L-intro', outcome: 'meeting_set' }, next: { none: true, explanation: 'נקבעה' } });
  const r = get(sb, { action: 'getHandoffStatus', secret: SECRET, outpatientIds: 'L-new,L-intro,L-passed,L-plan,L-nr,L-conv,C-adm,C-end,nope' });
  assert.equal(r.ok, true);
  const by = Object.fromEntries(r.results.map((x) => [x.outpatientId, x]));
  assert.equal(by['L-new'].state, 'referred'); assert.equal(by['L-new'].stateDate, '2026-10-28'); assert.equal(by['L-new'].assignedTo, 'ורד');
  assert.equal(by['L-intro'].state, 'intro_scheduled'); assert.equal(by['L-intro'].stateDate, '2099-01-05'); assert.equal(by['L-intro'].lastActionDate, T);
  assert.equal(by['L-passed'].state, 'intro_passed');
  assert.equal(by['L-plan'].state, 'plan'); assert.equal(by['L-plan'].stateDate, '2026-11-15');
  assert.equal(by['L-nr'].state, 'not_relevant'); assert.equal(by['L-nr'].stateDate, '2026-10-20');
  assert.equal(by['L-conv'], undefined, 'a converted lead is reported as its client');
  assert.equal(by['C-active'].state, 'active'); assert.equal(by['C-active'].entity, 'client'); assert.equal(by['C-active'].stateDate, '2026-10-10');
  assert.equal(by['C-adm'].state, 'admitted');
  assert.equal(by['C-end'].state, 'ended'); assert.equal(by['C-end'].stateDate, '2026-09-30');
  assert.equal(by['nope'], undefined);
  assert.deepEqual(r.states, ['referred', 'contacted', 'intro_scheduled', 'intro_passed', 'plan', 'admitted', 'active', 'ended', 'not_relevant']);
  // contacted: a new-stage lead with a logged contact
  sb.post({ action: 'logContact', user: 'ורד', moneyScope: 'full', submissionId: 'k2', contact: { leadId: 'L-new', outcome: 'no_answer' }, next: { days: 3 } });
  const r2 = get(sb, { action: 'getHandoffStatus', secret: SECRET, outpatientIds: 'L-new' });
  assert.equal(r2.results[0].state, 'contacted');
  assert.equal(r2.results[0].nextAction, 'שיחה חוזרת');
  assert.match(r2.results[0].nextActionDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('answer carries operational state only — never money, clinical, notes or phone; money tasks are not the next action', () => {
  const sb = sb0();
  sb.post({ action: 'createTask', user: 'ורד', moneyScope: 'full', submissionId: 'm', task: { kind: 'collection', clientId: 'C-active', title: 'לגבות', dueDate: '2026-10-01' } });
  sb.post({ action: 'createTask', user: 'ורד', moneyScope: 'full', submissionId: 'o', task: { kind: 'call', clientId: 'C-active', title: 'שיחת מעקב', dueDate: '2026-12-01' } });
  const r = get(sb, { action: 'getHandoffStatus', secret: SECRET, outpatientIds: 'C-active,L-new' });
  const txt = JSON.stringify(r);
  for (const bad of ['2000', '900', 'unpaid', 'pricePerSession', 'paymentStatus', 'phone', '0506666666', '0501111111', 'סודי', 'serviceType', 'לגבות']) {
    assert.equal(txt.includes(bad), false, 'leaks ' + bad);
  }
  const c = r.results.find((x) => x.outpatientId === 'C-active');
  assert.equal(c.nextAction, 'שיחת מעקב');
  assert.deepEqual(Object.keys(c).sort(), ['assignedTo', 'dashboardPatientId', 'entity', 'lastActionDate', 'nextAction', 'nextActionDate', 'outpatientId', 'state', 'stateDate', 'updatedAt']);
});

test('ids: exact match only, caps and sanitizes the list; dashboardPatientIds match only when the identity column exists (PR #137)', () => {
  const sb = sb0();
  // no identity column on this schema -> a dashboard id never matches, and never errors
  const r = get(sb, { action: 'getHandoffStatus', secret: SECRET, dashboardPatientIds: 'id-stay-1' });
  assert.equal(r.ok, true); assert.deepEqual(r.results, []);
  // name / phone are not lookup keys
  assert.deepEqual(get(sb, { action: 'getHandoffStatus', secret: SECRET, outpatientIds: 'חדש,0501111111' }).results, []);
  // a POST body works the same way (Dashboard server-to-server)
  const p = post(sb, { action: 'getHandoffStatus', secret: SECRET, outpatientIds: ['L-new', 'bad id!', 'L-plan'] });
  assert.deepEqual(p.results.map((x) => x.outpatientId).sort(), ['L-new', 'L-plan']);
  // simulate #137's identity column present: inject the header + value
  const ctx = sb.ctx;
  const sheet = sb.sheets.Leads;
  const headers = sheet.grid[0];
  if (!headers.includes('dashboardPatientId')) { headers.push('dashboardPatientId'); ctx.LEADS_HEADERS.push('dashboardPatientId'); }
  const idx = headers.indexOf('dashboardPatientId');
  sheet.grid[1][idx] = 'id-stay-1';
  const r2 = get(sb, { action: 'getHandoffStatus', secret: SECRET, dashboardPatientIds: 'id-stay-1' });
  assert.equal(r2.results.length, 1); assert.equal(r2.results[0].outpatientId, 'L-new'); assert.equal(r2.results[0].dashboardPatientId, 'id-stay-1');
});
