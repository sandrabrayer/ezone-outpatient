'use strict';

// Execute the real job and backup helpers. Only GAS services are synthetic.
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
          deleteRows(_, n) { maxRows -= n; }, deleteColumns(_, n) { maxColumns -= n; },
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
      getScriptLock: () => ({ waitLock: () => { if (faults.captureLock) throw Error('lock unavailable'); scriptHeld = true; }, tryLock: () => faults.captureLock ? false : (scriptHeld = true), releaseLock: () => { scriptHeld = false; } }),
      getUserLock: () => ({ tryLock: () => faults.writerLock ? false : (userHeld = true), releaseLock: () => { userHeld = false; } })
    }, Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm).update(value).digest()), getUuid: () => String(++uuid), formatDate: d => d.toISOString().slice(0,10) },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Logger: { log: (...args) => logs.push(args.join(' ')) },
    MailApp: { sendEmail() { throw Error('No live mail in tests'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k,v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) }
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

module.exports = { harness };
