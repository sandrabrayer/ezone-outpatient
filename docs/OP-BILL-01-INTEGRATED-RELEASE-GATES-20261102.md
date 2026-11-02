# OP-BILL-01 — Integrated release gates (2026-11-02)

**Status: HOLD. Docs-only release planning. No authorization to merge, deploy, read live payments, repair historic data or run Apps Script jobs.**

## Evidence and separation

- Diagnostic draft: #153; card display and ambiguity detection: #154; source billing policy: #155 (head `dbbe66658d42c512220648a602c4d54ed1ad5686`).
- #155's Test workflow run 41326111937 succeeded on that *isolated draft head*. This is not a result for a combined CRM/OP-03 tree.
- OP-03 #139 and source witness #140 remain drafts, and a credentialed production source witness / successful recoverability proof has not been established here.
- CRM chain #142–148 remains draft. Reuse the existing money authorization layer; do not build another finance/task ledger.

## Blocking gates in order

1. **Source and restore proof:** reconcile deployed Apps Script HEAD against versioned source; prove current-source OP-03 backup manifest, completeness/integrity and a safe isolated restore dry run. Account for financial journals and CRM Tasks/Activity if included in the release. Do not run production restore or activate automation.
2. **Integration candidate:** create one new isolated combined candidate from a verified deployed base. Integrate OP-03, CRM #142–148, and billing #153→#154→#155 in a carefully reviewed order, resolving overlaps in `public/app.js`, `apps-script/Code.gs`, tests and service-worker cache. Track commit SHAs and exact combined tree. No direct changes to existing draft branches. Any PR sequence is contingent on conflict and schema review.
3. **Financial correctness:** run source-level and real-browser tests against the exact combined tree for monthly paid-date coverage, day-clamp/leap cases, inclusive `שולם עד`, next collection, historic explicit multi-cycle advances, partial/unpaid, arrears, overdue reminders, preserved income/credit/refund calculations, duplicate submissions and immutable OP-02 journal replay.
4. **Access control:** verify Vered's authorized money views and writes, Dana's money-free GET/POST/cache/export behavior, and unauthorized direct requests that must fail closed; test both UI and backend on the combined tree.
5. **History reconciliation (read-only, separate authorization):** inspect only exact-ID payment and coverage rows through a controlled read-only preview. Present redacted counts of confirmed/ambiguous/duplicate/gap/advance cases, plus `nextBillingDate` differences. NEVER infer all historic rows were single monthly payments; NEVER auto-rewrite history. Any repair is separate, explicitly approved and auditable.
6. **Release and recovery plan:** identify tested Node+Apps Script versions, source snapshot/hash, deploy order, smoke checks, service-worker version/cache bump, operational pause/rollback or forward-fix strategy (preserving already committed journal operations), owner and outage window. Require **new explicit Sandra approval** before any merge, deploy, source/permission/config change or data repair.

## Done criteria

- Exact integrated source tree and CI/browser links recorded, zero blocking failures.
- Recovery evidence is real and current, not just synthetic tests.
- Production money permissions and historical ambiguity independently reviewed.
- All versions and rollout/forward-fix steps documented.
- Explicit release approval captured separately.

**Documentation consistency:** #155's `docs/OP-BILL-01-SOURCE-WRITE-IMPLEMENTATION.md` still says it is *not evidence the write-side correction has been implemented*. Interpret that as stale documentation: code is implemented in a **draft** on #155, not deployed, and the statement must be corrected in the integrated candidate before release.
