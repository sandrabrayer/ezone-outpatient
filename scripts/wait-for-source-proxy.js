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

async function main() {
  const commit = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('A full GITHUB_SHA is required');
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
module.exports = { proxyReady };
