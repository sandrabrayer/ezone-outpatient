'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSessionToken } = require('../lib/session');
const { sandbox } = require('../test-support/apps-script-sandbox');
const SECRET = 'fixture-proxy-key-with-at-least-32-characters';
const SESSION = 'fixture-session-key';
const COOKIE = 'ezone_session=' + createSessionToken(SESSION, undefined, undefined, 'ורד');

async function fixture(t, secret = SECRET) {
  const env = { ...process.env };
  const oldFetch = global.fetch;
  const modulePath = require.resolve('../server');
  const sb = sandbox([{ id: 'dummy-lead', name: 'בדיקה בלבד', stage: 'new' }]);
  const sent = [];
  process.env.SHEETS_URL = 'https://source.invalid/exec';
  process.env.SESSION_SECRET = SESSION;
  process.env.OUTPATIENT_PROXY_SECRET = secret;
  global.fetch = async (url, options = {}) => {
    sent.push({ url, options });
    const event = options.method === 'POST'
      ? { parameter: {}, postData: { contents: options.body } }
      : { parameter: Object.fromEntries(new URL(url).searchParams) };
    const result = sb.ctx[options.method === 'POST' ? 'doPost' : 'doGet'](event).getContent();
    return { status: 200, text: async () => result };
  };
  delete require.cache[modulePath];
  const app = require('../server');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    global.fetch = oldFetch;
    for (const k of ['SHEETS_URL', 'SESSION_SECRET', 'OUTPATIENT_PROXY_SECRET']) {
      if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    }
    delete require.cache[modulePath];
  });
  function request(method, path, body, cookie = COOKIE) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' } }, res => {
        let text = '';
        res.on('data', c => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers, json: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return { sb, sent, request };
}

test('actual signed-session proxy and source preserve read, payment save and authenticated actor', async t => {
  const f = await fixture(t);
  const read = await f.request('GET', '/api/sheets?proxySecret=forged');
  assert.equal(read.json.ok, true);
  assert.equal(read.json.leads[0].id, 'dummy-lead');
  assert.equal(new URL(f.sent[0].url).searchParams.get('proxySecret'), SECRET);
  const save = await f.request('POST', '/api/sheets', {
    action: 'savePayment', proxySecret: 'forged', user: 'forged',
    payment: { id: 'dummy-payment', clientId: 'dummy-client', amount: 10 }
  });
  assert.equal(save.json.ok, true);
  assert.equal(f.sb.rows('Payments').length, 1);
  const posted = JSON.parse(f.sent[1].options.body);
  assert.equal(posted.proxySecret, SECRET);
  assert.equal(posted.user, 'ורד');
  assert.equal(read.text.includes(SECRET), false);
  assert.equal(save.text.includes(SECRET), false);
});

test('missing or forged browser session cannot reach the source, including after cache fill', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('GET', '/api/sheets')).json.ok, true);
  const count = f.sent.length;
  for (const cookie of ['', 'ezone_session=forged']) {
    assert.equal((await f.request('GET', '/api/sheets', undefined, cookie)).status, 401);
    assert.equal((await f.request('POST', '/api/sheets', { action: 'savePayment' }, cookie)).status, 401);
  }
  assert.equal(f.sent.length, count);
});

test('unconfigured/short proxy credential fails before cache/fetch and blocks deployment readiness', async t => {
  for (const secret of ['', 'short', ' '.repeat(40)]) {
    await t.test('invalid length ' + secret.length, async st => {
      const f = await fixture(st, secret);
      assert.equal((await f.request('GET', '/api/sheets')).status, 503);
      assert.equal((await f.request('POST', '/api/sheets', { action: 'savePayment' })).status, 503);
      assert.deepEqual((await f.request('GET', '/healthz')).json, { ok: false });
      assert.equal(f.sent.length, 0);
    });
  }
});

test('GET writes are refused and source authentication rejection is never cached as success', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('GET', '/api/sheets?action=saveAll')).status, 405);
  assert.equal(f.sent.length, 0);
  f.sb.props.OUTPATIENT_PROXY_SECRET = 'different-fixture-key-with-at-least-32-characters';
  const denied = await f.request('GET', '/api/sheets');
  assert.deepEqual(denied.json, { ok: false, error: 'unauthorized' });
  f.sb.props.OUTPATIENT_PROXY_SECRET = SECRET;
  const accepted = await f.request('GET', '/api/sheets');
  assert.equal(accepted.json.ok, true);
  assert.equal(f.sent.length, 2);
});

test('upstream exceptions and non-JSON bodies cannot expose source keys in responses/headers/debug metadata', async t => {
  const f = await fixture(t);
  global.fetch = async () => { throw new Error('failed https://source.invalid/?proxySecret=' + SECRET); };
  const read = await f.request('GET', '/api/sheets');
  const write = await f.request('POST', '/api/sheets', { action: 'savePayment' });
  const debug = await f.request('GET', '/api/debug/last-load');
  for (const result of [read, write, debug]) assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(read.status, 502);
  assert.equal(write.status, 502);
  global.fetch = async () => ({ status: 200, text: async () => '<html>' + SECRET + '</html>' });
  const html = await f.request('GET', '/api/sheets');
  assert.equal(html.status, 502);
  assert.equal(html.text.includes(SECRET), false);
});
