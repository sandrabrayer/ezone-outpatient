'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');

// Execute real doPost handlers. Only Sheets and the lock service are fixtures.
const cases = [
  { kind: 'payment', sheet: 'Payments', headers: 'PAYMENTS_HEADERS',
    actions: ['savePayment', 'updatePayment'], row: {
      id: 'pay::fixture-client::base::2026-10', clientId: 'fixture-client',
      billingType: 'monthly', dueDate: '2026-10-01', amountDue: 500,
      amountPaid: 500, status: 'paid', paymentDate: '2026-10-16',
      coverageStart: '2026-10-01', coverageEnd: '2026-10-31'
    } },
  { kind: 'charge', sheet: 'ClientCharges', headers: 'CHARGES_HEADERS',
    actions: ['saveCharge', 'updateCharge'], row: {
      id: 'fixture-charge', clientId: 'fixture-client', description: 'Fixture only',
      billingType: 'one_time', amount: 500, chargeDate: '2026-10-16', active: true
    } }
];

function fixture(c, existing = []) {
  const f = sandbox();
  f.seed(c.sheet, f.ctx[c.headers], existing);
  // Execute the released OP-01 authentication and real financial handlers together.
  const proxySecret = 'synthetic-financial-lock-test-key-0001';
  f.props.OUTPATIENT_PROXY_SECRET = proxySecret;
  const post = f.post;
  f.post = (payload) => post({ ...payload, proxySecret, user: 'fixture-user' });
  return f;
}

function observe(f) {
  const calls = { reads: 0, releases: 0 };
  const read = f.ctx.SpreadsheetApp.getActiveSpreadsheet;
  const release = f.lock.releaseLock;
  f.ctx.SpreadsheetApp.getActiveSpreadsheet = () => { calls.reads++; return read(); };
  f.lock.releaseLock = () => { calls.releases++; release(); };
  return calls;
}

for (const c of cases) {
  for (const action of c.actions) {
    for (const existing of [false, true]) {
      test(`${action}: denied lock cannot ${existing ? 'update' : 'create'} a row`, () => {
        const f = fixture(c, existing ? [c.row] : []);
        const before = JSON.stringify(f.sheets[c.sheet].grid);
        const calls = observe(f);
        f.lock.tryLock = () => false;
        const result = f.post({ action, [c.kind]: { ...c.row, amount: 999, amountPaid: 999 } });
        assert.deepEqual(result, { ok: false, error: 'busy' });
        assert.equal(JSON.stringify(f.sheets[c.sheet].grid), before);
        assert.deepEqual(calls, { reads: 0, releases: 0 });
      });
    }
  }

  test(`${c.kind}: lock exception cannot reach Sheets or release an unowned lock`, () => {
    const f = fixture(c);
    const calls = observe(f);
    f.lock.tryLock = () => { throw new Error('fixture lock unavailable'); };
    const result = f.post({ action: c.actions[0], [c.kind]: { ...c.row } });
    assert.equal(result.ok, false);
    assert.match(result.error, /fixture lock unavailable/);
    assert.deepEqual(calls, { reads: 0, releases: 0 });
    assert.equal(f.rows(c.sheet).length, 0);
  });

  test(`${c.kind}: successful save and repeated same-id update keep one row`, () => {
    const f = fixture(c);
    const calls = observe(f);
    const row = { ...c.row, amount: 650, amountPaid: 650 };
    assert.equal(f.post({ action: c.actions[0], [c.kind]: c.row }).created, true);
    assert.equal(f.post({ action: c.actions[1], [c.kind]: row }).updated, true);
    assert.equal(f.post({ action: c.actions[0], [c.kind]: row }).updated, true);
    assert.equal(f.rows(c.sheet).length, 1);
    for (const h of f.ctx[c.headers]) assert.equal(f.rows(c.sheet)[0][h], row[h] ?? '');
    assert.equal(calls.releases, 3);
    assert.equal(f.isLocked(), false);
  });

  test(`${c.kind}: write failure returns failure and releases its owned lock`, () => {
    const f = fixture(c);
    const calls = observe(f);
    f.sheets[c.sheet].appendRow = () => { throw new Error('fixture write failed'); };
    const result = f.post({ action: c.actions[0], [c.kind]: { ...c.row } });
    assert.equal(result.ok, false);
    assert.match(result.error, /fixture write failed/);
    assert.equal(f.rows(c.sheet).length, 0);
    assert.equal(calls.releases, 1);
    assert.equal(f.isLocked(), false);
  });

  test(`${c.kind}: retry with the same id after an ambiguous append cannot duplicate`, () => {
    const f = fixture(c);
    const calls = observe(f);
    const append = f.sheets[c.sheet].appendRow;
    f.sheets[c.sheet].appendRow = (row) => {
      append(row);
      throw new Error('fixture response lost after append');
    };
    const payload = { action: c.actions[0], [c.kind]: { ...c.row } };
    assert.equal(f.post(payload).ok, false);
    assert.equal(f.rows(c.sheet).length, 1);
    f.sheets[c.sheet].appendRow = append;
    assert.equal(f.post(payload).updated, true);
    assert.equal(f.rows(c.sheet).length, 1);
    assert.equal(calls.releases, 2);
    assert.equal(f.isLocked(), false);
  });

  test(`${c.kind}: a competing save is refused while the first writer owns the lock`, () => {
    const f = fixture(c);
    const calls = observe(f);
    const acquire = f.lock.tryLock;
    f.lock.tryLock = () => !f.isLocked() && acquire();
    const append = f.sheets[c.sheet].appendRow;
    let competing;
    f.sheets[c.sheet].appendRow = (row) => {
      // The competitor must return before accessing this same sheet/append.
      const originalAppend = f.sheets[c.sheet].appendRow;
      f.sheets[c.sheet].appendRow = append;
      competing = f.post({ action: c.actions[0], [c.kind]: { ...c.row, id: 'competing' } });
      f.sheets[c.sheet].appendRow = originalAppend;
      assert.equal(f.isLocked(), true);
      return append(row);
    };
    assert.equal(f.post({ action: c.actions[0], [c.kind]: { ...c.row } }).ok, true);
    assert.deepEqual(competing, { ok: false, error: 'busy' });
    assert.deepEqual(f.rows(c.sheet).map((r) => r.id), [c.row.id]);
    assert.equal(calls.releases, 1);
  });

  const single = c.kind === 'payment' ? 'removePayment' : 'removeCharge';
  const bulk = c.kind === 'payment' ? 'removePaymentsForClient' : 'removeChargesForClient';
  for (const action of [single, bulk]) {
    test(`${action}: timeout preserves all rows and never releases an unowned lock`, () => {
      const f = fixture(c, [c.row]);
      const calls = observe(f);
      const before = JSON.stringify(f.sheets[c.sheet].grid);
      f.lock.waitLock = () => { throw new Error('fixture lock timeout'); };
      const result = f.post({ action, id: c.row.id, clientId: c.row.clientId });
      assert.equal(result.ok, false);
      assert.match(result.error, /fixture lock timeout/);
      assert.equal(JSON.stringify(f.sheets[c.sheet].grid), before);
      assert.deepEqual(calls, { reads: 0, releases: 0 });
    });

    test(`${action}: deletion failure releases the owned lock and reports failure`, () => {
      const f = fixture(c, [c.row]);
      const calls = observe(f);
      f.sheets[c.sheet].deleteRow = () => { throw new Error('fixture deletion failed'); };
      const result = f.post({ action, id: c.row.id, clientId: c.row.clientId });
      assert.equal(result.ok, false);
      assert.equal(f.rows(c.sheet).length, 1);
      assert.equal(calls.releases, 1);
      assert.equal(f.isLocked(), false);
    });

    test(`${action}: repeated deletion preserves unrelated rows`, () => {
      const other = { ...c.row, id: 'other-record', clientId: 'other-client' };
      const f = fixture(c, [c.row, other, ...(action === bulk ? [{ ...c.row, id: 'second' }] : [])]);
      const calls = observe(f);
      const payload = { action, id: c.row.id, clientId: c.row.clientId };
      assert.equal(f.post(payload).ok, true);
      const retry = f.post(payload);
      assert.deepEqual(retry, action === bulk
        ? { ok: true, removed: 0, clientId: c.row.clientId }
        : { ok: false, error: 'not_found' });
      assert.deepEqual(f.rows(c.sheet).map((r) => r.id), ['other-record']);
      assert.equal(calls.releases, 2);
      assert.equal(f.isLocked(), false);
    });
  }
}

