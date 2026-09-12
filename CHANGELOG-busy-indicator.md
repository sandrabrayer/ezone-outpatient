# Working indicator (spinner)

**Why:** nothing in the app said "I heard you". A save against Apps Script is a
1–3 s round-trip and a full reload is six of them in parallel, so a click looked
like nothing happening — and people clicked again. That has produced duplicate
rows before. This adds one spinner vocabulary across the app, and makes the
second click impossible rather than merely discouraged.

## The shape of it: two chokepoints, not thirty call sites

Coverage is structural, so an action cannot be missed by forgetting to
decorate it:

1. **`apiFetch` is the single network funnel.** Every call to the server in
   `app.js` goes through it — including `/api/verify-pin` and `/api/logout`,
   which were raw `fetch` before this PR and are now on the funnel with an
   `allow401` flag (there a 401 means "wrong PIN" / "already logged out", not
   an expired session). It starts the header indicator and **always** ends it
   in a `finally`. A test asserts that the only bare `fetch(` left in `app.js`
   is the one *inside* `apiFetch`, so a new endpoint cannot forget the
   spinner.
2. **`withBusy(target, kind, fn)` is the single action wrapper**, with
   `busyAttach(el, kind)` as its lower-level sibling for the modal forms whose
   control flow already owns disable/re-enable. Both share one tracker per
   element, so they cannot disagree about what is showing.

The timing rules live in a new **`public/busy.js`** — a UMD module like
`conflicts.js` / `name-search.js`, pure (no DOM), with injectable timers, so
every rule is unit-tested deterministically instead of with real waits.

## The rules

| Rule | Where |
| --- | --- |
| Show only after **150 ms** — a fast action never flashes anything | `busy.js` `SHOW_DELAY_MS` |
| Once shown, stay at least **300 ms** — no blink | `MIN_VISIBLE_MS` |
| After **20 s**, add **"זה לוקח יותר מהרגיל…"** | `SLOW_AFTER_MS` |
| Overlapping actions share ONE spinner; it hides when the LAST ends | reference-counted tracker |
| Ends in a `finally` on success, error and throw alike | `withBusy` / `busyAttach` / `apiFetch` |

**It cannot get stuck.** `end()` / `release()` are idempotent, the count never
goes below zero, a new action during the 300 ms hold cancels the pending hide
instead of double-hiding, and `reset()` is a hard stop. If `busy.js` fails to
load entirely, `makeBusyTracker` returns a no-op tracker and every action still
runs — the indicator degrades, the app does not break.

## Hebrew labels (one place: `busy.js` `LABELS`)

`save` → **שומר…** · `search` → **מחפש…** · `send` → **שולח…** ·
`load` → **טוען…** · `export` → **מייצא…**

`labelFor()` falls back to **טוען…** for an unknown kind, so the UI can never
render `undefined`. **Note:** the brief named four labels; **מייצא…** is a
fifth, added because labelling the CSV export button "טוען…" would be plainly
wrong Hebrew. Say the word and it collapses back to four.

## What each action gets

**Button-level** (disabled + spinner + Hebrew label + double-click blocked) —
19 sites:

| Action | Button | Label |
| --- | --- | --- |
| PIN login | `#pinSubmit` | שולח… |
| Refresh (header ↻) | `#refreshBtn` | טוען… |
| New / edit lead | `#leadFormSubmit` (both branches) | שומר… |
| Lead → agreement | `#agreementSubmit` | שומר… |
| End treatment | `#exitSubmit` | שומר… |
| Mark lead not-relevant | `#notRelevantReasonForm` submit | שומר… |
| Remove lead | `#removeLeadForm` submit | שומר… |
| Add charge | `#addChargeSubmit` | שומר… |
| Edit charge | `#editChargeSubmit` | שומר… |
| Edit collection amount | `#editAmountSubmit` | שומר… |
| Renew & pay | `#renewSubmit` | שומר… |
| Settings | `#settingsSubmit` | שומר… |
| Add / correct session | `#sessionSubmit` | שומר… |
| Merge duplicate clients | `#mergeClientsConfirm` | שומר… |
| Remove orphan billing row | the row's ✕ | שומר… |
| Mark therapist forwarded | the row's button | שולח… |
| Export payouts CSV | `#payoutExportBtn` | מייצא… |

**Field-level** — all **8** search boxes (`dashPatientSearch`, `leadsSearch`,
`clientsSearch`, `billingSearch`, `retentionSearch`, `inactiveSearch`,
`payoutSearch`, `continuationSearch`) are wired through the same helper via a
new `.search-wrap`, with the spinner at the field's **inline end** (the left
edge in RTL). The double-activation guard is scoped to *controls* only, so a
keystroke during a lookup is never swallowed — the tracker reference-counts
them behind one spinner.

**Header-level (everything else, by construction)** — every `apiFetch` call:
`/api/sheets` (load + save), `/api/sheets?action=` ×9 reads, all 15
`apiPostAction` writes, `/api/continuation-roster`, `/api/me`, `/api/users`,
`/api/verify-pin`, `/api/logout`.

### Deliberately header-only (not a gap)

- **Optimistic saves** — *add patient directly*, *activate lead*, *edit
  patient*. These re-enable the button and close the modal **before** `persist()`
  runs, on purpose, so there is no button left on screen to spin. Same for the
  delegated list actions (approve extra session, stop-flag actions, renewal
  actions, payout list, continuation rows), which re-render and destroy the
  clicked button. The header indicator covers all of them.
