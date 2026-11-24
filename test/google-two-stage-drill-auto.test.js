'use strict';
// Gate 0 one-click auto-driver and the combined-source native group-journal
// checks, executed through the in-memory Google double. NOT real Google time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../test-support/build-google-two-stage-drill.cjs');
const { runtime } = require('../test-support/google-drill-sandbox.cjs');

const scriptId = 'isolated-op03-script-0123456789-aBcDeFgHi';
const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const combined = /var SESSION_OUTCOME_OP_SHEET = 'SessionOutcomeOps';/.test(code);
const state = r => JSON.parse(r.props.OP03_NATIVE_V3_STATE);
const report = r => {
  const backup = Object.values(r.books).find(b => b.getSheetByName && b.getSheetByName('_DrillReport'));
  return backup.getSheetByName('_DrillReport').getDataRange().getValues().slice(1)
    .map(row => row.map(v => String(v).replace(/^'/, '')));
};

// Fire the scheduled one-shot trigger the way Apps Script would.
function fire(r) {
  assert.equal(r.triggers.length, 1, 'exactly one pending auto trigger');
  assert.equal(r.triggers[0].getHandlerFunction(), 'continueTwoStageDrillAuto');
  assert.equal(r.triggers[0].ms, 60000);
  return r.ctx.continueTwoStageDrillAuto();
}

test('one click runs every phase in order, one per execution, and leaves no trigger behind', () => {
  const r = runtime(build({ scriptId }).output, scriptId);
  let out = r.ctx.runTwoStageDrillAuto(), steps = 1;
  while (out.stage !== 'restored_readback') { out = fire(r); steps++; assert.ok(steps < 30); }
  assert.equal(steps, 1 + 18 + 3, 'prepare + 18 expand batches + capture + verify + restore');
  assert.equal(r.triggers.length, 0);
  assert.equal(state(r).scaleTabs, 350);
  assert.equal(state(r).failed, false);
  const phases = report(r).map(row => row[1] + ':' + row[2]);
  assert.equal(phases[0], 'prepare:PASS');
  assert.equal(phases.filter(p => p === 'scale:PASS').length, 18);
  assert.deepEqual(phases.slice(-3), ['capture:PASS', 'verify:PASS', 'restore:PASS']);
  assert.equal(JSON.stringify(r.ctx.runTwoStageDrillAuto()), JSON.stringify({ ok: true, stage: 'restored_readback', done: true, productionCertified: false }));
  assert.equal(r.triggers.length, 0, 'a finished drill never reschedules');
});

test('auto-driver stops on a failed or running phase without rescheduling or retrying', () => {
  for (const flag of ['failed', 'running']) {
    const r = runtime(build({ scriptId }).output, scriptId);
    r.ctx.runTwoStageDrillAuto();
    const s = state(r); s[flag] = true; r.props.OP03_NATIVE_V3_STATE = JSON.stringify(s);
    assert.throws(() => fire(r), /Auto drill stopped/);
    assert.equal(r.triggers.length, 0);
  }
});

test('auto-driver has a hard step budget', () => {
  const r = runtime(build({ scriptId }).output, scriptId);
  r.ctx.runTwoStageDrillAuto();
  r.props.OP03_AUTO_STEPS = '40';
  assert.throws(() => fire(r), /step budget/);
  assert.equal(r.triggers.length, 0);
});

test('auto-driver never bypasses the fresh-project guard', () => {
  const r = runtime(build({ scriptId }).output, scriptId);
  r.props.SOMETHING_PREEXISTING = 'x';
  assert.throws(() => r.ctx.runTwoStageDrillAuto(), /fresh empty standalone project/);
  assert.equal(r.triggers.length, 0);
});

test('combined source: native verify certifies the pending + committed group journal; restore resumes it ONCE',
  { skip: combined ? false : 'SessionOutcomeOps is not in this tree (needs the combined #195 candidate)' }, () => {
  const r = runtime(build({ scriptId }).output, scriptId);
  let out = r.ctx.runTwoStageDrillAuto();
  while (out.stage !== 'restored_readback') out = fire(r);
  const rows = report(r);
  assert.match(rows.find(row => row[1] === 'verify')[3], /group journal 2 rows \(1 committed, 1 pending\)/);
  assert.match(rows.find(row => row[1] === 'restore')[3], /group pending intent resumed once natively, repeat retry no-op, credit 1/);
  const target = Object.values(r.books).find(b => b.getName().endsWith(' target'));
  const ops = target.getSheetByName('SessionOutcomeOps').getDataRange().getValues();
  assert.deepEqual(ops.slice(1).map(row => row[ops[0].indexOf('state')]), ['committed', 'committed']);
  const clients = target.getSheetByName('Clients').getDataRange().getValues();
  const credit = id => Number(clients.find(row => row[0] === id)[clients[0].indexOf('creditsOwed')]);
  assert.equal(credit('native-group-client'), 1);
  assert.equal(credit('native-group-pending-client'), 1, 'no double credit after resume');
});

test('the generated Gate 0 artifact declares the trigger scope only for the isolated project upload', () => {
  const wf = fs.readFileSync(path.join(__dirname, '../.github/workflows/sandbox-drill-push.yml'), 'utf8');
  assert.match(wf, /auth\/spreadsheets","https:\/\/www\.googleapis\.com\/auth\/script\.scriptapp"/);
  assert.doesNotMatch(build({ scriptId }).output, /\bUrlFetchApp\b|\bDriveApp\b|\bGmailApp\b/);
});
