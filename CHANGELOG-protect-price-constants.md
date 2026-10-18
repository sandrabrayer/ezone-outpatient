# Price and pay constants are no longer public assets

Draft for review. Not merged, not deployed. Branch `claude/protect-price-constants`, base
`claude/youthful-volta-laarnk` @ `2d4950f`.

## Problem (release blocker found in the package-catalog review)
`public/treatment-map.js` (client price table incl. VAT, day-center monthly prices) and
`public/therapist-pay.js` (per-therapist pay rates) were served by `express.static` to anyone who could
reach the site — **no PIN, no session**.

## What changed
- **Server:** both files are served only to a valid, non-retired session, `Cache-Control: no-store`.
  Matching is on the decoded (up to 3 levels), normalised, lower-cased path and **by stem**, so encoded,
  dotted, double-slash, re-cased, trailing-space/dot, `;x` and `%00` spellings cannot reach `express.static`
  (`404`/`401`, never the bytes). `therapist-payout.js` (pure logic, no constants) stays a normal static file.
- **Page:** the three script tags are replaced by one ordered list (`<meta name="ezone-protected-scripts">`);
  `app.js` loads them **after** the first authenticated read succeeds (a signed-out page never requests them)
  and **drops** the script nodes and globals on logout and on a 401.
- **Service worker:** never caches them; cache name bumped **v12 -> v13**, which also deletes every older
  cache that holds a stored copy on activate (installed PWAs). Re-check the **live** SW version before release.
- Billing math, charges, payments, renewals, credits, TherapistRates and payout calculations are unchanged; the
  two files are byte-identical and still unit-tested directly.

## Tests
`test/protected-price-assets.test.js` (spellings x GET/HEAD, byte-identical authenticated serving, value scan of
every other public asset, page/SW/cache-list guards, unit), `test/protected-price-browser.test.js` (real browser:
absent before sign-in, present after, dropped on logout, never in Cache Storage; CI job `lead-save-browser`).

## What this does NOT do (stated plainly)
- Anyone who knows the shared `APP_PIN` and signs in can still read the constants in the browser: the billing UI
  needs them. This closes the **unauthenticated** exposure only. Per-role hiding (e.g. pay rates only for Vered)
  needs the constants computed server-side — a larger change, not done here.
- The files remain in git history.
- Rotating `APP_PIN`/`SESSION_SECRET` is still a separate operator step (see `docs/package-catalog.md`).

## Ordering
Release this **before** the package-catalog PR (#122). Whoever merges second re-bumps the SW from the live
version (this PR: v13; #122 is prepared as v14).
