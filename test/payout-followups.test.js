/**
 * payout-followups.test.js
 * -----------------------------------------------------------------------------
 * Source-guard tests (create-lead.test.js pattern) for the three payout
 * follow-up fixes:
 *   A. creditsOwed restored to CLIENTS_HEADERS (credit engine was silently
 *      no-oping without a persisted column — port defect vs the source branch).
 *   B. Credit balance persisted via a single-cell write (_writeCreditsOwed),
 *      not a whole-Clients-sheet rewrite (save-path hotspot).
 *   C. Therapist pay rates are sheet-managed (TherapistRates, auto-seeded,
 *      cached) so new therapists are added without a code redeploy — while the
 *      unknown-therapist path stays fail-closed.
 * Plus: the payouts/retention tab headings are no longer dark-on-dark.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// --- A. creditsOwed column ---
test('source: creditsOwed is a CLIENTS_HEADERS column (credit engine persists)', () => {
  const m = SRC.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CLIENTS_HEADERS not found');
  assert.match(m[1], /'creditsOwed'/, 'creditsOwed must be a persisted Clients column');
});

// --- B. single-cell credit write ---
test('source: credit balance uses _writeCreditsOwed, not a whole-sheet rewrite', () => {
  const m = SRC.match(/function _recordSessionOutcome\(payload\)[\s\S]*?\n}\n/);
  assert.ok(m, '_recordSessionOutcome not found');
  const fn = m[0];
  assert.match(fn, /_writeCreditsOwed\(clientsSh, clientId, balance\)/);
  assert.doesNotMatch(fn, /_writeAll\(clientsSh/, 'must not rewrite the whole Clients sheet per session');
});

test('source: _writeCreditsOwed scans the id column and writes one cell', () => {
  const m = SRC.match(/function _writeCreditsOwed\([\s\S]*?\n}\n/);
  assert.ok(m, '_writeCreditsOwed not found');
  const fn = m[0];
  assert.match(fn, /CLIENTS_HEADERS\.indexOf\('id'\)/);
  assert.match(fn, /CLIENTS_HEADERS\.indexOf\('creditsOwed'\)/);
  assert.match(fn, /setValue\(balance\)/, 'single-cell setValue, not setValues over the sheet');
});

// --- C. sheet-managed rates ---
test('source: TherapistRates sheet is loaded, auto-seeded from the constants, and cached', () => {
  const m = SRC.match(/function _loadTherapistRates\(\)[\s\S]*?\n}\n/);
  assert.ok(m, '_loadTherapistRates not found');
  const fn = m[0];
  assert.match(fn, /'TherapistRates'|THERAPIST_RATES_SHEET/);
  assert.match(fn, /THERAPIST_FLAT_RATES/, 'must seed flat rates');
  assert.match(fn, /PSYCHIATRIST_RATES/, 'must seed psychiatrist rates');
  assert.match(fn, /CacheService/, 'must cache to keep the per-session path fast');
});

test('source: _therapistPay consults the sheet first and stays fail-closed', () => {
  const m = SRC.match(/function _therapistPay\([\s\S]*?\n}\n/);
  assert.ok(m, '_therapistPay not found');
  const fn = m[0];
  assert.match(fn, /_loadTherapistRates\(\)/, 'sheet rates first');
  assert.match(fn, /throw new Error\('Unknown therapist/, 'unknown therapist must still throw (fail-closed, never invent a rate)');
  assert.match(fn, /THERAPIST_FLAT_RATES/, 'constants kept as fallback');
});

test('source: recordSessionOutcome auth stays fail-closed (unchanged by this fix)', () => {
  const m = SRC.match(/function _sessionOutcomeAuthOk\([\s\S]*?\n}\n/);
  assert.ok(m, '_sessionOutcomeAuthOk not found');
  assert.match(m[0], /getScriptProperties\(\)\.getProperty\('SESSION_OUTCOME_SECRET'\)/);
});

// --- headings visible on the dark theme ---
test('html: payouts + retention headings are not dark-on-dark', () => {
  const h2s = HTML.match(/<h2[^>]*>[^<]*(תשלומי מטפלים|שימור לידים)[^<]*<\/h2>/g) || [];
  assert.ok(h2s.length >= 2, 'both headings present');
  for (const h of h2s) assert.doesNotMatch(h, /#1a2e4a/, 'dark navy is invisible on the dark theme');
});
