/* Deploy-window guard (lib/backend-capabilities.js, server.js, Code.gs
 * getCapabilities).
 *
 * Railway deploys the Node proxy before the explicit Apps Script phase. In
 * that window the proxy already strips money from an operational session
 * (דנה) and stamps moneyScope:'ops', but the OLD Code.gs ignores the flag and
 * would write the stripped fields (0 / blank) over every client row on her
 * next saveAll. The proxy must refuse (503 backend_upgrade_pending) until the
 * live backend answers getCapabilities with moneyScope:true.
 *
 * Covers: pure capability parsing; the gate (fail closed on absent /
 * malformed / non-2xx / thrown probe, positive answer cached for the TTL,
 * negative never cached); server.js — ops saveAll refused with ZERO forward
 * when the backend lacks the capability, forwarded when present, ורד
 * unaffected either way, probe failure fails closed; Code.gs — the action is
 * proxy-secret gated, read-only and has the agreed shape. */

process.env.OUTPATIENT_PROXY_SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = 31893;
const DUMMY_PIN = '424242';
const SHEETS = 'https://script.google.com/macros/s/FIXTURE/exec';
process.env.PORT = String(TEST_PORT);
process.env.APP_PIN = DUMMY_PIN;
process.env.USER_PIN_OREN = '515151';
process.env.USER_PIN_DANA = '626262';
process.env.SHEETS_URL = SHEETS;
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
delete process.env.DASHBOARD_SHEETS_URL;
delete process.env.OCCUPANCY_SECRET;
const PIN_OF = { 'ורד': DUMMY_PIN, 'דנה': '626262' };

const caps = require('../lib/backend-capabilities');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

/* ---------- mocked upstream ---------- */
const calls = [];
let capabilityReply = () => ({ status: 200, body: { ok: true, capabilities: { moneyScope: true, paidDateCoverage: true } } });
let probeThrows = false;
global.fetch = async (url, init) => {
  const u = new URL(String(url));
  const body = init && init.body ? JSON.parse(init.body) : null;
  const action = body ? body.action : u.searchParams.get('action');
  calls.push({ action, body, secret: u.searchParams.get('proxySecret') });
  if (!body && action === 'getCapabilities') {
    if (probeThrows) throw new Error('down');
    const r = capabilityReply();
    return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  }
  return { status: 200, text: async () => JSON.stringify({ ok: true, echo: body }) };
};
const server = require('../server');
let httpServer;
test.before(() => { httpServer = server.start(TEST_PORT); });
test.after(() => { if (httpServer) httpServer.close(); });

function request(method, urlPath, bodyObj, headers) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: TEST_PORT, path: urlPath, method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, headers || {}) },
    (res) => { let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, json, headers: res.headers }); }); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const cookies = {};
async function login(user) {
  if (cookies[user]) return cookies[user];
  for (let i = 0; i < 50; i++) { try { await request('GET', '/healthz'); break; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } }
  const res = await request('POST', '/api/verify-pin', { pin: PIN_OF[user], user });
  assert.equal(res.status, 200, user + ' login');
  cookies[user] = (res.headers['set-cookie'] || [])[0].split(';')[0];
  return cookies[user];
}
const H = (c) => ({ Cookie: c });
const SAVE = { action: 'saveAll', leads: [], clients: [] };
const forwarded = () => calls.filter((c) => c.action === 'saveAll').length;
const probes = () => calls.filter((c) => c.action === 'getCapabilities').length;

