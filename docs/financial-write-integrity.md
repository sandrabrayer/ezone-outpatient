# Current status — 2026-10-18

OP-02a/PR117 is released at Node `72c80686afa0dfe2218c6c6a2c6d680ab7ae59dc`,
existing source @96. The older candidate record below is historical.

OP-02b1 is now a separate candidate for explicit acknowledgement, dependent
conflict refusal, truthful partial-save UI and orphan deletion confirmation.
See `CHANGELOG-financial-save-confirmation.md`. The diagnostic's add-charge
optimistic paid row is now absent and payment attempts after a client refusal
are zero. Its reopened-renewal retry still changes October to November: **that
remaining failure is intentional evidence, not a passing acceptance test**.

Immediate return: `docs/financial-recovery-design.md` (OP-02b2), durable operation
identity and safe recovery across refresh/device, with all original financial
business calculations preserved. OP-02 as a whole remains open.

---

# OP-02 — Outpatient financial write integrity

Owner: Codex (single implementation owner). Refreshed 2026-10-18 against the
released production branch `claude/youthful-volta-laarnk` at
`941cd8b62f9d7d31aee7fe3dc33c29305473eb83` (tree
`3c3aad43db5bdd1a767268bfdab6a0e52034b0f3`). PRs #115 and #116 are released;
source authentication and the explicit post-Node source deployment gate stay
unchanged. `/api/version` independently returned this SHA with HTTP 200 on
2026-10-18. The last completed source release is @95 from #116.

## OP-02a: source lock refusal — integrated candidate

Branch: `codex/op02-locks-auth-20261018`. The original queued branch
`codex/op02-financial-locks-20261016` at `ccd0488` is preserved; this fresh
candidate supersedes it. Do not merge both.

| Operation | Finding | Candidate behavior / evidence |
| --- | --- | --- |
| savePayment / updatePayment | Ignored refused script lock | Return `busy` before Sheets access; no unowned release |
| saveCharge / updateCharge | Same ignored result | Same refusal boundary |
| Four single/bulk payment/charge deletes | `waitLock` already throws before write block | Behavior unchanged; timeout, write error and repeated deletion tested |
| Retrying a saved row | Existing upsert searches its id | Same-id retry after ambiguous append keeps one row; a new id is a different operation |
| Auth plus financial operations | Must preserve OP-01 before acquiring the lock | All eight actions deny missing, wrong, consumer-only and unconfigured credentials before lock/Sheets access |

All 64 financial tests execute the real source router and handlers, with only
Google services replaced. On the released base, 54 pass and the 10 denied-lock
regressions fail. After the two-line source fix all 64 pass. Together with the
132 source-auth tests, 196/196 pass. Full local serial suite: 1,352 total,
1,343 pass, zero failures, nine browser skips. CI must independently pass,
including the required `lead-save-browser` job. Audit: zero high/critical, one
existing moderate `qs` finding; dependencies unchanged.

No live financial data was read or changed. The in-memory interleaving is a
deterministic contention simulation, not a real Google concurrency/load
measurement. A successful same-id upsert is not a stale-edit conflict check;
these handlers can still overwrite a different payload with the same id.
There is no atomic transaction across client, charge and payment writes.

## OP-02b: UI partial saves — next, unresolved

Run `TZ=UTC node test-support/financial-ui-failure-probe.cjs`. It extracts and
executes actual `public/app.js` submit handlers and actual date/id helpers,
replacing only UI services and persistence with synthetic fixtures. It is a
diagnostic, not a green acceptance test. Re-run on the 2026-10-18 candidate confirmed the same failures. Unchanged
`app.js` SHA-256:
`06775907725989375b0ec1f65f1028b8a0e957e1a8a15a234ef0a0e720737110`.

### 1. Renewal retry can advance to the next unpaid cycle

The renewal handler saves the client first, then the payment. In the fixture,
the client's due date is 2026-10-01 and the first payment save is refused:

