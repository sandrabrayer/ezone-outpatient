# Secrets & environment-variable inventory

Every environment variable, Apps Script Script Property and GitHub Actions
secret this repo reads, with what it unlocks, how bad a leak is, where to
rotate it, and what rotating it does to users.

**No values live in this file — names only.** Never paste a value into the
repo, a PR, an issue, a log or a chat. `test/secrets-inventory.test.js` fails
CI if code starts reading a name that is not listed here.

Audited: 2026-10-22 against `claude/youthful-volta-laarnk` @ `8b68cd7`.
There is **no `.env.example`** in the repo and `railway.json` / `Procfile`
declare no variables (start command only); config is read directly in
`server.js`, `lib/*.js`, `scripts/*.js`, `apps-script/Code.gs` and
`.github/workflows/*.yml`.

## Where to rotate

| Place | How |
| --- | --- |
| **Railway** | Railway → project → `ezone-outpatient` service → **Variables** → edit → save. Saving **redeploys** the service (≈1–2 min); the new value applies only to the new deployment. |
| **Apps Script** | script.google.com → the outpatient project (`scriptId` in `.clasp.json`) → **Project Settings → Script properties** → edit → save. Read at request time: takes effect **immediately**, no redeploy, no new deployment. |
| **GitHub** | Repo → **Settings → Secrets and variables → Actions** → update secret. Used from the next workflow run. |

Side effect of **any** Railway variable save: the redeploy restarts the
process, which drops in-memory state — the PIN rate-limit counters and
Vered's catalog-admin (pricing) elevation. Normal sign-ins survive (they are
signed cookies) unless `SESSION_SECRET` itself changed.

## 1. Railway service variables (`server.js`, `lib/`)

| Variable | Authenticates to / used for | Risk | Rotate at | Logs users out? | Breaks the app? |
| --- | --- | --- | --- | --- | --- |
| `SESSION_SECRET` | HMAC key that signs every sign-in cookie (`ezone_session`) and the catalog-admin cookie (`lib/session.js`). Leak = forge a session as any user. | **High** | Railway | **Yes — everyone** (all 7-day cookies and admin cookies become invalid; sign in again). | No. Unset → fail-closed: `/api/verify-pin` 500, data routes 401. Must stay distinct from `CATALOG_ADMIN_ASSERTION_SECRET`. |
| `APP_PIN` | The shared sign-in PIN (`lib/pin.js`). Leak = anyone can sign in. | **High** | Railway **and** GitHub secret `APP_PIN` (weekly healthcheck) | **No** — existing cookies stay valid up to 7 days. To revoke a leaked PIN, rotate it **together with `SESSION_SECRET`**. | Staff must use the new PIN. If the GitHub secret is not updated, `weekly-healthcheck.yml` fails. |
| `OUTPATIENT_PROXY_SECRET` | Server → outpatient Apps Script (`proxySecret` on every `/api/sheets` call; `SOURCE_GET_AUTH`/`SOURCE_POST_AUTH` in `Code.gs`). Leak = full read/write on all patient, payment and billing data, bypassing the PIN. ≥ 32 chars. | **High** | **Both** Railway and Apps Script property (same value) | No | **Yes, until both sides match** — every data route fails during the gap. Do it off-hours: set the Apps Script property, then Railway immediately, then check `/healthz` = 200. Must differ from `PACKAGE_*` and `CATALOG_ADMIN_ASSERTION_SECRET`. |
| `CATALOG_ADMIN_ASSERTION_SECRET` | Signs the price-admin assertion the server adds to catalog-admin calls (`lib/catalog-admin.js` ↔ `_pkgConfigSecretOk` in `Code.gs`). Useless without `OUTPATIENT_PROXY_SECRET`; together = edit prices. ≥ 32 chars. | **Med** | **Both** Railway and Apps Script property (same value) | No (Vered re-opens pricing after the redeploy) | Only the pricing/catalog screens (503) until both sides match. |
| `SHEETS_URL` | The outpatient Apps Script `/exec` URL. An address, not a credential — every action behind it is secret-gated. | **Med** | Do **not** rotate — it is the existing deployment; Therapists (`OUTPATIENT_SHEETS_URL`) and Dashboard (`OUTPATIENT_LEAD_URL`) point at it too. If it leaks, rotate the secrets instead. | No | Yes if changed — the app and the other consumers lose their backend. |
| `DASHBOARD_SHEETS_URL` | The Dashboard Apps Script `/exec` URL (continuation-track roster proxy). Owned by the Dashboard repo. | **Low** | Dashboard owner; mirror here | No | Continuation roster only (fail-closed 503). |
| `OCCUPANCY_SECRET` | Server → Dashboard Apps Script `getAdmittedRoster` (read-only admitted-patient roster = patient names). | **Med** | Dashboard Apps Script property **and** this Railway variable **and** every other app that holds it (see `EZONE-ECOSYSTEM-STATUS.md`) | No | Continuation roster only, until all holders match. |
| `PORT` | HTTP listen port — injected by Railway. | Low | — (not a secret) | No | — |
| `RAILWAY_GIT_COMMIT_SHA` | Commit shown by `GET /api/version` — injected by Railway, hex-validated. | Low | — (public) | No | — |

## 2. Apps Script Script Properties (`apps-script/Code.gs`)

All are **fail-closed** (unset/empty/mismatch → rejected). None of them logs
anyone out of the outpatient app; a mismatch breaks only the named
integration until **both** sides hold the same value.

