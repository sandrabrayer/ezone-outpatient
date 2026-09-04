# Signed session cookie + who/when stamping (Outpatient PR 1)

**Why:** three people now use the E-Zone apps concurrently. Outpatient had
**no session**: `/api/verify-pin` answered `{ok:true}` and forgot about it,
and `/api/sheets` (all patient data, all writes) was reachable by anyone who
knew the Railway URL. This PR ports the design E-Zone-Dashboard shipped in
PRs #113 (session user + `updatedAt`/`updatedBy` stamping) and #114 (name
picker + stale-save refusal), adapted to Outpatient's two differences:
Clients rows **already have an `id`** (column 1) and there was **no cookie at
all**. Result: a signed HttpOnly session, an optional tamper-proof `user`
inside it, and server-owned who/when stamps on every Clients and Leads
write. **Zero user-visible change beyond the login now setting a cookie**
(and the login being required before data loads). PR 2 adds the name picker
and the `updatedAt` conflict refusal.

## Phase 1 findings

1. **Session.** `POST /api/verify-pin` compared the PIN (constant-time,
   rate-limited 10/15 min per IP) and returned `{ok:true}` with no cookie;
   the "logged in" state lived only in the browser's `sessionStorage`
   (`ez_role`). `GET`/`POST /api/sheets`, `/api/continuation-roster` and all
   five `/api/debug/*` routes were ungated.
