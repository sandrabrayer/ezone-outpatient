# CHANGELOG — Preferred house (`preferredHouse`, בית מועדף)

## Summary
Outpatient clients get an optional **preferred house** (בית מועדף). Staff set it
from a dropdown in the add/edit client forms, and it is shown on the client card.
The Dashboard → Outpatient `createLead` handoff can now carry it. The value rides
on the new lead and moves to the client when the lead is activated.

Allowed values (exact strings), or blank = none:
`קיסריה עפרוני`, `קיסריה ריהאב`, `רעננה אשר`, `רעננה הפרדס`, `רמות השבים`.

## Schema (append-only)
- `CLIENTS_HEADERS`: `preferredHouse` appended at the very END (position 38,
  after `plannedExitDate`). Nothing was reordered or removed.
- The same column is appended at the very END of `CLIENTS_REMOVED_HEADERS` (so a
  tombstone and `restoreRemovedClient` keep it). It is also appended to
  `LEADS_HEADERS` and `REMOVED_LEADS_HEADERS`: `createLead` writes a **Lead** row,
  not a Client, so the lead needs the column to store the handoff value.
- No migration. Old rows read back blank.

## Validation (server, every write boundary)
`_preferredHouseOrNull(v)` in `apps-script/Code.gs`:
- `undefined` / `null` / `''` / whitespace → `''` (none).
- An allowed label (after trimming) → that label.
- Anything else → **rejected**: non-strings, text longer than 40 characters, a
  leading `=` `+` `-` `@` (formula-safe; no allowed label starts with one), and
  any non-allowed text. Near matches are never coerced.

`public/app.js` keeps the same list (`PREFERRED_HOUSES`) and the same rule
(`preferredHouseOrBlank`). `index.html` keeps it as `<option>`s. One test pins all
three lists to the same values.

## Write paths
- **Edit (existing client):** new internal action `setPreferredHouse`
  (`OUTPATIENT_PROXY_SECRET`, sent through the Node proxy). It validates first,
  then takes the script lock (`LockService`). It writes **one cell** plus the
  who/when stamps (`_writePreferredHouse`, the `_writeCreditsOwed` pattern). It
  never rewrites the sheet. A client with an active financial operation is
  refused (`financial_operation_pending`), because the journal snapshot covers
  the whole row. Errors: `missing_clientId`, `invalid_preferred_house`,
  `client_not_found`, `busy`.
- **`saveAll`:** for an existing client or lead, it always keeps the value already
  on the sheet. A stale or old tab can never change or clear it, and the save is
  not counted as an edit. A brand-new row (direct add or activation) is seeded
  from its validated payload value. An invalid value is not stored.
- **`createLead`:** accepts an optional `preferredHouse`. If it is absent or
  blank, behaviour is unchanged. If it is invalid, the call returns
  `{ ok:false, error:'invalid_preferred_house' }` and no row is appended. The
  `CREATE_LEAD_SECRET` check still runs first in `doPost`, so a bad secret fails
  closed before any field is read. There is **no phone dedupe** in `createLead`
  (unchanged): every valid, authorized call appends a lead.

## UI (Hebrew, RTL)
- Dropdown «בית מועדף» (optional, «— ללא —» = none) in «הוספת מטופל ישירות»
  and «ערוך פרטי טיפול» (section פרטים נוספים).
- The client card shows a «בית מועדף» row under תוכנית טיפול, only when the value is set.
- The lead card shows a «בית מועדף: …» chip when the handoff carried a value.
- Activation copies the lead's value onto the new client.
- Everything is rendered through `escapeHtml`.
- Edit flow: the client save runs first. If the house changed, `setPreferredHouse`
  runs next. If it fails, the local value rolls back and a toast says
  «בית מועדף לא נשמר».

## Service worker
`public/sw.js` cache `ezone-outpatient-v18` → `v19` (production served v18 on
2026-10-26; `/api/version` = `8b68cd7`).

## Dependency
`npm audit fix` (lockfile only): `body-parser` 1.20.8 → 1.20.9, which clears the
existing **high** advisory GHSA-27r3-jxmh-p828. One **moderate** `qs` advisory
remains (no non-breaking fix available).

## Tests
- New: `test/preferred-house.test.js` (21 tests). It runs the real `Code.gs`
  in the sandbox and covers:
  - schema position and the mirrors;
  - the three lists are equal;
  - validation, including formula-like and over-long input;
  - a single-cell write under the lock (whole-range writes throw);
  - auth fail-closed;
  - `saveAll` preservation and seeding;
  - `createLead` with, without and with an invalid field;
  - a bad, missing or unconfigured secret;
  - no dedupe;
  - escaped card/chip rendering, and the form wiring.
- Header-order guard tests are updated for the new tail (38 columns):
  `clients-column-order`, `clinical-derive`, `collection-amount-override`,
  `continuation-code`, `corrupted-rows-cleanup`, `create-lead`, `lead-assignee`,
  `nightly-integrity`, `planned-exit-date`, `responsible-removal`,
  `saveall-tombstone`, `session-credits`, `session-who-when`,
  `stale-next-billing-repair`, `stop-flag-match`, `treatment-plans-phone`.
- `test-support/financial-ui-fixture.cjs` loads the new browser helper used by
  the submit handlers.

## Release
1. Merge (Sandra's approval) → Railway deploys Node. Confirm `/api/version`.
2. Dispatch **Deploy Apps Script** with `expected_commit` = merge SHA
   (`apps-script/**` changed). Until then, the old `Code.gs` ignores the new
   field and does not know `setPreferredHouse`. Editing the house returns an
   unauthorized error and rolls back in the UI. Nothing else is affected.
3. Dashboard (separate repo): to send the field, add `preferredHouse` to its
   `createLead` body. This is not part of this change.
