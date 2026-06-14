# Inbound stop-treatment flag (`flagStop`)

A write endpoint that lets the sibling app (E-Zone Therapists) tell outpatient
"a therapist reports that patient X stopped coming." Outpatient is the source of
truth for patient status, so this is **a note, not an action**: it records a
**pending flag** for Vered to confirm, and never changes a client's status on
its own. Vered performs the actual discharge in the outpatient UI exactly as
today and remains the sole discharge authority.

It is the **inbound** counterpart to the read endpoints (`getWinbackSource`,
`getDebtStatus`, `getTreatmentPlans`) — and, being an external **write**, it
flips their auth model from fail-open to **fail-closed**.

## Why this was needed

Outpatient had no way to receive a signal from the therapists app. Every
cross-app endpoint was read-only/outbound-pull; there was no inbound write, no
place to hold a pending request, and no UI surface for one. A therapist noticing
a patient has stopped had no path to surface that to Vered other than out-of-band
(phone/WhatsApp). `flagStop` gives that signal a durable, auditable home without
handing the therapists app any authority over outpatient status.

## Contract

```
POST <apps-script>/exec        (the therapists app calls Apps Script directly)
{
  "action":     "flagStop",
  "secret":     "<STOP_FLAG_SECRET>",   // REQUIRED — fail-closed
  "phone":      "050-1234567",          // treatmentContactPhone, as known to the therapist
  "name":       "אורי",                  // at least one of phone/name is required
  "reportedBy": "שם המטפל",              // optional, for the audit trail
  "note":       "הפסיק להגיע"            // optional free text
}
→ { "ok": true, "flag": { "id":"sf_…", "status":"pending", … } }
```

`phone` is matched on the outpatient side against `treatmentContactPhone` (the
phone registered for the patient treated), consistent with the debt/winback
matching contract. Matching itself happens in the **UI**, by name + normalized
phone — the flag just stores what the therapist sent; `clientId` is an optional
hint, not required.

## Never auto-discharge: pending → Vered → resolved

A flag is recorded with `status: 'pending'` and nothing else moves. In the
outpatient clients view a panel — **"המתנה לאישור הפסקה"** — lists each pending
flag and matches it to a client:

| match result                          | UI                                            |
| ------------------------------------- | --------------------------------------------- |
| exactly one client (phone, then name) | **אשר הפסקה** → opens the normal exit modal    |
| no client matches                     | shown as "לא נמצאה התאמה" — Vered handles it   |
| more than one matches                 | shown as "התאמה מרובה" — Vered picks manually |

- **אשר הפסקה** opens the *existing* discharge flow for the matched client. When
  Vered completes it, the discharge sets `status = 'סיים טיפול'` as always, and
  the originating flag is marked `resolved`.
- **התעלם** resolves the flag without discharging (the therapist's report wasn't
  actionable).

The flag never writes `Clients.status`. The only thing that discharges a patient
is Vered finishing the exit modal — unchanged from before this feature.

## Phone matching

`phoneKey()` reduces a phone to its national significant digits: strip
separators and any `0` / `+972` / `00972` prefix, so `050-1234567`,
`0501234567`, and `+972501234567` all collapse to `501234567`. The
therapist-reported phone is reduced the same way and compared against **every**
phone field a client carries — `treatmentContactPhone`, `payerPhone`, and the
patient's own `phone` — so a number stored in any of them matches. A single
phone match wins outright; duplicate phones are disambiguated by exact name;
with no phone match a unique exact name match is used; anything else is surfaced
as no-match / ambiguous rather than guessed. **A phone match alone is
sufficient — the name is only a soft tiebreaker, never a hard gate.**

The patient's phone is stored durably in the `Clients` `phone` column (carried
from the lead on activation, canonicalized by `recoverPhone`, and backfilled in
memory from the originating lead for clients that predate the column). This is
what makes a lead-originated patient matchable without anyone re-typing the
number into the treatment-contact field.

## Auth — fail-closed (the deliberate difference)

The read endpoints fall **open** when their secret Script Property is absent
(URL-obscurity, same as every other read action). `flagStop` is an external
**write**, so it does the opposite:

- If the Script Property **`STOP_FLAG_SECRET`** is **not set**, `flagStop` is
  **refused** (`{ ok:false, error:'unauthorized' }`). There is no open fallback.
- If set, the request must pass a matching `secret` (in the JSON body or as a
  query param).

The companion actions are dashboard-internal and stay unauthenticated, matching
the existing internal writes (`saveAll`, `savePayment`, …):

- `getStopFlags` — returns the pending flags for the outpatient UI.
- `resolveStopFlag` — marks a flag `resolved` (with `resolvedBy`/`resolvedAt`).

## Storage

New append-only `StopFlags` sheet (created on demand by `_ensureSheet`):

```
id, phone, name, clientId, reportedBy, reportedAt, note, status, resolvedBy, resolvedAt
```

`status` is `pending` until Vered acts, then `resolved`. Rows are never deleted,
so the sheet doubles as an audit log of therapist reports and how each was
handled.

## Files touched

- `apps-script/Code.gs` — `STOP_FLAGS_HEADERS`, `_stopFlagAuthOk` (fail-closed),
  `_flagStop`, `_getStopFlags`, `_resolveStopFlag`, and dispatch in `doGet`
  (`getStopFlags`) and `doPost` (`flagStop`, `getStopFlags`, `resolveStopFlag`).
  **Requires an Apps Script redeploy.**
- `public/app.js` — load pending flags, `phoneKey`/`matchClientForFlag`, the
  "המתנה לאישור הפסקה" panel (`renderStopFlags`), `dismissStopFlag`, and the
  exit-modal wiring that resolves the flag on discharge.
- `public/index.html` — `#stopFlagsPanel` container in the clients view.
- `public/style.css` — panel styling.
- `test/stop-flags.test.js`, `test/stop-flags-forwarding.test.js` — new.
- `README.md`, `CHANGELOG.md` — documented.

## Deploy notes

- **Redeploy the Apps Script Web App** (the new actions live in `Code.gs`).
- **Set the `STOP_FLAG_SECRET` Script Property** — `flagStop` is refused until
  you do (fail-closed). Configure the matching secret on the therapists side.
- No Sheets schema change beyond the auto-created `StopFlags` tab. No
  `server.js`/Railway change — the Node proxy already forwards the POST body and
  the GET action; a normal deploy carries the new static/UI/test files.
