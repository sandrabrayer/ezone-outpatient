# Stop-treatment alerts: required reason

Adds a **required reason** to every stop-treatment alert (`הודעת עצירת טיפול` →
`createStopAlert`, shipped in PR #63). Vered now must classify *why* treatment is
being paused before the alert goes to Yarden's `עצירת טיפול` tab in the E-Zone
Therapists app.

This is a **PAUSE signal** — deliberately distinct from `סיים טיפול` (final
discharge). No UI label conflates the two: the overdue-panel button stays
`🛑 הודעת עצירת טיפול` and the new modal is titled `עצירת טיפול` with a subtitle
that spells out "הפסקה זמנית, לא סיום טיפול".

## Reason keys + labels

Stable keys are the wire format (stored in the sheet, shared with the therapists
app). Hebrew labels are **render-time only** — they never leave the UI layer
(existing `NOT_RELEVANT_REASON_LABELS` convention).

| key          | label (render-time) |
|--------------|---------------------|
| `no_payment` | חוסר תשלום          |
| `mismatch`   | אי התאמה            |
| `other`      | אחר                 |

## Backend (`apps-script/Code.gs`)

- `STOP_ALERTS_HEADERS`: **`reason` appended LAST**. The sheet is only days old,
  so appending is safe — no data migration. `_ensureSheet` relabels the header
  row in place; every earlier column keeps its index. A pre-`reason` row is one
  cell shorter than the header, and `_readAll` requests `headers.length` columns,
  so Sheets pads the missing trailing cell to `''` → a legacy alert reads
  `reason: ''`.
- `STOP_ALERT_REASONS = { no_payment, mismatch, other }` — the allowed set.
- `_createStopAlert` is **fail-closed** on reason: a missing/empty/unknown value
  is rejected with `error: 'invalid_reason'` **before** the lock or any write.
  The accepted reason is persisted on the appended row.
- `_getStopAlerts` returns `reason` automatically (it reads through
  `STOP_ALERTS_HEADERS`).

## Frontend (`public/app.js`, `public/index.html`)

- New `#stopAlertModal` **confirm modal** replaces the old native
  `confirm()` + `prompt()` flow. It has:
  - a **required** reason `<select>` (empty `—` default) — **save stays disabled
    until a reason is chosen**, with a toast guard on the submit path as a
    fallback;
  - the existing **optional** note textarea below it;
  - when **`other`** is chosen the note field gets **focus** and a hint that
    פירוט is expected (**not enforced**).
- Payload now includes `reason`. Optimistic push + rollback and the
  already-pending duplicate warning are preserved.
- `STOP_ALERT_REASON_LABELS` mirrors the keys→labels table above.

## Tests (`test/stop-alerts.test.js`)

- Headers-order guard now asserts **`reason` is LAST**.
- `createStopAlert` reason validation: rejects missing/empty/unknown
  (`invalid_reason`, no row), accepts each allowed key — plus a source guard on
  the real `_createStopAlert` and the `STOP_ALERT_REASONS` set.
- Legacy shorter-row read tolerance (`reason` → `''`).
- Frontend wiring: required select present with the stable keys, save gated on a
  valid reason, `other` focuses the note, submit posts `reason`.

## MANUAL follow-up (MANDATORY — not automated)

1. **Redeploy the outpatient Apps Script** so the new `reason` column + the
   fail-closed validation go live:
   **Deploy → Manage deployments → ✏️ (pencil) on the EXISTING deployment →
   Version: New version → Deploy.** Access must stay **"Anyone"**.
   ⚠️ **Never "New deployment"** — that mints a new `/exec` URL and breaks every
   consumer that shares the single existing deployment.
   Until this redeploy happens the sheet keeps the 8-column header and
   `createStopAlert` still accepts reason-less alerts — the frontend will send a
   `reason` the old backend simply ignores.
