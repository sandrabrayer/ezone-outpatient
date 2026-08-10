# Test automation — CI on every PR + push to main

Continuous integration for the outpatient repo: the existing Node test suite now
runs automatically, and two coverage gaps in the priority areas (billing /
renewal / the shared-secret win-back endpoint) are closed.

## What changed

### 1. GitHub Actions workflow — `.github/workflows/test.yml`

A new **Tests** workflow runs the suite on:

- **every pull request** (any base branch), and
- **every push to the mainline** — `main` plus the repo's default/deployed
  branch `claude/youthful-volta-laarnk` (per `EZONE-ECOSYSTEM-STATUS.md`, this
  repo's mainline is the deployed branch, not `main`).

Steps: `actions/checkout@v5` → `actions/setup-node@v5` (Node 22, npm cache) →
`npm ci` (clean install from `package-lock.json`) → `npm test` (`node --test`).
A `concurrency` group cancels an in-flight run when a newer commit lands on the
same ref. `permissions: contents: read` only — the suite needs no secrets.

"Passing" means **every test under `test/` passes** (538 at time of writing).
The job fails if any test fails or if `npm ci` can't install cleanly.

### 2. New tests for the prioritized areas

- **`test/winback-source.test.js`** — the shared-secret `getWinbackSource`
  cross-app endpoint. Pure mirrors of `_winbackAuthOk` and `_getWinbackSource`
  exercise the auth gate with the **caller mocked** as a request-params object
  (secret absent / wrong / exact), and the projection (lost leads +
  discharged clients, minimal shape, no billing/payer leak, blanks → `''`).
  Source-scan guards on `apps-script/Code.gs` prove both the `doGet` and the
  `doPost` routes run the auth gate **before** returning data (no
  unauthenticated back door) and keep the mirrors from drifting.
- **`test/verify-pin-route.test.js`** — HTTP-route coverage for edit-mode auth:
  `POST /api/verify-pin` returns `200` on the correct PIN, `401` on a wrong or
  missing PIN, and `429` after 10 wrong attempts; `GET /healthz` responds. This
  complements the existing `lib/pin.js` unit test (`test/pin.test.js`) by proving
  the Express wiring blocks unauthenticated requests.

Billing and renewal-alert logic were already well covered
(`test/billing-status.test.js`, `test/debt-status*.test.js`,
`test/collection-amount-override.test.js`, `test/charges*.test.js`,
`test/vered-alerts.test.js`, `test/card-*-renewal*.test.js`, …) — the CI
workflow is what makes that coverage enforced on every change.

## No live calls, no real secrets

Every test is self-contained: the two route tests stub `global.fetch` or hit
only local, upstream-free routes; the Code.gs tests use pure mirrors + regex
against the committed source. **Nothing calls the live Google Apps Script
backends or any sibling app.** All PINs/secrets in test files are dummy values.

## How to run locally

```bash
npm ci
npm test
```
