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
 * button was used, never by which name was picked. Appended in join order. */
const SESSION_USERS = ['ורד', 'שירן', 'יעל', 'ירדן'];

module.exports = { SESSION_USERS };
