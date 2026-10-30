'use strict';

/**
 * preferredHouse (בית מועדף) — an optional preferred house on Outpatient
 * clients, carried in by the createLead handoff.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 *   A. schema: ONE append-only column at the very END of CLIENTS_HEADERS
 *      (position 38), mirrored at the end of the Clients-removed, Leads and
 *      removed-leads literals; nothing before it moves.
 *   B. validation (_preferredHouseOrNull): exact allowed labels or blank;
 *      anything else rejected (never coerced); length-limited; formula-safe.
 *   C. setPreferredHouse: single-cell write under the script lock (never a
 *      whole-sheet rewrite), auth-gated, fail-closed on bad input.
 *   D. _saveAll keeps the on-sheet value for existing rows; seeds new rows
 *      from a validated payload value only.
 *   E. createLead with / without the field; bad secret still fails closed.
 *   F. UI: dropdowns, card + lead chip rendered through escapeHtml, wiring.
 * A–E run the REAL apps-script/Code.gs in a sandbox.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app.js');
const HTML = read('public/index.html');
const plain = (x) => JSON.parse(JSON.stringify(x));

const ALLOWED = ['קיסריה עפרוני', 'קיסריה ריהאב', 'רעננה אשר', 'רעננה הפרדס', 'רמות השבים'];
const INVALID = [
  'קיסריה גמילה',                 // a real house, but not in the allowed set
  'חיצוני', 'efroni', 'raanana_pardes', 'רעננה',
  '=HYPERLINK("http://x","קיסריה עפרוני")', '+רמות השבים', '-רעננה אשר', '@רעננה הפרדס',
  '<script>alert(1)</script>', 'קיסריה עפרוני'.repeat(5),
  42, true, {}, ['רעננה אשר']
];
const base = (over) => Object.assign({
  id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני',
  sessionsPerWeek: '{"פרטני":1}', status: 'פעיל', startDate: '2026-09-01'
}, over);

/* ================================ A. schema ================================ */

test('A: preferredHouse keeps physical position 38; OP-ID-1 appends identity after it', () => {
  const { ctx } = sandbox();
  const H = plain(ctx.CLIENTS_HEADERS);
  assert.equal(H.length, 41);
  assert.equal(H[37], 'preferredHouse');
  assert.equal(H.indexOf('preferredHouse'), H.lastIndexOf('preferredHouse'), 'exactly once');
  assert.deepEqual(H.slice(-5), ['plannedExitDate', 'preferredHouse', 'dashboardPatientId', 'dashboardPersonId', 'dashboardLeadId']);
  assert.equal(H.indexOf('phone'), 25, 'phone join key untouched');
});

test('A: preferredHouse stays once in every mirror; OP-ID-1 appends identity only to owned schemas', () => {
  const { ctx } = sandbox();
  for (const name of ['CLIENTS_REMOVED_HEADERS', 'LEADS_HEADERS', 'REMOVED_LEADS_HEADERS']) {
    const H = plain(ctx[name]); assert.equal(H.filter((h) => h === 'preferredHouse').length, 1, name);
  }
  assert.deepEqual(plain(ctx.CLIENTS_REMOVED_HEADERS).slice(-4), ['preferredHouse', 'dashboardPatientId', 'dashboardPersonId', 'dashboardLeadId']);
  assert.deepEqual(plain(ctx.LEADS_HEADERS).slice(-6), ['preferredHouse', 'dashboardPatientId', 'dashboardPersonId', 'dashboardLeadId', 'source', 'continuationKey']);
  assert.equal(plain(ctx.REMOVED_LEADS_HEADERS).slice(-1)[0], 'preferredHouse');
});

test('A: allowed list is identical in Code.gs, app.js and index.html', () => {
  const { ctx } = sandbox();
  assert.deepEqual(plain(ctx.PREFERRED_HOUSES), ALLOWED);
  const appList = APP.match(/var PREFERRED_HOUSES = (\[[^\]]*\]);/);
  assert.ok(appList, 'PREFERRED_HOUSES in app.js');
  assert.deepEqual(plain(vm.runInNewContext(appList[1])), ALLOWED);
  for (const formId of ['directClientForm', 'editClientForm']) {
    const start = HTML.indexOf('<form id="' + formId + '"');
    const form = HTML.slice(start, HTML.indexOf('</form>', start));
    const sel = form.match(/<label>בית מועדף\s*<select name="preferredHouse">([\s\S]*?)<\/select>/);
    assert.ok(sel, formId + ' has the בית מועדף dropdown');
    const values = [...sel[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)];
    assert.deepEqual(values.map((m) => m[1]), [''].concat(ALLOWED), formId + ' option values');
    assert.ok(!/<select name="preferredHouse"[^>]*required/.test(form), formId + ': optional');
  }
});

