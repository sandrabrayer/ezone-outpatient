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
