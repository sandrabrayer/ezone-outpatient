# מסלול המשך as a CRM flow — milestones from the entry date (2026-11-03)

Section 4 of the E-ZONE One Outpatient CRM brief: continuation treatment is offered **before**
the patient reaches one, two and three months of stay, counted from the **actual entry date**
into the house — never from an exit date, a meeting date or the row's creation.

## Business rule (implemented identically in browser and Apps Script)
- Milestones: entry + 1 / + 2 / + 3 **calendar months**, end-of-month clamped (31/01 → 28/02,
  or 29/02 in a leap year), year turns handled, pure date arithmetic (no time-zone drift);
  "today" is Asia/Jerusalem on both sides.
- A **contact task opens 14 days before each milestone**: entry 15/09 → milestones 15/10,
  15/11, 15/12 → contact dates 01/10, 01/11, 01/12.
- **No entry date → no task**; the tab shows «חסר תאריך כניסה».
- The helper is `ContinuationLogic.milestones / addCalendarMonths / addDays`
  (`public/continuation-logic.js`) and `_contMilestones / _contAddMonths / _contAddDays`
  (`apps-script/Code.gs`); `test/continuation-milestones.test.js` runs both on one vector table.

## Tasks / Activity (existing engine, no parallel mechanism)
- Milestone tasks are ordinary rows of the `Tasks` sheet: id **`cont::<ref>::<entryDate>::m1|m2|m3`**,
  kind `continuity`, source `derived`, owner ורד, subject `clientId = 'cont:<ref>'`.
  `<ref>` is the Dashboard patient id when the roster carries one (`id:…`), else the normalized phone
  (`phone:0XXXXXXXXX`) — **never the name**. No id and no valid phone → no task, chip «חסר טלפון/מזהה».
- New source action `syncContinuationMilestones` (proxy secret; **server-only** — `/api/sheets`
  refuses it from a browser). Node runs it from the roster **it fetched itself** right after a
  fresh `getAdmittedRoster` answer and on `POST /api/continuation-sync`. Idempotent: a second sync
  creates nothing; a **corrected entry date moves the open tasks** (new id / due date, one
  `task_rescheduled` event each) instead of duplicating; a patient who **left the roster** (only
  when the roster answered ok) or whose CRM status is terminal gets the open tasks cancelled
  (`discharged` / the status). Milestones already in the past when first seen are not opened.
  Actor of derived rows is `system`. No money, no `*_HEADERS` reorder.
- Follow-up is never closed by the 14 days passing or by an offer being sent — only by a logged
  contact («📞 פנייה» on the milestone) or an explicit ✓ / ✕.

## CRM flow per patient (tab «מסלול המשך»)
- Row: who + house, phone, tenure + entry date, status chip, outcome chip, link chip; a three-cell
  milestone strip (month 1/2/3 with milestone date, contact date, task state and the «📞 פנייה»
  button); CRM lines: last contact + outcome, next contact (next open task), offer (link to the
  pricing tab when an offer is attached), collapsible action history.
- Controls: **status** (`not_contacted` · `in_progress` · `interested` · `postponed` · `declined` ·
  `converted` · `closed` — stable keys, Hebrew at render), **owner** (default ורד), meeting date,
  meeting outcome, note, «📞 יצרתי קשר», «➕ משימה». Choosing `to_outpatient` sets `converted`;
  a terminal status re-syncs and closes the open milestone tasks.
- Linking to outpatient records is by **normalized phone only** (`/^0\d{9}$/`): one client or one
  lead → chip opens it; several → «⚠ לבדיקה ידנית (N התאמות)»; none → nothing. Never by name.
- Workflow sheet «מסלול המשך»: five **appended** columns `crmStatus`, `assignee`, `offerRequestId`,
  `patientRef`, `phone` (validated fail-closed; kept when an older client omits them).
- The roster is now fetched right after boot (server cache ≤60s), so the sync runs when Vered opens
  the app and «היום שלי» can name the milestone rows.

## «היום שלי»
- Milestone tasks are rows of their own (name from the roster, «מסלול המשך · המשך טיפול»); due/late
  ones in the dated sections, future ones in «בהמשך». Every row now shows **last contact + outcome**.
  One row per persisted task; derived rows collapse per subject + reason.

## Files
`public/continuation-logic.js`, `public/app.js`, `public/my-day.js`, `public/style.css`,
`apps-script/Code.gs`, `server.js`. Tests: `test/continuation-milestones.test.js` (11),
`test/continuation-crm-browser.test.js` (2, Playwright 1280px + 360px), updated
`test/continuation-code.test.js`, `test/continuation-roster-forwarding.test.js`.

## Not changed
Billing, renewals, payments, `TherapistRates`, `TASKS_HEADERS` / `ACTIVITY_HEADERS`, the
to_outpatient lead-creation path, the Dashboard feed (still name/phone/house/entryDate; an `id`
field is picked up automatically if the Dashboard adds one).
