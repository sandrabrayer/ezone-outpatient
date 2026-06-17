# Clinical-treatment-type receiver (task 4.5a)

The **receiver** half of the clinical→billing pipeline: outpatient now accepts a
`clinicalTreatmentType` per client and **derives `serviceType` from it on save**.
This is the data + derive layer only — **no therapists-side sender and no form
control** are built here.

## What it does

- Adds a **`clinicalTreatmentType`** column to the Clients sheet
  (`apps-script/Code.gs` `CLIENTS_HEADERS`), **appended LAST** (after `phone`).
- On `_saveAll`, each client's `clinicalTreatmentType` is run through
  `_clinicalToBilling()` and the result **overwrites `serviceType`**. Clinical is
  the authoritative source: a migrated client's `serviceType` is always derived,
  not hand-edited.
- **Back-compat:** if `clinicalTreatmentType` is absent/empty (legacy rows, or
  any client the therapists app hasn't sent yet), `serviceType` is left exactly
  as-is.
- **Fail loud:** an unknown clinical value **throws** (`Unknown clinical
  treatment type: "…"`) — it never silently blanks `serviceType`.

## Clinical → billing map (mirror)

The Apps Script runtime cannot `require()` `public/treatment-map.js`, so the
12-entry `CLINICAL_TO_BILLING` map is **mirrored inline** in `Code.gs` (the same
pattern as the debt / phone rules). `test/clinical-derive.test.js` parses the
inline map and asserts it **deep-equals** the canonical module, so the mirror
can never drift. The map is one-to-one over 12 clinical keys, with the two
renames pinned (`פרטני כללי → פרטני`, `מרכז יום → ליווי יומי בקהילה` keyed under
the new name) and the five newly-billable types mapping to their own names.

## Why the column is appended LAST (positional safety)

`_readAll`/`_writeAll` map columns **by position** and `_ensureSheet` does not
migrate data, so a new column may only be **appended at the end** — exactly the
lesson from the `phone` column and the task-4.4 reserved slots. Appending
`clinicalTreatmentType` after `phone` leaves every existing column (incl. the
`phone` cross-app join key) in place; legacy rows simply read the new trailing
cell as empty.

## app.js passthrough (data-layer only)

`normalizeClientFromSheet` and `clientForSheet` now carry `clinicalTreatmentType`
through unchanged. Without this, the next dashboard save would `''`-blank the
field (it isn't in app.js's object, so `_writeAll` writes empty), destroying the
clinical value the receiver depends on. This is **passthrough only** — no UI
control and no derive on the browser side (the server is the single authority).

## Tests (`test/clinical-derive.test.js`, 9 cases)

- mirror deep-equals `treatment-map.js` (12 keys)
- every clinical value derives the serviceType from the map
- the two renames derive correctly; the five newly-billable types derive to
  their own names
- empty / whitespace / absent / null clinical leaves `serviceType` untouched
- unknown clinical throws and does **not** blank `serviceType`
- `clinicalTreatmentType` is the last `CLIENTS_HEADERS` column, `phone` before it
- positional safety: a legacy row lacking the new column reads back without
  misaligning `phone`; writing a client without it blanks only the last column

`day-center`, `treatment-map`, and `treatment-plans` suites stay green. (Two
schema-guard tests in `responsible-removal` / `stop-flag-match` that asserted
`phone` was the final column were updated for the new last column.)

## Files touched

- `apps-script/Code.gs` — `clinicalTreatmentType` header, `CLINICAL_TO_BILLING`
  mirror, `_clinicalToBilling`, `_deriveClientServiceType`, wired into
  `_saveAll`. **Requires an Apps Script redeploy.**
- `public/app.js` — `clinicalTreatmentType` passthrough (read + write).
- `test/clinical-derive.test.js` — new; `test/responsible-removal.test.js` +
  `test/stop-flag-match.test.js` — schema-guard updates.
- `CHANGELOG.md`, `CHANGELOG-clinical-treatment-type-receiver.md`, `README.md`.

## Not in this step

No therapists-side sender / push, no form control for `clinicalTreatmentType`, no
Sheets migration. Existing sheet data is left in place; rows pick up the column
on their next save.
