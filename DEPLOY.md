# Deploy — E-ZONE Outpatient

## Source authentication — configuration prerequisites

OP-01 was released in PR #115 on 2026-10-17 (Node `76de4cc5`, Apps Script @94).
Keep the configured keys; do not generate or rotate them for routine releases.
Initial setup requires a dedicated `OUTPATIENT_PROXY_SECRET` in both the
Outpatient Railway service and its existing Apps Script Script Properties.
The value must be identical, randomly generated, at least 32 characters, and
separate from all existing keys. Do not put it in a PR, chat, code or log.
Sandra/the configuration owner must set and verify it before approval/merge.
Under `CLAUDE.md` Codex must not change Railway settings or variables.

Also verify existing `DEBT_STATUS_SECRET` and `TREATMENT_PLANS_SECRET` in BOTH
Therapists Node and Therapists Apps Script match the Outpatient Script Properties.
The previously optional source keys now fail closed. Establish whether the
win-back consumer is in use before tightening its previously optional key.
All other consumer keys retain their current names/scopes.

The explicitly dispatched source workflow first verifies the production branch
and approved full SHA, then waits for the **exact merge commit** at
Node `/api/version` and successful `/healthz` (which now requires a configured
proxy credential). Only then does it push/publish Apps Script. The previous
source ignores the added proxy credential, enabling this ordered transition.
A timeout leaves the source untouched. No new deployment ID or source workbook.
The health check confirms only local Node configuration, not key equality,
consumer configuration or authenticated end-to-end access. Those are separate
release checks. See the full inventory, manual click paths, acceptance and
rollback constraints in [docs/source-auth-boundary.md](docs/source-auth-boundary.md).

## OP-02b1 confirmation candidate (2026-10-18)

Baseline #117 is released: Node `72c80686`, source @96. This candidate changes
frontend/tests/docs only; source code, keys and deployment gate are unchanged.
After exact-head CI/review and separate Sandra approval: merge, verify the exact
Node SHA and health, served SW v9 and three homepage timings. No Apps Script
dispatch is required for this candidate; source stays @96. Do not create dummy
financial rows in production. Rollback must use a cache version above the then
live version. See `CHANGELOG-financial-save-confirmation.md`.

## Historical data-integrity release notes (#113; now deployed)

Sandra's explicit production approval and green candidate CI are required.
The authorized whole-workbook backup was created at 21:12:58 Israel on
2026-10-09 and verified at 21:15:47: all 18 sheets, 3,649 entered cells and
used-range cell metadata match. Backup ID:
`1pzINQ3p73bKo7bISBFkxrVN6z-pt5esz3wIHUZCfyz8` (owner-only permissions).
See `test-support/production-backup-results-20261009.json`; source modified
time remained `2026-10-09T12:26:46.957Z` throughout verification. Sandra was
told writes could resume after verification. This approval covered backup
only, not merge/deploy. Before merge, recheck backup freshness, source baseline
and the active deployment. If data changed, agree another short write pause
and verify a newer backup. Do not change the source
workbook binding. Read-only inspection on 2026-10-09 verified the `.clasp.json`
project is bound to `17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc` and its
active web app ending `FOwWYIw` is version 92.
The later browser recheck reached Google's signed-out Apps Script
landing page, so it did not reconfirm version 92. Renew browser access and
verify the active version before any approved deployment; do not infer it
from repository CI or the earlier observation.

One existing time-driven `nightlyIntegrityJob` trigger runs **Head**. Keep it;
no new installer or scopes are needed for the staged four-dataset backup.
After approval/deployment, verify the Clients, Leads and two archive snapshots
in the existing backup workbook and verify the next scheduled run.

Rolling the web deployment back to the recorded version does not revert
**Head**, which runs the nightly job. A scheduled-job rollback also requires
reverting the source through the approved repository/CI workflow. Neither
code rollback restores data nor changing a spreadsheet ID constitutes recovery.
See `CHANGELOG-daily-backup-coverage.md` for evidence and limitations.

Two ordered release phases:

| Layer | Runs it | Trigger |
| --- | --- | --- |
| **Node/Express + frontend** | Railway | Auto-deploys the connected branch (`claude/youthful-volta-laarnk`, per `EZONE-ECOSYSTEM-STATUS.md`). |
| **Apps Script backend** (`apps-script/**`) | GitHub Actions → clasp | Explicit dispatch after matching Node is live (below). |

**Verify a Railway deploy:** `GET https://ezone-outpatient.up.railway.app/api/version`
→ `{ commit, builtAt }`; `commit` must equal the merge SHA. If it never
updates, Railway skipped the deploy.

## Apps Script release phase (clasp in GitHub Actions)

**Workflow:** [`.github/workflows/deploy-apps-script.yml`](.github/workflows/deploy-apps-script.yml)

