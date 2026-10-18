'use strict';

// Execute the real job and backup helpers. Only GAS services are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const copy = rows => rows.map(row => row.map(v => v instanceof Date ? new Date(v) : v));

function harness(sourceGrids) {
  const events = [], props = {}, logs = [], faults = {};
  let uuid = 0, scriptHeld = false, userHeld = false;
  function book(id) {
    const sheets = [];
    const ss = { getId: () => id, getSheets: () => sheets.slice(),
      getSheetByName: name => sheets.find(s => s.getName() === name) || null,
      insertSheet(name, initial = [['']]) {
        if (id === 'live' && faults.forbidLiveWrites) throw Error('LIVE WRITE');
        assert.equal(ss.getSheetByName(name), null);
        let rows = copy(initial), formats = rows.map(r => r.map(() => 'General'));
        let maxRows = 3, maxColumns = 3;
        const sh = { getName: () => name, getLastRow: () => rows.length,
          getLastColumn: () => rows[0]?.length || 1, getMaxRows: () => maxRows,
          getMaxColumns: () => maxColumns,
          insertRowsAfter(_, n) { maxRows += n; }, insertColumnsAfter(_, n) { maxColumns += n; },
          setName(next) {
            events.push(['rename', name, next]);
            if (faults.publish && next === faults.publish && name.startsWith('outpatient-pending-')) throw Error('publish failed');
            if (ss.getSheetByName(next)) throw Error('duplicate name');
            name = next;
          },
          getDataRange: () => sh.getRange(1, 1, rows.length, rows[0].length),
          getRange(r, c, nr = 1, nc = 1) {
            return {
              getValues() {
                events.push(['read', id, name, scriptHeld]);
                if (faults.read === name) throw Error('source read failed');
                const values = Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r-1+i]?.[c-1+j] ?? ''));
                if (faults.corrupt && name.startsWith('outpatient-pending-')) values[0][0] = 'corrupted';
                return copy(values);
              },
              getNumberFormats: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => formats[r-1+i]?.[c-1+j] || 'General')),
              getFormulas: () => Array.from({ length: nr }, () => Array(nc).fill(faults.formula ? '=1+1' : '')),
              setNumberFormats(values) { formats = copy(values); },
              setValues(values) {
                assert.equal(id, 'backup', 'Never write live data');
                assert.equal(scriptHeld, false, 'Backup writes must not block app saves');
                events.push(['write', id, name]);
                if (faults.write) throw Error('write failed');
                rows = copy(values).map(row => row.map(v => typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v));
              }
            };
          }
        };
        sheets.push(sh); return sh;
      },
      deleteSheet(sh) { assert.equal(id, 'backup'); events.push(['delete', sh.getName()]); sheets.splice(sheets.indexOf(sh), 1); }
    };
    return ss;
  }
  const live = book('live'), backup = book('backup');
  const ctx = { Date, SpreadsheetApp: {
      getActiveSpreadsheet: () => live, openById: id => id === 'live' ? live : backup,
      create: () => backup, flush() {}
    }, LockService: {
      getScriptLock: () => ({ tryLock: () => faults.captureLock ? false : (scriptHeld = true), releaseLock: () => { scriptHeld = false; } }),
      getUserLock: () => ({ tryLock: () => faults.writerLock ? false : (userHeld = true), releaseLock: () => { userHeld = false; } })
    }, Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm).update(value).digest()), getUuid: () => String(++uuid), formatDate: d => d.toISOString().slice(0,10) },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Logger: { log: (...args) => logs.push(args.join(' ')) },
    MailApp: { sendEmail() { throw Error('No live mail in tests'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k,v) => { props[k] = v; } }) }
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const grids=sourceGrids || {
    Clients:[['id','name','phone'], ['client-a','מטופל בדיקה','0500000001']],
    Leads:[['id','name','phone'], ['lead-a','פניית בדיקה','0500000002']],
    'לידים שהוסרו':[['id','name'], ['removed-a','פנייה שהוסרה']],
    'Clients-removed':[['id','name'], ['old-client','מטופל שהוסר']]
  };
  Object.entries(grids).forEach(([name,rows])=>live.insertSheet(name,rows));
  props.INTEGRITY_BACKUP_SSID = 'backup';
  faults.forbidLiveWrites = true;
  return { ctx, live, backup, events, props, faults, logs, locks: () => [scriptHeld,userHeld] };
}

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
  const source = { getSheetByName: n => n.includes('removed') || n === 'לידים שהוסרו' ? null : h.live.getSheetByName(n) };
  const captured = h.ctx._integrityCaptureData(source);
  assert.equal(captured.length, 8);
  for (const item of captured.slice(2)) { assert.equal(item.absent,true); assert.equal(item.grid.length,1); assert.equal(item.grid[0][0],'id'); }
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
  assert.deepEqual(Array.from(result, r => r.source), ['Clients','Leads','לידים שהוסרו','Clients-removed','Payments','ClientCharges','Credits','FinancialOps']);
  const changed = h.backup.getSheetByName('outpatient-payments-' + day);
  changed.getRange(1,1,2,1).setValues([['id'],['different-generation']]);
  assert.throws(() => h.ctx._integrityValidateRestoreSet(h.backup, day), /snapshot mismatch/);
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
