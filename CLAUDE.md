# CLAUDE.md — E-ZONE Outpatient

Operating rules for autonomous Claude Code work in this repo. These override
generic defaults; ask Sandra only when a rule below says to.

## Repo facts

| Fact | Value |
| --- | --- |
| Deployed branch (Railway + Apps Script) | `claude/youthful-volta-laarnk` — **every PR's base must be this branch**, never `main` |
| Production URL (Railway) | `https://ezone-outpatient.up.railway.app` (from `scripts/healthcheck.js` / `weekly-healthcheck.yml`) |
| Apps Script deploy | **Automatic on merge** — `.github/workflows/deploy-apps-script.yml` runs on `push` to the deployed branch touching `apps-script/**`, `.clasp.json` or the workflow; `workflow_dispatch` exists as a manual re-run only |
| Test command | `npm ci && npm test` (Node ≥ 18 built-in runner, `node --test`; CI: `.github/workflows/test.yml`, Node 22) |
| `GET /api/version` | Exists — public, `no-store`, returns `{ commit, builtAt }` (`commit` = `RAILWAY_GIT_COMMIT_SHA`, hex-validated, else `null`) |
| Service-worker cache | `public/sw.js` → `var CACHE = 'ezone-outpatient-vN'` |
| Ecosystem ground truth | `EZONE-ECOSYSTEM-STATUS.md` |

## Rules

1. **Language.** Talk to Sandra in Hebrew — concise, action-first. Hebrew UI
   text is RTL. Code, comments, commit messages: English.
2. **Every change** ships with:
   - tests added/updated, and the **full suite green** (`npm test`);
   - a CHANGELOG entry (`CHANGELOG.md` → `[Unreleased]`, plus a
     `CHANGELOG-<topic>.md` for anything non-trivial, matching existing files);
   - docs updated (`README.md`, `DEPLOY.md`, `docs/USER-GUIDE.he.md`,
     `EZONE-ECOSYSTEM-STATUS.md` as relevant);
   - security best practices: no secrets in code or logs, fail-closed auth,
     parameterized queries, input validation on every boundary, and
     `npm audit` with **0 high / 0 critical**.
3. **Git.**
   - Fresh branch off `claude/youthful-volta-laarnk`; one PR at a time.
   - `git add <explicit paths>` only — never `git add -A` / `.`.
   - Never force-push the deployed branch.
   - Check the PR's state before every push; **never push to a merged PR's
     branch** — restart from the deployed branch instead.
4. **Merging (Sandra's current project instruction, 2026-10-09).** Prepare a
   reviewable draft PR and obtain Sandra's explicit approval before merging or
   deploying. **All CI checks must also be green**; green CI alone does not
   authorize a release. Keep the running apps available while changes are
   developed separately. See `AGENTS.md` for the shared project agreement.
   After an approved merge:
   1. Apps Script deploy is **automatic on merge** here: if `apps-script/**`
      or `Code.gs` changed, find the "Deploy Apps Script" run for the merge
      commit and wait for it to be green. (Only if it did not trigger, run it
      via `workflow_dispatch` on the deployed branch.) Never paste `Code.gs`
      anywhere, never create a new Apps Script deployment.
   2. Poll `https://ezone-outpatient.up.railway.app/api/version` every 30 s
      (max 10 min) until `commit` equals the merge SHA. If it never matches,
      the Railway deploy was likely **SKIPPED** — report it.
   3. Time 3 requests to the production URL; report status codes and times.
5. **Data invariants.** Sheets headers (`*_HEADERS` in `apps-script/Code.gs`)
   are **append-only**. SW cache version bumps are **monotonic from the LIVE
   version** (check what production serves before bumping).
6. **Never** change Railway settings or variables, read Railway logs,
   subscribe to PRs, or schedule check-ins. If a Railway change is needed,
   give Sandra exact click-steps and values.
7. **Final report to Sandra:** PR link, merge SHA, test count, Apps Script
   deploy run (if any), `/api/version` result, timings, and **only** the
   manual steps left for her (with links). No step-by-step narration.
