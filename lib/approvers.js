'use strict';

/* Who may decide a therapist PAY question — currently the patient-no-show pay
 * gate (see CHANGELOG-no-show-pay-approval.md).
 *
 * This is DELIBERATELY NOT `lib/users.js` SESSION_USERS. That list answers
 * "who may log in and stamp updatedBy"; this one answers "whose name may
 * appear on a decision that moves money". They overlap but are not the same
 * question, and conflating them would make every future login name a pay
 * approver by accident.
 *
 *   ורד    — the approver. This is her decision in the normal course.
 *   סנדרה  — backup, for ורד's absences only.
 *
 * Both must ALSO be in SESSION_USERS: the approver name is taken from the
 * SIGNED SESSION COOKIE (never a request body), so a name that cannot log in
 * can never be stamped. test/no-show-pay-approval.test.js pins that subset
 * relation, so adding an approver who cannot log in fails the suite.
 *
 * The check is server-side and fail-closed: apps-script/Code.gs mirrors this
 * list (it cannot require() lib/) and REFUSES a decision whose cookie name is
 * not on it. The mirror is guard-tested against this file, so the two cannot
 * drift.
 *
 * Being on this list is not a role and grants nothing else — editor/viewer is
 * still decided by which PIN button was used. */
const PAY_APPROVERS = ['ורד', 'סנדרה'];

module.exports = { PAY_APPROVERS };
