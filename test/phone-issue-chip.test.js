'use strict';

/**
 * The patient-card phone chip — «⚠ חסר טלפון» / «⚠ טלפון לא תקין».
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * A card shows the chip exactly when getTreatmentPlans would emit phone:'' +
 * phoneIssue for that client (the E-Zone Therapists roster cannot key them),
 * so Vered can see and fix it. The verdict comes from public/phone-issue.js —
 * the SAME rule the feed uses (test/treatment-plans-phone.test.js pins the
 * module to the real Code.gs). Here: the card verdict, the wording, the real
 * phoneIssueChipHtml from public/app.js (escaping, fail-soft), its placement,
 * style, script order and the service-worker bump.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PhoneIssue = require('../public/phone-issue.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GS = read('apps-script/Code.gs');
const APP = read('public/app.js');
const INDEX = read('public/index.html');
const CSS = read('public/style.css');
const SW = read('public/sw.js');

test('F: cardPhoneIssue mirrors the feed, except for a client the feeds do not carry', () => {
  assert.equal(PhoneIssue.cardPhoneIssue({ status: 'פעיל', phone: '0501234567' }), '');
  assert.equal(PhoneIssue.cardPhoneIssue({ status: 'פעיל', phone: '' }), 'missing');
  assert.equal(PhoneIssue.cardPhoneIssue({ status: 'פעיל', phone: '050123456' }), 'invalid');
  assert.equal(PhoneIssue.cardPhoneIssue({ status: 'פעיל', phone: '050123456', treatmentContactPhone: '0521234567' }), '');
  // Discharged clients are still in the feeds -> still flagged.
  assert.equal(PhoneIssue.cardPhoneIssue({ status: 'סיים טיפול', phone: '' }), 'missing');
  // Deactivated (deleted in the therapists app) -> excluded from the feeds -> no chip.
  assert.equal(PhoneIssue.cardPhoneIssue({ status: 'לא פעיל', phone: '' }), '');
  assert.equal(PhoneIssue.cardPhoneIssue(null), '');
  // The status literal is Code.gs's own.
  assert.match(GS, /var DEACTIVATED_CLIENT_STATUS_HE = 'לא פעיל';/);
  assert.equal(PhoneIssue.DEACTIVATED_STATUS, 'לא פעיל');
});

test('F: chip wording', () => {
  assert.deepEqual(PhoneIssue.PHONE_ISSUE_LABELS, { missing: 'חסר טלפון', invalid: 'טלפון לא תקין' });
  assert.match(PhoneIssue.PHONE_ISSUE_HINT, /אפליקציית המטפלים/);
  assert.doesNotMatch(PhoneIssue.PHONE_ISSUE_HINT, /\d{3,}/, 'no phone-like digits in the hint');
});

// Build the real phoneIssueChipHtml from app.js with a stub `self`.
function chipFn(selfStub) {
  const fn = APP.match(/\n  function phoneIssueChipHtml\(c\) \{[\s\S]*?\n  \}\n/);
  const esc = APP.match(/\n  function escapeHtml\(s\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fn && esc, 'phoneIssueChipHtml / escapeHtml found in app.js');
  return new Function('self', esc[0] + fn[0] + 'return phoneIssueChipHtml;')(selfStub);
}

test('F: the card renders an amber, escaped chip for a missing / invalid phone', () => {
  const chip = chipFn({ EzonePhoneIssue: PhoneIssue });
  const missing = chip({ status: 'פעיל', phone: '', treatmentContactPhone: '' });
  assert.match(missing, /^<span class="chip chip-phone-issue" title="[^"<>]+">⚠ חסר טלפון<\/span>$/);
  assert.match(chip({ status: 'פעיל', phone: '050123456' }), />⚠ טלפון לא תקין<\/span>$/);
  assert.equal(chip({ status: 'פעיל', phone: '0501234567' }), '');
  // Fail-soft: the module failed to load -> no chip, no crash.
  assert.equal(chipFn({})({ status: 'פעיל', phone: '' }), '');
  assert.equal(chipFn(undefined)({ status: 'פעיל', phone: '' }), '');
});

test('F: the chip sits in the card header meta row, next to the phone', () => {
  const start = APP.indexOf('\n  function clientCard(c) {');
  const end = APP.indexOf('\n  function ', start + 10);
  assert.ok(start !== -1 && end > start, 'clientCard found');
  const card = APP.slice(start, end);
  assert.match(card, /var phoneIssueChip = phoneIssueChipHtml\(c\);/);
  assert.match(card, /'<div class="client-meta">' \+ phoneChip \+ phoneIssueChip \+ locationChip \+ assignedChip \+ '<\/div>'/);
  assert.match(card, /\(phoneChip \|\| phoneIssueChip \|\| locationChip \|\| assignedChip\)/);
});

test('F: style — amber, from the existing palette', () => {
  assert.match(CSS, /\.chip-phone-issue \{[^}]*color: var\(--amber\)/);
});

test('F: index.html loads phone-issue.js (cache-busted) before app.js', () => {
  const mod = INDEX.indexOf('<script src="phone-issue.js?v=__BUILD__" defer></script>');
  const app = INDEX.indexOf('<script src="app.js?v=__BUILD__" defer></script>');
  assert.ok(mod !== -1 && app !== -1 && mod < app);
});

test('F: the service-worker cache was bumped from the live v7 to v8, and never regresses', () => {
  assert.match(SW, /v8 \(2026-09-28\): patient-card phone chip/);
  assert.doesNotMatch(SW, /var CACHE = 'ezone-outpatient-v7';/);
  const live = Number((SW.match(/var CACHE = 'ezone-outpatient-v(\d+)';/) || [])[1]);
  assert.ok(live >= 8, 'the live cache never goes below the v8 shipped here, got v' + live);
});

test('F: server.js is untouched — no new route, no new unauthenticated surface', () => {
  assert.doesNotMatch(read('server.js'), /phoneIssue|phone-issue/);
});
