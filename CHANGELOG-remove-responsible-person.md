# Remove the אחראי (responsible/owner) concept (task 4.4)

Removes the **responsible-person** feature from the outpatient app: the
`responsiblePerson` name field and its `serviceScope` role selector
(individual → "מטפל" / program → "מנהל בית"). The treatment-contact phone
(`treatmentContactPhone`) — the WhatsApp/billing contact number — is **kept**
and untouched.

## Scope

- **Removed:** `responsiblePerson`, `serviceScope` — every form control, model
  read/write, prefill, render (chips + role label), and required-validation.
- **Kept (untouched):** `treatmentContactPhone` and its uses — the stop-payment
  WhatsApp action (`app.js` `buildStopTreatmentMsg` / `wa-stop`), its guard, and
  the edit-form phone input. Only the message's *greeting name* changed (it used
  to interpolate the responsible's name; now it opens with a plain "שלום,").

## Why the columns were NOT dropped from the sheet (positional safety)

`apps-script/Code.gs` reads/writes the Clients sheet **positionally**:
`_readAll`/`_writeAll` map columns `1..headers.length` by index, and
`_ensureSheet` only rewrites the header *labels* — it never moves data cells.
`responsiblePerson` / `serviceScope` sit **mid-array (positions 20–21)**, so
deleting them from `CLIENTS_HEADERS` would shift every later column left by two
on the live sheet — corrupting `treatmentContactPhone`, `payerName`,
`payerPhone`, `paymentLink`, and the **`phone` cross-app join key** — with no
migration to fix it.

Per the "no migration / leave existing data in place" constraint, the two slots
are therefore **kept as reserved, unread placeholders** in `CLIENTS_HEADERS`
(commented as dead). The app no longer reads or writes them; existing cells stay
put and simply blank out the next time a given client row is saved. Column
positions — and `phone` as the last column — are preserved exactly.

## What changed

- **`apps-script/Code.gs`** — `CLIENTS_HEADERS` unchanged in layout; the two
  slots annotated as RESERVED / DEAD. **No redeploy required** (no behavior
  change in Apps Script).
- **`public/app.js`** — dropped both fields from `normalizeClient` (sheet→model)
  and `clientForSheet` (model→sheet); removed the role-label/scope/responsible
  chips from `renderRenewalRow` and the client card (the now-empty
  `responsibleHtml` block removed cleanly); removed the edit-form prefill, the
  direct-add and lead-activation writes, and the edit-save `serviceScope`/
  `responsiblePerson` reads, **both required-validations** ("יש לבחור היקף
  טיפול", "יש להזין שם אחראי טיפול"), the `prev` rollback keys, and the
  assignments; `buildStopTreatmentMsg` greeting no longer names the responsible.
- **`public/index.html`** — removed the `serviceScope` `<select>` and
  `responsiblePerson` `<input>` from both activation forms and the edit-client
  form; the edit form's "אחראי טיפול …" section title is trimmed (the kept
  treatment-contact phone still lives under it).
- **`public/style.css`** — removed the now-dead `.chip-scope` / `.chip-resp`.

## Tests

`test/responsible-removal.test.js` (5 cases):

- **Source guard** — `public/` no longer references `responsiblePerson` /
  `serviceScope` / the dead chips / the responsible validation, while
  `treatmentContactPhone` and `buildStopTreatmentMsg` survive.
- **Reserved-slot guard** — parses `CLIENTS_HEADERS` from `Code.gs` and asserts
  both slots are still present, in order, between `house_of_origin` and
  `treatmentContactPhone`, with `phone` still last.
- **Positional safety** — mirrors `_writeAll`/`_readAll`; a client saved with no
  responsible fields blanks the reserved slots while `treatmentContactPhone …
  phone` stay in their correct columns (round-trips), and a legacy row that
  still carries אחראי data reads back without misaligning `phone`.

Full suite otherwise unchanged; `day-center` and `treatment-plans` tests still
pass. (The pre-existing `debt-status-forwarding` / `sheets-secret-forwarding`
failures are unrelated — server HTTP-forwarding in a sandboxed network.)

## Deploy

Front-end only; ships with a normal Railway deploy of this branch. **No Apps
Script redeploy and no Sheets schema change.** No data migration.
