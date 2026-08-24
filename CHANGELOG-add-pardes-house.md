# Add house: רעננה הפרדס (canonical id `pardes`)

**Date:** 2026-08-24
**Scope:** Wire the newly-opened רעננה הפרדס house (canonical ecosystem id
`pardes`, house type תחלואה כפולה — same as עפרוני) into every house surface of
the Outpatient app. The house is already live in coordinators, staffing,
managers, and the shared dashboard backend.

## What this repo already knew (from the day-center era + continuation tab)

`רעננה הפרדס` predates this change in most enumerations, because the day-center
operates at that site and the continuation tab consumes the dashboard roster:

- `LOCATIONS` (סניף) — `'רעננה הפרדס'` already listed (first).
- `HOUSE_OF_ORIGIN_LABELS` — stable key `raanana_pardes → 'רעננה הפרדס'`
  already present; all `index.html` selects (4 × סניף, 3 × בית מוצא) already
  carry it.
- Continuation tab — `CONTINUATION_HOUSE_LABELS.pardes` and
  `HOUSE_TO_ORIGIN.pardes → 'raanana_pardes'`
  (`public/continuation-logic.js`) already present.

## The actual gap: inbound `createLead`

When the dashboard discharges a pardes patient with disposition "released to
outpatient care", it POSTs `createLead` with `house: 'pardes'`. Code.gs stored
unknown keys verbatim (by design, never-fail), so the lead landed with
`house_of_origin: 'pardes'` — a key `houseOfOriginLabel()` cannot label, i.e.
an empty בית מוצא chip on the lead card.

## Changes

- **`apps-script/Code.gs`** (isolated commit; requires Apps Script redeploy —
  automatic, see Deploy):
  - `CREATE_LEAD_HOUSE_KEYS`: added `pardes` as a known dashboard house id.
  - New `CREATE_LEAD_HOUSE_ALIASES = { pardes: 'raanana_pardes' }`;
    `_mapLeadHouse` now translates the canonical ecosystem id to this repo's
    stable stored key — the exact mapping the continuation tab already uses.
    Stable code keys are never renamed; `raanana_pardes` stays the one stored
    key for the house. All other keys (known and unknown) still pass through
    verbatim and never fail the write.
- **`public/app.js`** — `HOUSE_OF_ORIGIN_LABELS` gained a display alias
  `pardes: 'רעננה הפרדס'`, so any lead row written verbatim as `'pardes'`
  before the Code.gs remap deployed still labels correctly.
- **Tests**
  - `test/create-lead.test.js` — mirror updated in lockstep; new cases:
    `'pardes'` (and `' pardes '`) → stored `'raanana_pardes'`; new source
    guard that Code.gs knows `pardes` and aliases it.
  - `test/house-enumerations.test.js` (new guard) — every house enumeration
    (HOUSE_TO_ORIGIN live; CONTINUATION_HOUSE_LABELS, HOUSE_OF_ORIGIN_LABELS,
    LOCATIONS, all index.html selects, CREATE_LEAD_HOUSE_KEYS via source
    guard) must cover the canonical 5-house list
    (`arfoni / asher / pardes / ramot / rehab`).

## Not needed here (checked)

- **Per-house sheet tabs:** none — every sheet (Clients, Leads, Payments,
  ClientCharges, SessionLog, Continuation, …) is row-keyed; houses are column
  values. No seeding, no manual tab creation.
- **Per-house parameters:** none exist in this repo (no thresholds/tiers/
  rates keyed by house), so nothing to copy from עפרוני despite the same
  house type.
- **House-scoped PINs / digests:** none — the PIN is app-wide (`APP_PIN`),
  and this repo produces/consumes no digests.
- **4-house assumptions:** none found; all tallies iterate the enumerations
  (e.g. the occupancy chart pre-seeds zeros from `LOCATIONS`, so the new
  house shows an honest 0 until it has patients).

## Empty states (new house starts with no data)

- Occupancy chart: `רעננה הפרדס: 0` (pre-seeded zero, not an error).
- Continuation tab: pardes patients appear when the dashboard roster includes
  them (labels already wired); an empty roster section simply doesn't render.
- Leads/patients: pardes rows appear as they are created; nothing errors on
  their absence.

## Deploy

Merging to `claude/youthful-volta-laarnk` deploys **both** layers
automatically:

- Railway auto-deploys the frontend/server from the branch.
- The Code.gs change triggers `.github/workflows/deploy-apps-script.yml`
  (clasp CI), which publishes a **new VERSION of the EXISTING deployment** —
  the `/exec` URL never changes. No manual step; verify the "Deploy Apps
  Script" Actions run is green after merge.
