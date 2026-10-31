'use strict';

// Execute the real job and backup helpers. Only GAS services are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/backup-sandbox.cjs');

test('nightly job preserves existing client/lead datasets and unrelated tabs, never writes live data', () => {
  const h = harness();
  const original = h.live.getSheets().map(s => s.getDataRange().getValues());
  h.backup.insertSheet('dashboard-2000-01-01', [['keep']]);
  h.backup.insertSheet('Sheet1', [['manual content']]);
  for (const family of ['', 'leads-', 'leads-removed-', 'clients-removed-']) h.backup.insertSheet('outpatient-'+family+'2000-01-01', [['id'],['old']]);
  h.ctx.nightlyIntegrityJob();
  const day = h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  for (const [index, family] of ['', 'leads-', 'leads-removed-', 'clients-removed-'].entries()) {
    assert.deepEqual(h.backup.getSheetByName('outpatient-'+family+day).getDataRange().getValues(), original[index]);
    assert.equal(h.backup.getSheetByName('outpatient-'+family+'2000-01-01'), null);
  }
  assert.ok(h.backup.getSheetByName('dashboard-2000-01-01'));
  assert.ok(h.backup.getSheetByName('Sheet1'), 'Never delete an arbitrary default-named sheet');
  assert.deepEqual(h.live.getSheets().map(s => s.getDataRange().getValues()), original);
  assert.deepEqual(h.locks(), [false,false]);
  assert.equal(h.logs.some(l => l.includes('INTEGRITY ALERT')), false);
});

test('snapshot round-trip keeps text, literal formulas, apostrophes, numeric, boolean and Date values', () => {
  const h = harness();
  const grid = [['id','phone','literal','apostrophe','amount','flag','date'],['test','0500000001','=1+1',"'literal",1200.5,true,new Date('2026-10-09T10:11:12.000Z')]];
  const sh = h.ctx._integrityWriteSnapshot(h.backup, 'outpatient-leads-2026-10-09', grid);
  assert.deepEqual(sh.getDataRange().getValues(), grid);
  assert.equal(sh.getMaxColumns(), 7, 'Expand default grid before writing');
});

for (const fault of ['write','corrupt','formula','publish']) {
  test('failed '+fault+' keeps previous good snapshot and releases writer lock', () => {
    const h = harness(), name = 'outpatient-leads-2026-10-09';
    h.backup.insertSheet(name, [['id'],['last-good']]);
    h.faults[fault] = fault === 'publish' ? name : true;
    assert.throws(() => h.ctx._integrityWriteSnapshot(h.backup, name, [['id'],['new']]));
    assert.deepEqual(h.backup.getSheetByName(name).getDataRange().getValues(), [['id'],['last-good']]);
    assert.equal(h.events.some(e => e[0] === 'delete'), false);
    assert.deepEqual(h.locks(), [false,false]);
  });
}

test('same-day rerun replaces only after successful verification and removes stale trailing rows', () => {
  const h = harness(), name = 'outpatient-2026-10-09';
  h.backup.insertSheet(name, [['id'],['old-a'],['old-b']]);
  h.ctx._integrityWriteSnapshot(h.backup, name, [['id'],['new-a']]);
  assert.deepEqual(h.backup.getSheetByName(name).getDataRange().getValues(), [['id'],['new-a']]);
  assert.equal(h.backup.getSheets().length, 1);
  const verified = h.events.findIndex(e => e[0] === 'read' && e[2].startsWith('outpatient-pending-'));
  const retired = h.events.findIndex(e => e[0] === 'delete');
  assert.ok(verified >= 0 && retired > verified);
});

test('capture aborts on read failure or missing required sheet and always releases script lock', () => {
  const h = harness(); h.faults.read = 'Leads';
  assert.throws(() => h.ctx._integrityCaptureData(h.live), /source read failed/);
  assert.deepEqual(h.locks(), [false,false]);
  const missing = { getSheetByName: n => n === 'Leads' ? null : h.live.getSheetByName(n) };
  delete h.faults.read;
  assert.throws(() => h.ctx._integrityCaptureData(missing), /Missing backup source/);
});

