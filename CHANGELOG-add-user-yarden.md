# Add ירדן (Yarden) as an outpatient user

**Why:** ירדן now works leads and clients alongside ורד / שירן / יעל, but she
was not on the app's fixed user list — so she could not pick her name after the
PIN, her saves stamped a blank `updatedBy`, and the leads **משוייך ל**
(`assignedTo`) dropdown could not be set to her. This adds her name to the one
allow-list that drives all three. **Nothing else changes:** no new role, no new
permission, no new gate.

## What the list actually is

`lib/users.js` `SESSION_USERS` is an **allow-list of names**, not a role table:

- `POST /api/verify-pin` accepts a session `user` **only** if it is on this
  list, so `updatedBy` can never carry an arbitrary string however the request
  is crafted.
- `GET /api/users` (session-gated) serves the same list to the login **name
  picker**, so the client keeps no copy that could drift.
- `test/session-who-when.test.js` pins the list **equal** to the
  `<select name="assignedTo">` options in `public/index.html`, so the login
  names and the assignment dropdown can never diverge silently.

The only roles in the app are **editor / viewer**, and they are decided by
which PIN button was used — never by which name was picked. So "the same
permissions as the existing users" is the *default and only* outcome of adding
a name here; there is nothing extra to grant.

## Changes

| File | Change |
| --- | --- |
| `lib/users.js` | `SESSION_USERS` `['ורד','שירן','יעל']` → `['ורד','שירן','יעל','ירדן']` — **appended**, so the existing three keep their order. Header comment updated (three → four) and extended to spell out that the list carries no roles. |
| `public/index.html` | `<option>ירדן</option>` appended to the single `<select name="assignedTo">`, in the same order as the list. |
| `public/sw.js` | `CACHE` `ezone-outpatient-v4` → **`v5`** + a header history line. `index.html` changed, so an installed PWA must not keep serving the old shell whose משוייך ל dropdown lacks her. |
| `apps-script/Code.gs` | **Comment only** — the `assignedTo` column note listed the three old names. No executable line changed. |

**No change needed** to `server.js`, `public/app.js`, or the Apps Script
`_saveAll` logic: all three read the list rather than hardcoding names.
`server.js` contains no user name at all, and the picker builds its buttons
from `GET /api/users`.

## Verifying the two things you asked about

Both are covered by tests that run the **real** shipped code (the server on a
local port; `Code.gs` in a `vm` sandbox over in-memory sheets):

1. **`updatedBy` stamping records "ירדן".** A save posted as ירדן stamps
   `updatedBy = 'ירדן'` on a changed client, a changed lead **and** a new row,
   with the server clock (never the payload's). A parity test runs the same
   save as all four users and asserts every result is identical except the name
   itself.
2. **The stale-save conflict refusal works for her like everyone else.** Both
   directions:
   - ירדן saving a **stale** row (her tab loaded it before someone else's edit)
     is **refused** — the sheet row is kept byte-for-byte, the row is reported
     in `conflicts`, it is not counted as `stamped`, and the `[conflict]` audit
     line names her as the attempter.
   - A row **she** last stamped refuses someone else's stale save, reported as
     `sheetUpdatedBy: 'ירדן'`.
   - Her escape hatches are unchanged too: a fresh stamp writes normally, and an
     empty echo (a pre-stamping tab) is still last-writer-wins.

## Tests — full suite **872 passing** (855 + 17 new; 0 failing, 5 skipped)

New `test/add-user-yarden.test.js` (17):

- **A. the list (4):** ירדן present and **appended last** with the existing
  three in their exact order, no duplicates, a flat list of strings (never
  `{name, role}` objects); `lib/users.js` still exports nothing but
  `SESSION_USERS` and its *code* contains no role/permission/admin identifier;
  the list still equals the `assignedTo` options exactly and there is still
  exactly one such `<select>` to keep in sync; `app.js` still fills the picker
  from `GET /api/users` and holds no hardcoded name array.
- **B. server parity (4):** `/api/users` returns all four in list order;
  every name — ירדן included — logs in with the same 3-part signed token, the
  same 7-day TTL and exactly one cookie, and `/api/me` hands the name back;
  near-miss spellings are still refused (`ירדןx`, `ירד`, `ירדן לוי`,
  `ירדן<script>`, `Yarden`, and **`לירדן`** — the unrelated stop-alert
  wording); a wrong PIN with her name is still 401 with no cookie.
- **C. stamping (2):** as described above.
- **D. conflict refusal parity (3):** as described above.
- **E. blast radius (3):** she gets **no therapist pay rate** (she is a user,
  not a therapist — שירן's existing rate is untouched, ורד and יעל still have
  none); the pre-existing stop-alert copy that already said "ירדן" (a different
  person-reference in the app) is unchanged; the existing three still log in
  and still stamp.
- **F. service worker (1):** `v5` is live, no `v4` assignment remains, the bump
  is documented, and the version is **monotonic** — every version in the header
  history is ≤ the live one, and the live one is the newest.

Updated two existing files, both of which hardcoded the old three-name list:

- `test/session-who-when.test.js` — the drift test's literal list is now the
  four names.
- `test/name-picker-conflicts.test.js` — the `/api/users` literal list is now
  the four names; the e2e title "three buttons" → "one button per
  `SESSION_USERS` name" (it already asserted against `SESSION_USERS`, so the
  test itself needed no logic change); and its service-worker test, which
  pinned `v4` exactly, now guards its own `v3 → v4` bump as **documented
  history plus a monotonic floor**, so the current version is owned by the PR
  that sets it instead of every future bump breaking an old PR's test.

## Deploy

- **No env step, no Script Property, no sheet edit.** The list lives in
  version-controlled code (`lib/users.js`), so the merge is the whole change.
- Merge → Railway redeploys the Node app (`/api/users` starts serving four
  names). The `apps-script/**` comment touch also fires
  `.github/workflows/deploy-apps-script.yml`, which pushes with clasp and
  publishes a **new version of the EXISTING deployment** — the `/exec` URL is
  unchanged, so the therapists and dashboard consumers are unaffected.
- Installed PWAs pick up the new shell on next open (`v5`).
- **What ירדן sees:** PIN → the picker now shows a fourth button, **ירדן**.
  From then on the header reads `מחובר/ת כ: ירדן · החלף` and her saves stamp
  her name. Existing users see one extra button and nothing else.
- Roll-back safety: removing the name from `lib/users.js` reverts the whole
  feature. Rows she already stamped keep the text "ירדן" in `updatedBy` — it is
  a recorded fact, not a foreign key, so nothing breaks.
