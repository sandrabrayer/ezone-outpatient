'use strict';
// OP-03 #124: production nightly backup hit Google's 360 s hard limit
// (23 Nov 341.678 s Completed, 24 Nov 360.864 s Timed Out) and the killed run
// stranded INTEGRITY_ACTIVE_BACKUP, so 25 Nov refused with backup_busy.
// The real Code.gs job runs here against synthetic Google services only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/backup-sandbox.cjs');

const MIN = 60 * 1000;

function scriptApp() {
  const triggers = [];
  return {
    triggers,
    api: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: handler => ({ timeBased: () => ({ after: ms => ({ create: () => {
        const t = { getHandlerFunction: () => handler, delayMs: ms };
        triggers.push(t); return t;
      } }) }) })
    }
  };
}

// Each clock read advances `step` ms: with 30 s steps a 200 s segment budget
// admits only a handful of snapshot writes, forcing several segments.
function world({ step = 0 } = {}) {
  const h = harness(), sa = scriptApp();
  h.ctx.ScriptApp = sa.api;
  let now = Date.now();
  h.ctx._integrityNowMs = () => { const t = now; now += step; return t; };
  h.setStep = s => { step = s; };
  h.triggers = sa.triggers;
  h.day = h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  return h;
}
const writesTo = (h, name) => h.events.filter(e => e[0] === 'rename' && e[2] === name).length;
function drain(h, first) {
  let result = first, segments = 1;
  while (result && result.state === 'continuing') {
    assert.ok(segments < 10, 'bounded number of segments');
    const pending = h.triggers.filter(t => t.getHandlerFunction() === 'resumeNightlyIntegrityJob');
    assert.equal(pending.length, 1, 'exactly one continuation trigger between segments');
    assert.equal(pending[0].delayMs, 60 * 1000);
    assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined, 'segment releases its marker');
    result = h.ctx.resumeNightlyIntegrityJob();
    segments++;
  }
  return { result, segments };
}

test('a budget-limited run continues in segments and publishes ONE verified set', () => {
  const h = world({ step: 30 * 1000 });
  const first = h.ctx.nightlyIntegrityJob();
  assert.equal(first.state, 'continuing');
  assert.equal(h.backup.getSheetByName('outpatient-manifest-' + h.day), null, 'no manifest mid-run');
  assert.equal(h.props.INTEGRITY_LAST_COUNT, undefined, 'sentinel not advanced mid-run');
  assert.ok(h.props.INTEGRITY_RESUME_BACKUP);
  const { segments } = drain(h, first);
  assert.ok(segments >= 3, 'work was really split: ' + segments);
  assert.ok(h.backup.getSheetByName('outpatient-manifest-' + h.day));
  assert.ok(h.ctx._integrityValidateRestoreSet(h.backup, h.day, false).length > 20);
  assert.equal(writesTo(h, 'outpatient-' + h.day), 1, 'unchanged snapshot is not rewritten');
  assert.equal(writesTo(h, 'outpatient-leads-' + h.day), 1);
  assert.equal(h.props.INTEGRITY_RESUME_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_LAST_COUNT, '1');
  assert.equal(h.triggers.length, 0, 'no trigger left behind');
  assert.deepEqual(h.locks(), [false, false]);
});

test('a source change between segments rewrites that snapshot; the set equals the LAST capture', () => {
  const h = world({ step: 30 * 1000 });
  const first = h.ctx.nightlyIntegrityJob();
  assert.equal(first.state, 'continuing');
  // Synthetic writer edit between segments (capture reads getDataRange).
  const clients = h.live.getSheetByName('Clients');
  const grid = clients.getDataRange().getValues();
  grid.push(['client-b', 'מטופל נוסף', '0500000009']);
  clients.getDataRange = () => ({ getValues: () => grid.map(r => r.slice()),
    getNumberFormats: () => grid.map(r => r.map(() => 'General')) });
  drain(h, first);
  const set = h.ctx._integrityValidateRestoreSet(h.backup, h.day, false);
  const restored = set.find(x => x.source === 'Clients');
  assert.equal(restored.grid.length, 3, 'final set carries the edit');
  assert.equal(writesTo(h, 'outpatient-' + h.day), 2, 'changed snapshot rewritten once');
  assert.equal(writesTo(h, 'outpatient-leads-' + h.day), 1, 'unchanged snapshot kept');
});

