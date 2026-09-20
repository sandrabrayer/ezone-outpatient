# Credits / refunds ledger (Credits sheet) — ported from E-Zone-Dashboard PR #124

**Why:** finishing a patient's treatment recorded *that* they left, but nothing
recorded whether **money is owed back** — a month paid in advance, a mid-month
exit, or the explicit decision that **no** refund is due. This adds a `Credits`
sheet plus a Hebrew RTL flow that suggests the credit on סיום טיפול per the
outpatient policy, lets Vered accept or override it (with a mandatory reason),
schedules the payout for the 15th, and keeps every decision — **including a
zero** — as an auditable row.

This is the **money half only**. The Clients and Payments sheet structures are
not modified, and `server.js` is unchanged. Apps Script must be redeployed (New
version → Deploy) for the two new actions to exist; until then the client fails
soft (empty ledger, everything else loads).

## SCOPE — what this is NOT

**No session-level or cancellation logic.** That stays in the E-Zone Therapists
app and in `_recordSessionOutcome`. Nothing in this ledger reads `SessionLog`,
counts sessions, or knows what a session outcome is — guard-tested.

In particular it has **no relation to `Clients.creditsOwed`**, the per-**session**
credit balance `_recordSessionOutcome` maintains (a `therapist_cancelled` grants
+1, a session beyond the monthly quota draws one). That column and this ledger
share only the word "credit":

| | `Clients.creditsOwed` | the `Credits` sheet |
|---|---|---|
| unit | **sessions** (a whole number) | **money** (₪) |
| written by | `_recordSessionOutcome` (therapists app) | `_upsertCredit` (this app) |
| means | "owed one more session" | "owed a refund of ₪X" |

`_upsertCredit` never touches `creditsOwed` — guard-tested.

## Differences from the Dashboard version

- **`clientId` is a real persistent key.** `Payments.clientId` joins straight to
  `Clients.id`, so the Dashboard's dual `patientId` / `patientKey` columns
  **collapse to one `clientId` column**. `houseId` / `facilityType` are dropped
  entirely — outpatient has no facility beds.
- **`dueDate` and `paymentDate` already exist** on `Payments`, so the
  coverage-window logic ports directly with no schema work.
- **Policy: pro-rata only** (see below).
- **Structure:** the calculation lives in its own module,
  `public/credits-ledger.js`, rather than inside `app.js`. It is a plain
  CommonJS/browser module like `therapist-payout.js`, so the tests `require()`
  it directly instead of vm-sandboxing a 6,000-line file.
- **No ex-VAT split.** Outpatient prices are already the client-facing figure and
  the billing UI has no ex-VAT convention anywhere, so credits are stored and
  shown exactly as `Payments.amountPaid` is.

## Schema — `CREDIT_COLUMNS` (append-only; position is the contract)

| # | column | meaning |
|---|--------|---------|
| 1 | `id` | `credit::<clientId>::<allocationMonth>::<seq>` — **minted server-side** under the script lock; `seq` = 1-based count of rows already carrying that clientId+month. Clients never mint ids; an unknown id is refused. |
| 2 | `clientId` | the persisted `Clients.id`. Joins to Clients **and** to Payments. |
| 3 | `clientName` | display copy |
| 4 | `creditType` | `days_unused` \| `prepaid_return` \| `other` — validated against `CREDIT_TYPES` |
| 5 | `allocationMonth` | plain-text `YYYY-MM`; text-forced (`@`) at sheet-ensure time. A full `YYYY-MM-DD` resolves to its own month. |
| 6 | `calculatedAmount` | what the rule computed. **Immutable after creation.** |
| 7 | `amount` | the credit granted. ≠ `calculatedAmount` ⇒ `overrideReason` required |
| 8 | `overrideReason` | why `amount` differs (`''` when equal) |
| 9 | `reason` | human-readable calculation trail at creation (rule, window, days, rate, the **uncapped** figure); for `other`, the free-text justification. Immutable. |
| 10 | `approvedBy` | free text |
| 11 | `decidedDate` | `YYYY-MM-DD` the credit was approved (defaults to the save day, spreadsheet tz); text-forced |
| 12 | `payoutDate` | **derived server-side**: the 15th on or after `decidedDate`; text-forced |
| 13 | `status` | `pending` \| `paid` \| `cancelled` (validated) |
| 14 | `paidDate` | `YYYY-MM-DD` actually paid; **required with `method` when `status = paid`**; cleared otherwise; text-forced |
| 15 | `method` | how it was paid (free text) |
| 16 | `notes` | free text (editable) |
| 17 | `basis` | compact JSON of the calculation inputs/outputs. Immutable. |
| 18–19 | `createdAt`, `createdBy` | server clock + signed-cookie user. Immutable. |
| 20–21 | `updatedAt`, `updatedBy` | server clock + signed-cookie user of the last write |

