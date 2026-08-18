# מטופלים לא פעילים — dedicated tab + the לא פעיל visibility/billing fix

Follow-up to `CHANGELOG-restore-client.md`. Two motivations:

1. **Taxonomy** (Sandra's point): a lead is someone who has not started
   treatment — a discharged patient is NOT a lead, yet the שימור לידים tab
   mixed not-relevant leads with discharged patients.
2. **A live inconsistency**: cross-app-deactivated patients (`לא פעיל`, set by
   the therapists-app delete propagation) still appeared in the main patients
   list (its filter excluded only `סיים טיפול`) and kept generating גבייה due
   items — a patient deleted in the therapists app kept billing here.

## What changed

### New top-level tab "מטופלים לא פעילים"

Eighth nav tab (`data-view="inactive"`, standard `view-inactive` section +
`renderInactive()` + per-tab search `state.inactiveSearch`). Patients only,
two sections:

- **סיימו טיפול** — Vered's manual discharges (moved here from שימור לידים),
  green badge, shows the exit date.
- **לא פעילים** — cross-app deactivated, red badge, with a
  "מקור: הוסר באפליקציית המטפלים" row. These patients previously had NO
  dedicated surface anywhere in the UI.

Both card kinds carry the editor-only **שחזר לטיפול** button into the same
restore confirm modal.

### שימור לידים is leads-only again

`renderRetention` no longer reads `state.clients`; the "סיימו טיפול" section
moved to the new tab. Header text updated accordingly.

### לא פעיל hidden + billing stopped (the fix)

`לא פעיל` now behaves like `סיים טיפול` in all three status gates:

- `renderClients` — hidden from the main patients list (lives in the new tab)
- `clientsDueOn` — no more גבייה due items
- `renewalInfo` — no renewal urgency/banners

(`הפסקה זמנית` deliberately unchanged: paused patients still bill.)

### Restore widened to לא פעיל

`submitRestoreClient` now accepts both inactive statuses (was:
discharge-only). Same four-field write (`status='פעיל'`, `exitDate` cleared,
`packageChangeDate=today`, stale `nextBillingDate` cleared). No sender call
needed: flipping the status re-adds the patient to the
`getTreatmentPlans`/`getDebtStatus` projections, which the therapists roster
unions as base sources — so the patient reappears there on its next build.

## Still frontend-only

No Code.gs change, no new CLIENTS_HEADERS column, no server.js change, no
Apps Script redeploy, no new secret (the no-backend-surface test still
guards this).

## Files touched

- `public/app.js` — `renderInactive` (new), `renderRetention` (leads-only),
  the three status-gate fixes, widened restore guard, view dispatch + search
  wiring + `inactiveSearch` state.
- `public/index.html` — nav button, `#view-inactive` section, retention
  header text.
- `test/inactive-patients-tab.test.js` — new (11 cases): filter mirrors +
  source-scan guards for the tab wiring, both section builders, the
  leads-only retention, and all three status gates.
- `test/restore-client.test.js` — updated for the widened restore contract
  (לא פעיל flips too; button now scanned inside `renderInactive`).
- `CHANGELOG.md`, `CHANGELOG-inactive-patients-tab.md`.

All tests green (`npm test`, 562 passing).
