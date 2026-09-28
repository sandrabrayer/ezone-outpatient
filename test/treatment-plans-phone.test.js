'use strict';

/**
 * getTreatmentPlans phone + phoneIssue — the cross-app join key the E-Zone
 * Therapists roster is built on.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * THE BUG (2026-09-28): 14 outpatient patients never appeared in the therapists
 * app. The roster there is keyed by phone and DROPS a row whose phone yields no
 * key (ezone-therapists public/roster.js `if (!key) return;`). The feeds emitted
 * recoverPhone(phone) || recoverPhone(treatmentContactPhone) unvalidated, so a
 * client with no number vanished with no explanation on either side, and a
 * malformed non-empty `phone` short-circuited the `||`, hiding a valid
 * treatmentContactPhone behind it.
 *
 * WHAT IS UNDER TEST
 *   A. Normalization — every case (separators, +972 / 972 / 00972, the Sheets
 *      lost leading zero), and that an invalid value is NEVER guessed.
 *   B. Fallback order — `phone`, then `treatmentContactPhone`; an invalid phone
 *      falls through; payerPhone is never a candidate.
 *   C. Parity — the REAL apps-script/Code.gs, executed in a sandbox, agrees with
 *      public/phone-issue.js on every case (and public/debt-status.js too).
 *   D. The endpoints, executed: getTreatmentPlans emits phone + phoneIssue;
 *      getDebtStatus emits the SAME phone for every client (the two feeds are
 *      the roster's two base sources) with its key set unchanged; both are
 *      read-only; the doGet route and its secret gate are unchanged.
 *   E. Contract guard — the plans key set is the previous one + phoneIssue
 *      ONLY; no billing keys; CLIENTS_HEADERS untouched.
 * The patient-card chip is covered in test/phone-issue-chip.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PhoneIssue = require('../public/phone-issue.js');
const DebtStatus = require('../public/debt-status.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GS = read('apps-script/Code.gs');

/* ------------------------------------------------------------------ vectors */

// [raw cell, canonical phone] — every normalization the rule performs.
const VALID = [
  ['0501234567', '0501234567'],             // already canonical
  ['050-1234567', '0501234567'],            // dash
  ['050-123-4567', '0501234567'],           // two dashes
  ['050 123 4567', '0501234567'],           // spaces
  ['(050) 123-4567', '0501234567'],         // parentheses
  ['050.123.4567', '0501234567'],           // dots
  ['050–1234567', '0501234567'],            // en dash (not ASCII '-')
  [' 0501234567 ', '0501234567'],           // padding
  ['\t050 1234567\n', '0501234567'],   // tab / no-break space / newline
  ['+972501234567', '0501234567'],          // +972
  ['+972-50-123-4567', '0501234567'],       // +972 with separators
  ['+972 50 123 4567', '0501234567'],       // +972 with spaces
  ['972501234567', '0501234567'],           // 972 without +
  ['00972501234567', '0501234567'],         // 00972
  ['501234567', '0501234567'],              // Sheets lost the leading zero (text)
  [501234567, '0501234567'],                // Sheets lost the leading zero (number cell)
  [972501234567, '0501234567'],             // an intl number stored as a number
  ['0521234567', '0521234567'],
  ['0771234567', '0771234567']              // 10-digit 07x — canonical by the shared regex
];

// Raw cells with no digit at all -> 'missing'.
const MISSING = ['', '   ', null, undefined, '-', '()', '+', 'אין', 'לא ידוע'];

// Digits present, but no canonical mobile -> 'invalid' (never a guess).
const INVALID = [
  '031234567',                  // 9-digit landline
  '03-1234567',
  '+972-3-1234567',             // landline in intl form
  '050123456',                  // one digit short — never padded
  '05012345678',                // one digit too many — never truncated
  '0501234567 / 0527654321',    // two numbers in one cell — never picks one
  '0501234567, 0527654321',
  '9720501234567',              // +972 with the trunk zero kept -> 00501234567
  '12345',
  '1-800-123-456',
  0
];

/* ======================= A. normalization (the pure rule) ================= */

test('A: every normalization case lands on the canonical 0XXXXXXXXX form', () => {
  for (const [raw, want] of VALID) {
    assert.deepEqual(PhoneIssue.canonicalPhone(raw), { phone: want, issue: '' }, JSON.stringify(raw));
    assert.match(want, PhoneIssue.CANONICAL_PHONE_RE);
  }
});

