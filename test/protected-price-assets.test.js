'use strict';
/* Price / pay constants are NOT public assets (release blocker found in the package-catalog review).
 * treatment-map.js = client price table; therapist-pay.js = per-therapist pay rates.
 * Proves, through the real Express app: no session -> no bytes, whatever the URL spelling;
 * a session gets them `no-store`; nothing else that is served unauthenticated contains the
 * constants; the page, service worker and cache list no longer expose them.
 * Billing math is untouched: the files are byte-identical and still unit-tested directly. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 31861;
const SESSION_SECRET = 'test-session-secret-protected-prices-0123456789';
Object.assign(process.env, { PORT: String(PORT), APP_PIN: '424242', SESSION_SECRET, SHEETS_URL: 'https://script.example.com/macros/s/X/exec' });
delete process.env.DASHBOARD_SHEETS_URL; delete process.env.OCCUPANCY_SECRET;
global.fetch = async () => { throw new Error('no upstream expected'); };

const { createSessionToken } = require('../lib/session');
const server = require('../server');
const PUB = path.join(__dirname, '..', 'public');
const TreatmentMap = require('../public/treatment-map');
const TherapistPay = require('../public/therapist-pay');
let httpServer;
test.before(async () => {
  httpServer = server.start(PORT);
  for (let i = 0; i < 50; i++) { try { await raw('GET', '/healthz'); return; } catch (_) { await new Promise((r) => setTimeout(r, 50)); } }
});
test.after(() => { if (httpServer) httpServer.close(); });

// raw path on the wire (no client-side normalisation)
function raw(method, rawPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: rawPath, method, headers: headers || {} }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
}
const cookie = { Cookie: 'ezone_session=' + createSessionToken(SESSION_SECRET, undefined, undefined, 'ורד') };

const SPELLINGS = [
  '/treatment-map.js', '/therapist-pay.js', '/treatment-map.js?v=1', '/therapist-pay.js?x=%00',
  '/Treatment-Map.js', '/THERAPIST-PAY.JS', '//treatment-map.js', '/./therapist-pay.js', '/a/../treatment-map.js',
  '/%74reatment-map.js', '/therapist%2Dpay.js', '/%2574reatment-map.js', '/treatment-map.js/', '/therapist-pay.js%2f',
  '/%2e/treatment-map.js', '/x/%2e%2e/therapist-pay.js', '/treatment-map.js%20', '/treatment-map.js.', '/treatment-map.js%00', '/treatment-map.js;a=b',
  '/therapist-pay.js%09', '/%20treatment-map.js', '/treatment-map.jsx', '/treatment-map', '/therapist-pay.js.bak', '/..%2ftreatment-map.js', '/%252e%252e/therapist-pay.js'
];

test('NO SESSION: every spelling of the two files is refused and not a single byte of the constants is sent', async () => {
  const secrets = [String(TreatmentMap.PRICES && Object.values(TreatmentMap.PRICES)[0]), ...Object.keys(TherapistPay.FLAT_RATES || {})].filter(Boolean);
  for (const p of SPELLINGS) {
    for (const method of ['GET', 'HEAD']) {
      const r = await raw(method, p);
      assert.ok([400, 401, 404].includes(r.status), method + ' ' + p + ' -> ' + r.status);
      assert.ok(!/FLAT_RATES|CLINICAL_TO_BILLING|PSYCHIATRIST_RATES|withVat/.test(r.body), p + ' leaked source');
      for (const s of secrets.slice(1)) assert.ok(!r.body.includes(s), p + ' leaked a name');
    }
  }
  assert.equal((await raw('GET', '/treatment-map.js')).status, 401);
  assert.equal((await raw('GET', '/therapist-pay.js', { Cookie: 'ezone_session=garbage' })).status, 401);
  assert.equal((await raw('GET', '/treatment-map.js', { Cookie: 'ezone_session=' + createSessionToken('other-secret-0123456789abcdefghij-zz') })).status, 401, 'foreign secret');
});

test('WITH a session: served byte-identical, no-store, JavaScript (billing code unchanged)', async () => {
  for (const f of ['treatment-map.js', 'therapist-pay.js']) {
    const r = await raw('GET', '/' + f + '?v=123', cookie);
    assert.equal(r.status, 200, f);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-type'], /javascript/);
    assert.equal(r.body, fs.readFileSync(path.join(PUB, f), 'utf8'));
  }
  const odd = await raw('GET', '/Treatment-Map.js', cookie);
  assert.equal(odd.status, 200); assert.equal(odd.headers['cache-control'], 'no-store');
});

test('everything ELSE served without a session is free of the constants (scan of every public asset)', async () => {
  // The needles are VALUES tied to the secret tables, not staff names (names are also user-picker entries).
  const needles = [];
  for (const [name, rate] of Object.entries(TherapistPay.FLAT_RATES || {})) needles.push(['rate of ' + name, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'\\s:=,]{1,6}' + rate + '\\b')]);
  for (const [name, kinds] of Object.entries(TherapistPay.PSYCHIATRIST_RATES || {})) for (const v of Object.values(kinds)) needles.push(['psychiatrist rate ' + name, new RegExp(name + '[^\\n]{0,60}\\b' + v + '\\b')]);
  assert.ok(needles.length >= 16, 'the scan really has pay-rate needles');
  const prices = [TreatmentMap.INDIVIDUAL_SESSION_PRICE, ...Object.values(TreatmentMap.BILLING_PRICES || {}), ...Object.values(TreatmentMap.DAY_CENTER_MONTHLY_BY_FREQ || {})].filter((n) => Number.isFinite(n) && n >= 1000);
  assert.ok(prices.length >= 2, 'the scan really has price constants >= 1000');
  const protectedNames = new Set(['treatment-map.js', 'therapist-pay.js']);
  const files = fs.readdirSync(PUB).filter((f) => fs.statSync(path.join(PUB, f)).isFile());
  assert.ok(files.length > 15);
  for (const f of files) {
    if (protectedNames.has(f)) continue;
    const r = await raw('GET', '/' + f);
    if (r.status === 200 && /^(text|application)\//.test(r.headers['content-type'] || '')) {
      for (const [what, re] of needles) assert.ok(!re.test(r.body), f + ' exposes the ' + what);
      for (const p of prices) assert.ok(!new RegExp('(^|[^0-9,.])' + String(p).replace(/(\d)(?=(\d{3})+$)/g, '$1,?') + '([^0-9]|$)').test(r.body), f + ' exposes a price constant ' + p);
      if (f !== 'app.js') assert.ok(!/FLAT_RATES|PSYCHIATRIST_RATES|DAY_CENTER_MONTHLY_BY_FREQ|BILLING_PRICES/.test(r.body), f); // app.js only READS the post-login globals
    }
  }
});

test('the page no longer ships them as static script tags; they load after sign-in from one ordered list', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(!/<script[^>]+(treatment-map|therapist-pay|therapist-payout)\.js/.test(html), 'no static tag');
  const m = /<meta name="ezone-protected-scripts" content="([^"]+)"/.exec(html);
  assert.ok(m, 'ordered list present');
  assert.deepEqual(m[1].split(/\s+/).map((s) => s.replace(/\?v=__BUILD__$/, '')), ['treatment-map.js', 'therapist-pay.js', 'therapist-payout.js'], 'therapist-payout.js must come after therapist-pay.js');
  assert.ok(m[1].split(/\s+/).every((s) => s.endsWith('?v=__BUILD__')), 'every script keeps ?v=__BUILD__');
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.match(app, /await loadProtectedScripts\(\);/);
  assert.match(app, /function dropProtectedScripts\(\)/);
  assert.match(app, /function handleUnauthorized\(\) \{\s*dropProtectedScripts\(\);/);
  assert.match(app, /dropProtectedScripts\(\);\s*try \{ sessionStorage\.removeItem\('ez_role'\)/, 'logout drops them too');
});

test('service worker: never caches them, not in the shell list, cache name bumped (old copies deleted on activate)', () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  const code = sw.replace(/\/\*[\s\S]*?\*\//g, '');
  const shell = /var SHELL = \[([\s\S]*?)\];/.exec(code)[1];
  assert.ok(!/treatment-map|therapist-pay/.test(shell));
  assert.match(code, /\(treatment-map\|therapist-pay\)\\\.js\$\/i\.test\(url\.pathname\)\) return;/);
  const v = Number(/ezone-outpatient-v(\d+)/.exec(code)[1]);
  assert.ok(v >= 13, 'bumped past the v12 that cached them: ' + v);
  assert.match(code, /keys\.filter\(function \(k\) \{ return k !== CACHE; \}\)\.map\(function \(k\) \{ return caches\.delete\(k\); \}\)/, 'old caches (with old copies) are deleted');
});

test('protectedStaticName unit: normalisation, double-decoding, malformed escapes', () => {
  const n = server.protectedStaticName;
  for (const p of ['/treatment-map.js', '//Treatment-Map.js', '/%2574reatment-map.js', '/a/../therapist-pay.js', '/therapist-pay.js/']) assert.ok(['treatment-map.js', 'therapist-pay.js'].includes(n(p)), p);
  assert.equal(n('/app.js'), ''); assert.equal(n('/therapist-payout.js'), '', 'pure logic, no constants: stays a normal static file'); assert.equal(n('/treatment-map-extra.js'), ''); assert.equal(n('/treatment-map.json'), 'blocked', 'looks like the file but is not it: never reaches static'); assert.equal(n('/treatment-map.js%20'), 'blocked'); assert.equal(n('/%E0%A4%A'), 'invalid');
});
