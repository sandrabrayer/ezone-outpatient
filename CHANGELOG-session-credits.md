# Session accounting + credits (auto-draw)

**Date:** 2026-06-20

Adds a monthly **session-credit** ledger per patient. Therapist-cancelled sessions
bank a credit; a `happened` session **beyond the patient's monthly quota** spends
one (when available), making that session **free to the patient** while the
**therapist is still paid normally**.

## Model (locked)

- Monthly **paid quota = weekly frequency × 4**, from the patient's plan
  (`Clients.sessionsPerWeek`, a JSON breakdown — values summed).
- Quota **renews in full each month**; the delivered (happened) count is recounted
  per calendar month (by **session date**), so it effectively resets monthly.
- `therapist_cancelled` → **+1 credit**.
- `happened` beyond the month's quota **and** a credit is available →
  `clientSessionValue` **0** (credit-covered), **credit −1**, therapist pay
  unchanged.
- `happened` within quota → normal value, no credit touched.
- Credits **carry forward** across months.
- The balance lives on the **OUT patient card** as a new `creditsOwed` field.

## Data — two new append-only columns

- **`Clients.creditsOwed`** — running balance, default 0. Appended at the END of
  `CLIENTS_HEADERS` (after `clinicalTreatmentType`), so every existing column
  keeps its position. **Server-managed** (see `_saveAll` below).
- **`SessionLog.creditStatus`** — how the engine treated a row (appended after
  `recordedAt`): `''` (N/A), `credit_added`, `within_quota`, `covered`,
  `beyond_no_credit`, `quota_unknown` (no plan frequency / no date — **flagged, no
  draw**), `no_client` (no single match — balance untouchable).

## Apps Script (`apps-script/Code.gs`)

- **Helpers:** `_toCredits` (blank → 0, non-negative int), `_planWeeklyFrequency`
  (sums the `sessionsPerWeek` JSON breakdown; bare number ok), `_monthKey`
  (`YYYY-MM` of a `yyyy-MM-dd`, else `''`).
- **`_recordSessionOutcome` — credit engine.** A single phone match unlocks it
  (0/>1 hits leave balances untouched). Because `creditsOwed` is a **stateful
  running total**, an upsert first **REVERSES** the existing row's credit effect
  (undo a prior `+1` cancel / give back a prior `covered` draw), then applies the
  new outcome's effect — so a correction is exact and an identical re-send nets
  zero. A `happened` draw only fires when **beyond quota** (`priorHappenedThisMonth
  ≥ quota`, excluding the row itself), a credit is on hand, **and** the computed
  value is a positive number (so group `0` / day-center `null` never waste a
  credit). The balance is written back (whole-sheet, like `_setClinicalType`)
  **only when it actually changes**. `quota_unknown` covers "no plan frequency or
  no session date → never draw, flag the row".
  - **Correction example** (`happened`-covered → `therapist_cancelled`): the drawn
    credit is given back (**+1**) *and* the cancellation credit is added (**+1**) →
    net **+2** vs the covered state, exactly reversing the draw and applying the
    grant.
  - **Documented limit:** reversal is per-row — we undo *this* row's effect and
    reapply; we do **not** re-simulate sibling draws elsewhere in the month.
- **`_saveAll` preserves `creditsOwed` by id.** The balance is server-owned, but a
  dashboard `saveAll` carries whatever the client tab last loaded (possibly stale).
  `_saveAll` now reads the on-sheet balance per id and **ignores the payload
  value** (a brand-new client with no existing row keeps its payload/0), so a save
  can never revert credits earned mid-session.

## Frontend (`public/app.js`, `public/style.css`)

- `normalizeClientFromSheet` reads `creditsOwed` (default 0); `clientForSheet`
  sends it back to keep the column aligned (the server stays authoritative).
- The patient card shows **קרדיט מפגשים: N** in its stats, accented green when > 0.

## Tests

`test/session-credits.test.js` (16) — pure mirror of the engine + a source-scan
guard. Covers: quota = frequency×4; cancelled → +1; within quota → no change;
beyond quota with credit → value 0 / credit −1 / therapist paid; beyond quota no
credit → normal value, flagged; **carry-forward across months** with per-month
recount; **correction reverses the draw** (happened→cancelled) and idempotent
re-send; **no plan / no date → quota_unknown, no draw**; unmatched → no_client;
group never wastes a credit; `_saveAll` preserve-by-id; positional safety for both
new columns. Updated existing "last column" guards in `clinical-derive.test.js`,
`responsible-removal.test.js`, `stop-flag-match.test.js`, and
`session-outcome.test.js`.

## Deployment

⚠️ **Requires an Apps Script redeploy** to the existing deployment (`…FOwWYIw`):
Apps Script editor → **Deploy → Manage deployments → ✏️ → Version: New version →
Deploy**. The credit engine, the two new headers, and the `_saveAll` preserve rule
live in `Code.gs`. The two new columns are created append-only by `_ensureSheet`
on first write; existing rows read the new cells as blank (→ 0). The frontend
(`public/app.js`, `style.css`) auto-deploys via Railway on merge.
