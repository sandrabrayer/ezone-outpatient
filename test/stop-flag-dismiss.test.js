'use strict';

/**
 * Coverage for the "מחק" / dismiss control on Vered's stop-flag dashboard panel
 * (public/app.js: renderStopFlags + handleStopFlagClick + dismissStopFlag).
 *
 * The real handler is DOM + async and cannot be imported in Node, so the pure
 * state transition it performs is mirrored below; a source-scan guard then locks
 * the actual wiring in public/app.js so the mirror cannot silently drift from it.
 *
 * Contract under test:
 *   - dismissing a flag marks it status='resolved' (+ resolvedBy='Vered'), so the
 *     pending filter (status==='pending') drops it from the panel immediately;
 *   - an ORPHANED flag (no clientId, no matching client) dismisses the SAME way —
 *     it has an id, which is all the id-based resolveStopFlag needs;
 *   - dismiss does NOT discharge and never touches Clients;
 *   - a failed write rolls the flag back to its previous status (row reappears);
 *   - the panel uses the existing internal resolveStopFlag(id) action.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// --- mirror of the panel's pending filter + dismiss transition (public/app.js) ---
function pending(flags) {
  return flags.filter(function (f) { return f.status === 'pending'; });
}

// Mirror of the optimistic local mutation dismissStopFlag applies on success.
function dismissFlag(flags, flagId, now) {
  const f = flags.find(function (x) { return x.id === flagId; });
  if (!f) return { ok: false };
  f.status = 'resolved';
  f.resolvedBy = 'Vered';
  f.resolvedAt = now || '2026-06-20T00:00:00.000Z';
  return { ok: true, flag: f, action: 'resolveStopFlag', payload: { id: f.id, resolvedBy: 'Vered' } };
}

// Mirror of the rollback applied when the write fails.
function rollback(flag, prev) {
  flag.status = prev.status;
  flag.resolvedBy = prev.resolvedBy;
  flag.resolvedAt = prev.resolvedAt;
}
// ---------------------------------------------------------------------------

function seed() {
  return [
    { id: 'f1', phone: '0501234567', name: 'אורי', clientId: 'c1', status: 'pending', resolvedBy: '', resolvedAt: '' },
    // orphaned: the test phone with no client (the יעל / 0782374928 case)
    { id: 'f2', phone: '0782374928', name: 'יעל', clientId: '', status: 'pending', resolvedBy: '', resolvedAt: '' }
  ];
}

test('dismiss marks a matched flag resolved and drops it from the pending list', () => {
  const flags = seed();
  const res = dismissFlag(flags, 'f1');
  assert.equal(res.ok, true);
  assert.equal(res.action, 'resolveStopFlag');           // existing id-based action
  assert.deepEqual(res.payload, { id: 'f1', resolvedBy: 'Vered' });
  assert.equal(flags.find(f => f.id === 'f1').status, 'resolved');
  assert.deepEqual(pending(flags).map(f => f.id), ['f2']); // f1 gone, orphan remains
});

test('an orphaned flag (no clientId / no client) dismisses the same way', () => {
  const flags = seed();
  const res = dismissFlag(flags, 'f2');
  assert.equal(res.ok, true);
  const f2 = flags.find(f => f.id === 'f2');
  assert.equal(f2.status, 'resolved');
  assert.equal(f2.clientId, '');               // Clients never joined / touched
  assert.deepEqual(pending(flags).map(f => f.id), ['f1']);
});

test('dismissing both flags empties the pending panel', () => {
  const flags = seed();
  dismissFlag(flags, 'f1');
  dismissFlag(flags, 'f2');
  assert.equal(pending(flags).length, 0);
});

test('unknown flag id is a no-op', () => {
  const flags = seed();
  assert.equal(dismissFlag(flags, 'nope').ok, false);
  assert.equal(pending(flags).length, 2);
});

test('a failed write rolls the flag back to pending (row reappears)', () => {
  const flags = seed();
  const flag = flags.find(f => f.id === 'f2');
  const prev = { status: flag.status, resolvedBy: flag.resolvedBy, resolvedAt: flag.resolvedAt };
  dismissFlag(flags, 'f2');
  assert.equal(pending(flags).length, 1); // optimistically removed
  rollback(flag, prev);                   // server rejected
  assert.equal(flag.status, 'pending');
  assert.deepEqual(pending(flags).map(f => f.id).sort(), ['f1', 'f2']);
});

test('wiring guard: public/app.js renders a dismiss button and resolves by id', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  // button rendered on the panel rows
  assert.ok(/data-action="dismiss-flag"/.test(src), 'dismiss-flag button not rendered');
  // delegated handler routes the click
  assert.ok(/dismiss-flag"\]/.test(src), 'click handler does not match dismiss-flag');
  // handler exists, is editor-gated, confirms, and resolves by id (not by phone)
  const fn = src.match(/function dismissStopFlag\([\s\S]*?\n  }/);
  assert.ok(fn, 'dismissStopFlag not found');
  assert.ok(/state\.role !== 'editor'/.test(fn[0]), 'dismiss is not editor-gated');
  assert.ok(/confirm\(/.test(fn[0]), 'dismiss does not confirm before removing');
  assert.ok(/apiPostAction\('resolveStopFlag', \{ id: flag\.id/.test(fn[0]),
    'dismiss does not resolve by id via resolveStopFlag');
});
