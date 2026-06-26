# Orphaned "additional treatment" charges from deleted patients

**Date:** 2026-06-26

The dashboard's "additional treatment / beyond-the-package" charges
(`ClientCharges`) are keyed by `clientId`. When a patient was permanently
deleted, their charge rows survived in the sheet as **orphans** and kept
surfacing on the dashboard. The two real cases were test patients on phone
`0543123270` (names "בדיקה" and "מריסה נשרי").

Fix is two-layered — an immediate display filter **and** a root-cause cleanup —
plus a small UX addition (the patient phone is now visible and editable).

## Root cause

`ClientCharges` rows reference a patient by `clientId`. The permanent-delete
(`✕`) flow in `clientCard` removed the client from `state.clients` and saved,
but **never touched `ClientCharges`**. The charge rows were left pointing at a
`clientId` that no longer existed.

## Changes

### Display filter — `excludeOrphanCharges(charges, clients)`

A pure helper that returns only charges whose `clientId` matches a live patient.
`clientId` is compared **as a string** on both sides (Sheets can hand back a
numeric id); blank/`null` `clientId` is treated as an orphan.

- `public/charges-logic.js` — added + exported (the Node-testable source).
- `public/app.js` — inline mirror (the browser has no build step), applied in
  `loadAll` immediately after charges are normalized:

  ```js
  state.charges = excludeOrphanCharges(state.charges, state.clients);
  ```

  This hides any pre-existing orphan rows on the next load with no migration.

### Root-cause cleanup — delete also removes the patient's charges

- `apps-script/Code.gs` — new `_removeChargesForClient(clientId)`: under a
  `LockService` lock, scans `ClientCharges` and `deleteRow`s every row whose
  `clientId` matches, **bottom-up** so indices stay valid. Idempotent (a
  clientId with no rows → `{ ok:true, removed:0 }`), logs each removed row id to
  the Apps Script execution log. Routed in `doPost` as
  `action === 'removeChargesForClient'`.
- `public/app.js` — the `✕` permanent-delete flow now prunes the patient's
  charges from `state.charges` locally and, after the `saveAll`, calls the new
  `persistRemoveChargesForClient(clientId)` (one extra round-trip) to delete the
  rows server-side. Hard delete — charges are not legal records (same trust
  model as the existing `removeCharge`).

> No separate one-off "sweep" function is shipped: the display filter hides the
> two existing orphan rows immediately, and they are removed from the sheet the
> next time those (already-deleted) patients are involved. Deleting any patient
> from now on cleans up their charges at the source.

### Patient phone — visible + editable

- `public/index.html` — new **"טלפון מטופל"** field (`name="phone"`) in
  `#editClientModal`, under a new "פרטי מטופל" section.
- `public/app.js` —
  - `openEditClientModal` populates `form.phone` from `client.phone`.
  - the edit-submit handler validates it via the shared `acceptPhone(…,
    'mobile', false)` guard (strict 10-digit leading-zero, optional), assigns
    `client.phone`, and includes `phone` in the revert snapshot.
  - `clientCard` renders the patient phone as a `📞` chip.
  - Read-side normalization was **already** present (`recoverPhone` in
    `normalizeClientFromSheet` + `backfillClientPhones`), so the canonical
    10-digit leading-zero form is what the card and modal show even when Sheets
    dropped the leading zero.

## Tests — `test/charge-orphans.test.js`

- A charge whose `clientId` has no matching active patient is excluded; live
  charges are kept.
- Deleting a patient drops their charges from the dashboard view (orphan does
  not leak).
- `clientId` string/number coercion; blank/`null` `clientId` excluded; a client
  with a blank id never adopts blank-clientId charges; empty/missing inputs do
  not throw.
- Phone normalization: `recoverPhone` restores a Sheets-dropped leading zero for
  the real test-patient number (`543123270 → 0543123270`), is idempotent, and
  handles the `+972` form.

## Deployment

1. **Frontend** — Railway auto-deploys on push to the merged branch.
2. **Apps Script** — paste `apps-script/Code.gs` into the Sheets-bound script
   editor, save (Ctrl+S), then **Deploy → Manage deployments → ✏️ (pencil) →
   Version: New version → Deploy**. Using the pencil on the existing deployment
   preserves the `/exec` URL. Required for the `removeChargesForClient` action
   to exist server-side.
3. **Sheet** — no manual migration. The display filter hides orphans on the
   next load; future deletes clean up at the source.
