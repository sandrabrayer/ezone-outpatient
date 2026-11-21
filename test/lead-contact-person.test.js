'use strict';

/* איש קשר של ליד (2026-11-21, CHANGELOG-lead-contact-person.md): three OPTIONAL, browser-owned
 * columns appended to Leads — contactName / contactPhone / contactRelation. The source validates
 * every write, keeps the sheet's value for a tab loaded before the columns existed, and never
 * lets the contact phone become a patient match key. Real Code.gs in the sandbox + wiring pins. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const APP = read('public/app.js'), HTML = read('public/index.html');
const plain = (x) => JSON.parse(JSON.stringify(x));
const LEAD = { id: 'L1', name: 'נועם', phone: '0501111111', stage: 'פרטים אישיים', serviceType: 'פרטני', location: 'רעננה הפרדס', created: '2026-11-01', assignedTo: 'ורד' };
const contact = (l) => [l.contactName, l.contactPhone, l.contactRelation];

test('schema: three columns appended at the END of Leads only; the phone is text-forced and never a match key', () => {
  const { ctx } = sandbox();
  const H = plain(ctx.LEADS_HEADERS);
  assert.equal(H.length, 22);
  assert.deepEqual(H.slice(-4), ['preferredHouse', 'contactName', 'contactPhone', 'contactRelation']);
  assert.equal(H.indexOf('phone'), 2, 'nothing before them moved');
  assert.deepEqual(plain(ctx.LEAD_CONTACT_COLUMNS), ['contactName', 'contactPhone', 'contactRelation']);
  assert.equal(plain(ctx.PHONE_COLUMNS).contactPhone, true, 'leading zero survives the sheet');
  assert.deepEqual(plain(ctx.CROSS_APP_PHONE_SOURCES), ['phone', 'treatmentContactPhone'], 'the contact phone never identifies the patient');
  // the removed-leads archive and the Clients sheet are untouched
  const R = plain(ctx.REMOVED_LEADS_HEADERS);
  assert.equal(R.length, 21); assert.equal(R[R.length - 1], 'preferredHouse');
  for (const c of ['contactName', 'contactPhone', 'contactRelation']) {
    assert.equal(R.includes(c), false, c + ' not on the archive (OP-03 header correction pending)');
    assert.equal(plain(ctx.CLIENTS_HEADERS).includes(c), false, c + ' not on Clients');
  }
  assert.equal(plain(ctx.CLIENTS_HEADERS).length, 42);
});

test('saveAll: values are validated — text trimmed and capped, the phone recovered or refused (stored blank)', () => {
  const sb = sandbox([LEAD], []);
  const row = () => sb.rows('Leads')[0];
  let r = sb.save([Object.assign({}, row(), { contactName: '  רונית\u0007 לוי ', contactPhone: '052-5264094', contactRelation: 'אמא' })]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(contact(row()), ['רונית  לוי', '0525264094', 'אמא']);
  // a number Sheets would have stripped of its zero, a landline, an international form
  for (const [sent, stored] of [['525264094', '0525264094'], ['09-7654321', '097654321'], ['+972525264094', '0525264094']]) {
    sb.save([Object.assign({}, row(), { contactPhone: sent })]);
    assert.equal(row().contactPhone, stored, sent);
  }
  // an invalid phone is never written
  for (const bad of ['12345', 'abc', '05252640941234', '=1+1']) {
    sb.save([Object.assign({}, row(), { contactPhone: bad })]);
    assert.equal(row().contactPhone, '', bad);
  }
  sb.save([Object.assign({}, row(), { contactName: 'א'.repeat(200), contactRelation: 'ב'.repeat(200) })]);
  assert.equal(row().contactName.length, 80); assert.equal(row().contactRelation.length, 40);
  // cleared on purpose (keys present, blank)
  sb.save([Object.assign({}, row(), { contactName: '', contactPhone: '', contactRelation: '' })]);
  assert.deepEqual(contact(row()), ['', '', '']);
  assert.equal(row().phone, '0501111111', 'the patient phone is untouched throughout');
});

test('saveAll: a tab loaded BEFORE the columns existed (no keys in its payload) never blanks the contact person', () => {
  const sb = sandbox([LEAD], []);
  sb.save([Object.assign({}, sb.rows('Leads')[0], { contactName: 'רונית', contactPhone: '0525264094', contactRelation: 'אמא' })]);
  const old = Object.assign({}, sb.rows('Leads')[0]);
  for (const c of ['contactName', 'contactPhone', 'contactRelation']) delete old[c];
  old.note = 'עודכן מלשונית ישנה';
  const r = sb.save([old]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = sb.rows('Leads')[0];
  assert.equal(row.note, 'עודכן מלשונית ישנה');
  assert.deepEqual(contact(row), ['רונית', '0525264094', 'אמא']);
  // a brand-new lead from such a tab simply has none
  sb.save([row, { id: 'L2', name: 'חדש', phone: '0502222222', stage: 'פרטים אישיים', serviceType: 'פרטני', created: '2026-11-21' }]);
  assert.deepEqual(contact(sb.rows('Leads').find((l) => l.id === 'L2')), ['', '', '']);
});

test('saveAll: changing only the contact person is a real edit (stamped), and an unchanged echo is not', () => {
  const sb = sandbox([LEAD], []);
  sb.save([sb.rows('Leads')[0]]);
  const before = sb.rows('Leads')[0];
  const r1 = sb.save([Object.assign({}, before)], [], { user: 'דנה' });
  assert.equal(r1.stamped.leads, 0, 'an echo is not an edit');
  const r2 = sb.post({ action: 'saveAll', user: 'דנה', moneyScope: 'ops', leads: [Object.assign({}, sb.rows('Leads')[0], { contactName: 'אבא של נועם' })], clients: [] });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.stamped.leads, 1);
  assert.equal(sb.rows('Leads')[0].updatedBy, 'דנה');
  assert.equal(sb.rows('Leads')[0].contactName, 'אבא של נועם');
});

test('removing a lead still works; its contact person is not archived (documented limit)', () => {
  const sb = sandbox([LEAD], []);
  sb.save([Object.assign({}, sb.rows('Leads')[0], { contactName: 'רונית', contactPhone: '0525264094', contactRelation: 'אמא' })]);
  const r = sb.post({ action: 'removeLead', user: 'ורד', lead: { id: 'L1' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sb.rows('Leads').length, 0);
  const gone = sb.rows('לידים שהוסרו')[0];
  assert.equal(gone.id, 'L1'); assert.equal(gone.name, 'נועם'); assert.equal(gone.phone, '0501111111');
  assert.equal(Object.prototype.hasOwnProperty.call(gone, 'contactName'), false);
  assert.equal(sb.sheets['לידים שהוסרו'].grid[0].length, 21, 'the archive header keeps its width');
});

test('wiring: the form section, optional fields, validation, card line, call form and the carry to the patient', () => {
  const form = HTML.slice(HTML.indexOf('id="leadForm"'), HTML.indexOf('id="agreementModal"'));
  assert.ok(form.includes('פרטי הפונה / איש קשר (לא חובה)'));
  for (const n of ['contactName', 'contactPhone', 'contactRelation', 'contactRelationOther']) {
    assert.ok(form.includes('name="' + n + '"'), n);
    assert.equal(new RegExp('name="' + n + '"[^>]*required').test(form), false, n + ' is optional');
  }
  assert.ok(form.indexOf('פרטי המטופל') < form.indexOf('פרטי הפונה') && form.indexOf('פרטי הפונה') < form.indexOf('פרטים נוספים'), 'the Dashboard order');
  // the Dashboard CRM's relation list
  assert.match(APP, /var CONTACT_RELATIONS = \['מטופל', 'אמא', 'אבא', 'אח\/אחות', 'בן\/בת', 'בן\/בת זוג', 'סבא\/סבתא', 'קרוב משפחה', 'חבר\/חברה', 'עו"ס', 'אחר'\];/);
  // read from the sheet, always sent back (so the source can tell an old tab apart)
  assert.match(APP, /contactPhone: row\.contactPhone \? recoverPhone\(row\.contactPhone\) : ''/);
  assert.match(APP, /contactName: l\.contactName \|\| '',\n\s*contactPhone: l\.contactPhone \|\| '',\n\s*contactRelation: l\.contactRelation \|\| ''/);
  // a typed phone must be valid (mobile or landline); «אחר» must be spelled out
  assert.match(APP, /acceptPhone\(form\.contactPhone\.value \|\| '', 'טלפון איש הקשר', 'payer', false\) === false\) return;/);
  assert.match(APP, /toast\('יש לפרט את הקשר למטופל', true\)/);
  // shown escaped on the lead card and the retention card; carried to the patient's notes, never to a match key
  assert.match(APP, /'<div class="meta lead-contact">איש קשר: ' \+ escapeHtml\(leadContactText\(l\)\) \+ '<\/div>'/);
  assert.match(APP, /retRow\('איש קשר', escapeHtml\(leadContactText\(l\)\)\)/);
  assert.match(APP, /source: 'lead', notes: leadContactNote\(lead\), billingType: 'monthly',/);
  assert.equal(/treatmentContactPhone:\s*[^,\n]*contactPhone/.test(APP), false, 'never copied into treatmentContactPhone');
  // the call form: who to reach (textContent) and «עם מי» pre-filled
  assert.match(APP, /people\.textContent = bits\.join\(' · '\);/);
  assert.match(APP, /f\.elements\.withWhom\.value = cLead && cLead\.contactName \? cLead\.contactName : '';/);
});
