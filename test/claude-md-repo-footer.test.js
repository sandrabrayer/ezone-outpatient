'use strict';

/**
 * CLAUDE.md carries the "Repo footer" rule: every Claude reply to Sandra ends
 * with a line naming the repo and branch (she uses the Claude app/web, where
 * the terminal status line is not shown). Guards against the rule being
 * dropped or its footer format drifting.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const claudeMd = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');

test('CLAUDE.md has the numbered Repo footer rule', () => {
  assert.match(claudeMd, /^\d+\. \*\*Repo footer\.\*\* End EVERY reply to Sandra/m);
});

test('CLAUDE.md shows the exact footer format', () => {
  assert.ok(
    claudeMd.includes('`📁 Repo: sandrabrayer/ezone-outpatient · Branch: <current branch>`'),
    'footer line format missing'
  );
});

test('CLAUDE.md says how to get the branch and when to mark it not pushed', () => {
  assert.ok(claudeMd.includes('git branch --show-current'));
  assert.ok(claudeMd.includes('(not pushed)'));
  assert.match(claudeMd, /multi-repo\s+session, list each repo touched/);
});
