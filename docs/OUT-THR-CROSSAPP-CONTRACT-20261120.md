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

## Group payout and correction parity

Group participant rows remain visible as distinct clinical outcomes; when the existing group payout is zero, they are not counted as multiple **paid therapist sessions**. Public payout and Apps Script payroll use the same rule. Pre-existing nonzero historical amounts remain visible rather than being silently discarded. The correction dialogue carries the immutable `treatmentId` of the selected row; an unidentified legacy group result is held for review. Creating group sessions through OUT's manual payout form is refused. Offline cache v43 packages this UI change.

## Exact acknowledgement contract

A successful group `recordSessionOutcome` response echoes the immutable `sessionId`, `treatmentId`, `sessionStatus` and canonical `reportRevision` on first delivery as well as exact replay. Therapists must verify all four before marking the approved result delivered. An `requestExtraSession` response echoes `bookingRowId`, original `requestId`, and current status on first delivery and replay. A lost response must retry the *same immutable payload*; an already-approved request never becomes pending again. OUT request IDs for newly-created requests use random UUIDs. Old `esr_` IDs remain readable and accepted for existing records.

## Mixed-version rollout probes

OUT now exposes two data-free source-protected GET checks using the **existing**, distinct THR secrets: `getTherapistsGroupContract` replies `{ok:true, protocol:'out-thr-group-v1', participantKey:true, revisionAck:true}` only under `SESSION_OUTCOME_SECRET`; `getTherapistsExtraContract` replies `{ok:true, protocol:'out-thr-extra-v1', bookingRowId:true, replaySafe:true}` only under `EXTRA_SESSION_SECRET`. Missing/wrong credentials or the old OUT version fail closed. No patient or billing data is returned. THR must verify before a grouped or extra request and must not send a potentially destructive write on missing/failed/version-mismatched probes. Group results require an exact matching OUT client to avoid silently losing participant credits. Preflight does not replace final exact ACK validation.

## Crash-safe group credit and session result (21 Nov 2026)

OUT #192 now stores each group participant outcome or correction in a separate typed **SessionOutcomeOps** journal under the existing ScriptLock **before** touching `Clients.creditsOwed` or `SessionLog`. The immutable intent binds the participant's `(sessionId,treatmentId,reportRevision)`, original/target balance, old/new row fingerprints and intended result. A replay is permitted to complete only from an exactly verified old state or a partially completed known state; once a balance was already credited and the SessionLog append failed, replay writes only the log row, **not a second credit**. A lost reply after both writes confirms the existing single result. Unexpected balances, row identities or pending different reports return `session_credit_recovery_pending` without changing the balance or logging another result. Never auto-clear an indeterminate journal or rewrite a newer balance.

The journal is now a typed source in `_integritySourceSpecs` and the independent `test-support/recovery-scope.cjs` inventory, so regular backup and isolated restore carry the operation history with clinical/financial rows. Historical OUT records and pre-upgrade workbooks have no automatic backfill. The Google drill remains disabled outside an explicitly authorized separate Apps Script project.

Release **requires** the paired Therapists test `EZONE_OUT_REPO=... node --test test/paired-out-sync.test.js` against the exact final OUT and Therapists heads, including the injected failure between credits and SessionLog. Also test recovery on isolated Google Sheets with a verified backup. No source/Node merge, Apps Script/Railway rollout or production write was authorized. Rollback while Therapists requests are in flight requires first quiescing the sender and its retry worker; otherwise the old OUT receiver can accept legacy action names without the new participant identity.

The server validates the journal header and refuses an already-activated but missing/corrupted journal, rather than recreating an empty ledger. Backup rejects a missing journal once the `SESSION_OUTCOME_OPS_CREATED` marker exists. Controlled restore also refuses to reopen writers if any recovered participant-credit intent remains pending. The exact journal and session log must be reconciled first.
