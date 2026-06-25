# משוייך ל (Lead Assignee)

Adds a required **משוייך ל** (assigned-to) field on leads, recording which staff
member a lead belongs to. Other staff besides Vered now enter leads, so each
lead records its assignee — and that assignee follows the person when the lead
converts to a patient.

## What changed

### UI
- New required **משוייך ל** dropdown in the ליד חדש / edit-lead modal
  (`#leadForm`), placed right after the תאריך יצירה (created) field. Options:
  **ורד / שירן / יעל**.
- Required on new leads (blocked with a toast — `יש לבחור למי הליד משוייך` —
  matching the existing explicit-validation pattern). When **editing** a
  historical lead that has no assignee, the field is relaxed (not forced),
  mirroring how `house_of_origin` is handled, so old leads aren't blocked on edit.
- Displayed as a **משוייך: <name>** chip on **both** the lead card and the
  patient (client) card, alongside the existing chips.

### Conversion (lead → patient)
- In the activate flow, the new client copies `assignedTo` from the originating
  lead (next to `fromLead: lead.id`), so the assignee follows the person.

### Frontend carry-through (`public/app.js`)
- `normalizeLeadFromSheet` + `leadForSheet` — carry `assignedTo`.
- `normalizeClientFromSheet` + `clientForSheet` — carry `assignedTo`.
- `readLeadFormFields` / `addLeadFromForm` / `updateLeadFromForm` / `openLeadModal`
  — read, persist, and populate `assignedTo`.

### Schema (Google Sheets / Apps Script) — positional, append-only
- `assignedTo` appended at the **very END** of each of the three positional
  header arrays in `apps-script/Code.gs`:
  - `LEADS_HEADERS` (after `not_relevant_note`)
  - `REMOVED_LEADS_HEADERS` (after `originSheet`)
  - `CLIENTS_HEADERS` (after `packageChangeDate`)
- `_readAll`/`_writeAll` map by position and `_ensureSheet` does not migrate, so
  the column may only be appended — never inserted mid-array. Old rows read back
  a blank `assignedTo`.

### Tests
- `test/lead-assignee.test.js` — new: asserts `assignedTo` is the last column of
  all three header arrays and round-trips positionally (lead + client) without
  misaligning earlier columns; legacy row reads back blank. Follows the existing
  parse-`Code.gs` positional pattern.
- Schema-guard tests updated for the new last `CLIENTS_HEADERS` column
  (`clinical-derive`, `responsible-removal`, `session-credits`, `stop-flag-match`):
  `assignedTo` is now last; `packageChangeDate`/`creditsOwed` shift back one.

## Deploy note

⚠️ **Apps Script redeploy required.** The `apps-script/Code.gs` change (three
new `assignedTo` headers) only takes effect after a redeploy: Apps Script
project → Deploy → Manage deployments → pencil (edit) → **New version** → Deploy.
Edit the **existing** deployment so the `/exec` URL stays stable. Frontend files
(`public/*`) auto-deploy via Railway.
