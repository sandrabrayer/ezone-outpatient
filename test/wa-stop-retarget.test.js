'use strict';

/**
 * Coverage for retargeting the wa-stop "הודעת עצירת טיפול" button to Yarden:
 *   - the recipient is a single configurable setting `yardenStopPhone`, persisted
 *     through the existing key/value Settings path (getSettings / saveSettings) —
 *     round-trips like any other setting, no new storage,
 *   - the wa-link is built for the configured number via the existing
 *     normalizePhone / phoneToWa helpers,
 *   - an unset number takes the "set it in settings" toast path (no wa-link),
 *   - the legacy per-patient treatmentContactPhone read is gone from this flow.
 *
 * Pure mirrors of the app.js helpers + Code.gs Settings store, plus source guards
 * over public/ so a mirror can't pass while the app drifts. Modeled on the passing
 * source-scan / pure-mirror suites (responsible-removal, card-money-panel-fixes).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app.js');
const HTML = read('public/index.html');

// --- canonical phone + wa-link mirrors (public/app.js) ---
function phoneDigits(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  return s.replace(/\D/g, '');
}
function normalizePhone(raw) {
  let s = phoneDigits(raw);
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  return s;
}
function phoneToWa(phone) {
  const p = normalizePhone(phone);
  return p ? '972' + p.slice(1) : '';
}
// Mirror of the reworded buildStopTreatmentMsg (instruction to Yarden).
function buildStopTreatmentMsg(c) {
  return 'ירדן, יש להפסיק את הטיפול של ' + c.name +
    ' — התשלום החודשי לא הוסדר. נא לבטל את המפגשים במערכת המטפלים. תודה, צוות E-ZONE איזון';
}
// Mirror of the wa-stop branch in handleRenewalActionClick.
function waStop(settings, client) {
  const yardenPhone = (settings && settings.yardenStopPhone) || '';
  if (!normalizePhone(yardenPhone)) {
    return { toast: 'לא הוגדר טלפון של ירדן — יש להגדיר בהגדרות ⚙️', opened: null };
  }
  const p = phoneToWa(yardenPhone);
  return { opened: 'https://wa.me/' + p + '?text=' + encodeURIComponent(buildStopTreatmentMsg(client)) };
}

// --- Code.gs Settings key/value store mirror ---
function saveSettings(settings) {
  const rows = [];
  Object.keys(settings).forEach((k) => rows.push({ key: k, value: settings[k] == null ? '' : String(settings[k]) }));
  return rows;
}
function getSettings(rows) {
  const s = {};
  rows.forEach((r) => { if (r.key) s[r.key] = r.value || ''; });
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// settings round-trip
// ─────────────────────────────────────────────────────────────────────────────
test('yardenStopPhone round-trips through the existing key/value Settings store', () => {
  const saved = { bankName: 'בנק', bankHolder: 'E-ZONE', yardenStopPhone: '0501234567' };
  const back = getSettings(saveSettings(saved));
  assert.equal(back.yardenStopPhone, '0501234567');
  assert.equal(back.bankName, 'בנק'); // other settings unaffected
});

test('an unset yardenStopPhone round-trips as an empty string (no crash)', () => {
  const back = getSettings(saveSettings({ bankName: 'בנק', yardenStopPhone: '' }));
  assert.equal(back.yardenStopPhone, '');
});

// ─────────────────────────────────────────────────────────────────────────────
// wa-link targets the configured number
// ─────────────────────────────────────────────────────────────────────────────
test('wa-stop builds a wa.me link for the configured Yarden number, in any input format', () => {
  const client = { name: 'דנה כהן' };
  const res = waStop({ yardenStopPhone: '050-123-4567' }, client);
  assert.ok(res.opened, 'a wa link should be opened');
  assert.match(res.opened, /^https:\/\/wa\.me\/972501234567\?text=/);
  // the message is an instruction to Yarden naming the patient
  assert.ok(res.opened.includes(encodeURIComponent('ירדן')));
  assert.ok(res.opened.includes(encodeURIComponent('דנה כהן')));
});

test('wa-stop tolerates a +972 / spaced number and still targets Yarden', () => {
  const res = waStop({ yardenStopPhone: '+972 50 123 4567' }, { name: 'x' });
  assert.match(res.opened, /^https:\/\/wa\.me\/972501234567\?/);
});

// ─────────────────────────────────────────────────────────────────────────────
// unset-number toast path
// ─────────────────────────────────────────────────────────────────────────────
test('wa-stop with no configured number toasts to set it in settings, opens nothing', () => {
  const res = waStop({ yardenStopPhone: '' }, { name: 'דנה' });
  assert.equal(res.opened, null);
  assert.match(res.toast, /לא הוגדר טלפון של ירדן/);
  assert.match(res.toast, /הגדרות/);
});

test('wa-stop with missing settings object also takes the toast path', () => {
  const res = waStop(undefined, { name: 'דנה' });
  assert.equal(res.opened, null);
  assert.ok(res.toast);
});

// ─────────────────────────────────────────────────────────────────────────────
// source guards — the app actually wires the new setting + drops the legacy read
// ─────────────────────────────────────────────────────────────────────────────
test('the settings modal carries the טלפון ירדן field, persisted like other settings', () => {
  assert.match(HTML, /name="yardenStopPhone"/);
  assert.match(HTML, /טלפון ירדן/);
  // wired through all four settings touch-points in app.js
  assert.match(APP, /settings:\s*\{[^}]*yardenStopPhone:\s*''/);            // state init
  assert.match(APP, /yardenStopPhone:\s*s\.yardenStopPhone \|\| ''/);        // loadAll mapping
  assert.match(APP, /form\.yardenStopPhone\.value = s\.yardenStopPhone/);    // modal prefill
  assert.match(APP, /yardenStopPhone:\s*\(fd\.get\('yardenStopPhone'\)/);    // save submit
});

test('the wa-stop handler targets the configured number and no longer reads the contact phone', () => {
  const branch = APP.match(/action === 'wa-stop'\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(branch, 'wa-stop branch not found');
  assert.match(branch[0], /state\.settings\s*&&\s*state\.settings\.yardenStopPhone/);
  assert.match(branch[0], /normalizePhone\(yardenPhone\)/);
  assert.match(branch[0], /openWhatsApp\(yardenPhone, buildStopTreatmentMsg\(c\)\)/);
  assert.doesNotMatch(branch[0], /treatmentContactPhone/);
});

test('buildStopTreatmentMsg is an instruction to Yarden naming the patient (old text gone)', () => {
  const fn = APP.match(/function buildStopTreatmentMsg\(c\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, 'buildStopTreatmentMsg not found');
  assert.match(fn[0], /ירדן/);
  assert.match(fn[0], /'\s*\+\s*c\.name\s*\+/);
  assert.doesNotMatch(fn[0], /נא לא להעניק טיפול/); // the old patient-facing wording
});
