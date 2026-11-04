# «תמחור חבילות» — buttons that opened nothing (fix, 2026-11-03)

**Report.** In the pricing tab, clicking buttons opened nothing (no form, window or
detail). Reproduced with the real UI + `server.js` + `Code.gs` (in-memory Sheets)
in Chromium, signed in as ורד, at 1280px and 360px.

## Root causes (all in `public/package-pricing.js`)
1. **Concurrent logins revoked each other.** `mount()` started a new `boot()` on every
   call while the first load was still in flight (the host app re-renders the tab on
   its own data refresh / tab switch). Two `POST /api/catalog-admin/login` ran; the server
   keeps ONE admin session per base session, so the second revoked the first, every
   following `rpc` answered `401 admin_required`, which started yet another boot — the
   screen was redrawn under the user's hands and whatever had been opened vanished.
   Measured before the fix: 2 logins, 2 × 401, 6 rpc for one tab open.
2. **An expired privilege swallowed the click.** The admin session lasts 15 minutes. The
   first click after that answered `admin_required`; the module re-logged in and redrew,
   but the action that was clicked was dropped silently (`mutate` ignored that error).
3. **A failed load looked like an empty screen.** `loadAll()` swallowed any failure
   (`catch → null`), so «מחשבון» showed «הקטלוג ריק», «קטלוג» showed «לא ניתן לטעון», and
   «רענון» appeared dead.

## Fix
- `ensureAdmin()` — single-flight status → login; `boot()` — single-flight too; a second
  mount during the load joins the running one. Exactly one login per tab open.
- `call()` renews the privilege ONCE on `admin_required` and retries the same request, so
  the click still does its work; only a second failure falls back to the gate.
- `loadAll()` records `S.loadError`; the admin screen shows «הנתונים לא נטענו: …» with a
  «נסי שוב» button, and the sub-views distinguish "not loaded" from "empty".
- `mount()` no longer wipes an already-drawn admin screen on an unrelated host re-render
  (an open edit row / calculator choice survives); «רענון» redraws on demand.
- No server, Code.gs, header, billing or price change. The gate text, the Vered-only
  rule and the no-second-code decision are unchanged.

## Tests
- `test/package-pricing-buttons-browser.test.js` (3, Playwright, skipped without a browser):
  desktop 1280px + mobile 360px — one login, zero 401, both manager requests priced
  (tier pick, adjustment with reason, approve, attach without charge/payment), calculator
  chips, every «עריכת מחיר» opens/closes its form, «רענון», no console errors, no horizontal
  overflow; expired privilege → `401 → status → login → rpc` once and the quote still
  renders; upstream failure → error + retry, not an empty catalog.
- `test/package-ui-assets.test.js` guard updated for the single-flight login.
