# OP-02b2-a — recoverable renewal (candidate)

Base refreshed after PR #119 merged: `6bdac37f3d788a2d48df680da2ce25746f17b824`,
Node/SW v10 verified. Last independently verified source is @96; recheck #119
source release evidence before the next release. Codex is the only implementation owner. This
candidate covers **renewal with optional package-frequency change only**.
It does not release itself or complete OP-02b2 for all financial flows.

## Contract and interruption behavior

The editor opens a fresh source snapshot and original billing cycle through
POST `getRenewalState`. `reserveRenewal` compares the complete source row,
including legacy rows with empty timestamps, validates dates/amount/identity,
and stores immutable intent and expected before/after values in `FinancialOps`
before any client/payment effect. Same id with different content refuses.
Existing current or legacy base-payment ids refuse; partial payments are never
upserted into full payments. Payment date and optional package-change date may
be backdated, but the next billing date follows the original cycle.

| State | Meaning / permitted next step |
| --- | --- |
| `prepared` | No effects started; verify exact preimage and no payment, then apply or cancel |
| `client_writing` | Client effect may have happened; exact postimage permits continuation, anything else requires review |
| `client_done` | Exact client postimage and no matching payment permit create-only payment |
| `payment_writing` | Payment may have happened; exact one-row payment and client postimage prove completion; missing/changed rows require review |
| `done` | Both effects verified; remains reserved until an editor acknowledges the original cycle |
| `review` | Ambiguous/divergent data; automatic continuation disabled |
| `acknowledged`, `cancelled`, `reviewed` | Terminal; replay never applies effects, even after later legitimate changes/deletion |

Every transition and cooperating writer uses the same script lock. This is
reconciliation, **not a crash-atomic transaction across Sheets writes**. A lost
response is rediscovered from the source on reopen/reload/another device.
A write marker with an absent effect is ambiguous: do not recreate a client or
payment that an operator may have deleted. Before final acknowledgement or
cancellation, recheck the source; divergence becomes discoverable review.

`FINANCIAL_OPS_CREATED` is internal metadata set by the handler before the first
intent. No manual configuration is needed. Once set, a missing journal fails
closed. Wrong headers, duplicate ids/active clients, invalid states or mismatched
intent/preimage/postimage also fail closed. Snapshots retain their ordered column names; later append-only client columns
are preserved when an older intent resumes. Reordered/removed columns refuse.
Keep terminal journal rows; there is no automatic pruning/migration. Manual sheet editors do not take application
locks; diverging edits require review and are not overwritten by replay.

## Interference and permissions

All six new routes are POST-only and require `OUTPATIENT_PROXY_SECRET` through
the existing editor session gate; Node supplies the signed user. Other app
credentials do not authorize them. No new secret, user, role or access grant.

- `saveAll` preserves each pending client's stored row, reporting attempted
  changes as a client conflict while allowing unrelated rows to save. Explicit
  deletion, restore and merge cannot remove/recreate a reserved client.
- Payment/charge create/update/delete, single or bulk, check both requested and
  stored ownership. Legacy payment ids participate in the guard.
- Full Clients/Payments/ClientCharges rewrites, billing-date/amount/credit cells,
  clinical changes, deactivation and the manual corruption-repair helper are
  guarded inside the writer lock. A failure during an unrelated full rewrite
  can still leave ambiguous source state; reconciliation stops for review.
- Independent leads/settings/alerts and the separate Credits refund ledger do
  not mutate the renewal's client/payment/charge rows and retain their routes.
  SessionLog writes without a client-credit effect may continue. A session
  outcome that changes the client's credits fails before that effect/log row;
  consumer retry/delivery behavior still needs OP-06 verification.

Review closure requires an authenticated named editor, explicit acceptance,
a reason (10–1000 characters), and an exact fresh source observation. It records
the reason, observation, user and timestamp as `reviewed`; it **does not repair
financial data or claim payment success**. The editor must verify actual billing
and document remaining corrections. Existing billing tools can then correct the
record. This is not an automatic refund, rollback, or missing-payment generator.

## Backups and isolated restore

The existing nightly job now captures eight datasets under the script lock:
Clients, Leads, both removal archives, Payments, ClientCharges, Credits and
FinancialOps. It then releases the lock and writes values-only, type-checked
snapshots to the existing backup workbook. A ninth, SHA-256 manifest is published
last. `_integrityValidateRestoreSet` is read-only: all eight named families and
typed hashes must match before an isolated drill may use the set. Missing,
mixed-generation or tampered snapshots refuse. Never restore one financial
sheet separately. Preserve `FINANCIAL_OPS_CREATED` with any journal restore.

Synthetic isolated restore tests execute the real capture/manifest/preflight,
restore a pending journal with its financial rows into a new in-memory workbook,
and resume the original operation without another payment or cycle. They do not
prove the real production trigger ran or that a real Google workbook was restored.
OP-03 still owns that live operational evidence. No manual job/trigger/mail was
run in this work. Existing 30-day retention is extended only to the exact new
families; unrelated and recovery/staging tabs remain untouched. Capacity grows
from four to eight datasets plus a small manifest per day; measure runtime,
cell/storage use and retention in OP-03/OP-04. No new paid service is provisioned.

## Release and rollback

1. Recheck the production base and other open PRs. #119 merged during this
   work and its planned-exit field was retained by rebasing and resolving the
   saveAll guard ordering. Candidate cache is v11 above verified live v10.
   Require exact-candidate full tests, browser acceptance, audit and independent
   review, then Sandra's separate production approval. Preserve other drafts.
2. Merge to `claude/youthful-volta-laarnk`; verify exact Node SHA and `/healthz`.
   New UI fails closed if the old source lacks the renewal protocol; there is
   no fallback to the old two-step renewal. Other routes remain available.
3. Dispatch the existing `Deploy Apps Script` workflow for the approved full
   merge SHA, only after matching Node is live. Keep the existing deployment id,
   workbook and secrets. Verify workflow/version and denied dummy requests;
   use read-only existing-session checks, never synthetic live patient payments.
4. Verify served SW v11, app assets, three homepage request timings, and refresh
   existing installed apps/tabs. An already-open v9/v10 tab still has its old code:
   source guards protect any pending journal, but this candidate does not convert
   every legacy/other financial flow into a durable operation.

Rollback must preserve the deployed journal-aware source while any active intent
exists; reverting to @96 would remove its guards. Do not delete FinancialOps or
clear its marker. Pause affected renewals and use a forward fix, or explicitly
review/resolve active intents first. Reverting frontend behavior also needs a
cache version strictly above the then-live version. Never replay or restore
production financial rows as a code rollback.

## Remaining program work

Durable identities/recovery for extra charges, intake, activation, edit-modal
payment propagation and monthly/toggle flows remain OP-02b2. Production backup
execution and real isolated restore remain OP-03. Measured performance remains
OP-04; bank/document evidence and wider controls remain OP-05. OP-06 still needs
legacy/cross-app usage and delivery checks. No other app audit is closed here.
