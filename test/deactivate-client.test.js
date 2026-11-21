'use strict';

/* Real Apps Script doPost/doGet handlers in the shared in-memory Google runtime.
 * Cross-app contract: a unique canonical phone/contact/payer match is softly
 * deactivated; no match is a successful no-op; ambiguous matches change no row.
 * No receiver, auth, normalization, or feed projection is mirrored here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const SECRET = 'synthetic-deactivation-secret';
const DEACTIVATED = 'לא פעיל';
const DISCHARGED = 'סיים טיפול';

function freshClients() {
  return [
    { id: 'c1', name: 'אורי', status: 'פעיל', phone: '0501234567', treatmentContactPhone: '', payerPhone: '' },
    { id: 'c2', name: 'דנה', status: 'פעיל', phone: '', treatmentContactPhone: '0527654321', payerPhone: '' },
    { id: 'c3', name: 'מאיה', status: DISCHARGED, phone: '0541111111', treatmentContactPhone: '', payerPhone: '' }
  ];
}
function fixture(clients = freshClients()) {
  const sb = sandbox([], clients);
  sb.props.DEACTIVATE_CLIENT_SECRET = SECRET;
  sb.props.TREATMENT_PLANS_SECRET = 'synthetic-plans-secret';
  sb.props.DEBT_STATUS_SECRET = 'synthetic-debt-secret';
  return sb;
}
// Match the THR sender: dedicated secret in the JSON body, no internal proxy key.
function request(sb, body) {
  return JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'deactivateClient', ...body }) } }).getContent());
}
const deactivate = (sb, phone) => request(sb, { secret: SECRET, phone });
const snapshot = sb => JSON.stringify(Object.fromEntries(Object.entries(sb.sheets).map(([name, sh]) => [name, sh.grid])));
const feed = (sb, action, key) => sb.get({ action, secret: sb.props[key] });

test('the actual receiver uses a deactivation status distinct from discharge', () => {
  const sb = fixture();
  assert.equal(sb.ctx.DEACTIVATED_CLIENT_STATUS_HE, DEACTIVATED);
  assert.notEqual(DEACTIVATED, DISCHARGED);
});

test('doPost auth rejects unset, empty, missing and wrong dedicated secrets without source writes', () => {
  const sb = fixture();
  const before = snapshot(sb);
  for (const configured of [undefined, null, '']) {
    sb.props.DEACTIVATE_CLIENT_SECRET = configured;
    assert.deepEqual(request(sb, { secret: SECRET, phone: '0501234567' }), { ok: false, error: 'unauthorized' });
  }
  sb.props.DEACTIVATE_CLIENT_SECRET = SECRET;
  for (const secret of [undefined, null, '', 'wrong']) {
    assert.deepEqual(request(sb, { secret, phone: '0501234567' }), { ok: false, error: 'unauthorized' });
  }
  assert.equal(snapshot(sb), before);
  assert.equal(sb.isLocked(), false);
});

test('doPost accepts the exact configured dedicated secret', () => {
  assert.deepEqual(deactivate(fixture(), '0501234567'), { ok: true, deactivated: 1 });
});

test('STOP_FLAG_SECRET and the internal proxy key cannot authorize deactivation', () => {
  const sb = fixture();
  sb.props.STOP_FLAG_SECRET = 'synthetic-stop-only';
  const before = snapshot(sb);
  assert.deepEqual(request(sb, { secret: sb.props.STOP_FLAG_SECRET, phone: '0501234567' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(request(sb, { proxySecret: sb.props.OUTPATIENT_PROXY_SECRET, phone: '0501234567' }), { ok: false, error: 'unauthorized' });
  delete sb.props.DEACTIVATE_CLIENT_SECRET;
  assert.deepEqual(request(sb, { secret: sb.props.STOP_FLAG_SECRET, phone: '0501234567' }), { ok: false, error: 'unauthorized' });
  assert.equal(snapshot(sb), before);
});

test('unique phone match softly deactivates one row and preserves every other client', () => {
  const sb = fixture();
  const before = sb.rows('Clients');
  assert.deepEqual(deactivate(sb, '0501234567'), { ok: true, deactivated: 1 });
  const clients = sb.rows('Clients');
  assert.equal(clients.length, 3);
  assert.equal(clients[0].status, DEACTIVATED);
  assert.equal(clients[0].id, before[0].id);
  assert.equal(clients[0].name, before[0].name);
  assert.match(clients[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(clients.slice(1), before.slice(1));
  assert.equal(sb.isLocked(), false);
});

test('unique treatment contact and payer phone matches retain the sender contract', () => {
  const contact = fixture();
  assert.deepEqual(deactivate(contact, '0527654321'), { ok: true, deactivated: 1 });
  assert.equal(contact.rows('Clients')[1].status, DEACTIVATED);
  const clients = freshClients();
  clients[0].payerPhone = '0539998877';
  const payer = fixture(clients);
  assert.deepEqual(deactivate(payer, '0539998877'), { ok: true, deactivated: 1 });
  assert.equal(payer.rows('Clients')[0].status, DEACTIVATED);
});

test('dropped-leading-zero numeric stored phone still matches', () => {
  const clients = freshClients();
  clients[0].phone = 501234567;
  const sb = fixture(clients);
  assert.deepEqual(deactivate(sb, '0501234567'), { ok: true, deactivated: 1 });
  assert.equal(sb.rows('Clients')[0].status, DEACTIVATED);
});

test('international inbound phone with punctuation matches the unique canonical phone', () => {
  const sb = fixture();
  assert.deepEqual(deactivate(sb, '+972-50-1234567'), { ok: true, deactivated: 1 });
  assert.equal(sb.rows('Clients')[0].status, DEACTIVATED);
});

test('no match is an orphan-safe no-op preserving the client rows', () => {
  const sb = fixture();
  const before = sb.rows('Clients');
  assert.deepEqual(deactivate(sb, '0509999999'), { ok: true, deactivated: 0 });
  assert.deepEqual(sb.rows('Clients'), before);
});

test('empty client sheet is an orphan-safe no-op', () => {
  const sb = fixture([]);
  assert.deepEqual(deactivate(sb, '0501234567'), { ok: true, deactivated: 0 });
  assert.deepEqual(sb.rows('Clients'), []);
});

test('invalid phone is rejected without source writes', () => {
  const sb = fixture();
  const before = snapshot(sb);
  for (const phone of ['12345', '', null]) {
    assert.deepEqual(deactivate(sb, phone), { ok: false, reason: 'invalid_phone' });
  }
  assert.equal(snapshot(sb), before);
});

test('retrying an already-deactivated unique client returns zero without restamping', () => {
  const sb = fixture();
  assert.deepEqual(deactivate(sb, '0501234567'), { ok: true, deactivated: 1 });
  const before = sb.rows('Clients');
  assert.deepEqual(deactivate(sb, '0501234567'), { ok: true, deactivated: 0 });
  assert.deepEqual(sb.rows('Clients'), before);
});

test('shared primary phone refuses the entire call before any source write', () => {
  const clients = freshClients();
  clients.push({ id: 'c4', name: 'אורי תאום', status: 'פעיל', phone: '0501234567' });
  const sb = fixture(clients);
  const before = snapshot(sb);
  assert.deepEqual(deactivate(sb, '0501234567'), { ok: false, error: 'ambiguous_client', reason: 'ambiguous_client', deactivated: 0 });
  assert.equal(snapshot(sb), before);
  assert.equal(sb.isLocked(), false);
});

test('shared contact or payer refuses even when one matching person is already inactive', () => {
  for (const field of ['treatmentContactPhone', 'payerPhone']) {
    const clients = freshClients();
    clients[0][field] = '0539998877';
    clients[1][field] = '+972-53-9998877';
    clients[1].status = DEACTIVATED;
    const sb = fixture(clients);
    const before = snapshot(sb);
    assert.deepEqual(deactivate(sb, '0539998877'), { ok: false, error: 'ambiguous_client', reason: 'ambiguous_client', deactivated: 0 });
    assert.equal(snapshot(sb), before);
  }
});

test('one row matching multiple phone fields is still one unambiguous client', () => {
  const clients = freshClients();
  clients[0].treatmentContactPhone = '+972-50-1234567';
  clients[0].payerPhone = '0501234567';
  const sb = fixture(clients);
  assert.deepEqual(deactivate(sb, '0501234567'), { ok: true, deactivated: 1 });
});

test('real getTreatmentPlans excludes deactivated clients but retains discharged clients', () => {
  const sb = fixture();
  assert.equal(deactivate(sb, '0501234567').ok, true);
  const response = feed(sb, 'getTreatmentPlans', 'TREATMENT_PLANS_SECRET');
  assert.equal(response.ok, true);
  const ids = response.clients.map(row => row.clientId);
  assert.equal(ids.includes('c1'), false);
  assert.equal(ids.includes('c2'), true);
  assert.equal(ids.includes('c3'), true);
});

test('real getDebtStatus excludes deactivated clients and preserves discharged debt', () => {
  const sb = fixture();
  sb.seed('Payments', sb.ctx.PAYMENTS_HEADERS, [{ id: 'p3', clientId: 'c3', amountDue: 900, amountPaid: 100, status: 'partial' }]);
  assert.equal(deactivate(sb, '0501234567').ok, true);
  const response = feed(sb, 'getDebtStatus', 'DEBT_STATUS_SECRET');
  assert.equal(response.ok, true);
  assert.equal(response.clients.some(row => row.clientId === 'c1'), false);
  const discharged = response.clients.find(row => row.clientId === 'c3');
  assert.equal(discharged.debtStatus, 'debt');
  assert.equal(discharged.amountOwed, 800);
  assert.equal(sb.rows('Clients')[2].status, DISCHARGED);
});
