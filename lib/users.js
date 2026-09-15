'use strict';

/* The fixed set of outpatient users — the SAME four names as the leads
 * `assignedTo` dropdown in public/index.html (משוייך ל). Single source of
 * truth for the server: /api/verify-pin accepts a session `user` ONLY from
 * this list (anything else mints the legacy user-less cookie), so updatedBy
 * can never carry an arbitrary string, however the request was crafted.
 *
 * The index.html <select name="assignedTo"> options must all be names on THIS
 * list (tests pin that containment, so an assignee can never be a name the
 * server would refuse). They are no longer required to be EQUAL: סנדרה logs in
 * to decide therapist-pay questions (lib/approvers.js) but is not a leads
 * assignee, so she is here and deliberately NOT in that dropdown. Adding a name
 * that SHOULD also take leads means adding it in both places.
 * The login name picker (PR 2) offers exactly this list — served by the
 * session-gated GET /api/users, so the client keeps no copy — and feeds the
 * pick back to /api/verify-pin.
 *
 * Every name in this list carries the SAME permissions: the list is an
 * allow-list of who may stamp updatedBy, not a role table. There is no role
 * anywhere in it — the only roles are editor/viewer, decided by which PIN
 * button was used, never by which name was picked. Appended in join order.
 * (סנדרה is appended last for the therapist-pay approval gate; being on this
 * list gives her nothing beyond what every other name has — the approver
 * allow-list is the separate lib/approvers.js.) */
const SESSION_USERS = ['ורד', 'שירן', 'יעל', 'ירדן', 'סנדרה'];

module.exports = { SESSION_USERS };