test('A: a cell with no digit at all is "missing"', () => {
  for (const raw of MISSING) {
    assert.deepEqual(PhoneIssue.canonicalPhone(raw), { phone: '', issue: 'missing' }, JSON.stringify(raw));
  }
});

test('A: digits that are not a canonical mobile are "invalid" — and never guessed', () => {
  for (const raw of INVALID) {
    const r = PhoneIssue.canonicalPhone(raw);
    assert.deepEqual(r, { phone: '', issue: 'invalid' }, JSON.stringify(raw));
  }
});

test('A: normalization is idempotent on its own output', () => {
  for (const [raw] of VALID) {
    const once = PhoneIssue.canonicalPhone(raw).phone;
    assert.equal(PhoneIssue.canonicalPhone(once).phone, once);
    assert.equal(PhoneIssue.recoverPhone(once), once);
  }
});

test('A: the canonical regex is the one the therapists app enforces (/^0\\d{9}$/)', () => {
  assert.equal(PhoneIssue.CANONICAL_PHONE_RE.source, '^0\\d{9}$');
  assert.match(GS, /var CANONICAL_PHONE_RE = \/\^0\\d\{9\}\$\/;/);
});

/* ============================== B. fallback order ========================== */

const cap = (cl) => PhoneIssue.crossAppPhone(cl);

test('B: the order is exactly phone, then treatmentContactPhone — pinned everywhere', () => {
  assert.deepEqual(PhoneIssue.CROSS_APP_PHONE_SOURCES, ['phone', 'treatmentContactPhone']);
  assert.match(GS, /var CROSS_APP_PHONE_SOURCES = \['phone', 'treatmentContactPhone'\];/);
  assert.match(read('public/debt-status.js'), /var CROSS_APP_PHONE_SOURCES = \['phone', 'treatmentContactPhone'\];/);
});

test('B: a valid `phone` wins, even over a valid, different contact phone', () => {
  // The live-data shape behind the order decision: a legacy
  // treatmentContactPhone that holds SOMEONE ELSE's number must never re-key
  // the patient.
  assert.deepEqual(cap({ phone: '0521111111', treatmentContactPhone: '0532222222' }),
    { phone: '0521111111', phoneIssue: '' });
  // …also when the phone cell lost its leading zero in Sheets.
  assert.deepEqual(cap({ phone: 521111111, treatmentContactPhone: '0532222222' }),
    { phone: '0521111111', phoneIssue: '' });
});

test('B: a blank `phone` falls back to a valid treatmentContactPhone', () => {
  assert.deepEqual(cap({ phone: '', treatmentContactPhone: '052-765-4321' }),
    { phone: '0527654321', phoneIssue: '' });
});

test('B: an INVALID `phone` no longer hides a valid treatmentContactPhone (the short-circuit bug)', () => {
  for (const bad of INVALID) {
    assert.deepEqual(cap({ phone: bad, treatmentContactPhone: '+972 52 765 4321' }),
      { phone: '0527654321', phoneIssue: '' }, JSON.stringify(bad));
  }
});

test('B: nothing canonical -> phone "" with the reason', () => {
  assert.deepEqual(cap({ phone: '', treatmentContactPhone: '' }), { phone: '', phoneIssue: 'missing' });
  assert.deepEqual(cap({}), { phone: '', phoneIssue: 'missing' });
  assert.deepEqual(cap(null), { phone: '', phoneIssue: 'missing' });
  assert.deepEqual(cap({ phone: 'אין' }), { phone: '', phoneIssue: 'missing' });
  assert.deepEqual(cap({ phone: '050123456', treatmentContactPhone: '' }), { phone: '', phoneIssue: 'invalid' });
  assert.deepEqual(cap({ phone: '', treatmentContactPhone: '031234567' }), { phone: '', phoneIssue: 'invalid' });
  assert.deepEqual(cap({ phone: '050123456', treatmentContactPhone: '031234567' }), { phone: '', phoneIssue: 'invalid' });
});

test('B: payerPhone is never a candidate — a payer is not the patient', () => {
  assert.deepEqual(cap({ phone: '', treatmentContactPhone: '', payerPhone: '0501234567', payerName: 'הורה' }),
    { phone: '', phoneIssue: 'missing' });
  // A payer name with a number typed into it is not a candidate either.
  assert.deepEqual(cap({ payerName: 'הורה 050-1234567' }), { phone: '', phoneIssue: 'missing' });
});