test('absent optional archives are represented as empty header-only snapshots without creating live sheets', () => {
  const h = harness();
  const source = { ...h.live, getSheets: () => h.live.getSheets().filter(sh => !sh.getName().includes('removed') && sh.getName() !== 'לידים שהוסרו'), getSheetByName: n => n.includes('removed') || n === 'לידים שהוסרו' ? null : h.live.getSheetByName(n) };
  const captured = h.ctx._integrityCaptureData(source);
  assert.equal(captured.length, 20);
  for (const item of captured.slice(2, -1)) { assert.equal(item.absent,true); assert.equal(item.grid.length,1); assert.ok(item.grid[0].length); }
  assert.deepEqual(h.locks(), [false,false]);
});

test('capture and writer lock contention fail without writing or releasing an unowned lock', () => {
  const h = harness(); h.faults.captureLock = true; h.faults.writerLock = true;
  assert.throws(() => h.ctx._integrityCaptureData(h.live), /lock unavailable/);
  assert.throws(() => h.ctx._integrityWriteSnapshot(h.backup,'outpatient-2026-10-09',[['id']]), /already running/);
  assert.equal(h.events.some(e => e[0] === 'write'), false);
});

test('any source capture failure suppresses all writes and retention, and produces an alert', () => {
  const h = harness(); h.faults.read = 'Leads';
  h.backup.insertSheet('outpatient-leads-2000-01-01', [['id'],['retain']]);
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.events.some(e => e[0] === 'write' || e[0] === 'delete'), false);
  assert.ok(h.logs.some(l => l.includes('INTEGRITY ALERT')));
});

test('verification failure suppresses retention, protecting all existing history', () => {
  const h = harness(); h.faults.corrupt = true;
  h.backup.insertSheet('outpatient-2000-01-01', [['id'],['retain']]);
  h.ctx.nightlyIntegrityJob();
  assert.ok(h.backup.getSheetByName('outpatient-2000-01-01'));
  assert.ok(h.logs.some(l => l.includes('Backup value mismatch')));
});

test('misconfigured live workbook as backup is rejected before any write', () => {
  const h = harness(); h.props.INTEGRITY_BACKUP_SSID = 'live';
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.events.some(e => e[0] === 'write' || e[0] === 'delete'), false);
  assert.ok(h.logs.some(l => l.includes('Backup destination is the live spreadsheet')));
});

test('retention matches the eight exact data families and their manifest, never staging remnants or other apps', () => {
  const h = harness();
  for (const family of ['', 'leads-', 'leads-removed-', 'clients-removed-', 'payments-', 'charges-', 'credits-', 'financial-ops-', 'manifest-']) {
    assert.equal(h.ctx._integrityIsExpiredSnapshot('outpatient-'+family+'2026-01-01','outpatient-2026-10-09',30),true);
  }
  for (const name of ['outpatient-pending-2026-01-01','outpatient-previous-2026-01-01','outpatient-payments-manual-2026-01-01','dashboard-2026-01-01','outpatient-leads-2026-1-1','manual']) {
    assert.equal(h.ctx._integrityIsExpiredSnapshot(name,'outpatient-2026-10-09',30),false);
  }
});

test('missing Clients sheet never seeds a false zero sentinel', () => {
  const h = harness(); h.props.INTEGRITY_LAST_COUNT = '12';
  const get = h.live.getSheetByName; h.live.getSheetByName = n => n === 'Clients' ? null : get(n);
  h.ctx.nightlyIntegrityJob();
  assert.equal(h.props.INTEGRITY_LAST_COUNT,'12');
  assert.ok(h.logs.some(l => l.includes('Missing Clients sheet')));
});


