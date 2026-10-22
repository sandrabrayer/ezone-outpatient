# CLAUDE.md — repo footer rule

## Added
- `CLAUDE.md` rule 8 **Repo footer**: every Claude reply to Sandra ends with one
  line naming the repo and branch —
  `📁 Repo: sandrabrayer/ezone-outpatient · Branch: <current branch>` — using
  `git branch --show-current`, with `(not pushed)` when the branch is not on
  GitHub yet, and one entry per repo in a multi-repo session. Sandra works in
  the Claude app/web, where the terminal status line is not shown.

## Scope
- Agent instructions only. No app code, `apps-script/**`, service-worker or
  dependency change; nothing to deploy beyond the normal merge.

## Tests
- `test/claude-md-repo-footer.test.js` — asserts the rule, the exact footer
  format and the `(not pushed)` / `git branch --show-current` guidance stay in
  `CLAUDE.md`.
