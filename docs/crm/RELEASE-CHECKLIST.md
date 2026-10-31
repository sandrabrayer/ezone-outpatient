# Outpatient CRM — integrated release checklist (program #141, 2026-10-31)

**Nothing below is authorized yet.** Every merge, Apps Script release and Railway deploy needs Sandra's separate approval (repo rule 4, `AGENTS.md`). This document orders the work so the approval can be given once, for a known sequence.

## 1. The release candidate
One stacked chain, merged in order into `claude/youthful-volta-laarnk` (each PR's base is the previous one, so merging the **last** PR after re-targeting it to the deployed branch brings the whole chain; or merge one by one):

| Order | PR | Phase | Code.gs change | Notes |
|---|---|---|---|---|
| 1 | #142 | A — server-side money scope | yes (`_saveAll` moneyScope) | foundation for every later phase |
| 2 | #143 | B — Tasks / Activity / contact history | yes (2 new sheets, 8 actions) | |
| 3 | #144 | C — «היום שלי» one task engine | no | |
| 4 | #145 | D — `getHandoffStatus` feed | yes (1 cross-app read) | needs `HANDOFF_STATUS_SECRET` |
| 5 | #146 | E — light theme (re-based #135) | no | SW v21 → **v22** |
| 6 | #147 | F — acceptance + this checklist (+ ops skips money reads) | no | |

Independent of the chain (ChatGPT-owned, separate approval): Outpatient #137 (identity columns, `createLead` link-or-create, owner carry) → #138 (pre-discharge continuation; requires Dashboard #329 live) ; OP-03 #139/#140 ; Dashboard #329 → #330 → D-FB-1 (consumer of `getHandoffStatus`).

Recommended overall order: **D-ID-1 (#329) → OP-03 (#139) → CRM chain (#142–#147) → #137 → #138 → #330 → D-FB-1.** The CRM chain and #137 touch different files except `Code.gs` (additive, different regions) — re-run CI after each merge.

## 2. Pre-merge gates (per PR)
- [ ] GitHub CI green on the exact head SHA (`test` + `lead-save-browser` + `yaml-valid`).
- [ ] `npm audit` 0 high/critical.
- [ ] Live SW version checked (`curl -s https://ezone-outpatient.up.railway.app/sw.js | grep -o 'ezone-outpatient-v[0-9]*'`) — must be **v21** before #146 (bumps to v22); if production moved, bump again in a follow-up commit.
- [ ] Sandra's explicit approval recorded on the PR.

## 3. Release steps (after approval)
1. Merge the chain (Node first): Railway auto-deploys. Poll `https://ezone-outpatient.up.railway.app/api/version` every 30 s (≤10 min) until `commit` = merge SHA; verify `/healthz`.
2. **Apps Script second phase** (Code.gs changed in A, B, D): dispatch `.github/workflows/deploy-apps-script.yml` on the deployed branch with `expected_commit` = that merge SHA; wait for green and the existing deployment's new version. Never paste `Code.gs`; never create a new deployment.
3. Script properties (Apps Script → Project settings → Script properties): add **`HANDOFF_STATUS_SECRET`** (≥32 random chars, distinct from every other secret). Give the same value to the Dashboard (D-FB-1). Until set, `getHandoffStatus` answers `unauthorized`.
4. Hard refresh; confirm `/sw.js` = v22; run the manual checks in `ACCEPTANCE-OUTPATIENT.md` §Manual.
5. Time 3 requests to the production URL; record status codes and times in the PR.

## 4. Data impact
- New sheets `Tasks`, `Activity` are auto-created on first use; no existing sheet gains or loses a column in this chain (append-only promise kept; the #137 columns are that PR's).
- Nightly backup (OP-03) should include the two new tabs — confirm in the first backup after release (ChatGPT, OP-03 scope).
- No migration, no rewrite of historical rows.

## 5. Rollback
- **Node/UI**: revert the merge commit(s) on the deployed branch (Railway redeploys). Service worker: a revert must bump the SW version again (v23), never go back to v21.
- **Apps Script**: redeploy the previous `expected_commit` via the same workflow (the existing deployment, new version). Data written to `Tasks`/`Activity` stays (harmless; append-only); `getHandoffStatus` disappears with the code, or can be disabled immediately by deleting `HANDOFF_STATUS_SECRET`.
- **Money scope**: reverting #142 restores the previous behaviour (דנה sees money again) — a business regression, not a data one.
- Nothing in the chain deletes or rewrites existing records, so a rollback has no data-loss step.

## 6. Acceptance tests to run after release
See `ACCEPTANCE-OUTPATIENT.md` (automated evidence per scenario + the 5 manual checks). Owner: Sandra (sign-ins per role), ChatGPT (backup inventory, Dashboard consumer).

## 7. Known limits / open items
- Exact `dashboardPatientId` linking and owner carry across the handoff live in #137/#138/#329/#330 (not in this chain). Until they are live, `getHandoffStatus` works by `outpatientIds` only.
- Dana-created clients start with blank billing fields for ורד to complete (by design).
- Task completion/reassign/withdraw use browser `prompt()` dialogs (simple, keyboard-friendly); a richer dialog is a later polish item.
- No automatic email/SMS, triggers or recurring jobs were added (needs separate approval).
