# «תמחור חבילות» — the tab died after a server restart (fix, 2026-11-05)

**Report (Sandra, production, 08:13, right after a Railway redeploy restarted the Node
process).** The pricing tab showed the admin tab bar (בקשות / מחשבון / קטלוג / רענון /
יציאה מתמחור) over a bare «רשימת הבקשות לא נטענה.» — no error, no retry — and «רענון»
did nothing useful. Only a full page reload brought the tab back.

## Root cause (`public/package-pricing.js`)

The catalog-admin privilege is a **server-side, in-memory record**
(`lib/catalog-admin.js` → `createAdminSessions`; memory-only on purpose, fail-closed).
A redeploy / restart forgets every record while the browser tab stays open with its
(still signed, still valid) admin cookie, so the next `rpc` answers `401 admin_required`.
The browser module had no route back from there:

1. **`loadAll()` swallowed the failure.**
   `catch (e) { if (e.message === 'unauthorized' || e.message === 'admin_required') return; }`
   returned with `S.catalog` / `S.requests` left `null` **and `S.loadError` empty**, so
   `requestsView()` drew the bare muted «רשימת הבקשות לא נטענה.» — the red
   «הנתונים לא נטענו … נסי שוב» banner is rendered from `S.loadError`, which was never set.
   Which screen that dead state wears depends on which of the two parallel `rpc`s
   (`catalog`, `list`) rejects first and on the `draw()` calls that follow: the
   `admin_required` arm (`call()` sets `S.phase='gate'`) ends on the gate, the
   `unauthorized` arm leaves `S.phase` untouched — the admin bar over no data, exactly as
   reported.
2. **The gate was a dead end.** `gateView()` is text only. When the privilege could not be
   re-obtained in that moment (the renew failing during the redeploy window), the tab sat on
   «לא ניתן לפתוח את התמחור כרגע. נסי לרענן או להיכנס מחדש.» with **nothing to press** —
   only a page reload (or a tab switch, which re-runs `mount → boot`) recovered.
3. **«רענון» could not recover by design.** It called a bare `loadAll()`, which never
   renews the privilege by itself: renewal lived only inside `call()`, and once that attempt
   had failed the button repeated the same silent return.

Reproduced in Chromium (Playwright) against the real UI + `server.js` + `Code.gs` in the
in-memory sandbox, signed in as ורד, at 1280 px and 360 px, with the restart emulated
exactly as the server experiences it — the admin-session store is replaced, every cookie in
the browser is untouched.

## Fix (browser only)

- `loadAll(renewed)` **never leaves a silent dead state**:
  - `admin_required` → `ensureAdmin()` **once**; on success the load repeats transparently
    (she simply sees the list) — the `renewed` flag bounds it to one renew per load attempt,
    so there is no retry loop;
  - the privilege cannot be re-obtained → `S.phase = 'gate'` with its existing explanatory
    text and no stale data;
  - anything else → `S.loadError`, i.e. the existing red banner + «נסי שוב»;
  - `unauthorized` still calls `S.onUnauthorized()` inside `rawCall` (sign-in) and is not
    turned into anything else; it now also records a message for a host that stays put.
- A successful load that finds the screen on the gate (a sibling call failed first and
  gated it) puts the admin screen back: the data itself proves the privilege is live.
- **«רענון» and «נסי שוב» both route through the new `refresh()` → `boot()`** — the same
  sequence as the first load (privilege, then data), so the button she naturally presses is
  the one that recovers the tab. `boot()` is single-flight, so a double click is one round.
- `gateView()` gained one control: «נסי שוב» (`refresh()`), shown only when the server said
  this session is configured and eligible. Recovery without reloading the page.
- The single-flight protections that fixed the 2026-11-03 "buttons do nothing" bug
  (`adminFlight`, `bootFlight`) are untouched, and asserted by a test.
- `mountOfferForm` (the «💰 הצעת מחיר» form inside a client card) shares `ensureAdmin()` +
  `loadAll()`, so it inherits the recovery; covered by a test.

No new endpoint, no redesign, **no `Code.gs` change — no Apps Script phase for this
release**.

## Tests

`test/pricing-session-recovery-browser.test.js` (7):

1. + 2. (1280 px, 360 px) after the server forgot the admin session, «רענון» brings the
   request list back by itself — transparently (no error on screen) and with exactly **one**
   renew (`401 /rpc ×2 → 200 /status → 200 /login → 200 /rpc ×2`).
3. the renew is refused (the restarted process is up, the login does not go through yet):
   the gate explains it, **offers «נסי שוב»**, does not loop while idle, and the retry
   restores the screen in place once the server is ready — no page reload. *Fails on the
   pre-fix code: a gate with nothing to press.*
4. a privilege that keeps lapsing (every `rpc` answers `admin_required`): the screen is
   never the silent dead state — after «רענון» and after being left idle it always shows the
   list, an error with a retry, or the gate with a retry — and the renews stay bounded.
   *Fails on the pre-fix code.*
5. a base-session 401 still sends the user to sign-in.
6. the card offer form loads after the server forgot the privilege.
7. source invariants: both buttons route through `refresh()`, `loadAll(renewed)` renews at
   most once, the `unauthorized` branch in `rawCall` is unchanged, `adminFlight` /
   `bootFlight` are still single-flight (runs without a browser, so CI checks it on every
   runner).

Full suite green (`node --test`). SW cache **v29 → v30** (`package-pricing.js` changed);
production `/sw.js` was **not reachable from this sandbox** (egress blocked) — re-check the
live worker serves v29 before release.