/* ---------- pure ---------- */
test('lib: only { ok:true, capabilities:{ moneyScope:true } } proves the capability', () => {
  assert.equal(caps.hasMoneyScopeCapability({ ok: true, capabilities: { moneyScope: true } }), true);
  for (const bad of [null, undefined, {}, { ok: true }, { ok: false, capabilities: { moneyScope: true } },
    { ok: true, capabilities: {} }, { ok: true, capabilities: { moneyScope: 'true' } }, { ok: true, capabilities: { moneyScope: 1 } },
    { ok: true, echo: null }, { ok: false, error: 'unauthorized' }, { ok: false, error: 'unknown action: getCapabilities' }]) {
    assert.equal(caps.hasMoneyScopeCapability(bad), false, JSON.stringify(bad));
  }
  assert.equal(caps.isFullRowWrite('saveAll'), true);
  for (const a of ['setPreferredHouse', 'createTask', 'logContact', 'saveContinuation', '', undefined]) assert.equal(caps.isFullRowWrite(a), false, String(a));
});

test('lib: gate fails closed on every bad probe, caches a positive answer for the TTL only, never caches a negative one', async () => {
  let now = 1000, reply, calls = 0;
  const gate = caps.createGate({ sheetsUrl: SHEETS, proxySecret: 'k', ttlMs: 100, now: () => now,
    fetch: async () => { calls++; if (reply instanceof Error) throw reply; return reply; } });
  const good = { status: 200, text: async () => JSON.stringify({ ok: true, capabilities: { moneyScope: true } }) };
  reply = { status: 200, text: async () => JSON.stringify({ ok: false, error: 'unknown action: getCapabilities' }) }; // OLD Code.gs
  assert.equal(await gate.isReady(), false);
  reply = { status: 200, text: async () => 'not json' };
  assert.equal(await gate.isReady(), false);
  reply = { status: 500, text: async () => JSON.stringify({ ok: true, capabilities: { moneyScope: true } }) };
  assert.equal(await gate.isReady(), false);
  reply = new Error('ECONNRESET');
  assert.equal(await gate.isReady(), false);
  assert.equal(calls, 4, 'a negative result is re-probed every time');
  reply = good;
  assert.equal(await gate.isReady(), true);
  reply = new Error('down');
  now += 50;
  assert.equal(await gate.isReady(), true, 'cached positive within TTL, no probe');
  assert.equal(calls, 5);
  now += 60;
  assert.equal(await gate.isReady(), false, 'TTL expired -> re-probe -> fail closed');
  gate.reset();
  reply = good;
  assert.equal(await gate.isReady(), true);
  // unconfigured proxy never probes and is never ready
  const none = caps.createGate({ sheetsUrl: '', proxySecret: '', fetch: async () => { throw new Error('must not be called'); } });
  assert.equal(await none.isReady(), false);
  assert.match(gate.probeUrl(), /action=getCapabilities&proxySecret=k$/);
});

/* ---------- server.js ---------- */
test('routes: an ops saveAll is refused (503, nothing forwarded) while the backend lacks the capability; ורד is forwarded', async () => {
  const d = await login('דנה'), v = await login('ורד');
  server.capabilityGate.reset();
  calls.length = 0;
  capabilityReply = () => ({ status: 200, body: { ok: false, error: 'unknown action: getCapabilities' } }); // OLD Code.gs
  let r = await request('POST', '/api/sheets', SAVE, H(d));
  assert.equal(r.status, 503); assert.deepEqual(r.json, { ok: false, error: 'backend_upgrade_pending' });
  assert.equal(forwarded(), 0, 'the save must never reach the old backend');
  assert.equal(probes(), 1);
  assert.equal(calls[0].secret, process.env.OUTPATIENT_PROXY_SECRET, 'probe carries the proxy secret');
  // second attempt re-probes (negative never cached)
  r = await request('POST', '/api/sheets', SAVE, H(d));
  assert.equal(r.status, 503); assert.equal(probes(), 2); assert.equal(forwarded(), 0);
  // ורד's full-scope save is not gated at all
  calls.length = 0;
  r = await request('POST', '/api/sheets', SAVE, H(v));
  assert.equal(r.status, 200); assert.equal(forwarded(), 1); assert.equal(probes(), 0);
  assert.equal(calls[0].body.moneyScope, 'full');
  // ops partial writes are not gated either
  calls.length = 0;
  r = await request('POST', '/api/sheets', { action: 'setPreferredHouse', id: 'x' }, H(d));
  assert.notEqual(r.status, 503); assert.equal(probes(), 0);
});

