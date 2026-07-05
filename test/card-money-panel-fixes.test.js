'use strict';

/**
 * Coverage for the patient-card money-panel fix set:
 *
 *   #1 שולם quick action (חידוש ותשלום modal) — REGRESSION LOCK. The button must
 *      route through setCurrentMonthPaid → persistPayment → 'savePayment', NOT the
 *      clinical-type endpoint. (Reproduced live on youthful-volta: the committed
 *      base already routes correctly — the "Unknown clinical treatment type: paid"
 *      regression does NOT occur; this guard keeps it from ever being re-wired to
 *      the clinical path, and asserts the renew modal has no clinical field.)
 *   #2 ALL money content — including the extra-charge rows — renders in the RIGHT
 *      כספים panel (cc-money); the left תוכנית טיפול panel (cc-plan) holds no money.
 *   #3 Extra-charge edit round-trips through the SAME charge row (stable id, no
 *      duplicate); pure mirror of the edit transition + source guards.
 *   #4 אחראי-טיפול (treatmentContactPhone) removed from the edit UI + the
 *      duplicate-check paths; the sheet column is KEPT (append-only headers).
 *
 * Source guards read public/ directly so a mirror can't pass while the app drifts.
 * Modeled on the passing pure-mirror / source-scan suites (card-charge-mark-paid,
 * card-edit-renewal-fix, responsible-removal) — not the env-dependent forwarders.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app.js');
const HTML = read('public/index.html');
const CSS = read('public/style.css');
const GS = read('apps-script/Code.gs');

// ─────────────────────────────────────────────────────────────────────────────
// #1 — שולם quick action wiring lock
// ─────────────────────────────────────────────────────────────────────────────
test('#1 renewMarkPaid handler routes שולם through setCurrentMonthPaid', () => {
  // the click handler bound to #renewMarkPaid calls setCurrentMonthPaid(c, true)
  const m = APP.match(/renewMarkPaid\.addEventListener\('click', function \(\) \{[\s\S]*?setCurrentMonthPaid\(c, true\);[\s\S]*?\n    \}\);/);
  assert.ok(m, 'renewMarkPaid click handler not found or not wired to setCurrentMonthPaid');
  // and never posts the clinical-type endpoint from that handler
  assert.doesNotMatch(m[0], /setClinicalType|persist\(\)/);
});

test('#1 setCurrentMonthPaid persists via persistPayment → savePayment (not saveAll/clinical)', () => {
  const fn = APP.match(/function setCurrentMonthPaid\([\s\S]*?\n  \}/);
  assert.ok(fn, 'setCurrentMonthPaid not found');
  assert.match(fn[0], /persistPayment\(updated\)/);
  assert.doesNotMatch(fn[0], /setClinicalType|clinicalTreatmentType|\bpersist\(\)/);
  // persistPayment is the savePayment upsert path
  assert.match(APP, /async function persistPayment\(payment\)\s*\{\s*await apiPostAction\('savePayment'/);
});

test('#1 the frontend never posts a setClinicalType action (only Code.gs receives it)', () => {
  assert.doesNotMatch(APP, /apiPostAction\('setClinicalType'|action:\s*'setClinicalType'/);
});

test('#1 the חידוש ותשלום (renewForm) modal has no clinical-type field', () => {
  const form = HTML.match(/<form id="renewForm"[\s\S]*?<\/form>/);
  assert.ok(form, 'renewForm not found');
  assert.doesNotMatch(form[0], /clinicalTreatmentType/);
});

// ─────────────────────────────────────────────────────────────────────────────
// #2 — money content (incl. charges) lives in the right כספים panel
// ─────────────────────────────────────────────────────────────────────────────
test('#2 the extra-charge rows render in the money panel, not the plan panel', () => {
  const money = APP.match(/var moneyPanel =([\s\S]*?)'<\/div>';/);
  const plan = APP.match(/var planPanel =([\s\S]*?)'<\/div>';/);
  assert.ok(money && plan, 'money/plan panel blocks not found');
  assert.match(money[1], /cc-money/);
  assert.match(money[1], /chargesHtml/, 'chargesHtml must be in the money panel');
  assert.match(plan[1], /cc-plan/);
  assert.doesNotMatch(plan[1], /chargesHtml/, 'chargesHtml must NOT be in the plan panel');
});

test('#2 the two-column split makes the money (right) panel wider than the plan (left)', () => {
  // 1.25fr (money, DOM-first → right in RTL) vs 0.75fr (plan, left)
  assert.match(CSS, /\.client-card \.cc-body\s*\{[^}]*grid-template-columns:\s*1\.25fr\s+0\.75fr/);
});

test('#2 the green/blue tint scheme + @supports color-mix fallback are preserved', () => {
  assert.match(CSS, /\.client-card \.cc-money \{ background: #124733;/);
  assert.match(CSS, /\.client-card \.cc-plan  \{ background: #0d3845;/);
  assert.match(CSS, /@supports \(background: color-mix\(in srgb, red, blue\)\)/);
});

test('#2 mobile rule still stacks the two panels to one column', () => {
  assert.match(CSS, /@media \(max-width:\s*560px\)[\s\S]*?\.client-card \.cc-body \{ grid-template-columns: 1fr;/);
});

// ─────────────────────────────────────────────────────────────────────────────
// #3 — extra-charge edit: pure mirror of the transition + source guards
// ─────────────────────────────────────────────────────────────────────────────
// Mirror of the editChargeForm submit transition in public/app.js: the editable
// fields are overwritten from the form; the row's identity (id/clientId/created)
// is NEVER touched, so persistCharge upserts the SAME row (chg-<id>) — an edit
// updates the row, never creates a duplicate.
function toNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function applyChargeEdit(charge, form) {
  const billingType = (form.billingType || 'one_time');
  const next = Object.assign({}, charge);
  next.description = (form.description || '').trim();
  next.amount = toNum(form.amount);
  next.billingType = billingType === 'monthly' ? 'monthly' : 'one_time';
  next.treatmentType = (form.treatmentType || '').trim();
  next.frequencyPerWeek = (next.billingType === 'monthly' && form.frequencyPerWeek) ? toNum(form.frequencyPerWeek) : '';
  next.chargeDate = form.chargeDate || '';
  next.billingDay = next.billingType === 'monthly' && form.billingDay ? toNum(form.billingDay) : '';
  next.notes = (form.notes || '').trim();
  return next;
}

test('#3 editing an amount keeps the charge identity (id/clientId/created) stable', () => {
  const charge = { id: 'chg1', clientId: 'c1', created: '2026-01-01', description: 'אבחון',
    amount: 400, billingType: 'one_time', treatmentType: '', frequencyPerWeek: '', chargeDate: '2026-07-02', billingDay: '', notes: '' };
  const edited = applyChargeEdit(charge, { billingType: 'one_time', description: 'אבחון', amount: '550', chargeDate: '2026-07-02' });
  assert.equal(edited.id, 'chg1');
  assert.equal(edited.clientId, 'c1');
  assert.equal(edited.created, '2026-01-01');
  assert.equal(edited.amount, 550);
  assert.equal(edited.description, 'אבחון');
});

test('#3 switching one-time → monthly carries billingDay + frequency; monthly → one-time clears them', () => {
  const oneTime = { id: 'chg2', clientId: 'c1', created: 'x', billingType: 'one_time', amount: 100, chargeDate: '2026-07-02' };
  const toMonthly = applyChargeEdit(oneTime, { billingType: 'monthly', description: 'טיפול', amount: '300', chargeDate: '2026-07-02', billingDay: '5', frequencyPerWeek: '2' });
  assert.equal(toMonthly.billingType, 'monthly');
  assert.equal(toMonthly.billingDay, 5);
  assert.equal(toMonthly.frequencyPerWeek, 2);
  const backToOnce = applyChargeEdit(toMonthly, { billingType: 'one_time', description: 'טיפול', amount: '300', chargeDate: '2026-07-02', billingDay: '5', frequencyPerWeek: '2' });
  assert.equal(backToOnce.billingType, 'one_time');
  assert.equal(backToOnce.billingDay, '');
  assert.equal(backToOnce.frequencyPerWeek, '');
});

test('#3 each charge row carries an editor ✏️ edit action wired to openEditChargeModal', () => {
  assert.match(APP, /data-charge-edit="'\s*\+\s*escapeHtml\(ch\.id\)/);
  assert.match(APP, /data-charge-edit'\)[\s\S]*?openEditChargeModal\(c, ch\)/);
});

test('#3 the edit submit saves through persistCharge on the SAME charge (no new id)', () => {
  const handler = APP.match(/editChargeForm'\);[\s\S]*?editChargeForm\.addEventListener\('submit'[\s\S]*?\n    \}\);/);
  assert.ok(handler, 'editChargeForm submit handler not found');
  // finds the existing charge by id, never mints a new uid()
  assert.match(handler[0], /state\.charges\.find\(function \(c\) \{ return c\.id === editChargeIds\.chargeId; \}\)/);
  assert.doesNotMatch(handler[0], /uid\(\)/);
  assert.match(handler[0], /persistCharge\(charge\)/);
  // rollback snapshot + render (optimistic pattern)
  assert.match(handler[0], /Object\.assign\(charge, prev\)/);
  // persistCharge is the saveCharge upsert-by-id path (no duplicate row)
  assert.match(APP, /async function persistCharge\(charge\)\s*\{\s*await apiPostAction\('saveCharge'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// #4 — אחראי-טיפול removed from UI + duplicate checks; column kept in the sheet
// ─────────────────────────────────────────────────────────────────────────────
test('#4 the edit modal no longer carries the טלפון אחראי טיפול field/section', () => {
  assert.doesNotMatch(HTML, /treatmentContactPhone/);
  assert.doesNotMatch(HTML, /אחראי טיפול/);
});

test('#4 the edit-save handler no longer reads or writes the contact phone', () => {
  assert.doesNotMatch(APP, /fd\.get\('treatmentContactPhone'\)/);
  assert.doesNotMatch(APP, /client\.treatmentContactPhone\s*=/);
  assert.doesNotMatch(APP, /\btcPhone\b/);
});

test('#4 duplicate-identity is the patient phone only (contact phone dropped)', () => {
  const fn = APP.match(/function clientIdentityPhones\(c\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, 'clientIdentityPhones not found');
  assert.match(fn[0], /\[c\.phone\]/);
  assert.doesNotMatch(fn[0], /treatmentContactPhone/);
  // the duplicate report groups on the patient phone only too
  const rep = APP.match(/function duplicateClientReport\([\s\S]*?\[c\.phone\]\.forEach/);
  assert.ok(rep, 'duplicateClientReport must key off [c.phone] only');
});

test('#4 the sheet column is KEPT (append-only headers) — never removed', () => {
  // CLIENTS_HEADERS still lists treatmentContactPhone (column stays; only the UI
  // stops writing it). Removing a mid-array header would shift every later column.
  const headers = GS.match(/CLIENTS_HEADERS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(headers, 'CLIENTS_HEADERS not found');
  assert.match(headers[1], /treatmentContactPhone/);
  assert.match(headers[1], /'phone'/);
});

test('#4 the legacy column is still read + round-tripped (cross-app matching preserved)', () => {
  // normalizeClient hydrates it and clientForSheet passes it through unchanged —
  // it is simply never sourced from a UI control anymore.
  assert.match(APP, /treatmentContactPhone: recoverPhone\(row\.treatmentContactPhone\)/);
  assert.match(APP, /treatmentContactPhone: c\.treatmentContactPhone \|\| ''/);
});
