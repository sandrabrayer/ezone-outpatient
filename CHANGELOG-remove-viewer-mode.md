# Remove «המשך כצופה בלבד» from the PIN screen — draft

Owner decision 2026-10-20 (Sandra).

- `public/index.html`: the `#pinViewer` button is gone. `public/app.js`: its handler is gone; a stale `ez_role=viewer` in sessionStorage is cleared and the PIN screen is shown.
- Not a security control: viewer mode was a client-side display mode riding the same session cookie; data routes were always gated (401 without a cookie). No server or Apps Script change.
- SW v15 → v16 (index.html + app.js changed together; live v15 via the #126 deploy).
- Tests: `test/name-picker-conflicts.test.js`, `test/session-who-when.test.js` updated (button absent, stale flag dropped, no second entry path).
