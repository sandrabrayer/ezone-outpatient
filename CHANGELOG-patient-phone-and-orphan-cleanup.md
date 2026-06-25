# Patient phone on the card + orphan extra-charge cleanup on delete

**Date:** 2026-06-25

Two runtime fixes in the outpatient app's own patient card and delete flow.

---

## A — Patient phone now displays on the card and is editable

### The bug
Patients had a phone in Sheets, but it never appeared on the patient card.

It was **not** a column-read, leading-zero, or match bug — the data arrived
fine and was then dropped by the UI:

- The canonical patient number lives in the `Clients!phone` column (the last
  column, `CLIENTS_HEADERS`), leading-zero-recovered on read by `_readAll` /
  `_recoverPhone` (`apps-script/Code.gs`) and again by `recoverPhone` in
  `normalizeClientFromSheet` (`public/app.js`). For rows that predate the
  `phone` column, `backfillClientPhones()` fills it in memory from the
  originating lead.
- **`clientCard()` built its `innerHTML` with no phone element at all**, and the
  edit modal (`#editClientForm`) only had inputs for `treatmentContactPhone`
  (אחראי טיפול) and `payerPhone` (גורם משלם) — **never the patient's own
  `phone`.** So the number was loaded but invisible and uneditable.

### The fix
- **Card display** (`public/app.js`, `clientCard`): render a tap-to-call chip
  `📞 <phone>` using `recoverPhone(c.phone)` (canonical 10-digit leading-zero,
  idempotent). Omitted when the patient has no stored number.
- **Edit modal** (`public/index.html`): add a **טלפון מטופל** (`name="phone"`)
  input at the top of `#editClientForm`.
- **Populate / save** (`public/app.js`): `openEditClientModal` fills
  `form.phone`; the submit handler normalizes via
  `acceptPhone(..., 'mobile', false)` (empty allowed, invalid rejected with a
  toast), assigns `client.phone`, and includes `phone` in the rollback snapshot.

Persisting was already wired — `clientForSheet` writes `phone` and the backend
forces the column to plain text — so no backend change was needed for A.

## C — Deleting a patient cleans up their extra-charge rows

### The bug
"בקשות לטיפול נוסף" are the extra-charge rows added via **"+ הוסף טיפול"**,
stored in the `ClientCharges` sheet keyed by `clientId`. The only delete flow
(the ✕ "מחיקה לצמיתות" button) did:

```js
state.clients = state.clients.filter(x => x.id !== c.id);
persist();   // writes ONLY leads + clients
```

`persist()` never touches `ClientCharges` (it's written through the separate
`saveCharge` / `removeCharge` actions), so every charge row for the deleted
patient survived as an orphan.

### The fix
- **Backend** (`apps-script/Code.gs`): new `_removeChargesForClient(clientId)` —
  hard-deletes every `ClientCharges` row whose `clientId` matches, bottom-up so
  row indexes stay valid, under the same script lock as `_removeCharge`. Wired
  as a new `doPost` action `removeChargesForClient`.
- **Frontend** (`public/app.js`): the ✕ handler now also drops the client's
  charges from `state.charges` and calls
  `persistRemoveChargesForClient(c.id)` (only when the patient had charges)
  before `persist()`.
- **Orphan-exclusion filter**: `excludeOrphanCharges(charges, clients)` — keeps
  only charges whose `clientId` still matches a loaded patient. Added as a pure,
  exported helper in `public/charges-logic.js` and mirrored inline in
  `public/app.js`, where `loadAll()` applies it so any pre-existing orphan
  (e.g. from an old delete) is excluded from the UI and billing aggregations.
  (Billing already joined charges through `clients.forEach`, so orphans never
  affected totals; the filter makes that guarantee explicit.)

Existing orphan rows in the sheet are test data; a hard delete is the policy.

---

## Deploy

**Apps Script redeploy required** for C (the new `removeChargesForClient`
`doPost` action). Edit the existing deployment with the pencil ✏️ to preserve
the `/exec` URL — do not create a new deployment. A is a static front-end
change only.

## Tests

- `test/phone-card.test.js` (5 cases) — a stripped/number phone recovers to
  canonical 10-digit, recovery is idempotent, the card builds a `tel:` chip with
  the canonical number, and no chip when the patient has no number.
- `test/orphan-charges.test.js` (7 cases) — deleting a patient removes all of
  their requests and leaves others untouched (model of
  `_removeChargesForClient`); `excludeOrphanCharges` drops a request whose
  patient no longer exists, keeps those with an active patient, tolerates empty
  inputs; and the full delete + filter flow leaves no dangling request.
