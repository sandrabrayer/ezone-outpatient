# Discharge persist fix — «סיים טיפול» did not stick (2026-11-02)

## Symptom

Vered discharged a patient twice with «סיים טיפול». Each time she saw
«סיום נשמר», but after the refresh the card was back as «הפסקה זמנית».
Production data: the Clients row had `updatedAt` 2026-11-02 10:32 UTC by ורד
(a notes edit) and status still `הפסקה זמנית`. No pending financial operation
on that client.

## Root cause

1. `saveAll` re-stamps `updatedAt` on every changed row, but the response did
   not return the new stamps. The tab kept the stamp it loaded.
2. The next save of the **same row from the same tab** echoed the old stamp,
   so the stale-save guard (`_staleConflictCols`) read the tab's own previous
   edit as another person's change and **refused** the row.
3. The discharge submit used plain `persist()`, which resolves normally on a
   refusal (it shows the conflict banner and reloads). The handler then
   toasted «סיום נשמר», and the reload restored the old status.

Any "edit the card, then do something else on the same card" sequence hit
this (edit → status change, edit → discharge, …); discharge was the visible
one.

## Fix

- **Code.gs `saveAll`**: additive response field
  `stamps: { clients: {id: updatedAt}, leads: {id: updatedAt} }` — stamps only,
  no row content (helper `_stampMapById`).
- **public/app.js `persist()`**: new `applySavedStamps(data)` adopts those
  stamps into `state` after every save; rows listed in `conflicts` are skipped;
  non-string / oversized values ignored; old backends (no `stamps`) = no-op.
- **Discharge submit**: uses `persistClientChange` (refusal throws). If the
  Clients save was not stored, the optimistic status/exitDate are rolled back
  and the toast says «סיום הטיפול לא נשמר: …». A stored discharge is never
  rolled back (credit/stop-flag failures after it behave as before).
- SW cache `v21 → v22`.

Conflict protection is unchanged: a real concurrent edit by someone else is
still refused (test B2).

## Tests

`test/discharge-persist.test.js` — server stamps map, the exact repro
(edit → discharge from one tab), real concurrency still refused,
`applySavedStamps` behaviour, discharge handler contract.
`test/credits-ledger.test.js` scoped to the success branch;
`test-support/financial-ui-fixture.cjs` registers `applySavedStamps`.
Suite: 1700/1700.

## Deploy

Code.gs changed → after merge, dispatch **Deploy Apps Script** with
`expected_commit` = merge SHA. Frontend is safe before the Apps Script deploy
(no `stamps` → no-op; discharge still reports a refusal honestly).

## Data

Nothing is changed by code. The affected patient only needs one more
«סיים טיפול» after a refresh (a fresh page load carries the current stamp).