/* ============================== B. validation ============================== */

test('B: allowed labels pass (trimmed); missing/blank means none', () => {
  const { ctx } = sandbox();
  for (const v of ALLOWED) {
    assert.equal(ctx._preferredHouseOrNull(v), v);
    assert.equal(ctx._preferredHouseOrNull('  ' + v + ' '), v);
  }
  for (const v of [undefined, null, '', '   ']) assert.equal(ctx._preferredHouseOrNull(v), '', String(v));
});

test('B: every other value is rejected (null), including formula-like text and over-long input', () => {
  const { ctx } = sandbox();
  for (const v of INVALID) assert.equal(ctx._preferredHouseOrNull(v), null, JSON.stringify(v));
  assert.equal(ctx.PREFERRED_HOUSE_MAX_LEN, 40);
  assert.ok(ALLOWED.every((v) => v.length <= ctx.PREFERRED_HOUSE_MAX_LEN && !/^[=+\-@]/.test(v)));
});

/* ========================== C. setPreferredHouse =========================== */

test('C: sets and clears ONE cell under the lock, stamps who/when, leaves the rest of the row alone', () => {
  const sb = sandbox([], [base({ id: 'a', notes: 'x' }), base({ id: 'b' })]);
  const grid = sb.sheets.Clients.grid;
  const before = grid.map((r) => r.slice());
  const col = grid[0].indexOf('preferredHouse');
  let lockedDuringWrite = false;
  const realGetRange = sb.sheets.Clients.getRange;
  sb.sheets.Clients.getRange = function (...args) {
    const range = realGetRange.apply(this, args);
    const setValue = range.setValue;
    range.setValue = (v) => { if (args[1] === col + 1) lockedDuringWrite = sb.isLocked(); return setValue(v); };
    range.setValues = () => { throw new Error('whole-range rewrite is not allowed'); };
    range.clearContent = () => { throw new Error('clearContent is not allowed'); };
    return range;
  };
  const res = sb.post({ action: 'setPreferredHouse', clientId: 'a', preferredHouse: 'רמות השבים', user: 'ורד' });
  assert.deepEqual(res, { ok: true, preferredHouse: 'רמות השבים' });
  assert.equal(lockedDuringWrite, true, 'write happens while holding the script lock');
  assert.equal(sb.isLocked(), false, 'lock released');
  const [a, b] = sb.rows('Clients');
  assert.equal(a.preferredHouse, 'רמות השבים');
  assert.equal(a.updatedBy, 'ורד');
  assert.equal(b.preferredHouse, '');
  // Only preferredHouse + the who/when stamps changed on row a; row b untouched.
  const changed = [];
  grid.forEach((r, i) => r.forEach((v, j) => { if ((before[i] || [])[j] !== v && !(before[i][j] == null && v === '')) changed.push(grid[0][j] + '@' + i); }));
  assert.deepEqual(changed.sort(), ['preferredHouse@1', 'updatedAt@1', 'updatedBy@1']);
  assert.deepEqual(sb.post({ action: 'setPreferredHouse', clientId: 'a', preferredHouse: '' }), { ok: true, preferredHouse: '' });
  assert.equal(sb.rows('Clients')[0].preferredHouse, '');
});

test('C: invalid values and bad requests are rejected and write nothing', () => {
  const sb = sandbox([], [base({ id: 'a', preferredHouse: 'רעננה אשר' })]);
  const snapshot = JSON.stringify(sb.sheets.Clients.grid);
  for (const v of INVALID) {
    assert.deepEqual(sb.post({ action: 'setPreferredHouse', clientId: 'a', preferredHouse: v }),
      { ok: false, error: 'invalid_preferred_house' }, JSON.stringify(v));
  }
  assert.equal(sb.post({ action: 'setPreferredHouse', preferredHouse: 'רעננה אשר' }).error, 'missing_clientId');
  assert.equal(sb.post({ action: 'setPreferredHouse', clientId: 'nope', preferredHouse: 'רעננה אשר' }).error, 'client_not_found');
  assert.equal(JSON.stringify(sb.sheets.Clients.grid), snapshot);
});

