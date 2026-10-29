# «היום שלי» — CRM opening screen for the Outpatient app (OP-CRM-1, 2026-10-29)

First step of turning this app into the second CRM surface, on the same model as
the Dashboard CRM (E-Zone-Dashboard `docs/crm/SPEC`). Stage-0 mapping and the
open handoff gaps (G1–G3) are in `docs/crm/OUTPATIENT-STAGE0.md`.

## What changed

- **New `public/my-day.js`** — pure UMD model `MyDay.build({ leads, clients, stopFlags, extraRequests, continuation, today, user, renewalInfo })`.
  No DOM, no fetch, no clock: `today` (Asia/Jerusalem day) and the app's own `renewalInfo(client)` rule are injected, so
  `node --test` exercises it directly.
  - **Queues by domain:** פניות ושיחות היכרות (`lead_new`, `intro_unscheduled`, `intro_passed`, `intro_scheduled`),
    תוכניות טיפול להפעלה (`plan_to_activate`), חידושים וגבייה (`renewal_overdue`, `renewal_due` — money), ממתין לאישור שלך
    (pending stop flags + extra-treatment requests), המשך טיפול ועצירות (continuation meetings without an outcome).
  - **Urgency is never a lead's age** (spec §1): a new lead is «ללא מועד» with the action «ליצור קשר ולתאם שיחת היכרות»; an intro
    whose date passed without a decision is an **exception**; a dated item is late only after its date; today + time = binding.
  - **Cards count the same rows as the lists**; a source that did not load gives `null` → «המידע אינו זמין», never 0.
  - **Money hidden for דנה** (`NO_MONEY_USERS`): no renewal rows, no renewals card/domain, «המשך טיפול ועצירות» card instead.
    Honest limit: display rule only — the server still sends money to every signed-in name (gap G3, planned server-side).
- **`public/index.html`** — first tab reads «היום שלי» (`data-view="dashboard"` unchanged so deep links/tests keep working);
  `#myDay` renders first; locator / credits / renewals / stop-flag / extra-request panels stay; the KPI row and breakdown
  grids move into a collapsed `<details class="panel my-day-metrics">` («📊 מדדים ופילוחים»). `my-day.js` loads cache-busted
  after `continuation-logic.js`.
- **`public/app.js`** — `renderDashboard()` ends with `renderMyDay()`; cards toggle a domain filter; each row has one direct
  action (`myDayOpen`): lead → lead modal, client → clients tab filtered by name, stop flag / extra request → scrolls to its
  panel, continuation → המשך טיפול tab with the name searched. All sheet text reaches `innerHTML` through `escapeHtml`.
- **`public/style.css`** — `.my-day` / `.md-*` styles on the existing dark theme tokens (the light Monday-style theme is OP-CRM-4).
- **SW cache** `ezone-outpatient-v20 → v21` (`index.html` is in the precached shell). `my-day.js` is not precached (same as `app.js`).
- `apps-script/**` **not touched** — no Apps Script release for this PR.

## Not changed

Server routes, sheets, auth, roles, money logic, the leads kanban, the clients tab. The Dashboard → Outpatient `createLead`
handoff is unchanged (verified against the rules in `docs/crm/OUTPATIENT-STAGE0.md` §4; fixes are OP-CRM-2).

## Security

No new endpoints, no new secrets, no new data exposed; the view only re-arranges data the session already receives.
Output is escaped; the model tolerates null/garbage rows. `npm audit`: 0 high / 0 critical.

## Tests

`test/my-day.test.js` (12): queues per stage, no urgency by lead age, ordering, plans, renewals via injected rule, approvals +
continuity filters, card/list parity, דנה money hiding, null-not-0, garbage tolerance, index/app wiring, SW v21+.
Full suite green.

## Release

Draft PR → Sandra's approval (repo rule 4) → merge → `/api/version` = merge SHA → hard refresh, `/sw.js` shows `v21`.
Confirm the LIVE SW version is still `v20` before merging (the workspace could not reach production).
