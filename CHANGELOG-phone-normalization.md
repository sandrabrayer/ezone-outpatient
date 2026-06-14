# Phone normalization, validation & leading-zero storage fix

**Date:** 2026-06-14

Enforces a canonical phone format on entry (normalize → validate, reject
invalid), fixes the Google Sheets leading-zero bug on storage and read, and
keeps wa.me WhatsApp links working — matching what the ezone-therapists app now
does. **No bulk data migration**: corrupted rows heal on read and persist
canonical on the next save.

## Canonical form

Leading-zero, no separators (e.g. `0501234567`). The 972 international form is
produced **only at wa.me link-build time**.

## Validation rule split

| Field | Validator | Rule |
|------|-----------|------|
| lead `phone` | mobile (strict) | exactly 10 digits, leading zero (`/^0\d{9}$/`) |
| client `phone` | mobile (strict) | same — inherited from the lead on activation |
| `treatmentContactPhone` | mobile (strict) | same — this is the cross-app matching key |
| `payerPhone` | Israeli phone (loose) | 9-digit landline **or** 10-digit mobile, leading zero (`/^0\d{8,9}$/`) |

`payerPhone` is intentionally looser because it is never used for cross-app
matching (debt / stop-treatment matching uses `treatmentContactPhone`), and a
payer is often an institution on a 9-digit landline (e.g. `031234567`). The
strict mobile fields must match the therapists app exactly.

## Behavior

- **Normalize then validate** at every entry point: strip spaces/dashes/parens,
  convert `+972` / `972` / `00972` to a leading `0`, then validate. Invalid →
  the save is rejected with a clear Hebrew toast naming the field. Empty is
  allowed only where the field is already optional (lead `phone` is required).
- A non-canonical number can never be stored.

## Changes

### `public/app.js`
- Split the old 972-only `normalizePhone` into:
  - `normalizePhone(raw)` → leading-zero canonical (store/compare),
  - `recoverPhone(raw)` → normalize + restore a Sheets-dropped leading zero (idempotent),
  - `isValidMobile` / `isValidPayerPhone` → the two validators,
  - `phoneToWa(phone)` → 972 form for wa.me,
  - `acceptPhone(raw, label, mode, required)` → entry guard (normalize, validate, Hebrew toast on reject).
- Entry points enforced: `#leadForm` (required mobile), `#directClientForm`
  (optional mobile), `#editClientForm` (`treatmentContactPhone` optional mobile,
  `payerPhone` optional Israeli-phone). The activate path inherits the
  already-canonical lead phone.
- `openWhatsApp` now uses `phoneToWa` — WhatsApp links keep working.
- Read-side recovery applied to `phone` / `treatmentContactPhone` / `payerPhone`
  in `normalizeLeadFromSheet` / `normalizeClientFromSheet`.
- The duplicate-lead check keeps using `normalizePhone` (now canonical on both
  sides of the comparison).

### `apps-script/Code.gs`
- `PHONE_COLUMNS` = `{ phone, treatmentContactPhone, payerPhone }`.
- `_formatPhoneColumns` forces `@` (plain-text) format on phone columns; called
  from `_ensureSheet` (both new-sheet and existing-sheet paths).
- `_writeAll` sets `@` text format on phone columns **before** `setValues`, so
  leading zeros survive.
- `_readAll` runs phone columns through `_recoverPhone` (mirror of the JS
  `recoverPhone`), so all consumers — including the therapists app via
  `_getDebtStatus` / `_getTreatmentPlans` — receive healed numbers.

### Tests
- `test/phone.test.js` — normalize / recover (incl. 972-form and dropped-zero) /
  validate, plus the key case: a 9-digit landline is accepted for `payerPhone`
  but rejected for the mobile-only fields.

## Deployment

⚠️ **Apps Script must be redeployed** for the storage/read fix to take effect:
in the Apps Script editor, **Deploy → Manage deployments → ✏️ (pencil) → Version:
New version → Deploy**. To verify in DevTools after redeploy, inspect the
`getData` response (Network tab) and confirm `clients[].treatmentContactPhone` /
`payerPhone` and `leads[].phone` come back with their leading zero (10-digit
mobiles; 9-digit landlines for payer).

## Not migrated

No bulk rewrite of existing rows. Corrupted rows are recovered on read and
written back in canonical form on the next save into the now-text-formatted
columns, healing permanently over time.
