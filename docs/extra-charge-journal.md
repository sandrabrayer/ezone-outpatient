# OP-02b2-b — recoverable additional-charge creation (candidate)

Base: released PR #120, `535dc659cae2807987f68002c20ac2ddb4fcc6c4`,
Node/SW v11 and Apps Script @97. Codex owns implementation; Claude reviews.
This candidate covers creation from **הוסף טיפול**, optionally with an initial
paid record. Renewal remains compatible. Intake, activation, edit-paid and
later monthly/payment toggles still require their own durable protocols.
No production approval, merge, deployment or real financial writes are implied.

## Protocol

All six actions are POST-only, through the existing authenticated editor proxy
and `OUTPATIENT_PROXY_SECRET`: `getExtraChargeState`, `reserveExtraCharge`,
`applyExtraCharge`, `acknowledgeExtraCharge`, `cancelExtraCharge`,
`resolveExtraChargeReview`. There is no legacy fallback when source is unavailable.
The source captures the complete client preimage, charge identity/content,
optional payment and original recording day in the existing FinancialOps journal
before effects. `intent.kind = extra_charge`, version 1. Renewal's existing
untagged intent remains readable. Endpoints reject operations of the other kind.
The shared one-active-operation-per-client guard prevents renewal/extra/legacy
writers from bypassing each other. Unrelated clients may still be edited.

| State | Evidence and permitted action |
| --- | --- |
| prepared | Exact original client, no charge or related payment; apply or cancel |
| charge_writing | Charge may have been written; require exactly one matching row |
| charge_done | Exact charge and no related payment; create optional original payment |
| payment_writing | Payment may have been written; exact client/charge/payment evidence required |
| done | Effects confirmed; editor acknowledges the original operation |
| review | Missing, duplicate or changed evidence; no automatic financial effects |
| acknowledged / cancelled / reviewed | Terminal; replay never recreates later-deleted rows |

Write markers precede create-only writes. A missing row after a write marker is
ambiguous, never permission to recreate it. Charge ids are checked globally;
related payment ids for any owner/month are observed. No existing partial payment
is upserted. Full client snapshots handle empty legacy timestamps; the client row
itself is never modified by this operation. Reopen/reload/another device discovers
the same operation. Double submit is disabled. Finish/cancel recheck source data.
Manual closure requires a named editor, reason and acceptance of an exact fresh
observation. It records an audit result only, not payment success or data repair.
The UI remains Hebrew/RTL and uses literal text for user-entered descriptions.

This is reconciliation under the shared script lock, not an atomic transaction
across Sheets writes. Manual spreadsheet writers can bypass the lock; divergence
requires review. Wrong/missing/corrupt journal data fails closed for guarded writers.
Active v1 intent uses a frozen versioned contract validator, separate from new-
reservation policy, so future policy changes do not invalidate pending history.
Keep v1 validation stable when introducing v2; unknown versions fail closed.
Terminal history keeps structural validation but skips future business-policy
revalidation. Keep the journal and its FINANCIAL_OPS_CREATED marker.

## Existing semantics retained and a persistence defect fixed

- One-time charge payment id ends `::once`; monthly ends in the **recording**
  month, not the charge start month. `dueDate`, `paymentDate` and charge `created`
  freeze the source-provided recording day. First reservation requires the current
  source day: an overnight stale modal must refresh the displayed day and the
  editor submits again. Once reserved, replay after midnight/month-end never
  recomputes it. Backdated/future charge dates remain accepted.
- Optional initial payment is `billingType: extra`, amountDue/amountPaid equal to
  the charge amount, status paid, bundleSize/sessionsUsed numeric zero. An unpaid
  creation has no payment intent/id/row.
- Actual old `paymentForSheet` calls `withDefaultCoverage` with billingType extra
  for **both** kinds, so both get a month from dueDate (clamped next month minus
  one day). Despite old comments saying one-off periods stay blank, that helper
  only recognizes billingType one_time. We preserve executed behavior and test
  it through the real browser; the source pins that exact derived period too,
  refusing arbitrary or blank coverage. Do not change recognition/credit rules.
- A future monthly charge paid now still records in the current month even if
  it precedes the first due period. These period/coverage inconsistencies are
  explicit OP-05 logic/control follow-ups, not silently fixed here.
- UI already sent/displayed treatmentType and frequencyPerWeek, but the source
  omitted them from ClientCharges headers. Append both columns (11 and 12),
  persist new intent, and preserve existing values when an older tab omits them
  during edit. Explicit blank still clears. No historic data is invented.
  This small persistence prerequisite is included so recovery retains what the
  user entered. Future append-only client/charge/payment columns are compatible
  with pending extra intent via stored header prefixes.

