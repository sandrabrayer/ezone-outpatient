# Patient-no-show pay approval gate

**This changes live therapist pay.** Until now, when the E-Zone Therapists app
reported `patient_no_show`, the outpatient receiver paid the therapist
**automatically** — `_computeSessionPay` returned the ordinary rate the moment
the event landed, and the session went into the payout total with nobody having
looked at it. That is now an **approval gate**: the session is logged at **₪0**
and waits for **ורד** (or **סנדרה** as backup) to approve or decline it.

`happened` and `therapist_cancelled` are **untouched**, end to end.

## Behaviour

| outcome | before | after |
|---|---|---|
| `happened` | pays the rate | **unchanged** — pays the rate, no decision |
| `therapist_cancelled` | pays 0 | **unchanged** — pays 0, no decision |
| `patient_no_show` | **paid the rate automatically** | **₪0 + `payStatus: 'pending_decision'`** until a person decides |
| `patient_no_show`, group (`קבוצה`) | pays 0 | **unchanged** — pays 0, not gated (see below) |

- **Approve** → `therapistPay = _therapistPay(therapist, clinicalType)` — the
  exact rate `_computeSessionPay` would have produced, recomputed at decision
  time so a `TherapistRates` change is picked up. `payStatus: 'approved'`.
- **Decline** → `therapistPay` stays **0**, `payStatus: 'declined'`, and a
  written `declineReason` is **REQUIRED** (server-enforced, not only in the UI).
- **Nothing auto-resolves.** There is no timeout that pays and none that
  declines. A pending row stays pending until a person decides — there is no
  clock input anywhere in the pay path, and a test asserts that on the real
  source.

### Why group no-shows are not gated

`_computeSessionPay` returns a **decided 0** for `קבוצה` before it ever looks up
a rate, so an approval could not change the amount by a single shekel. Gating it
would put a ₪0 approval in ורד's queue for no purpose. A group no-show therefore
keeps `payStatus: ''` and behaves exactly as before. This is the one place the
implementation narrows the stated rule; it is tested explicitly.

## Approvers

**ורד is the approver; סנדרה is the backup for absences.** Both record a named
approver on the row.

Following the existing approval pattern (`_approveExtraSession` — a `status` /
`approvedBy` / `approvedAt` triple plus a dashboard queue) rather than inventing
a second mechanism, with **one deliberate hardening**: that flow takes the
approver name from the **client** (`approvedBy: 'Vered'`, hardcoded in
`app.js`). That is acceptable for a scheduling approval and **not** acceptable
for one that moves money, so the pay decision takes the name from the **signed
session cookie** via `_requestUser` — the same source as `updatedBy` — and
refuses anything else.

- **`lib/approvers.js`** — new. `PAY_APPROVERS = ['ורד', 'סנדרה']`, checked
  server-side, **fail-closed**: a blank name (a legacy user-less cookie) is
  refused, so an unattributable pay decision cannot exist.
- This is **deliberately not** `SESSION_USERS`. That list answers "who may log
  in and stamp `updatedBy`"; this one answers "whose name may appear on a
  decision that moves money". Conflating them would make every future login name
  a pay approver by accident. A test asserts the approver list is strictly
  narrower, and that שירן / יעל / ירדן cannot decide.
- **סנדרה was added to `SESSION_USERS`** so she can log in at all (the name is
  read from the cookie, so a name that cannot log in could never be stamped).
  A test pins that every approver is also a session user.
- She is **not** added to the leads `assignedTo` dropdown — she decides pay, she
  does not take leads. See "Tests changed" for the invariant that moved.

Persisted per row: `payStatus`, `decision`, `approvedBy`, `declineReason`,
`decidedAt`.

## Schema — `SESSION_LOG_HEADERS` (append-only)

Five columns appended after `forwardedToPayroll`; **no existing column moved**
(guard-tested as a prefix):

| column | meaning |
|---|---|
| `payStatus` | `''` (no decision applies) \| `pending_decision` \| `approved` \| `declined` |
| `decision` | the person's verb: `approve` \| `decline` \| `''` |
| `approvedBy` | the approver, from the **signed session cookie** only |
| `declineReason` | required on a decline, `''` otherwise |
| `decidedAt` | ISO timestamp of the decision |

`decision` and `payStatus` are redundant **by design** (both were specified):
`payStatus` is the mechanical state everything else keys off; `decision` is the
audit record of what was chosen. They are cleared together when a re-mark voids
a decision.

## Payout interaction — the risky part

- **A pending row can never reach payroll.** `_markForwarded` skips
  `pending_decision` rows and reports `skippedPending`, so forwarding a month
  leaves them open; the UI warns before forwarding and says how many were held
  back. Once decided, the row forwards normally and surfaces as a **הפרש**.
- **`PAID_OUTCOMES` no longer decides alone.** `public/therapist-payout.js` now
  routes every row through `paysFor(row)`, which checks `payStatus` as well as
  the outcome. `isPending` / `isDeclined` / `paysFor` are exported and tested.