test('B: phoneIssue is "" exactly when phone is non-empty', () => {
  const cells = VALID.map((v) => v[0]).concat(MISSING, INVALID);
  for (const p of cells) {
    for (const t of cells) {
      const r = cap({ phone: p, treatmentContactPhone: t });
      assert.equal(r.phone === '', r.phoneIssue !== '', JSON.stringify([p, t]));
      assert.ok(['', 'missing', 'invalid'].includes(r.phoneIssue));
      if (r.phone) assert.match(r.phone, /^0\d{9}$/);
    }
  }
});

/* ===================== C. parity with the REAL Code.gs ===================== */

function mockSheet(name, headers, rows, writes) {
  const data = [headers.slice()].concat(rows.map((r) => r.slice()));
  function range(row, col, numRows, numCols) {
    numRows = numRows || 1; numCols = numCols || 1;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = data[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      getValue() { return this.getValues()[0][0]; },
      setValue(v) { writes.push({ sheet: name, kind: 'setValue', row, col, value: v }); },
      setValues() { writes.push({ sheet: name, kind: 'setValues', row, col }); },
      clearContent() { writes.push({ sheet: name, kind: 'clearContent', row, col }); },
      setNumberFormat(f) { writes.push({ sheet: name, kind: 'setNumberFormat', row, col, format: f }); return this; },
    };
  }
  return {
    getName: () => name,
    getLastRow: () => data.length,
    getMaxRows: () => data.length,
    getLastColumn: () => headers.length,
    getRange: range,
    setFrozenRows() {},
    appendRow(r) { writes.push({ sheet: name, kind: 'appendRow', value: r.slice() }); },
  };
}

// Loads the whole Code.gs into a fresh context. `clients` are row objects
// (keyed by CLIENTS_HEADERS names); `props` are Script Properties.
function sandbox(clients, payments, props) {
  const writes = [];
  const outputs = [];
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet(n) { throw new Error('unexpected insertSheet(' + n + ')'); },
  };
  const pad = (n) => ('0' + n).slice(-2);
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Utilities: { formatDate: (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props && props[k]) || null, setProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: {
      createTextOutput(text) { outputs.push(text); return { setMimeType() { return this; } }; },
      MimeType: { JSON: 'JSON' },
    },
    MailApp: { sendEmail() {} },
    ScriptApp: {},
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  const H = ctx.CLIENTS_HEADERS;
  const toRow = (o) => H.map((h) => (o[h] === undefined ? '' : o[h]));
  sheets.Clients = mockSheet('Clients', H, (clients || []).map(toRow), writes);
  const PH = ctx.PAYMENTS_HEADERS;
  sheets.Payments = mockSheet('Payments', PH, (payments || []).map((o) => PH.map((h) => (o[h] === undefined ? '' : o[h]))), writes);
  return { ctx, writes, outputs };
}

// Plain-object copy: values built inside the vm carry that realm's
// Object.prototype, which deepStrictEqual would treat as a different shape.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('C: _canonicalPhone in Code.gs agrees with the module on every vector', () => {
  const { ctx } = sandbox([]);
  const cells = VALID.map((v) => v[0]).concat(MISSING, INVALID);
  for (const raw of cells) {
    assert.deepEqual(plain(ctx._canonicalPhone(raw)), PhoneIssue.canonicalPhone(raw), JSON.stringify(raw));
  }
});

test('C: _crossAppPhone in Code.gs agrees with the module on the full phone × contact sweep', () => {
  const { ctx } = sandbox([]);
  const cells = VALID.map((v) => v[0]).concat(MISSING, INVALID);
  let n = 0;
  for (const p of cells) {
    for (const t of cells) {
      const cl = { phone: p, treatmentContactPhone: t, payerPhone: '0509999999' };
      assert.deepEqual(plain(ctx._crossAppPhone(cl)), PhoneIssue.crossAppPhone(cl), JSON.stringify([p, t]));
      // …and the debt module's mirror emits the same join phone.
      assert.equal(DebtStatus.crossAppPhone(cl), PhoneIssue.crossAppPhone(cl).phone, JSON.stringify([p, t]));
      n++;
    }
  }
  assert.ok(n > 1000, 'the sweep is exhaustive, got ' + n);
});

