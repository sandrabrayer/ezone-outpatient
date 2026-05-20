# Changelog — Outpatient edit-form UX (house_of_origin + notes)

Adds two fields to the edit-client form (`editClientForm`) so existing
patients can be retroactively tagged with their source house and
freeform notes, without requiring them to be re-entered from scratch.

## [Unreleased]

### Why this exists

The OUTPATIENTS app already supports `house_of_origin` and `notes` in:
- The data schema (`CLIENTS_HEADERS`, `LEADS_HEADERS`)
- The new-lead form (`leadForm`)
- The direct-add-client form (`directClientForm`)
- The lead→client activation path (carries `house_of_origin` from lead)

But there was **no way to edit those fields on an existing client**. So
patients entered before these fields were required (or via paths that
didn't fill them in) have empty `house_of_origin` in the sheet — and
there was no UI to fix it. This directly caused the
outpatient-continuation bonus pipeline to correctly return ₪0 for every
house, since the bonus reads `house_of_origin` to attribute managers.

This change closes the gap with the minimal possible UI addition.

### Added (public/index.html)

A new "פרטים נוספים" section in `editClientForm` containing:

- **`בית מוצא`** (`house_of_origin`) — dropdown with the same 5 options
  used everywhere else (`raanana`/`ramot`/`efroni`/`rehab`/`external` +
  empty). **Optional** here (unlike the required version on new leads),
  because we're editing pre-existing records where the value may
  legitimately not be known.
- **`הערות`** (`notes`) — freeform textarea, e.g. for recording reasons
  like "פנינו אליו והוא לא מעוניין" or any operational context.

### Changed (public/app.js)

- `openEditClientModal()`: populates the two new fields from
  `client.house_of_origin` and `client.notes` on open (defensively
  checks the controls exist so this is safe even if the HTML hasn't
  shipped yet on a given environment).
- The submit handler: saves both fields, including the `prev` snapshot
  used for revert-on-failure. Uses `fd.has(...)` rather than the
  `if (value)` pattern most other fields use, so the user can
  intentionally CLEAR a wrongly-set value (correction is a valid
  operation for these fields).

### Not changed

- The `Leads` form already has both fields; not touched.
- The `directClientForm` already has both fields; not touched.
- The lead "not relevant" workflow already exists in code
  (`stage === 'not_relevant'`); the operational UI for marking that may
  warrant a separate UX pass but is out of scope here.
- Schema (`CLIENTS_HEADERS`) already includes `house_of_origin` and
  `notes`; no migration needed (Sheet columns already exist).
- No bonus-side code changed (this is a separate branch from the
  bonus PR).

### Manual test checklist (for live verification after deploy)

`app.js` runs only in the browser and has no DOM test harness in this
repo, so verification is manual:

1. Open OUTPATIENTS app → Clients tab → click ✏️ ערוך on a patient who
   currently has an empty `בית מוצא`.
2. The "פרטים נוספים" section is visible with two empty controls.
3. Select a house (e.g. `רעננה אשר`), type a note, click שמור.
4. Reopen the same patient: both values are pre-filled.
5. Change the house, clear the note, save again, reopen: values
   updated, note empty.
6. (Bonus integration) Once a handful of patients have `house_of_origin`
   set, re-run `scripts/bonus-preview.js`: amounts > ₪0 should appear
   for the relevant houses.

### Safety

- Existing fields untouched: payment, payer, treatment plan, sessions
  per week are not modified by this change.
- All other field-save logic (the `if (value)` guards on `paymentStatus`,
  `paymentDate`, `monthlyAmount`, etc.) is preserved — empty values for
  those still do not overwrite existing data.
- `app.js` syntax validated with `node -c`. Existing test suite still
  passes (7 pass, 1 pre-existing unrelated failure in
  `sheets-secret-forwarding`).
- No new dependencies.