test('C: setPreferredHouse requires the proxy credential (fail-closed)', () => {
  const sb = sandbox([], [base({ id: 'a' })]);
  for (const proxySecret of ['', 'wrong']) {
    const res = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'setPreferredHouse', proxySecret, clientId: 'a', preferredHouse: 'רעננה אשר' }) } }).getContent());
    assert.deepEqual(res, { ok: false, error: 'unauthorized' });
  }
  assert.equal(sb.rows('Clients')[0].preferredHouse, '');
});

/* ================================ D. _saveAll ============================== */

test('D: a full save never changes an existing client\'s preferredHouse (single-cell path only)', () => {
  const sb = sandbox([], [base({ id: 'a', preferredHouse: 'רעננה אשר', updatedAt: '2026-10-01T00:00:00.000Z' })]);
  const echo = sb.rows('Clients')[0];
  for (const v of ['רמות השבים', '', undefined, '=1+1']) {
    assert.equal(sb.save([], [Object.assign({}, echo, { preferredHouse: v })]).ok, true);
    const after = sb.rows('Clients')[0];
    assert.equal(after.preferredHouse, 'רעננה אשר', JSON.stringify(v));
    assert.equal(after.updatedAt, '2026-10-01T00:00:00.000Z', 'not treated as an edit');
  }
});

test('D: a brand-new client seeds from a validated value; an invalid one is not stored', () => {
  const sb = sandbox([], []);
  assert.equal(sb.save([], [base({ id: 'n1', preferredHouse: 'קיסריה ריהאב' }), base({ id: 'n2', phone: '0501234568', preferredHouse: 'קיסריה גמילה' }), base({ id: 'n3', phone: '0501234569' })]).ok, true);
  const byId = Object.fromEntries(sb.rows('Clients').map((r) => [r.id, r]));
  assert.equal(byId.n1.preferredHouse, 'קיסריה ריהאב');
  assert.equal(byId.n2.preferredHouse, '');
  assert.equal(byId.n3.preferredHouse, '');
});

test('D: a full save keeps an existing lead\'s preferredHouse (createLead is its only writer)', () => {
  const lead = { id: 'L1', name: 'דנה', stage: 'new', preferredHouse: 'רמות השבים' };
  const sb = sandbox([lead], []);
  assert.equal(sb.save([Object.assign({}, lead, { preferredHouse: 'רעננה אשר' })], []).ok, true);
  assert.equal(sb.rows('Leads')[0].preferredHouse, 'רמות השבים');
  assert.equal(sb.save([Object.assign({}, lead, { preferredHouse: undefined })], []).ok, true);
  assert.equal(sb.rows('Leads')[0].preferredHouse, 'רמות השבים');
});

/* =============================== E. createLead ============================= */

function createLead(sb, body, secret = 'lead-secret') {
  sb.props.CREATE_LEAD_SECRET = 'lead-secret';
  return JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ action: 'createLead', secret }, body)) } }).getContent());
}

test('E: createLead WITHOUT preferredHouse behaves as before (blank column)', () => {
  const sb = sandbox();
  const res = createLead(sb, { name: 'דנה כהן', phone: '054-312-3276', house: 'efroni', note: 'n' });
  assert.equal(res.ok, true);
  const [row] = sb.rows('Leads');
  assert.equal(row.id, res.id);
  assert.equal(row.name, 'דנה כהן');
  assert.equal(row.phone, '0543123276');
  assert.equal(row.house_of_origin, 'efroni');
  assert.equal(row.stage, 'new');
  assert.equal(row.preferredHouse, '');
  for (const v of [null, '']) {
    assert.equal(createLead(sb, { name: 'x', preferredHouse: v }).ok, true, JSON.stringify(v));
  }
  assert.equal(sb.rows('Leads').length, 3);
});

test('E: createLead WITH a valid preferredHouse stores it on the lead', () => {
  const sb = sandbox();
  for (const v of ALLOWED) assert.equal(createLead(sb, { name: 'x', preferredHouse: ' ' + v }).ok, true);
  assert.deepEqual(sb.rows('Leads').map((r) => r.preferredHouse), ALLOWED);
});

test('E: createLead with an invalid preferredHouse is rejected and appends nothing', () => {
  const sb = sandbox();
  for (const v of INVALID) {
    assert.deepEqual(createLead(sb, { name: 'x', preferredHouse: v }), { ok: false, error: 'invalid_preferred_house' }, JSON.stringify(v));
  }
  assert.equal(sb.rows('Leads').length, 0);
});

