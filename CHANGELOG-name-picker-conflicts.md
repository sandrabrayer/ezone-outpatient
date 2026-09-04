# Name picker + stale-save conflict refusal (Outpatient PR 2)

**Why:** PR 1 (#98) gave Outpatient a signed session cookie with an optional
`user` and server-owned `updatedAt` / `updatedBy` stamps on every Clients and
Leads row — but nothing asked anyone their name, so `updatedBy` stayed blank,
and a tab that loaded a row before a colleague edited it could still overwrite
that edit on its next full save (`_saveAll` is clear-and-rewrite). This PR is
the port of E-Zone-Dashboard PR #114: **each person picks their name once
per device**, and **a stale tab can no longer overwrite a newer edit** — the
server refuses that row, keeps the sheet's version, and the tab is told and
reloaded. No other UI change.

## Phase 1 findings (read-only, on the deploy branch head `f20cd89` = the PR #98 merge)

1. **PIN flow.** `#pinSubmit` → `apiVerifyPin(pin)` (raw `fetch`, body
   exactly `{pin}`) → on `ok` set `ez_role=editor`, `enterApp()`, `loadAll()`
   if nothing loaded. `#pinViewer` = viewer role on the same cookie.
   `#logoutBtn` (יציאה) → fire-and-forget `POST /api/logout`, forget the
   role, `showPin()`. `init()` re-enters the app from `sessionStorage.ez_role`
   and always fires `loadAll()` (refused with 401 until a cookie exists).
2. **Server.** `POST /api/verify-pin` already accepts an optional `user`,
   validated (`sanitizeSessionUser` → trim / strip `<>` + control chars / cap
   40 → must be in `SESSION_USERS`), and mints the cookie with
   `SESSION_MAX_AGE = 604800 = DEFAULT_TTL_SECONDS` — a re-post simply
   re-issues one cookie with the same TTL. `GET /api/me` (gated) returns the
   cookie's name; `POST /api/logout` (open) clears it. The `/api/sheets` proxy
   overwrites `body.user` from the cookie. `lib/users.js` is the source of
   truth for the three names, pinned equal to the `assignedTo` `<select>` by
   test.
3. **Header.** `.topbar` = logo · tabs · `.topbar-right` (⚙️ settings,
   ↻ refresh, יציאה). No name shown anywhere.
4. **Load / save.** `loadAll()` = seven parallel reads; `persist()` builds
   `{leads, clients, dataVersion?, explicitRemovedIds?}` via `leadForSheet` /
   `clientForSheet` — both already echo `updatedAt` / `updatedBy` (PR 1) — and
   handles `staleSave` (toast + reload). `apiFetch` is the one 401 handler.
   The only notice helper is `toast(msg, isError)` (2.6 s auto-hide); there is
   no persistent banner helper, so the conflict banner needed its own element.
5. **`_saveAll` (Code.gs).** Under `LockService`; reads Clients into
   `existingById` / `existingCredits` / `existingOverrides`; per incoming
   client: `_deriveClientServiceType`, preserve-by-id of `creditsOwed` and
   `paymentAmountOverrides`, then `_reconcileStamps(_clientDiffCols, …)`;
   Leads the same with `_leadDiffCols`; then tombstones / merge-don't-drop /
   `_writeAll` ×2 / `_bumpDataVersion`. `_rowDiffCols` skips
   `CLIENTS_META_COLUMNS = [id, updatedAt, updatedBy, creditsOwed,
   paymentAmountOverrides]` (`LEADS_META_COLUMNS = [id, updatedAt,
   updatedBy]`). `_readAll` hands stamps back as the stored strings (the
   columns are text-forced), so the echoed and on-sheet stamps compare as
   plain strings.
6. **Audit mechanism:** none for saves — tombstone rows cover deletes only;
   the execution log (`Logger.log`, 42 call sites, no `console.log`) is the
   audit trail. Used here with a `[conflict]` prefix.
7. **Service worker:** `public/sw.js` on the deploy branch is
   `CACHE = 'ezone-outpatient-v3'`.
8. **Baseline suite:** 819 passing (after `npm ci` — the container had no
   `node_modules`, which made 6 files fail with "Cannot find module
   'express'" until installed).

## A. Name picker

- **List source: `GET /api/users`** (new, session-gated) → `{ ok, users }`
  = `lib/users.js` `SESSION_USERS`. Chosen over a duplicated client constant
  so there is exactly one list that can never drift; the picker only exists
  behind a freshly-minted cookie anyway.
- **Flow:** PIN ok → `finishLogin(pin)` → `GET /api/me`; a name → straight
  in; empty → `showUserPicker(pin)`: `#userScreen` (a second `.pin-screen` /
  `.pin-card`, "מי מתחבר/ת?"), one `<button class="btn btn-primary user-btn">`
  per name built with `textContent`, no `<input>`/`<select>`. Picking posts
  `/api/verify-pin` `{pin, user}` through the same `apiVerifyPin(pin, user)`
  helper (body is `{pin}` without a user — the PIN form is unchanged), then
  reads `/api/me` back (the name is never assumed client-side) and enters the
  app. **The PIN lives in the `showUserPicker` closure only:** it is nulled
  on first click and the local copy right after the call; it is never on
  `state` or in web storage. A failed re-issue returns to the PIN screen (the
  PIN is gone from memory, so it must be retyped). A non-401 failure of
  `/api/users` enters the app user-less (today's behaviour) — the name is a
  stamping nicety, never a gate.
- **Existing user-less sessions:** `init()` with a remembered `editor` role
  now reads `/api/me` first; an empty name → `showPin()` (PIN → picker, once);
  a name → header + `loadAll()`; any non-401 failure → `loadAll()` as before.
  Viewers never pick. No remembered role → PIN screen + background load, as
  before.
- **Header:** `<span id="sessionUser">מחובר/ת כ: <b id="sessionUserName"> ·
  <button id="switchUserBtn" class="link-btn">החלף</button></span>` in
  `.topbar-right` (before ⚙️), hidden unless the session carries a name;
  `renderSessionUser()` sets it via `textContent`. **החלף** and **יציאה**
  share one `logout()`: `POST /api/logout`, forget role + name, PIN screen.

## B. Conflict refusal (server, `_saveAll`)

- New `_staleConflictCols(diffFn, incoming, existing)`: `sheetStamp =
  existing.updatedAt`, `seenStamp = incoming.updatedAt`; returns the changed
  columns iff both non-empty AND different AND `diffFn` non-empty; `null`
  otherwise (empty echo = pre-stamping tab, empty sheet stamp = never-stamped
  row, equal stamp, pure echo, new row → all last-writer-wins as today).
- In the Clients loop — after `_deriveClientServiceType` and the two
  preserve-by-id assignments (byte-for-byte unchanged), before
  `_reconcileStamps` — a refused row is replaced by its `_readAll` sheet
  object (`clients[i] = existingRow`), so `_writeAll` writes it back
  unchanged, stamps included; it is not counted in `stamped`. Leads mirror
  this with `_leadDiffCols`. Still under the script lock; tombstones /
  merge-don't-drop / `dataVersion` untouched.
- Each refusal pushes `{ id, name, sheetUpdatedAt, sheetUpdatedBy, changed }`
  (clients first, then leads) to `result.conflicts` — **additive and absent
  when none** — and logs `[conflict] saveAll refused <kind> id=… name=…
  changed=… sheetUpdatedAt=… sheetUpdatedBy=… seenUpdatedAt=… attemptedBy=…`.

## C. Conflict handling (client)

- `public/conflicts.js` (UMD like `name-search.js`, required by tests):
  `conflictsMessage(res)` → `השינוי ל־<names> לא נשמר — <updatedBy> עדכן/ה
  קודם. הנתונים רועננו.` — names unique, joined ", " (id when nameless);
  editors unique non-blank joined " / ", else `מישהו/י`; `''` when no
  conflicts.
- `persist()`: after `apiSave`, `conflictsMessage(data)` non-empty →
  `showConflictBanner(msg)` (`#conflictBanner`, `role="alert"`, text via
  `textContent`, ✕ to dismiss) + `loadAll()` and return — the conflict path
  takes precedence over the `staleSave` toast so there is one reload, and
  **nothing is ever retried**. A clean save hides the banner.

## D. Service worker

- `CACHE`: **`ezone-outpatient-v3` → `ezone-outpatient-v4`** (documented in
  the file header: new `conflicts.js`, new markup + CSS).

## E. Tests — full suite **848 passing** (819 + 29 new; 0 skipped)

- New `test/name-picker-conflicts.test.js` (29):
  - **A server:** picker re-issue = one `Set-Cookie`, `Max-Age` and token
    expiry = 7 days (never extended), 3-part token, `/api/me` returns the
    name, the old user-less cookie stays valid; every `SESSION_USERS` name
    round-trips, `HACKER` / `ורד<script>` / `ורדx` / blank / non-string /
    object → user-less; wrong PIN + user → 401, no cookie; `/api/users` 401
    without / with a bad cookie, the exact three names with one, mounted
    behind `requireSession`.
  - **B `_saveAll` (real `Code.gs` in vm):** helper truth table; stale +
    real change → refused, sheet row byte-for-byte (every column equals the
    pre-save row), `conflicts` populated, `stamped` excludes it, one
    `[conflict]` log line naming the attempter; `conflicts` ABSENT when none;
    stale + meta-only → no refusal (stamps carried, server-managed cells
    preserved); empty seenStamp (`undefined` / `''` / `null`) → LWW +
    stamped; empty sheetStamp → LWW; fresh stamp → normal write; new row
    unaffected whatever it carries; mixed save (refused + accepted + new +
    preserved) applies per row and bumps `dataVersion`; legacy user-less
    cookie still refused with blank `sheetUpdatedBy`; Leads mirror (refused /
    written / new, meta-only / empty echo not refused); clients + leads share
    one array with exactly five keys per entry; source guard: inside the
    lock, after the preserve blocks (byte-for-byte), before the stamp
    reconcile, additive field, `[conflict]` prefix.
  - **C `conflictsMessage`:** single / blank editor → `מישהו/י` / several
    names + editors, duplicates collapsed / nameless → id / no or invalid
    conflicts → `''`.
  - **D client (source guards):** picker only when `/api/me` user is empty;
    buttons from `/api/users`, no input/select, name via `textContent`, PIN
    nulled after one use, not on `state` / web storage; header markup + order
    + `textContent` rendering; החלף and יציאה share `logout()`; init sends a
    user-less editor through PIN once, viewers never, non-401 failure still
    loads; conflict branch shows banner + reloads with no `apiSave`/`persist`
    retry and precedes `staleSave`; `conflicts.js` loads before `app.js`;
    PIN card, its buttons and the 8 tabs unchanged.
  - **E:** `sw.js` is `v4`, no `v3` left, the bump is documented.
  - **F Playwright e2e (real Chromium, skips without a browser):** PIN →
    picker (exactly the three names, no input; the PIN form sent only `{pin}`)
    → pick → `{pin, user}` posted once → header reads `מחובר/ת כ: שירן ·
    החלף`, no PIN in web storage → a lead save the stub refuses shows the
    exact banner text, echoes the loaded `updatedAt`, is never retried, ✕
    hides it → החלף → `/api/logout` → PIN screen. Second case: remembered
    editor + user-less cookie → PIN → picker once; named cookie → straight in
    with the header set and no login round-trip; remembered viewer → no
    picker, no header line.
- Updated `test/session-who-when.test.js` (2 assertions): the "changed row"
  fixture now echoes the TRUE sheet `updatedAt` with a forged `updatedBy`
  (a mismatching echo on a changed row is a conflict by design now), and the
  PIN-body guard pins the new `apiVerifyPin(pin, user)` body shape.
- While validating, the existing Playwright file `test/two-way-alerts.test.js`
  exposed a real gap: its stub has no `/api/me`, and a first version of the
  new `init()` skipped `loadAll()` on that 404. Fixed in `app.js` (non-401
  failure → load user-less) rather than in the fixture; the file passes
  unchanged (22/22).

## Deploy

- No env step. Merge (merge commit) → Railway redeploys the Node app
  (`/api/users`), clasp CI redeploys the Apps Script (conflict refusal).
  Installed PWAs pick up the new shell on next open (`v4`).
- **What people see once:** the next load of an already-logged-in editor
  device shows the PIN screen, then the name picker. From then on the header
  shows their name; `updatedBy` fills in as they save.
- Roll-back safety: the response field is additive; an old client ignores
  `conflicts` (its refused rows are simply kept on the sheet, exactly the
  safe outcome).
