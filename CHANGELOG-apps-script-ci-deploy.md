# CHANGELOG — Automated Apps Script deploy (clasp in CI)

Infra change — automates the previously-manual "paste Code.gs → redeploy" step.
No runtime behavior of the app changes; this is about *how* the Apps Script
backend reaches Google.

## Context
Apps Script never auto-syncs from GitHub. Every backend change required a human
to open the editor, paste `Code.gs`, and manually publish a **new version of the
existing deployment**. The two failure modes that repeatedly broke production:
- picking **"New deployment"** → a fresh `/exec` URL → every consumer
  (`SHEETS_URL`, therapists `OUTPATIENT_SHEETS_URL`, dashboard
  `OUTPATIENT_LEAD_URL`) breaks;
- flipping access off **"Anyone"** → consumers receive Google's HTML login page
  → "Non-JSON from Apps Script".

This ships a GitHub Actions workflow that does the deploy the *correct* way,
every time, on merge.

## What was added
- **`.clasp.json`** (repo root) — `scriptId` +
  `rootDir: "apps-script"`. Committed (holds no secret).
- **`apps-script/appsscript.json`** — the manifest clasp needs, with the
  production web-app config: `executeAs: USER_DEPLOYING`,
  `access: ANYONE_ANONYMOUS` ("Anyone", no login), `timeZone: Asia/Jerusalem`,
  V8 runtime. Now pushed alongside `Code.gs`.
- **`.github/workflows/deploy-apps-script.yml`** — on push to
  `claude/youthful-volta-laarnk` touching `apps-script/**`:
  checkout → setup-node → install `@google/clasp@2.4.2` →
  write `~/.clasprc.json` from the `CLASPRC_JSON` secret →
  `clasp push -f` → `clasp deploy -i <DEPLOYMENT_ID>`.
  `-i` **re-versions the existing deployment**, so the `/exec` URL is preserved —
  never a new deployment. A preflight step **fails loudly** with an actionable
  message if `CLASPRC_JSON` or `DEPLOYMENT_ID` is missing or malformed, before
  clasp touches anything. `concurrency` prevents racing deploys;
  `workflow_dispatch` allows a manual redeploy.
- **`.github/workflows/validate-workflows.yml`** — CI check that parses every
  workflow YAML and asserts the required `on:`/`jobs:` keys, so a broken
  workflow file can't merge.
- **`.gitignore`** — ignores `.clasprc.json` (the OAuth token). `.clasp.json`
  stays tracked.
- **`DEPLOY.md`** — the automated flow + one-time setup (how to get
  `CLASPRC_JSON` via `clasp login`, how to find `DEPLOYMENT_ID` via Manage
  deployments, how to add both as GitHub Secrets) + token-refresh procedure.

## Branch note
The task described the trigger as "merge to `main`", but this repo has **no
`main` branch**. The canonical, Railway-deployed production branch is
`claude/youthful-volta-laarnk` (also the repo default), so the workflow triggers
on that branch. Confirmed with the requester before wiring it up.

## Required one-time setup (deploys fail until done)
After this merges, add two GitHub repository secrets (Settings → Secrets and
variables → Actions):
1. **`CLASPRC_JSON`** — full contents of your local `~/.clasprc.json` after
   `clasp login`.
2. **`DEPLOYMENT_ID`** — the existing deployment's ID (Apps Script editor →
   Deploy → Manage deployments → copy the ID of the `…FOwWYIw` deployment).

Until both exist, the workflow **fails on purpose** at the preflight step (no
partial deploy). See `DEPLOY.md` for full detail, including token refresh.

## Verify before first real deploy
`clasp push` overwrites the project manifest with `apps-script/appsscript.json`.
Confirm its `webapp` block matches the live deployment's access/timezone (or run
`clasp pull` locally once and commit the exact live manifest) — a mismatched
manifest could flip access on the redeploy and break consumers.
