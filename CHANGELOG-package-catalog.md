# Package catalog + pricing requests (OP-PKG) — draft

**Why.** Package prices (PDF «קטלוג שירותים איזון 2026») should live in the system
so a house manager can pick an option and Vered gets a computed, adjustable,
approvable quote — without managers ever seeing a price and without touching
billing.

## Added
- **Apps Script** (`apps-script/Code.gs`): sheets `PackageCatalog`,
  `PackageRequests` (append-only headers, lazily created, text-forced columns,
  nightly backup + restore manifest 9|11 rows); deterministic quote engine
  (integer agorot, inclusive VAT, half-up); manager actions
  `getPackageCatalogPublic`, `getPackageRequestStatus`, `createPackageRequest`;
  admin actions `admin{Get,Seed,Save}Package…`, `adminQuotePackage`,
  `adminListPackageRequests`, `admin{Adjust,Approve,Attach}PackageRequest`;
  `_pkgAdminAssertionOk` (body-bound HMAC, ≤ 300 s).
- **Node**: `lib/catalog-admin.js` and routes `GET /api/catalog-admin/status`,
  `POST …/login`, `POST …/logout`, `POST …/rpc`; `/api/sheets` refuses
  package/admin actions (403) and authority fields (400); `RETIRED_SESSION_USERS`.
- **UI**: `public/package-pricing.js`, tab «תמחור חבילות», CSS; SW v12.
- **Docs**: `docs/package-catalog.md`, `docs/package-therapists-contract.md`,
  README, DEPLOY, ecosystem status, source-auth boundary, Hebrew user guide.

## Changed
- ירדן removed from `SESSION_USERS` / assignedTo; stop-alert and resume copy now
  says «צוות מסלול המשך». Her historical `updatedBy` values are untouched.
- `PHONE_COLUMNS` gains `patientPhone` (leading zero kept); `_isTextForcedColumn`
  knows the package text columns.
- Docs no longer say Apps Script auto-deploys on push (it is an explicit
  `workflow_dispatch` with `expected_commit`).

## Not changed (by design)
Charges, payments, renewals, credits, `TherapistRates`, payouts, existing
`*_HEADERS`, `treatment-map.js`, `therapist-pay.js`.

## Tests
`test/package-catalog.test.js` (30), `test/catalog-admin-routes.test.js` (11),
`test/package-ui-assets.test.js` (7), `test/retire-user-yarden.test.js` (5, replaces
`add-user-yarden`); updated: nightly backup (8 → 10 sets + legacy manifest case),
source-auth boundary (admin actions need an assertion), session/name-picker/line-
ending/alert-copy tests. Full suite: see PR description.

## Open
Business questions, configuration, confidentiality findings (`treatment-map.js`,
`therapist-pay.js`, therapists `amountOwed`), PR #121 overlap and the therapists
implementation are listed in `docs/package-catalog.md`.


## Review follow-ups (2026-10-18) — authorization and integration
- **Session-bound pricing privilege.** The admin cookie now points at an in-memory server-side session bound to
  the exact base session and named user; `/api/catalog-admin/logout` and `/api/logout` revoke it immediately
  (a copied cookie dies at once); re-login replaces it; restart fails closed.
- **Two-step, fail-closed sign-in (review round 3).** `{pin}` mints only a 10-minute NAME-LESS session that reaches
  `/api/users` + `/api/me` and nothing else (`401 name_required` everywhere, including ordinary reads/writes);
  `{pin, user}` mints the 7-day named session; unknown / retired names are refused (`403 user_not_allowed`, no cookie).
  Old name-less cookies and cookies of retired/unknown names no longer reach any data route. Rotating
  `APP_PIN`/`SESSION_SECRET` remains required to revoke knowledge; the code no longer depends on it.
- **Unique login identity + re-login revocation.** Tokens carry a random login id (`lib/session.js`); any successful
  login revokes the catalog privilege of the session cookie it presented and clears the admin cookie. Replay tests
  keep the old base+admin pair and prove it is `admin:false` afterwards, including two same-name logins in one second.
  Pre-change cookies (no login id) cannot enter pricing (`fresh_login_required`) — one re-login.
- **Lock-out: reduced, NOT eliminated.** Failure-only limiter (session 5 / IP 30 / global 60 per 15 min). The earlier
  wording "others cannot lock Vered out" was wrong: 30 wrong attempts from her office IP or 60 globally still block a
  fresh session for ≤ 15 min (`429` + `Retry-After`; restart clears). Documented as a residual risk in
  `docs/package-catalog.md`; brute-force protection is unchanged. `CATALOG_ADMIN_PIN` is 8–32 characters.
- **#121 merged first** (`2d4950f`): this branch now includes it (merge commit). SW re-bumped **v12 → v14** (v13 is taken by #123, which merges first);
  backups combined (10-sheet set, legacy 8/9-row manifests still restore); #121's tests use שירן.
- Release order and per-repo deployment mechanics documented in `docs/package-catalog.md`.

## Owner decisions + range tiers (2026-10-19)
- VAT 18 % and the May-2026 prices confirmed; Solo extension keeps the same price; day-track entitlements stay unmodelled; Vered owns continuation/stop.
- UI: range items offer מינימום / אמצע / מקסימום (`rangeTiers`); no free-text price. Server validation unchanged. Test: `test/package-ui-assets.test.js`.