| Property | Who sends it / what it unlocks | Risk | Also update at | Breaks while mismatched |
| --- | --- | --- | --- | --- |
| `OUTPATIENT_PROXY_SECRET` | This Railway server — full read/write (see §1). | **High** | Railway | Whole outpatient app |
| `CATALOG_ADMIN_ASSERTION_SECRET` | This Railway server — price-admin assertion (see §1). | **Med** | Railway | Pricing/catalog admin |
| `TREATMENT_PLANS_SECRET` | Therapists app — `getTreatmentPlans` (prices, payer phones, payment links). | **Med** | Therapists Railway env | Therapists roster/plans |
| `DEBT_STATUS_SECRET` | Therapists app — `getDebtStatus` (who owes money). | **Med** | Therapists Railway env | Therapists debt status |
| `SESSION_OUTCOME_SECRET` | Therapists app — `recordSessionOutcome` (write; drives therapist pay). Set on **both** Apps Scripts. | **Med** | Therapists Apps Script + Railway | Session-outcome sync |
| `DEACTIVATE_CLIENT_SECRET` | Therapists app — `deactivateClient` (write; soft, reversible). | **Med** | Therapists app | Cross-app deactivation |
| `STOP_FLAG_SECRET` | Therapists app — `flagStop` / `resolveStopFlag` (write). | **Med** | Therapists app | Stop flags |
| `STOP_ALERTS_SECRET` | Therapists app — read/mark stop alerts. | **Med** | Therapists app | Stop alerts |
| `CLINICAL_TYPE_SECRET` | Therapists app — `setClinicalType` (write; feeds billing). | **Med** | Therapists app | Clinical-type sync |
| `CREATE_LEAD_SECRET` | Dashboard — `createLead` (write; lead handoff). | **Med** | Dashboard (`OUTPATIENT_LEAD_SECRET`) | Dashboard → outpatient leads |
| `WINBACK_SECRET` | Dashboard — `getWinbackSource` (lost-lead names/phones). | **Med** | Dashboard (`WINBACK_SOURCE_SECRET`) | Win-back list |
| `COLUMN_REPAIR_SECRET` | Operator only — `scanClientColumns` (reads raw Clients rows). | **Med** | — (delete it when not in use) | Repair scan only |
| `EXTRA_SESSION_SECRET` | Therapists app — `requestExtraSession` (creates a pending request; Vered approves). | Low | Therapists app | Extra-session requests |
| `PACKAGE_REQUEST_SECRET` | Managers (therapists app) — submit package-pricing requests. ≥ 32 chars, distinct. | Low | Therapists app | Package requests |
| `PACKAGE_CATALOG_SECRET` | Managers (therapists app) — price-free catalog reads. ≥ 32 chars, distinct. | Low | Therapists app | Catalog view for managers |
| `CLIENTS_DATA_VERSION` | Not a secret — optimistic-concurrency counter. **Never edit or rotate.** | — | — | — |
| `FINANCIAL_OPS_CREATED` | Not a secret — one-time setup marker. **Never edit or rotate.** | — | — | — |

## 3. GitHub Actions secrets (`.github/workflows/`)

| Secret | Authenticates to | Risk | Rotate at | Logs users out? | Breaks |
| --- | --- | --- | --- | --- | --- |
| `CLASPRC_JSON` | Google OAuth refresh token (clasp) for the account that owns the Apps Scripts. Leak = push any code to every E-Zone Apps Script → all data. | **High** | myaccount.google.com → Security → Third-party access → revoke clasp; then `clasp login` locally and paste `~/.clasprc.json` into this secret **in all six repos** (`DEPLOY.md`). | No | `deploy-apps-script.yml` in every repo until updated. Running apps keep working. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code subscription token for `claude.yml` (`@claude` on issues/PRs). | **Med** | `claude setup-token` locally → update secret; revoke the old one at claude.ai settings. | No | `@claude` workflow only. |
| `APP_PIN` | Copy of the Railway `APP_PIN` for `weekly-healthcheck.yml`. | **High** (same PIN) | Here, whenever the Railway one changes | No | Weekly healthcheck only. |
| `DEPLOYMENT_ID` | Not a credential — ID of the existing Web App deployment (part of the public `/exec` URL). | Low | Do not rotate — never create a new deployment. | No | Apps Script deploy if wrong. |

## 4. CI / runner / test-only variables (not secrets)

`GITHUB_STEP_SUMMARY`, `GITHUB_EVENT_NAME`, `GITHUB_REF`, `GITHUB_SHA`
(set by GitHub Actions); `EXPECTED_COMMIT` (deploy-workflow input), `APP_URL`
(healthcheck target, defaults to the production URL), `NODE_PATH`,
`EZONE_REQUIRE_BROWSER_TESTS`, `EZONE_BROWSER_EXECUTABLE`,
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `EZONE_FINANCIAL_SCREENSHOT`,
`EZONE_EXTRA_SCREENSHOT`, `EZONE_STAGING_REPORT_PATH`,
`EZONE_APPROVED_STAGING_URL`. Tests set throw-away values for the §1 names
themselves; production values are never needed to run `npm test`.

## Audit notes (no code changed)

- `README.md` still says `getWinbackSource` auth is "open when the
  `WINBACK_SECRET` Script Property is absent". The code
  (`_winbackAuthOk`) is **fail-closed** — the README line is stale.
- `CATALOG_ADMIN_PIN` survives only in a test cleanup line and a stale
  comment in `lib/catalog-admin.js`; the second pricing code was removed
  (owner decision 2026-10-19) and production does not read it.
- Startup logs print only `configured: true/false` for `SHEETS_URL`,
  `SESSION_SECRET`, `DASHBOARD_SHEETS_URL`, `OCCUPANCY_SECRET`; no secret
  value is ever logged.
