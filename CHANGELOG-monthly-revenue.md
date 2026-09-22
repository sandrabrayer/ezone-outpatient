# Monthly revenue view (הכנסות חודשיות)

A new tab that answers **"how much revenue belongs to month X"** — independent
of when the cash arrived. Added **alongside** the daily גבייה worklist, which is
not modified.

Ported from the E-Zone-Dashboard design. **There is no Dashboard implementation
to copy**: that work was scoped and reported but stopped at the investigation
stage before any code was written, and no monthly view exists on
`claude/build-ezone-dashboard-QOg5s` (or on any other branch of that repo). What
was ported is the *contract* — the coverage-window allocation rule, the four
figures, the never-blend rule and the ex-VAT basis. If the Dashboard view is
built later it should be built to match this file, not the other way round.

---

## The problem

The daily גבייה screen is a worklist: pick a date, see who is due. Its
`סיכום חודשי` panel does aggregate by month, but it buckets rows by
`monthKey(dueDate)` — the month a cycle *started* in, not the month the money
was *earned* in. A client billed on the 20th has two thirds of every cycle
falling in the following month, so that panel is systematically wrong about
which month owns the revenue, and it says nothing about revenue not yet
collected.

## The allocation rule

A payment's coverage window is `[dueDate, dueDate + 1 month − 1 day]`. A window
straddling a month boundary contributes to **both** months, split by the number
of its days in each:

```
₪3,000 covering 20 Jan – 19 Feb  (31 days)
  → January   12/31 × 3,000 = ₪1,161.29
  → February  19/31 × 3,000 = ₪1,838.71
```

**Neither `paymentDate` nor `monthKey(dueDate)` takes part.** `paymentDate` is
shown in the drill-down (labelled `שולם בפועל`) purely so you can see when the
cash landed; it never moves a shekel. A client who pays three months late still
has their money land in the months it paid for — tested explicitly.

**One-time extra charges are the one exception**: a one-off is not a month of
treatment, so its window is the single day it falls due and it lands wholly in
that month. Spreading it over 30 days would post most of a one-day charge into
the following month.

## Reuse — the window is not reimplemented

`public/credits-ledger.js` already computed this exact window for credits, as a
pure exported function with no credits coupling. It is imported, not copied:

```js
var paymentCoverage = CL.paymentCoverage;
```

Along with every date primitive it depends on (`isoDate`, `localDateFromISO`,
`isoFromLocalDate`, `diffWholeDays`, `addMonthsClamped`, `addDays`,
`roundMoney`). Nothing needed extracting — the module was already shaped for
this. A guard test asserts none of those names is redefined locally, so the
coverage rule cannot fork: change it once, and both the credits ledger and this
view follow.

## The four figures

| | meaning | certainty |
|---|---|---|
| **נגבה בפועל** (RECEIVED) | cash collected, allocated by window | money in hand |
| **צפוי** (EXPECTED) | contracted money for the month, not yet in hand | an assumption |
| **זיכויים** (CREDITS) | refunds allocated to the month, as a negative | — |
| **נטו** (NET) | received + expected − credits | a projection |

**RECEIVED and EXPECTED are never summed into one figure.** They are different
certainties, and a single blended "revenue" number launders the forecast into
the bank balance. The module exposes no combined accessor; the two are separate
cards, coloured apart (green for money, blue for forecast); NET is the one place
they meet and is labelled as the projection it is. A test asserts no
`total`/`revenue`/`combined` field exists on the result.

### No double counting

A day of the month is either paid for or it is not. On a partially-paid row,
`amountPaid` goes to RECEIVED and the shortfall goes to EXPECTED, **over the
same window with the same day weights**, so the two partition the row's
contracted amount exactly. A cycle that already has a Payments row is never
*also* projected — without that skip a fully-paid January would read as ₪6,000
of revenue on ₪3,000 of money. Tested.

### EXPECTED has three kinds, and they are not equally believable

Summed into one figure, kept separable in `.rows` and in sub-buckets, and broken
out on screen under **הרכב הצפוי**:

- `billed_unpaid` — a Payments row exists and is short.
- `projected` — a future cycle, no row written yet. The honest forecast.
- `unbilled_past` — a cycle whose date has **passed** with no row at all.

The last one is usually a recording gap, not future income, so it is flagged in
amber in both the breakdown and the detail rows. It stays *inside* EXPECTED
because the money is genuinely owed for those days — hiding it would understate
the month and bury the leak — but it is named apart so nobody reads it as a
forecast.

### Credits

Split by the span they actually refund, **not** by `allocationMonth` (which the
ledger itself documents as reporting metadata that never enters any math):

