# OP-BILL-01 — paid-through read model, code draft

This branch is **stacked on the test+diagnosis PR #153** and is a separate DRAFT implementation, not a financial source migration.

## User-observable fix (read only)
Previously, the patient card's green `שולם עד` badge used `Clients.nextBillingDate`, and the `גבייה הבאה` line displayed the same date. That anchor is the **scheduled cycle date**, not necessarily the last inclusive day a receipt covers. This was especially misleading when a monthly payment was paid on the 15th while the old cycle was scheduled for the 23rd.

`CreditsLedger.paidThroughReview(client,payments,today)` now:
- reads **only paid base receipts for the exact clientId**, ignoring extras, unpaid/partial rows and other patients; never joins on names or telephone;
- accepts explicit custom `coverageStart/coverageEnd` when truly different from the old auto-inferred due-date window; also accepts a window matching a **verified paymentDate** exactly;
- recognizes an old stored default that differs from the actual payment date as **ambiguous** (the old writer auto-stamped due-cycle periods, so it is impossible to tell an explicit advance from a default) and gives the one-month-from-paid-date candidate **labelled for review**, not as confirmed cash;
- merges valid contiguous paid periods, not missing/gap periods, detects exact duplicate coverage, refuses future/missing receipt dates and incomplete amounts, and checks that `Clients.nextBillingDate` equals the **first day after verified coverage**;
- never overwrites source data or creates any task, bill, payment or scheduled job.

`public/app.js` reuses this pure projection. Where a verified receipt agrees with the stored next-date, `שולם עד` now shows **inclusive coverage end**; `גבייה הבאה` shows the following day. Where they conflict or the old automatic period is ambiguous, the card shows an amber warning and both the proposed next date and the stored source date, each clearly labeled. No destructive month-paid toggle is offered in these discrepancy states (the original billing editor still exists and remains the authoritative editor).

## Exact synthetic examples
| Example | Paid on | Old cycle next | Expected for one normal month | Current diagnostic behavior |
|---|---|---|---|---|
| A | 2026-10-25 | 2027-01-01 | through 2026-11-24 / next 2026-11-25 | Review, until the whole payment history confirms no prepayment |
| B | 2026-10-15 | 2026-11-23 | through 2026-11-14 / next 2026-11-15 | Review; old due-cycle default cannot be proven user-selected |
| Explicit 2-month advance | 2026-10-25 | 2027-01-01 | recorded 2026-11-01 through 2026-12-31 | Confirmed, next 2027-01-01 |
| Verified monthly window | 2026-10-15 | 2026-11-15 | 2026-10-15 through 2026-11-14 | Confirmed, next 2026-11-15 |

## Still open — NOT represented as fixed
A consistent **source financial write-policy change** must be separately prepared and approved: `_finNext` in Code.gs and multiple billing write paths still anchor renewals on the prior due day; `withDefaultCoverage` defaults to dueDate and old source records may have auto-stamped it. Card overlay does not change the next **actual** renewal date used by the backend, the collection schedule, or monthly revenue allocation/credits for historic rows. Those must be reconciled with a reviewed migration/compatibility plan and a guarded real-source staging test before any source release.

The read model itself is a **safety and display correction**, not a promise that screenshots show a single payment. Never automatically rewrite historic rows; check the exact paid rows read-only with an authorized user before data repair.

## Validation and release
`test/op-bill01-paid-through-review.test.js` covers the same contract with synthetic rows including multi-cycle, duplicate, gap, missing source, wrong amount, date rollover and no mutation; PR #153 provides prior contract tests and one explicit deferred integration TODO. Full CI and browser checks must pass on the exact stacked head, including a regression check that no sign-in or finance source code changed.

**No merge, deploy, edit to production data, payment-source/ledger migration or permission change without Sandra's separate explicit approval.** There is an existing OUTPATIENT CRM stacked chain #142–148 and OP03 backup #139/#140; resolve release order and service worker version collision (v22 on CRM) before production.
