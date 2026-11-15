# Issue tracker

GitHub Issues, through `gh`.

## Triage labels

Each triage role's label is the role name: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. Category roles use `bug` and
`enhancement`.

## Pull requests

**PRs as a request surface: no.** `/triage` reads this flag. When `yes`, an
external PR is one whose author association is not `OWNER`, `MEMBER`, or
`COLLABORATOR`.

Issues and PRs share one number space: resolve a bare `#42` with
`gh pr view 42`, then `gh issue view 42`.

## Closing

Post the reason with `gh issue comment`, then run `gh issue close`. On an
already-closed issue, `gh issue close --comment` drops the comment and still
exits 0.