## Backup, compatibility and release

No new sheet or backup family: FinancialOps and ClientCharges are already among
PR120's eight datasets plus manifest. Synthetic mixed renewal/extra journal
restore tests resume charge_done/payment_written without duplicate effects.
This does not establish a real production trigger run or real Google restore;
that operational evidence remains OP-03. No job/mail was manually run here.

1. Require exact-candidate tests, real-browser acceptance, audit, Claude review
   and Sandra's separate production approval. Preserve other draft branches.
2. Merge to claude/youthful-volta-laarnk. Wait for exact healthy Node SHA, then
   explicitly dispatch the existing Apps Script workflow with that full SHA.
   No secret, setting, workbook or deployment-id change. During Node-first
   transition the new extra UI refuses the old source protocol safely.
3. Confirm source deployment, version, assets/SW v12, denied dummy requests and
   read-only signed access; time three requests. Refresh installed apps/old tabs.
   Do not create dummy patient/payment rows in production.

**After the first extra intent, source rollback to @97 is unsafe even when all
extra operations are terminal.** Its renewal-only journal parser rejects every
extra intent and blocks guarded writers. An executable local check against the
exact 535dc659 source confirmed this for prepared and acknowledged extra rows.
Do not delete history or clear the marker to make rollback pass. Use a forward
fix retaining both journal kinds and both appended charge columns. Earlier
source @96 has no journal guards and is also unsuitable. Any frontend rollback
must retain the durable protocol and use a cache version above then-live.
Code rollback never restores financial data. Old already-open tabs keep old
behavior until refreshed; source guards protect pending clients, not every
multi-step legacy flow in the absence of a reservation.

## Review and remaining program

### Parallel package work (#122)

Sandra assigned package catalog/pricing to Claude and extra-charge safety to
Codex on 2026-10-18. #122 is a separate draft, last observed at 821a82f54093d2a7aea4d9095f7b93980f899962;
its therapists integration and confidentiality fixes remain Claude's work.
Neither draft is release approval, and this branch includes no #122 code.

Both candidates are based on 535dc659 and currently propose SW v12. Serialize
releases; the second candidate must integrate the first approved merge and bump
above the then-live cache version. Reconcile shared Code.gs/app.js/index.html,
backup capture/restore manifest families, tests and documentation explicitly.
Cross-device acceptance here uses Shiran instead of retired Yarden so that the
new fixtures do not create an avoidable dependency on the old login picker.
This is preparation only: a combined-tree acceptance run is still required after
the merge order is chosen. Do not treat separately green CI as integration proof.

### Independent review

Claude design review: PR120 comment 6248656014, run 39118579758, base 535dc659.
It was static; the workflow ended in error after publishing, with no executed
tests. Its mixed-kind, rollback, collision and field-persistence findings informed
this candidate. The coverage claim was checked against the actual helper/browser
and corrected above.

Claude reviewed implementation b5cad10e in PR121 comment 6248814501 / run
39119818752 SUCCESS: static only; test execution denied and CI not independently
read by Claude. No P0/P1. Codex addressed the concrete P2/P3 findings with frozen
v1 versus new-reservation validation, source-current-day first reservation,
exact legacy coverage, explicit oversized-review error, and disabled stale UI
actions after failed readback. Regression tests include strict amount formatting,
rollover, coverage across leap/short months and future-policy compatibility.
Unknown actions remain denied in existing source-auth-boundary tests.

A review observation above 35,000 characters cannot be stored safely in the audit
cell and remains open with a specific operator message. This is an explicit
manual escalation, not a request to delete history; large-record audit handling
remains OP-04. Native confirmation/prompt dialogs remain as in renewal; replacing
them with an accessible styled flow is part of the broader UI/workflow audit.
The Hebrew guide states that closure does not create a payment. Journal-wide
corruption still fails closed by design; removing active validation would mask
corrupted intent. Scalability/repair remain OP-04. Exact final-delta review required.

Whole-journal scan cost, archive/corruption repair and application latency remain
OP-04. Review follow-up queues (including missing initial payment after closing
review), access for deleted clients and bank/document evidence remain OP-05.
OP-06 owns cross-app retry/delivery and legacy recordTreatmentGiven usage.
Across all ten apps the plan still includes structure, workflows, business logic,
missing information/features, security, integrity, backup, performance and
controls. This financial milestone does not close Outpatient's broader audit.
