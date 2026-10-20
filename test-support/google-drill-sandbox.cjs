'use strict';
// Native-service double only. The generated candidate helpers run unchanged.
const vm = require('node:vm');
const crypto = require('node:crypto');
function runtime(output, scriptId) {
  const books = {}, props = {}, logs = [], cache = {}, faults = {}, events = [];
  let seq = 0, bound = null;
  const clone = v => v instanceof Date ? new Date(v) : v;
  function book(id, title) {
    const sheets = [];
    const ss = { getId: () => id, getName: () => title,
      rename(n) { title = n; }, getSheets: () => sheets.slice(),
      getSheetByName: n => sheets.find(s => s.getName() === n) || null,
      deleteSheet(sh) { if (sheets.length < 2) throw Error('Last sheet'); sheets.splice(sheets.indexOf(sh), 1); },
      insertSheet(name) {
        if (ss.getSheetByName(name)) throw Error('Duplicate sheet');
        const cells = [], formats = [];
        let maxRows = 1000, maxColumns = 26;
        const get = (r,c) => cells[r]?.[c] ?? '';
        const sh = { getName: () => name,
          setName(n) { if (ss.getSheetByName(n)) throw Error('Duplicate sheet'); name=n; return sh; },
          getLastRow: () => cells.reduce((n,r,i) => r?.some(v=>v!=='' && v!=null) ? i+1 : n,0),
          getLastColumn: () => Math.max(0,...cells.map(r=>(r||[]).reduce((n,v,i)=>v!=='' && v!=null?i+1:n,0))),
          getMaxRows: () => maxRows, getMaxColumns: () => maxColumns,
          insertRowsAfter(_,n) { maxRows+=n; }, insertColumnsAfter(_,n) { maxColumns+=n; },
          deleteRows(at,n) { cells.splice(at-1,n); formats.splice(at-1,n); maxRows-=n; },
          deleteColumns(at,n) { cells.forEach(r=>r.splice(at-1,n));formats.forEach(r=>r.splice(at-1,n));maxColumns-=n; },
          setFrozenRows() {}, appendRow(row) { sh.getRange(sh.getLastRow()+1,1,1,row.length).setValues([row]); },
          getDataRange: () => sh.getRange(1,1,Math.max(1,sh.getLastRow()),Math.max(1,sh.getLastColumn())),
          getRange(r,c,nr=1,nc=1) {
            if (r+nr-1>maxRows || c+nc-1>maxColumns) throw Error('Range outside grid');
            const range = {
              getValues() { events.push(['read',id,name]);return Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>clone(get(r-1+i,c-1+j)))); },
              getValue: () => clone(get(r-1,c-1)),
              setValues(rows) { events.push(['write',id,name]); rows.forEach((row,i)=>row.forEach((v,j)=>{(cells[r-1+i]||=[])[c-1+j]=typeof v==='string'&&v.startsWith("'")?v.slice(1):clone(v);}));return range; },
              setValue(v) { return range.setValues([[v]]); },
              getNumberFormats: () => Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>formats[r-1+i]?.[c-1+j]||'General')),
              setNumberFormats(rows) { rows.forEach((row,i)=>row.forEach((v,j)=>{(formats[r-1+i]||=[])[c-1+j]=v;}));return range; },
              setNumberFormat(v) { return range.setNumberFormats(Array.from({length:nr},()=>Array(nc).fill(v))); },
              getFormulas: () => Array.from({length:nr},()=>Array(nc).fill('')),
              clearContent() { return range.setValues(Array.from({length:nr},()=>Array(nc).fill(''))); }
            };return range;
          },
          copyTo(target) {
            const copy=target.insertSheet('Copy of '+name),grid=sh.getDataRange().getValues();
            if(copy.getMaxColumns()<grid[0].length)copy.insertColumnsAfter(copy.getMaxColumns(),grid[0].length-copy.getMaxColumns());
            copy.getRange(1,1,grid.length,grid[0].length).setValues(grid);
            copy.getRange(1,1,grid.length,grid[0].length).setNumberFormats(sh.getDataRange().getNumberFormats());
            return copy;
          }
        };sheets.push(sh);return sh;
      }
    };ss.insertSheet('Sheet1');return ss;
  }
  function mutex() { let held=false; return {
    waitLock() { if(held)throw Error('Lock reentered');held=true; },
    tryLock() { if(held)return false;held=true;return true; },releaseLock() { if(!held)throw Error('Unowned lock');held=false; }
  }; }
  const scriptLock=mutex(),userLock=mutex();
  const ctx={Date,JSON,Error,Object,Array,Number,String,Boolean,Math,RegExp,isFinite,isNaN,parseInt,parseFloat,
    ScriptApp:{getScriptId:()=>scriptId},SpreadsheetApp:{getActiveSpreadsheet:()=>bound,
      create(title) { const id='synthetic-book-'+(++seq);events.push(['create',id]);return books[id]=book(id,title); },
      openById(id) { events.push(['open',id]);if(!books[id])throw Error('No such fixture workbook');return books[id]; },flush(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,
      setProperty(k,v){props[k]=String(v);},deleteProperty(k){delete props[k];}})},
    LockService:{getScriptLock:()=>scriptLock,getUserLock:()=>userLock},
    CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put(k,v){cache[k]=v;},remove(k){if(faults.cache)throw Error('Cache unavailable');delete cache[k];}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],
      formatDate:(d,tz,f)=>d.toISOString().slice(0,f==='yyyy-MM'?7:10)},
    Session:{getScriptTimeZone:()=> 'Asia/Jerusalem'},Logger:{log:v=>logs.push(v)}};
  vm.createContext(ctx);vm.runInContext(output,ctx);
  return {ctx,books,props,logs,events,faults,bind:()=>{bound={};},state:()=>JSON.parse(props.OP03_DRILL_STATE||'null')};
}
module.exports={runtime};