- **Pending rows are SHOWN, not hidden**: they appear in the per-session
  breakdown with pay 0, a `ממתין` chip and the amount approving them would cost,
  plus a per-therapist `ממתין להחלטת תשלום` stat. They are in `pendingCount` and
  `pendingRate` and in **no** money total — `pendingRate` is **exposure**, never
  owed, and is never folded into `preVatTotal`/`vatTotal`.
- The **CSV export** for חשבת שכר inherits the corrected totals automatically
  (it sums from the summary) and gains a **note row** when a backlog exists, so
  payroll knows a follow-up הפרש may arrive rather than assuming the month is
  closed. It changes no number.

### The rule WITHHOLDS rather than allow-lists — and why that matters

`paysFor` pays a paying outcome **unless** `payStatus` explicitly withholds it.
The tempting alternative — "pays only on an explicit `approved`" — would have
been a silent, retroactive pay change: **every `patient_no_show` row ever
logged carries a blank `payStatus`** (the column did not exist) alongside its
real, already-paid rate. Requiring `approved` would have dropped all of them out
of the payout totals for months nobody ever decided about. A blank status has
three innocent meanings — the gate never applied, a group no-show, or a
pre-gate row — and none of them is "unpaid". Locked by a test named for it.

## Re-marking

The existing behaviour is preserved: a re-mark recomputes pay from scratch and
reverses the previous row's credit effect. On top of that:

- **Outcome moves away from a gated no-show → the decision is VOID.** Pending or
  decided, `payStatus` / `decision` / `approvedBy` / `declineReason` /
  `decidedAt` are all cleared and the ordinary rule for the new outcome applies.
  A decline about a no-show must not suppress a `happened` session.
- **Outcome stays a gated no-show → the decision CARRIES.** The same fact is
  being re-reported, so a decision already made is not re-asked: approved pays
  the **recomputed** rate, declined stays 0, pending stays pending.
- **`happened` → `patient_no_show` opens a fresh pending decision**, withdrawing
  the automatic pay.

## Forwarded rows are frozen — ⚠️ this did NOT previously exist

The brief asked to preserve "if a row already has `forwardedToPayroll`, do not
change its pay — existing behaviour". **It was not existing behaviour.** Before
this change only the *stamp* was preserved across an upsert
(`rowObj.forwardedToPayroll = oldRow.forwardedToPayroll`); `therapistPay` was
recomputed unconditionally, so a re-mark silently rewrote the pay on a row
payroll had already been sent.

This adds the freeze as a **new guard**, because it is plainly the safer rule:
once a month has gone to חשבת שכר that money is out the door, and a correction
belongs in the next cycle as a הפרש, not as a silent rewrite of a settled row.
Since the payout view already excludes forwarded rows, the frozen figure stands
as the record of what payroll actually received.

**It applies to every outcome, not just no-shows** — so a `happened` row that
was already forwarded no longer has its pay recomputed by a re-mark either. That
is a behaviour change beyond the approval gate; it is called out here so it can
be scoped down if that is not wanted. Credit effects are **not** frozen — they
are a separate ledger and the reversal stays correct.

A forwarded row also cannot be decided at all (`already_forwarded`).

## The queue

Pending decisions appear as a dashboard panel, **⏳ אישור תשלום — לא הגיע
מטופל**, beside the two approval queues ורד already works (⏳ המתנה לאישור
הפסקה, ➕ בקשות לטיפול נוסף) — not a screen she has to remember to open. Each
row shows the patient, therapist, treatment type, date and **what approving it
would pay**, with `אשר תשלום` / `דחה` buttons (editor only).

The **count is persistent**: a badge on the **תשלומי מטפלים** tab button,
rendered at the top of `render()` on every pass from every view, so a growing
backlog is visible whichever tab is open. Approving is a confirm; declining
opens a modal that requires a reason.

The queue is fed by a new minimal read, `getPendingSessionPay`, fetched in
`loadAll`'s parallel batch — only the fields the queue renders, never the whole
`SessionLog`.

## Security

- **No new endpoint and `server.js` is unchanged** (guard-tested).
  `decideSessionPay` / `getPendingSessionPay` are Apps Script actions reached
  only through the session-cookie-gated `/api/sheets` proxy.
- **The approver comes from the signed cookie, never the payload.**
  `_decideSessionPay` reads `_requestUser(payload)` — the `user` the proxy
  overwrites from the cookie — and refuses any name not in `PAY_APPROVERS`. The
  browser never sends an approver name; a test asserts both halves.
- Refusals that **write nothing**: `missing_session_id`, `invalid_decision`,
  `not_authorized`, `decline_reason_required`, `not_found`, `not_pending`,
  `already_forwarded`, `unknown_therapist`.
- `not_pending` also makes the action **safe against a double-click** — a
  decided row cannot be re-decided.
- `declineReason` is sanitized (angle brackets and control characters stripped,
  trimmed) and capped at 300 chars.
- The whole write runs under the script lock.
- An unknown therapist still **rejects the no-show at write time**, exactly as
  today — the rate is computed even for a gated row so the failure surfaces
  immediately rather than at approval time.
- Every decision is written to the hidden `AuditLog`
  (`session_pay_approved` / `session_pay_declined`) with the approver, the
  amount and the reason.

