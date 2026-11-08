'use strict';
// TEMPORARY CI-only transport to regenerate the DISABLED synthetic-only
// operational drill candidate against this exact source tree.
// Remove this test in the SAME commit that records the regenerated artifact.
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, PLACEHOLDER } = require('../test-support/build-google-operational-drill.cjs');
test('export current disabled drill candidate artifact for exact reproducibility', () => {
  const candidate = build();
  assert.ok(candidate.output.includes('ISOLATED_SCRIPT_ID_REQUIRED'));
  assert.ok(candidate.metadata.sourceCodeSHA256);
  const b64 = Buffer.from(candidate.output, 'utf8').toString('base64');
  const chunkSize = 2400;
  const chunks = Math.ceil(b64.length / chunkSize);
  console.log('EZONE_DRILL_CHUNKS_TOTAL__' + chunks);
  for (let i = 0; i < chunks; i++) {
    console.log('EZONE_DRILL_CANDIDATE__' + i + '__' + b64.slice(i * chunkSize, (i + 1) * chunkSize));
  }
  assert.ok(chunks > 1);
});
