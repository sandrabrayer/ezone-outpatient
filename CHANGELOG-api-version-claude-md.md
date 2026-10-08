# GET /api/version + CLAUDE.md autonomy rules

## Added
- `GET /api/version` — public, `Cache-Control: no-store`, returns exactly
  `{ commit, builtAt }`. `commit` is `RAILWAY_GIT_COMMIT_SHA` validated as a
  7–40 char hex SHA (anything else → `null`, so no arbitrary env string is
  echoed); `builtAt` is the process start time (ISO). Used after a merge to
  confirm the Railway deploy is live. Logic in `lib/version.js`.
- `CLAUDE.md` — repo facts (deployed branch, production URL, Apps Script
  deploy mode, test command) and the rules for autonomous Claude Code work.

## Changed
- `test/session-who-when.test.js` — the open-route allowlist now includes
  `/api/version` (intentionally public; reveals no config or secret).

## Security
- `npm audit fix` (lockfile only): `proxy-addr` (critical) and `body-parser`
  advisories resolved. One moderate `qs` advisory remains (no high/critical).

## Tests
- `test/api-version.test.js` — route contract (public, no-store, exact keys)
  and SHA validation edge cases.
