# Clients sheet column-shift fix (2026-07-06)

## Symptom (live, app-wide)

Every `saveAll` threw `Unknown clinical treatment type: "paid"` in
`_deriveClientServiceType`, blocking **all** saves across the app. On the live
Clients sheet the header labels no longer matched the data underneath them:

- `clinicalTreatmentType` (col **AA**) held `paid`/`unpaid` (paymentStatus values)
- `creditsOwed` (col **AB**) held dates (paymentDate values)
- `packageChangeDate` (col **AC**) held +30 dates (nextBillingDate values)

## Root cause chain

1. **Two unrelated production lines.** `claude/youthful-volta-laarnk` (volta) and
   `claude/ezone-outpatient-dashboard-hKjf9` (dashboard) had no common git ancestor
   and each evolved its own `CLIENTS_HEADERS` tail:
   - **volta** (`9e0bbf5`): `… phone, clinicalTreatmentType, creditsOwed, packageChangeDate, assignedTo`
   - **dashboard** (`d560d0e`): `… phone, paymentStatus, paymentDate, nextBillingDate, creditsOwed`
2. **The live sheet was written by the dashboard-hKjf9 deployment.** Its physical
   columns after `phone` (col 26 / Z) were:

   | Physical col | Field written |
   |---|---|
   | 27 / AA | paymentStatus |
   | 28 / AB | paymentDate |
   | 29 / AC | nextBillingDate |
   | 30 / AD | creditsOwed |

   (This matches the EZONE-ECOSYSTEM-STATUS warning that Railway had been silently
   pointed at dashboard-hKjf9, orphaning volta work.)
3. **PR #56 unified the two lines** and produced a single 33-column array that placed
   the volta-only columns (`clinicalTreatmentType, creditsOwed, packageChangeDate,
   assignedTo`) **between** `phone` and the payment tail. The commit/comments called
   this "append-only." **It was append-only versus the *volta* header array, but a
   MID-ARRAY INSERT versus the *physically deployed* dashboard sheet.**
4. **`_ensureSheet` relabels but never migrates.** On deploy it rewrote header row 1
   to the new labels while every data cell stayed physically put. Result: physical
   col 27 (paymentStatus data, `paid`/`unpaid`) was now labeled `clinicalTreatmentType`.
5. **The throw.** `loadAll` → `_readAll` read col 27 as `clinicalTreatmentType='paid'`;
   the frontend round-tripped it; `saveAll` → `_deriveClientServiceType` →
   `_clinicalToBilling('paid')` threw **before** `_writeAll`, so every save aborted and
   the bad data was never corrected.

### Remap table (what the live sheet actually holds)

| Physical col | Wrong header (post-#56) | Actual data | Correct field | New array col |
|---|---|---|---|---|
| 27 / AA | clinicalTreatmentType | `paid`/`unpaid` | **paymentStatus** | 27 |
| 28 / AB | creditsOwed | dates | **paymentDate** | 28 |
| 29 / AC | packageChangeDate | +30 dates | **nextBillingDate** | 29 |
| 30 / AD | assignedTo | numbers | **creditsOwed** | 30 |

The volta-only fields (`clinicalTreatmentType`, `packageChangeDate`, `assignedTo`)
were **never physically written** on the live (dashboard-line) sheet.

## Fix (option a — reorder to match the physical sheet, no data move)

`CLIENTS_HEADERS` was reordered so it mirrors the **physical live sheet**:

```
… payerName, payerPhone, paymentLink, phone,
  paymentStatus, paymentDate, nextBillingDate, creditsOwed,   ← physical cols 27-30
  clinicalTreatmentType, packageChangeDate, assignedTo         ← appended (were unwritten)
```

- The payment tail sits directly after `phone`, aligning labels with the data.
- The physically-unwritten volta-only columns append at the END; old rows read them
  back blank until the next save (no backfill).
- **No bulk data move is performed.** The frontend `clientForSheet` payload is
  name-keyed, so the reorder is transparent to it; `_writeAll`/`_readAll` are
  positional and now align.

**This order is FROZEN as of 2026-07-06 and verified against the sheet itself, not
merely the previous array. Append-only from here.**

### Hardening

- **`_deriveClientServiceType` is now fail-soft.** An unknown clinical value warns
  (`Logger.log`) and leaves `serviceType` untouched instead of throwing — a single
  bad or misaligned row can never abort the whole save loop again. The strict
  `_clinicalToBilling` primitive still throws for callers that want validation
  (`setClinicalType` already pre-validates before writing).
- **Guard tests** lock the frozen order (`test/clients-column-order.test.js`, plus
  the updated order asserts in `clinical-derive`, `responsible-removal`,
  `stop-flag-match`, `session-credits`, `lead-assignee`, `continuation-code`) and
  assert every single-cell Clients write derives its column from
  `CLIENTS_HEADERS.indexOf(...)` rather than a hardcoded index.

## Pre-condition scan procedure (run BEFORE redeploying)

A **read-only** admin action `scanClientColumns` was added (gated by the
`COLUMN_REPAIR_SECRET` Script Property, fail-closed). It reads the live Clients sheet
**by physical position** (never via the relabeled header map) and confirms:

1. Physical cols 27-30 contain only paymentStatus / paymentDate / nextBillingDate /
   creditsOwed-shaped data, and
2. Physical cols 31-33 (the volta-only relabel targets) are **empty** — i.e. no row
   was ever written under the post-unification layout.

It **writes nothing** and returns JSON: `safeToReorder`, a per-column pass/fail
`summary`, and up to 100 `violations`.

- **`safeToReorder: true`** → the reorder is safe; deploy the new Code.gs.
- **`safeToReorder: false`** (mixed-layout rows) → **STOP.** The sheet has cells
  written under the post-unification layout; a physical data repair (option b) is
  required instead.

Invoke (POST or GET), e.g.:

```
POST { "action": "scanClientColumns", "secret": "<COLUMN_REPAIR_SECRET>" }
```

## MANDATORY: redeploy the Apps Script

Apps Script **never** auto-syncs from GitHub. After this merge you MUST:

1. Set the `COLUMN_REPAIR_SECRET` Script Property (any value), run
   `scanClientColumns`, and confirm `safeToReorder: true`.
2. Paste the new `apps-script/Code.gs` into the live script → **Save** → deploy a
   **NEW VERSION of the EXISTING deployment** (URL ending `FOwWYIw/exec` — do NOT
   create a new deployment; keep access = "Anyone").
3. On the first `getData` after redeploy, `_ensureSheet` relabels header row 1 to the
   frozen order; labels now match the data. Verify a save succeeds.

Until the redeploy happens the live script keeps the broken order and saves stay
blocked — the repo change alone does not fix production.
