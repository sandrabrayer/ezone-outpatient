'use strict';

/* Continuation-track identity (OP-ID-2, CHANGELOG-care-continuum-continuation.md).
 *
 * The browser may name a patient ONLY by the Dashboard's stable stay id
 * (`dashboardPatientId`, = Dashboard Patients.id, carried by the admitted roster
 * since D-ID-1). Everything else about the patient — name, phone, house,
 * entryDate, personId — is resolved HERE from the server-held roster and
 * overwrites whatever the browser sent. No phone / name lookup exists on this
 * path: zero exact-id matches fail closed, more than one is a conflict.
 *
 * Pure: no fetch, no Express. server.js supplies the roster rows. */

const CARE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

// Fields a browser must never control on a continuation save. Identity is
// overwritten from the roster; links / trust markers / owner / source are
// dropped (links are written only by the server-side orchestration).
const BROWSER_STRIPPED_FIELDS = [
  'name', 'house', 'entryDate', 'phone', 'dashboardPersonId', 'key',
  'outpatientId', 'outpatientEntity', 'linkSource', 'trusted', 'verified',
  'assignedTo', 'source', 'handoffSource', 'continuationKey', 'outcomeDate',
  'proxySecret', 'secret', 'user'
];

function careId(v) {
  const x = String(v == null ? '' : v).trim();
  return CARE_ID_RE.test(x) ? x : '';
}

function str(v) { return String(v == null ? '' : v).trim(); }

/* Legacy join key — must match ContinuationLogic.buildKey byte-for-byte. */
function buildKey(name, house, entryDate) {
  return str(name) + '|' + str(house) + '|' + str(entryDate);
}

/* Resolve ONE admitted roster row by exact stable id.
 * @param {Array} patients  roster rows ({id, personId, name, phone, house, entryDate})
 * @param {string} requestedId
 * @returns {{ok:true, identity:{...}} | {ok:false, error:string, status:number}} */
function resolveIdentity(patients, requestedId) {
  const id = careId(requestedId);
  if (!id) return { ok: false, error: 'continuation_identity_required', status: 400 };
  const rows = Array.isArray(patients) ? patients : [];
  const hits = rows.filter((p) => p && str(p.id) === id);
  if (hits.length === 0) {
    // Distinguish "the feed has no ids yet" (D-ID-1 not live) from "not admitted".
    const anyIds = rows.some((p) => p && str(p.id));
    return anyIds
      ? { ok: false, error: 'continuation_patient_not_admitted', status: 404 }
      : { ok: false, error: 'continuation_identity_unavailable', status: 409 };
  }
  if (hits.length > 1) return { ok: false, error: 'continuation_identity_conflict', status: 409 };
  const p = hits[0];
  const name = str(p.name), house = str(p.house), entryDate = str(p.entryDate);
  return {
    ok: true,
    identity: {
      dashboardPatientId: id,
      dashboardPersonId: careId(p.personId),
      name, house, entryDate,
      phone: str(p.phone),
      key: buildKey(name, house, entryDate)
    }
  };
}

/* Build the trusted saveContinuation payload: browser keeps ONLY
 * meetingDate / outcome / note; identity comes from `identity`; link fields
 * only when `link` is supplied by the server-side orchestration. */
function buildSavePayload(browserBody, identity, link) {
  const b = browserBody && typeof browserBody === 'object' ? browserBody : {};
  const out = {
    action: 'saveContinuation',
    key: identity.key,
    name: identity.name,
    house: identity.house,
    entryDate: identity.entryDate,
    dashboardPatientId: identity.dashboardPatientId,
    dashboardPersonId: identity.dashboardPersonId,
    meetingDate: str(b.meetingDate),
    outcome: str(b.outcome),
    note: str(b.note)
  };
  if (link && careId(link.outpatientId) && (link.outpatientEntity === 'lead' || link.outpatientEntity === 'client')) {
    out.outpatientId = careId(link.outpatientId);
    out.outpatientEntity = link.outpatientEntity;
  }
  return out;
}

/* The createContinuationLead payload: identity + the two browser fields. */
function buildCreatePayload(browserBody, identity) {
  const b = browserBody && typeof browserBody === 'object' ? browserBody : {};
  return {
    action: 'createContinuationLead',
    dashboardPatientId: identity.dashboardPatientId,
    dashboardPersonId: identity.dashboardPersonId,
    name: identity.name,
    phone: identity.phone,
    house: identity.house,
    entryDate: identity.entryDate,
    meetingDate: str(b.meetingDate),
    note: str(b.note)
  };
}

module.exports = {
  CARE_ID_RE, BROWSER_STRIPPED_FIELDS, careId, buildKey,
  resolveIdentity, buildSavePayload, buildCreatePayload
};
