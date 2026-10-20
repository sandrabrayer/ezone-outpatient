# OP-03 operational recovery coverage — draft, 2026-10-19

- Adds SessionLog, TherapistRates, Settings and six workflow/audit tables to the
  locked backup set, preserving their own schemas and optional absence.
- Captures unknown tabs as values with explicit inventory; requires a reviewed
  plan before operationally certifying them. Keeps legacy manifests inspectable.
- Adds versioned recovery metadata, strict complete-set verification, expanded
  retention and compact snapshot grids. No credentials are backed up.
- Adds editor-only recovery hold/preflight/release checks; queued cooperating
  writers recheck the hold under their lock. Settings writes now share the lock.
- Real-source recovery regressions cover duplicate credit prevention, payroll
  forwarding stamps and custom rates, alongside existing mixed journal tests.
- No business calculations, public assets, catalog ownership or production data
  changed. Google round-trip, manual-tab plan, independent review and production
  approval remain open. See [the runbook](docs/operational-recovery.md).

## Integration with released packages — 2026-10-20

- Integrates deployed f7b37d7 (#122/#126) into the existing draft, preserving
  current pricing access and SW 15 with no new public-asset change.
- Retains both package datasets and checks recovery hold after _pkgLock acquires.
- Adds real seeded/approved package restore/retry and queued-writer regressions.
- Records read-only manual-tab inventory and a proposed archive treatment;
  unknown-tab gate remains closed pending review. No production writes.

## Limited review follow-up — 2026-10-20

- Clarifies that missing required operational state is inspection-only, registry
  evolution needs a reviewed migration path, and configuration remains an
  operator attestation without persistent who/when evidence.
- Adds nine real-source failure/order/inventory regressions after Claude's
  limited static review of 917bae83. No runtime code changed in this follow-up.
- Review does not cover writer locks/journal internals or replace the Google drill.

## Backup/recovery coordination — 2026-10-20

- Reproduced the second Claude review's overlap: a pre-hold job could still write
  source inventory/sentinels after capture. A whole-run ScriptLock-protected
  marker now blocks recovery completion until all backup writes finish.
- New jobs cannot enter during a hold or another job. Begin reports draining;
  finish refuses while active. No long script lock spans snapshot/network work.
- Adds five overlap/concurrency/failure/abandoned-marker tests; removing the
  finish guard makes both overlap regressions fail. Full UTC: 1638/0/37.
- Documents verified operator cleanup for uncatchable termination, plus remaining
  hold-age alert, manual-tab retirement and remnant-monitoring follow-ups.
