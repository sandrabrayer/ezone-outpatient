'use strict';

// Real Apps Script handlers; only Google runtime services are in-memory fixtures.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const clone = (x) => JSON.parse(JSON.stringify(x));

function sheet(name, initial) {
  const grid = (initial || []).map((r) => r.slice());
  const get = (r, c) => (grid[r - 1] || [])[c - 1] ?? '';
  const set = (r, c, v) => { (grid[r - 1] ||= [])[c - 1] = v; };
  const sh = {
    grid, getName: () => name, getLastRow: () => grid.length,
    getLastColumn: () => Math.max(0, ...grid.map((r) => r.length)),
    getMaxRows: () => Math.max(100, grid.length), setFrozenRows() {},
    appendRow: (r) => grid.push(r.slice()), deleteRow: (n) => grid.splice(n - 1, 1),
    getDataRange: () => sh.getRange(1, 1, grid.length, sh.getLastColumn()),
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValue: () => get(r, c),
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
        setValue: (v) => set(r, c, v),
        setValues: (rows) => rows.forEach((row, i) => row.forEach((v, j) => set(r + i, c + j, v))),
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(r + i, c + j, ''); },
        setNumberFormat() { return this; },
        getNumberFormats: () => Array.from({ length: nr }, () => Array.from({ length: nc }, () => '@'))
      };
    }
  };
  return sh;
}

function sandbox(leads = [], clients = []) {
  const sheets = {}, props = { OUTPATIENT_PROXY_SECRET: 'fixture-proxy-key-with-at-least-32-characters' };
  let held = false, uuid = 0;
  const lock = { tryLock: () => { held = true; return true; }, waitLock: () => { held = true; }, releaseLock: () => { held = false; } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'synthetic-source', getSheets: () => Object.values(sheets), getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = sheet(n)) }) },
    LockService: { getScriptLock: () => lock }, Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 10), getUuid: () => 'fixture-' + (++uuid),
      // Real SHA-256 / HMAC-SHA256 (Apps Script returns SIGNED byte arrays).
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_alg, text) => Array.from(crypto.createHash('sha256').update(String(text), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (msg, key) => Array.from(crypto.createHmac('sha256', String(key)).update(String(msg), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b))
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (text) => ({ setMimeType() { return this; }, getContent: () => text }) }
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  function seed(name, headers, rows) { sheets[name] = sheet(name, [clone(headers), ...rows.map((r) => headers.map((h) => r[h] ?? ''))]); }
  seed('Leads', ctx.LEADS_HEADERS, leads);
  seed('Clients', ctx.CLIENTS_HEADERS, clients);
  function rows(name) {
    const grid = sheets[name]?.grid || [];
    return grid.slice(1).filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(grid[0].map((h, i) => [h, r[i] ?? ''])));
  }
  function get(params) { return JSON.parse(ctx.doGet({ parameter: { ...params } }).getContent()); }
  function post(payload) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ proxySecret: props.OUTPATIENT_PROXY_SECRET, ...payload }) }, parameter: {} }).getContent()); }
  return { ctx, sheets, props, seed, rows, post, get, lock, isLocked: () => held,
    save: (leads, clients = [], extra = {}) => post({ action: 'saveAll', user: 'fixture-user', leads, clients, ...extra }) };
}

module.exports = { sandbox };
