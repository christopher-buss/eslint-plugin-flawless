// Minimal config handed to eslint-rule-benchmark via --eslint-config. Without
// it the harness falls back to the repo's eslint.config.ts (typed linting),
// whose parserOptions merge into the benchmark config and dominate the
// timings; the rule under test is injected by the harness itself.
export default [{}];
