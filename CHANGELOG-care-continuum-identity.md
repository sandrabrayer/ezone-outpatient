# Care-continuum identity + link-or-create (OP-ID-1)

Date: 2026-10-30 · base `claude/youthful-volta-laarnk`

Continuity starts before residential discharge. Dashboard already owns stable identity; this draft teaches Outpatient to retain and use it without inventing a new identifier.

Matching for one open episode: exact stay id → exact Dashboard lead id → exact person key (`dashboardPersonId || dashboardPatientId`). Multiple exact matches fail closed. Phone+name only raises a review warning. Closed/inactive episodes remain history.

All schema additions are append-only. Browser full saves cannot overwrite source-owned identity; activation copies ids server-side from the on-sheet source lead. Client tombstones retain identity. `REMOVED_LEADS_HEADERS` is intentionally untouched while OP-03 / PR #125 owns that area.

Legacy `createLead` payloads remain valid. No merge or production deployment is authorized.