- **Local-only work** — CSV export builds a Blob in the browser, and seven of
  the eight searches filter in memory. They finish well inside 150 ms and so
  show nothing. That is the 150 ms rule working, not a miss. Only
  `#dashPatientSearch` really waits: it pulls the deleted-patient tombstones on
  first use (`ensureRemovedClients`, now promise-returning so the field spins
  for exactly that fetch).
- `#stopAlertSubmit` opens **disabled** until a reason is picked. The guard
  restores a control *as it was found*, so it can never be silently enabled.

## Accessibility

- `role="status"` on the header indicator carries the Hebrew label as
  screen-reader-only text (`.sr-only`); the spinner itself is
  `aria-hidden="true"` — decoration, not meaning.
- `aria-busy="true"` marks the region in flux: `#app` for a server call, the
  button for a button action, the `.search-wrap` for a search.
- **`prefers-reduced-motion: reduce` replaces the rotation with a pulsing
  dot** (opacity, no transform) — same information, no spinning.
- A busy button keeps `opacity: 1` and `cursor: progress`, so "working" does
  not read as "broken" through the app-wide disabled dimming.

## Look

Pure CSS, no library. The ring uses the app's existing accent `--green`
(`#29d488`) via the token — no new colour, and no hard-coded hex anywhere in
the block. Inside a filled button it borrows `currentColor` so it stays visible.
Layout is entirely logical-property based (`inset-inline-end`,
`margin-inline-end`), so RTL is correct with no direction-specific rule and no
`[dir=]` override. On phones the 20 s notice collapses to screen-reader-only so
it cannot push the tabs off-screen.

**No page-load skeletons were removed — there were none.** The app had no
spinner, skeleton or loading state of any kind before this PR (verified by
search); a test pins that none were introduced and that the shell still starts
hidden exactly as before.

## Tests — full suite **929 passing** (872 + 57 new; 0 failing, 5 skipped)

New `test/busy-indicator.test.js` (51), no new dependency and no DOM library:

- **A. timing (12)** — nothing before 150 ms; shown at exactly 150 ms; held
  exactly 300 ms; no extra hold when the action already outlasted it; the slow
  notice at exactly 20 s and always cleared before the hide; the 20 s clock runs
  from when work started; the error path ends identically; `end()` idempotent
  and the count never negative; overlapping actions share one spinner; a new
  action inside the 300 ms hold keeps it continuous; `reset()` leaves no orphan
  timer; a tracker with no handlers and real timers cannot throw.
- **B. the double-click guard (6)** — disabled at once; a second activation
  **refused**; *only one save runs when a button is clicked four times*;
  `release()` idempotent; a control found disabled comes back disabled; a null
  control does not throw.
- **C. labels (2)** — the five labels, the `טוען…` fallback (not fooled by
  inherited properties like `constructor`), the constants.
- **D. wiring (7)** — exactly one bare `fetch(` in `app.js` and it is the one
  inside `apiFetch`; the funnel ends in a `finally`; verify-pin/logout moved on
  to it; `withBusy` claims **before** it runs anything; `busyAttach` releases
  idempotently; the guard policy is the one `busy.js` exports rather than a
  second copy; search is not swallowed by the control guard; the no-op
  degradation path.
- **E. markup + CSS (8)** — `busy.js` loads before `app.js`; the `role="status"`
  region; `aria-busy` set and removed; 8 search boxes ⇄ 8 wrappers ⇄ 8 spinners;
  the accent token and **no hard-coded hex**; logical properties and **no**
  physical `left`/`right`; the reduced-motion pulse with **no** rotation; label
  swapped via `textContent`, never `innerHTML`; no skeleton introduced.
- **F. service worker (2)** — `v6`, documented, monotonic; `busy.js` is UMD and
  touches no DOM.
- **G. the real layer, executed (11)** — the busy layer is **sliced out of the
  shipped `app.js` and run in a `vm`** against a small fake DOM and the fake
  clock (the same technique the `Code.gs` tests use), so `withBusy` /
  `busyAttach` are covered by execution and not only by regex: disable at once
  → paint at 150 ms → re-enable; a fast action paints nothing but still
  re-enables; **error** and **synchronous throw** both re-enable and leave
  nothing spinning; **a second click during a save does not run the action
  twice**; the 20 s notice appears in the header and clears; `busyAttach`
  releases idempotently; a search region spins without being disabled and
  every keystroke still runs; two buttons keep their own labels while sharing
  one header spinner; `withBusy(null, …)` drives the header alone.

Five existing tests pinned shapes this PR legitimately changed and were updated
to the new (stronger) invariant: `session-who-when` (no `/api` call may bypass
`apiFetch` any more — it used to allow verify-pin), `name-picker-conflicts`
(logout through the funnel), `patient-search` and `inactive-patients-tab` (the
`wireSearchBox` wiring), and `add-user-yarden`'s service-worker test, which
pinned `v5` exactly and now guards its own bump as documented history plus a
monotonic floor.

## Deploy

- `sw.js` cache **`v5` → `v6`** — new `busy.js`, new markup and CSS, new
  `app.js`. Installed PWAs pick up the new shell on next open.
- **`Code.gs` untouched**, so no Apps Script redeploy. No server change, no new
  env var, no new dependency, no new library.
- Roll-back safety: the indicator is additive. Reverting the PR restores the
  previous behaviour exactly; nothing about the data or the save protocol
  changed.
