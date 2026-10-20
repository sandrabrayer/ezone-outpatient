# Pricing tab: Vered's name is enough (no second code) — draft

Owner decision 2026-10-19 (Sandra): the extra `CATALOG_ADMIN_PIN` screen is removed.

## Changed
- `lib/users.js`: `CATALOG_ADMIN_USERS = ['ורד']` (server-side allowlist).
- `server.js`: `/api/catalog-admin/login` ignores any body; needs a named, non-retired session in the allowlist (else `403 vered_only`);
  `/status` now also returns `eligible`. No limiter, no PIN env.
- `lib/catalog-admin.js`: `adminConfigStatus` requires only `SESSION_SECRET` + `CATALOG_ADMIN_ASSERTION_SECRET` (distinct).
- `public/package-pricing.js`: no code field; the tab logs in by itself when the server says `eligible`; an expired admin cookie re-opens by itself.
- `public/sw.js`: v14 → v15 (live v14 verified).
- The body-bound HMAC assertion to Apps Script, the admin-session binding to the base cookie + user, revocation on re-login/logout,
  the `/api/sheets` refusal and the price-free manager boundary are UNCHANGED. No `apps-script/**` change.

## Security trade-off (accepted by the owner)
The name is picked at sign-in with the shared `APP_PIN`; anyone who knows `APP_PIN` can pick «ורד» and open pricing. Mitigations unchanged:
rotate `APP_PIN` + `SESSION_SECRET` to revoke a leaver; a personal code per user would be the real fix. No PIN guessing surface and no
lock-out remain. The variable `CATALOG_ADMIN_PIN` can be deleted from Railway.

## Tests
`test/catalog-admin-routes.test.js` rewritten for name-only access (non-Vered 403, APP_PIN gives nothing extra, repeatable login, no lock-out,
replay on another session not admin); `test/package-ui-assets.test.js` (no code field, server-decided auto-open).
