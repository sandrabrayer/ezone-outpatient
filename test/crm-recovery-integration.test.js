'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');
const post = (s, body) => s.post({ user: 'ורד', moneyScope: 'full', ...body });
const task = { kind: 'call', clientId: 'recovery-client', title: 'Synthetic follow-up', dueDate: '2026-11-15' };
const actions = [
  { action: 'createTask', submissionId: 'new-recovery-task', task },
  { action: 'completeTask', id: 'task-existing-task', outcome: 'Synthetic completed' },
  { action: 'deferTask', id: 'task-existing-task', dueDate: '2026-11-20', reason: 'Synthetic defer' },
  { action: 'reassignTask', id: 'task-existing-task', assignee: 'אורן' },
  { action: 'withdrawTask', id: 'task-existing-task', reason: 'Synthetic withdrawal' },
  { action: 'logContact', submissionId: 'recovery-contact',
    contact: { clientId: 'recovery-client', taskId: 'task-existing-task', outcome: 'no_answer' },
    next: { dueDate: '2026-11-20' } }
];
for (const payload of actions) for (const timing of ['before-admission', 'while-queued', 'lock-busy']) {
  test('CRM recovery: ' + payload.action + ' has no effects ' + timing, () => {
    const s = sandbox();
    assert.equal(post(s, { action: 'createTask', submissionId: 'existing-task', task }).ok, true);
    const before = JSON.stringify(s.sheets);
    if (timing === 'before-admission') s.props.OUTPATIENT_RECOVERY_HOLD = '1';
    if (timing === 'while-queued') {
      const acquire = s.lock.tryLock;
      s.lock.tryLock = () => { const ok = acquire(); s.props.OUTPATIENT_RECOVERY_HOLD = '1'; return ok; };
    }
    if (timing === 'lock-busy') s.lock.tryLock = () => false;
    const result = post(s, payload);
    assert.equal(result.ok, false);
    assert.match(result.error, timing === 'lock-busy' ? /busy/ : /recovery_pending/);
    assert.equal(JSON.stringify(s.sheets), before, 'no cell/header creation or mutation after the hold');
    assert.equal(s.isLocked(), false);
  });
}
for (const action of ['getTasks', 'getActivity']) {
  test('CRM recovery: ' + action + ' never creates a source on a read', () => {
    const s = sandbox(), before = JSON.stringify(s.sheets);
    assert.equal(post(s, { action }).ok, true);
    assert.equal(JSON.stringify(s.sheets), before);
  });
}