| Step | Payment id attempted | Saved next billing date | Payment state |
| --- | --- | --- | --- |
| First submit | `pay::fixture-client::base::2026-10` | 2026-11-01 | Rejected; zero saved payments |
| Same form submitted again | `pay::fixture-client::base::2026-11` | 2026-12-01 | Retry targets November, leaving October unrecorded |

The code comment claiming the retry uses the same deterministic id is false
for this failure sequence: the next submit recomputes the due date from the
already advanced client. This reproduction is synthetic; it does not prove
that any actual client's account has been affected.

Acceptance for the repair: keep the intended billing cycle/payment id stable
after a partial failure, including close/reopen/reload and ambiguous server
success; prevent advancing the cycle twice or overwriting an unrelated
payment. Separate client-save failure from payment-save failure. Cover package
changes, backdated payments, short months, double-clicks and a stale second
tab. Preserve approved amount/coverage calculations. A transient in-memory
variable alone is insufficient for durable recovery.

### 2. Additional charge remains shown paid after its payment is rejected

With a synthetic additional charge marked paid, the charge save succeeds and
the payment save fails. The real handler retains the optimistic paid row,
emits a failure notice followed by the success notice `הטיפול נוסף`, and closes
the modal. Thus local paid state is not evidence of a saved payment.

Acceptance for the repair: retain the successfully saved charge, remove or
clearly mark unconfirmed payment state, retain a visible partial-success
message, and reconcile uncertain outcomes by the original payment id. Retrying
the payment must not create a second charge. Verify the actual Hebrew/RTL
flow in browser before release and bump the SW from its live version.

### 3. A refused client-row update can still lead to a payment attempt

The same diagnostic now executes the real `persist()` and renewal handler with
`apiSave` returning a synthetic row conflict. `persist()` shows the conflict
banner, schedules a reload, then fulfills its promise. The renewal `.then()`
therefore still attempts `persistPayment`. Observed: refusal banner shown and
one payment attempt after refusal. No payment is saved in this fixture because
the payment service rejects the attempt. This proves control flow, not a live
financial mismatch. OP-02b must distinguish a refused client-row update from a
confirmed one and stop dependent financial writes after refusal.

### Additional routes to include in the same review

Source inspection, not yet full failure-injection coverage:

- Direct client intake and lead activation also insert a paid row before
  payment confirmation and catch the payment error inside a success chain.
- Orphan-payment removal removes its local row before the source confirms;
  the catch reports an error without restoring the row.
- Review the edit-modal paid-date propagation and existing month-paid rollback
  flow before choosing a shared repair. Do not overwrite a legitimate saved
  payment when a later client update fails.

## Sequence and release boundary

OP-02a is the current bounded release candidate; obtain its separate production
approval only after the draft PR, CI and Claude review are concrete. It adds no
UI, schema, billing calculation, configuration, dependency or workflow change.
After approval: merge, verify exact Node SHA and health, explicitly dispatch
Deploy Apps Script with that full merge SHA, and verify the existing source
version and authorized/denied read paths. Do not generate a new deployment or
rotate credentials. Never test the lock by writing a live patient's payment.
See `CHANGELOG-financial-write-locks.md` for release and rollback details.

The immediate next implementation is OP-02b, including the three reproductions
above, durable intent/period recovery and uncertain outcomes. A transient
in-memory flag or a blind retry is insufficient. Codex owns implementation;
Claude is asked for bounded independent review, not parallel editing.

Do not proceed to performance or another app before resolving the financial
save track. OP-03 scheduled backup evidence and financial restore coverage,
OP-05 business controls and OP-06 legacy `recordTreatmentGiven` integration
remain open. CRM #114 and other drafts remain unchanged. The ten-app plan and
return points live in Sandra's existing work-plan Page. Neither these tests
nor OP-02a close OP-02 as a whole or prove historical data is unaffected.
