# OP-03 Task 2 — OUT backups and recovery: release readiness (23 Nov 2026)

Issue #124 · draft PR #199 · integration partner OUT #195 (not modified here).
Status: **code-complete and test-green; production release NOT GO** — see §6.

Read-only throughout: no merge, deployment, trigger, Script Property, production
backup, restore, patient/financial cell read or permission change was performed.
Native Gate 0 (23 Nov) was **not** re-run: its five phases remain the reference
evidence ([PR #199 comment 7111339606](https://github.com/sandrabrayer/ezone-outpatient/pull/199#issuecomment-7111339606)).

## 24 Nov 2026 addendum — combined candidate and combined Gate 0 harness

- **Combined candidate (exact, prepared, NOT yet on GitHub):** two-parent merge of
  #195 `d4a4f4638091a78b41af13ac5eec344696f8ada3` with #199 `e5c638c941ea569882b8b2a8c032b5875349d7b0`
  → commit `eb510e9d56e14eba2bd9d93f836b32923e6d403b`, tree `03bcc48aefac1990604eae6bd0ab18fb541bc803`,
  `apps-script/Code.gs` blob `c58440b82bfbe1e80a31a9f3ba4b8b581bb4907c`. Fast-forward of #195 (no
  force). Conflicts only `CHANGELOG.md` (both kept, newest first) and the generated
  `google-operational-drill-candidate.gs` (regenerated). #195 product/receiver code unchanged.
  Local: **2,631 tests · 2,630 pass · 0 fail · 1 skip**, three consecutive full runs (one earlier
  run had a single Chromium flake in the unrelated `patient-type tabs desktop 1280px` test;
  it passed in all three re-runs). `npm audit` 0. The push to #195 was **blocked by the
  session permission policy** and needs Sandra's explicit go-ahead.
- **Combined native Gate 0 harness (#199 `2e179cc`):** on a source with `SessionOutcomeOps`
  the fixture holds one committed **and one pending** group intent; Phase B must certify both
  states; the restore resumes the pending intent ONCE on the isolated synthetic target with the
  real `_soResumeOp`, a repeat retry is a no-op, credit stays 1. On #199 alone the old checks run.
- **One click:** `runTwoStageDrillAuto` runs prepare → 18 expand batches → capture → verify →
  restore, one phase per execution via a one-shot trigger **in the isolated project only**
  (needs the extra `script.scriptapp` consent there), stops on the first failure, 40-step budget.
- **Production read-only (24 Nov):** `EZONE-Backups` written again 2026-11-24 00:28:38Z (02:28
  Israel), 2,898,002 → 3,058,218 bytes, still owner-only/PRIVATE; Railway `b7de864`, SW v43,
  `/healthz` 200 ×3 (0.52 / 0.47 / 0.20 s). Write activity ≠ proof of a completed, checksum-valid run.
- **Not possible from this session:** creating the Apps Script sandbox (Drive connector cannot
  create script projects), executing Apps Script functions, reading production Executions,
  triggers or Script Properties.

Evidence levels used below — never mixed:

| Level | Meaning |
| --- | --- |
| **S** structural | names / counts / formats / metadata observed; no value comparison |
| **C** checksum | every snapshot re-read and its typed SHA-256 recomputed against the manifest (`_integrityValidateRestoreSet`) |
| **R** restore | data copied to an isolated target and verified, incl. operational cutover gate |
| **U** unit (synthetic) | real `Code.gs` executed under in-memory Google service doubles (`node --test`) |
| **N** native (synthetic) | real Apps Script execution in the isolated sandbox project |

## 1. Task (a) — manual tabs `Sheet1` / `Copy of Clients`

### Existing mechanism (analysed, kept)
- Capture: unknown tabs are captured as opaque `other-<sha>` snapshots, listed in
  `unclassifiedSources`, hashed, never schema-validated, never merged into Clients.
- Retention: only names matching `INTEGRITY_DATA_SNAPSHOT_RE` and older than the
  retention window are deleted; manual tabs in the backup are never touched.
- Inventory: once seen, a manual tab joins `INTEGRITY_REQUIRED_SOURCES`; deleting it
  from the live workbook blocks the next backup (no silent ageing-out of history).
- Cutover: `finishOutpatientRecovery` refuses any set with unclassified tabs unless
  a **reviewed, code-pinned** policy (`INTEGRITY_APPROVED_MANUAL_POLICY_SHA256`)
  binds source, backup, day, target, manifest, metadata, each tab's grid hash,
  dimensions, role and operator evidence. Shipped pin: **blank** (refuse).

### Policy (decision record)
1. **Preserve, never reclassify.** Both tabs are restored verbatim as values into
   the isolated target, under their own names; roles are `structural-empty`
   (`Sheet1`, enforced: every cell empty) or `retained-archive` (`Copy of Clients`).
2. **No merge / no overwrite.** An archive row is never written into Clients; the
   active Clients row is never "refreshed" from or into the archive. Any target
   cell drift, formula, re-ordering, dropped/renamed tab or extra tab is refused.
3. **No exclusion to get green.** Missing tab ⇒ refusal. Policy for a set without
   unknown tabs ⇒ refusal. The production pin stays blank until a real recovery.
4. **Per-recovery approval.** A pin is valid for exactly one (source, backup, day,
   target). It is produced from a certified set, reviewed, committed, then removed.

### New in this round
- **v3 path verified** (`test/op03-v3-manual-policy.test.js`, U, 10 tests): the policy
  works on a **certified** two-stage set, is refused without/with a forged
  certificate, refused while a run is pending, refused on archive overwrite/drop.
- **`draftOutpatientManualPolicy(backupId, day)`** — editor-only, read-only. Computes
  only what code can prove (IDs, manifest/metadata/tab hashes, dimensions) from a
  certified set; evidence, roles and sheet IDs stay `null`, so an unreviewed draft
  can never pass — even if its digest is pinned (tested).

## 2. Task (b) — integration with OUT #195 (`SessionOutcomeOps`)

**Integrated tree (exact):** local merge of #195 head `d4a4f4638091a78b41af13ac5eec344696f8ada3`
with #199 code head `abcab1bc4da587615f58aaff257492b9d925841e` + regenerated drill artifact.
Tree `0632c17d5a219f7d8bc7e33d4db3c8709bd90b0d`, `apps-script/Code.gs` blob
`c58440b82bfbe1e80a31a9f3ba4b8b581bb4907c`. Code.gs merges with no conflict; conflicts
are only the **generated** `test-support/google-operational-drill-candidate.gs`
(regenerate) and `CHANGELOG.md` (keep both entries). Result: **2,625 tests, 2,624 pass,
0 fail, 1 skip** (the #199-only no-op check, skipped by design); `npm audit` 0.
#195 itself was not changed.

Already covered in #195 (`49db6f2`, `2c33b4f`): committed group journal round-trip
(v2 and v3), tamper refusal, retry after restore without double credit.

New (`test/op03-group-journal-integration.test.js`, U, 10 tests; skip on #199-only).
#199 alone: **2,563 tests, 2,554 pass, 0 fail, 9 skip** (these integration checks).

| Requirement | Result on integrated tree |
| --- | --- |
| PENDING group intent captured exactly by A/B (not dropped/committed) | pass |
| Cutover refused while a restored group intent is pending (`session_credit_recovery_pending`) | pass |
| Sender retry after restore resumes ONCE — credit 1, one log row, op committed | pass |
| Committed journal: cutover succeeds, `SESSION_OUTCOME_OPS_CREATED` restored | pass |
| Target missing the journal ⇒ refused | pass |
| Journal created but tab gone ⇒ Phase A refuses, nothing staged | pass |
| Journal snapshot tampered between A and B ⇒ no certificate | pass |
| Native Gate 0 fixture carries ONE committed group row on combined source; deterministic; shared historical fixture untouched | pass |

`FinancialOps` (renewal + extra charge) and `SessionLog`/credit balances are covered
by the existing suites on both trees (validator `_finJournal` runs at cutover).

**Integration requirements for the #195 owner** (coordination, not done here):
1. Merge the final #199 head into #195; regenerate `google-operational-drill-candidate.gs`
   (`npm test` pretest does it). Expect the counts above.
2. Combined manifest will hold **26** entries (23 known + `Sheet1` + `Copy of Clients`
   + metadata) vs 25 today; draft/pin a manual policy only against a combined set.
3. Release order: OUT receiver before THR sender; drain THR retries before any
   recovery; a pending group intent blocks cutover by design — resolve by sender
   retry, never by editing the journal.
4. One **native Gate 0 on the combined candidate** (it now seeds the group journal).

## 3. Task (c) — the real 23 Nov 2026 OUT backup (read-only)

| Check | Level | Result |
| --- | --- | --- |
| Destination file | S | Exactly one Drive file titled `EZONE-Backups` (Google Sheets), owner-only (single `owner` permission), visibility PRIVATE, last modified 2026-11-23 00:29:04Z (02:29 Israel) — consistent with the 02:00 legacy trigger window |
| Destination binding | — | **Unproven**: the script's `INTEGRITY_BACKUP_SSID` property was not read (needs Apps Script access) |
| Manifest structure | S | `outpatient-manifest-2026-11-23`, 25 entries, 25/25 referenced tabs exist, 64-hex fingerprints, `OneTimeSessions` absent (observed 23 Nov, [comment 7092214657](https://github.com/sandrabrayer/ezone-outpatient/pull/199#issuecomment-7092214657)) |
| Version match | S | Live Apps Script = deploy run #56 at `62da2e2`; its `Code.gs` blob `9c2f243…` equals production branch `b7de864`. That source registers **22** known sources ⇒ 22 + 2 manual + metadata = **25** = manifest. Railway `/api/version` = `b7de864`, SW v43. Schema expected **v2** (legacy; two-stage not active), so **no `verified-` tab is expected** |
| Checksums | C | **Not done.** Requires executing `_integrityValidateRestoreSet` in Apps Script (reads all patient snapshots); Drive export cannot reproduce typed SHA-256 |
| Restore | R | **Not done**; production restore not authorised |
| Triggers / markers | — | **Not readable** from here (Apps Script Executions / Script Properties) |

Isolated controlled restore plan (needs Sandra's separate approval): see §5 step 2.

## 4. Task (d) — release audit of the two-stage mechanism

| Control | Status | Evidence |
| --- | --- | --- |
| Overlapping runs | ScriptLock admission + `INTEGRITY_ACTIVE_BACKUP`/`INTEGRITY_PENDING_BACKUP`; nightly refuses while pending, finalizer while active; same-day duplicate refused | U `op03-two-stage-backup` |
| Interrupted run | Pending marker recorded before first write; never auto-cleared. **New:** `abandonPendingIntegrityBackup(runId, reason)` — exact run ID; refuses while an execution may be alive (ACTIVE of another run, or of this run < 30 min) and on a certified day; clears a hard-killed run's own stale ACTIVE (> 30 min); deletes no sheet, advances no sentinel, records `INTEGRITY_LAST_ABANDONED_BACKUP`, alerts | U `op03-two-stage-ops` (8) |
| No deletion of good backups | Retention only after certification; strict name regex; manual/foreign tabs and last sheet kept; abandoned sets never become recovery points | U + N (350 foreign tabs kept) |
| Restorability | v3 needs certificate + full re-read; manual policy; journals validated | U + N (15/15 tables restored) |
| Failure monitoring | Nightly alerts on busy/failed capture. **Fixed gap:** finalizer refusals (missing Phase A, stranded/invalid marker, lock, flag left after rollback) previously threw **without e-mail**; they now alert. Recovery hold stays silent | U `op03-two-stage-ops` |
| No approval of unverified backup | Certificate only after independent full read-back; v3 restore refuses missing/forged certificate | U + N |
| Rollback | Runbook §Rollback (updated: abandon tool for a stranded pending) | doc |

**Residual risks (accepted, documented):** e-mail alerting is best-effort (needs
`INTEGRITY_ALERT_EMAIL`); a deleted **nightly** trigger produces no capture and the
finalizer now alerts `no_pending_backup` — but if **both** triggers are deleted nothing
alerts (weekly public healthcheck cannot see backups). Native timing is for a scaled
synthetic fixture, not the production volume.

**Native evidence and this round's code delta:** Gate 0 ran on `Code.gs` blob
`792603c`. This round changes `Code.gs` (→ `0736b49` on #199): the finalizer's
admission-refusal path gains an alert call; two new editor-only functions are added.
`nightlyIntegrityJob` is unchanged and the finalizer's success path is unchanged, so
the measured A/B durations remain representative — but the release candidate is the
combined #195 source anyway, so **one** native Gate 0 on that candidate is required.

## 5. Release plan (each step needs Sandra's explicit approval)

0. Code review of #199 (+ #195 integration) at a frozen SHA; CI green.
1. **Native Gate 0 on the combined candidate** in a NEW empty sandbox project
   (prepare → expand ×18 → capture → verify → restore). Expect a nonempty
   `SessionOutcomeOps` in the certified set.
2. **Production read-only verification** (owner, Apps Script editor of the production
   project, no writes): Executions for 23 Nov (`nightlyIntegrityJob` Completed, duration);
   triggers (exactly one `nightlyIntegrityJob`, no finalizer); Script Property **names**
   (no `INTEGRITY_ACTIVE_BACKUP`/`INTEGRITY_PENDING_BACKUP`/`OUTPATIENT_RECOVERY_HOLD`,
   `INTEGRITY_BACKUP_SSID` value equals the `EZONE-Backups` file ID). Optional C-level
   check: run `_integrityValidateRestoreSet(SpreadsheetApp.openById(<backup>), '2026-11-23', !!PropertiesService.getScriptProperties().getProperty('FINANCIAL_OPS_CREATED'))`
   — read-only; returns or throws.
3. Merge → Railway `/api/version` = merge SHA → dispatch **Deploy Apps Script** with
   `expected_commit`. Legacy mode continues (dormant code).
4. `setupIntegrityTwoStage()` once (separate approval). Next morning: pending,
   final manifest and `verified-` tabs; no alert e-mail.
5. Isolated restore drill of a **real** certified set into a NEW owner-only target
   (separate approval; patient data stays in Google; manual policy reviewed then).

**Rollback:** before step 4 — redeploy previous Apps Script version on the existing
deployment; after step 4 — delete the finalizer trigger and `INTEGRITY_TWO_STAGE_ENABLED`
(legacy resumes); stranded pending — retry finalizer once, then (owner decision)
`abandonPendingIntegrityBackup(<runId>, '<reason>')`. Never clear markers by hand.

## 6. Go / No-Go

**Ready for Release (code): yes** — tests, docs, integration requirements complete.
**Production release: NO-GO** until §5 steps 0–2 are done and approved. Blocking:
native Gate 0 on the combined candidate; production executions/triggers/properties
check; Sandra's approvals for merge, Apps Script deploy and `setupIntegrityTwoStage()`.
