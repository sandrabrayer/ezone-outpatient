# OP-02b1 — truthful financial save confirmation

Candidate only, based on released production `72c80686afa0dfe2218c6c6a2c6d680ab7ae59dc`
(tree `09789a9d4d598a4723486d55feaf983988258501`). OP-02a/PR117 is released:
Node at that SHA, existing Apps Script deployment @96. Do not reuse its merged
branch or merge the superseded 2026-10-16 lock branch.

## Problem and bounded change

A refused client update could still trigger a payment. Several multi-step UI
flows inserted a paid row before source confirmation, swallowed a payment
failure and then displayed success. Editing could also roll back a confirmed
client change locally after only its subsequent payment failed. Orphan deletion
removed its local row even when the source rejected the deletion.

- Financial prerequisites opt into `persist({requireIds:[client.id]})` refusal.
  A conflict on that id stops the payment. A conflict on another row retains
  saveAll's partial-acceptance semantics and its banner. Financial continuations
  wait for a conflict/staleness reload so it cannot erase their later result.
- Additional charge, direct intake, lead activation and paid-date editing keep
  the existing confirmed payment until a new payment receives `ok:true`.
  Malformed success responses cannot count as acknowledgement. Confirmed first
  steps survive second-step failure. Buttons stay disabled through completion.
- A persistent on-screen Hebrew warning distinguishes saved client/charge from
  an uncertain payment. No trailing success toast; no automatic retry. Creating
  the same charge or renewing again is not recommended as recovery.
- A future billing date alone no longer produces a paid chip: if the preceding
  cycle has no confirmed paid row (new or legacy id), the card says
  `נדרש אימות תשלום`, with no paid date or paid/unpaid toggle for that state.
  Existing billing calculations, amounts, dates and source rows are unchanged.
  This can reveal pre-existing legacy discrepancies; it does not repair them.
- Orphan-payment removal changes local state only after acknowledgement.
- Service worker v8 (independently read from production 2026-10-18) → v9.

## Validation and limits

Real app.js handlers/helpers run with synthetic UI and persistence failures;
real-browser tests run the UI, actual Node proxy and actual Code.gs against
in-memory Google services. Browser scenarios include source refusal, a write
whose response is lost, reload, activation, intake, actual stale-client refusal
and successful backdated renewal. No live patient/payment data is used.
Exact final counts and CI evidence belong in the PR release report.

OP-02b1 **does not implement durable recovery**. Reopening renewal after a
partial save can still compute the next cycle; the updated diagnostic deliberately
continues to expose that. The warning persists on the current screen, not in
server storage. The payment-check chip is derived again after reload, but it
is not an operation journal. Existing month-paid and charge toggles, source
same-id upsert overwrite semantics and broader concurrent editing remain for
OP-02b2. Never claim atomic writes, cross-device retry safety, historical data
repair, or closure of OP-02 as a whole.

## Release and rollback

One draft PR, exact-head green full suite plus required lead/financial browser
job, bounded Claude review and Sandra's separate approval before production.
This candidate changes no Code.gs, schema, source credentials or deployment
gate. After approval merge, verify exact Node `/api/version` and `/healthz`,
confirm the served SW v9 and time three homepage GETs. Apps Script stays @96;
no source dispatch is needed for this frontend/test/docs change.

Rollback is a separate approved forward revert with a NEW cache version above
the version then live. Never lower CACHE to v8 or v9 after a newer shell shipped.
A code rollback cannot undo financial rows and restores the old UI defects.
No Railway settings/variables/logs, new dependencies or schedules are needed.

Immediate return point: OP-02b2, `docs/financial-recovery-design.md`. Do not jump
to another app, performance or CRM implementation before the financial track's
remaining recovery risks are resolved. CRM #114 and all other drafts stay intact.
