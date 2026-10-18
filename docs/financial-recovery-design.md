# OP-02b2 — durable financial recovery (program design)

Current renewal-only implementation candidate was rebased onto merged PR #119
`6bdac37f` / live SW v10; see [renewal protocol](renewal-journal.md). Other flows
remain design work. Original design reviewed on `72c80686` / source @96. Codex owns implementation;
Claude provides bounded read-only review. OP-02b1 corrects acknowledgement and
partial-save UI only. This file retains the complete program boundary; the renewal-only candidate
does not establish safe retry for every flow.

## Required protocol

1. Keep immutable operation id, intended cycle, original client identity,
   charge/payment ids and canonical payload in a source-owned FinancialOps
   journal **before** financial effects. No browser-only record is sufficient.
2. Under the existing script lock, validate the original client version and
   relevant financial fields. Empty legacy stamps need a source snapshot/CAS
   strategy; do not assume an empty stamp proves freshness.
3. Store expected pre-effect and post-effect values/stamps before writing the
   effect. A crash after the effect but before a progress update must be
   recoverable by exact readback. Never recreate a deleted client/payment
   merely because the journal's expected row is now absent.
4. Same operation + same canonical payload resumes the original cycle. Same
   operation with a different payload refuses. Existing same-id rows with
   different content are conflicts, not an invitation to upsert over them.
   Preserve notes, method, coverage and legitimate partial payments.
5. Reserve an active operation per client/cycle, including charge creation.
   Interference checks must run under the same lock as existing writes, not
   only at an HTTP entry point before the handler obtains its own lock.
6. Discover pending and ambiguous completed operations from a fresh browser or
   second device. Present what is confirmed, what remains and the original
   period. Retry only the missing confirmed-safe effect. Completion itself
   must tolerate a lost response. Do not silently turn retry into a new month.
7. Fail closed on divergent source data and expose a review state. A completed
   operation must not reapply old values after later legitimate edits/deletion.
   Define explicit resolution/cancellation without erasing audit evidence.

A lock serializes cooperating requests; it is **not** crash-atomic across
multiple Sheets writes. Use recoverable intent and reconciliation terminology.
Add source auth classification/denial tests for every new read/write action;
keep current source/proxy/consumer credentials and the Node-first release gate.
New columns, if needed, are append-only. A new journal must be included in the
financial backup/restore design, with tested partial-operation recovery.

## Writers and interactions to cover

- saveAll full-sheet merge/rewrite, explicit client removal, merge/restore.
- Payment/charge upserts and single/bulk deletion, including legacy ids.
- Renewal, direct intake, activation, edit-modal paid-date propagation, monthly
  chip and extra-charge toggles. Prevent a second active flow bypassing a pending
  operation. Test lead conversion and duplicate identity handling separately.
- Client cell writers and external consumers. `_writeNextBillingDate` and
  `_writePaymentAmountOverride` DO call `_stampClientRowAt` in this base; the
  initial Claude review did not establish this. Session/clinical writers still
  need explicit tracing. Never use an inferred static claim as runtime proof.
- Payment read failure is unavailable, not evidence of no paid row; the current
  loadAll fallback to an empty array remains a broader control limitation.

## Acceptance before a release candidate

Inject interruption before and after every journal/effect write. Test a response
lost after each successful write, double-click, close/reopen, full reload, new
device, stale tab, deleted/merged client, malformed or duplicate journal rows,
changed payload under an old operation id, conflicting legitimate payment,
empty stamps and a writer between retry attempts. Verify no second charge,
no skipped period, no lost confirmed payment and no guessed success.

Execute actual date/coverage helpers for backdating, 31→February, year rollover,
package changes and custom periods. Real Hebrew/RTL browser acceptance and a
monotonic live-SW bump are required. Full suite/audit/CI, independent review,
release/rollback plan and separate Sandra approval remain gates.

## Review evidence and limits

Claude's read-only design report:
https://github.com/sandrabrayer/ezone-outpatient/pull/117#issuecomment-6246754117
Run 39105431108 ended in error after publishing the report. Claude ran no tests;
it is static input, not a successful validation gate. Codex verified the actual
handlers and corrected the stamp uncertainty above. Exact-candidate review is required on the renewal candidate PR. No production journal or data repair was performed.
