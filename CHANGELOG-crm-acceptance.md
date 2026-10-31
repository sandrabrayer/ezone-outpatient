# CRM program — acceptance record + release checklist (Phase F, 2026-10-31)

- `docs/crm/ACCEPTANCE-OUTPATIENT.md`: the 14 program scenarios mapped to automated evidence (test file + case), measured boot numbers (synthetic fixture), and the 5 manual post-deploy checks.
- `docs/crm/RELEASE-CHECKLIST.md`: ordered release sequence for the chain #142–#147 and its relationship to #137/#138/#139/#140/#329/#330/D-FB-1, pre-merge gates, Apps Script second phase, `HANDOFF_STATUS_SECRET`, data impact, rollback, known limits.
- `public/app.js`: an operational session no longer requests the three money reads at boot (`getPayments`, `getCharges`, `getSettings`) — measured 11 → 8 API calls for דנה; the server would have refused them anyway. `money-scope-browser` now asserts no money read is requested once signed in.

Draft only. No merge or deploy is authorized by this document.
