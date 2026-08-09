# Editable collection amount (סכום גבייה) — append-only override

## What & why

The גבייה tab's "יתרות פתוחות מתאריכים קודמים" rows showed a collection amount
that was fully computed — the base row from the client's package price
(`pricePerSession`), the extra-charge row from the charge's `amount`. There was
no way to correct a single open balance (e.g. a one-off discount or a manually
agreed amount) without editing the package price or the charge itself, which
would ripple to every other month/row that derives from the same source.

This adds a **manual collection-amount override** editable per open-balance row.
It is an **append-only override LAYER**, never a rewrite of any source:

- The read side prefers the override over the computed amount.
- The monthly summary (סיכום חודשי) totals use the effective (overridden) amount.
- The package price and the charge source rows are **never** touched.

## Storage — append-only, keyed by payment id

A new column **`paymentAmountOverrides`** is appended at the **very END** of
`CLIENTS_HEADERS` (position 34). It holds a JSON map `{ "<paymentId>": <amount> }`
of manual corrections for that client's open-balance rows. Every payment id
embeds its client id (`pay::<clientId>::base::<YYYY-MM>` /
`pay::<clientId>::chg-<chargeId>::<…>`), so an override always lives on the
owning client's row.

The column is strictly append-only per the frozen-physical-order rule
(`_readAll`/`_writeAll` are positional; `_ensureSheet` relabels but never
migrates). Old rows read back blank → `{}`.

## Backend (`apps-script/Code.gs`)

- `CLIENTS_HEADERS` gains the trailing `paymentAmountOverrides` column.
- `_parseAmountOverrides(v)` — tolerant JSON-cell → map parser (blank/garbage → `{}`).
- `_writePaymentAmountOverride(clientsSh, clientId, paymentId, amount)` — a
  **single-cell** read-merge-`setValue` located by scanning the id column, with
  columns derived via `CLIENTS_HEADERS.indexOf(...)` (never a literal). Mirrors
  `_writeCreditsOwed`. A blank/`null` amount deletes the key (revert to computed);
  an emptied map writes a blank cell.
- `_setPaymentAmountOverride(payload)` — validates `clientId`/`paymentId` and a
  non-negative finite amount, then writes under `LockService` (no `_writeAll`).
- Router: new `savePaymentAmountOverride` action (internal, same-origin via the
  Node proxy — no cross-app secret, same trust level as `savePayment`).
- `_saveAll` now **preserves `paymentAmountOverrides` by id** (like `creditsOwed`)
  so a stale full-sheet save can't clobber a newer single-cell override write.

## Frontend (`public/app.js`, `public/index.html`, `public/style.css`)

- `normalizeClientFromSheet` parses the JSON cell → map; `clientForSheet`
  serializes it back to a JSON string (round-trip alignment on any full save).
- `overrideAmountFor(payment)` / `effectivePaymentAmount(payment, computed)` —
  the shared read helpers (override → computed fallback → `amountDue`).
- `buildBillingRow` renders the **effective** amount and, on open-balance (carry)
  rows for editors only, a small ✏️ next to the יתרה amount plus a ✎ marker when
  an override is active.
- `renderBillingMonthlySummary` uses the effective amount for the outstanding KPI
  and the per-client breakdown.
- New `#editAmountModal` (cloned from the per-charge edit-modal pattern): prefilled
  with the current effective amount, validates a positive number, supports
  "שחזר לסכום מחושב" (clear the override). Save is **optimistic** — updates the
  in-memory map and re-renders, then persists via `savePaymentAmountOverride`,
  **rolling back** the map on failure.

## Tests

`test/collection-amount-override.test.js`:

- Read-precedence (override > computed; blank/missing/malformed → computed, never NaN).
- Monthly outstanding total reflects the override (incl. partial-payment netting).
- Override-cell merge/parse (set/update/clear; empty map → blank cell; malformed → `{}`).
- Source guards that the real wiring matches: appended column, header-derived
  single-cell writer, validated + lock-guarded handler, routed action,
  `_saveAll` preserve-by-id, effective-amount used in the row + both monthly totals,
  the ✏️ gated to carry rows + editor, optimistic-save-with-rollback, JSON
  round-trip, and the modal's positive-number validation.

The `CLIENTS_HEADERS` guard suites (`clients-column-order`, `clinical-derive`,
`stop-flag-match`, `continuation-code`, `lead-assignee`, `responsible-removal`,
`session-credits`) were updated for the single appended column — the append is
deliberate and sheet-safe (nothing before it moves).

Pre-existing, unrelated failures (`debt-status-forwarding`,
`sheets-secret-forwarding`) are left as-is.
