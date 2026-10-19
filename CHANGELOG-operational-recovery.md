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
