# One-screen sign-in + calculator with all options visible — draft

Owner decisions 2026-10-20 (Sandra).

## Sign-in
- `public/index.html` / `public/app.js`: the PIN card shows the allow-listed names (buttons) above the PIN field; Submit posts `{pin, user}` once.
  No name chosen -> nothing is sent ("בחרו שם"). If the names cannot be loaded, the old PIN -> picker flow still works.
- `server.js`: `GET /api/users` is public (`no-store`) — first names of the fixed allow-list only. `/api/verify-pin` is unchanged (PIN check, allow-list, rate limit).
- Trade-off: staff first names are visible to anyone who opens the sign-in page. No PIN, data or role is exposed.
- Oren/Shahar get NO Outpatient role (they stay in the Therapists app, price-free) — decision recorded, nothing built.
- Tests: all browser sign-ins and the stubs updated (name first, then PIN); route-table test lists `/api/users` as the only new open route; Yarden stays absent.

## Calculator (pricing tab)
- Every option is a visible button: packages grouped by family, months, Solo minimum / midpoint / maximum; the quote is computed on every choice; state dropped on reset/lock.
- New real-browser test `test/package-calculator-browser.test.js`.

SW v16 → v17 (live v16 verified via #128). No `apps-script/**` change.
