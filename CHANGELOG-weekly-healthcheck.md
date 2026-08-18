# Weekly automated healthcheck

Mirrors the Dashboard repo's weekly healthcheck pattern, adapted to this app's
own routes, action names, and schema. Runs every **Saturday evening Israel
time** (cron `0 18 * * 6` UTC = 21:00 IDT / 20:00 IST) plus on-demand via
`workflow_dispatch`. A **critical** breakage fails the workflow (GitHub emails
the failure notification); **data-quality** issues are warnings in the step
summary and the run stays green.

## Files

- `scripts/healthcheck.js` — standalone Node script (built-ins only, global
  fetch, Node 20+). Env: `APP_URL` (default
  `https://ezone-outpatient.up.railway.app`), `APP_PIN` (required, never
  printed).
- `.github/workflows/weekly-healthcheck.yml` — schedule + dispatch only. Never
  runs on pull requests, so it can never gate merges (the repo's required
  status check remains the `test` job; branch protection untouched).
- `test/weekly-healthcheck.test.js` — node:test with injected mock fetch;
  never hits the live URL. Fixtures are built from the real header arrays
  parsed out of `apps-script/Code.gs`.

## Critical checks (any failure → exit 1)

1. `GET APP_URL` → 200 + the `E-ZONE Outpatient` HTML shell marker.
2. `POST /api/verify-pin` with the PIN → `{ ok: true }`. This app is
   **stateless** — the PIN gate stores the role in browser sessionStorage and
   issues no session cookie; any `Set-Cookie` is still captured and replayed
   defensively.
3. Every read the frontend's `loadAll()` fires in parallel (the `Promise.all`
   in `public/app.js`): `getData` (→ `leads`, `clients`), `getPayments`
   (→ `payments`), `getCharges` (→ `charges`), `getStopFlags` (→ `stopFlags`),
   `getExtraSessionRequests` (→ `requests`), `getSettings` (→ `settings`),
   `getMyStopAlerts` (→ `myStopAlerts`) — each must return 200, parseable JSON
   (a body starting with `<` = Google's HTML error page = critical), `ok:true`,
   and its expected top-level key.
4. **Clients schema drift**: `CLIENTS_HEADERS` is APPEND-ONLY with positional
   sheet mapping — exactly where silent drift is most dangerous. The header
   list is parsed from `apps-script/Code.gs` at run time (never hardcoded) and
   every field must exist by name on sampled live clients. Live header
   count/order is not verifiable without a secret-gated endpoint
   (`scanClientColumns`), so order stays enforced by the existing guard test
   `test/clients-column-order.test.js`. Empty dataset → skip with a note.

## Warning checks (never fail the run)

- Blank/missing client ids (row positions only).
- Non-empty `*Date` fields not matching anchored `^\d{4}-\d{2}-\d{2}$` across
  clients / payments / charges — date columns derived from the header arrays
  in `Code.gs` (`startDate`, `exitDate`, `paymentDate`, `nextBillingDate`,
  `packageChangeDate`, `dueDate`, `chargeDate`).
- `SessionLog` rows with `matchStatus:"no_match"` — weekly count of the known
  open issue (via the existing open `getSessionLog` read; not part of
  `loadAll`, so its failure is itself only a warning).
- **TherapistRates blank rates: SKIPPED** — no existing read endpoint exposes
  the `TherapistRates` sheet and this change adds no backend code
  (`Code.gs` is untouched).

## Security / privacy

- `APP_PIN` and cookie values are never logged; the missing-PIN error names
  the secret without echoing anything.
- CI output contains ids and counts only — never client/patient names, and
  never raw response bodies (an HTML/unparseable body is reported by first
  character + byte length only).

## Manual step (once)

Add the `APP_PIN` secret in **this** repo (secrets are per-repo): Settings →
Secrets and variables → Actions → New repository secret → `APP_PIN`. Then
Actions → Weekly Healthcheck → Run workflow to verify a green run.