- `prepaid_return` → the whole coverage window.
- `days_unused` → only the credited tail, `creditedFrom..coverageEnd`. Days
  before the exit were used and were never refunded.
- No usable basis (a manual `other` credit, or a legacy row) → falls back to
  `allocationMonth` and lands whole in it. `spanSource` records which path was
  taken and the drill-down shows a `לפי חודש שיוך` chip, so it never implies a
  day-level precision it does not have.

`pending` and `paid` both reduce the month; `cancelled` is a void decision and
counts for nothing.

---

## Decisions this port had to make

### 1. Breakdown dimension: **location (סניף)**

The outpatient app has no houses, but it has `LOCATIONS`, and they are the same
physical sites the Dashboard calls houses — רעננה הפרדס / רעננה אשר / רמות השבים
/ קיסריה גמילה / קיסריה עפרוני. It is the direct analogue, and the only
dimension along which an outpatient figure and a Dashboard figure can be added
up per site.

Clients carrying no location bucket under **ללא סניף** rather than `''` (an
unlabelled breakdown row reads as a rendering bug), which is also where a
payment whose client record is gone lands — money is money even when the client
row is not. Sorted by NET descending; all-zero rows are dropped.

`serviceType` was the alternative. It answers a clinical question rather than a
financial one and has no counterpart in the Dashboard, so it would not
consolidate.

### 2. EXPECTED from `monthlyAmount`, not a rate table

Outpatient has no tiered rate table: the monthly amount is typed straight into
the `סכום חודשי` form field and stored — under a legacy name — in the
`pricePerSession` column, which is exactly what `clientAmountDue()` already
reads. EXPECTED uses that figure.

Rather than multiplying it by a day count (which would pay 103% of a monthly
amount in a 31-day month), each projected cycle is treated as a coverage window
of its own and split by the same day-share arithmetic as a real payment. Summed
over a year that yields exactly 12 × the monthly amount.

Cycle dates come from the same anchor precedence `nextRenewalDueDate()` uses —
stored `nextBillingDate`, else `packageChangeDate`, else last `paymentDate`,
else `startDate` — re-clamped from the original anchor day each month, never
walked forward from the previous occurrence (which would migrate a 31st-of-month
cycle two days earlier for good).

Bounded by the client's lifecycle: never before `startDate`, never on/after
`exitDate`, and a cycle **straddling** a scheduled exit is clipped at it —
without shortening the denominator, so the daily rate is unchanged and ten days
cost ten days' worth. Inactive clients (`סיים טיפול`, `לא פעיל`) project
nothing, matching `clientsDueOn()`.

**Extra charges are not forecast.** A one-off is not contracted future revenue
and a recurring extra carries no commitment to recur. Once actually paid they
are ordinary cash and appear in RECEIVED like anything else.

The manual `סכום גבייה` override layer is honoured, injected as an
`amountDueFor` callback so the pure module never learns what a client record
looks like.

### 3. VAT: **display ex-VAT (÷1.18)** — this was checked, not assumed

The instruction was to match the Dashboard *only if* the stored outpatient
amounts are VAT-inclusive. **They are**, on the evidence of two shipped files:

- `public/treatment-map.js` — *"the client-facing price table (incl. VAT)"* and
  *"PRICES are client-facing, incl. VAT"*.
- `public/credits-ledger.js` — *"Payments.amountPaid is already the client-facing
  (VAT-inclusive) figure"*.

So dividing is correct and the view displays ex-VAT, matching
E-Zone-Dashboard's `VAT_RATE = 1.18`. Both claims are pinned by a test: if
either ever changes, that is where the ÷1.18 decision must be revisited.

This repo previously had **no** ex-VAT convention on the billing side (the only
pre-VAT figures anywhere are in the *therapist payout* view, which is money
going out, not client revenue). The division is therefore a deliberate new
convention for this view, adopted so a consolidated network total cannot be
silently wrong by 18% of whichever half was inclusive.

Every bucket carries **both** bases — `.inclVat` (the stored figure, untouched)
and `.exVat` — so nothing is lost and a consumer can never be in doubt which one
it holds. The UI prints only `.exVat` and says `כל הסכומים ללא מע״מ` in the
toolbar rather than leaving the basis to be guessed.

Ex-VAT is taken **per row** at 2dp and a bucket total is the sum of its rows'
ex-VAT values, not the inclusive total divided once. Dividing once is tidier
arithmetic but then a drill-down's rows do not add up to the total printed above
them, which reads as a bug to whoever checks it.

---

## Security (PR #106 parity)

- **No new endpoint; `server.js` is unchanged** — guard-tested, including that
  the word never appears in it. Every figure is derived in the browser from data
  already loaded for the other tabs.
