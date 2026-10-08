'use strict';

/**
 * Build identity for GET /api/version.
 *
 * Public by design: it reveals only the deployed git commit and the time this
 * process started — no config, no env names, no secrets. It lets a deploy be
 * verified from outside ("is the merge SHA live yet?") without Railway access.
 *
 * `commit` comes from RAILWAY_GIT_COMMIT_SHA (set by Railway on every deploy).
 * The value is validated as a 7–40 char hex SHA; anything else (unset, empty,
 * malformed) yields null rather than echoing an arbitrary env string.
 */

const SHA_RE = /^[0-9a-f]{7,40}$/;

function normalizeCommit(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return SHA_RE.test(v) ? v : null;
}

function buildVersion(env, startedAt) {
  return {
    commit: normalizeCommit((env || {}).RAILWAY_GIT_COMMIT_SHA),
    builtAt: new Date(startedAt).toISOString()
  };
}

module.exports = { buildVersion, normalizeCommit };
