'use strict';
// Guard test for .github/workflows/sandbox-drill-push.yml — the credential
// holder that pushes the generated OP-03 drill to an ISOLATED Apps Script
// project. It must stay dispatch-only, never deploy, and never be able to
// target the production script project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '../.github/workflows/sandbox-drill-push.yml');
const workflow = fs.readFileSync(file, 'utf8');

test('sandbox drill push is dispatch-only with both inputs required', () => {
  const triggers = workflow.split(/^on:\n/m)[1].split(/^\w/m)[0];
  assert.deepEqual([...triggers.matchAll(/^  ([\w_]+):/gm)].map(m => m[1]), ['workflow_dispatch']);
  for (const input of ['sandbox_script_id', 'expected_commit']) {
    assert.match(triggers, new RegExp(input + ':\\n(?:.*\\n){0,3}?\\s+required: true'), input + ' must be required');
  }
});

test('sandbox drill push never deploys and never grants write permissions', () => {
  assert.ok(!/clasp deploy/.test(workflow), 'must not call clasp deploy');
  assert.ok(!/DEPLOYMENT_ID/.test(workflow), 'must not reference the production deployment id');
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.ok(!/contents: write/.test(workflow));
});

test('sandbox drill push refuses the production script ID and a mismatched candidate', () => {
  assert.match(workflow, /"\$SANDBOX_ID" = "\$prod"/, 'must compare against the production .clasp.json id');
  assert.match(workflow, /"\$GITHUB_SHA" != "\$EXPECTED_COMMIT"/, 'must pin the dispatched ref to the candidate');
  assert.match(workflow, /build-google-operational-drill\.cjs --script-id "\$SANDBOX_ID"/, 'must build from the checked-out source');
  assert.match(workflow, /rm -f "\$HOME\/\.clasprc\.json"/, 'must remove credentials');
});

test('the drill builder itself rejects the production script ID', () => {
  const { build } = require('../test-support/build-google-operational-drill.cjs');
  const prod = JSON.parse(fs.readFileSync(path.join(__dirname, '../.clasp.json'), 'utf8')).scriptId;
  assert.throws(() => build({ scriptId: prod }), /isolated/i);
});