## Tests — `test/no-show-pay-approval.test.js` (46, `npm test`)

`Code.gs` cannot be `require`d in Node, so the write paths are mirrored as pure
functions over an in-memory rows array, with **source-scan guards** that parse
the real `SESSION_LOG_HEADERS`, `PAY_APPROVERS` and pay-status constants out of
`Code.gs` and assert they match — the same discipline as
`session-outcome.test.js`, so the mirror cannot drift. The payout view is tested
against the **real module**.

Covering every contract the brief named, plus the ones the work surfaced:
`patient_no_show` writes `pending_decision` at 0 (not the rate); approve
produces **exactly** what `_computeSessionPay` would have; decline without a
reason is refused and writes nothing; a pending row is excluded from the totals
and cannot be forwarded; re-marking pending → `happened` pays normally and →
`therapist_cancelled` pays 0; an already-forwarded row is unaffected;
`happened` / `therapist_cancelled` unchanged end to end. Also: the group
carve-out, the approver allow-list (סנדרה yes, שירן/יעל/ירדן no, blank no),
only-pending-can-be-decided, no auto-resolution, decision carry vs. void in both
directions, `skippedPending` reporting, the declined-row path, **history is not
rewritten**, the CSV export, and the UI/security wiring.

## Tests changed (pre-existing pins this work legitimately moves)

None of these were failing before; each pinned a snapshot that this change moves
for a stated reason. In every case the assertion was rewritten to express the
**real invariant** rather than relaxed away:

- `session-outcome.test.js` — its mirror gained the gate, and its
  `patient_no_show` case now asserts the new behaviour (pay 0 + pending). The
  "`forwardedToPayroll` is last" assertion became an **exact prefix** check, so
  it still catches a moved/renamed/removed column but does not freeze the
  append-only array against the next append. Same fix in
  `session-credits.test.js` (now pinned by index).
- `add-user-yarden.test.js`, `session-who-when.test.js`,
  `name-picker-conflicts.test.js` — `SESSION_USERS` equality pins became
  **prefix** checks, and the `assignedTo`-equals-`SESSION_USERS` invariant became
  **containment** (every assignee must be an allow-listed name; not every
  allow-listed name need be assignable). That is the property that actually
  protects the server. The sw.js `v5` pin became a **floor** (`>= v5`).
- `two-way-alerts.test.js` — a `results[6]` index pin became index-agnostic
  (`loadAll`'s batch grew by one read).
- `user-guide.test.js` — the tab-label regex now tolerates a badge span inside
  the button.

`sw.js` cache `ezone-outpatient-v5` → `v6` (index.html changed).

## Files

- `lib/approvers.js` — **new.** `PAY_APPROVERS`.
- `lib/users.js` — סנדרה appended; the assignedTo relationship documented.
- `apps-script/Code.gs` — the five appended `SESSION_LOG_HEADERS` columns;
  `PAY_APPROVERS` mirror, `_isPayApprover`, `_toNumberOrZero`, the
  `PAY_STATUS_*` constants, `_payGateApplies`; the gate, decision-carry/void and
  forwarded-freeze in `_recordSessionOutcome`; `_decideSessionPay`;
  `_getPendingSessionPay`; the pending skip in `_markForwarded`; the
  `decideSessionPay` / `getPendingSessionPay` dispatch.
  **Requires an Apps Script redeploy.**
- `public/therapist-payout.js` — `GATED_OUTCOMES`, the `PAY_STATUS_*`
  constants, `isPending` / `isDeclined` / `paysFor`, `rateIfApproved`, the
  pending/declined counts and the per-session pay-decision fields.
- `public/payout-export.js` — the pending note row.
- `public/app.js` — `state.payDecisions`; `apiGetPendingSessionPay` /
  `apiDecideSessionPay`; `renderPayDecisions`, `renderPayTabBadge`,
  `handlePayDecisionClick`, the decline modal, `reloadPayDecisions`; the
  `loadAll` read; the pending display and forward warning in the payout view.
- `public/index.html` — the queue panel, the tab badge, the decline modal.
- `public/style.css` — `.tab-badge`, `.pay-pending-chip`, `.pay-declined-chip`.
- `public/sw.js` — cache v6.
- `test/no-show-pay-approval.test.js` — **new.** Plus the six adjusted files above.
- `CHANGELOG.md`, this file, `README.md`.

## Deploy (required before this works live)

**Redeploy the Apps Script web app**: Apps Script editor → **Deploy → Manage
deployments → ✏️ → Version: New version → Deploy**. The new actions and the
five new columns live in `Code.gs`, so a fresh `/exec` version is required. No
new Script Property and no new environment variable.

The `SessionLog` header row is extended in place by `_ensureSheet` on first use;
existing rows read blank for the new columns, which is exactly the "no decision
applies" state that keeps their pay intact.

## Note for the therapists side

The receiver's response now carries `payStatus`. A `patient_no_show` comes back
with `therapistPay: 0` and `payStatus: 'pending_decision'` — if the therapists
app displays the returned pay anywhere, it will now show 0 for a no-show until
ורד approves it. Nothing there needs to change for the gate to work.
