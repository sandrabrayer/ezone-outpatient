# Deploying the Outpatient Apps Script (automated via clasp + GitHub Actions)

The Node/Express app runs on Railway (branch **`claude/youthful-volta-laarnk`** —
verify in the Railway dashboard, it is not stored in the repo). The Google
**Apps Script** backend, however, has historically been deployed *by hand*:
paste `Code.gs` → Save → Deploy → new version of the existing deployment. That
manual step is the source of the worst recurring outages (new deployment mints a
fresh `/exec` URL, or access gets flipped off "Anyone" → consumers get Google's
HTML login page). This workflow automates it correctly.

## What happens automatically

On every push to **`claude/youthful-volta-laarnk`** that touches
`apps-script/**` (or `.clasp.json`, or the workflow itself), the
[`Deploy Apps Script`](.github/workflows/deploy-apps-script.yml) workflow:

1. `clasp push -f` — uploads `apps-script/Code.gs` + `apps-script/appsscript.json`
   to the Apps Script project (Script ID lives in `.clasp.json`).
2. `clasp deploy -i <DEPLOYMENT_ID>` — publishes a **new version of the existing
   deployment**. Because it targets the deployment *by ID*, the `/exec` URL is
   **preserved**. This is never a "New deployment".

> ⚠️ Apps Script never auto-syncs from GitHub on its own — this workflow is the
> bridge. If you edit the script directly in the Apps Script editor, commit the
> same change back to `apps-script/Code.gs` or the next CI deploy will overwrite
> it.

## One-time setup (required before the workflow can succeed)

After the PR that adds this workflow merges, **the workflow will fail until you
add the two secrets below.** That failure is expected and harmless — no partial
deploy happens (the workflow checks the secrets before doing anything).

### 1. `CLASPRC_JSON` — the OAuth token

On your own machine (one time):

```bash
npm install -g @google/clasp@2.4.2
clasp login          # opens a browser; log in with the Google account that owns the Script
cat ~/.clasprc.json  # <-- copy the ENTIRE output
```

Then in GitHub: **Repo → Settings → Secrets and variables → Actions → New
repository secret**

- **Name:** `CLASPRC_JSON`
- **Value:** paste the full contents of `~/.clasprc.json` (the whole JSON object,
  including `token` and `oauth2ClientSettings`).

> The account you `clasp login` with must have **edit** access to the Apps Script
> project and be able to manage its deployments.

### 2. `DEPLOYMENT_ID` — the existing deployment to re-version

1. Open the Apps Script editor for the Outpatient project.
2. **Deploy → Manage deployments.**
3. Find the **active web-app deployment** (the one whose `/exec` URL ends in
   `…FOwWYIw` — the single deployment every consumer shares:
   outpatient `SHEETS_URL`, therapists `OUTPATIENT_SHEETS_URL`, dashboard
   `OUTPATIENT_LEAD_URL`).
4. Copy its **Deployment ID** (the long `AKfycb…` string shown next to the
   deployment, *not* the `/exec` URL).

Add it as a GitHub secret:

- **Name:** `DEPLOYMENT_ID`
- **Value:** the copied deployment ID.

> `DEPLOYMENT_ID` is not secret in the cryptographic sense (it appears in the
> public `/exec` URL), but storing it as a secret keeps the workflow's
> fail-loud check uniform. A repo **variable** would also work; if you prefer
> that, change `secrets.DEPLOYMENT_ID` to `vars.DEPLOYMENT_ID` in the workflow.

## Token refresh (when deploys start failing with auth errors)

clasp's OAuth token can expire or be revoked. When the workflow fails at the
`clasp push`/`clasp deploy` step with an authentication error, refresh it:

```bash
clasp login          # re-authenticate locally
cat ~/.clasprc.json  # copy the new contents
```

Then **update the `CLASPRC_JSON` secret** in GitHub with the new value. No code
change or new PR is needed — the next push (or a manual **Run workflow** from the
Actions tab) picks it up.

## Security notes

- Credentials live **only** in GitHub Secrets (`CLASPRC_JSON`, `DEPLOYMENT_ID`).
  Nothing sensitive is committed.
- `.clasprc.json` is **git-ignored** — never commit it. `.clasp.json` (Script ID
  + `rootDir` only, no secrets) **is** committed on purpose.
- The workflow requests `permissions: contents: read` only.
- The secret-presence preflight step fails the run with a clear message before
  clasp touches anything, so a missing/blank secret can never cause a partial
  deploy.

## Verifying the manifest (`apps-script/appsscript.json`)

`clasp push` uploads `appsscript.json` too, so its `webapp` block becomes the
deployed configuration. It is set to match production:

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
```

`ANYONE_ANONYMOUS` = "Anyone" (no Google login) — required so `server.js` and the
other consumers can fetch JSON without auth. **Before the first automated deploy**,
confirm this matches the live project (Apps Script editor → Deploy → Manage
deployments shows the current access). If it differs, run `clasp pull` locally to
fetch the exact live `appsscript.json`, commit it, and let CI use that — otherwise
the first redeploy could flip access/timezone and break every consumer.

## Manual fallback (unchanged)

If CI is unavailable, the old manual path still works: Apps Script editor →
**Deploy → Manage deployments → ✏️ (pencil) on the EXISTING deployment →
Version: New version → Deploy.** Never pick "New deployment".
