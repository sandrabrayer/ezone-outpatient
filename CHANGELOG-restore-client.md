# שחזר לטיפול — restore a discharged patient (v1)

Reverses סיים טיפול from the retention tab. Before this, discharge was a
one-way door: the "סיימו טיפול" cards in שימור לידים were display-only, and the
only way back was a manual sheet edit.

## What it does

- **New button "שחזר לטיפול"** (editor-only, ghost style) on each discharged
  card in the retention tab — the exact pattern of the existing שחזר לליד
  button on not-relevant leads.
- Clicking opens a **confirm modal** (`#restoreClientModal`) that names the
  patient, explains that billing resumes from today, and **lists the patient's
  ACTIVE extra charges** (חיובים נוספים) — restore leaves them untouched and
  they resume billing, so Vered sees them up front and can remove stale ones
  right after the restore.
- Confirming performs an **optimistic four-field write** + `persist()` (full
  rollback + re-render on failure, matching the status-dropdown pattern):

  | field | new value | why |
  | --- | --- | --- |
  | `status` | `'פעיל'` | back to the active roster |
  | `exitDate` | `''` | cleared — the exit modal re-sets it on any future discharge |
  | `packageChangeDate` | today | billing re-anchor: גבייה הבאה = restore date + 1 month |
  | `nextBillingDate` | `''` | **load-bearing**: `nextRenewalDueDate` prefers a stored `nextBillingDate` over `packageChangeDate`, so the stale date must be cleared or the patient is flagged months-overdue the moment they return |

- Everything else follows automatically because it derives live from `status`:
  the patient reappears in the patients tab and KPIs, leaves the retention and
  win-back lists, and rejoins the `getDebtStatus` / `getTreatmentPlans`
  projections. Payment history, package, price, frequency, phones, notes and
  credit balance are untouched (discharge never wiped them).

## Scope decisions (locked at design time)

- **Discharge-only.** The guard is `status === 'סיים טיפול'` — the cross-app
  `'לא פעיל'` status (set by the therapists-app delete propagation,
  `deactivateClient`) is deliberately NOT restorable from the UI: that would
  unilaterally undo a delete made in the other app. Hard-deleted patients (✕)
  cannot be restored at all — no archive sheet exists for Clients.
- **Extra charges resume untouched** — surfaced in the confirm modal rather
  than auto-deactivated, so legitimately-continuing charges are not lost.

## No backend surface

Frontend-only: the restore rides the ordinary `persist()` → `saveAll`
clear-and-rewrite (all four fields already round-trip through
`clientForSheet`). **No new Code.gs action, no new CLIENTS_HEADERS column, no
server.js change, no Apps Script redeploy, no new secret** — and a test locks
exactly that.

## Files touched

- `public/app.js` — `openRestoreClientModal` / `closeRestoreClientModal` /
  `submitRestoreClient`, the retention-card button, confirm-button wiring, and
  the global `data-close` chain.
- `public/index.html` — the `#restoreClientModal` markup.
- `test/restore-client.test.js` — new (12 cases): pure mirrors of the
  four-field write (only-those-fields, no-op guards incl. `'לא פעיל'`), the
  re-anchor interplay asserted against the REAL `nextRenewalDueDate`
  (including why clearing `nextBillingDate` is load-bearing), the active-only
  charges listing, and source-scan guards locking the inline handler, the
  editor-only button, the modal markup, and the no-backend-surface contract.
- `CHANGELOG.md`, `CHANGELOG-restore-client.md`.

All tests green (`npm test`, 550 passing).