## Calculation — `suggestCredits(client, exitDate, payments)` (pure)

Returns an array of `{ creditType, calculatedAmount, allocationMonth, basis }` —
**one entry per payment row** whose coverage window still has days after the
exit, plus a single zero `days_unused` entry when no window does.

All arithmetic uses local `getFullYear/getMonth/getDate` parts; day spans use
`Math.round` so a DST switch between two local midnights never shifts a day.
`exitDate` is normalized through `isoDate()` **before any date math** — a
legacy row carrying a full ISO timestamp must not drift −1 day in Israel.

### Coverage windows — the unit of credit

For **every** Payments row of the client (joined on `clientId`), in `dueDate`
order:

- **window** = `[dueDate, dueDate + 1 month − 1 day]` (local parts,
  day-of-month clamped: Jan 31 → Feb 27/28). We never look ahead to a "next
  payment row" — it is usually absent at exit.
- **unusedDays** = days in that window **strictly after** `exitDate` (0 if
  none), minus any day an earlier row's window already credited — overlapping
  windows never credit the same day twice (`basis.creditedFrom`,
  `basis.alreadyCreditedThrough`).
- **rate** = **that row's** `amountPaid` / `CREDIT_DAYS_DIVISOR`.
- **raw** = rate × unusedDays, capped at that row's `amountPaid`.

`allocationMonth` = `monthKey(dueDate)` is **reporting metadata only** — it
never enters the math. There is no "amountPaid for the credited month" lookup
anywhere; every figure comes from the row itself.

### Classification — by the window, not the month key

- **window starts on or before `exitDate`** → `days_unused`, pro-rata. A window
  that ended before the exit is fully used and produces nothing. (Example:
  billing day 20, exit on the 5th of the next month → the 6th–19th spill-over
  days are credited as `days_unused` under the earlier row.)
- **window starts after `exitDate`** → `prepaid_return`: the whole window is
  unearned, so the row's **full `amountPaid`** returns — **not** rate ×
  windowDays. The ÷30 raw and the billed amount are recorded in basis; a 31-day
  window's raw exceeds `amountPaid` and is capped to it
  (`basis.fullReturn = true`). A row due in the exit's own month whose window
  starts after the exit is still `prepaid_return`.

### The ÷30 constant

```js
/* >>> DIVISOR — the single named constant behind the daily rate. <<< */
var CREDIT_DAYS_DIVISOR = 30;
```

`rate = amountPaid of the row / CREDIT_DAYS_DIVISOR` — fixed 30, **never** the
calendar day count of the month. A 28-day February window and a 31-day August
window produce the same daily rate for the same money received.

### The amountPaid cap

`raw` is capped at the row's own `amountPaid`. Never more than was actually
received; `amountPaid = 0` ⇒ `0`. The uncapped figure is always kept in
`basis.uncappedAmount` (with `basis.capped`) and written into `reason`, so the
cap is visible, never silent.

### Policy — outpatient is PRO-RATA ONLY

Pro-rata refund of unused days at **any tenure**, plus `prepaid_return`.

The Dashboard's two zeroing rules are **deliberately not ported**:

- **no 14-day tenure cutoff** (`CREDIT_DETOX_TENURE_CUTOFF_DAYS`)
- **no last-7-days-of-the-month rule** (`CREDIT_RESIDENTIAL_LAST_DAYS`)

Those are **residential / detox bed rules** and do not apply to outpatient
treatment. There is consequently no facility map and no `facilityType` here.
Their absence is guard-tested in both halves of the port: a 14-month tenure and
a 2-day tenure credit identically, and an exit on the 28th of a 30-day month
credits normally.

### Zero rows

When no window has days after the exit, one zero `days_unused` entry is still
emitted (`basis.classification = 'no_unused_window'`): under the latest row
whose window started on/before the exit, else — no payment rows at all — the
exit's full calendar month with nothing received. "No refund owed" is a
recorded decision.

### `other`

Manual line: `calculatedAmount` = the entered amount, `reason` required, month
picked by hand.

## Payout schedule

Credits **pay out on the 15th**, never at exit.

- `decidedDate` — when approved (defaults to the save day).
- `payoutDate` — `payoutDateFor(decidedDate)`: the 15th of the next month on or
  after it. Decided on the 14th → the 15th of that month; on the 15th → that
  same day; on the 16th → the 15th of the following month. Derived server-side
  on every write (`_payoutDateFor`); the client mirror only previews it.