test('a dead (> 30 min) marker from a killed run is retired automatically and the backup runs', () => {
  const h = world();
  const dead = JSON.stringify({ id: 'killed-run', startedAt: new Date(Date.now() - 24 * 60 * MIN).toISOString() });
  h.props.INTEGRITY_ACTIVE_BACKUP = dead;
  h.ctx.nightlyIntegrityJob();
  const record = JSON.parse(h.props.INTEGRITY_LAST_STALE_ACTIVE);
  assert.equal(record.id, 'killed-run');
  assert.ok(record.retiredAt);
  assert.ok(h.logs.some(l => l.includes('Stale backup marker retired automatically')), 'operator is told');
  assert.ok(h.backup.getSheetByName('outpatient-manifest-' + h.day));
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
});

for (const [label, marker] of [
  ['a young (< 30 min) marker of a possibly live run', () => JSON.stringify({ id: 'live-run', startedAt: new Date(Date.now() - 5 * MIN).toISOString() })],
  ['a malformed marker', () => 'not-json'],
  ['a marker without startedAt', () => JSON.stringify({ id: 'x' })]
]) {
  test(label + ' still refuses with backup_busy and is never cleared', () => {
    const h = world(), raw = marker();
    h.props.INTEGRITY_ACTIVE_BACKUP = raw;
    assert.throws(() => h.ctx.nightlyIntegrityJob(), /backup_busy/);
    assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, raw);
    assert.equal(h.events.some(e => e[0] === 'write'), false);
    assert.equal(h.props.INTEGRITY_LAST_STALE_ACTIVE, undefined);
  });
}

test('staged (v3) mode and a pending set keep the owner-decided path: no automatic retirement', () => {
  const dead = JSON.stringify({ id: 'killed-run', startedAt: '2000-01-01T00:00:00Z' });
  const staged = world();
  staged.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  staged.props.INTEGRITY_ACTIVE_BACKUP = dead;
  assert.throws(() => staged.ctx.nightlyIntegrityJob(), /backup_busy/);
  assert.equal(staged.props.INTEGRITY_ACTIVE_BACKUP, dead);
  const pending = world();
  pending.props.INTEGRITY_ACTIVE_BACKUP = dead;
  pending.props.INTEGRITY_PENDING_BACKUP = '{"id":"p"}';
  assert.throws(() => pending.ctx.nightlyIntegrityJob(), /backup_busy/);
  assert.equal(pending.props.INTEGRITY_ACTIVE_BACKUP, dead);
});

test('every segment arms a watchdog that fires only after its marker is provably dead', () => {
  const h = world();
  let seen = null;
  const write = h.ctx._integrityWriteSnapshot;
  h.ctx._integrityWriteSnapshot = function () {
    if (!seen) seen = h.triggers.map(t => [t.getHandlerFunction(), t.delayMs]);
    return write.apply(this, arguments);
  };
  h.ctx.nightlyIntegrityJob();
  assert.deepEqual(seen, [['resumeNightlyIntegrityJob', 35 * MIN]]);
  assert.ok(35 * MIN > h.ctx.INTEGRITY_DEAD_EXECUTION_MS);
  assert.equal(h.triggers.length, 0, 'removed after a normal finish');
});

test('after a hard kill the watchdog resumes from recorded progress the same night', () => {
  const h = world();
  const resumeState = { id: 'run-1', day: h.day, segments: 1, written: {} };
  h.props.INTEGRITY_RESUME_BACKUP = JSON.stringify(resumeState);
  h.props.INTEGRITY_ACTIVE_BACKUP = JSON.stringify({ id: 'run-1', segment: 1,
    startedAt: new Date(Date.now() - 35 * MIN).toISOString() });
  h.triggers.push({ getHandlerFunction: () => 'resumeNightlyIntegrityJob', delayMs: 35 * MIN });
  h.ctx.resumeNightlyIntegrityJob();
  assert.ok(h.backup.getSheetByName('outpatient-manifest-' + h.day));
  assert.equal(JSON.parse(h.props.INTEGRITY_LAST_STALE_ACTIVE).id, 'run-1');
  assert.equal(h.props.INTEGRITY_RESUME_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.triggers.length, 0);
});

test('the continuation never starts a new backup and never runs in staged mode', () => {
  const h = world();
  h.triggers.push({ getHandlerFunction: () => 'resumeNightlyIntegrityJob', delayMs: MIN });
  assert.equal(h.ctx.resumeNightlyIntegrityJob().state, 'nothing_to_resume');
  assert.equal(h.events.some(e => e[0] === 'write'), false);
  assert.equal(h.triggers.length, 0);
  const s = world();
  s.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  s.props.INTEGRITY_RESUME_BACKUP = JSON.stringify({ id: 'r', day: s.day, segments: 1, written: {} });
  assert.equal(s.ctx.resumeNightlyIntegrityJob().state, 'staged_mode');
  assert.equal(s.events.some(e => e[0] === 'write'), false);
});

