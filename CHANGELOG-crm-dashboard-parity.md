# Contact record, tasks and «היום» — the same as the Dashboard CRM (2026-11-21)

Sandra, 21/11/2026: «צריך להוסיף אפשרות להוסיף משימות או הודעות בכרטיסי המטופלים, לא רק ללידים, וגם
הנראות של הליד החדש והשיחה החוזרת צריכה להיות בדיוק כפי שמופיעה היום באפליקציית הדשבורד, תיעוד שיחה
וכו׳» — and: «זה צריך להיות בלשונית שקוראים לה היום, כי לא רק ורד נכנסת לשם. תסיר את היום שלי».

Reference: E-Zone-Dashboard `public/crm/crm.js` at `a3983f4` (PR #426, «three call kinds, ביטול תיעוד,
מה הלאה, היום»). Adapted, not copied — this app keeps its cards and modals, its own subjects
(`leadId` / `clientId`) and its own theme.

## 1. Patient cards = lead cards

The activity block was already on both card kinds since OP-CRM-3B, but as two small buttons at the
bottom of the card («📞 יצרתי קשר» / «➕ משימה»). It is now the same block, in the same order, on a
lead card, a patient card and a «שימור לידים» card:

1. **«⏰ מה הלאה»** — every open follow-up as one sentence: WHAT (title), WHEN («באיחור של 2 ימים» /
   «היום» / «מחר» / «בעוד N ימים» + the date, the weekday and the hour) and WHO («אחראי/ת»). Most
   urgent first; edged red when something is overdue. Not drawn when nothing is open.
2. **«שיחות אחרונות»** — the last 3 documented contacts: when, who, a kind chip, outcome + summary,
   and the follow-up the record created while it is still open.
3. **«משימות פתוחות»** — each with its actions (below).
4. **«📞 תיעוד שיחה»** and **«➕ משימה חדשה»**.
5. **«היסטוריה»** — everything, a voided record struck through and marked «בוטל».

## 2. «תיעוד שיחה» — the Dashboard's contact form

- One button. First question **«סוג התיעוד»**: «שיחה יוצאת» / «שיחה נכנסת» / «תיעוד שיחה». None is
  pre-chosen and a save without one is refused — except when the form closes a TASK (a contact we
  planned to make), which opens as «שיחה יוצאת».
- Fields: תאריך (today or earlier) + שעה, who (the signed-in user, read-only), עם מי, ערוץ (טלפון /
  וואטסאפ / SMS / דוא״ל / פנים אל פנים / אחר), סיבת הפנייה, **תוצאה**, תקציר. The labels re-word per
  kind («מי התקשר/ה», «מי קיבל/ה את השיחה»). «שיחה נכנסת» does not offer «לא היה מענה» /
  «פרטי הקשר אינם תקינים».
- New outcome **«התקיימה שיחה — לא נדרש המשך»** (`spoke_no_follow_up`): choosing it selects «ללא
  משימת המשך» and needs no typed explanation (stored as «לא נדרש המשך»).
- **«קשר הבא»** — מחר / בעוד 3 ימים / בעוד שבוע / בעוד שבועיים / בעוד חודש / בעוד X ימים / תאריך
  ושעה / ללא משימת המשך. **No default.** The actual date and weekday are shown before saving. The
  follow-up's title defaults to «לחזור — <outcome>»; title and owner are editable.
- Save = ONE `logContact`. Field errors appear under their fields; a failed save keeps everything
  typed and retries with the same `submissionId` (idempotent); the confirmation says
  «המשך: <what> — <when>».

**Storage — no sheet column.** `direction` (`out` | `in` | `note`) and `reason` live in the
`contact_logged` event's `detailsJson`. A record with no direction — everything written before this
change — is `note` («תיעוד שיחה»): the kind is never guessed. An unknown value is refused
(`bad_direction`) before anything is written. `CONTACT_CHANNELS` gained `sms`, `in_person`
(appended; `meeting` stays valid for existing rows), `CONTACT_OUTCOMES` gained `spoke_no_follow_up`.

## 3. Tasks

- **«משימה חדשה»**: סוג, מה לעשות *, אחראי, **תאריך *** (today by default, not in the past) and
  **שעה ***. «למה / הקשר» is gone.
- **A call closes only through «תיעוד שיחה»** (kinds `call`, `collection`): no bare «סיום». Any other
  kind has «סיום» (an in-app form, «מה נעשה»).
- **«שינוי מועד»** (was «דחייה»): date + time; a reason is required only when the date was promised in
  a contact (`source: 'contact'`) — enforced in `deferTask` as well as in the form.
- **«עוד…»**: reassign, or cancel with a reason (the row stays).
- Every `window.prompt` in the CRM is gone (5 modals instead); the same buttons are drawn on a card
  and on a «היום» row.
- A task's buttons sit on their own row under its title, so the ~240 px lead card in the board
  stays readable.

## 4. «ביטול תיעוד» — a record entered by mistake

A contact record is never edited or deleted. New action **`voidContact { eventId, reason }`**:

- ONE new Activity event `void:<eventId>`, kind `contact_voided`, `detailsJson.supersedesEventId`,
  with who / when / why. The record's own row is untouched.
