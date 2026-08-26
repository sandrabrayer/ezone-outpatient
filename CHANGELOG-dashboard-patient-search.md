# CHANGELOG — Dashboard cross-tab patient locator (איתור מטופל)

## Summary
New search panel on the dashboard that finds a patient across EVERY store at
once — Clients rows of any status, deleted patients (Clients-removed
tombstones) and orphan billing rows — and says which tab (or recovery action)
owns them.

## Problem (live incident, 2026-08-26)
Every list tab searches only its own slice. A patient whose Clients row was
dropped existed only as orphan Payments rows: findable in the גבייה monthly
summary, invisible in מטופלים AND מטופלים לא פעילים. There was no single
place to ask "where is מנשה וקנין?" — the answer required cross-referencing
raw sheet data.

## Changes
- public/patient-search.js (NEW)
  - Pure UMD module (the name-search.js pattern; requireable in tests,
    `window.PatientSearch` in the browser). `searchPatients(query, {clients,
    removedClients, payments})` classifies matches into:
    - `kind:'client'` → tab `'clients'` (any live status) or `'inactive'`
      (סיים טיפול / לא פעיל);
    - `kind:'removed'` → un-restored tombstones; duplicates per id collapse
      to the LATEST (matching restoreRemovedClient's bottom-up pick), and a
      live id never shows a tombstone row;
    - `kind:'billing-only'` → payment rows whose clientId matches no client
      and no tombstone (the incident signature), aggregated per clientId
      with row count + total collected. Matched on the payment's
      denormalized `clientName` — the name the user knows even after a
      card rename.
    Matching is the shared NameSearch rule (trimmed, case-insensitive
    substring); a blank query returns nothing (a global locator shows no
    list at rest).
- public/index.html
  - 🔎 איתור מטופל panel on the dashboard (input `#dashPatientSearch`,
    results `#dashPatientResults`); `patient-search.js` script tag after its
    `name-search.js` dependency, before `app.js`.
- public/app.js
  - `state.dashSearch` + input wiring + `renderDashPatientSearch()` called
    from `renderDashboard`.
  - Result rows: name + status chip (נמחק / גבייה בלבד / the client's
    status). A client result offers "פתח ב…" which jumps to the owning tab
    with its per-tab search prefilled (state + input synced). A removed
    result shows when/how the row was removed and offers the editor-only
    שחזר מטופל (same `performRestoreRemovedClient` flow as the inactive
    tab). A billing-only result shows the orphan row count + total collected
    and opens גבייה prefiltered.
  - Tombstones are fetched lazily on the first search (shared
    `ensureRemovedClients`), so the dashboard load pays nothing.

## Verification
- test/patient-search.test.js: the module is required directly — clients of
  every status route to the right tab; duplicate tombstones collapse to the
  latest; a live id suppresses its stale tombstone; orphan payments aggregate
  (count + sum) and never double-report a tombstoned patient; NameSearch
  matching semantics — plus source-scan guards over the panel markup, script
  order, wiring, lazy tombstone fetch, editor-only restore and the
  prefilled-navigation contract.
- `npm test`: full suite green.
