# CHANGELOG — Planned exit date (`plannedExitDate`)

## Summary
`getTreatmentPlans` now returns an optional `plannedExitDate` for each client:
the **planned** discharge date (`'yyyy-MM-dd'`) of an **active** client, `''`
when there is none. The E-Zone Therapists app can show when an active
outpatient is expected to finish treatment.

## Why a new column
There was no planned-discharge / exit-plan field. `exitDate` is the **actual**
discharge date, stamped by the סיים טיפול exit modal, and is blank for every
active client. Re-using it would mark the client as discharged, so a separate
column was added.

## Change
- **Schema (append-only).** `CLIENTS_HEADERS` gains `plannedExitDate` at the
  very end (position 37, after `updatedAt`/`updatedBy`). `CLIENTS_REMOVED_HEADERS`
  mirrors it at its own end, so a tombstoned row keeps it and
  `restoreRemovedClient` copies it back. No migration: old rows read blank.
- **Projection.** `_getTreatmentPlans` adds
  `plannedExitDate: _isActiveClientStatus(cl.status) ? _isoDateOrBlank(cl.plannedExitDate) : ''`.
  A blank status counts as פעיל (the dashboard default). Discharged, frozen or
  other non-active clients always get `''`; their `exitDate` is unchanged.
  **No existing key changed.** No billing/payer data added.
- **Save validation.** `_saveAll` stores only a real `yyyy-MM-dd` calendar date
  (`_isoDateOrBlank`). Anything else, including formula-like text, is stored as
  blank. If a payload has **no** `plannedExitDate` key (a tab still running the
  old `app.js`), the save keeps the value already in the sheet. This means an
  old client can never clear the date, and the row is not re-stamped. A key
  sent as `''` clears the date on purpose.
- **UI.** The edit-client modal (ערוך פרטי טיפול → תוכנית טיפול) has a
  «תאריך סיום מתוכנן» date input. It is prefilled, can be set or cleared, and
  rolls back if the save fails. The card's תוכנית טיפול panel shows
  «סיום מתוכנן DD/MM/YYYY» only when a date is set.
- **SW** `ezone-outpatient-v9` → `v10` (index.html + app.js change together).

## Security
- The endpoint keeps its fail-closed `TREATMENT_PLANS_SECRET` gate (tested).
- Input is validated on the server, which is the trust boundary; the client-side
  check is only a convenience. The card output is HTML-escaped.
- No secrets, no new dependencies. `npm audit`: 0 high / 0 critical
  (1 moderate `qs` advisory via express, which was already present and is not
  affected by this change).

## Tests
- New `test/planned-exit-date.test.js` runs the real `Code.gs` in the sandbox.
  It covers the schema tail, active/blank/none/non-active/invalid/Date-cell
  projection, the exact full key set, auth, save set/clear/invalid, back-compat
  for a missing key with no re-stamp, stamping on change, the validator, and
  UI wiring.
- The `test/treatment-plans.test.js` mirror is updated, and the header-tail
  guards across the suite now expect the 37-column tail.
- Full suite: `npm test` → 1426 pass, 0 fail.

## Deploy
Node (Railway) first, then the explicit **Deploy Apps Script** dispatch on
`claude/youthful-volta-laarnk` with `expected_commit` = the merge SHA
(`apps-script/Code.gs` changed). Until the Apps Script deploy runs, the new
field is just ignored by the old script.