test('C: every module mirrors the SAME recoverPhone as Code.gs _recoverPhone', () => {
  const { ctx } = sandbox([]);
  const cells = VALID.map((v) => v[0]).concat(MISSING, INVALID);
  for (const raw of cells) {
    const want = ctx._recoverPhone(raw);
    assert.equal(PhoneIssue.recoverPhone(raw), want, JSON.stringify(raw));
    assert.equal(DebtStatus.recoverPhone(raw), want, JSON.stringify(raw));
  }
});

/* ======================== D. the endpoints, executed ======================= */

// One client per case. Names are generic; numbers are fake.
const FIXTURE = [
  { id: 'c-valid', name: 'אורי', status: 'פעיל', phone: '0501234567' },
  { id: 'c-dashed', name: 'דנה', status: 'פעיל', phone: '052-765-4321' },
  { id: 'c-lostzero', name: 'נועם', status: 'פעיל', phone: 541234567 },          // a number cell
  { id: 'c-intl', name: 'מאיה', status: 'הפסקה זמנית', phone: '+972 54 111 1111' },
  { id: 'c-contact', name: 'רון', status: 'פעיל', phone: '', treatmentContactPhone: '0532222222' },
  { id: 'c-badphone', name: 'גל', status: 'פעיל', phone: '050123456', treatmentContactPhone: '0533333333' },
  { id: 'c-missing', name: 'יעל', status: 'פעיל', phone: '', treatmentContactPhone: '' },
  { id: 'c-payeronly', name: 'שחר', status: 'פעיל', payerName: 'הורה', payerPhone: '0544444444' },
  { id: 'c-invalid', name: 'עומר', status: 'סיים טיפול', phone: '031234567' },
  { id: 'c-twonums', name: 'ליה', status: 'פעיל', phone: '0501234567 / 0527654321' },
  { id: 'c-gone', name: 'טל', status: 'לא פעיל', phone: '' }                        // deactivated: not in the feeds
];

const EXPECTED = {
  'c-valid':     { phone: '0501234567', phoneIssue: '' },
  'c-dashed':    { phone: '0527654321', phoneIssue: '' },
  'c-lostzero':  { phone: '0541234567', phoneIssue: '' },
  'c-intl':      { phone: '0541111111', phoneIssue: '' },
  'c-contact':   { phone: '0532222222', phoneIssue: '' },
  'c-badphone':  { phone: '0533333333', phoneIssue: '' },
  'c-missing':   { phone: '', phoneIssue: 'missing' },
  'c-payeronly': { phone: '', phoneIssue: 'missing' },
  'c-invalid':   { phone: '', phoneIssue: 'invalid' },
  'c-twonums':   { phone: '', phoneIssue: 'invalid' }
};

const byId = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r]));

test('D: getTreatmentPlans (real Code.gs) emits the canonical phone + phoneIssue per client', () => {
  const { ctx } = sandbox(FIXTURE);
  const res = plain(ctx._getTreatmentPlans());
  assert.equal(res.ok, true);
  const got = byId(res.clients, 'clientId');
  assert.deepEqual(Object.keys(got).sort(), Object.keys(EXPECTED).sort(), 'deactivated client still excluded');
  for (const [id, want] of Object.entries(EXPECTED)) {
    assert.equal(got[id].phone, want.phone, id + ' phone');
    assert.equal(got[id].phoneIssue, want.phoneIssue, id + ' phoneIssue');
  }
});

test('D: getDebtStatus emits the SAME join phone as getTreatmentPlans for every client', () => {
  // The two feeds are the therapists roster's base sources; a different key for
  // one client would split that patient into two cards.
  const { ctx } = sandbox(FIXTURE);
  const plans = byId(plain(ctx._getTreatmentPlans()).clients, 'clientId');
  const debt = byId(plain(ctx._getDebtStatus()).clients, 'clientId');
  assert.deepEqual(Object.keys(debt).sort(), Object.keys(plans).sort());
  for (const id of Object.keys(plans)) assert.equal(debt[id].phone, plans[id].phone, id);
});

test('D: getDebtStatus key set is unchanged — no phoneIssue, no new key', () => {
  const { ctx } = sandbox(FIXTURE);
  for (const row of plain(ctx._getDebtStatus()).clients) {
    assert.deepEqual(Object.keys(row).sort(),
      ['amountOwed', 'clientId', 'debtStatus', 'name', 'phone', 'sourceApp']);
  }
});

