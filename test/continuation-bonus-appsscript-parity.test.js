/**
 * Parity test: the Apps Script port of the bonus logic in
 * apps-script/Code.gs MUST produce numbers identical to the canonical,
 * unit-tested module public/continuation-bonus.js for the same data and
 * the same (current) month.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bonus rule is implemented twice on purpose: Apps Script cannot
 * require() the browser/Node module, so Code.gs re-implements it (same
 * arrangement as billing-status.js <-> app.js). A silent drift between the
 * two would mean wrong money in production. This test is the guard.
 *
 * STRATEGY
 * --------
 * Code.gs is not a Node module, so we extract the pure bonus functions
 * from its source by evaluating them inside a sandbox that stubs only the
 * Apps Script globals they touch (Session, Utilities, PropertiesService,
 * SpreadsheetApp via the _ensureSheet/_readAll seam). We feed both
 * implementations the same Clients fixtures and assert byHouse + total are
 * equal for the current month.
 *
 * Run with:  npm test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CB = require('../public/continuation-bonus.js');

const CODE_GS = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'Code.gs'),
  'utf8'
);

/* Current month key, same convention the port uses (yyyy-MM). */
function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * Build a sandbox exposing just enough Apps Script surface for the bonus
 * functions, with a controllable Clients dataset.
 */
function makeBonusEnv(clients) {
  const sandbox = {};
  sandbox.global = sandbox;

  // --- Apps Script global stubs (only what the bonus path uses) ---
  sandbox.Session = {
    getScriptTimeZone() { return 'Asia/Jerusalem'; }
  };
  sandbox.Utilities = {
    formatDate(date, _tz, fmt) {
      // The port only ever asks for 'yyyy-MM'.
      assert.equal(fmt, 'yyyy-MM');
      return date.getFullYear() + '-' +
             String(date.getMonth() + 1).padStart(2, '0');
    }
  };
  sandbox.PropertiesService = {
    getScriptProperties() {
      return { getProperty() { return null; } };
    }
  };

  // Stub SpreadsheetApp so the REAL _ss/_ensureSheet/_readAll in Code.gs
  // run against our fixture (exercises more of the real code path than
  // shadowing those helpers would).
  function fakeSheet() {
    // Header row + one row per client, columns ordered by CLIENTS_HEADERS.
    let headers = null;
    const rows = clients.slice();
    return {
      getLastRow() { return rows.length + 1; },
      getLastColumn() { return headers ? headers.length : 0; },
      setFrozenRows() {},
      getRange(r, c, nr, nc) {
        return {
          getValues() {
            if (r === 1) {
              // header read
              return [headers ? headers.slice(0, nc) : new Array(nc).fill('')];
            }
            // data read: rows[r-2 .. r-2+nr-1], projected to headers order
            const out = [];
            for (let i = 0; i < nr; i++) {
              const obj = rows[(r - 2) + i] || {};
              out.push(headers.map((h) => {
                const v = obj[h];
                return (v === undefined || v === null) ? '' : v;
              }));
            }
            return out;
          },
          setValues(vals) {
            if (r === 1) headers = vals[0].slice();
          },
          clearContent() {}
        };
      }
    };
  }
  sandbox.SpreadsheetApp = {
    getActiveSpreadsheet() {
      const sheets = {};
      return {
        getSheetByName(name) { return sheets[name] || null; },
        insertSheet(name) {
          const sh = fakeSheet();
          sheets[name] = sh;
          return sh;
        }
      };
    }
  };

  vm.createContext(sandbox);

  // Pull only the bonus-related declarations + their dependencies out of
  // Code.gs. Simplest robust approach: evaluate the whole file in the
  // sandbox; doGet/doPost are just function declarations and are harmless
  // unless called.
  vm.runInContext(CODE_GS, sandbox, { filename: 'Code.gs' });
  return sandbox;
}

