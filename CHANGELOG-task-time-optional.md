# «משימה חדשה» — the date and the hour are optional; no date = today's work (2026-11-22)

Sandra, 22/11/2026 (production, a day after the Dashboard-parity release): «זה עובד אבל לא מופיע
נכון. נניח יש ליד או מטופל קיימים, הם מבקשים משהו כמו שיחה עם ד״ר נטליה ביום שני — הם מבקשים לדעת
באיזו שעה אבל לא יודעים. באותה מידה זה יכול להיות משימה ללא תאריך. מה שחשוב בתאריך זה שזה יטופל
היום». The form copied the Dashboard CRM's rule (a date AND an hour, both required) and refused to
save such a request («בחרי שעה»).

## What changed

- **«משימה חדשה»**: only «מה לעשות» and «סוג» are required. The date field is now labelled
  **«לטיפול בתאריך»** — the day the task should be HANDLED, not the day of the meeting it is about —
  and still opens on today. **«שעה (לא חובה)»**. The date may be cleared. The only refused
  combinations: a date in the past, and an hour without a date.
- **A task with no date is today's work**, everywhere:
  - «היום»: it sits in «מעקבים ומשימות במועד» with the chip «● להיום» (it used to fall to «בהמשך
    השבוע» with a grey «ללא מועד»), right after today's dated tasks; it stays there every day until
    it is completed, re-dated or cancelled.
  - the card: «מה הלאה» says «<what> — לטיפול היום», ordered after today's dated tasks and before
    future ones; the task row reads «להיום» / «ללא תאריך — לטיפול היום» in today's colour.
- Nothing changes for a task WITH a date: a future date still waits in «בהמשך השבוע» until its day.

## Not changed

- The contact form («תיעוד שיחה») and its «קשר הבא» — a follow-up from a call still gets a date
  (an hour there was already optional).
- The source: `createTask` always accepted a task without a date or an hour. No `Code.gs` change,
  **no Apps Script release**.
- The Dashboard CRM keeps its own rule (date + hour required there).

## Files

`public/crm-activity.js` (`newTaskErrors`, `nextSteps`, `STATE_ORDER`), `public/my-day.js` (section
rule, priority, chip text), `public/app.js` (chip colour, wording), `public/index.html` (the form),
`public/sw.js` **v42 → v43**, `docs/USER-GUIDE.he.md`, `EZONE-ECOSYSTEM-STATUS.md`.

## Tests

- `test/crm-dashboard-parity.test.js`: the form rule (optional date / hour, the two refusals); a task
  with no hour and one with no date are saved by the REAL `createTask` and land in today's section
  of «היום», never in «בהמשך השבוע»; «מה הלאה» order and wording; wiring pins.
- `test/crm-activity-browser.test.js` (+1, real Chromium): the patient-card flow from Sandra's
  screenshot — the form opens on today with no hour and saves as is; a second task with the date
  cleared; both on the card and on «היום».

## Security

Browser-only change. Validation is unchanged at the source boundary (`_taskValidate`); output is
escaped as before. `npm audit`: 0 vulnerabilities.

## Rollback

Revert the commit (a later SW bump must stay > v43). Tasks saved without a date or an hour stay
valid for the older code, which showed them as «ללא מועד».
