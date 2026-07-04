# CHANGELOG — Save performance (C) + save lock (E)

Apps Script change — **requires a redeploy** (new version) to take effect. See
"Deploy" below.

## Context
Measured patient-save TTFB was ~3.5s, entirely server-side. `_saveAll` does a
full clear-and-rewrite of the Leads + Clients sheets on every save (~22
SpreadsheetApp round-trips). This trims the per-save overhead (C) and adds the
missing concurrency lock (E). It does **not** redesign to per-row upsert (that's
a separate future option) — output data is byte-identical for the same input.

## Part C — trim `_writeAll` / `_ensureSheet` overhead
- **Stopped the per-save phone-column reformat.** `_formatPhoneColumns` used to
  run on **every** `_ensureSheet` call (i.e. every save, for both sheets) and
  formatted `getMaxRows()` — the sheet's full row *allocation* (often 1000+
  empty rows) — with `setNumberFormat('@')` per phone column (1 on Leads, 3 on
  Clients). That was the bulk of the wasted work: ~2 `getMaxRows` reads + 4
  wide `setNumberFormat` passes per save, over ~1000 rows each.
- **Why it's safe / byte-identical:** number format is a *persistent* cell
  property. `_formatPhoneColumns` still runs **once at sheet creation** (over the
  full allocation, so `appendRow`-based writers — createLead/removeLead/flagStop
  — land in already-`'@'` cells), and `_writeAll` still re-asserts `'@'` over the
  **actual data rows** (`values.length`, not `getMaxRows()`) before every write.
  So every phone cell that ever holds data is still text-formatted; we just
  stopped re-formatting ~1000 empty rows on every save.
- `_writeAll` was already formatting each phone column once over `values.length`
  (data rows only) — no duplicate pass existed inside it, so it is unchanged. The
  removed duplication was the `_ensureSheet` → `_formatPhoneColumns` call.
- The `_ensureSheet` header self-migration check (`getLastColumn` + one header
  `getValues`) is **left intact** — it is load-bearing (auto-applies appended
  columns) and cheap relative to the wide `setNumberFormat`, so removing it would
  change behavior. Not touched.

## Part E — LockService on `_saveAll`
- `_saveAll` now takes `LockService.getScriptLock()` before writing, matching the
  pattern used by every other writer (`_savePayment`, charges, stop-flags,
  mergeClients, createLead). It was previously the **only** writer with no lock,
  so two overlapping saves could clobber each other.
- **No lock-less write path:** the lock is acquired with `tryLock(30000)` and, if
  it cannot be acquired, `_saveAll` returns `{ ok:false, error:… }` **without
  writing** (rather than proceeding unlocked). It is always released in a
  `finally`. 30s comfortably covers a save (~3.5s) queued behind another for a
  single user, so realistic rapid saves wait-then-succeed rather than erroring.

## No schema / behavior change
- No header/schema changes. Same rows, same columns, same values written for the
  same input. Only fewer/narrower range ops + serialization via the lock.

## Tests
No unit test added: both changes are Apps-Script-bound (`SpreadsheetApp` range
ops in `_ensureSheet`/`_writeAll`, `LockService` in `_saveAll`) and cannot run
under `node --test`; there is no pure, extractable algorithm here (the "scoping"
is just `values.length` passed to `getRange`). Existing suite unchanged at
156/158 (the 2 failures are the pre-existing `server.js` forwarding tests). The
diff is a mechanical narrowing of range scope + a lock wrapper.

## Deploy — REQUIRES Apps Script redeploy
This edits `apps-script/Code.gs`, which runs as a deployed Web App. After merge:
1. Open the Apps Script project → **Deploy → Manage deployments**.
2. Edit the active deployment (pencil) → **Version: New version** → **Deploy**.
   (The Railway frontend does not need a redeploy for this change.)

## Verify after redeploy
- **Speed:** DevTools → Network → the `POST /api/sheets` save request — TTFB
  should drop noticeably from ~3.5s.
- **Correctness / round-trip:** save a patient, reload, confirm data (incl. phone
  numbers with leading zeros) is intact; confirm charges/payments still load and
  round-trip. Optionally check the Apps Script Executions log — `doPost` duration
  should be lower.
