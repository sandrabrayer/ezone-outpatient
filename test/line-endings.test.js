'use strict';

/**
 * Line endings: LF in the repo AND in the working tree.
 *
 * Git for Windows ships `core.autocrlf=true` in its SYSTEM config, so a fresh
 * clone on Windows used to check every text file out with CRLF. The committed
 * blobs were always LF — nothing was wrong in the repo — but the many tests
 * that read a source file and match it with \n-anchored regexes then failed
 * locally while passing in CI on Ubuntu: 39 false failures out of 877, across
 * 18 files. `.gitattributes` (`* text=auto eol=lf`) overrides core.autocrlf
 * for this repo so both match.
 *
 * This file guards that invariant from BOTH directions:
 *   A. `.gitattributes` exists and still carries the `eol=lf` rule — deleting
 *      or weakening it brings the false failures straight back.
 *   B. No tracked blob carries CRLF, and no working-tree text file does
 *      either. `text=auto` still auto-detects binary, so the PWA icons and the
 *      one NUL-carrying fixture are excluded by git itself, not by a list here.
 *
 * The git-backed checks are skipped (not failed) when git or the repo is
 * unavailable — a tarball export or a vendored copy is not a broken checkout.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ATTRS_PATH = path.join(ROOT, '.gitattributes');

/* `git ls-files --eol` prints one line per tracked file:
 *   i/<eol> w/<eol> attr/<attrs>\t<path>
 * where i/ is the committed blob and w/ the working-tree file. Values are
 * lf / crlf / mixed / none, or -text when git detected the file as binary. */
function lsFilesEol() {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '--eol'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return null; // no git, or not a repo — the caller skips
  }
  return out.split('\n').filter(Boolean).map((line) => {
    const [flags, file] = line.split('\t');
    const m = flags.match(/i\/(\S+)\s+w\/(\S+)/);
    return { index: m ? m[1] : '?', worktree: m ? m[2] : '?', file: (file || '').trim() };
  });
}

/* ================= A. the rule itself ================= */

test('A: .gitattributes exists and pins LF in the working tree, not just in the repo', () => {
  assert.ok(fs.existsSync(ATTRS_PATH), '.gitattributes must be committed — without it a Windows clone re-breaks the suite');
  const src = fs.readFileSync(ATTRS_PATH, 'utf8');
  const rules = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(rules, ['* text=auto eol=lf'], 'exactly the one catch-all rule, unchanged');
  // eol=lf is the half that actually overrides core.autocrlf. text=auto alone
  // would normalise the repo but still hand Windows a CRLF working tree.
  assert.match(src, /^\* text=auto eol=lf$/m, 'the catch-all must keep eol=lf');
});

test('A: .gitattributes is itself LF and explains why the rule exists', () => {
  const raw = fs.readFileSync(ATTRS_PATH);
  assert.ok(!raw.includes('\r'), '.gitattributes must not itself contain CR');
  const src = raw.toString('utf8');
  assert.match(src, /autocrlf/, 'the comment names the cause');
  assert.ok(src.endsWith('\n'), 'trailing newline');
});

/* ================= B. the invariant it protects ================= */

test('B: no tracked blob carries CRLF or mixed endings', (t) => {
  const files = lsFilesEol();
  if (!files) return t.skip('git unavailable');
  assert.ok(files.length > 100, 'sanity: expected the whole tree, got ' + files.length + ' files');
  const bad = files.filter((f) => f.index === 'crlf' || f.index === 'mixed');
  assert.deepEqual(bad.map((f) => f.file), [], 'these committed blobs carry CRLF');
});

test('B: every tracked TEXT file is LF in the working tree too — the checkout matches CI', (t) => {
  const files = lsFilesEol();
  if (!files) return t.skip('git unavailable');
  // git itself decides what is binary (-text); nothing is exempted by name here.
  const textFiles = files.filter((f) => f.index !== '-text');
  const bad = textFiles.filter((f) => f.worktree === 'crlf' || f.worktree === 'mixed');
  assert.deepEqual(
    bad.map((f) => f.file), [],
    'CRLF in the working tree — .gitattributes is not in effect for this checkout. ' +
    'From a CLEAN tree run: git rm --cached -r . && git reset --hard'
  );
});

test('B: binary files are still auto-detected, so nothing converts their bytes', (t) => {
  const files = lsFilesEol();
  if (!files) return t.skip('git unavailable');
  const binary = files.filter((f) => f.index === '-text').map((f) => f.file).sort();
  // The PWA icons are generated and byte-compared elsewhere; session-who-when
  // carries NUL bytes in a control-character fixture. `text=auto` must keep
  // detecting all of them as binary so eol conversion never touches them.
  assert.ok(binary.includes('public/icon-v1-192.png'), 'icons must stay binary');
  assert.ok(binary.includes('public/icon-v1-512.png'), 'icons must stay binary');
  assert.ok(binary.includes('public/icon-v1-maskable.png'), 'icons must stay binary');
  binary.forEach((f) => {
    const raw = fs.readFileSync(path.join(ROOT, f));
    assert.ok(raw.includes(0), f + ' is treated as binary but carries no NUL — check the attribute');
  });
});

/* A regression test for the ACTUAL symptom: the source-parsing tests that
 * broke. If eol conversion ever comes back, these reads stop matching. */
test('B: the \\n-anchored source reads that used to break now hold', () => {
  const cases = [
    ['apps-script/Code.gs', /^var LEADS_HEADERS = \[$/m],
    ['server.js', /^const { SESSION_USERS } = require\('\.\/lib\/users'\);$/m],
    ['public/index.html', /^\s+<select name="assignedTo" required>$/m],
    ['lib/users.js', /^const SESSION_USERS = \[.+\];$/m],
    ['public/sw.js', /^var CACHE = 'ezone-outpatient-v\d+';$/m]
  ];
  cases.forEach(([rel, re]) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!src.includes('\r\n'), rel + ' must have no CRLF in the working tree');
    assert.match(src, re, rel + ': a $-anchored match fails when lines end in CR');
  });
});
