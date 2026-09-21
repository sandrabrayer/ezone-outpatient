# תקופת כיסוי — record what a payment covered, instead of assuming it

Port of **E-Zone-Dashboard PR #135** to the outpatient app, with the
outpatient-specific cases handled rather than copied.

---

## The problem

A payment's coverage period was **inferred**: the row's `dueDate` plus "one
month paid in advance" (`[dueDate, dueDate + 1 month − 1 day]`). Nothing on the
row recorded whether that was true.

When the assumption was wrong — a client paid for six weeks, or for a period
that started later, or two months at once — the money landed in the wrong month
on **הכנסות חודשיות**, the refund was computed against the wrong window in the
**credits ledger**, and **no screen could say so**. The figure looked exactly as
confident as a correct one.

`paymentDate` could not fix this: it records **when the cash arrived**, which is
a different fact and deliberately plays no part in allocation (see
`CHANGELOG-monthly-revenue.md`). What was missing was **what the money bought**.

---

## What changed

### 1. The period is recorded on the row

`coverageStart` / `coverageEnd` are **appended** to `PAYMENTS_HEADERS`
(positions 14–15), as plain `'YYYY-MM-DD'` **text**.

* **Append-only**: `_readAll` maps by **position**, so inserting or reordering a
  column would silently re-read every historical row against the wrong field.
  New columns go at the end. Guard-tested (`F:` the exact header list).
* **Text-forced** (`PAYMENT_TEXT_COLUMNS`, applied by `_ensurePaymentsSheet` to
  the whole column and by `_forcePaymentTextCells` to the row being written): a
  date-**typed** cell reads back as a `Date`, serializes as a UTC timestamp and
  drifts the day **−1** in Israel — the `exitDate` bug class, and here it would
  move money between months.
* **Defaulted to the cycle that was previously inferred**, stamped on the one
  write path, so the normal case is unchanged and costs zero clicks.
* **Editable** at entry (on any persisted row) and on existing rows, **paid rows
  included** — a payment already taken is exactly the one whose period must be
  correctable, because that is the row the revenue screen allocates.

### 2. Nothing is backfilled

A **blank pair is legal** and is what every pre-existing row carries. It reads
as the inference that was already in force, **derived on read**. No historical
row is ever rewritten, and no existing figure on any screen moves. Only a
**deliberately edited** period moves money — and where it does, the row says so
(a **מותאמת** badge, and `coverageAdjusted` on the revenue row).

### 3. One primitive, extended — not a second path

`CreditsLedger.paymentCoverage()` in `public/credits-ledger.js` remains **the
one answer** to "what period does this payment pay for". It now prefers the
**recorded** period and infers when there is none, returning
`{ start, end, source }` with `source` = `'recorded' | 'inferred'`.

Both consumers read it:

| Consumer | Reads |
| --- | --- |
| Credits ledger (`suggestCredits`) | `paymentCoverage(r)` — the **whole row**, so the recorded period survives the row copy |
| הכנסות חודשיות (`buildMonthlyRevenue`) | `coverageWindowFor(p)` — the **whole row**; the projected-cycle pass keeps its `{ dueDate }` stub, because a cycle with no payment row has nothing recorded to honour |
| The גבייה row | `rowCoverageWindow(payment)` → the same two functions |

The **no-fork guard** (`test/monthly-revenue.test.js`, section H) was widened to
pin all of it: the inference exists exactly once, `app.js` defines none of
`paymentCoverage` / `inferredCoverage` / `recordedCoverage` / `coverageDateISO`
/ `coveragePeriodError` / `coverageDiffersFromDefault` / `withDefaultCoverage` /
`splitByMonth` / `paymentMonthSplit` / `allocate`, the ledger and the view hand
over whole rows, and the row's split equals the view's allocation month for
month.

**No arithmetic changed.** Not the credits calculation, not the monthly view's
allocation. Only where `[start, end]` comes from.

### 4. The split is shown on the payment row

Under the period, the גבייה row now prints the automatic split by calendar
month, using the **same `allocate()`** the monthly view uses:

