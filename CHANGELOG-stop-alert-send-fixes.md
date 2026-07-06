# Stop-alert SEND flow: feedback + missing-name investigation

**Date:** 2026-07-06

Two live bugs were reported against the `🛑 הודעת עצירת טיפול` send flow (the
overdue-renewals panel button that fires `createStopAlert`, shipped in PR #63 /
reason field in PR #66):

1. **No feedback** — pressing the button appeared to do nothing, even though an
   alert (with reason) *did* reach the therapists app.
2. **Missing name** — the alert arrived at the therapists app with no patient
   name.

Both were reproduced in a **stub + Playwright harness** that drives the real
`public/` app in headless Chromium against a stubbed `/api/*` (see
`test/stop-alert-send-fixes.test.js`).

## Bug 1 — "no feedback" — FIXED (frontend only)

**Reproduction finding:** the modal *does* open (`hidden` → false,
`display: grid`, `z-index: 40`, visible) and the toast *does* fire
(`נשלחה התראת עצירה לירדן`, `#toast` `z-index: 60`). The real problem was that the
**only** feedback was the transient toast — the overdue row and its button never
changed. Once the toast auto-dismissed (2.6s) the row looked identical to before,
so a *successful* send read as "nothing happened", and the button was still
clickable (a repeat send only produced a soft "already pending" warning).

**Fix (`public/app.js`):** after a successful send the button flips to
**disabled** with the label **`נשלחה התראה ✓`** for the rest of the session.

- `hasPendingStopAlert(clientId)` — one source of truth for "sent this session":
  an `unread` alert for the client in `state.stopAlerts` (the SAME optimistic list
  `submitStopAlert` appends to and rolls back from). The duplicate-pending modal
  warning now shares this helper.
- `applyStopAlertButtonState(clientId)` — reflects that state onto the live
  overdue-panel button(s) immediately, without a full re-render.
- `submitStopAlert` calls it right after the **optimistic** push (button flips to
  sent), and again in the failure `.catch` after the rollback splice (button
  **re-enables** to `🛑 הודעת עצירת טיפול`).
- `renderRenewalRow` re-derives the same state via `hasPendingStopAlert`, so the
  sent/disabled button also **survives a re-render** (e.g. Refresh) within the
  session. A page reload clears it (session-scoped, by design).
- The un-sent button keeps its literal label in the render string, so the older
  wiring guard still matches.

Session-scoped only: `state.stopAlerts` is seeded empty at boot and appended
in-session (the outpatient service holds no `STOP_ALERTS_SECRET`, so it cannot
read `getStopAlerts`), which is exactly the "rest of the session" behavior asked
for.

## Bug 2 — "missing name" — NOT an outpatient bug

The harness asserts, end to end, that for a **card-rendered client** the
`createStopAlert` POST carries a **non-empty `clientName`** (`"דנה כהן"` for the
seeded overdue client), and that the mirrored `_createStopAlert` **persists it to
the `clientName` column** of the `התראות עצירת טיפול` sheet. The path is intact:

`client.name` → `submitStopAlert({ clientName: c.name })` → `apiPostAction`
(`/api/sheets` body includes `clientName`) → Node proxy `server.js` forwards the
body verbatim → `doPost` → `_createStopAlert` reads `payload.clientName`,
rejects an empty one (`missing_client_name`), and appends it via
`STOP_ALERTS_HEADERS.map(...)` (with `clientName` at column index 2).

**Conclusion: outpatient sends and persists `clientName` correctly.** The
missing-name symptom is therefore on the **therapists READ side** — to be fixed
there (separate session/repo).

## Tests

`test/stop-alert-send-fixes.test.js` (`node --test`):

- **e2e (Playwright, skips gracefully with no browser):**
  - click opens the modal *and* a successful send toasts **and** flips the button
    to disabled `נשלחה התראה ✓`;
  - the sent/disabled button survives a re-render (Refresh);
  - a **failed** send rolls back — the button re-enables to `🛑 הודעת עצירת טיפול`;
  - the POST carries a non-empty `clientName` that persists to the `clientName`
    column (bug 2 evidence).
- **source guards (always run):** the new `STOP_ALERT_SENT_LABEL` /
  `hasPendingStopAlert` / `applyStopAlertButtonState`; the disabled sent-button
  branch in `renderRenewalRow`; the optimistic-flip + rollback-re-enable calls in
  `submitStopAlert`; and `_createStopAlert` reading `payload.clientName` and
  persisting it through `STOP_ALERTS_HEADERS`.

`test/stop-alerts.test.js` — the duplicate-guard wiring test was updated: the
`status === 'unread'` check now lives in `hasPendingStopAlert` (which
`openStopAlertModal` delegates to).

The Playwright harness is **env-dependent** — it skips when Playwright or a
browser binary is unavailable, so `npm test` stays green in a browser-less CI. In
this environment the only remaining `npm test` failures are the two pre-existing
`Cannot find module 'express'` proxy tests (dependencies not installed).

## Code.gs / deployment

**`apps-script/Code.gs` was NOT changed** — no Apps Script redeploy needed. The
fix is entirely in `public/app.js`; `CLIENTS_HEADERS` and every backend contract
are untouched.
