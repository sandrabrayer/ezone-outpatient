# OP-BILL-01 — acceptance of the payment-date monthly period, without changing live finance

**Status: diagnosis / acceptance Draft. NOT a runtime fix and NOT permission to release.** Source issue [#152](https://github.com/sandrabrayer/ezone-outpatient/issues/152). Verified against deployed `a487a3a8`, 2026-11-01. User supplied screenshots in chat; no names, phone numbers, patient ids or real finance rows copied to repo.

## The two DIFFERENT dates
- **שולם ב:** actual historical receipt's `paymentDate`.
- **שולם עד:** last covered calendar date *inclusive*, from recorded coverage (NOT the next invoice date).
- **גבייה הבאה:** first day after paid coverage **when a new standard monthly payment is actually due**. If another verified advance payment covers it, calculate against the latest contiguous covered window; a gap or conflict needs review.
- **One normal monthly payment:** default `paymentDate` through `paymentDate + 1 calendar month - 1 day`. 25 Oct → through 24 Nov, next collection 25 Nov; 15 Oct → through 14 Nov, next collection 15 Nov. These are synthetic expected outputs unless the payment records establish a different period.

## Why a quick frontend fix would be unsafe
The current app explicitly chooses the due-date-anchored `nextCycleDueDateAfter` in both `app.js` and `charges-logic.js`. `apps-script/Code.gs:_finIntentError` rejects a renewal whose next date does not match `_finNext(c,cycleDate)`. `credits-ledger:inferredCoverage` defaults to **dueDate**; money allocated to months and refund suggestions use this coverage. Changing only the patient card or shifting the stored `Clients.nextBillingDate` can create false future paid status, unexpected refunds or reconcile failures.

`Payments.coverageStart / coverageEnd` are already appended and authoritative when set. Do **not** add another store, backfill historical rows silently, change a payable period on a receipt or assume `paymentDate` always proves which month of *treatment* was purchased.

## Test-only acceptance branch
`test/op-bill-01-payment-date-policy.test.js` checks the intended month arithmetic **by invoking existing `CL.inferredCoverage` with a proposed paid-date anchor** and confirms that existing `CL.paymentCoverage` / `CH.packagePaidState` still implement the **old behavior**. This documents the gap without falsely claiming it is fixed. A `test.todo` explicitly marks full source/UI integration as outstanding.

## Required next implementation (separate scope + review)
1. Define how an advance paid before treatment starts, a late payment for an earlier month, partial settlement and multiple consecutive paid months are represented; existing **recorded coverage always overrides an assumed month**.
2. Identify the exact paid row or rows behind the cards without patient-name matching and inspect any `coverageStart/coverageEnd` values **read-only**. Confirm whether a displayed future `nextBillingDate` is justified by multiple payments (not visible in the provided screenshot).
3. Reuse the existing coverage ledger for one next-collection projection and the `nextBillingDate` persisted contract, with append-only migrations only if unavoidable and explicitly authorized. Provide explicit unresolved/partial state on conflicting rows.
4. Full synthetic regressions for records with old due-date contracts, prepayment, early/late payment, year/leap boundaries, refunds, month allocation, stop alerts, double-click/retry, and source guards. Avoid changes to outpatient CRM #142–148, OP-03 #139/#140 or HC-01 #151 branches.
5. NO production merge, Apps Script deploy, live read/write, history repair, financial calculation migration or permissions change without Sandra's **separate approval**.

## Ownership
Outpatient period logic — E-ZONE One architecture coordinator; Dashboard Code is independently investigating Vered's historical collection-save bug. These are separate repos and must not be collapsed into one unreviewed PR.
