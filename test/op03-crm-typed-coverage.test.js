'use strict';
// E-ZONE One / OP-03 cross-module gate. Executed against the real integrated
// backup functions in a synthetic in-memory Google Apps Script harness.
// The CRM header fixtures match Outpatient draft #143 (2026-10-31).
// No Google access, production data, money writes or deployment.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/backup-sandbox.cjs');

const TASKS_HEADERS = [
  'id','kind','leadId','clientId','title','reason','assignee',
  'dueDate','dueTime','status','source','createdAt','createdBy','updatedAt','updatedBy',
  'doneAt','doneBy','outcome','deferredFrom','contactEventId','submissionId','money'
];
const ACTIVITY_HEADERS = [
  'eventId','occurredAt','recordedAt','kind','source','actorName',
  'leadId','clientId','summary','detailsJson','nextAction','nextDate'
];
function row(headers, data) { return headers.map(k => Object.hasOwn(data,k) ? data[k] : ''); }
function source(withCrm = true) {
  const d = {
    Clients:[['id','name','phone'],['client-a','דמה','0500000001']],
    Leads:[['id','name','phone'],['lead-a','דמה','0500000002']]
  };
  if (withCrm) {
    d.Tasks = [TASKS_HEADERS, row(TASKS_HEADERS,{
      id:'task-sub-0001',kind:'continuity',leadId:'lead-a',clientId:'client-a',
      title:'בדיקת פנייה',reason:'חזרה למטופל',assignee:'ורד',
      dueDate:'2026-11-02',status:'open',source:'contact',
      createdAt:'2026-11-01T12:40:00Z',submissionId:'sub-0001',money:'false'
    })];
    d.Activity = [ACTIVITY_HEADERS, row(ACTIVITY_HEADERS,{
      eventId:'contact:sub-0001',occurredAt:'2026-11-01T12:40:00Z',
      recordedAt:'2026-11-01T12:42:00Z',kind:'contact',source:'crm',
      actorName:'ורד',leadId:'lead-a',clientId:'client-a',
      summary:'בוצעה שיחה',nextAction:'שיחה חוזרת',nextDate:'2026-11-02'
    })];
  }
  return d;
}
function enable(h) {
  // In production the schemas are provided by the separately reviewed
  // Outpatient CRM #143, not copied into or created by the OP-03 patch.
  h.ctx.TASKS_HEADERS = TASKS_HEADERS;
  h.ctx.ACTIVITY_HEADERS = ACTIVITY_HEADERS;
}
const day = h => h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);

test('OP03-CRM-01: registry remains 19 datasets with no CRM source loaded; no invented empty tables', () => {
  const h = harness(source(false));
  const before = h.ctx._integritySourceSpecs();
  assert.equal(before.some(x => x.source === 'Tasks' || x.source === 'Activity'),false);
  assert.equal(h.live.getSheetByName('Tasks'),null);
  assert.equal(h.live.getSheetByName('Activity'),null);
  assert.deepEqual(h.locks(),[false,false]);
});

test('OP03-CRM-01b: pre-CRM unknown tabs called Tasks/Activity retain their opaque contract without undefined schema crash', () => {
  const h = harness(source());
  const before = h.ctx._integrityCaptureData(h.live);
  assert.ok(before.find(x => x.source === 'Tasks' && x.prefix.startsWith('other-')));
  assert.ok(before.find(x => x.source === 'Activity' && x.prefix.startsWith('other-')));
  h.ctx.nightlyIntegrityJob();
  const inspect = h.ctx._integrityValidateRestoreSet(h.backup,day(h),false);
  assert.ok(inspect.some(x=>x.source==='Tasks'));
  assert.ok(inspect.some(x=>x.source==='Activity'));
  assert.deepEqual(h.locks(),[false,false]);
});

