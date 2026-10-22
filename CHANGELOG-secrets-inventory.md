# Secrets & environment-variable inventory (docs only)

## Added
- `docs/SECRETS-INVENTORY.md` — every Railway variable (`server.js`, `lib/`,
  `scripts/`), Apps Script Script Property (`apps-script/Code.gs`) and GitHub
  Actions secret (`.github/workflows/`): what it authenticates to, risk
  (high/med/low), where to rotate it, and whether rotating it signs users out
  or breaks an integration. Names only — no values.
- `CLAUDE.md` rule 8 + repo-facts row: the inventory is updated in the same PR
  as any config change; secret values are never written, logged or printed.
- `test/secrets-inventory.test.js` — scans the code for `process.env.*` /
  `env.*`, `getProperty('…')` / auth-map `*_SECRET` names and
  `secrets.*`; fails if any is missing from the inventory or if the inventory
  contains a value-shaped string (long hex/base64, deployment ID, OAuth token,
  `NAME=value`).

## Changed
- `README.md` (Deploy to Railway) and `EZONE-ECOSYSTEM-STATUS.md` link the
  inventory.

## Not changed
- No runtime code, Apps Script, workflow or SW change; no deploy needed.

## Audit findings (recorded, not fixed here)
- `README.md` still describes `getWinbackSource` as open when
  `WINBACK_SECRET` is unset; the code is fail-closed.
- `CATALOG_ADMIN_PIN` survives in a test cleanup line and a stale comment in
  `lib/catalog-admin.js`; production does not read it.
- There is no `.env.example`; `railway.json` / `Procfile` declare no variables.
