'use strict';

const ORIGIN = 'https://ezone-outpatient.up.railway.app';

async function proxyReady(fetcher, expectedCommit) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '')) return false;
  try {
    const version = await fetcher(ORIGIN + '/api/version', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!version.ok || (await version.json()).commit !== expectedCommit) return false;
    const health = await fetcher(ORIGIN + '/healthz', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    return health.ok && (await health.json()).ok === true;
  } catch (_) {
    return false;
  }
}

function deploymentTarget(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Source deployment requires an explicit release dispatch');
  }
  if (env.GITHUB_REF !== 'refs/heads/claude/youthful-volta-laarnk') {
    throw new Error('Source deployment is restricted to the production branch');
  }
  // Surrounding spaces / line breaks only (a copy-pasted SHA picked up list
  // indentation on 2026-11-10 and failed two release runs). Nothing else is
  // normalised: the value must still be exactly 40 lowercase hex characters
  // AND equal the checked-out commit below.
  const commit = String(env.EXPECTED_COMMIT || '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (commit.length !== 40 || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Expected a full approved commit SHA (40 lowercase hex characters, nothing else)');
  }
  if (env.GITHUB_SHA !== commit) {
    throw new Error('Dispatch commit differs from the approved SHA; recheck the release');
  }
  return commit;
}

async function main() {
  const commit = deploymentTarget(process.env);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await proxyReady(fetch, commit)) {
      console.log('Matching Node version and source-proxy readiness confirmed.');
      return;
    }
    console.log('Waiting for the matching, ready Node deployment.');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('Node readiness not verified; source code and deployment were not touched.');
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { proxyReady, deploymentTarget };