- **Read-only.** The render path contains no `fetch`, `apiPost`, `saveAll` or
  `persistPayment` — asserted per function. Nothing is gated on the editor role
  because nothing can edit.
- The credits ledger loads through the **same** session-cookie-gated
  `/api/sheets` proxy and the same lazy `ensureCredits` loader the גבייה payout
  panel already uses. No new door.
- **Everything interpolated is escaped.** Every sheet-sourced field goes through
  `escapeHtml`; a test walks the string concatenations in each render helper and
  fails on an unescaped one.
- The pure module touches no `document`, `window`, `fetch`, `localStorage` or
  `state` — asserted against the source with comments stripped first.
- Junk input is refused rather than guessed at: an unusable month key returns
  `null`, and unreadable rows are skipped without taking the month down.

## Tests

New `test/monthly-revenue.test.js` — **39 tests**, requiring the shipped module
directly. Suite **944 → 983, all green.**

Covers: the split arithmetic and that halves sum to the whole; 28/29/30/31-day
months and both DST switches; paying three months late changing nothing; the
month key being ignored; one-time charges; RECEIVED/EXPECTED partitioning a
partly-paid cycle; the never-also-projected skip; the three EXPECTED kinds
either side of `today`; lifecycle bounds including a clipped mid-cycle exit;
`pricePerSession` as the monthly amount; the override callback; all four credit
paths including the `allocationMonth` fallback and `cancelled`; NET's sign; the
absence of any blended field; the VAT premise, divisor and per-row
reconciliation; the location breakdown and its `ללא סניף` bucket; the reuse and
purity guards; the daily view being untouched; and the security guards above.

Plus a **Playwright e2e** that drives the real tab against a stubbed server:
logs in, opens `הכנסות חודשיות`, and asserts January reads **₪2,542**
(₪3,000 ÷ 1.18) from two straddling cycles, that the drill-down shows
`12 מתוך 31 ימים` and `19 מתוך 31 ימים`, that February shows cash and forecast as
distinct figures, and that the daily גבייה screen still renders with its own
date state intact. It skips cleanly when no browser binary is available.

### One pre-existing test was loosened

`test/name-picker-conflicts.test.js` pinned the topbar at **exactly eight tabs**.
A ninth tab is not a regression in the name-picker UI, and an equality there
fails every future PR that adds one. It now asserts that each of the eight tabs
that PR owned is still present and that none was dropped — same intent, no false
failure. This is the discipline the neighbouring service-worker assertion in the
same file already uses (a floor, not a pin), and the one PR #106 applied to
`add-user-yarden.test.js` for the same reason.

`test/user-guide.test.js` gained the new guide section in its
`REQUIRED_SECTIONS` list, keeping the "in order, no extras" lock meaningful.

## Deploy

**No Apps Script redeploy needed** — no new action, no schema change, no new
sheet. It is a client-side view over data the app already loads.

`sw.js` cache `v6` → `v7` (index.html gained a script tag and a section, per the
house rule), so an installed app cannot serve the old shell alongside the new
`app.js`.

## Files

| file | change |
|---|---|
| `public/monthly-revenue.js` | **new** — the pure allocation module |
| `public/index.html` | new tab button, new `#view-revenue` section, script tag |
| `public/app.js` | `renderRevenue` + 4 helpers, state fields, view dispatch, 2 event handlers |
| `public/style.css` | the view's styles, appended |
| `public/sw.js` | cache `v6` → `v7` |
| `test/monthly-revenue.test.js` | **new** — 39 tests |
| `test/name-picker-conflicts.test.js` | tab-count pin → presence + floor |
| `test/user-guide.test.js` | new section registered |
| `docs/USER-GUIDE.he.md` | new `הכנסות חודשיות` section |

---

## Follow-up: the window can now be RECORDED (`CHANGELOG-payment-coverage-period.md`)

The coverage window this view allocates by is no longer always inferred from
`dueDate`. A payment row may now **record** the period it covered
(`coverageStart` / `coverageEnd`, appended columns), and
`CreditsLedger.paymentCoverage` prefers it. `coverageWindowFor()` therefore
receives the **whole row** instead of a `{ dueDate }` stub, and every revenue
row carries `coverageWindowSource` (`'recorded' | 'inferred' |
'one_time_due_date'`) and `coverageAdjusted` for the drill-down.

**The allocation arithmetic is untouched** — only where `[start, end]` comes
from. A blank pair (every historical row) reads as exactly the inference
described above, so no figure on this screen moved. The **one-off extra charge**
rule documented here is unchanged: a חיוב נוסף חד פעמי still covers its own due
day and is never spread across months.