function fixture(over) {
  return Object.assign({
    id: 'x', name: 'P', house_of_origin: 'raanana', status: 'פעיל',
    billingType: 'monthly', pricePerSession: 1000, sessionsPerWeek: '',
    bundlePrice: '', bundleSize: '', startDate: '', exitDate: ''
  }, over || {});
}

test('port and canonical agree on a mixed dataset (current month)', () => {
  const month = currentMonthKey();
  const clients = [
    fixture({ house_of_origin: 'raanana', pricePerSession: 2400 }),
    fixture({ house_of_origin: 'raanana', pricePerSession: 1800 }),
    fixture({ house_of_origin: 'ramot', pricePerSession: 3000, status: 'הפסקה זמנית' }),
    fixture({ house_of_origin: 'efroni', pricePerSession: 1500 }),
    fixture({ house_of_origin: 'external', pricePerSession: 5000 }),
    fixture({ house_of_origin: 'rehab', pricePerSession: 2200, status: 'סיים טיפול' }),
    fixture({ house_of_origin: '', pricePerSession: 999 }),
    fixture({ house_of_origin: 'efroni', pricePerSession: '', bundlePrice: 2000 })
  ];

  const env = makeBonusEnv(clients);
  // _getContinuationBonus returns an object created inside the vm realm;
  // round-trip through JSON so deepStrictEqual compares values, not realms.
  const ported = JSON.parse(JSON.stringify(env._getContinuationBonus()));

  const canonical = CB.computeMonth(clients, month, { ratePct: 5 });

  assert.equal(ported.ok, true);
  assert.equal(ported.month, month);
  assert.equal(ported.ratePct, canonical.ratePct);
  assert.deepStrictEqual(ported.byHouse, canonical.byHouse);
  assert.equal(ported.total, canonical.total);
  assert.equal(ported.kind, 'continuation_bonus');
  assert.equal(ported.sourceApp, 'ezone-outpatient');
});

test('port projection contains no PII / billing detail', () => {
  const env = makeBonusEnv([fixture({ pricePerSession: 1000 })]);
  const out = JSON.parse(JSON.stringify(env._getContinuationBonus()));
  const keys = Object.keys(out).sort();
  assert.deepEqual(
    keys,
    ['byHouse', 'kind', 'month', 'ok', 'ratePct', 'sourceApp', 'total']
  );
  // No per-patient lines, names, phones, payer fields leak through.
  assert.equal('lines' in out, false);
  assert.equal('name' in out, false);
});

test('port window/exit rule matches canonical for boundary client', () => {
  const month = currentMonthKey();
  // exitDate far in the past => excluded by both.
  const clients = [fixture({ pricePerSession: 1000, exitDate: '2000-01-31' })];
  const env = makeBonusEnv(clients);
  const ported = JSON.parse(JSON.stringify(env._getContinuationBonus()));
  const canonical = CB.computeMonth(clients, month, { ratePct: 5 });
  assert.deepStrictEqual(ported.byHouse, canonical.byHouse);
  assert.equal(ported.total, canonical.total);
  assert.equal(ported.total, 0);
});

test('_bonusAuthOk fails closed when no secret configured', () => {
  const env = makeBonusEnv([fixture()]);
  // PropertiesService stub returns null => no BONUS_SECRET configured.
  assert.equal(env._bonusAuthOk({ secret: 'anything' }), false);
  assert.equal(env._bonusAuthOk({}), false);
  assert.equal(env._bonusAuthOk(null), false);
});

test('_bonusAuthOk matches only the exact configured secret', () => {
  const clients = [fixture()];
  const env = makeBonusEnv(clients);
  // Re-point PropertiesService to a configured secret.
  env.PropertiesService.getScriptProperties = function () {
    return { getProperty(k) { return k === 'BONUS_SECRET' ? 's3cr3t' : null; } };
  };
  assert.equal(env._bonusAuthOk({ secret: 's3cr3t' }), true);
  assert.equal(env._bonusAuthOk({ secret: 'wrong' }), false);
  assert.equal(env._bonusAuthOk({}), false);
});