test('D: the in-repo debt module (public/debt-status.js) projects the same phones', () => {
  const rows = byId(DebtStatus.computeClientDebt(FIXTURE.filter((c) => c.status !== 'לא פעיל'), []), 'clientId');
  for (const [id, want] of Object.entries(EXPECTED)) assert.equal(rows[id].phone, want.phone, id);
});

test('D: both endpoints are READ-ONLY — no cell is written, nothing appended', () => {
  const { ctx, writes } = sandbox(FIXTURE);
  ctx._getTreatmentPlans();
  ctx._getDebtStatus();
  // _ensureSheet re-applies the '@' text format to the phone columns (existing
  // behaviour); that is the only thing a read may touch.
  assert.deepEqual(writes.filter((w) => w.kind !== 'setNumberFormat'), []);
});

test('D: the doGet route serves phoneIssue, and its secret gate is unchanged', () => {
  const open = sandbox(FIXTURE);
  open.ctx.doGet({ parameter: { action: 'getTreatmentPlans' } });
  const body = JSON.parse(open.outputs[open.outputs.length - 1]);
  assert.equal(body.ok, true);
  assert.equal(byId(body.clients, 'clientId')['c-missing'].phoneIssue, 'missing');

  const gated = sandbox(FIXTURE, [], { TREATMENT_PLANS_SECRET: 's3cret' });
  gated.ctx.doGet({ parameter: { action: 'getTreatmentPlans', secret: 'wrong' } });
  assert.deepEqual(JSON.parse(gated.outputs[gated.outputs.length - 1]), { ok: false, error: 'unauthorized' });
  gated.ctx.doGet({ parameter: { action: 'getTreatmentPlans', secret: 's3cret' } });
  assert.equal(JSON.parse(gated.outputs[gated.outputs.length - 1]).ok, true);
});

/* ============================ E. contract guard ============================ */

test('E: plans key set = the previous projection + phoneIssue ONLY; no billing keys', () => {
  const { ctx } = sandbox([Object.assign({}, FIXTURE[0], {
    serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', startDate: '2026-01-15',
    // billing-side columns that must NOT leak:
    nextBillingDate: '2026-09-15', paymentStatus: 'paid', paymentDate: '2026-08-15',
    creditsOwed: 2, pricePerSession: 300, bundlePrice: 1000, paymentLink: 'https://x',
    payerName: 'הורה', payerPhone: '0544444444', paymentAmountOverrides: '{"p":1}'
  })]);
  const rows = plain(ctx._getTreatmentPlans()).clients;
  const previous = ['sourceApp', 'clientId', 'name', 'phone', 'serviceType', 'sessions',
    'status', 'startDate', 'exitDate', 'renewalDate'];
  assert.deepEqual(Object.keys(rows[0]).sort(), previous.concat('phoneIssue').sort());
  for (const k of Object.keys(rows[0])) assert.doesNotMatch(k, /pay|amount|price|charge|billing|credit/i);
  assert.doesNotMatch(JSON.stringify(rows),
    /payerName|payerPhone|paymentLink|pricePerSession|bundlePrice|paymentStatus|creditsOwed|amountDue|amountPaid|0544444444/);
});

test('E: CLIENTS_HEADERS is untouched — no column added for this', () => {
  const m = GS.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m);
  assert.doesNotMatch(m[1], /phoneIssue/);
  const { ctx } = sandbox([]);
  assert.equal(ctx.CLIENTS_HEADERS.length, 36, 'still the 36 frozen columns');
  assert.ok(!ctx.CLIENTS_HEADERS.includes('phoneIssue'));
});

test('E: phoneIssue is derived at read time, never stored', () => {
  // Every mention of phoneIssue in Code.gs must sit in the read-side helper or
  // the treatment-plans section — never in a header array or a save path.
  const allowed = [
    ['/* ===== Cross-app patient phone', '/* Columns that must be stored as plain text'],
    ['/* ===== Treatment plans (read-only cross-app endpoint)', '/* ===== Stop-treatment flags']
  ].map(([from, to]) => {
    const start = GS.indexOf(from);
    const end = GS.indexOf(to, start);
    assert.ok(start !== -1 && end > start, 'section markers found: ' + from);
    return [start, end];
  });
  const hits = Array.from(GS.matchAll(/phoneIssue/g)).map((m) => m.index);
  assert.ok(hits.length > 0);
  for (const at of hits) {
    assert.ok(allowed.some(([s, e]) => at > s && at < e),
      'phoneIssue outside the read-side sections at offset ' + at);
  }
});