```
תקופת כיסוי   06/09/2026 – 05/10/2026   [מותאמת] ✏️ ↩
פיצול לפי חודשים   ספטמבר · 25 ימים · ₪2,500     אוקטובר · 5 ימים · ₪500 [נדחה]
```

* **Dates in the app's people-facing format** (`displayDate`, `DD/MM/YYYY`) —
  ISO is storage only.
* **Denominator is the window's own length** (30 days above), never the calendar
  month's.
* **VAT-inclusive**, matching the amount printed beside it on the row.
  (הכנסות חודשיות is the one screen that divides by VAT, and it says so.)
* **A period inside one month shows that month only.**
* **The later month reads as deferred** — muted, tagged נדחה: the money is
  collected now and earned then.
* **Live while editing**: the split follows the two date inputs as they are
  typed, and an impossible period shows the refusal reason instead of a window.
* **Rounding sums exactly to the payment.** Each month carries both
  `allocated` (exactly what the monthly view reports for that month) and
  `amount` (the displayed figure). Independently rounded shares can leave
  ±₪0.01 unaccounted for — ₪100 over three equal months is 33.33 × 3 = 99.99 —
  so the residual is parked on the **longest** month. Both figures are returned
  so neither truth is hidden: `allocated` reconciles with the revenue screen,
  `amount` reconciles with the row.

---

## Outpatient-specific decisions

### חיובים נוספים חד פעמיים — an extra charge is NOT given a period

`public/monthly-revenue.js` already had a special case (#109): a **one-off**
charge (`billingType === 'one_time'`, id shape `pay::<clientId>::chg-<id>::once`)
covers the **single day it falls due**, because spreading a one-day session
charge over 30 days would post most of it into the **following** month.

**That behaviour is unchanged, and this is exactly how an extra charge is
allocated:**

| Kind | Window | Allocation |
| --- | --- | --- |
| Base monthly package | recorded period, else `[dueDate, dueDate + 1 month − 1 day]` | split across the months the window touches |
| **Extra charge, חד פעמי** | **`[dueDate, dueDate]`** — its own day | **whole amount to the due date's month; never split** |
| Extra charge, monthly (recurring) | like a package cycle | split like a package cycle |

Enforced in three places, all tested:

1. **Never stamped** — `withDefaultCoverage()` returns a one-off row untouched,
   so it keeps a blank pair. (Stamping even its single day would change what the
   **credits ledger** reads for that row today; blank keeps both readers exactly
   where they are.)
2. **Never editable** — the גבייה row shows a **חד פעמי** badge and no pencil:
   there is no period to decide.
3. **Never honoured if hand-written** — `coverageWindowFor()` narrows a one-off
   to its due day whatever a pair on the row might say, and the server **drops**
   a pair posted on such a row (the row itself is fine; only the period is
   meaningless, so it is cleared rather than refused).

**Conservative choice, flagged:** the one-off narrowing stays where #109 put it,
in the revenue view, and is **not** pushed down into `paymentCoverage()`. Moving
it would change the credits ledger's window for every existing one-off charge
row — a figure on a screen in use. This port does not move figures.

### `paymentDate` is still the cash date

`paymentDate` exists here and already meant "when the money arrived". It is
**not** allocation and was not touched. Coverage decides months; `paymentDate`
is carried into the revenue drill-down for transparency only.

### The default period comes from the billing cycle the code already used

Confirmed against the code, not assumed: the inferred window is
`[dueDate, dueDate + 1 month − 1 day]` with the day-of-month **clamped**
(Jan 31 + 1 month → Feb 28/29), which is what `credits-ledger.js` has always
computed and what #109 reuses. The row's `dueDate` is itself produced from the
client's cycle anchor (`nextBillingDate` → `packageChangeDate` → `paymentDate` →
`startDate`, and `billingDay` server-side in `_nextCycleDueDate`). The default
is therefore **exactly the cycle that was being inferred before** — stamping it
moves no figure, which is guard-tested.

---

## Validation

One rule, stated twice, pinned together by a **441-pair parity sweep**
(`test/payment-coverage-period.test.js`) that runs the client function and the
real `Code.gs` function over the same 21 × 21 values and asserts identical
messages.

**Refused** (a period that cannot be true of one row):

