'use strict';

/**
 * Coverage for the one-off stale nextBillingDate repair (apps-script/Code.gs):
 * _nextCycleDueDate, _planStaleNextBillingRepair, _writeNextBillingDate,
 * _repairStaleNextBilling + the editor helpers.
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Three styles, matching the passing suites:
 *
 * 1. REAL-CODE extraction (the nightly-integrity pattern): the pure helpers use
 *    no GAS services, so their source is extracted from Code.gs (balanced
 *    braces) and eval'd — the tests run the ACTUAL deployed logic.
 *
 * 2. VM SANDBOX: the whole Code.gs is loaded into a vm context with mocked
 *    SpreadsheetApp / LockService / Logger / Utilities / Session, backed by
 *    in-memory sheets that RECORD every setValue/setValues. This proves the
 *    write contract cell by cell: dry-run writes NOTHING; apply writes exactly
 *    the planned nextBillingDate cells and nothing else.
 *
 * 3. SOURCE-SCAN guards: doPost routing, single-cell (header-derived, never
 *    _writeAll) writes, LockService on apply, editor helpers, and the frozen
 *    CLIENTS_HEADERS order.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// --- extract a whole `function name(...) {...}` out of Code.gs (balanced) ----
function gsFunction(name) {
  const sig = 'function ' + name + '(';
  const start = GS.indexOf(sig);
  assert.notEqual(start, -1, name + ' not found in Code.gs');
  const open = GS.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = open; j < GS.length; j++) {
    if (GS[j] === '{') depth++;
    else if (GS[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.notEqual(end, -1, name + ' has unbalanced braces');
  return GS.slice(start, end + 1);
}

// --- extract a single-line `var NAME = <literal>;` declaration ---------------
function gsVarDecl(name) {
  const m = GS.match(new RegExp('var ' + name + '\\s*=\\s*[^\\n]*;'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[0];
}

// --- array-of-strings literal (the saveall-tombstone pattern) ----------------
function gsHeaders(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

const CLIENTS_HEADERS = gsHeaders('CLIENTS_HEADERS');
const PAYMENTS_HEADERS = gsHeaders('PAYMENTS_HEADERS');

// Build the pure helpers from the REAL Code.gs source.
const PURE_SRC = [
  gsVarDecl('DEACTIVATED_CLIENT_STATUS_HE'),
  gsFunction('_clampDayIso'),
  gsFunction('_nextCycleDueDate'),
  gsFunction('_prevMonthKey'),
  gsFunction('_isUnpaidishStatus'),
  gsFunction('_planStaleNextBillingRepair'),
].join('\n');

// eslint-disable-next-line no-new-func
const g = new Function(PURE_SRC + `
  return {
    nextCycleDueDate: _nextCycleDueDate,
    prevMonthKey: _prevMonthKey,
    isUnpaidishStatus: _isUnpaidishStatus,
    plan: _planStaleNextBillingRepair,
  };
`)();

// ─────────────────────────────────────────────────────────────────────────────
// _nextCycleDueDate (pure)
// ─────────────────────────────────────────────────────────────────────────────

test('nextCycleDueDate: billingDay wins over startDate day-of-month', () => {
  const cl = { billingDay: 10, startDate: '2026-03-05' };
  assert.equal(g.nextCycleDueDate(cl, '2026-09-01'), '2026-09-10');
});

test('nextCycleDueDate: falls back to the startDate day when billingDay is blank', () => {
  assert.equal(g.nextCycleDueDate({ billingDay: '', startDate: '2026-03-07' }, '2026-09-01'), '2026-09-07');
  assert.equal(g.nextCycleDueDate({ startDate: '2025-11-21' }, '2026-09-01'), '2026-09-21');
});

test('nextCycleDueDate: billing day 31 clamps to the month end (30 / 28)', () => {
  assert.equal(g.nextCycleDueDate({ billingDay: 31 }, '2026-09-01'), '2026-09-30');
  assert.equal(g.nextCycleDueDate({ billingDay: 31 }, '2026-02-01'), '2026-02-28');
  // Leap year February keeps the 29th.
  assert.equal(g.nextCycleDueDate({ billingDay: 31 }, '2028-02-01'), '2028-02-29');
});

test('nextCycleDueDate: a candidate before today rolls to the same day next month', () => {
  assert.equal(g.nextCycleDueDate({ billingDay: 4 }, '2026-09-15'), '2026-10-04');
  // The roll clamps again: day 31 from mid-September lands on Oct 31; day 30
  // from mid-February lands on Feb 28 first, so from Feb 28 it stays.
  assert.equal(g.nextCycleDueDate({ billingDay: 31 }, '2026-10-31'), '2026-10-31');
  // December -> January rolls the year.
  assert.equal(g.nextCycleDueDate({ billingDay: 4 }, '2026-12-10'), '2027-01-04');
});

test('nextCycleDueDate: a candidate equal to today stays (due today, not next month)', () => {
  assert.equal(g.nextCycleDueDate({ billingDay: 15 }, '2026-09-15'), '2026-09-15');
});

test('nextCycleDueDate: no billingDay and no startDate -> ""', () => {
  assert.equal(g.nextCycleDueDate({}, '2026-09-01'), '');
  assert.equal(g.nextCycleDueDate({ billingDay: '', startDate: '' }, '2026-09-01'), '');
  assert.equal(g.nextCycleDueDate(null, '2026-09-01'), '');
  // Garbage billingDay with no startDate anchors nothing.
  assert.equal(g.nextCycleDueDate({ billingDay: 'banana' }, '2026-09-01'), '');
});

test('prevMonthKey: month and year boundaries', () => {
  assert.equal(g.prevMonthKey('2026-09-01'), '2026-08');
  assert.equal(g.prevMonthKey('2026-01-15'), '2025-12');
  assert.equal(g.prevMonthKey('garbage'), '');
});

test('isUnpaidishStatus: unpaid/partial in English and Hebrew; paid/blank are not', () => {
  assert.equal(g.isUnpaidishStatus('unpaid'), true);
  assert.equal(g.isUnpaidishStatus('partial'), true);
  assert.equal(g.isUnpaidishStatus('לא שולם'), true);
  assert.equal(g.isUnpaidishStatus('שולם חלקית'), true);
  assert.equal(g.isUnpaidishStatus('paid'), false);
  assert.equal(g.isUnpaidishStatus(''), false);
  assert.equal(g.isUnpaidishStatus(null), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// _planStaleNextBillingRepair (pure) — classification
// ─────────────────────────────────────────────────────────────────────────────

const TODAY = '2026-09-01';

function client(over) {
  return Object.assign({
    id: 'c1', name: 'דנה כהן', status: 'פעיל',
    billingDay: 10, startDate: '2026-01-05', nextBillingDate: '2026-07-10',
  }, over);
}
function paidBaseRow(cid, mk) {
  return {
    id: 'pay::' + cid + '::base::' + mk, clientId: cid,
    dueDate: mk + '-10', status: 'paid',
  };
}

test('plan: stale date + paid previous month -> fix with the next cycle date', () => {
  const p = g.plan([client()], [paidBaseRow('c1', '2026-08')], TODAY);
  assert.deepEqual(p.fix, [{ id: 'c1', name: 'דנה כהן', from: '2026-07-10', to: '2026-09-10' }]);
  assert.deepEqual(p.skippedOverdue, []);
  assert.deepEqual(p.skippedNoAnchor, []);
});

test('plan: NO previous-month row at all still fixes (only an explicit unpaid row skips)', () => {
  const p = g.plan([client()], [], TODAY);
  assert.equal(p.fix.length, 1);
  assert.equal(p.fix[0].to, '2026-09-10');
});

test('plan: a future or blank nextBillingDate is untouched', () => {
  const p = g.plan([
    client({ id: 'f1', nextBillingDate: '2026-09-10' }),
    client({ id: 'f2', nextBillingDate: TODAY }),        // today is not stale
    client({ id: 'b1', nextBillingDate: '' }),
  ], [], TODAY);
  assert.deepEqual(p.fix, []);
  assert.deepEqual(p.skippedOverdue, []);
  assert.deepEqual(p.skippedNoAnchor, []);
});

test('plan: discharged and deactivated clients are skipped entirely', () => {
  const p = g.plan([
    client({ id: 'd1', status: 'סיים טיפול' }),
    client({ id: 'd2', status: 'לא פעיל' }),
  ], [], TODAY);
  assert.deepEqual(p, { fix: [], skippedOverdue: [], skippedNoAnchor: [] });
});

test('plan: unpaid previous-month BASE row -> skippedOverdue (banner stays red)', () => {
  const unpaid = { id: 'pay::c1::base::2026-08', clientId: 'c1', dueDate: '2026-08-10', status: 'unpaid' };
  const p = g.plan([client()], [unpaid], TODAY);
  assert.deepEqual(p.fix, []);
  assert.deepEqual(p.skippedOverdue, [{ id: 'c1', name: 'דנה כהן', from: '2026-07-10' }]);
});

test('plan: partial previous-month base row also -> skippedOverdue', () => {
  const partial = { id: 'pay::c1::base::2026-08', clientId: 'c1', dueDate: '2026-08-10', status: 'partial' };
  assert.equal(g.plan([client()], [partial], TODAY).skippedOverdue.length, 1);
});

test('plan: an unpaid EXTRA charge (::chg-) in the previous month does NOT block the fix', () => {
  const extra = { id: 'pay::c1::chg-x9::2026-08', clientId: 'c1', dueDate: '2026-08-15', status: 'unpaid' };
  const p = g.plan([client()], [extra], TODAY);
  assert.equal(p.fix.length, 1);
  assert.deepEqual(p.skippedOverdue, []);
});

test('plan: unpaid rows in OTHER months do not block; legacy base id counts', () => {
  const oldUnpaid = { id: 'pay::c1::base::2026-06', clientId: 'c1', dueDate: '2026-06-10', status: 'unpaid' };
  assert.equal(g.plan([client()], [oldUnpaid], TODAY).fix.length, 1);
  const legacyUnpaid = { id: 'pay::c1::2026-08', clientId: 'c1', dueDate: '2026-08-10', status: 'unpaid' };
  assert.equal(g.plan([client()], [legacyUnpaid], TODAY).skippedOverdue.length, 1);
});

test('plan: no billingDay and no startDate -> skippedNoAnchor', () => {
  const p = g.plan([client({ billingDay: '', startDate: '' })], [], TODAY);
  assert.deepEqual(p.fix, []);
  assert.deepEqual(p.skippedNoAnchor, [{ id: 'c1', name: 'דנה כהן', from: '2026-07-10' }]);
});

test('plan: to === from is skipped (guard exercised via a stubbed cycle rule)', () => {
  // from < today and to >= today can never be equal through the real
  // _nextCycleDueDate; stub it to prove the defensive guard drops the row
  // instead of writing a no-op.
  // eslint-disable-next-line no-new-func
  const planWithStub = new Function(
    gsVarDecl('DEACTIVATED_CLIENT_STATUS_HE') + '\n' +
    gsFunction('_prevMonthKey') + '\n' +
    gsFunction('_isUnpaidishStatus') + '\n' +
    'function _nextCycleDueDate() { return "2026-07-10"; }\n' +
    gsFunction('_planStaleNextBillingRepair') +
    '\nreturn _planStaleNextBillingRepair;'
  )();
  const p = planWithStub([client()], [], TODAY);
  assert.deepEqual(p, { fix: [], skippedOverdue: [], skippedNoAnchor: [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// VM sandbox: the write contract, cell by cell
// ─────────────────────────────────────────────────────────────────────────────

// In-memory sheet: 2D array incl. header row; records every value write.
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
      setValue(v) {
        writes.push({ sheet: name, row, col, value: v, kind: 'setValue' });
        (data[row - 1] = data[row - 1] || [])[col - 1] = v;
      },
      setValues(vals) {
        writes.push({ sheet: name, row, col, numRows, numCols, kind: 'setValues' });
        for (let r = 0; r < vals.length; r++) {
          for (let c = 0; c < vals[r].length; c++) {
            (data[row - 1 + r] = data[row - 1 + r] || [])[col - 1 + c] = vals[r][c];
          }
        }
      },
      clearContent() { writes.push({ sheet: name, row, col, kind: 'clearContent' }); },
      setNumberFormat() { return this; },
    };
  }
  return {
    _data: data,
    getName: () => name,
    getLastRow: () => data.length,
    getMaxRows: () => data.length,
    getLastColumn: () => headers.length,
    getRange: range,
    setFrozenRows() {},
    appendRow(r) { writes.push({ sheet: name, kind: 'appendRow' }); data.push(r.slice()); },
  };
}

function clientRow(over) {
  const obj = Object.assign({
    id: '', name: '', status: 'פעיל', billingDay: '', startDate: '', nextBillingDate: '',
  }, over);
  return CLIENTS_HEADERS.map((h) => (obj[h] === undefined ? '' : obj[h]));
}
function paymentRow(over) {
  const obj = Object.assign({}, over);
  return PAYMENTS_HEADERS.map((h) => (obj[h] === undefined ? '' : obj[h]));
}

function makeSandbox(clientRows, paymentRows) {
  const writes = [];
  const sheets = {
    Clients: mockSheet('Clients', CLIENTS_HEADERS, clientRows, writes),
    Payments: mockSheet('Payments', PAYMENTS_HEADERS, paymentRows, writes),
  };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet(n) { throw new Error('unexpected insertSheet(' + n + ')'); },
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: {
      createTextOutput: () => ({ setMimeType() { return this; }, setContent() { return this; } }),
      MimeType: { JSON: 'JSON' },
    },
    MailApp: { sendEmail() {} },
    ScriptApp: {},
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  return { ctx, writes, sheets };
}

const NBD_COL = CLIENTS_HEADERS.indexOf('nextBillingDate') + 1;

const STALE_CLIENTS = [
  clientRow({ id: 'c1', name: 'דנה', billingDay: 10, nextBillingDate: '2026-07-10' }), // fix
  clientRow({ id: 'c2', name: 'יוסי', billingDay: 4, nextBillingDate: '2026-08-04' }),  // fix
  clientRow({ id: 'c3', name: 'רות', billingDay: 5, nextBillingDate: '2026-08-05' }),   // overdue -> skip
  clientRow({ id: 'c4', name: 'גיל', billingDay: 7, nextBillingDate: '2026-10-07' }),   // future -> untouched
  clientRow({ id: 'c5', name: 'נעה', status: 'סיים טיפול', billingDay: 3, nextBillingDate: '2026-06-03' }),
];
const STALE_PAYMENTS = [
  paymentRow({ id: 'pay::c3::base::2026-08', clientId: 'c3', dueDate: '2026-08-05', status: 'unpaid' }),
  paymentRow({ id: 'pay::c1::base::2026-08', clientId: 'c1', dueDate: '2026-08-10', status: 'paid' }),
];

test('vm: dry-run returns the plan and performs ZERO value writes', () => {
  const { ctx, writes } = makeSandbox(STALE_CLIENTS, STALE_PAYMENTS);
  const res = ctx._repairStaleNextBilling('0', TODAY);
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.equal(res.applied, 0);
  // Array.from into this realm: vm-created arrays fail strict prototype equality.
  assert.deepEqual(Array.from(res.plan.fix, (f) => f.id), ['c1', 'c2']);
  assert.deepEqual(Array.from(res.plan.skippedOverdue, (f) => f.id), ['c3']);
  const valueWrites = writes.filter((w) => w.kind === 'setValue' || w.kind === 'setValues' ||
    w.kind === 'appendRow' || w.kind === 'clearContent');
  assert.deepEqual(valueWrites, [], 'dry-run must not write anything');
});

test('vm: apply writes EXACTLY the planned nextBillingDate cells and nothing else', () => {
  const { ctx, writes, sheets } = makeSandbox(STALE_CLIENTS, STALE_PAYMENTS);
  const res = ctx._repairStaleNextBilling('1', TODAY);
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, false);
  assert.equal(res.applied, 2);
  const valueWrites = writes.filter((w) => w.kind !== 'setNumberFormat');
  // Single-cell setValue calls only, on the Clients sheet: the nextBillingDate
  // cell on the c1/c2 rows (sheet rows 2 and 3), each followed by that row's
  // who/when stamp (updatedAt = ISO now, updatedBy = '' — no session user on
  // the repair path). Nothing else is written.
  const AT_COL = CLIENTS_HEADERS.indexOf('updatedAt') + 1;
  const BY_COL = CLIENTS_HEADERS.indexOf('updatedBy') + 1;
  assert.deepEqual(valueWrites.filter((w) => w.col === NBD_COL), [
    { sheet: 'Clients', row: 2, col: NBD_COL, value: '2026-09-10', kind: 'setValue' },
    { sheet: 'Clients', row: 3, col: NBD_COL, value: '2026-09-04', kind: 'setValue' },
  ]);
  const stampWrites = valueWrites.filter((w) => w.col === AT_COL || w.col === BY_COL);
  assert.deepEqual(stampWrites.map((w) => [w.sheet, w.row, w.col, w.kind]), [
    ['Clients', 2, AT_COL, 'setValue'], ['Clients', 2, BY_COL, 'setValue'],
    ['Clients', 3, AT_COL, 'setValue'], ['Clients', 3, BY_COL, 'setValue'],
  ]);
  stampWrites.filter((w) => w.col === AT_COL).forEach((w) => assert.match(String(w.value), /^\d{4}-\d{2}-\d{2}T/));
  stampWrites.filter((w) => w.col === BY_COL).forEach((w) => assert.equal(w.value, ''));
  assert.equal(valueWrites.length, 6, 'nbd + 2 stamps per repaired row, nothing else');
  // And the cells actually hold the new dates; every other row is untouched.
  assert.equal(sheets.Clients._data[1][NBD_COL - 1], '2026-09-10');
  assert.equal(sheets.Clients._data[2][NBD_COL - 1], '2026-09-04');
  assert.equal(sheets.Clients._data[3][NBD_COL - 1], '2026-08-05'); // overdue, left stale on purpose
  assert.equal(sheets.Clients._data[4][NBD_COL - 1], '2026-10-07');
  assert.equal(sheets.Clients._data[5][NBD_COL - 1], '2026-06-03'); // discharged, untouched
});

test('vm: apply is fail-soft on a row that vanished (MISS logged, others still written)', () => {
  // Plan is computed over _readAll output; drop c1 from the sheet between
  // plan and write by planning against a client list where c1 has no row id.
  const rows = STALE_CLIENTS.map((r) => r.slice());
  const { ctx, writes } = makeSandbox(rows, STALE_PAYMENTS);
  // Simulate the vanish: blank c1's id column cell before applying.
  const idCol = CLIENTS_HEADERS.indexOf('id');
  // _readAll skips fully-empty rows only; keep the row but change its id so the
  // plan (built from the same sheet) contains the ORIGINAL id via a pre-plan.
  const plan = ctx._planStaleNextBillingRepair(
    [{ id: 'ghost', name: 'x', status: 'פעיל', billingDay: 9, nextBillingDate: '2026-07-09' }],
    [], TODAY);
  assert.equal(plan.fix.length, 1);
  assert.equal(ctx._writeNextBillingDate(ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Clients'), 'ghost', '2026-09-09'), false);
  assert.deepEqual(writes.filter((w) => w.kind === 'setValue'), [], 'a no-hit id writes nothing');
  assert.equal(rows[0][idCol], 'c1');
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards
// ─────────────────────────────────────────────────────────────────────────────

test('the repairStaleNextBilling action is routed in doPost (dry-run default, apply param)', () => {
  assert.ok(/action === 'repairStaleNextBilling'/.test(GS), 'router entry missing');
  assert.ok(/_repairStaleNextBilling\(rsApply/.test(GS), 'router must forward the apply param');
});

test('_writeNextBillingDate derives columns via CLIENTS_HEADERS.indexOf (never a literal)', () => {
  const body = gsFunction('_writeNextBillingDate');
  assert.ok(/CLIENTS_HEADERS\.indexOf\('id'\)\s*\+\s*1/.test(body), 'idCol must be header-derived');
  assert.ok(/CLIENTS_HEADERS\.indexOf\('nextBillingDate'\)\s*\+\s*1/.test(body), 'nextBillingDate col must be header-derived');
  assert.ok(/\.setValue\(/.test(body), 'must do a single-cell setValue');
  assert.ok(!/getRange\([^,]+,\s*\d+\)\.setValue/.test(body), 'must not write a hardcoded column index');
});

test('_repairStaleNextBilling: LockService on apply, single-cell writes only, never _writeAll', () => {
  const body = gsFunction('_repairStaleNextBilling');
  assert.ok(/LockService\.getScriptLock\(\)/.test(body), 'uses LockService');
  assert.ok(/_writeNextBillingDate\(/.test(body), 'writes via the single-cell helper');
  assert.ok(!body.includes('_writeAll('), 'must never rewrite the whole Clients sheet');
  assert.ok(!body.includes('.setValues('), 'no bulk writes');
  assert.ok(/Logger\.log/.test(body), 'logs each write');
});

test('editor helpers exist: preview logs the plan; apply logs before/after', () => {
  const preview = gsFunction('previewStaleNextBillingRepairNow');
  assert.ok(/_repairStaleNextBilling\('0'\)/.test(preview), 'preview must be a dry-run');
  assert.ok(!preview.includes("'1'"), 'preview must never apply');
  const apply = gsFunction('applyStaleNextBillingRepairNow');
  assert.ok(/_repairStaleNextBilling\('0'\)/.test(apply), 'apply logs the before-plan (dry-run first)');
  assert.ok(/_repairStaleNextBilling\('1'\)/.test(apply), 'then applies');
  assert.ok(/Logger\.log/.test(preview) && /Logger\.log/.test(apply));
});

test('CLIENTS_HEADERS: 36 append-only columns — paymentAmountOverrides then the who/when stamps', () => {
  assert.equal(CLIENTS_HEADERS[0], 'id');
  assert.deepEqual(CLIENTS_HEADERS.slice(-3), ['paymentAmountOverrides', 'updatedAt', 'updatedBy']);
  assert.equal(CLIENTS_HEADERS.length, 36);
  assert.ok(CLIENTS_HEADERS.includes('nextBillingDate'));
});
