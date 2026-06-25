# שינוי חבילה (Change Package)

Adds a per-patient **שינוי חבילה** action that updates a client's pricing and
weekly frequency and re-anchors the monthly billing cycle to the change date.

## What changed

### UI
- New **שינוי חבילה** button on each `.client-card` (editor-only), next to
  **חידוש ותשלום**. The existing **חידוש ותשלום** button and the
  פעיל / הפסקה זמנית status dropdown are unchanged.
- New `#changePackageModal` with three fields:
  - **תאריך שינוי** — date, defaults to today.
  - **מחיר חדש למפגש** — defaults to the client's current `pricePerSession`.
  - **מפגשים בשבוע** — one input per existing service type, using the same
    per-service sessions host as the ✏️ ערוך modal (`renderSessionsHost` /
    `readSessionsHost`), pre-filled from the client's current breakdown. A
    multi-service patient keeps a per-service split (e.g. `{"פרטני":2,"קבוצה":1}`)
    instead of collapsing to a total; a single-service patient sees one input.
    Service **types** are not editable here — that stays in the ✏️ ערוך modal.
- On submit the client's `pricePerSession` and `sessionsPerWeek` are updated and
  a new `packageChangeDate` is stamped, then the dashboard persists
  (optimistic update with rollback on failure). Submit is rejected if the total
  weekly sessions across all services is zero.

### Billing re-anchor
- The renewal anchor changes from `paymentDate || startDate` to
  **`packageChangeDate || paymentDate || startDate`** in all four lockstep sites:
  - `public/app.js` — `nextRenewalDueDate`
  - `public/app.js` — `renewalInfo`
  - `public/charges-logic.js` — `nextRenewalDueDate` (the testable UMD mirror)
  - `public/vered-alerts.js` — `cycleEndDate` (so Vered's alerts never diverge
    from the card's גבייה הבאה)
- Result: after a change, **גבייה הבאה = packageChangeDate + 1 month**
  (short-month clamp preserved).
- `paymentDate` is **not** overwritten — it remains the "שולם ב" display value
  and the paid-status anchor.

### Schema (Google Sheets / Apps Script)
- `CLIENTS_HEADERS` in `apps-script/Code.gs` gains **`packageChangeDate`**,
  appended at the very END (after `creditsOwed`). `CLIENTS_HEADERS` is positional
  and append-only — `_readAll`/`_writeAll` map by position and `_ensureSheet`
  does not migrate — so the field may only be appended, never inserted mid-array.
  Old rows read back a blank `packageChangeDate`; the server carries the value
  through verbatim (no server-side logic reads it).
- Carried through `normalizeClientFromSheet` (sheet → model, via `fmtDate`) and
  `clientForSheet` (model → sheet) in `public/app.js`.

### Tests
- `test/package-change.test.js` — unit tests for the re-anchor precedence
  (`packageChangeDate` wins over `paymentDate`/`startDate`, fallbacks, and the
  short-month clamp), following the existing UMD `require('../public/...')`
  pattern.

## Deploy note

⚠️ **Apps Script redeploy required.** The `apps-script/Code.gs` change
(`packageChangeDate` header) only takes effect after a redeploy: open the Apps
Script project → Deploy → Manage deployments → pencil (edit) → **New version** →
Deploy. Keep the existing `/exec` URL stable (edit the existing deployment; do
not create a new one). Frontend files (`public/*`) auto-deploy via Railway.
