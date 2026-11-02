'use strict';

// Release compatibility against the verbatim deployed financial validator.
// The rest of the journal code is the actual candidate source; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { fixture, failWrite } = require('../test-support/renewal-journal-fixture.cjs');
const legacyValidator = require('../test-support/op-bill01-legacy-validator.cjs');

function oldPolicy(f) { vm.runInContext(legacyValidator, f.sb.ctx); }
function oldRequest(f) {
  f.request.patch.nextBillingDate = '2026-03-31';
  f.request.payment.coverageStart = '2026-02-28';
  f.request.payment.coverageEnd = '2026-03-27';
}
function data(f) { return JSON.stringify(['Clients', 'Payments', 'FinancialOps'].map(n => f.sb.rows(n))); }

test('release transition: new UI intent is refused by the deployed old policy without financial effects', () => {
  const f = fixture(); oldPolicy(f);
  const before = data(f);
  assert.equal(f.reserve().error, 'renewal_period_changed');
  assert.equal(data(f), before);
});

for (const phase of ['prepared', 'client_done', 'payment_written']) {
  test('release transition: new source resumes the stored legacy ' + phase + ' intent unchanged, once', () => {
    const f = fixture(), currentValidator = f.sb.ctx._finIntentError;
    oldPolicy(f); oldRequest(f);
    assert.equal(f.reserve().operation.state, 'prepared');
    if (phase !== 'prepared') {
      if (phase === 'client_done') failWrite(f.sb, 'FinancialOps', 'payment_writing', 'before');
      else failWrite(f.sb, 'Payments', null, 'after');
      assert.equal(f.apply().ok, false);
    }
    const originalIntent = f.sb.rows('FinancialOps')[0].intent;
    f.sb.ctx._finIntentError = currentValidator;
    assert.equal(f.discover().operation.id, f.request.opId);
    assert.equal(f.apply().operation.state, 'done');
    assert.equal(f.apply().operation.state, 'done');
    assert.equal(f.sb.rows('FinancialOps')[0].intent, originalIntent);
    assert.equal(f.sb.rows('Clients')[0].nextBillingDate, '2026-03-31');
    assert.equal(f.sb.rows('Payments').length, 1);
    assert.equal(f.sb.rows('Payments')[0].coverageStart, '2026-02-28');
    assert.equal(f.sb.rows('Payments')[0].coverageEnd, '2026-03-27');
  });
}

for (const state of ['prepared', 'acknowledged']) {
  test('rollback boundary: old source handles new paid-date ' + state + ' journal without reinterpretation', () => {
    const f = fixture();
    assert.equal(f.reserve().operation.state, 'prepared');
    if (state === 'acknowledged') { f.apply(); f.ack(); }
    const before = data(f);
    oldPolicy(f);
    const discovered = f.discover();
    assert.equal(discovered.ok, state === 'acknowledged',
      'pending new intent blocks an old-source rollback; acknowledged history remains readable');
    if (state === 'acknowledged') assert.equal(discovered.cycleDate, '2026-03-25');
    assert.equal(data(f), before);
  });
}
