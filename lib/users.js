'use strict';

/* The fixed set of outpatient users — the SAME four names as the leads
 * `assignedTo` dropdown in public/index.html (משוייך ל). Single source of
 * truth for the server: /api/verify-pin accepts a session `user` ONLY from
 * this list (anything else mints the legacy user-less cookie), so updatedBy
 * can never carry an arbitrary string, however the request was crafted.
 *
 * test/session-who-when.test.js pins this list equal to the index.html
 * <select name="assignedTo"> options, so the two can never drift silently.
 * Add/rename users HERE and THERE together. The login name picker (PR 2)
 * offers exactly this list — served by the session-gated GET /api/users, so
 * the client keeps no copy — and feeds the pick back to /api/verify-pin.
 *
 * Every name in this list carries the SAME permissions: the list is an
 * allow-list of who may stamp updatedBy, not a role table. There is no role
 * anywhere in it — the only roles are editor/viewer, decided by which PIN
 * button was used, never by which name was picked. Appended in join order. (ירדן left in 2026-10; see RETIRED_SESSION_USERS.) */
const SESSION_USERS = ['ורד', 'שירן', 'יעל'];

/* Names that were once on SESSION_USERS and have left. They are NOT offered by
 * the picker and /api/verify-pin refuses them, and — because a cookie minted
 * before removal stays valid for up to 7 days — the session gate (server.js
 * sessionAuthStatus) also rejects any token that still carries one. Historical
 * `updatedBy` values in the sheets are plain text and are never rewritten.
 * Removing a name does NOT revoke a person who still knows the shared APP_PIN:
 * rotate APP_PIN + SESSION_SECRET (see docs/package-catalog.md). */
const RETIRED_SESSION_USERS = ['ירדן'];

/* Who may open the pricing tab («תמחור חבילות»). Owner decision 2026-10-19: Vered's signed-in name is enough
 * (no second code). Honest limit: the name is picked at sign-in with the shared APP_PIN, so anyone who knows
 * APP_PIN can pick it. Server-side only — the browser never decides this. */
const CATALOG_ADMIN_USERS = ['ורד'];

module.exports = { SESSION_USERS, RETIRED_SESSION_USERS, CATALOG_ADMIN_USERS };
