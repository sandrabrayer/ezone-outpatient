'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deploymentTarget } = require('../scripts/wait-for-source-proxy');

const sha = 'a'.repeat(40);
const valid = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/claude/youthful-volta-laarnk',
  GITHUB_SHA: sha,
  EXPECTED_COMMIT: sha
};

test('explicit approved production dispatch selects exactly its commit', () => {
  assert.equal(deploymentTarget(valid), sha);
});

for (const [name, overrides] of [
  ['push event', { GITHUB_EVENT_NAME: 'push' }],
  ['missing event', { GITHUB_EVENT_NAME: undefined }],
  ['feature branch', { GITHUB_REF: 'refs/heads/codex/draft' }],
  ['tag', { GITHUB_REF: 'refs/tags/release' }],
  ['missing approved SHA', { EXPECTED_COMMIT: undefined }],
  ['abbreviated SHA', { EXPECTED_COMMIT: sha.slice(0, 8) }],
  ['non-hex SHA', { EXPECTED_COMMIT: 'x'.repeat(40) }],
  ['padded SHA', { EXPECTED_COMMIT: `${sha}\n` }],
  ['branch advanced after approval', { GITHUB_SHA: 'b'.repeat(40) }],
  ['missing checked-out SHA', { GITHUB_SHA: undefined }]
]) {
  test(`source release rejects ${name}`, () => {
    assert.throws(() => deploymentTarget({ ...valid, ...overrides }));
  });
}

test('real gate process rejects stale dispatch immediately, before network polling', () => {
  const result = spawnSync(process.execPath, ['scripts/wait-for-source-proxy.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...valid, GITHUB_SHA: 'b'.repeat(40) },
    encoding: 'utf8', timeout: 3000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /differs from the approved SHA/);
  assert.doesNotMatch(result.stdout, /Waiting|ready/);
});

test('source workflow cannot start on push and requires an explicit commit', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy-apps-script.yml'), 'utf8');
  const triggers = workflow.match(/^on:\n([\s\S]*?)(?=^\S)/m)[1];
  assert.deepEqual([...triggers.matchAll(/^  ([\w_]+):/gm)].map(m => m[1]), ['workflow_dispatch']);
  assert.match(triggers, /expected_commit:\n\s+description:[^\n]+\n\s+required: true\n\s+type: string/);
  assert.match(workflow, /EXPECTED_COMMIT: \$\{\{ inputs.expected_commit \}\}/);
});

test('live SHA gate precedes all source credentials and writes; cleanup remains unconditional', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy-apps-script.yml'), 'utf8');
  const gate = workflow.indexOf('run: node scripts/wait-for-source-proxy.js');
  assert.ok(gate > workflow.indexOf('uses: actions/setup-node@'));
  for (const marker of ['secrets.CLASPRC_JSON', 'secrets.DEPLOYMENT_ID', 'clasp push -f', 'clasp deploy -i']) {
    assert.ok(workflow.indexOf(marker) > gate, `${marker} must follow the gate`);
  }
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /if: always\(\)\n\s+run: rm -f "\$HOME\/\.clasprc.json"/);
});