test('E: a bad / missing / unconfigured secret still fails closed before any field is read', () => {
  const sb = sandbox();
  for (const secret of ['wrong', '']) {
    assert.deepEqual(createLead(sb, { name: 'x', preferredHouse: 'רעננה אשר' }, secret), { ok: false, error: 'unauthorized' });
    assert.deepEqual(createLead(sb, { name: 'x', preferredHouse: '=bad' }, secret), { ok: false, error: 'unauthorized' });
  }
  sb.props.CREATE_LEAD_SECRET = null;
  const res = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'createLead', secret: 'lead-secret', name: 'x' }) } }).getContent());
  assert.deepEqual(res, { ok: false, error: 'unauthorized' });
  assert.equal(sb.rows('Leads').length, 0);
});

test('E: createLead does not dedupe by phone (unchanged behaviour)', () => {
  const sb = sandbox();
  assert.equal(createLead(sb, { name: 'a', phone: '0501111111', preferredHouse: 'רעננה אשר' }).ok, true);
  assert.equal(createLead(sb, { name: 'a', phone: '0501111111' }).ok, true);
  assert.equal(sb.rows('Leads').length, 2);
});

/* ================================== F. UI ================================== */

// Pull a small set of real app.js functions into a context to render HTML.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

test('F: preferredHouseOrBlank (browser) keeps only allowed labels', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(APP.match(/var PREFERRED_HOUSES = \[[^\]]*\];/)[0] + extractFn(APP, 'preferredHouseOrBlank'), ctx);
  for (const v of ALLOWED) assert.equal(ctx.preferredHouseOrBlank(' ' + v), v);
  for (const v of INVALID.concat([null, undefined, ''])) assert.equal(ctx.preferredHouseOrBlank(v), '', JSON.stringify(v));
});

test('F: client card renders the בית מועדף row through escapeHtml, only when set', () => {
  assert.match(APP, /var preferredHouseRow = c\.preferredHouse\s*\n\s*\? '<div class="cc-line"><span class="cc-k">בית מועדף<\/span><span class="cc-v">' \+ escapeHtml\(c\.preferredHouse\) \+ '<\/span><\/div>'\s*\n\s*: '';/);
  assert.match(APP, /plannedExitRow \+\n\s*preferredHouseRow \+/);
  // Render the row with the real escapeHtml: hostile text never becomes markup.
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFn(APP, 'escapeHtml'), ctx);
  const rowExpr = APP.match(/var preferredHouseRow = (c\.preferredHouse[\s\S]*?: '');/)[1];
  const render = (c) => vm.runInContext('(function (c) { return ' + rowExpr + '; })', ctx)(c);
  assert.equal(render({ preferredHouse: '' }), '');
  assert.equal(render({ preferredHouse: 'רמות השבים' }),
    '<div class="cc-line"><span class="cc-k">בית מועדף</span><span class="cc-v">רמות השבים</span></div>');
  const hostile = render({ preferredHouse: '<img src=x onerror=alert(1)>' });
  assert.ok(!hostile.includes('<img'), hostile);
  assert.ok(hostile.includes('&lt;img'), hostile);
});

test('F: lead card shows the handoff value as an escaped chip', () => {
  assert.match(APP, /if \(l\.preferredHouse\) \{\n\s*chipsHtml \+= '<span class="chip">בית מועדף: ' \+ escapeHtml\(l\.preferredHouse\) \+ '<\/span>';/);
});

test('F: app.js loads, prefills, edits via the single-cell action, and carries lead -> client', () => {
  assert.match(APP, /preferredHouse: preferredHouseOrBlank\(row\.preferredHouse\),/, 'read from sheet');
  assert.match(APP, /form\.preferredHouse\.value = preferredHouseOrBlank\(client\.preferredHouse\)/, 'prefilled');
  assert.match(APP, /apiPostAction\('setPreferredHouse', \{/, 'single-cell action');
  assert.match(APP, /if \(!preferredHouseChanged\) return null;\n\s*return persistPreferredHouse\(client\.id, client\.preferredHouse\)/, 'only when changed');
  assert.match(APP, /client\.preferredHouse = prevPreferredHouse;/, 'rollback on failure');
  assert.match(APP, /preferredHouse: preferredHouseOrBlank\(fd\.get\('preferredHouse'\)\)/, 'direct add');
  assert.match(APP, /preferredHouse: preferredHouseOrBlank\(lead\.preferredHouse\),/, 'activation carries the lead value');
});

test('F: Hebrew UI stays RTL', () => {
  assert.match(HTML, /<html lang="he" dir="rtl">/);
});
