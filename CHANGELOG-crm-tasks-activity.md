# Tasks, Activity and contact history (OP-CRM-3B, 2026-10-31)

Phase B of the Outpatient CRM program (issue #141), stacked on OP-CRM-3A. Draft only; no merge, no Apps Script / Railway deploy.

## What it answers, per lead / client
Who made contact and when · what was said and decided · what the next action is, who owns it and when it is due · the full chronological history — on the card itself, for ורד, אורן and דנה alike (money tasks excluded from an operational session).

## Server (`apps-script/Code.gs`) — adapted from the Dashboard CRM (docs/crm/SPEC §8/§14), not copied
- Two new auto-created, **append-only** sheets: `Tasks` (`TASKS_HEADERS`: id, kind, leadId, clientId, title, reason, assignee, dueDate, dueTime, status, source, createdAt/By, updatedAt/By, doneAt/By, outcome, deferredFrom, contactEventId, submissionId, money) and `Activity` (`ACTIVITY_HEADERS`: eventId, occurredAt, recordedAt, kind, source, actorName, leadId, clientId, summary, detailsJson, nextAction, nextDate). ISO/id cells are text-forced **only on these two sheets** (`_isTextForcedColumn(name, headers)`), so same-named columns elsewhere keep their format.
- Internal actions (all `OUTPATIENT_PROXY_SECRET`, never a cross-app secret): `getTasks`, `getActivity` (GET/POST), `createTask`, `completeTask`, `deferTask`, `reassignTask`, `withdrawTask`, `logContact` (POST).
- **Actor = `_requestUser(payload)`** (the proxy-injected session name) on every write; a browser `user` is overwritten by the proxy as before.
- **Idempotency**: `createTask` / `logContact` take a browser-minted `submissionId` → task id `task-<sid>`, event id `contact:<sid>`, follow-up `task-<sid>-next`. A replay after a lost response answers the same rows (`replayed:true`) and writes nothing twice. Task mutations are refused once a task is closed (`not_open`).
- **Vocabularies**: `TASK_KINDS` call/meeting/intro/plan/activation/continuity/collection/review/other; `TASK_STATUSES` open/done/deferred/cancelled; `CONTACT_CHANNELS` phone/whatsapp/meeting/email/other; `CONTACT_OUTCOMES` the 8 spec outcomes with Hebrew labels.
- **`logContact`** is one transaction under the lock: Activity event + the task it fulfils → done (outcome = the contact's) + the follow-up: a date (+time), «בעוד N ימים», or **`none` + explanation** — **no default date, ever** (`bad_due` otherwise).
- **`deferTask`** keeps the previous date (`deferredFrom` + Activity); **`withdrawTask`** keeps the row (status `cancelled`); **`reassignTask`** validates against the three current names.
- **Money**: `kind:'collection'` / `money:true` tasks are invisible to and refusable by an `ops` session (`forbidden_money_task`, `not_found`), using the proxy-decided `moneyScope` (POST body; GET query appended by Node from `action` only).

## Browser
- `public/crm-activity.js` (pure UMD): `summarize(tasks, events, subject, today)` → last contact, next action, open tasks with due state (late only by due date; undated never late), timeline newest first; vocabularies mirrored by test.
- Every lead card and client card carries a **CRM block**: קשר אחרון · הפעולה הבאה · open tasks with 📞 (log a contact that closes it) ✓ ⏩ 👤 ✕ · «📞 יצרתי קשר» / «➕ משימה» · collapsible היסטוריה. A client follows its lead-era history through `fromLead`. A source that did not load shows «פעילות: המידע אינו זמין», never an empty list.
- Modals: `#contactModal` (channel, when, with whom, outcome, summary, next: date / days / none+reason, next task kind/title/assignee), `#taskModal`, `#deferModal`. The submission key is minted once per form and kept on failure (safe retry), replaced after success.
- `getTasks` / `getActivity` load in parallel with the rest of `loadAll` (soft; `null` on failure).

## Not in this phase
Automated task derivation and the «היום שלי» merge (Phase C — the derived rows stay virtual and will be suppressed by matching open tasks; no second task engine). No email/SMS, no triggers, no recurring jobs.

## Tests
- `test/crm-tasks-activity-gs.test.js` (6): schema/auth, idempotent create + validation, money visibility per scope, defer/complete/reassign/withdraw state machine + history, logContact transaction/replay/no default date, reads.
- `test/crm-activity.test.js` (4): view model, lead-era history, vocabularies mirror Code.gs, wiring guards.
- `test/crm-activity-browser.test.js` (2, real Chromium; added to the browser CI job): ורד logs a contact with a 2-day follow-up, completes it via ✓, replay creates nothing; דנה logs a task, no collection kind offered, `moneyScope:'ops'` stamped.
- Full suite 1737/1737 locally.
