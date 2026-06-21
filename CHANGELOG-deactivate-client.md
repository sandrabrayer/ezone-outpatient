# `deactivateClient` cross-app receiver (delete-propagation)

The **outpatient receiver** that pairs with the E-Zone Therapists **delete-
propagation sender** (ezone-therapists PR #24 — *"Cross-app data integrity:
canonical assignment phone + delete propagation"*, `_postDeactivateClient`). When
a patient is **deleted in the therapists app**, the patient must stop appearing in
outpatient's roster; this endpoint makes that happen.

This is the **receiver only** — the sender ships in the therapists repo.

## Why

The therapists roster build unions outpatient's `getTreatmentPlans` /
`getDebtStatus` as **base** sources. So deleting the patient only on the therapists
side left the matching outpatient **Client** active, and the roster immediately
**re-added** the deleted patient — the delete never stuck. This receiver removes
the patient from those two base sources.

## What it does

- New POST action **`deactivateClient`** on the Apps Script web app
  (`apps-script/Code.gs`):

  ```
  POST /exec { action:'deactivateClient', secret, phone }
  → { ok:true, deactivated:N }
  ```

- **Fail-closed auth** (`_deactivateAuthOk`) on a **dedicated, new**
  `DEACTIVATE_CLIENT_SECRET` Script Property: unset, empty, or mismatched → rejected
  (`{ ok:false, error:'unauthorized' }`). The secret is deliberately **its own** —
  **NOT** reused from `STOP_FLAG_SECRET` (least authority), matching the sender,
  which provisions the **same value** as a Script Property on **both** Apps Scripts.

- **Deactivate, not hard-delete** (reversible; the Client row plus its billing and
  session history are preserved). Every Client matching the **canonical phone** has
  its `status` set to a new dedicated value **`לא פעיל`**
  (`DEACTIVATED_CLIENT_STATUS_HE`).

- **Match by canonical phone alone** (mirrors `_resolveStopFlagByPhone`): the
  inbound phone is normalized with `_recoverPhone` (`+972`/`00`/dashes + a leading
  zero Sheets dropped by coercing the phone to a number), compared against each
  Client's `phone` / `treatmentContactPhone` / `payerPhone`. No name join — a
  patient deleted upstream is gone regardless of name drift.

- **Orphan-safe:** no matching Client → `{ ok:true, deactivated:0 }` — a successful
  no-op, never a crash. (The sender treats `deactivated:0` as success and proceeds
  with its local delete.) **Idempotent:** a row already at `לא פעיל` is skipped, not
  re-counted. Returns `{ ok:true, deactivated:N }`.

- **Clients is the only sheet touched** — one targeted `status` cell per match,
  under one script lock, positional by header index.

## The deactivation status vs. discharge

`לא פעיל` is **distinct from `סיים טיפול`** (Vered's manual discharge), on purpose:

| | `getTreatmentPlans` | `getDebtStatus` | win-back list |
| --- | --- | --- | --- |
| `סיים טיפול` (discharged) | included | **included** (debt survives discharge) | included (discharged source) |
| **`לא פעיל`** (cross-app deactivated) | **excluded** | **excluded** | not included |

Both projections (`_getTreatmentPlans`, `_getDebtStatus`) now **skip only**
`status === 'לא פעיל'`. Reusing `סיים טיפול` was rejected: excluding that status
from `getDebtStatus` would drop legitimately-discharged-but-owing clients from the
intake debt gate (breaking "debt survives discharge") and would also add the
deleted patient to the win-back call list. `לא פעיל` was previously **unused**
anywhere in the app (grep-confirmed), so it is a clean, reversible marker.

## Sender contract (confirmed against ezone-therapists PR #24)

| | value |
| --- | --- |
| action | `deactivateClient` |
| secret | **`DEACTIVATE_CLIENT_SECRET`** (dedicated, new — not `STOP_FLAG_SECRET`) |
| payload | `{ action, secret, phone }` (phone already canonical from the sender) |
| response | `{ ok:true, deactivated:N }`; orphan → `deactivated:0` |
| transport | Apps Script → Apps Script (no Node/Railway env var) |

The sender calls this **fail-closed, before** its own local delete, so a patient is
never gone on the therapists side while still active on Vered's.

## Router

Registered in `doPost` only (POST-only, like `flagStop` / `setClinicalType`) —
secret pulled from `payload.secret` or `?secret=`, checked by `_deactivateAuthOk`,
then dispatched to `_deactivateClient` (which re-checks auth, like
`_resolveStopFlagByPhone`). Not added to `doGet`.

## Tests (`test/deactivate-client.test.js`)

Code.gs can't be `require`d in Node, so the suite mirrors the logic and **parses
`CLIENTS_HEADERS` and the `DEACTIVATED_CLIENT_STATUS_HE` value out of Code.gs** (no
re-typed values). 16 cases:

- the deactivation status is its own value (`לא פעיל`), not the discharge status
- auth is **fail-closed** (unset / empty / wrong rejected; exact match ok), and
  `_deactivateAuthOk` reads `DEACTIVATE_CLIENT_SECRET`, **never** `STOP_FLAG_SECRET`
- deactivates by phone (soft — row/fields kept), incl. via `treatmentContactPhone`
  / `payerPhone`
- **dropped-leading-zero** (numeric) and `+972`/dashes phones still match
- **no match → `{ ok:true, deactivated:0 }`** (orphan-safe); empty list safe;
  invalid phone rejected before any scan
- idempotent (already-deactivated → 0); all rows sharing a phone counted
- a deactivated client is **excluded from `getTreatmentPlans` AND `getDebtStatus`**,
  while a discharged (`סיים טיפול`) client stays in both

All tests green (`npm test`).

## Files touched

- `apps-script/Code.gs` — `DEACTIVATED_CLIENT_STATUS_HE`, `_deactivateAuthOk`,
  `_deactivateClient`, the `deactivateClient` dispatch in `doPost`, and the
  status-exclusion guard in `_getTreatmentPlans` / `_getDebtStatus`. **Requires an
  Apps Script redeploy.**
- `test/deactivate-client.test.js` — new.
- `CHANGELOG.md`, `CHANGELOG-deactivate-client.md`, `README.md`.

## Not in this step

No therapists-side sender (ships in ezone-therapists PR #24), no dashboard UI for
the new status, no Sheets migration. Receiver only.

## Deploy / config (required before this works live)

1. **Redeploy the Apps Script web app** to the existing deployment (`…FOwWYIw`):
   Apps Script editor → **Deploy → Manage deployments → ✏️ → Version: New version →
   Deploy**. The new action lives in `Code.gs`, so a fresh `/exec` version is
   required.
2. **Set the `DEACTIVATE_CLIENT_SECRET` Script Property** (Apps Script editor →
   Project Settings → Script Properties). Until it is set, the endpoint fail-closes
   and rejects every call. Provision the **same value** on the **E-Zone Therapists**
   Apps Script (the sender). **No new Node/Railway env var** — this is an Apps
   Script → Apps Script call.
