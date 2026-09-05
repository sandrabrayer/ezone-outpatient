# End-user guide for E-ZONE Outpatient (Hebrew, RTL)

**Why:** the app had developer documentation only (`README.md`, the
per-feature `CHANGELOG-*.md` files, `DEPLOY.md`). Nothing in the repo
described the system from the point of view of the people who use it every
day (ורד / שירן / יעל), and the support bot that answers usage questions had
no versioned source of truth to work from. This PR adds that guide.

## What was added

- **`docs/USER-GUIDE.he.md`** — the end-user guide, in Hebrew. Sections:
  1. **כניסה** — login with the password, who to ask when there is no password
     (סנדרה / ורד), and that the bot never hands out passwords.
  2. **פעולות יומיומיות** — leads & outpatients (incl. the `לא רלוונטי` status
     with a reason), renewals, treatment plans, editing a patient card.
  3. **תשלום למטפלים** — exists in the system but is **not in use yet**; the
     data comes from the therapists' app which has not been activated.
  4. **כללי עבודה חשובים** — refresh before editing, never edit the same
     patient from two computers at once, verify a change after saving.
  5. **בעיות נפוצות** — duplicates (never delete on your own), a patient/lead
     that "disappeared" (check the other statuses first, then report — never
     re-enter), changes that do not save.
  6. **למי פונים** — usage questions → the bot; faults → "משהו לא עובד";
     passwords and urgent matters → סנדרה.
- **RTL rendering.** The Markdown body is wrapped in
  `<div dir="rtl" lang="he">` … `</div>` with blank lines around it, so GitHub
  (and any CommonMark renderer) lays the Hebrew out right-to-left while still
  parsing the headings / lists inside as Markdown.
- **`README.md`** — new "User guide" section linking to the file.
- **`CHANGELOG.md`** — `[Unreleased] → Added` entry.

## Security notes

- The guide contains **no credentials**: no PIN, no `SESSION_SECRET`, no
  Apps Script URL, no phone numbers. It deliberately tells users the bot does
  not give out passwords and that password requests go to a named person.
- The guard test below fails the build if a future edit introduces anything
  that looks like a secret into the guide (a `PIN=` / `SECRET=` / `password:`
  assignment, a Google Apps Script `/exec` URL, or a long hex token).
- Nothing in the app's runtime (`server.js`, `public/`, `apps-script/`)
  changed. The guide is not served by the app; it lives in the repo only.

## Login wording aligned with the app

The first draft recommended ticking "זכור מכשיר זה". The app has no such
checkbox: a correct PIN mints a signed session cookie for
`DEFAULT_TTL_SECONDS` (7 days, `lib/session.js`) automatically, and the name
picker remembers the chosen name per device (see
`CHANGELOG-name-picker-conflicts.md`). The bullet now says the device stays
logged in for 7 days and that you pick your name from the list once. Test 5b
pins the "7 ימים" in the guide to the exported TTL constant so a TTL change
fails the build until the guide is updated.

## Tests

New `test/user-guide.test.js` (13 tests). It is a pure file-content guard —
no server, no network:

1. the guide exists and is non-empty UTF-8;
2. it opens with `<div dir="rtl"` and closes with `</div>`, with blank lines
   around both so the Markdown inside is still parsed;
3. the H1 names the app in Hebrew and English;
4. every one of the six required `##` sections is present, in order;
5. the login section says the bot does not hand out passwords, and (5b)
   describes the real session behaviour — no "remember device" checkbox,
   "7 ימים" pinned to `DEFAULT_TTL_SECONDS` from `lib/session.js`;
6. the therapist-payout section says the feature is not in use yet;
7. the "who to contact" section routes faults to "משהו לא עובד";
8. the guide never mentions deleting duplicates yourself without the
   "do not" warning (`לא למחוק לבד`);
9. no secret-looking content (env-style assignments, `/exec` URLs, long hex);
10. no `http(s)://` links at all (the guide is offline-safe);
11. the tabs the guide relies on (לידים, מטופלים, תשלומי מטפלים) and the
    `לא רלוונטי` / `תוכנית טיפול` / `חידוש` wording all exist in
    `public/index.html`, so the guide cannot silently drift from the UI;
12. `README.md` links to the guide.

Suite: 848 → 861, all passing (`npm test`).