// Integration: no handler stubs. A financial request denied by OP-01 must
// never contend for the OP-02 lock, read a sheet, or change an existing row.
for (const c of cases) {
  const actions = c.actions.concat(c.kind === 'payment'
    ? ['removePayment', 'removePaymentsForClient']
    : ['removeCharge', 'removeChargesForClient']);
  for (const action of actions) {
    for (const denied of ['missing', 'wrong', 'consumer-only', 'unconfigured']) {
      test(`${action}: ${denied} credential cannot reach the lock or Sheets`, () => {
        const f = sandbox();
        f.seed(c.sheet, f.ctx[c.headers], [c.row]);
        const before = JSON.stringify(f.sheets[c.sheet].grid);
        const calls = observe(f);
        let locks = 0;
        f.ctx.LockService.getScriptLock = () => { locks++; return f.lock; };
        const good = f.props.OUTPATIENT_PROXY_SECRET;
        f.props.DEBT_STATUS_SECRET = 'synthetic-read-only-consumer';
        if (denied === 'unconfigured') delete f.props.OUTPATIENT_PROXY_SECRET;
        const credentials = denied === 'wrong' ? { proxySecret: 'wrong' }
          : denied === 'consumer-only' ? { secret: f.props.DEBT_STATUS_SECRET }
          : denied === 'unconfigured' ? { proxySecret: good } : {};
        // Call doPost directly: the sandbox convenience wrapper injects a key.
        const result = JSON.parse(f.ctx.doPost({ parameter: {}, postData: {
          contents: JSON.stringify({ action, [c.kind]: { ...c.row, amountPaid: 999 },
            id: c.row.id, clientId: c.row.clientId, ...credentials })
        } }).getContent());
        assert.deepEqual(result, { ok: false, error: 'unauthorized' });
        assert.equal(JSON.stringify(f.sheets[c.sheet].grid), before);
        assert.deepEqual(calls, { reads: 0, releases: 0 });
        assert.equal(locks, 0);
      });
    }
  }

  test(`${c.kind}: release failure does not disguise a confirmed save`, () => {
    const f = fixture(c);
    let releases = 0;
    f.lock.releaseLock = () => { releases++; throw new Error('fixture release failed'); };
    const result = f.post({ action: c.actions[0], [c.kind]: { ...c.row } });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.deepEqual(f.rows(c.sheet).map((row) => row.id), [c.row.id]);
    assert.equal(releases, 1);
  });
}