2. **Cross-app callers of Railway: none.** Verified against the live
   consumers' sources (read-only clones):
   - **ezone-therapists** — `server.js` proxies `getDebtStatus` /
     `getTreatmentPlans` / stop-alerts to `OUTPATIENT_SHEETS_URL`, and its
     `Code.gs` posts `flagStop`, `resolveStopFlag` (by phone),
     `setClinicalType`, `deactivateClient`, `recordSessionOutcome`,
     `requestExtraSession` to the same `OUTPATIENT_SHEETS_URL` — documented in
     both files as "the ezone-outpatient Apps Script **/exec** URL".
   - **E-Zone-Dashboard** — `server.js` posts `createLead` to
     `OUTPATIENT_LEAD_URL` = the Apps Script `/exec` (per
     `EZONE-ECOSYSTEM-STATUS.md`: "All three consumers point at [the Apps
     Script]").
   - The weekly healthcheck (`scripts/healthcheck.js`, GitHub Action) is the
     only non-browser caller of Railway, and it **already** logs in via
     `/api/verify-pin` and forwards any `Set-Cookie` it receives — it works
     unchanged (its "no session cookie issued" note simply flips to "session
     cookie captured").
   So every Railway `/api/*` route is browser-only and is gated; the
   shared-secret cross-app contract lives entirely in the Apps Script
   (`_debtAuthOk`, `_stopFlagAuthOk`, `_createLeadAuthOk`, …) and is untouched.
   The README's "GET /api/sheets?action=getDebtStatus&secret=…" convenience
   path still works — behind the cookie (its forwarding tests now log in).
3. **Schema.** `CLIENTS_HEADERS` was 34 frozen positional columns ending at
   `paymentAmountOverrides`; `LEADS_HEADERS` ended at `assignedTo`. Both
   tombstone literals (`CLIENTS_REMOVED_HEADERS`, `REMOVED_LEADS_HEADERS`)
   are deliberate full literals with their own append-only rule (new Clients
   columns go **after** `restoredAt` / `originSheet`). Nine test files pin
   these tails; all updated.
4. **Write paths (Clients).** `_saveAll` (clear-and-rewrite with the by-id
   preserve blocks for `creditsOwed` / `paymentAmountOverrides` — the pattern
   extended here), `_restoreRemovedClient` (appendRow), `_mergeClients`
   (`_writeAll`), `_setClinicalType` (`_writeAll`, cross-app), and the
   single-cell writers `_writeCreditsOwed` (via `recordSessionOutcome`,
   cross-app, and the internal `correctSessionOutcome`),
   `_writePaymentAmountOverride`, `_writeNextBillingDate` (stale-billing
   repair), `_deactivateClient` (cross-app), plus the editor-run
   `applyCorruptedRowRepairsNow`. `_flagStop` / `_resolveStopFlag*` /
   `_upsertPayment` / extra-session requests never touch Clients (verified).
   **Leads:** `_saveAll`, `_createLead` (cross-app appendRow), `_removeLead`
   (move to לידים שהוסרו).
5. **Client.** 16 `fetch('/api/…')` call sites; `loadAll()` fires at `init()`
   regardless of the PIN (it could, because nothing was gated) and the PIN
   handler only revealed the shell — so gating alone would have left the app
   empty after login. Fixed below.

## A. Signed session cookie (`lib/session.js`, `lib/users.js`, `server.js`)

- `lib/session.js` — byte-for-byte port of the Dashboard's: HMAC-SHA256
  token `expiry.userB64.sig` (legacy 2-part `expiry.sig` also valid), 7-day
  TTL, constant-time compare, never throws on verify. Secret from
  **`SESSION_SECRET`** (Railway).
- `lib/users.js` — `SESSION_USERS = ['ורד', 'שירן', 'יעל']`, taken verbatim
  from the leads `assignedTo` `<select>` in `index.html`; a test pins the two
  equal.
- **Fail-closed** when `SESSION_SECRET` is unset: a clear boot log line; a
  correct PIN answers **500 `session_not_configured`** (logged) instead of a
  success that leads nowhere; every gated route answers **401**. Never open.
- `POST /api/verify-pin` — on success mints the cookie `ezone_session`:
  `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, `Secure` when
  `x-forwarded-proto=https` (Railway). Accepts an optional `user`: sanitized
  (trim, strip control chars and `<>`, max 40) then accepted **only** if it
  is in `SESSION_USERS`; anything else mints the legacy user-less token.
  Rate limiter unchanged.
- **Gated (401 JSON without a valid cookie):** `GET`/`POST /api/sheets`,
  `GET /api/continuation-roster`, `GET /api/me`, all `/api/debug/*`.
  **Open:** `/healthz`, `/api/verify-pin`, `/api/logout`, static files.
- `GET /api/me` → `{ ok, user }` (`''` for a legacy cookie).
- `POST /api/logout` → expires the cookie (`Max-Age=0`). The existing יציאה
  button calls it fire-and-forget, so a shared device does not keep a live
  7-day session.
- `POST /api/sheets` **always sets `body.user` from the verified cookie**,
  overwriting anything client-sent (`''` for legacy cookies).
- **Client:** one `apiFetch()` wrapper for the 15 data calls (`/api/sheets`,
  `/api/continuation-roster`); a 401 forgets `ez_role`, shows the PIN screen
  and throws (no error toast on top). `/api/verify-pin` keeps raw `fetch`
  (there a 401 means "wrong PIN"). After a correct PIN — and on the viewer
  button — the data is loaded if nothing loaded yet (the init-time load is
  refused until the cookie exists). Otherwise no UI change; the PIN form
  still sends only `{pin}`.
  - Consequence to be aware of: **"המשך כצופה בלבד" now needs a live cookie on
    that device** (someone entered the PIN within 7 days and did not log
    out); without one the 401 handler returns to the PIN screen. Reading
    all patient data without any credential was the hole being closed.

## B. Schema (append-only)

- `updatedAt`, `updatedBy` appended at the END of `CLIENTS_HEADERS`
  (positions 35-36) and `LEADS_HEADERS` (after `assignedTo`), and at the very
  end of both tombstone literals (after `restoredAt` / after `assignedTo`).
  Nothing before them moves; `phone` stays at 26, the payment tail at 27-30.
- `_ensureSheet` relabels the header row non-destructively as always; the
  two columns are **text-forced** (`@`, the `PHONE_COLUMNS` mechanism via the
  new `STAMP_COLUMNS`) on ensure and before every `_writeAll`, so the ISO
  stamp is never Date-coerced. Old rows read back blank until first edited.
- `CLIENTS_META_COLUMNS = [id, updatedAt, updatedBy, creditsOwed,
  paymentAmountOverrides]`, `LEADS_META_COLUMNS = [id, updatedAt, updatedBy]`.

## C. Stamping in `Code.gs`

- Helpers: `_requestUser(payload)` (defensive re-trim/escape/cap of the
  proxy-injected `user`), `_stampRow(row, user)` (`updatedAt` = ISO server
  time, `updatedBy` = user, may be blank), `_clientDiffCols(a, b)` /
  `_leadDiffCols(a, b)` (differing non-meta columns, plain String compare),
  `_reconcileStamps(...)`, and `_stampClientRow` / `_stampClientRowAt`
  (single-cell stamp of one Clients row, header-lookup-derived columns).
- **`_saveAll`:** for each client and each lead, the incoming row is diffed
  against its on-sheet row by `id` on the non-meta columns. Changed or new →
  stamped now + user; unchanged → the **sheet's** stamps are carried (payload
  stamps are never trusted). Preserved (merge-don't-drop) rows are never
  re-stamped. An explicit ✕ delete overwrites the tombstone's stamps with now
  + the deleting user, so `Clients-removed` answers "who deleted this, when";
  preserve-log snapshots keep the row's own stamps. Response gains an
  additive `stamped: { clients, leads }`.
- **Single-cell writers stamp their row** (two more single-cell writes, never
  `_writeAll`): `_writeCreditsOwed`, `_writePaymentAmountOverride`,
  `_writeNextBillingDate`, `_deactivateClient`, the Clients targets of
  `applyCorruptedRowRepairsNow`. `_setClinicalType` and `_mergeClients` stamp
  the one row they edit before their rewrite; `_restoreRemovedClient` stamps
  the restored row with the restorer.
- **Leads:** `_saveAll` (as above), `_createLead` stamps WHEN (blank user —
  dashboard receiver), `_removeLead` stamps the remover onto the removed-leads
  tombstone.
- **Cross-app receivers stamp WHEN only.** `recordSessionOutcome`,
  `setClinicalType`, `deactivateClient`, `createLead` pass `''` as the user —
  a caller-supplied `user` is never taken as `updatedBy` (the secured
  `recordSessionOutcome` dispatch blanks it explicitly; the internal
  `correctSessionOutcome` path still carries the proxy-injected user). The
  allow-list lives in the Railway proxy; on the Apps Script the value is
  only sanitized, exactly as in the Dashboard port.

## D. Tests (`node --test`) — full suite **819 passing**

- New `test/session-who-when.test.js` (29): tokens (legacy / 3-part / tampered
  / fail-closed), `SESSION_USERS` = `index.html` options, cookie attributes,
  user allow-list, sanitizer, `/api/me` round-trip, 401 matrix (no / garbage /
  expired cookie × every gated route), proxy overwrites `body.user`, logout,
  route table has no ungated data route; schema tails + text-forcing (vm over
  the real `Code.gs`); diff helpers; `_saveAll` changed / unchanged / new /
  forged / legacy-cookie / preserved / explicit-delete; every single-cell
  writer + merge / restore / createLead / removeLead; each cross-app Apps
  Script receiver still secret-gated and session-free; client source guards.
- New `test/session-fail-closed.test.js` (3): no `SESSION_SECRET` → boot log
  line, verify-pin 500 with no cookie, gated routes 401 even with a plausible
  cookie, upstream never called.
- Updated pins: `clients-column-order` (frozen array 34→36, append-only
  test rewritten), `clinical-derive`, `collection-amount-override`,
  `continuation-code`, `session-credits`, `stop-flag-match`,
  `responsible-removal`, `lead-assignee`, `nightly-integrity`,
  `stale-next-billing-repair` (header + the apply-writes count now includes
  the two stamp cells per repaired row), `corrupted-rows-cleanup` (same),
  `saveall-tombstone` (tombstone literal = Clients-minus-stamps + bookkeeping
  + stamps), `create-lead` (mirror headers), `payout-followups`
  (`_writeCreditsOwed` signature), `server-routes` / `server-fail-closed` /
  `sheets-secret-forwarding` / `debt-status-forwarding` (log in or carry a
  cookie; the fail-closed 500s now sit behind the 401 gate).

## Deploy — Railway env step (BEFORE merge)

1. In the Railway **Outpatient** service → Variables, add
   **`SESSION_SECRET`** = a long random string (e.g.
   `openssl rand -hex 32`). It is the HMAC key for every cookie; rotating it
   logs everyone out.
2. **Save it before merging.** Railway variables apply only to deployments
   started after saving; a deploy that boots without it is fail-closed (the
   PIN screen answers "error" and the data routes 401) until the next
   redeploy after the variable exists.
3. Merge (merge commit). Railway redeploys the Node app; clasp CI redeploys
   the Apps Script (same `/exec` URL). The two new columns land on the
   Clients / Leads sheets on the first `getData` / `saveAll` after the Apps
   Script deploy — no manual sheet step. Stamps accrue as people save;
   `updatedBy` stays blank until PR 2 adds the name picker.
4. Everyone enters the PIN once per device (7-day cookie). The weekly
   healthcheck needs nothing new.

## PR 2 plan

1. **Name picker after the PIN** — one-screen RTL picker with one button
   per `SESSION_USERS` name (the same list as `lib/users.js` and the
   `assignedTo` dropdown, pinned equal by test); picking re-issues the cookie
   via `/api/verify-pin` `{pin, user}`; header shows `מחובר/ת כ: <name> ·
   החלף` via `/api/me`.
2. **`updatedAt` conflict refusal in `_saveAll`** — with the stamps this PR
   writes as the baseline: for an id-matched client whose non-meta columns
   changed, refuse when the payload's echoed `updatedAt` (the client already
   round-trips it) is non-empty and differs from the sheet's; keep the sheet
   row byte-for-byte, return an additive `conflicts` array, toast
   `השינוי ל־<name> לא נשמר — <updatedBy> עדכן/ה קודם. הנתונים רועננו.` and
   reload. Empty echoed stamp (pre-PR-1 tab) or empty sheet stamp (never
   stamped row) → today's last-writer-wins.
