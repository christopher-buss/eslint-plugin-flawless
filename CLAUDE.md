# Contributor notes

- New rule? Add a benchmark or CI fails: a `benchmark/cases/all/<rule>.tsx`
  fixture that makes the rule report, plus a `COARSE` entry in
  `benchmark/config.ts` — or add the rule to `UNSUPPORTED` there if
  eslint-rule-benchmark structurally cannot run it. A typed rule puts its
  fixture in `benchmark/cases/typed/<rule>.ts` instead and sets
  `expectedReports`.
