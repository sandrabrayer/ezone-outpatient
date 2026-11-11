# One-time session (טיפול חד פעמי) — 2026-11-11

Branch `claude/one-time-session-20261111`, base `claude/youthful-volta-laarnk` @ `d62fe41`.

## What

ורד can schedule **one single session** for any patient from the patient card —
«+ טיפול חד פעמי». It covers both billing kinds:

- a **package** patient's extra session **outside** the package (it never uses
  a package session or a credit), and
- a **per-session payer**'s session (the charge is due on the session day, so
  the patient is never «in debt» before it).

Decisions taken with Sandra (2026-11-11): both patient kinds · price from the
catalog + a charge on the card · outside the package quota · full flow to the
therapists app (therapist + date/time, the therapist marks it, payout via SessionLog).

## How

| Piece | Where |
| --- | --- |
| `OneTimeSessions` sheet (append-only headers, created on first use) | `apps-script/Code.gs` `ONE_TIME_SESSION_HEADERS` |
| Price | Server-side only, from an **active single-session** `PackageCatalog` row (`sessions = 1`, `per_session_pack`/`flat`), integer agorot snapshot. The browser never sends an amount. |
| Clinical type (decides therapist pay) | `psychiatric_consult → מעקב פסיכיאטרי`, `psychiatric_diagnosis → אינטייק`, family `emdr → פרטני EMDR`, `cbt → פרטני CBT`. A single-session row with no mapping is not offered (fail closed). |
| Charge | Created by the browser through the **existing durable extra-charge protocol** (`getExtraChargeState → reserveExtraCharge → applyExtraCharge → acknowledgeExtraCharge`) with the source's draft: id `ots-<sessionId>`, `one_time`, due on the session date, optional «שולם» record. No new money path. |
| Outcome | `markOneTimeSession` (ורד) or `recordSessionOutcome` + `oneTimeSessionId` (therapists app, `SESSION_OUTCOME_SECRET`). One SessionLog row `ots::<id>` (upsert), therapist pay by `TherapistRates` (fail closed), `clientSessionValue` = the session price (0 if the therapist cancelled), `creditStatus: 'one_time'`, forwarded pay frozen. |
| Outside the package | New appended SessionLog column `oneTimeSessionId`; `_happenedInMonth` skips such rows (quota + plan counters); `creditsOwed` is never read or written. The package path refuses `ots::` session ids (`reserved_session_id`). |
| Therapists feed | `GET getOneTimeSessionsFeed` (`ONE_TIME_SESSIONS_SECRET`, ≥ 32 chars, fail-closed, constant-time). Field allowlist: `id, patientName, phone, therapist, date, time, location, status, clinicalTreatmentType, catalogKey` — **no amount, charge, note or hash**. The Node proxy refuses it from a browser (403). Contract: `docs/one-time-session-therapists-contract.md`. |
| UI | Card button «+ טיפול חד פעמי», modal (service from the catalog with its price, therapist from the roster, date, time, location default = the patient's, note, «שולם»), card strip «טיפולים חד פעמיים» (status + charge chips, ✏️ שינוי מועד / ✅ התקיים / 🚫 לא הגיע/ה / ↩︎ המטפל/ת ביטל/ה / ✖ ביטול (in-app reason sheet) / 💳 השלמת חיוב / הסרת החיוב). «היום שלי»: today's sessions, past sessions without an outcome, therapist cancellations, unpaid sessions due within 2 days, a missing charge. |

### Statuses (stable keys, Hebrew at render time)
`scheduled` מתוכנן · `completed` התקיים · `no_show` לא הגיע/ה ·
`therapist_cancelled` בוטל ע״י המטפל/ת · `cancelled` בוטל.

### Integrity
- Create is idempotent by the browser UUID (same id + same payload → the stored row; different payload → `id_conflict`); a double click saves one session and one charge.
- Update / cancel / mark: script lock, op-id idempotency (`opLog`), `expectedRevision` (`revision_conflict`).
- Conflicts on scheduled sessions: same patient at the same date+time (`duplicate_session`), same therapist at the same date+time (`therapist_busy`).
- If the charge cannot be completed after the session was saved, the card shows «חיוב לא נוצר» + «💳 השלמת חיוב» (same charge id — never a second charge) and «היום שלי» lists it.
- An open extra-charge operation for the patient blocks scheduling (checked before anything is written).
- Free text is formula-guarded (`_pkgText`) and escaped on render.

### Permissions
- Full money scope (ורד, …): everything.
- דנה (ops): sees the sessions on the card **without amounts** (`amount` is a stripped money key) and gets no action; all four writes and `getOneTimeServices` are money actions (proxy 403 + Apps Script `forbidden_money_action`).
- Therapists app: price-free feed only.

## Known limits (documented, not hidden)
- Rescheduling does **not** move the charge's due date (a one-off charge is not editable by design). The card shows both.
- Cancelling never touches money by itself: an **unpaid** linked charge is offered «הסרת החיוב» (the existing charge removal); a **paid** one is shown «שולם — לבדיקת זיכוי» for ורד's decision.
- Catalog-only: a session type without a single-session catalog row (e.g. a general individual session) is not offered; add the row in «תמחור חבילות» first.
- «תשלומי מטפלים» → «תיקון סשן» on an `ots::` row is refused (`reserved_session_id`) — a one-time session's outcome is corrected from the patient card (it re-uses the same writer and keeps it outside the package).
- The sheet is captured by the nightly backup as an unclassified source (all sheets are copied); it has no typed recovery spec yet.

## Files
`apps-script/Code.gs`, `lib/money-scope.js`, `server.js`, `public/one-time-sessions.js` (new),
`public/app.js`, `public/my-day.js`, `public/index.html`, `public/style.css`, `public/sw.js` (v37 → v38),
`test/one-time-session.test.js`, `test/one-time-session-logic.test.js`, `test/one-time-session-browser.test.js` (new),
`test/session-credits.test.js`, `test/session-outcome.test.js` (SessionLog header pins),
`test-support/google-operational-drill-candidate.gs` (regenerated — helpers changed),
`docs/one-time-session-therapists-contract.md` (new), `docs/USER-GUIDE.he.md`, `README.md`, `DEPLOY.md`,
`EZONE-ECOSYSTEM-STATUS.md`, `CHANGELOG.md`.

## Release
1. Merge after Sandra's approval; `/api/version` = merge SHA; `/healthz`.
2. Dispatch **Deploy Apps Script** (`expected_commit` = merge SHA).
3. Set Script Property `ONE_TIME_SESSIONS_SECRET` (≥ 32 random chars) on the outpatient Apps Script — and the same value on the therapists side when its PR ships. Until then the feed answers `unauthorized`; scheduling, charging and ורד's marking work without it.
4. Make sure the catalog is imported («תמחור חבילות → ייבוא ראשוני») — without single-session rows the modal says so.

Rollback: revert the merge and redeploy the same way. The `OneTimeSessions` sheet and the `oneTimeSessionId` column stay (append-only); charges created meanwhile are ordinary one-off charges. After a rollback the old `_happenedInMonth` would count already-recorded one-time sessions toward the monthly quota again — check SessionLog rows with an `ots::` id if a rollback happens.
