# CHANGELOG — Selectable session-frequency unit (שבוע / חודש) per service

## Summary
The add/edit forms now let Vered choose the frequency **unit** (שבוע / חודש)
per treatment type, alongside the count — defaulting by type so the common case
needs no interaction, but overridable per patient. The chosen unit is persisted
and the card reads it back.

## Problem
`renderSessionsHost` hardcoded the label "מפגשים בשבוע — {service}" and offered
only a count input, with no way to choose the unit. The unit was derived purely
by type at display time (`sessionFrequencyUnit`: מעקב פסיכיאטרי → חודש, else
שבוע), so e.g. a patient who needs psychiatric follow-up *weekly*, or another
treatment *monthly*, could not be expressed.

## Behaviour
- **Default by type:** the unit select pre-selects `sessionFrequencyUnit(svc)`
  (מעקב פסיכיאטרי → חודש, all others → שבוע). No interaction needed for the
  common case.
- **Override:** Vered can pick שבוע or חודש per service; the choice is saved.
- **Backward compatible:** records with no stored unit fall back to the by-type
  default, so existing patients (e.g. נעם → "1/חודש", others → "…/שבוע") render
  exactly as before.

## Storage — no schema / Code.gs / Apps Script change
`sessionsPerWeek` is already a single JSON-string column that Code.gs maps
positionally and treats as opaque. The per-service unit overrides are stored
**inside that same blob** under a reserved `_units` key (the same reserved-key
pattern already used for `_total`):

    {"פרטני":2,"מעקב פסיכיאטרי":1,"_units":{"מעקב פסיכיאטרי":"חודש"}}

`_units` is omitted entirely when no override applies, so override-free records
serialize byte-for-byte as before. No new column, no `HEADERS` change in
apps-script/Code.gs, no Apps Script redeploy.

## Changes
- public/charges-logic.js (exported, unit-tested)
  - `sessionUnitFor(serviceType, units)` — valid override wins, else by-type
    default.
  - `parseSessionsUnits(v)` — read `_units` from an object or JSON-string blob;
    drops invalid units.
  - `attachSessionsUnits(breakdown, units)` — build the serializable object with
    a `_units` map of valid overrides only (omitted when none).
- public/app.js (inline mirrors of the above — "keep both in sync")
  - Label changed to neutral "תדירות הטיפול — {service}".
  - `renderSessionsHost` adds a per-service unit `<select>` (שבוע / חודש),
    defaulting via `sessionUnitFor`; gains an optional `unitValues` arg so unit
    selections survive a service-list re-render.
  - New `readSessionsUnits(host)`; `parseSessionsBreakdown` ignores `_units`;
    `formatSessionsBreakdown(b, units)` attaches `_units`.
  - In-memory model carries a parallel `sessionsUnit` map (set on load via
    `parseSessionsUnits`, and in every save path: lead/agreement/activate/
    direct-create/edit). `clientForSheet`/`leadForSheet` serialize it back into
    the blob.
  - Card display (patient card + lead-card chips) reads the stored unit via
    `sessionUnitFor`, falling back to the derived unit when absent.

## Tests
- test/session-frequency-unit.test.js (10 cases): by-type default, override
  wins, invalid-override fallback, parse from string/object, no-`_units`
  serialization, round-trip. All pass.
- Full suite: 147/149. The 2 failures (`debt-status-forwarding`,
  `sheets-secret-forwarding`) are pre-existing `server.js` network-forwarding
  tests unrelated to this change.
- The DOM wiring in renderSessionsHost/readSessionsUnits is browser-only (app.js
  IIFE, no jsdom harness in the repo); the pure logic it depends on is covered
  by the tests above.

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Verify (manual, after deploy)
- Add patient with מעקב פסיכיאטרי → unit pre-selects חודש; with פרטני → שבוע.
- Override a פרטני patient to חודש, save, reload → card shows "…/חודש".
- Existing patients (נעם) unchanged: "1/חודש".