test('routes: a probe failure (network / non-JSON / 5xx) fails closed for ops only', async () => {
  const d = await login('דנה'), v = await login('ורד');
  server.capabilityGate.reset();
  probeThrows = true; calls.length = 0;
  let r = await request('POST', '/api/sheets', SAVE, H(d));
  assert.equal(r.status, 503); assert.equal(r.json.error, 'backend_upgrade_pending'); assert.equal(forwarded(), 0);
  probeThrows = false;
  capabilityReply = () => ({ status: 200, body: '<html>maintenance</html>' });
  r = await request('POST', '/api/sheets', SAVE, H(d));
  assert.equal(r.status, 503); assert.equal(forwarded(), 0);
  capabilityReply = () => ({ status: 502, body: { ok: true, capabilities: { moneyScope: true } } });
  r = await request('POST', '/api/sheets', SAVE, H(d));
  assert.equal(r.status, 503); assert.equal(forwarded(), 0);
  calls.length = 0;
  r = await request('POST', '/api/sheets', SAVE, H(v));
  assert.equal(r.status, 200); assert.equal(forwarded(), 1);
});

test('routes: once the backend reports moneyScope:true the ops saveAll is forwarded with moneyScope ops, and the answer is cached', async () => {
  const d = await login('דנה');
  server.capabilityGate.reset();
  capabilityReply = () => ({ status: 200, body: { ok: true, capabilities: { moneyScope: true, paidDateCoverage: true } } });
  calls.length = 0;
  let r = await request('POST', '/api/sheets', SAVE, H(d));
  assert.equal(r.status, 200); assert.equal(forwarded(), 1); assert.equal(probes(), 1);
  const save = calls.find((c) => c.action === 'saveAll');
  assert.equal(save.body.moneyScope, 'ops'); assert.equal(save.body.user, 'דנה');
  r = await request('POST', '/api/sheets', SAVE, H(d));
  assert.equal(r.status, 200); assert.equal(forwarded(), 2); assert.equal(probes(), 1, 'positive answer cached');
});

/* ---------- Code.gs ---------- */
test('Code.gs: getCapabilities is proxy-secret gated, read-only, and reports moneyScope / paidDateCoverage true', () => {
  const sb = sandbox([], []);
  assert.equal(sb.ctx.SOURCE_GET_AUTH.getCapabilities, 'OUTPATIENT_PROXY_SECRET');
  assert.equal(sb.get({ action: 'getCapabilities' }).error, 'unauthorized', 'no secret -> unauthorized');
  assert.equal(sb.get({ action: 'getCapabilities', proxySecret: 'wrong' }).error, 'unauthorized');
  const before = JSON.stringify(Object.keys(sb.sheets).sort());
  const out = sb.get({ action: 'getCapabilities', proxySecret: sb.props.OUTPATIENT_PROXY_SECRET });
  assert.equal(out.ok, true);
  assert.equal(out.sourceApp, 'ezone-outpatient');
  assert.equal(out.capabilities.moneyScope, true);
  assert.equal(out.capabilities.paidDateCoverage, true);
  assert.equal(out.capabilities.recoveryHold, true);
  assert.equal(caps.hasMoneyScopeCapability(out), true, 'the proxy accepts exactly this shape');
  assert.equal(JSON.stringify(Object.keys(sb.sheets).sort()), before, 'no sheet created or touched');
  // the recovery hold answers before any action, including this one
  sb.props.OUTPATIENT_RECOVERY_HOLD = '1';
  const held = sb.get({ action: 'getCapabilities', proxySecret: sb.props.OUTPATIENT_PROXY_SECRET });
  assert.equal(held.error, 'recovery_pending');
  assert.equal(caps.hasMoneyScopeCapability(held), false, 'under hold the proxy keeps ops saves closed');
});
