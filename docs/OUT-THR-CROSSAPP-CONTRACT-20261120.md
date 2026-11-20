# OUT↔Therapists: participant and booking identity contract (draft only)

20 Nov 2026. Applies to OUT draft #192 after the frozen, already-green payment candidate. No merge, deploy, historical migration, production write or permission change.

## Group outcome
The Therapists sender must include the immutable Schedule row id as `treatmentId` for every group participant's `recordSessionOutcome`, alongside the shared `sessionId`. OUT stores the original shared session ID and an append-only `SessionLog.treatmentId`. Only exact `(sessionId,treatmentId)` retries update that participant; report revision ordering and credit reversal stay per-participant. A participant cannot be submitted twice in one shared session under two different treatment IDs. The existing group pricing rule remains 0 therapist pay and 0 client session value per participant; no separate payment engine is added.

A group event missing `treatmentId` is rejected, and a pre-existing legacy group row lacking this identity is held for explicit reconciliation, not overwritten. Do not silently migrate old rows.

The receiver returns `treatmentId` with group acknowledgement. Therapists must validate it matches its own immutable row before accepting receipt. The currently published Therapists #170 sender does **not yet include** this field; paired implementation and acceptance are required before any release.

## Beyond-quota request
The Therapists sender must include immutable `bookingRowId` (the originating saved Schedule row id) on `requestExtraSession`. OUT appends that column to ExtraSessionRequests. An exact repeated booking returns the original requestId/status without a new row, including once approved. The same booking ID with different identity or payload is rejected; two distinct booking IDs remain two distinct requests. A missing ID is rejected rather than guessed from phone/month.

The currently published Therapists #170 sender does **not yet include** this field. Update that sender **in its own repository and conversation**, plus an ambiguous-delivery readback contract, before release.

## Release gates
Real source sandbox tests cover group participants, replay, correction, legacy collision, duplicate participant, extra-session lost reply, already-approved replay, conflicting identity and distinct requests. Native Google, signed paired HTTP, sender ACK verification, source/Node release versions, backup/restore readiness and user acceptance remain open. Keep #192 a draft; this delta is not authorization to release.
