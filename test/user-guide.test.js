'use strict';

/**
 * Guard tests for the Hebrew end-user guide (docs/USER-GUIDE.he.md).
 *
 * The guide is the versioned source of truth the support bot answers from,
 * so these lock its structure (sections, RTL wrapper), its safety rules
 * (never hand out passwords, never delete duplicates yourself), that it
 * never carries anything that looks like a credential, and that the UI
 * wording / session TTL it relies on still exist in public/index.html and
 * lib/session.js so the text cannot silently drift from the app. Pure file-content checks — no server, no
 * network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GUIDE_PATH = path.join(ROOT, 'docs', 'USER-GUIDE.he.md');
const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const { DEFAULT_TTL_SECONDS } = require('../lib/session');

const lines = guide.split('\n');
const h2s = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());

const REQUIRED_SECTIONS = [
  'כניסה',
  'פעולות יומיומיות',
  'תשלום למטפלים',
  'כללי עבודה חשובים (מונעים תקלות)',
  'בעיות נפוצות',
  'למי פונים',
];

function section(title) {
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  assert.ok(start >= 0, `section "## ${title}" exists`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

test('1. guide file exists and is non-empty', () => {
  assert.ok(fs.existsSync(GUIDE_PATH), 'docs/USER-GUIDE.he.md is present');
  assert.ok(guide.trim().length > 500, 'guide has real content');
  assert.ok(!guide.includes('�'), 'no U+FFFD replacement characters (valid UTF-8)');
});

test('2. body is wrapped in an RTL div with blank lines so Markdown still parses', () => {
  const trimmed = guide.trim();
  assert.match(trimmed, /^<div dir="rtl" lang="he">\n\n/, 'opens with <div dir="rtl" lang="he"> + blank line');
  assert.match(trimmed, /\n\n<\/div>$/, 'closes with blank line + </div>');
  const opens = (guide.match(/<div\b/g) || []).length;
  const closes = (guide.match(/<\/div>/g) || []).length;
  assert.strictEqual(opens, 1, 'exactly one opening div');
  assert.strictEqual(closes, 1, 'exactly one closing div');
});

test('3. H1 names the app in Hebrew and English', () => {
  const h1 = lines.find((l) => l.startsWith('# '));
  assert.ok(h1, 'has an H1');
  assert.ok(h1.includes('מטופלי חוץ'), 'H1 carries the Hebrew name');
  assert.ok(h1.includes('E-ZONE Outpatient'), 'H1 carries the English name');
});

test('4. every required section is present, in order, with no extras', () => {
  assert.deepStrictEqual(h2s, REQUIRED_SECTIONS);
});

test('5. login section: the bot never hands out passwords; password requests go to a person', () => {
  const s = section('כניסה');
  assert.ok(s.includes('הבוט לא מוסר סיסמאות'), 'states the bot does not give passwords');
  assert.ok(s.includes('סנדרה'), 'names a person to ask for a password');
});

test('5b. login section describes the real session behaviour (no "remember device" checkbox)', () => {
  const s = section('כניסה');
  // The app has no such checkbox — a correct PIN keeps the device logged in for
  // the cookie TTL and the name picker remembers the name per device.
  assert.ok(!s.includes('זכור מכשיר זה'), 'no reference to a non-existent "remember this device" checkbox');
  const days = DEFAULT_TTL_SECONDS / 86400;
  assert.ok(Number.isInteger(days), 'session TTL is a whole number of days');
  assert.ok(s.includes(`${days} ימים`), `states the device stays logged in for ${days} days (lib/session.js TTL)`);
  assert.ok(s.includes('בוחרים את השם'), 'mentions picking your name once');
});

test('6. therapist-payout section says the feature is not in use yet', () => {
  const s = section('תשלום למטפלים');
  assert.ok(s.includes('עדיין לא בשימוש'), 'flags the feature as not in use');
  assert.ok(s.includes('סנדרה'), 'routes questions about it to a person');
});

test('7. contact section routes faults to "משהו לא עובד" and urgent matters to a person', () => {
  const s = section('למי פונים');
  assert.ok(s.includes('משהו לא עובד'), 'faults go to the report page');
  assert.ok(s.includes('סנדרה'), 'urgent matters go to a person');
});

test('8. duplicates: the guide says NOT to delete on your own', () => {
  const s = section('בעיות נפוצות');
  assert.ok(s.includes('כפילות'), 'covers duplicates');
  assert.ok(s.includes('לא למחוק לבד'), 'tells users not to delete duplicates themselves');
  assert.ok(s.includes('לא להזין מחדש'), 'tells users not to re-enter a missing record');
});

test('9. nothing secret-looking in the guide', () => {
  // Env-style assignment of a credential (PIN=1234, SESSION_SECRET=..., password: ...).
  assert.doesNotMatch(guide, /\b(APP_PIN|SESSION_SECRET|SHEETS_URL|WINBACK_SECRET|PIN|SECRET|TOKEN|PASSWORD)\s*[:=]/i,
    'no credential-style key=value assignments');
  // A deployed Apps Script web-app URL.
  assert.doesNotMatch(guide, /script\.google\.com|\/exec\b/, 'no Apps Script URL');
  // Long hex/base64-looking blobs (HMAC secrets, cookies).
  assert.doesNotMatch(guide, /[A-Fa-f0-9]{24,}/, 'no long hex token');
  assert.doesNotMatch(guide, /[A-Za-z0-9+/]{32,}={0,2}/, 'no long base64 blob');
  // A concrete numeric PIN.
  assert.doesNotMatch(guide, /סיסמה\s*[:=]?\s*\d{3,}/, 'no numeric password value');
  // Phone numbers (patient/staff privacy).
  assert.doesNotMatch(guide, /0\d{1,2}[- ]?\d{7}/, 'no Israeli phone numbers');
});

test('10. no external links (the guide is offline-safe and cannot leak a URL)', () => {
  assert.doesNotMatch(guide, /https?:\/\//, 'no http(s) links');
});

test('11. UI wording the guide relies on still exists in public/index.html', () => {
  // Tabs referenced by the guide's daily-operations / payouts sections.
  for (const tab of ['לידים', 'מטופלים', 'תשלומי מטפלים']) {
    assert.ok(new RegExp(`<button class="tab[^"]*" data-view="[a-z]+">${tab}</button>`).test(indexHtml),
      `tab "${tab}" exists in the topbar`);
  }
  // Statuses / sections the guide names.
  assert.ok(indexHtml.includes('לא רלוונטי'), '"לא רלוונטי" status wording exists');
  assert.ok(indexHtml.includes('תוכנית טיפול'), '"תוכנית טיפול" section exists');
  assert.ok(indexHtml.includes('חידוש'), 'renewal ("חידוש") wording exists');
  // The guide talks about these in the same words.
  assert.ok(guide.includes('לא רלוונטי'));
  assert.ok(guide.includes('תוכניות טיפול') || guide.includes('תוכנית טיפול'));
  assert.ok(guide.includes('חידוש'));
});

test('12. README links to the guide', () => {
  assert.ok(readme.includes('docs/USER-GUIDE.he.md'), 'README references docs/USER-GUIDE.he.md');
  assert.match(readme, /\]\(docs\/USER-GUIDE\.he\.md\)/, 'as a Markdown link');
});
