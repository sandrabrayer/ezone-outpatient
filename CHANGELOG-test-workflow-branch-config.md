# Test workflow — trigger push CI on the deployed branch

## Why

`.github/workflows/test.yml` ran on `push` to `main`, but this repo has no
`main` deployment — the deployed branch is `claude/youthful-volta-laarnk`.
Railway now has **"Wait for CI"** enabled, so a merge into the deployed branch
must trigger the Test workflow or the deploy blocks waiting on a check that
never runs.

## What changed

One line in `.github/workflows/test.yml`: the `on.push.branches` entry changed
from `main` to `claude/youthful-volta-laarnk`. Nothing else in the workflow
changed — the `pull_request` trigger, permissions, concurrency group, and test
job are untouched.
