// Minimal config handed to eslint-rule-benchmark via --eslint-config. Without
// it the harness falls back to the repo's eslint.config.ts (typed linting),
// whose parserOptions merge into the benchmark config and dominate the timings;
// the rule under test is injected by the harness itself.
//
// Deliberately empty of parser/parserOptions. eslint-rule-benchmark picks the
// parser from each fixture's extension (.ts/.tsx → @typescript-eslint/parser,
// with jsx enabled for .tsx) and lints every fixture by BARE BASENAME. That last
// detail rules out typed linting here: a basename can never be inside any
// tsconfig, so setting parserOptions.project only makes typescript-eslint fatally
// error ("that TSConfig does not include this file") on every file. Rules that
// require type information (e.g. prefer-read-only-props) therefore cannot be
// benchmarked with this tool — see config.ts's UNSUPPORTED list.
export default [{}];
