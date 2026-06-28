# Billing fixes round 2 — paid-date round-trip, legacy renewal anchor, renew modal, field removal

Four changes, one commit per logical fix (smallest/safest first). Builds on the
PR #48 work (editable billing-row paid-date + nextBillingDate persistence). All
frontend-only — **no Apps Script redeploy required** (the `notes` column already
exists in `PAYMENTS_HEADERS`, and no header arrays change).

---

## Field removal — שם אחראי טיפול + טלפון אחראי טיפול (conservative)

`responsiblePerson` ("שם אחראי טיפול") and `treatmentContactPhone`
("טלפון אחראי טיפול") are no longer collected.

- Removed: edit-modal section + both inputs (`index.html`), their form population
  (`openEditClientModal`), the `required` validation, and the card
  `responsiblePerson` chip (`renderClients`). The treatment-scope chip stays.
- **Conservative — data + matching preserved.** `treatmentContactPhone` is NOT
  unused: it is a patient-identity matching key for stop-flag matching
  (`Code.gs _matchStopFlagClient`, `resolveStopFlagClient`), debt matching
  (`debt-status.js`), and duplicate-patient dedup (`clientIdentityPhones`). The
  `CLIENTS_HEADERS` columns are kept (positional schema, left dormant) and
  `clientForSheet`/`normalizeClientFromSheet` keep passing existing values
  through, so matching on existing data is untouched.
- The edit-modal duplicate block now keys on the patient's own `phone` instead of
  the removed treatment-contact field.

## Bug A — backdated paid-date now round-trips to the chip

The card `שולם ב` chip reads the per-month base **payment row**'s `paymentDate`.
The edit modal's "תאריך תשלום אחרון" only wrote `client.paymentDate` (which drives
`גבייה הבאה`), so a backdate entered there never reached the payment row — the
chip kept showing today while `גבייה הבאה` moved.

Fix: when the edit modal commits a **changed** paid-date with status=paid, upsert
the current-month base payment row's `paymentDate` via the single `persistPayment`
path (new shared `basePaymentPaidOn` builder, mirrored in `app.js` +
`charges-logic.js`). Guarded on `paidDateChanged` so unrelated edits don't
overwrite an existing paid row; existing `notes`/`method` are preserved.

> Note: the billing-row date input from PR #48 already round-trips correctly;
> this fix closes the *edit-modal* entry point, which was the reported path.

## Bug B — renewal banner anchor for legacy clients

Clients saved before the `nextBillingDate` column load with it blank, so
`renewalInfo` fell back to `startDate` (banner counted from תחילת טיפול) — and
showed on some cards but not others depending on whether the field happened to be
populated.

Fix: `deriveNextBillingDates()` runs on load (after payments are fetched) and
reconstructs a blank `nextBillingDate` from the client's latest **paid base**
payment row (`paymentDate` else `dueDate`, + 30 days) — the same
`addDays(anchor, 30)` formula used elsewhere. Populated values are never
overwritten; no manual re-save needed.

## Bug C — חידוש ותשלום modal: paid-date + notes

The renew modal was money-only and hardcoded `paymentDate: today()`.

- Added an editable date (default today, backdatable) and a free-text notes
  field. The date feeds the **same** paid-date path as Bug A (shared
  `basePaymentPaidOn`), and `notes` persists to the payment row.
- The renewal **re-anchors** `nextBillingDate = addDays(paidDate, 30)` (and sets
  `client.paymentDate = paidDate`), so the alert/`גבייה הבאה` advance off the
  date actually entered rather than today.
- `notes` already exists in `PAYMENTS_HEADERS` → **no schema change, no
  redeploy**.

---

## Tests

`test/charges.test.js` (pure module):
- **Bug A:** `basePaymentPaidOn` stamps the explicit paid date (not today) and
  keys the row by due-month (idempotent backdate edits).
- **Bug B:** `deriveNextBillingDate` = latest paid base `paymentDate` + 30;
  never overwrites a populated value; ignores unpaid/extra/other-client rows;
  falls back to `dueDate`; parity with the chip's `addDays(anchor, 30)`.
- **Bug C:** renew payment carries the modal paid-date + notes keyed to the
  renewal month; re-anchor is `addDays(paidDate, 30)` and backdate-sensitive.

Pre-existing `test/sheets-secret-forwarding.test.js` (EADDRINUSE) and
`test/debt-status-forwarding.test.js` (`express` not installed) are environmental
and unrelated.

## Files touched

- `public/index.html` — edit-modal field removal; renew-modal date + notes.
- `public/app.js` — field removal (modal/handler/card), `basePaymentPaidOn`,
  Bug A propagation, `deriveNextBillingDates`, renew handler.
- `public/charges-logic.js` — `basePaymentPaidOn`, `addDays`,
  `deriveNextBillingDate` (pure mirrors).
- `test/charges.test.js` — Bug A/B/C tests.