test('OP03-CRM-02: exact CRM schema makes both source families typed, preserving linkage on snapshot and restore preflight', () => {
  const h = harness(source()); enable(h);
  const specs = h.ctx._integritySourceSpecs();
  assert.deepEqual(JSON.parse(JSON.stringify(specs.filter(x => ['Tasks','Activity'].includes(x.source)).map(x=>[x.source,x.key,x.prefix]))),
    [['Tasks','id','tasks-'],['Activity','eventId','activity-']]);
  const before = Object.fromEntries(['Tasks','Activity'].map(k => [k,h.live.getSheetByName(k).getDataRange().getValues()]));
  const result = h.ctx.nightlyIntegrityJob();
  assert.notEqual(result && result.ok,false,JSON.stringify(result));
  const captures = h.ctx._integrityValidateRestoreSet(h.backup,day(h),false);
  for (const k of ['Tasks','Activity']) {
    const rec = captures.find(x=>x.source===k);
    assert.ok(rec && !rec.absent);
    assert.deepEqual(rec.grid,before[k],k+' type-safe unmodified source rows');
    assert.ok(h.backup.getSheetByName('outpatient-'+k.toLowerCase()+'-'+day(h)));
    assert.deepEqual(h.live.getSheetByName(k).getDataRange().getValues(),before[k]);
  }
  assert.ok(captures.find(x=>x.source==='__RecoveryMetadata'));
  assert.deepEqual(h.locks(),[false,false]);
});

test('OP03-CRM-03: absence before feature creation is recorded, but after a captured source disappears backup fails closed', () => {
  const h = harness(source(false)); enable(h);
  const grid = h.ctx._integrityCaptureData(h.live);
  for (const k of ['Tasks','Activity']) {
    const rec = grid.find(x=>x.source===k);
    assert.ok(rec && rec.absent && rec.grid.length===1);
  }
  h.props.INTEGRITY_REQUIRED_SOURCES=JSON.stringify(['Tasks','Activity']);
  assert.throws(()=>h.ctx._integrityCaptureData(h.live),/Previously captured source missing/);
  assert.deepEqual(h.locks(),[false,false]);
});

test('OP03-CRM-04: exact headers and unique task/event IDs required for certified restore, not just checksum', () => {
  const h = harness(source()); enable(h);
  const goodTasks=source().Tasks,goodActivity=source().Activity;
  assert.doesNotThrow(()=>h.ctx._integrityValidateCrmGrid_('Tasks',goodTasks));
  assert.doesNotThrow(()=>h.ctx._integrityValidateCrmGrid_('Activity',goodActivity));
  assert.throws(()=>h.ctx._integrityValidateCrmGrid_('Tasks',[['eventId'],['event-1']]),/Invalid CRM backup headers/);
  assert.throws(()=>h.ctx._integrityValidateCrmGrid_('Activity',[ACTIVITY_HEADERS,row(ACTIVITY_HEADERS,{eventId:''})]),/Invalid CRM backup key/);
  assert.throws(()=>h.ctx._integrityValidateCrmGrid_('Tasks',[TASKS_HEADERS,goodTasks[1],goodTasks[1]]),/Invalid CRM backup key/);
  assert.throws(()=>h.ctx._integrityValidateCrmGrid_('Tasks',[TASKS_HEADERS,row(TASKS_HEADERS,{id:123})]),/Invalid CRM backup key/);
});

test('OP03-CRM-05: pre-CRM v2 snapshot is NOT silently relabelled/restorable as typed CRM after upgrade', () => {
  const h = harness(source());
  assert.ok(h.ctx._integrityCaptureData(h.live).some(x=>x.source==='Tasks'&&x.prefix.startsWith('other-')));
  h.ctx.nightlyIntegrityJob();
  enable(h);
  assert.throws(()=>h.ctx._integrityValidateRestoreSet(h.backup,day(h),false),/Invalid restore manifest entry|Incomplete recovery inventory/);
  assert.ok(h.backup.getSheetByName('outpatient-manifest-'+day(h)), 'historical original is preserved');
});

test('OP03-CRM-06: tampering a stored CRM grid fails checksum before any restore', () => {
  const h=harness(source());enable(h);
  h.ctx.nightlyIntegrityJob();
  const sh=h.backup.getSheetByName('outpatient-tasks-'+day(h));
  assert.ok(sh);
  const grid=sh.getDataRange().getValues();
  const changed=grid.map(x=>x.slice());
  changed[1][0]='task-tampered';
  sh.getRange(1,1,changed.length,changed[0].length).setValues(changed);
  assert.throws(()=>h.ctx._integrityValidateRestoreSet(h.backup,day(h),false),/Restore snapshot mismatch/);
  assert.deepEqual(h.locks(),[false,false]);
});
