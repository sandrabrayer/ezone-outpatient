# CHANGELOG — Urgency sort for מטופלים cards

## Summary
Patient cards on the מטופלים screen are now ordered by urgency, so alerts sit at
the top instead of being buried. Red (payment-overdue / עצור טיפול) cards come
first, then renewals by soonest, then everyone else in their existing order.

## Problem
`renderClients` appended cards in raw `state.clients` order, so an overdue /
renewal-due card could sit anywhere in a long list and be missed.

## Sort order (most urgent first)
1. 🔴 **Red — overdue / עצור טיפול** (`renewalInfo` status `overdue`), ascending
   by daysLeft so the MOST overdue floats highest. A card that is both overdue
   AND renewal-due is already resolved to `overdue` by `renewalInfo`, so it lands
   in this tier.
2. 🟠 **Renewal due** (`due_soon`), ascending by daysLeft — חידוש היום (0) before
   בעוד N ימים.
3. ⚪ **Everyone else** (`ok` / `unknown`) — stable, keeps incoming order.

## Design
- **Single source of truth.** The sort reuses `renewalInfo(c)` — the SAME
  function the red/renewal banner reads (which itself anchors on the persisted
  `nextBillingDate` via `nextRenewalDueDate`). Urgency is never recomputed
  independently, so the sort and the banner can't diverge.
- **Render-time only.** No stored data changes. `renderClients` decorates the
  already-filtered `visible` array with `{ client, tier, daysLeft, index }`
  (computing `renewalInfo` once per card), sorts, and renders.
- **Provably stable.** The comparator's final tiebreak is the original index, so
  tier-2 cards (and any ties) keep their incoming order regardless of the JS
  engine's sort stability.

## Changes
- public/charges-logic.js (exported, unit-tested)
  - `urgencyTier(status)` — 0 overdue / 1 due_soon / 2 other.
  - `compareCardUrgency(a, b)` — tier asc; within tiers 0 & 1 daysLeft asc
    (null last); else original index.
- public/app.js (inline mirrors — "keep both in sync")
  - Added `urgencyTier` / `compareCardUrgency` next to `renewalInfo`.
  - `renderClients` decorates `visible`, sorts with `compareCardUrgency`, renders.

## Tests
- test/card-urgency-sort.test.js (9 cases): tier precedence, both-red-and-renewal
  → red, red ascending by daysLeft, due_soon ascending, null-daysLeft last, tier-2
  stability, tie stability, full mixed list. All pass.
- Full suite: 156/158. The 2 failures (`debt-status-forwarding`,
  `sheets-secret-forwarding`) are pre-existing `server.js` forwarding tests
  unrelated to this change.

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Verify (manual, after deploy)
- A patient with an overdue/עצור-טיפול banner appears at the very top.
- Renewal-due patients follow, soonest (חידוש היום) first.
- Non-urgent patients keep their previous relative order.