| Case | Message |
| --- | --- |
| half-filled pair | `יש למלא גם תאריך התחלה וגם תאריך סיום לתקופת הכיסוי` |
| malformed / non-existent day (`2026-02-30`, `2026-13-01`, `2026-1-5`, `06/09/2026`) | `תאריך לא תקין בתקופת הכיסוי` |
| end before start | `תאריך הסיום מוקדם מתאריך ההתחלה` |
| longer than 366 days | `תקופת כיסוי ארוכה מדי (N ימים, המקסימום 366)` |

**Deliberately NOT refused:** a blank pair (it means "infer"), and **overlaps or
gaps between rows** — two months paid at once, a skipped month and a re-dated
cycle are all real, and `suggestCredits` already de-duplicates overlapping days
(`creditedThrough`). Refusing an overlap would force the recorder to lie about
what the money bought.

---

## Security (PR #106 parity)

* **Server-side validation is the authority.** `_coveragePeriodError()` runs in
  `_upsertPayment` **before the lock is taken and before a single cell is
  written**, so a bad period is refused outright rather than half-written. The
  client mirrors the rule only to spare a round-trip.
* **The reason is surfaced, never swallowed.** The server returns
  `{ ok:false, error:<Hebrew reason> }`; `apiPostAction` throws it,
  `persistPayment` throws its own pre-flight refusal the same way, and
  `saveBillingRow` rolls the optimistic write back and shows
  `שמירה נכשלה: <reason>`.
* **No new endpoint.** `savePayment` is still the one payment write action, it
  still rides the session-cookie-gated `/api/sheets` proxy, and **`server.js` is
  unchanged** (guard-tested).
* **Nothing is coerced.** `_coverageDateISO` / `coverageDateISO` accept three
  shapes only (a bare ISO date naming a real day, a full ISO timestamp, a `Date`
  cell — both read through **local/spreadsheet** parts, never
  `toISOString().slice()`), and refuse everything else instead of handing it to
  `new Date()`, whose tolerance is engine-dependent.
* **Everything rendered is escaped** (`escapeHtml`), including the Hebrew
  refusal reason shown under the row.
* **Stored normalized.** Any accepted shape lands as bare `'YYYY-MM-DD'` text,
  so every reader sees the same thing.

---

## Files

| File | Change |
| --- | --- |
| `public/credits-ledger.js` | the extended primitive: `coverageDateISO`, `coveragePeriodError`, `inferredCoverage`, `recordedCoverage`, `paymentCoverage` (+`source`), `coverageDiffersFromDefault`, `withDefaultCoverage`, `isOneTimePayment`, `COVERAGE_MAX_DAYS` |
| `public/monthly-revenue.js` | `coverageWindowFor` reads the whole row; new `splitByMonth` / `paymentMonthSplit`; rows report `coverageWindowSource` / `coverageAdjusted` |
| `public/app.js` | reads/writes the two columns, one coverage-resolution rule (`paymentWithCoverage`), the תקופת כיסוי cell, the month-split strip, the editor + live preview, `saveCoveragePeriod` |
| `public/style.css` | the coverage cell, the split strip, the deferred styling; the גבייה grid grows to 8 columns |
| `apps-script/Code.gs` | appended columns, `_ensurePaymentsSheet`, `_forcePaymentTextCells`, `_isRealCalendarDate`, `_coverageDateISO`, `_coveragePeriodError`, validation in `_upsertPayment` |
| `test/payment-coverage-period.test.js` | **new** — 50 tests |
| `test/monthly-revenue.test.js` | the widened no-fork guard + the row/view agreement test |
| `test/card-money-panel-fixes.test.js` | the pinned `persistPayment` shape now allows the pre-flight refusal, and asserts it is still the single write path |

**Tests: 1,059 passing** (`npm test`), up from 1,007.

---

## Deploy note

`apps-script/Code.gs` changed, so the Apps Script backend must deploy (CI does
this on push to the configured branch — see `DEPLOY.md`). The two columns are
added to the `Payments` sheet automatically on the next `_ensurePaymentsSheet`
call; **no migration and no backfill** — existing rows keep blank cells and read
exactly as they did before.
