# Vered dashboard alerts — credit owed + renewal due

Two display-only alerts on the OUT (Vered) dashboard, built on the existing
notice/panel pattern (`⚠️ חידושים ועצירות טיפול` / `⏳ המתנה לאישור הפסקה`).
Both are read-only: they surface state the system already tracks and never
write to the sheet.

## (a) Credit alert — `🎟️ קרדיט מפגשים להשלמה`

Lists **active** patients with `creditsOwed > 0` (name + credit count), so Vered
knows a make-up session is owed. `creditsOwed` is the server-managed monthly
credit balance on the `Clients` row (set by `recordSessionOutcome` in
`apps-script/Code.gs`; a therapist-cancelled session banks a credit). Until now
it was only visible on the individual patient card (`קרדיט מפגשים: N`); the new
dashboard panel rolls every owing patient into one list. Most-owed first.
Finished patients (`status === 'סיים טיפול'`) are excluded.

## (b) Renewal alert — within 1 week of the treatment-month end

The dashboard already surfaces renewals due "this week" in the existing
`⏰ חידושים השבוע — לגבות לפני` section of `renderRenewalAlerts`. Rather than
duplicate that list, the **7-day window is now a named constant**,
`RENEWAL_WINDOW_DAYS = 7`, shared by the renewal banner so the rule is explicit
and lives in one place.

### Billing-cycle date (Step A finding)

The **treatment-month end / next renewal due** date is the renewal **anchor +
1 calendar month**, where the anchor is:

- `paymentDate` (the last monthly payment) when present, else
- `startDate` (the treatment start date).

This is the same anchor used by `nextRenewalDueDate` / `renewalInfo`
(`public/app.js`, `public/charges-logic.js`). When **neither** date exists there
is no cycle date — such a patient is **flagged** (`status: 'missing'`), never
crashed.

## Pure logic + tests

`public/vered-alerts.js` is a framework-free UMD module (same pattern as
`charges-logic.js` / `billing-status.js`): Node tests `require()` it, and
`public/app.js` keeps an inline mirror because the browser has no build step —
**keep both in sync**. It exposes `RENEWAL_WINDOW_DAYS`, `creditAlerts(clients)`,
`renewalAlerts(clients, todayIso, windowDays?)`, and the `cycleEndDate` helper.

`test/vered-alerts.test.js` (10 tests) locks:

- credit alert lists **only** `creditsOwed > 0` (excludes 0/blank/junk/negative
  and finished patients);
- renewal alert **fires within 7 days** of the cycle end (days 0…7 inclusive),
  **not outside** (8+ days out, or already past);
- a patient with **no cycle date** is **flagged, not crashed** (`'missing'`).

## Files

- `public/vered-alerts.js` — new pure module.
- `public/app.js` — `RENEWAL_WINDOW_DAYS` constant (replaces two `<= 7`
  literals in `renewalInfo`); new `renderCreditAlerts`, called from
  `renderDashboard`.
- `public/index.html` — new `🎟️ קרדיט מפגשים להשלמה` panel (`#creditAlerts`).
- `test/vered-alerts.test.js` — new tests.

## Deploy

**Frontend-only — no Apps Script redeploy required.** Railway auto-deploys the
served `public/` assets on merge; the `__BUILD__` cache-buster refreshes the
client. No new columns, no server or Apps Script changes.
