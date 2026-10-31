# Outpatient CRM — acceptance record (program #141, Phase F, 2026-10-31)

Candidate = the stacked chain #142 → #143 → #144 → #145 → #146 (+ this doc), head of `claude/opcrm-f-acceptance`.
Everything here ran against **synthetic fixtures only** (in-memory Sheets in `test-support/apps-script-sandbox.js`, real `server.js`, real `public/` UI in real Chromium). **No live patient data, no production URL, no credential was used.** Status legend: **tested** = automated test in CI; **measured** = a number produced by a script in this repo; **manual** = to be done by Sandra/ChatGPT on the release candidate after deploy.

| # | Scenario (program §9) | Status | Evidence |
|---|---|---|---|
| 1 | New inquiry and first-contact logging | **tested** | `crm-activity-browser` #1 (ורד logs a WhatsApp contact on a lead, follow-up in 2 days), `crm-tasks-activity-gs` #5; «היום שלי» shows the lead as «פניות ללא קשר ראשון» until a contact is logged, then «להמשיך מעקב» (`my-day` #14) |
| 2 | Introductory meeting scheduled and completed | **tested** | `my-day` #1/#15 (`intro_scheduled` today+time = binding; `intro_passed` = exception in section 1); `crm-handoff-status` #2 (`intro_scheduled` / `intro_passed` states) |
| 3 | Follow-up due, completed or deferred | **tested** | `crm-tasks-activity-gs` #4 (defer keeps previous date, complete, no second completion), `crm-activity-browser` #1 (✓ from the card), `my-day` #13 (deferred row «נדחתה מ-…») |
| 4 | Client admitted without losing activity history | **tested** | `crm-activity` #2 (client carries lead-era history via `fromLead`), `crm-handoff-status` #2 (converted lead answers as its client, next action follows) |
| 5 | Treatment continuation and discharge flows | **tested** (existing) + **tested** (new) | existing `continuation-*`, `two-way-alerts`, `deactivate-client` suites unchanged and green; `my-day` continuation/stop-flag/extra rows; `crm-handoff-status` `ended` state. Pre-discharge identity linking = PR #138 (ChatGPT) |
| 6 | Duplicate submission, stale tab, retry after lost response | **tested** | `crm-tasks-activity-gs` #2/#5 (same `submissionId` → `replayed`, nothing written twice), `crm-activity-browser` #1 (replayed payload), existing `lead-save-browser` stale-tab suite green |
| 7 | ורד's financial + operational view | **tested** | `money-scope-browser` #2 (tabs visible, price rendered, pay constants served), `money-scope` #3 |
| 8 | דנה's operational view with no accessible financial data | **tested** | `money-scope` #3–#8 (403 on money actions before upstream, deep strip on MISS/HIT/STALE, tampered `moneyScope` refused, Code.gs preserves stored money), `money-scope-browser` #1 (no money in DOM, no money read requested, operational save keeps the stored price), `crm-tasks-activity-gs` #3 (money tasks invisible), `my-day` #16 |
| 9 | אורן's preserved authorized functions | **tested** | `money-scope` #3/#4/#6 (money on getData, money actions allowed, pay constants served; pricing still ורד-only via existing `catalog-admin` suites) |
| 10 | Unavailable external source, network failure, backend refusal | **tested** | `money-scope` #3 (STALE fallback), `crm-activity` #4 (`getTasks` failure → `null` → «המידע אינו זמין», never 0), `my-day` #8, `continuation-identity-routes` (502/404/409 fail-closed, PR #138) |
| 11 | Exact identity links between applications | **tested** (Outpatient side) | `crm-handoff-status` #4 (exact ids only; name/phone never match; `dashboardPatientIds` match only when the #137 column exists); #137/#138 own the id columns and pre-discharge linking |
| 12 | Preservation of existing clients, sessions, billing history, backups | **tested** | whole existing suite green at every phase (1705 → 1755); all new sheets/columns append-only; `payment-coverage-period` #F proves other sheets' cell formats unchanged; OP-03 backup (#139/#140) untouched |
| 13 | Desktop and mobile usability | **tested** + screenshots | `crm-theme` (AA contrast, side menu ≥900px, mobile strip kept); screenshots at 1366 px / 390 px for ורד and דנה posted in #141 (Phase E) |
| 14 | Performance / repeated requests | **measured** | see below |

## Measured (synthetic: 60 leads, 120 clients, 40 tasks, 40 contacts; local Chromium, in-memory backend)
| Session | API calls at boot | upstream (Apps Script) calls at boot | boot → first «היום שלי» row | extra API calls switching לידים → מטופלים → היום שלי |
|---|---|---|---|---|
| ורד | 11 (`verify-pin`, `me`, `getData`, `getPayments`, `getCharges`, `getStopFlags`, `getExtraSessionRequests`, `getSettings`, `getMyStopAlerts`, `getTasks`, `getActivity`) | 9 | ~290 ms | **0** |
| דנה | **8** (money reads are not even requested) | 5 | ~180 ms | **0** |

The two CRM reads add 2 parallel calls at boot (same `Promise.all`), none on tab switches; every CRM write is followed by one `getTasks` + one `getActivity` refresh. Real-world latency is dominated by Apps Script (not measured here — see `/api/debug/last-load` in production).

## Manual (after deploy, by Sandra / ChatGPT — not done here)
1. Sign in as ורד, אורן, דנה on production: tabs per role; דנה: `/api/sheets?action=getPayments` → 403 in DevTools; `therapist-pay.js` → 403.
2. Log one synthetic contact on a test lead; confirm one `Activity` row + one `Tasks` row in the workbook; reload — no duplicates.
3. `curl 'https://<outpatient-exec>?action=getHandoffStatus&secret=…&outpatientIds=<test lead id>'` → state JSON; wrong secret → `unauthorized`.
4. `/sw.js` shows `v22`; hard refresh on a phone; «היום שלי» renders sections.
5. Nightly backup next morning includes `Tasks` and `Activity` (OP-03 inventory — ChatGPT).