test('progress of an older day is discarded: a fresh run id and a full new capture', () => {
  const h = world();
  h.props.INTEGRITY_RESUME_BACKUP = JSON.stringify({ id: 'old', day: '2000-01-01', segments: 5,
    written: { ['outpatient-' + h.day]: 'forged' } });
  let marker = null;
  const write = h.ctx._integrityWriteSnapshot;
  h.ctx._integrityWriteSnapshot = function () {
    marker = marker || JSON.parse(h.props.INTEGRITY_ACTIVE_BACKUP);
    return write.apply(this, arguments);
  };
  h.ctx.nightlyIntegrityJob();
  assert.notEqual(marker.id, 'old');
  assert.equal(marker.segment, 1);
  assert.equal(writesTo(h, 'outpatient-' + h.day), 1);
});

test('a run that cannot finish within the segment cap fails visibly and stops (no endless retry)', () => {
  const h = world();
  h.props.INTEGRITY_RESUME_BACKUP = JSON.stringify({ id: 'r', day: h.day, segments: 8, written: {} });
  assert.throws(() => h.ctx.resumeNightlyIntegrityJob(), /nightly_backup_not_published/);
  assert.ok(h.logs.some(l => l.includes('8 מקטעים')));
  assert.equal(h.events.some(e => e[0] === 'write'), false);
  assert.equal(h.props.INTEGRITY_RESUME_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.triggers.length, 0);
});

test('a write failure is reported once, drops progress and schedules no retry', () => {
  const h = world();
  h.faults.write = true;
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /nightly_backup_not_published/);
  assert.equal(h.props.INTEGRITY_RESUME_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
  assert.equal(h.triggers.length, 0);
});

test('a failure to schedule the continuation is a visible failure, not a silent stall', () => {
  const h = world({ step: 30 * 1000 });
  const api = h.ctx.ScriptApp, calls = { n: 0 };
  h.ctx.ScriptApp = Object.assign({}, api, { newTrigger: handler => {
    if (++calls.n > 1) throw Error('trigger quota');
    return api.newTrigger(handler);
  } });
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /nightly_backup_not_published/);
  assert.ok(h.logs.some(l => l.includes('trigger quota')));
  assert.equal(h.props.INTEGRITY_RESUME_BACKUP, undefined);
  assert.equal(h.props.INTEGRITY_ACTIVE_BACKUP, undefined);
});

test('the full readback starts only with head-room; otherwise a fresh segment verifies', () => {
  const h = world();
  let calls = 0;
  const base = Date.now();
  // Every write fits, but the run is already past the finalize start line.
  h.ctx._integrityNowMs = () => base + (calls++ === 0 ? 0 : 150 * 1000);
  const first = h.ctx.nightlyIntegrityJob();
  assert.equal(first.state, 'continuing');
  assert.equal(h.backup.getSheetByName('outpatient-manifest-' + h.day), null);
  h.ctx._integrityNowMs = () => Date.now();
  const before = h.events.filter(e => e[0] === 'write').length;
  h.ctx.resumeNightlyIntegrityJob();
  assert.ok(h.backup.getSheetByName('outpatient-manifest-' + h.day));
  const rewritten = h.events.filter(e => e[0] === 'write').length - before;
  assert.ok(rewritten <= 2, 'only recovery metadata + manifest rewritten: ' + rewritten);
});

test('retention stops at its deadline (idempotent; the rest waits for the next night)', () => {
  const h = world();
  h.backup.insertSheet('Copy of Clients', [['manual']]); // retention always keeps the last tab
  for (let i = 1; i <= 5; i++) h.backup.insertSheet('outpatient-leads-2000-01-0' + i, [['id']]);
  assert.equal(h.ctx._integrityApplyRetention(h.backup, 'outpatient-' + h.day, 30, Date.now() - 1).length, 0);
  assert.equal(h.ctx._integrityApplyRetention(h.backup, 'outpatient-' + h.day, 30).length, 5);
});

test('production budgets leave margin under the 360 s hard limit', () => {
  const { ctx } = world();
  assert.ok(ctx.INTEGRITY_SEGMENT_BUDGET_MS <= 200 * 1000);
  assert.ok(ctx.INTEGRITY_FINALIZE_START_MS <= ctx.INTEGRITY_SEGMENT_BUDGET_MS);
  assert.ok(ctx.INTEGRITY_RETENTION_BUDGET_MS < 360 * 1000);
  assert.ok(ctx.INTEGRITY_DEAD_EXECUTION_MS >= 5 * 360 * 1000);
});