Railway has **Wait for CI** enabled. A push-triggered source workflow that waits
for Node prevents Node from deploying: each waits on the other. PR #115 exposed
this on 2026-10-17. The source workflow therefore has **no push trigger**. Keep
Railway's checks enabled; do not mark a failed check successful to release.

For each separately approved release:

1. Check the exact PR/head/base and all candidate CI before merging. Merge only
   after Sandra's production approval; record the full merge SHA.
2. Wait for Railway to serve that exact SHA at `/api/version` and for `/healthz`
   to succeed. Do not dispatch Apps Script while Node is waiting for checks.
3. When `apps-script/**`, `.clasp.json`, the workflow or its gate changed, open
   GitHub **Actions → Deploy Apps Script → Run workflow**. Select
   `claude/youthful-volta-laarnk`; set `expected_commit` to the full approved SHA.
   This is the releasing agent/operator's next step, not a new configuration
   request for Sandra. GitHub also supports the same dispatch through its API.
4. The gate rejects a non-dispatch event, wrong branch, invalid SHA or advanced
   branch before accessing clasp credentials. It then checks exact live SHA and
   health. Failure leaves Apps Script Head and the deployment unchanged.
5. The workflow installs `@google/clasp@3.3.0`, validates existing credentials,
   pushes source and publishes a **new version of the EXISTING deployment**.
   Require the `Deployed …@<version>` confirmation and a successful workflow.
6. Verify authenticated reads and rejected unauthenticated requests, plus the
   relevant changed integration. Record Node SHA, source version and three HTTP
   timings. A merge or healthy Node alone does not complete the release.

A branch advance invalidates the original dispatch target. Do not replace the
approved SHA with a newer unreviewed one. Recheck ownership and approval scope.
If dispatch is omitted, source remains at its previous version; keep the release
open until both phases and acceptance are complete. Serialize releases across
both runtimes. The workflow's concurrency lock serializes source jobs, but does
not lock Railway against another merge. See `CHANGELOG-source-deploy-gate.md`
for validation, first-release acceptance and rollback.

### Existing credentials (initial setup or authorized refresh only)

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value |
| --- | --- |
| `CLASPRC_JSON` | `npm i -g @google/clasp@3.3.0` → `clasp login` → full contents of `~/.clasprc.json` |
| `DEPLOYMENT_ID` | the `AKfyc…` segment of the live `/exec` URL (Manage deployments → the active Web App), no quotes/space |

> **Version alignment:** CI uses clasp **3.3.0**; log in with a 3.x clasp so the
> `~/.clasprc.json` format matches. Refresh: re-run `clasp login`, re-copy into
> `CLASPRC_JSON`.

### ⚠️ Confirm the manifest before the first deploy

`clasp push -f` overwrites the project's `appsscript.json` with the committed one
(`webapp.access: ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING`, V8,
Asia/Jerusalem). These are the standard ecosystem Web App settings the consumers
require, so they should already match live. If the live project differs, run
`clasp pull` locally and commit the real manifest first — flipping access off
"Anyone" breaks every consumer.

## Security

- Credentials live **only** in GitHub Secrets — never committed, never printed;
  the runner's `~/.clasprc.json` is deleted at job end (`if: always()`).
- `.clasprc.json` / `.clasp.local.json` are git-ignored. The Script ID in
  `.clasp.json` is an identifier, not a secret.

## Manual fallback

> **Emergency use only.** Routine releases use the explicit GitHub Actions
> phase above, including its version/readiness checks. Local `clasp` bypasses
> those checks and needs a separately approved recovery plan when Actions is
> unavailable. Never copy/paste source into the editor or create a new deployment.
> The older ecosystem snapshot describes the previous automatic push path;
> this Outpatient-specific procedure supersedes that historical description.

```bash
npm i -g @google/clasp@3.3.0 && clasp login
clasp push -f
clasp deploy -i <DEPLOYMENT_ID> -d "manual deploy"
```

## Sheet columns appended by recent changes (no migration needed)

`_ensureSheet` rewrites the header row and every reader maps by **position**, so
appended columns appear on the next Apps Script deploy and existing rows simply
carry blank cells.

| Sheet | Appended | Notes |
| --- | --- | --- |
| `Payments` | `coverageStart`, `coverageEnd` | תקופת כיסוי (`CHANGELOG-payment-coverage-period.md`). Plain `'YYYY-MM-DD'` **text** — `_ensurePaymentsSheet` forces the `@` format on both columns, and `_upsertPayment` forces the target row's two cells before writing, so a date-typed cell can never drift −1 day and move revenue between months. **Blank is legal and is not backfilled**: a blank pair reads as the previously inferred cycle. |

**Nothing is migrated and nothing is rewritten.** If the Apps Script deploy has
not run yet, the client simply posts two fields the sheet does not have — the
row still upserts, and the period continues to be inferred, exactly as before.
