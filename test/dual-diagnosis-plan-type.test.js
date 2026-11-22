'use strict';

/* «טיפול תחלואה כפולה» — a PLAN treatment type (2026-11-21, CHANGELOG-dual-diagnosis-plan-type.md).
 * Selectable in every plan picker and sent to the therapists app inside the plan; plan-only:
 * no price, no clinical → billing mapping, not offered as a charge. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');
const PatientType = require('../public/patient-type.js');
const TreatmentMap = require('../public/treatment-map.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('public/app.js'), GS = read('apps-script/Code.gs');
const plain = (x) => JSON.parse(JSON.stringify(x));
const LABEL = 'טיפול תחלואה כפולה';

test('the type is appended to the plan menu, after «טיפול משלים», under one constant', () => {
  assert.match(APP, /var DUAL_DIAGNOSIS_LABEL = 'טיפול תחלואה כפולה';/);
  assert.match(APP, /'מעקב פסיכיאטרי',\s*\n\s*COMPLEMENTARY_LABEL,\s*\n\s*DUAL_DIAGNOSIS_LABEL\s*\n\s*\];/);
  assert.equal(APP.split("'" + LABEL + "'").length - 1, 1, 'the label is written once (the constant)');
  // every plan picker is built from SERVICE_TYPES (lead, agreement, activation, direct intake, עריכה)
  assert.match(APP, /function populateServiceGroup\(group, selected\) \{[\s\S]{0,200}SERVICE_TYPES\.forEach/);
});

test('plan-only: not offered as a charge, and it has no price or billing mapping anywhere', () => {
  assert.match(APP, /function chargeServiceTypes\(\) \{ return SERVICE_TYPES\.filter\(function \(s\) \{ return s !== DUAL_DIAGNOSIS_LABEL; \}\); \}/);
  assert.equal(APP.split('chargeServiceTypes().map(').length - 1, 2, 'both charge dropdowns («+ הוסף טיפול», edit) use the filtered list');
  assert.equal(GS.includes(LABEL), false, 'no price, mapping or rate was invented at the source');
  assert.equal(read('public/treatment-map.js').includes(LABEL), false);
  assert.equal(read('public/therapist-pay.js').includes(LABEL), false);
  assert.equal(read('public/one-time-sessions.js').includes(LABEL), false);
  for (const v of Object.values(TreatmentMap)) {
    if (v && typeof v === 'object') assert.equal(Object.prototype.hasOwnProperty.call(v, LABEL), false);
  }
});

test('a plan with it saves, reads back and reaches the therapists feed unchanged (no amounts); the patient is «טיפולים פרטניים»', () => {
  const client = { id: 'c-dd', name: 'מטופל תחלואה כפולה', phone: '0501234567', status: 'פעיל', serviceType: 'פרטני, ' + LABEL,
    sessionsPerWeek: JSON.stringify({ 'פרטני': 1, [LABEL]: 2 }), startDate: '2026-11-01', location: 'רעננה הפרדס' };
  const sb = sandbox([], []);
  assert.equal(sb.save([], [client]).ok, true, 'the real saveAll accepts the plan');
  const saved = sb.rows('Clients')[0];
  assert.equal(saved.serviceType, 'פרטני, ' + LABEL);
  assert.deepEqual(JSON.parse(saved.sessionsPerWeek), { 'פרטני': 1, [LABEL]: 2 });
  const plan = plain(sb.ctx._getTreatmentPlans()).clients[0];
  assert.ok(JSON.stringify(plan).includes(LABEL), 'the plan the therapists app reads names the treatment');
  assert.equal(/price|amount|pay/i.test(Object.keys(plan).join(',')), false, 'still no money key in the projection');
  assert.deepEqual(PatientType.classify(client, []), { type: 'individual', manual: false });
  assert.deepEqual(PatientType.classify({ id: 'x', serviceType: LABEL }, []), { type: 'individual', manual: false });
  assert.deepEqual(PatientType.classify({ id: 'y', serviceType: 'ליווי יומי בקהילה, ' + LABEL }, []), { type: 'day_community', manual: false });
});
