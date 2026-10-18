# OP-02b2-a — renewal journal candidate, 2026-10-18

A lost response or interrupted multi-step renewal could leave the client changed
without a confirmed payment, and a retry could target the next billing month.
This candidate records immutable source intent, reconciles exact pre/postimages,
keeps completion pending explicit acknowledgement and discovers the original
operation across devices. It never blindly recreates missing/deleted effects.

New FinancialOps source routes use existing editor/proxy authentication and the
script lock. Legacy client/payment/charge writers honor active reservations;
unrelated client saves preserve pending rows and continue. Manual review closure
records fresh evidence and a reason without changing financial rows. Existing
partial payments refuse renewal instead of being overwritten. Date/package and
amount rules retain the original cycle and backdated payment semantics.

The existing nightly backup gains Payments, ClientCharges, Credits and
FinancialOps alongside four client/lead/archive datasets. A typed-hash manifest
and read-only set validator reject mixed snapshots. Synthetic isolated restore
checks cover pending operations; actual production backup/restore evidence
remains OP-03. No new triggers, emails, settings, secrets or paid services.

Validation includes the actual Code.gs under fake Google services, interruptions
before/after all journal/effect stages, stale/missing/changed rows, immutable ids,
legacy payments, writer interference, manual review CAS and executed date-helper
parity. Real browser/server/source tests cover source failure, double submission,
response loss, a second device, original-month continuation and explicit closure.
See PR checks for exact tested SHA, counts and independent review status.

Base refreshed to merged #119 `6bdac37f` with its planned-exit feature retained.
Live Node/SW v10 verified; candidate SW v11. Last source evidence is @96;
recheck the separate #119 source release before proceeding. No production merge/deploy is authorized by this document. Read
`docs/renewal-journal.md` and `DEPLOY.md` for Node-first release, source dispatch,
old-tab limits, journal-preserving rollback and the remaining OP-02b2 flows.


Independent static review of the first candidate found no P0/P1. Follow-up fixes
refuse premature acknowledgement without changing the recoverable state, avoid
reapplying future billing policies to terminal history, and check the journal
activation requirement during restore preflight. Missing-payment follow-up and
journal scaling are explicit open controls, not implied complete.
