// Minimal config handed to eslint-rule-benchmark via --eslint-config. Without
// it the harness falls back to the repo's eslint.config.ts (typed linting),
// whose parserOptions merge into the benchmark config and dominate the timings;
// the rule under test is injected by the harness itself.
//
// Our harness patch preserves real fixture paths for TypeScript projects.
// Only typed fixtures load a project; other benchmarks keep their usual parser.
export const typedParserOptions = {
	// Benchmarks re-lint the same files. CI's single-run heuristic treats these
	// iterations as fixes and drops imported types from an isolated program.
	disallowAutomaticSingleRunInference: true,
	project: "./cases/typed/tsconfig.json",
	tsconfigRootDir: import.meta.dirname,
};

export default [
	{
		files: ["**/benchmark/cases/typed/**/*.ts"],
		languageOptions: { parserOptions: typedParserOptions },
	},
];
