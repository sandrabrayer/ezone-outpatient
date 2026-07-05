# Patient-card: edit + renewal fixes and action consolidation

Two live patient-card bugs fixed, and the card's action buttons consolidated.
Frontend-only — **`apps-script/Code.gs` was NOT changed, so no Apps Script
redeploy is required.**

Reproduced end-to-end before fixing, using a stub `/api/sheets` backend + a
Playwright driver over the real `public/` files (the same stub-backend + browser
harness pattern used in the continuation session).

## Bug A — "עריכה doesn't save information"

**Symptom:** open a patient card → עריכה → change name / phone / monthly amount →
שמור, and nothing is saved.

**Root cause (verified):** prefill was fine. The edit submit handler ran
`duplicateClientBlock` on **both** the patient's own phone **and** the prefilled
`treatmentContactPhone`, and `findClientByPhone` matches against every other
client's `[phone, treatmentContactPhone]`. So the whole save aborted **before
`persist()`** whenever:

- the treatment-contact phone was shared with another patient — a parent who is
  the אחראי טיפול for siblings — or
- an **unchanged** prefilled phone happened to cross-collide with another row's
  contact phone.

A Hebrew "duplicate phone" toast flashed for a field the user never edited.
Direct-add only ever checked the patient's own phone, so edit was inconsistently
stricter.

**Fix (`public/app.js`, edit handler):**
- The `treatmentContactPhone` duplicate block is removed. Like `payerPhone`, the
  treatment contact is a **shareable** contact and must never block a save. Its
  format is still validated.
- The patient's own-phone duplicate block now only fires when the phone was
  **actually changed** (`recoverPhone(ptPhone) !== recoverPhone(client.phone)`),
  so an unchanged prefilled number can never abort an edit. Changing the phone to
  a number another client really owns is still blocked.
- The existing optimistic-save + rollback pattern (and the paid-date → base
  payment propagation) is unchanged.

## Bug B — renewal "error on enter/save"

**Symptom:** open חידוש ותשלום → enter values → save → an error, no save.

**Root cause (verified):** for a client with **no anchor date at all**
(`nextBillingDate`, `packageChangeDate`, `paymentDate`, `startDate` all blank),
`nextRenewalDueDate(c)` returns `''`, and the renew handler hard-failed with the
toast `"לא ניתן לחשב תאריך חידוש"` and never saved. Clients with any anchor
renewed fine.

**Fix (`public/app.js`, `openRenewModal` + renew submit):** the billed month is
resolved as `nextRenewalDueDate(c) || currentMonthBaseDueDate(c)`. The stored
anchor (the value the גבייה הבאה chip shows) still wins when present; only when it
is empty do we fall back to the current-month base due date. The modal now
**always shows the concrete billed month** so the user sees the date being paid —
no silent `today()+30`.

## Consolidation — three card actions

**`public/app.js` + `public/index.html` + `public/style.css`:**
- The editor card's primary actions are now exactly, in order:
  **עריכה | חידוש ותשלום | + הוסף טיפול**. The edit button label changed from
  `✏️ ערוך` to `עריכה`.
- The standalone **שינוי חבילה** button, its modal, and its submit handler are
  removed.
- The **חידוש ותשלום** modal absorbs the package change: the per-service weekly
  frequency host (prefilled from the current plan) is folded in. Editing it makes
  the same save also apply a package change — new frequency + a `packageChangeDate`
  re-anchor stamped to the payment date. Leaving it unchanged renews only.
  **One save = renewal fields + any package change.** The change-package logic is
  a single implementation reused via `readPackageSessionsFromForm` /
  `packageSessionsChanged` — it is not forked.
- A **שולם** quick action inside the modal marks the *current* month paid via the
  exact existing `setCurrentMonthPaid` path (optimistic + rollback). It is
  distinct from the renewal save, which pays the upcoming renewal month.
- Untouched, as required: the status select, סיים טיפול, the extra-charge paid/
  unpaid toggles, the billing tab, and the מסלול המשך tab.
- CSS is appended only, RTL-correct, with ≥40px touch targets on coarse pointers,
  matching the existing mobile/PWA rules.

## Invariants preserved

- `CLIENTS_HEADERS` is untouched (append-only, 33+ cols; guard tests still pass).
- Payment ids keep the `pay::<clientId>::base::<YYYY-MM>` / `chg-<chargeId>`
  scheme with read-side-only legacy fallback; the renewal/שולם paths reuse the
  existing `basePaymentPaidOn` / `setCurrentMonthPaid` builders — no row rewrites.
- `_writeAll` (clear-and-rewrite) and the optimistic-save + rollback pattern are
  unchanged. Stable keys + render-time Hebrew labels.

## Tests

`test/card-edit-renewal-fix.test.js` (13 tests, `node --test`):
- Bug A: pure mirror of the fixed phone gate (shared contact and unchanged
  prefills never block; a real changed-phone duplicate still blocks) + source
  guards that the handler gates on a changed patient phone and no longer blocks
  the contact phone.
- Bug B: pure mirror proving a no-anchor client now yields a concrete billed
  month while a stored anchor still wins + a source guard for the fallback.
- Phase C: guards that the card renders exactly the three action buttons in
  order, the שינוי חבילה button/modal/handler are gone, and the renew modal reuses
  the package helpers + the `setCurrentMonthPaid` path.

Modeled on the passing pure-mirror / source-scan patterns (merge-clients,
package-change, pwa, continuation-code), not the two env-dependent forwarding
tests.

**Full suite:** `393 pass, 2 fail`. The two failures — `debt-status-forwarding`
and `sheets-secret-forwarding` — are pre-existing and environmental (they boot
the Express server and fail with `Cannot find module 'express'` when
`node_modules` is absent); they are unrelated to this change.