- The follow-up task the record CREATED is cancelled only while it is still open and contact-made;
  a task the record FULFILLED stays done. Idempotent (a second void writes nothing).
- A voided record is no longer «קשר אחרון», is left out of «שיחות אחרונות», no longer makes a lead
  «contacted» for «היום» or for the Dashboard handoff feed (`getHandoffStatus`), and stays in
  «היסטוריה» struck through.
- **ורד only**, at both layers: the Node proxy answers 403 `contact_void_vered_only` from the signed
  session before anything travels (`lib/users.js` `CONTACT_VOID_USERS`), and Code.gs re-checks
  (`CONTACT_VOID_USERS`, `forbidden_user`). The button is drawn only for her.

## 5. «היום» — the team's page

«היום שלי» → **«היום»**: the tab, the page heading, the user guide and the one in-app text that named
it. The heading no longer shows the signed-in name; it says **«כל הצוות»**. The page already listed
every owner's work (the «אחראי» column) — only the personal framing is gone.

## 6. New lead

The form keeps this app's fields (they differ from the Dashboard's for a reason: treatment types and
branch instead of house and source) in the Dashboard's layout: «פרטי המטופל» / «פרטים נוספים», the
line «ליד חדש נכנס ללוח בשלב «פרטים אישיים»», button «הוסף ליד».

## Not in this change (decisions for Sandra)

- **«פרטי הפונה»** on a lead — added right after this change, in the same release: see
  `CHANGELOG-lead-contact-person.md`. Still open: **optional name / phone** on intake and the
  billing-phone choice, which need a decision on the phone being this app's cross-app match key.
- The Dashboard's **«במהלך שבוע נבחר»** follow-up (this app's tasks have a date, not a week window)
  and its **30-minute in-app reminder**.

## Files

- `apps-script/Code.gs` — `CONTACT_DIRECTIONS`, `CONTACT_DIRECTION_HE`, appended channels / outcome,
  `logContact` (kind, reason, no-follow-up text), `_voidContact`, `_contactVoidedIds`,
  `_deferTask` (reason only for a promised date), `getHandoffStatus` (voided ≠ contacted),
  `SOURCE_POST_AUTH.voidContact`, dispatch. **Apps Script release needed** (second phase).
- `lib/users.js`, `server.js` — `CONTACT_VOID_USERS` and the 403 gate.
- `public/crm-activity.js` — the pure core (lists, `nextPlan`, `contactErrors`, `contactBody`,
  `recentContacts`, `nextSteps`, `voidContactError`, `newTaskErrors`, `rescheduleErrors`).
- `public/app.js`, `public/index.html`, `public/style.css`, `public/my-day.js`,
  `public/package-pricing.js`; `public/sw.js` **v41 → v42**.
- `docs/USER-GUIDE.he.md`, `README.md`, `EZONE-ECOSYSTEM-STATUS.md`.

## Tests

- `test/crm-dashboard-parity.test.js` (new, 16): the real Code.gs in the sandbox — kind stored /
  defaulted / refused, the no-follow-up rule, `voidContact` (role, id shape, reason, unknown id,
  append-only, follow-up cancelled, idempotent, finished task untouched, handoff feed), `deferTask`;
  the pure core; markup and wiring pins (escaping, no browser dialog, the Node gate).
- `test/crm-activity-browser.test.js` (rewritten, 5, real Chromium): the lead flow, the PATIENT card
  flow (task with date + time, «שינוי מועד», «סיום», «עוד…»), «ביטול תיעוד» as ורד and refused for דנה
  (no button, 403, nothing reaches the source), «היום» / «כל הצוות», no horizontal scroll at 360 px and
  1280 px, and no browser dialog anywhere.
- Updated pins: `crm-activity`, `crm-tasks-activity-gs`, `my-day`, `user-guide`.

## Security

- No new route, secret or sheet column. `voidContact` is an internal POST behind
  `OUTPATIENT_PROXY_SECRET`, never a GET; the actor is the proxy-injected session name; the event id
  is regex-checked and a reason required before anything is read; it can only void a
  `contact_logged` row and only cancel the task that row names.
- `direction` is allow-listed on the server (fail closed) and in the browser.
- Everything read from the sheets reaches the page through `escapeHtml`; form errors and modal texts
  are written with `textContent`. A browser test stores `<b>` in a summary and asserts no markup.
- Money: a contact that closes or creates a money task stays money-flagged; a void event inherits the
  flag, so an operational session never sees it. `npm audit`: 0 vulnerabilities.

## Deploy

Two phases (CLAUDE.md rule 4): merge → `/api/version` = the merge SHA → dispatch «Deploy Apps Script»
with `expected_commit` = that SHA. In the minutes between the two, saving a record as «שיחה נכנסת /
יוצאת» works on the old script too (unknown fields are ignored there), but «לא נדרש המשך», the SMS /
פנים אל פנים channels and «ביטול תיעוד» are refused by the old script — nothing is written and the
typed text is kept; retry after the Apps Script run is green.

## Rollback

Revert the PR (a later SW bump must still be > v42). Rows already written stay valid: `direction` /
`reason` in `detailsJson` and `contact_voided` events are ignored by the older code (a voided record
would simply show again). A task cancelled by a void stays cancelled.