- **Marking paid is an explicit action**: `status = paid` requires `paidDate`
  **and** `method` (client validation and server
  `paid_requires_paidDate_method`). Nothing flips to paid when `payoutDate`
  passes. The payout view's `סמן כשולם` opens a small modal for method + date
  and saves through the same stale-save-guarded edit.
- **Payout view** (גבייה tab, "זיכויים ממתינים לתשלום"): pending credits grouped
  by `payoutDate` ascending with a total per date and a grand total, so the
  outgoing amount is visible before each 15th. Each row offers `סמן כשולם` and
  `ערוך` in edit mode. A pending credit with no payout date groups last rather
  than disappearing.

## Override

`calculatedAmount` and `amount` **both persist**. `calculatedAmount` is
immutable after creation — an edit never overwrites it, so the figure the rule
produced stays on the record next to what was actually granted.
`overrideReason` is **required** when they differ (server-enforced, not only in
the UI) and cleared when they match. `approvedBy` is recorded on the row.

## Flow

1. **Discharge** (`#exitForm`): the existing writes run unchanged (Clients save
   → stop-flag resolution). Only after **both** succeed does the credits modal
   open with the suggestions. A failed or cancelled credit write **never rolls
   the discharge back** — the patient stays discharged and the ledger is
   reachable again from the מטופלים לא פעילים tab.
2. **Recovery / edit** — מטופלים לא פעילים tab, edit mode: a `זיכויים (n)`
   button per discharged patient reopens the same modal; existing rows are
   editable, missing suggestions are proposed, nothing touches the discharge
   record. The payout view's `ערוך` opens the modal for that row's client.
3. **Modal** (Hebrew RTL, existing `.modal` styling): per line — the credit type,
   month, the computed figure, the rule trail, the editable amount, the
   override-reason field (revealed when the amount differs; **required**),
   approved-by, decided date with the derived payout date previewed live,
   status, the paid-date + method fields (revealed on `paid`) and notes. Every
   line is validated (`validateCreditLine`) **before the first write**; lines are
   written one by one and the run stops on the first failure with the modal
   open (saved lines are marked, so a retry edits instead of duplicating).
4. **Stale-save refusal:** an edit echoes the `updatedAt` it loaded; a differing
   sheet stamp is refused server-side with a `conflicts` shape naming who saved
   first; the client reloads the ledger and rebuilds the lines from the sheet.

## Security

- **No new unauthenticated endpoint.** `getCredits` / `saveCredit` are Apps
  Script actions reached only through the session-cookie-gated `/api/sheets`
  proxy (`requireSession`). **`server.js` is unchanged** — guard-tested.
- `createdBy` / `updatedBy` come from `_requestUser(payload)` — the `user` the
  proxy overwrites from the **signed** session cookie. A payload-supplied
  `user`, `createdBy` or `updatedBy` is ignored.
- **Server-side validation of everything the client sends**, even though the UI
  validates too: `creditType` and `status` against fixed lists,
  `allocationMonth` by regex, dates via `_asISODate`, amounts finite and ≥ 0,
  `clientId` present, `overrideReason` when `amount ≠ calculatedAmount`,
  `reason` for `other`, `paidDate` + `method` for `paid`. Strings are trimmed,
  angle brackets and control characters stripped, and length-capped; `basis` is
  capped at 4,000 chars.
- **On edit only `CREDIT_EDITABLE_COLUMNS` are taken from the payload.**
  Identity, `calculatedAmount`, `reason`, `basis` and the creation stamps are
  carried from the sheet whatever the payload claims; `payoutDate` is always
  re-derived. Guard-tested against a tampering payload.
- **Backend refusals are never swallowed:** the Apps Script answers `{ok:false}`
  with HTTP 200, so `apiSaveCredit` throws on `ok:false` **and** on a 200 with no
  echoed credit, carrying the parsed body (`err.data`) so conflict details reach
  the banner.
- The whole write runs under the script lock, so the id sequence and the
  stale-save check cannot race.

## Tests — `test/credits-ledger.test.js` (61, `npm test`)

Code.gs cannot be `require`d in Node, so the suite **parses the real
`CREDIT_COLUMNS` / `CREDIT_TYPES` / `CREDIT_STATUSES` /
`CREDIT_EDITABLE_COLUMNS` / `CREDIT_TEXT_COLUMNS` / `CREDIT_PAYOUT_DAY` out of
`Code.gs`** and mirrors `_upsertCredit` as a pure function over an in-memory
rows array — the same sync-guard discipline as `session-outcome.test.js`, so the
mirror cannot silently drift.

