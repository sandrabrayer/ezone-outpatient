# Changelog — Server-side PIN verification

Moves edit-mode PIN verification from the client to the server, closing
a trivial bypass (the PIN was hardcoded in `public/app.js`, readable by
anyone who opened dev tools or viewed source).

## [Unreleased]

### Why this exists

The edit-mode PIN gate compared the typed PIN directly against a literal
string shipped in `public/app.js`. Since all frontend JS is public, the
PIN was effectively printed on the page — no real access control, just
an inconvenience toggle.

### Added

- **`lib/pin.js`** — `checkPin(submitted, configured)`: constant-time
  comparison via `crypto.timingSafeEqual`. Fails closed (`false`) for
  non-string, empty, or missing values, so an unset `APP_PIN` rejects
  every attempt instead of silently accepting one.
- **`server.js`** — `POST /api/verify-pin`:
  - Reads the real PIN from the `APP_PIN` env var (`console.warn`s at
    boot if unset).
  - In-memory rate limit: 10 attempts / 15 minutes per IP
    (`x-forwarded-for`-aware, falls back to the socket address).
  - `200 { ok: true }` on match (resets that IP's counter), `401` on
    mismatch, `429` once the rate limit is exceeded.
- **`test/pin.test.js`** — unit coverage for `checkPin`: match, mismatch,
  length mismatch, fail-closed on unset/empty PIN, non-string inputs.

### Changed

- **`public/app.js`** — the `#pinSubmit` click handler no longer
  compares against a hardcoded PIN. It now `POST`s the entered value to
  `/api/verify-pin`, disables the submit button while the request is in
  flight, and only enters editor mode on `{ ok: true }`. The literal PIN
  is gone from the client bundle entirely.
- **`README.md`** — no longer states the PIN value; says it's configured
  server-side via `APP_PIN` and documents the new endpoint.

### Deploy step

The old PIN is burned (it lived in public source for anyone to read) —
**do not reuse it**.

1. In Railway, set a **new** `APP_PIN` env var on the service to a fresh
   PIN value.
2. Redeploy.
3. Share the new PIN with staff out of band (not via the repo).

Until `APP_PIN` is set, `/api/verify-pin` rejects every attempt (fail
closed) and logs a warning on startup.
