'use strict';

/**
 * Discharge-persist fix (2026-11-02).
 *
 * Bug: a patient discharged with «סיים טיפול» right after another edit of the
 * same card in the same tab (e.g. a notes edit) came back after reload. The
 * full save stamped the row on the server, the tab kept the OLD updatedAt,
 * so the tab's NEXT save of that row was refused as a stale-save conflict
 * against its own previous edit — and the discharge handler (plain persist())
 * still toasted «סיום נשמר».
 *
 * Locked contracts:
 *   A. Code.gs saveAll returns `stamps.{clients,leads}` = { id: updatedAt } as
 *      written to the sheet (stamps only, no row content).
 *   B. Echoing the returned stamp makes the second edit (the discharge) land;
 *      the stale echo is still refused (conflict protection unchanged).
 *   C. public/app.js applySavedStamps adopts returned stamps, skips refused
 *      rows, ignores malformed values, and is a no-op on old backends.
 *   D. The discharge submit uses persistClientChange (refusal throws) and
 *      rolls the optimistic status back with an explicit error toast.
 *
 * Fixture data only — no production names, phones or secrets.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sandbox } = require('../test-support/apps-script-sandbox');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

const T0 = '2026-10-01T00:00:00.000Z';
const PAUSED = {
  id: 'client-fixture-1', name: 'Fixture patient', status: 'הפסקה זמנית',
  serviceType: 'ליווי יומי בקהילה', notes: 'old note', updatedAt: T0, updatedBy: 'fixture-original'
};
const OTHER = { id: 'client-fixture-2', name: 'Fixture other', status: 'פעיל', updatedAt: T0, updatedBy: 'fixture-original' };

const row = (sb, id) => sb.rows('Clients').find((r) => r.id === id);

test('A: saveAll returns the stamp each written row now holds', () => {
  const sb = sandbox([], [PAUSED, OTHER]);
  const res = sb.save([], [{ ...row(sb, PAUSED.id), notes: 'refund paid' }, row(sb, OTHER.id)]);
  assert.equal(res.ok, true);
  assert.ok(res.stamps && res.stamps.clients && res.stamps.leads, 'stamps map present');
  const stored = row(sb, PAUSED.id);
  assert.notEqual(stored.updatedAt, T0, 'edited row re-stamped');
  assert.equal(res.stamps.clients[PAUSED.id], stored.updatedAt);
  assert.equal(res.stamps.clients[OTHER.id], T0, 'unchanged echo keeps the sheet stamp');
  assert.deepEqual(Object.keys(res.stamps.clients).sort(), [PAUSED.id, OTHER.id].sort());
  for (const v of Object.values(res.stamps.clients)) assert.equal(typeof v, 'string', 'stamps only, no row content');
});

test('B (repro): edit then discharge from the same tab — stale echo refused, refreshed echo lands', () => {
  const sb = sandbox([], [PAUSED]);
  const loaded = row(sb, PAUSED.id); // what the tab loaded (updatedAt = T0)

  const first = sb.save([], [{ ...loaded, notes: 'refund paid' }]);
  assert.equal(first.ok, true);
  assert.equal(first.conflicts, undefined);

  // Old behaviour: the tab still echoes T0 → its own previous edit reads as
  // another person's change and the discharge is refused.
  const stale = sb.save([], [{ ...loaded, notes: 'refund paid', status: 'סיים טיפול', exitDate: '2026-11-02' }]);
  assert.equal(stale.conflicts.length, 1, 'root cause reproduced');
  assert.equal(row(sb, PAUSED.id).status, 'הפסקה זמנית', 'discharge NOT stored');

  // Fixed behaviour: the tab adopted first.stamps → the discharge is stored.
  const fresh = sb.save([], [{ ...loaded, notes: 'refund paid', status: 'סיים טיפול', exitDate: '2026-11-02',
    updatedAt: first.stamps.clients[PAUSED.id] }]);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.conflicts, undefined);
  assert.equal(row(sb, PAUSED.id).status, 'סיים טיפול');
  assert.equal(row(sb, PAUSED.id).exitDate, '2026-11-02');
});

test('B: a real concurrent edit by someone else is still refused', () => {
  const sb = sandbox([], [PAUSED]);
  const tabA = row(sb, PAUSED.id);
  const tabB = row(sb, PAUSED.id);
  assert.equal(sb.save([], [{ ...tabB, notes: 'edited by B' }]).ok, true);
  const res = sb.save([], [{ ...tabA, status: 'סיים טיפול' }]);
  assert.equal(res.conflicts.length, 1);
  assert.equal(row(sb, PAUSED.id).notes, 'edited by B');
});

// --- C. frontend applySavedStamps (extracted from the shipped app.js) -------
function loadApply(state) {
  const m = APP.match(/function applySavedStamps\(data\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m, 'applySavedStamps present in app.js');
  const ctx = { state };
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nthis.applySavedStamps = applySavedStamps;', ctx);
  return ctx.applySavedStamps;
}

test('C: applySavedStamps adopts stamps, skips refused rows and junk', () => {
  const state = {
    clients: [{ id: 'a', updatedAt: 'old' }, { id: 'b', updatedAt: 'old' }, { id: 'c', updatedAt: 'old' }],
    leads: [{ id: 'l1', updatedAt: 'old' }]
  };
  const apply = loadApply(state);
  apply({ stamps: { clients: { a: 'new-a', b: 'new-b', c: { evil: 1 } }, leads: { l1: 'new-l1' } },
    conflicts: [{ id: 'b' }] });
  assert.equal(state.clients[0].updatedAt, 'new-a');
  assert.equal(state.clients[1].updatedAt, 'old', 'refused row untouched');
  assert.equal(state.clients[2].updatedAt, 'old', 'non-string ignored');
  assert.equal(state.leads[0].updatedAt, 'new-l1');
  apply({ ok: true }); // old backend: no stamps → no-op, no throw
  apply(null);
  assert.equal(state.clients[0].updatedAt, 'new-a');
});

test('C: persist() applies the stamps from every successful save', () => {
  const body = APP.slice(APP.indexOf('async function persist(opts)'), APP.indexOf('function conflictsMessage('));
  assert.match(body, /applySavedStamps\(data\);/);
});

// --- D. discharge submit cannot claim success on a refused save ------------
test('D: discharge uses persistClientChange and rolls back on failure', () => {
  const start = APP.indexOf("$('#exitForm').addEventListener('submit'");
  assert.ok(start > 0);
  const handler = APP.slice(start, APP.indexOf("var nrrForm = $('#notRelevantReasonForm')", start));
  assert.match(handler, /persistClientChange\(client\)/);
  assert.doesNotMatch(handler, /\bpersist\(\)/, 'plain persist() resolves on refusal — never use it here');
  assert.match(handler, /client\.status = prevExit\.status;/);
  assert.match(handler, /סיום הטיפול לא נשמר/);
  assert.ok(handler.indexOf('dischargeSaved = true') < handler.indexOf("toast('סיום נשמר')"),
    'success toast only after the save confirmed');
});
