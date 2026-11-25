# CHANGELOG — «שבועיים» frequency unit (once every two weeks)

## Summary
Vered often needs «טיפול פרטני — 1 every two weeks». The frequency unit menu
next to every treatment type's count is now **שבוע / שבועיים / חודש** (was
שבוע / חודש). Applies to all treatment types and to every form that renders
the frequency host: עריכה, חידוש ותשלום (package change), lead, activation,
direct intake.

## Storage — no schema change
Same reserved `_units` key inside the existing `sessionsPerWeek` JSON blob
(see CHANGELOG-session-frequency-unit.md):

    {"פרטני":1,"_units":{"פרטני":"שבועיים"}}

The stored value is Hebrew to match the existing `שבוע` / `חודש` values in
production rows (mixing an English key into the same enum would break the
blob's consistency). No `*_HEADERS` change.

## Behaviour
- Card / lead chips: «פרטני: 1/שבועיים».
- Monthly quota (`_planMonthlyQuota` → `_sessionsPerMonth`): שבוע ×4,
  שבועיים ×2, חודש ×1; unknown/blank unit stays weekly (legacy rule). This
  feeds `getTreatmentPlans.monthQuota` (therapists app counter) and the
  `recordSessionOutcome` credit engine (3rd session in a month on a «1 /
  שבועיים» plan draws a credit).
- The two-therapist pickers for פרטני stay tied to «2+ a **week**» — a
  biweekly plan never shows them.
- Package-change detection in חידוש ותשלום compares units, so switching
  «1/שבוע» → «1/שבועיים» is a package change (re-anchors packageChangeDate).

## Security / validation
- Closed set `SESSION_UNITS` in `public/charges-logic.js`, `public/app.js` and
  `apps-script/Code.gs` (mirrors, guarded by a source-scan test).
- Server-side renewal validator (`invalid_renewal_package`) accepts only the
  closed set; any other unit is refused before the journal writes anything.
- Client parsers drop unknown units (fail safe → by-type default).

## Changes
- `public/charges-logic.js` — `SESSION_UNITS`, `isSessionUnit`,
  `sessionsPerMonth`; `sessionUnitFor` / `parseSessionsUnits` /
  `attachSessionsUnits` use the closed set.
- `public/app.js` — mirror helpers; unit `<select>` built from `SESSION_UNITS`.
- `apps-script/Code.gs` — `SESSION_UNITS`, `_sessionsPerMonth`,
  `_planMonthlyQuota` uses it; renewal validator uses `SESSION_UNITS`.
- `public/sw.js` — cache v46.
- Docs: README (quota note), `docs/USER-GUIDE.he.md`, `EZONE-ECOSYSTEM-STATUS.md`.

## Tests
`test/session-unit-biweekly.test.js` (8): unit set, parse/resolve/round-trip,
`sessionsPerMonth`, source-scan mirror guard, Code.gs quota, projection +
credit engine, renewal accept/refuse, and a real-browser עריכה save that shows
«1/שבועיים» and re-selects it. Full suite: 2639 tests, 0 failures.

## Release
1. Merge to `claude/youthful-volta-laarnk` → Railway.
2. Dispatch **Deploy Apps Script** with `expected_commit` = merge SHA (Code.gs
   changed — without it, a renewal with «שבועיים» is refused and the quota
   counts it as weekly).
3. Therapists app follow-up: accept `"שבועיים"` in its `_units` parser so the
   plan line shows «1/שבועיים» there too (`monthQuota` is already correct).
