# OUT #195 — combined release candidate: order of operations and rollback

22 Nov 2026. Candidate = finance / group settlement receiver (ex-#192) + deployed CRM (#193, #196) + public monitor (#197) + two-stage backup (#199). **Draft. Release requires Sandra's explicit, exact-SHA approval. Nothing below has been executed in production.**

## State of evidence (do not re-run on an unchanged head)

| Check | Result | Where |
|---|---|---|
| OUT Node + Chromium CI on the candidate | green (see PR checks for the exact head) | PR #195 |
| Two-stage backup A/B incl. nonempty GROUP journal, tamper, retry | 15/15 synthetic | `test/op03-two-stage-backup.test.js` |
| Group-credit journal typed backup → restore → replay (no double credit) | pass | `test/nightly-backup-data.test.js` |
| THR sender ↔ this receiver (signed HTTP 14 + Chromium 14) | green at the pinned OUT SHA | THR #171 `tests.yml` |
| Native isolated Google A/B timing + restore | **NOT RUN** — needs isolated script project + `CLASPRC_JSON` | `docs/OP03-TWO-STAGE-BACKUP-RUNBOOK-20261122.md` Gate 0 |
| Fresh certified production backup | **none since 17 Nov** | #124 |

## Release order (OUT receiver before THR sender)

0. **Prerequisites.** (a) Gate 0 native rehearsal passed and posted on #124. (b) A current, independently verified OUT backup exists (legacy job completed, or a certified v3 set from the isolated run plus owner decision). (c) THR #171 pins this exact OUT SHA and its paired CI is green. (d) Sandra's approval naming the SHA.
1. **Quiesce THR.** No THR deploy. Ask the coordinator to hold group approvals / over-quota requests for the window; the THR outbox worker keeps retrying only against a compatible receiver, so a short freeze is enough.
2. **Merge #195** (squash or merge, base `claude/youthful-volta-laarnk`). Railway auto-deploys. Poll `GET /api/version` every 30 s (max 10 min) until `commit` = merge SHA; check `/healthz`.
3. **Apps Script.** Dispatch `deploy-apps-script.yml` on the deployed branch with `expected_commit` = merge SHA. Wait for `Deployed …@<version>` on the EXISTING deployment. Script Properties needed (names only, existing): `SESSION_OUTCOME_SECRET`, `EXTRA_SESSION_SECRET`; new sheets `SessionOutcomeOps` (created on first group write) — no manual sheet work.
4. **Verify receiver from THR** (operator, editor-only helper on THR #171): `getTherapistsGroupContract` → `out-thr-group-v1`, `getTherapistsExtraContract` → `out-thr-extra-v1`; missing / wrong / cross-scope secret → `unauthorized`. No data returned.
5. **Browser.** Open OUT, confirm SW `ezone-outpatient-v45` (live was v43) and the CRM task/contact screens from #196 still behave.
6. **Backup stays legacy.** Do **not** run `setupIntegrityTwoStage()` in the same window. Activate it on a later day per the OP-03 runbook, after one legacy nightly job has completed on the new source (it now also captures `SessionOutcomeOps`).
7. **Release THR #171** only after 4 is green (its own runbook: SW v97, Apps Script redeploy on push, rollback base #172 `913b940b`).
8. One authorized paired UAT with identified test records: two participants reported and approved separately, one over-quota booking, lost-reply retry → single credit, single SessionLog row, same requestId.

## Rollback

- **Node only (Railway):** redeploy the previous Railway deployment (`b7de864f`, SW v43). The receiver Apps Script stays — it is backward-compatible with the old browser.
- **Apps Script:** redeploy the previous version on the existing deployment ID (never a new deployment). Before that: THR sender and retry worker must be quiescent and drained (an old receiver rejects `treatmentId`/`bookingRowId` writes; GET-then-POST is not atomic across versions). Keep `SessionOutcomeOps`, SessionLog and Credits untouched — never restore an older workbook over newer rows.
- **Partial group write found after rollback:** reconcile each `SessionOutcomeOps` row with state ≠ `committed` against SessionLog/Credits with the OUT owner before any THR retry; do not bulk-retry or clear the journal.
- **Backup:** no change on rollback while two-stage is not activated. If it was activated, follow the OP-03 runbook rollback (remove finalizer trigger + flag, never blind-clear a pending marker).

## Still open before go-live

1. Gate 0 isolated native run (needs a new standalone Apps Script project ID from the owner; `CLASPRC_JSON` already exists in GitHub Secrets for the deploy workflow).
2. A verified current production backup (#124).
3. Operator probe (step 4) and UAT (step 8) — only after deployment, so they cannot be done in advance.
4. Sandra's explicit merge approval for #195, then separately for THR #171.
