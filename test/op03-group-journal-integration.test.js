'use strict';
// OP-03 x OUT #195 integration acceptance: two-stage (v3) backup and restore of
// the GROUP participant-credit journal `SessionOutcomeOps`.
//
// The journal exists only in the combined #195 candidate. On a #199-only tree
// these tests SKIP (reported as skipped, never as passed). They run for real as
// soon as #195 merges this #199 head. Evidence for the exact integrated tree is
// recorded in docs/OP03-RELEASE-READINESS-20261123.md.
// Real Code.gs; synthetic Google services, people and numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { harness } = require('../test-support/backup-sandbox.cjs');

const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const integrated = /var SESSION_OUTCOME_OP_SHEET = 'SessionOutcomeOps';/.test(code);
const skip = integrated ? false : 'SessionOutcomeOps is not in this tree (needs the combined #195 candidate)';

const dayOf = h => h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
const secret = 'synthetic-group-integration-secret';
const request = {
  action: 'recordSessionOutcome', secret,
  sessionId: 'v3-group-session-1', treatmentId: 'v3-group-booking-1',
  phone: '0500000188', therapist: 'Synthetic Group Therapist',
  clinicalTreatmentType: 'קבוצה', date: '2026-11-23',
  outcome: 'patient_cancelled_notice', reportRevision: '2026-11-23T12:00:00.000Z'
};

function source({ crash } = {}) {
  const s = sandbox([], [{ id: 'v3-group-client', name: 'Synthetic Group Participant', phone: request.phone,
    clinicalTreatmentType: 'קבוצה', serviceType: 'קבוצה', creditsOwed: 0, sessionsPerWeek: '1' }]);
  s.props.SESSION_OUTCOME_SECRET = secret;
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, []);
  s.seed('TherapistRates', s.ctx.THERAPIST_RATES_HEADERS, [{ name: Object.keys(s.ctx.THERAPIST_FLAT_RATES)[0], flatRate: 777 }]);
  s.seed('Settings', s.ctx.SETTINGS_HEADERS, [{ key: 'synthetic-setting', value: 'fixture' }]);
  s.seed('FinancialOps', s.ctx.FINANCIAL_OP_HEADERS, []);
  if (crash) {
    // Credit applied, SessionLog append lost: the journal row stays `pending`.
    const sh = s.sheets.SessionLog, append = sh.appendRow; let armed = true;
    sh.appendRow = function (...args) { if (armed) { armed = false; throw Error('synthetic interrupted write'); } return append.apply(this, args); };
    assert.equal(s.post(request).ok, false);
    sh.appendRow = append;
    assert.equal(s.rows('SessionOutcomeOps')[0].state, 'pending');
    assert.equal(Number(s.rows('Clients')[0].creditsOwed), 1);
    assert.equal(s.rows('SessionLog').length, 0);
  } else {
    assert.equal(s.post(request).ok, true);
    assert.equal(s.rows('SessionOutcomeOps')[0].state, 'committed');
  }
  return s;
}

function certified(s) {
  const h = harness(Object.fromEntries(Object.entries(s.sheets).map(([n, sh]) => [n, sh.grid])));
  h.props.FINANCIAL_OPS_CREATED = '1';
  h.props.SESSION_OUTCOME_OPS_CREATED = '1';
  h.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.backup.getSheetByName('outpatient-verified-' + dayOf(h)), null, 'no certificate after Phase A');
  assert.equal(h.ctx.finalizeNightlyIntegrityJob().state, 'verified');
  return h;
}

function restore(h) {
  const t = sandbox();
  for (const n of Object.keys(t.sheets)) delete t.sheets[n];
  for (const x of h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h), true)) {
    if (x.absent || x.source === '__RecoveryMetadata') continue;
    t.seed(x.source, x.grid[0], x.grid.slice(1).map(row => Object.fromEntries(x.grid[0].map((k, i) => [k, row[i]]))));
  }
  t.props.SESSION_OUTCOME_SECRET = secret;
  t.props.SESSION_OUTCOME_OPS_CREATED = '1';
  t.props.FINANCIAL_OPS_CREATED = '1';
  return t;
}

function cutover(h, t) {
  h.ctx.SpreadsheetApp.getActiveSpreadsheet = () => ({ ...t.ctx.SpreadsheetApp.getActiveSpreadsheet(), getId: () => 'isolated-target' });
  h.ctx.CacheService = { getScriptCache: () => ({ remove() {} }) };
  h.props.OUTPATIENT_RECOVERY_HOLD = '1';
  return () => h.ctx.finishOutpatientRecovery('backup', dayOf(h), true);
}

test('v3 A/B certifies a PENDING group intent exactly as captured (not silently committed or dropped)', { skip }, () => {
  const h = certified(source({ crash: true }));
  const set = h.ctx._integrityValidateRestoreSet(h.backup, dayOf(h), true);
  const journal = set.find(x => x.source === 'SessionOutcomeOps');
  assert.ok(journal && !journal.absent);
  assert.equal(journal.grid.length, 2);
  assert.equal(journal.grid[1][journal.grid[0].indexOf('state')], 'pending');
  assert.equal(set.find(x => x.source === 'SessionLog').grid.length, 1, 'log row was never written');
});

