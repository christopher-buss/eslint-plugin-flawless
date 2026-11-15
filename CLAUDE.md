# Contributor notes

- New rule? Add a benchmark or CI fails: a `benchmark/cases/all/<rule>.tsx`
  fixture that makes the rule report, plus a `COARSE` entry in
  `benchmark/config.ts` — or add the rule to `UNSUPPORTED` there if
  eslint-rule-benchmark structurally cannot run it. A typed rule puts its
  fixture in `benchmark/cases/typed/<rule>.ts` instead and sets
  `expectedReports`.

## Agent skills

### Issue tracker

GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.
