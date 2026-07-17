import { defineConfig } from "eslint-rule-benchmark";

// Benchmarks flawless/arrow-return-style against the BUILT plugin
// (dist/index.mjs). Building first matters: the rule locates its oxfmt worker
// relative to import.meta.url, and only the built layout resolves the worker to
// dist/rules/arrow-return-style/worker.mjs. Run `pnpm build` before this.
//
// The runner lints each fixture with fix:true, reusing one ESLint instance per
// test across warmup + measured iterations, so numbers reflect the WARM,
// steady-state cost (the worker's one-time cold start is spawned during warmup
// and dropped by outlier filtering). Fixtures live in ./cases and are produced
// by ./generate-cases.mjs.

const RULE_PATH = "../dist/index.mjs";
const RULE_ID = "arrow-return-style";

export default defineConfig({
	iterations: 100,
	timeout: 1000,
	warmup: {
		enabled: true,
		iterations: 20,
	},
	tests: [
		{
			name: "no-violation implicit arrows (no worker)",
			ruleId: RULE_ID,
			rulePath: RULE_PATH,
			cases: [{ testPath: "./cases/no-violation-implicit.ts" }],
		},
		{
			name: "block -> implicit fixes (no worker)",
			ruleId: RULE_ID,
			rulePath: RULE_PATH,
			cases: [{ testPath: "./cases/block-to-implicit.ts" }],
		},
		{
			// Worst case for the worker: every consult is distinct. The format
			// cache persists across lint runs, so only warmup iterations pay the
			// worker; measured iterations read the warm cache — the steady state
			// for unchanged code. useOxfmt:false measures the pure line-length
			// path on the same input.
			name: "over-limit distinct — useOxfmt:false (pure)",
			ruleId: RULE_ID,
			rulePath: RULE_PATH,
			iterations: 50,
			timeout: 500,
			warmup: { iterations: 5 },
			cases: [
				{
					testPath: "./cases/over-limit-distinct.ts",
					options: [{ useOxfmt: false }],
				},
			],
		},
		{
			name: "over-limit distinct — useOxfmt:true (worker, warm cache)",
			ruleId: RULE_ID,
			rulePath: RULE_PATH,
			iterations: 30,
			timeout: 500,
			warmup: { iterations: 3 },
			cases: [
				{
					testPath: "./cases/over-limit-distinct.ts",
					options: [{ useOxfmt: true }],
				},
			],
		},
		{
			// Same shape and size as the distinct case, but textually identical
			// arrows collapse to a single cache entry even on a cold cache.
			name: "over-limit repeated — useOxfmt:true (worker, cached)",
			ruleId: RULE_ID,
			rulePath: RULE_PATH,
			iterations: 50,
			timeout: 500,
			warmup: { iterations: 5 },
			cases: [
				{
					testPath: "./cases/over-limit-repeated.ts",
					options: [{ useOxfmt: true }],
				},
			],
		},
		{
			name: "realistic mixed file (few consults)",
			ruleId: RULE_ID,
			rulePath: RULE_PATH,
			cases: [{ testPath: "./cases/realistic.ts" }],
		},
	],
});