test('operational cutover is REFUSED while a restored group intent is pending; hold retained', { skip }, () => {
  const h = certified(source({ crash: true })), t = restore(h), finish = cutover(h, t);
  assert.throws(finish, /session_credit_recovery_pending/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('after restore, the sender retry resumes the pending intent ONCE: no double credit, one log row', { skip }, () => {
  const t = restore(certified(source({ crash: true })));
  const retry = t.post(request);
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.replayed, true);
  assert.equal(Number(t.rows('Clients')[0].creditsOwed), 1, 'credit applied before the crash is not applied again');
  assert.equal(t.rows('SessionLog').length, 1);
  assert.equal(t.rows('SessionOutcomeOps')[0].state, 'committed');
  assert.equal(t.post(request).ok, true);
  assert.equal(Number(t.rows('Clients')[0].creditsOwed), 1, 'a further retry is idempotent');
});

test('committed group journal + empty FinancialOps: certified v3 cutover succeeds and keeps the journal marker', { skip }, () => {
  const h = certified(source()), t = restore(h), finish = cutover(h, t);
  delete h.props.SESSION_OUTCOME_OPS_CREATED; // recovered project starts without it
  assert.equal(finish().ok, true);
  assert.equal(h.props.SESSION_OUTCOME_OPS_CREATED, '1');
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, undefined);
});

test('a restored target missing the group journal is refused (history cannot be dropped)', { skip }, () => {
  const h = certified(source()), t = restore(h);
  delete t.sheets.SessionOutcomeOps;
  assert.throws(cutover(h, t), /Recovered sheet missing: SessionOutcomeOps/);
  assert.equal(h.props.OUTPATIENT_RECOVERY_HOLD, '1');
});

test('Phase A refuses when the journal was created but its tab disappeared; nothing is staged', { skip }, () => {
  const s = source(); delete s.sheets.SessionOutcomeOps;
  const h = harness(Object.fromEntries(Object.entries(s.sheets).map(([n, sh]) => [n, sh.grid])));
  h.props.SESSION_OUTCOME_OPS_CREATED = '1';
  h.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  assert.throws(() => h.ctx.nightlyIntegrityJob(), /nightly_backup_not_published/);
  assert.equal(h.backup.getSheetByName('outpatient-pending-manifest-' + dayOf(h)), null);
  assert.equal(h.backup.getSheetByName('outpatient-verified-' + dayOf(h)), null);
});

test('a group journal snapshot tampered between A and B is caught before the certificate', { skip }, () => {
  const s = source();
  const h = harness(Object.fromEntries(Object.entries(s.sheets).map(([n, sh]) => [n, sh.grid])));
  h.props.SESSION_OUTCOME_OPS_CREATED = '1'; h.props.FINANCIAL_OPS_CREATED = '1';
  h.props.INTEGRITY_TWO_STAGE_ENABLED = '1';
  h.ctx.nightlyIntegrityJob();
  const snap = h.backup.getSheetByName('outpatient-session-outcome-ops-' + dayOf(h));
  const grid = snap.getDataRange().getValues();
  grid[1][grid[0].indexOf('toCredits')] = 5; // forged balance target
  snap.getDataRange().setValues(grid);
  assert.throws(() => h.ctx.finalizeNightlyIntegrityJob(), /mismatch/);
  assert.equal(h.backup.getSheetByName('outpatient-verified-' + dayOf(h)), null);
  assert.ok(h.props.INTEGRITY_PENDING_BACKUP);
});

// Native Gate 0 fixture: the two-stage builder adds the group journal ONLY on
// combined sources; the shared, evidence-pinned historical fixture is untouched.
const { withGroupJournal } = require('../test-support/build-google-two-stage-drill.cjs');
const { fixture } = require('../test-support/build-google-operational-drill.cjs');

test('#199-only source: native fixture is returned unchanged (same definition hash)', { skip: integrated ? 'combined source' : false }, () => {
  const base = fixture();
  assert.strictEqual(withGroupJournal(base), base);
});

test('combined source: native Gate 0 fixture carries ONE committed group journal row', { skip }, () => {
  const base = fixture(), out = withGroupJournal(base);
  const ops = out.grids.SessionOutcomeOps;
  assert.equal(ops.length, 2);
  assert.equal(ops[1][ops[0].indexOf('state')], 'committed');
  assert.equal(out.grids.Clients.length, base.grids.Clients.length + 1);
  assert.equal(out.grids.SessionLog.length, base.grids.SessionLog.length + 1);
  assert.equal(JSON.stringify(fixture()), JSON.stringify(base), 'shared historical fixture never mutated');
  assert.equal(out.groupEvent.secret, undefined, 'no secret in the generated fixture');
});