test('financial snapshots and manifest verify as one set; mixed generation is refused', () => {
  const h = harness();
  h.ctx.nightlyIntegrityJob();
  const day = h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  const result = h.ctx._integrityValidateRestoreSet(h.backup, day);
  assert.deepEqual(Array.from(result, r => r.source), ['Clients','Leads','לידים שהוסרו','Clients-removed','Payments','ClientCharges','Credits','FinancialOps','SessionLog','TherapistRates','Settings','StopFlags','ExtraSessionRequests','מסלול המשך','התראות עצירת טיפול','AuditLog','RepairPlan','PackageCatalog','PackageRequests','__RecoveryMetadata']);
  const changed = h.backup.getSheetByName('outpatient-payments-' + day);
  changed.getRange(1,1,2,1).setValues([['id'],['different-generation']]);
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, day), /snapshot mismatch/);
});
test('a LEGACY 8-sheet manifest (written before the package sheets) still validates for restore', () => {
  const h = harness();
  h.ctx.nightlyIntegrityJob();
  const day = h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  const old = '2001-02-03';
  const cur = h.backup.getSheetByName('outpatient-manifest-' + day).getDataRange().getValues();
  const legacy = [cur[0]];
  for (const row of cur.slice(1, 9)) {
    const snap = String(row[2]).replace(day, old);
    h.backup.insertSheet(snap, h.backup.getSheetByName(String(row[2])).getDataRange().getValues());
    legacy.push([row[0], row[1], snap, row[3], row[4]]);
  }
  h.backup.insertSheet('outpatient-manifest-' + old, legacy);
  assert.equal(legacy.length, 9);
  assert.equal(h.ctx._integrityValidateRestoreSet(h.backup, old).length, 8);
});
test('journal deletion after activation blocks backup capture instead of inventing an empty journal', () => {
  const h = harness(); h.props.FINANCIAL_OPS_CREATED = '1';
  assert.throws(() => h.ctx._integrityCaptureData(h.live), /Missing backup source: FinancialOps/);
});

for (const crash of ['client_done','payment_written']) test('isolated manifest-checked restore resumes '+crash+' without another billing cycle', () => {
  const {fixture,failWrite}=require('../test-support/renewal-journal-fixture.cjs');
  const {sandbox}=require('../test-support/apps-script-sandbox');
  const f=fixture();f.reserve();
  if(crash==='client_done')failWrite(f.sb,'FinancialOps','payment_writing','before');
  else failWrite(f.sb,'Payments',null,'after');
  assert.equal(f.apply().ok,false);
  const grids=Object.fromEntries(Object.entries(f.sb.sheets).map(([name,sh])=>[name,sh.grid]));
  const h=harness(grids);h.props.FINANCIAL_OPS_CREATED='1';
  h.ctx.nightlyIntegrityJob();
  const day=h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  const captured=h.ctx._integrityValidateRestoreSet(h.backup,day);
  const restored=sandbox();
  for(const item of captured){
    if (item.absent || item.source === '__RecoveryMetadata') continue;
    const grid=item.grid;
    restored.seed(item.source,grid[0],grid.slice(1).map(row=>Object.fromEntries(grid[0].map((key,i)=>[key,row[i]]))));
  }
  restored.props.FINANCIAL_OPS_CREATED='1';
  const discover=restored.post({action:'getRenewalState',clientId:f.request.clientId});
  assert.equal(discover.operation.id,f.request.opId);
  assert.equal(discover.operation.cycleDate,'2026-02-28');
  assert.equal(restored.post({action:'applyRenewal',opId:f.request.opId}).operation.state,'done');
  assert.equal(restored.rows('Payments').length,1);
  assert.equal(restored.rows('Clients')[0].nextBillingDate,'2026-03-31');
  assert.equal(restored.rows('Payments')[0].amountPaid,600);
  assert.equal(restored.post({action:'applyRenewal',opId:f.request.opId}).operation.state,'done');
  assert.deepEqual(h.locks(),[false,false]);
});

