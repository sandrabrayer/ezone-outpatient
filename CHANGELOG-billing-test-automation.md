# Test automation — billing, renewal alerts, getWinbackSource, server routes + CI

## Why

The repo already had a solid `node --test` suite (48 files, 521 tests) but **no
CI**: nothing installed dependencies or ran the tests on a PR, so a regression
could merge and deploy unnoticed. On a clean checkout two tests even *appeared*
to fail — `sheets-secret-forwarding` and `debt-status-forwarding` — purely
because `express` was not installed; both pass after `npm install`. That is
exactly the gap CI closes.

Coverage was also uneven against the priority areas:

- **Billing** (`billing-status`, `charges`, `debt-status`) — well covered.
- **Renewal alerts** (`vered-alerts`) — well covered.
- **`getWinbackSource`** — only the *server proxy* forwarding `?secret=` was
  tested. The actual **shared-secret endpoint** in `apps-script/Code.gs`
  (`_winbackAuthOk` + `_getWinbackSource`) had no tests.
- **Server routes / auth** — `checkPin` was unit-tested, but the
  `/api/verify-pin` route (401 / 429 / fail-closed) and the fail-closed config
  behaviour of `/api/sheets` & `/api/continuation-roster` were untested at the
  HTTP level.

## What changed

### New tests (offline — no live backend, dummy secrets only)

- **`test/winback-source.test.js`** — mirrors `_winbackAuthOk` and
  `_getWinbackSource` (Code.gs cannot be `require`d in Node) with a keep-in-sync
  note. **The caller is mocked**: tests pass the same param objects
  `doGet(e.parameter)` / `doPost(payload)` hand the endpoint. Locks:
  - auth **open** when the `WINBACK_SECRET` Script Property is absent/empty;
  - auth **fail-closed** when a secret is configured — missing / wrong secret →
    `{ ok: false, error: 'unauthorized' }`, matching secret → data;
  - projection maps Leads at stage `לא רלוונטי` (`kind: 'lost_lead'`) and
    Clients at status `סיים טיפול` (`kind: 'discharged'`) into the win-back row
    shape, excludes every other row, empties missing fields to `''`, and never
    crashes on `null` / `[]` input.

- **`test/server-routes.test.js`** — boots the app with a stubbed `global.fetch`
  and dummy env. Covers `/healthz` → `200 { ok: true }`, `/api/debug/env`
  (reports config flags but does **not** leak the URL/deployment id), and the
  `/api/verify-pin` gate: correct PIN → 200, wrong → 401, and the per-IP rate
  limit → 429 after 10 failures.

- **`test/server-fail-closed.test.js`** — a separate process (server.js reads
  config into constants at load time) with the env **unset**. `fetch` is stubbed
  to throw so any accidental upstream call fails loudly. Asserts `/api/sheets`
  and `/api/continuation-roster` return `500` fail-closed **without** reaching
  upstream, and `/api/verify-pin` rejects (401) when `APP_PIN` is unset.

Suite: **521 → 538 tests, all passing.**

### CI

- **`.github/workflows/test.yml`** — `on: pull_request` and `push` to `main`.
  Steps: `actions/checkout@v5` → `actions/setup-node@v5` (Node 22, npm cache) →
  `npm ci` → `npm test`. A `concurrency` group cancels superseded runs on
  re-push. `permissions: contents: read` only.

### Docs

- `README.md` — new **Testing** section (run command, the offline/mock
  guarantee, coverage highlights, CI trigger).
- `CHANGELOG.md` — Testing/CI + Docs entries under `[Unreleased]`.

## What "passing" means

A green **Test** check = on that commit, `npm ci` installed dependencies from
the lockfile and `npm test` ran the full `node --test` suite (538 tests) to
completion with **zero failures** — server routes respond as expected, billing
and renewal logic returns the expected values, the shared-secret endpoints
fail closed on a bad/missing secret, and unauthenticated requests are blocked.
No live Google Apps Script backend is contacted at any point.
