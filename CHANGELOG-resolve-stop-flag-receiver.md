# Resolve stop-flag receiver (outpatient side)

**Date:** 2026-06-20

Adds a **secured `resolveStopFlag` receiver** so the **E-Zone Therapists** app can
clear a stop-treatment flag it previously raised — e.g. the patient resumed
treatment, or the therapist withdrew the report. It complements `flagStop`
(raise) with a matching **resolve** action over the same fail-closed contract.

This does **not** discharge anyone and never touches `Clients`. Vered's manual
confirmation flow on the dashboard is unchanged.

## Why phone-only matching

The existing **internal** `resolveStopFlag(id)` (Vered's dashboard, open) marks
one row resolved by flag **id** when Vered completes a discharge. The therapists
app does not know our row ids — it only knows the **phone** it flagged. It also
must be able to clear **orphaned** flags (e.g. `יעל`) that were written with a
blank `clientId` because no client row matched the phone at flag time.

So the receiver resolves by **canonical phone ALONE — no `Clients` join.** It
matches the reported phone against each `StopFlags` row's `phone` cell after the
same `_recoverPhone` canonicalization used everywhere else (restores a leading
zero that Sheets dropped by numeric coercion; folds `+972` / `00972` / dashes).

## Apps Script (`apps-script/Code.gs`)

- **`resolveStopFlag`** now has **two paths**, dispatched in `doPost` by the
  presence of a `secret` in the payload:
  - **Secured receiver (new):** `{ action:'resolveStopFlag', secret, phone }`
    → `_resolveStopFlagByPhone`.
    - **FAIL-CLOSED auth:** reuses the **same** `STOP_FLAG_SECRET` Script Property
      as `flagStop` (`_stopFlagAuthOk`). Unset/empty/wrong secret → rejected.
      `→ { ok:false, reason:'unauthorized' }`.
    - Phone is canonicalized via `_recoverPhone` and validated `/^0\d{8,9}$/`
      (else `{ ok:false, reason:'invalid_phone' }`).
    - Marks **every still-pending** `StopFlags` row whose canonical phone matches
      `status='resolved'` + `resolvedBy` (defaults to `'therapists-app'`) +
      `resolvedAt` (ISO). Already-resolved rows are skipped, so a retry is
      idempotent. Returns `{ ok:true, resolved:N }`. **`N=0` is a successful
      no-match, not an error.**
    - Mirrors `_flagStop` structure: one `LockService` script lock, `_ensureSheet`,
      and **positional** writes by `STOP_FLAGS_HEADERS.indexOf(...)` (append-only
      column safety). **`Clients` is never read or written.**
  - **Internal (unchanged):** `{ action:'resolveStopFlag', id, resolvedBy }`
    (no secret) → `_resolveStopFlag(id, resolvedBy)`, open, used by the dashboard
    on discharge. Backward compatible — the dashboard never sends a `secret`.

## Tests

`test/resolve-stop-flag.test.js` — pure mirror of `_resolveStopFlagByPhone`
(`Code.gs` cannot be imported in Node; keep the mirror in sync). Locks:
resolves a flag by phone; **orphaned flag (blank `clientId`) still resolves**;
**dropped-leading-zero phone matches** (both directions, incl. `+972`);
**fail-closed auth** (unset/empty/wrong rejected, nothing changed); invalid phone
rejected; **no match → `resolved:0`**; multiple rows for one phone all clear and a
rerun is idempotent (`resolved:0`).

## Inbound contract (for the therapists app)

```
POST <APPS_SCRIPT_EXEC_URL>
Content-Type: application/json

{ "action": "resolveStopFlag", "secret": "<STOP_FLAG_SECRET>",
  "phone": "0501234567" }

→ { "ok": true,  "resolved": 1 }            // 0 = no matching flag (still ok)
→ { "ok": false, "reason": "unauthorized" | "invalid_phone" }
```

## Auth — where to set the secret

No new secret. Reuses the existing **`STOP_FLAG_SECRET`** Script Property (Project
Settings → Script Properties) shared with `flagStop`. Until it is set, the
receiver rejects every request (fail-closed).

## Deployment

- **No `server.js` change** — the therapists app POSTs `resolveStopFlag` directly
  to the Apps Script `/exec`, exactly like `flagStop`.
- ⚠️ **Apps Script redeploy required** to the existing deployment (`…FOwWYIw`):
  Apps Script editor → **Deploy → Manage deployments → ✏️ → Version: New version →
  Deploy**. The new `_resolveStopFlagByPhone` path lives in `Code.gs`, so a fresh
  `/exec` version is required for the receiver to accept secured calls.