test('interleaved backup replacement is detected before retention can remove older recovery sets', () => {
  const h=harness();h.backup.insertSheet('outpatient-2000-01-01',[['id'],['keep-until-coherent-new-set']]);
  const write=h.ctx._integrityWriteSnapshot;
  h.ctx._integrityWriteSnapshot=(ss,name,...args)=>{
    const result=write(ss,name,...args);
    if(name.startsWith('outpatient-manifest-')){
      const day=name.slice('outpatient-manifest-'.length);
      ss.getSheetByName('outpatient-payments-'+day).getRange(1,1,2,1).setValues([['id'],['other-capture']]);
    }
    return result;
  };
  h.ctx.nightlyIntegrityJob();
  assert.ok(h.backup.getSheetByName('outpatient-2000-01-01'));
  assert.ok(h.logs.some(l=>l.includes('Restore snapshot mismatch')));
});

test('restore preflight requires a journal when the restore target has the activation marker', () => {
  const h=harness();h.ctx.nightlyIntegrityJob();
  const day=h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  assert.throws(()=>h.ctx._integrityValidateRestoreSet(h.backup,day,true),/Restore journal required/);
  assert.equal(h.ctx._integrityValidateRestoreSet(h.backup,day,false).length,20);
});

for (const crash of ['charge_done','payment_written']) test('mixed-kind manifest restore resumes extra '+crash+' without duplicate effects',()=>{
  const renewal=require('../test-support/renewal-journal-fixture.cjs');
  const extra=require('../test-support/extra-charge-journal-fixture.cjs');
  const {sandbox}=require('../test-support/apps-script-sandbox');
  const r=renewal.fixture();r.reserve();r.apply();r.ack();
  const f=extra.fixture({monthly:true});f.sb.seed('FinancialOps',r.sb.ctx.FINANCIAL_OP_HEADERS,r.sb.rows('FinancialOps'));
  f.reserve();
  if(crash==='charge_done')extra.failWrite(f.sb,'FinancialOps','payment_writing','before');
  else extra.failWrite(f.sb,'Payments',null,'after');
  assert.equal(f.apply().ok,false);
  const h=harness(Object.fromEntries(Object.entries(f.sb.sheets).map(([name,sh])=>[name,sh.grid])));
  h.props.FINANCIAL_OPS_CREATED='1';h.ctx.nightlyIntegrityJob();
  const day=h.ctx._integritySnapshotName(new Date()).slice('outpatient-'.length);
  const restored=sandbox();
  for(const {source,grid,absent} of h.ctx._integrityValidateRestoreSet(h.backup,day,true)){
    if (absent || source === '__RecoveryMetadata') continue;
    restored.seed(source,grid[0],grid.slice(1).map(row=>Object.fromEntries(grid[0].map((key,i)=>[key,row[i]]))));
  }
  restored.props.FINANCIAL_OPS_CREATED='1';
  const state=restored.post({action:'getExtraChargeState',clientId:f.request.clientId});
  assert.equal(state.operation.id,f.request.opId);assert.equal(state.operation.kind,'extra_charge');
  for(let n=0;n<2;n++)assert.equal(restored.post({action:'applyExtraCharge',opId:f.request.opId}).operation.state,'done');
  assert.equal(restored.rows('ClientCharges').length,1);assert.equal(restored.rows('Payments').length,1);
  assert.equal(restored.rows('Payments')[0].paymentDate,'2026-10-31');
  assert.equal(restored.rows('ClientCharges')[0].treatmentType,'פרטני CBT');
  assert.equal(restored.rows('ClientCharges')[0].frequencyPerWeek,2);
  assert.equal(restored.rows('Clients')[0].nextBillingDate,extra.client.nextBillingDate);
  assert.equal(restored.rows('FinancialOps')[0].state,'acknowledged');assert.equal(restored.rows('FinancialOps').length,2);
  assert.deepEqual(h.locks(),[false,false]);
});
