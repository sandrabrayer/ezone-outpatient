# Deploy — E-ZONE Outpatient

Two independent deploy paths:

| Layer | Runs it | Trigger |
| --- | --- | --- |
| **Node/Express + frontend** | Railway | Auto-deploys the connected branch (`claude/youthful-volta-laarnk`, per `EZONE-ECOSYSTEM-STATUS.md`). |
| **Apps Script backend** (`apps-script/**`) | GitHub Actions → clasp | Push to `claude/youthful-volta-laarnk` touching `apps-script/**` (below). |

## Automatic Apps Script deployment (clasp in CI)

**Workflow:** [`.github/workflows/deploy-apps-script.yml`](.github/workflows/deploy-apps-script.yml)

On every push to **`claude/youthful-volta-laarnk`** that changes `apps-script/**`
(or `.clasp.json` / the workflow), CI installs `@google/clasp@3.3.0`, writes
`~/.clasprc.json` from the `CLASPRC_JSON` secret, runs `clasp push -f`, then
`clasp deploy -i <DEPLOYMENT_ID>` — a **new version of the EXISTING deployment**,
so the `/exec` URL never changes and the outpatient/therapists/dashboard
consumers keep working. It **fails loudly and early** if a secret is missing or
`CLASPRC_JSON` isn't valid JSON, and requires clasp's `Deployed …@<version>`
confirmation (clasp 3.x can reject an id and still exit 0).

### ⚠️ After this merges, CI fails until you add two secrets

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

> ⛔ **Emergency use only — not the routine path.** As of the July 2026 clasp CI rollout (verified 22/07/2026, ecosystem-wide), Apps Script deploys are **automatic** on every merge to the deployed branch. Reach for this manual `clasp` fallback only when CI itself is down. The old **copy-paste-into-the-Apps-Script-editor** procedure is **OBSOLETE** — do not hand-paste `Code.gs`. See `EZONE-ECOSYSTEM-STATUS.md` → "Apps Script deployment".

```bash
npm i -g @google/clasp@3.3.0 && clasp login
clasp push -f
clasp deploy -i <DEPLOYMENT_ID> -d "manual deploy"
```