- **Schema guards:** the pinned 21-column order; `patientId` / `patientKey` /
  `houseId` / `facilityType` absent; the editable set; the text-forced set.
- **Calculation:** divisor 30 across 28/30/31-day months; the cap (including
  `amountPaid = 0`); mid-window exit; billing day 20 spilling into the next
  month; a fully-used window; the Jan 31 clamp; a partial payment rating from
  `amountPaid`, not the billed amount.
- **prepaid_return:** full `amountPaid`, not rate × windowDays (31-day window
  capped, raw on record); a same-month row whose window starts after the exit;
  coexisting with a `days_unused` row.
- **Overlapping windows:** no day credited twice, `creditedFrom` /
  `alreadyCreditedThrough` recorded, a fully-swallowed later window credits what
  is left rather than duplicating.
- **Zero rows:** no payment rows at all; a prepaid-only exit; another client's
  payments ignored.
- **Policy:** pro-rata at 14-month and 2-day tenures alike; tenure 13/14/15
  identical; exits inside the Dashboard's last-7 window in 28/30/31-day months
  all credit; the ported bed-rule constants absent from both halves.
- **Dates:** a full ISO timestamp exit read as its local date; exact spans across
  the March **and** October DST switches; exit on the first and last day of a
  window; no/invalid exit date suggests nothing.
- **Write path:** server-minted id + per-client-month sequence; a client-minted
  id refused; `payoutDate` derived (a forged value ignored); blank `decidedDate`
  → today, unparseable → refused; stamps from the caller, not the payload;
  override without a reason refused and with one stored (`calculatedAmount`
  untouched); an equal amount clears a stray reason; a zero credit written; bad
  type/status/month/amount/clientId refused; `other` without a reason refused;
  `paid` without `paidDate` **or** `method` refused; un-paying clears
  `paidDate`; edit immutability under a tampering payload; a stale edit refused,
  naming who saved first, with the rows byte-unchanged; sanitizing and length
  caps; `basis` JSON round trip.
- **View helpers:** grouping + totals by payout date (paid/cancelled excluded, an
  undated row last); `creditsForClient`; `buildCreditLines` not re-proposing a
  saved decision and carrying the stale-save echo; `validateCreditLine`; the
  trail text.
- **Scope + security:** `server.js` gains no credit route and still gates +
  overwrites `user`; `saveCredit` stamps from `_requestUser`; the ledger's code
  mentions no session concept and `_upsertCredit` never touches `creditsOwed` or
  `SessionLog`; the modal and payout view are wired into the page; the credits
  hook cannot revert the discharge.

## Files

- `public/credits-ledger.js` — **new.** The pure calculation and view helpers.
- `apps-script/Code.gs` — `CREDITS_SHEET`, `CREDIT_COLUMNS`, `CREDIT_TYPES`,
  `CREDIT_STATUSES`, `CREDIT_PAYOUT_DAY`, `CREDIT_TEXT_COLUMNS`,
  `CREDIT_EDITABLE_COLUMNS`; `_todayISODate`, `_asISODate`,
  `_ensureCreditsSheet`, `_getCredits`, `_creditId`, `_payoutDateFor`,
  `_creditStr`, `_creditAmount`, `_creditDate`, `_upsertCredit`; the
  `getCredits` / `saveCredit` dispatch. **Requires an Apps Script redeploy.**
- `public/app.js` — `state.credits`; `apiGetCredits` / `apiSaveCredit`;
  `loadCredits`, `ensureCredits`, `reloadCredits`, `creditCountForClient`;
  `openCreditsForClient`, `renderCreditLines`, `submitCredits`,
  `showMarkCreditPaidModal`, `submitMarkCreditPaid`, `renderCreditsPayouts`; the
  discharge hook, the מטופלים לא פעילים button and the `renderBilling` hook.
- `public/index.html` — the credits modal, the mark-paid modal, the
  "זיכויים ממתינים לתשלום" section on גבייה, the module script tag.
- `public/style.css` — `.credits-modal` / `.credit-*` / the payout view.
- `test/credits-ledger.test.js` — **new.**
- `CHANGELOG.md`, this file, `README.md`.

## Not in this step

No therapists-side change, no session or cancellation logic, no Sheets
migration (the `Credits` tab is auto-created on first use), no `server.js`
change.

## Deploy (required before this works live)

**Redeploy the Apps Script web app** to the existing deployment: Apps Script
editor → **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
The two new actions live in `Code.gs`, so a fresh `/exec` version is required.
No new Script Property and no new environment variable — the ledger rides the
existing session-gated proxy.
