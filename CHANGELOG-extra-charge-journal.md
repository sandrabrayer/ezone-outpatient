# OP-02b2-b — additional-charge recovery (candidate, 2026-10-18)

An interruption between creating a charge and its optional initial payment could
leave an uncertain result and tempt a duplicate charge on retry. The new flow
records immutable source intent first, resumes the original charge/payment only
when exact evidence permits it, and otherwise requires audited manual review.
Reopen/reload/another device discovers the same operation, including after a
month boundary. Existing renewal and client reservation guards are shared.

ClientCharges appends treatmentType/frequencyPerWeek: the UI previously sent
these but source dropped them. Old-tab omissions preserve already-saved values.
No other financial calculations or historical rows are migrated. Existing
initial-payment coverage/month semantics are pinned and their inconsistencies
remain OP-05. SW v11 → v12; source and Node require ordered approved release.

Source crash/auth/collision/compatibility cases, real-browser flows and mixed-kind
manifest restore scenarios exercise synthetic data only. See
[protocol, release and rollback constraints](docs/extra-charge-journal.md).
Source @97 rejects extra journal history even when terminal: use a forward fix
that retains both kinds; never erase history for rollback. Separate production
approval is required. Other financial flows and all wider app audit axes remain
open in the canonical program.
