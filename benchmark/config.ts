import { Linter } from "eslint";
import { defineConfig } from "eslint-rule-benchmark";
import tsParser from "@typescript-eslint/parser";

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import builtPlugin from "../dist/index.mjs";

// Benchmarks the flawless rules against the BUILT plugin (dist/index.mjs).
// Building first matters: arrow-return-style locates its oxfmt worker relative
// to import.meta.url, and only the built layout resolves the worker to
// dist/rules/arrow-return-style/worker.mjs. Run `pnpm build` before this.
//
// arrow-return-style gets a detailed, multi-case profile below. Every other rule
// gets one coarse run driven by the COARSE manifest — enough to catch a gross
// regression, not to attribute cost to a code path. See ./README.md.
//
// The runner reuses one ESLint instance per test across warmup + measured
// iterations, so numbers reflect the WARM, steady-state cost (the worker's
// one-time cold start is spawned during warmup and dropped by outlier
// filtering). Detailed arrow fixtures live in ./cases and are produced by
// ./generate-cases.mjs; coarse fixtures are hand-written under ./cases/all.
//
// Each coarse rule gets a fix:false spec — a single detection pass, comparable
// across rules — and fixable rules additionally a "(coarse, fix)" spec, where
// every iteration is the full multi-pass verify-and-fix loop (re-parse +
// re-lint per pass), so fixable and non-fixable rules are no longer conflated.
// The `fix` knob comes from our patch to eslint-rule-benchmark (see
// patches/eslint-rule-benchmark.patch); upstream hardcodes fix:true.

const RULE_PATH = "../dist/index.mjs";
const RULE_ID = "arrow-return-style";
const FLOATING_RULE_ID = "no-floating-point-equality";
const EMPTY_RULE_PATH = "./empty-rule.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const FLOATING_CASES = [
	{
		expectedIssues: 0,
		name: "call-heavy, no assertions",
		testPath: "./cases/floating-call-heavy.ts",
	},
	{
		expectedIssues: 0,
		name: "recognized import, unrelated calls",
		testPath: "./cases/floating-import-unrelated.ts",
	},
	{
		expectedIssues: 400,
		name: "direct exact/inexact literals",
		testPath: "./cases/floating-literals.ts",
	},
	{
		expectedIssues: 200,
		name: "deep repeated const chains",
		testPath: "./cases/floating-const-chains.ts",
	},
	{
		expectedIssues: 80,
		name: "increasing arithmetic depth",
		testPath: "./cases/floating-arithmetic-depth.ts",
	},
	{
		expectedIssues: 100,
		name: "matching and near-miss indirect comparisons",
		testPath: "./cases/floating-indirect-long.ts",
	},
	{ expectedIssues: 300, name: "assertion-heavy", testPath: "./cases/floating-assertions.ts" },
	{ expectedIssues: 200, name: "switch-heavy", testPath: "./cases/floating-switches.ts" },
	{ expectedIssues: 180, name: "realistic mixed", testPath: "./cases/floating-realistic.ts" },
] as const;

// Fail before timing if a generated fixture stops exercising the path its
// benchmark row claims to measure.
const issueCounter = new Linter({ configType: "flat" });
for (const fixture of FLOATING_CASES) {
	const absolutePath = path.resolve(HERE, fixture.testPath);
	const messages = issueCounter.verify(
		readFileSync(absolutePath, "utf8"),
		[
			{
				files: ["**/*.ts"],
				languageOptions: { parser: tsParser },
				plugins: { flawless: builtPlugin },
				rules: { [`flawless/${FLOATING_RULE_ID}`]: "error" },
			},
		],
		{ filename: path.basename(absolutePath) },
	);
	if (messages.length !== fixture.expectedIssues) {
		throw new Error(
			`${fixture.testPath}: expected ${fixture.expectedIssues} issue(s), received ${messages.length}`,
		);
	}
}

const floatingImplementations = [
	{ label: "flawless", ruleId: FLOATING_RULE_ID, rulePath: RULE_PATH },
	{ label: "parser baseline", ruleId: `baseline/${FLOATING_RULE_ID}`, rulePath: EMPTY_RULE_PATH },
];
const sonarRulePath = process.env.SONAR_S1244_RULE_PATH;
if (sonarRulePath !== undefined) {
	floatingImplementations.push({
		label: "Sonar S1244",
		ruleId: `sonar/${FLOATING_RULE_ID}`,
		rulePath: sonarRulePath,
	});
}

const floatingTests = FLOATING_CASES.flatMap((fixture) =>
	floatingImplementations.map((implementation) => ({
		name: `${FLOATING_RULE_ID}: ${fixture.name} [${implementation.label}]`,
		ruleId: implementation.ruleId,
		rulePath: implementation.rulePath,
		fix: false,
		iterations: 30,
		timeout: 1000,
		warmup: { enabled: true, iterations: 5 },
		cases: [{ testPath: fixture.testPath }],
	})),
);

// One coarse run per rule. arrow-return-style is profiled in detail below, so it
// is intentionally absent here. A rule needing options (to report at all) passes
// them through, matching the shape it would take in eslint config.
const COARSE: Array<{ options?: Array<unknown>; ruleId: string; testPath: string }> = [
	{ ruleId: "jsx-shorthand-boolean", testPath: "./cases/all/jsx-shorthand-boolean.tsx" },
	{ ruleId: "jsx-shorthand-fragment", testPath: "./cases/all/jsx-shorthand-fragment.tsx" },
	{
		options: [{ max: 5 }],
		ruleId: "max-lines-per-function",
		testPath: "./cases/all/max-lines-per-function.tsx",
	},
	{
		options: [{ format: ["camelCase"], selector: "variable" }],
		ruleId: "naming-convention",
		testPath: "./cases/all/naming-convention.tsx",
	},
	{
		ruleId: "no-conditional-empty-object-spread",
		testPath: "./cases/all/no-conditional-empty-object-spread.tsx",
	},
	{
		ruleId: "no-conditional-in-test",
		testPath: "./cases/all/no-conditional-in-test.tsx",
	},
	{ ruleId: "no-export-default-arrow", testPath: "./cases/all/no-export-default-arrow.tsx" },
	{ ruleId: "no-shared-mocks", testPath: "./cases/all/no-shared-mocks.tsx" },
	{
		ruleId: "no-unnecessary-use-callback",
		testPath: "./cases/all/no-unnecessary-use-callback.tsx",
	},
	{ ruleId: "no-unnecessary-use-memo", testPath: "./cases/all/no-unnecessary-use-memo.tsx" },
	{
		ruleId: "no-unsafe-dictionary-type",
		testPath: "./cases/all/no-unsafe-dictionary-type.tsx",
	},
	{
		ruleId: "padding-after-expect-assertions",
		testPath: "./cases/all/padding-after-expect-assertions.tsx",
	},
	{
		ruleId: "prefer-destructuring-assignment",
		testPath: "./cases/all/prefer-destructuring-assignment.tsx",
	},
	{
		ruleId: "prefer-ending-with-an-expect",
		testPath: "./cases/all/prefer-ending-with-an-expect.tsx",
	},
	{
		ruleId: "prefer-expect-assertions-count",
		testPath: "./cases/all/prefer-expect-assertions-count.tsx",
	},
	{
		ruleId: "prefer-parameter-destructuring",
		testPath: "./cases/all/prefer-parameter-destructuring.tsx",
	},
	{ ruleId: "purity", testPath: "./cases/all/purity.tsx" },
	{ ruleId: "react-namespace", testPath: "./cases/all/react-namespace.tsx" },
];

// Rules eslint-rule-benchmark structurally cannot run, so they are exempt from
// the coverage check below. Revisit if the tool gains support.
//   - prefer-read-only-props needs type information, but the harness lints each
//     fixture by bare basename, which no tsconfig can include — so a typed
//     program is impossible and the rule silently reports nothing.
//   - toml-sort-keys / yaml-block-key-blank-lines lint non-JS languages, whose
//     extensions are absent from the tool's SUPPORTED_EXTENSIONS.
//   - no-redundant-tsconfig-options lints JSON (also unsupported) and resolves
//     the tsconfig `extends` chain from sibling files on disk — which the
//     harness's bare-basename lint can never provide.
const UNSUPPORTED = new Set([
	"no-redundant-tsconfig-options",
	"prefer-read-only-props",
	"toml-sort-keys",
	"yaml-block-key-blank-lines",
]);

// Fail the run when a new rule ships without a benchmark: every built rule must
// be profiled in detail (arrow-return-style), present in COARSE, or a documented
// UNSUPPORTED exemption. We flag and set a non-zero exit rather than throw — a
// throw aborts config loading and nukes EVERY result (arrow included) on any PR
// that adds a rule, whereas this lets the existing benchmarks still measure while
// CI (and a local `pnpm bench`) still goes red until a fixture is added.
const benched = new Set([RULE_ID, FLOATING_RULE_ID, ...COARSE.map((entry) => entry.ruleId)]);
const missing = Object.keys(builtPlugin.rules).filter(
	(ruleId) => !benched.has(ruleId) && !UNSUPPORTED.has(ruleId),
);
if (missing.length > 0) {
	console.error(
		`\n✖ No benchmark fixture for rule(s): ${missing.join(", ")}.\n` +
			`  Add each to COARSE (with a cases/all/<rule>.tsx fixture) or, if ` +
			`eslint-rule-benchmark cannot run it, to UNSUPPORTED in benchmark/config.ts.\n`,
	);
	process.exitCode = 1;
}

const coarseTests = COARSE.flatMap((entry) => {
	const cases = [
		{ testPath: entry.testPath, ...(entry.options ? { options: entry.options } : {}) },
	];
	const base = { ruleId: entry.ruleId, rulePath: RULE_PATH, cases };
	const fixable = builtPlugin.rules[entry.ruleId]?.meta?.fixable != null;
	return [
		{ ...base, fix: false, name: `${entry.ruleId} (coarse)` },
		...(fixable ? [{ ...base, fix: true, name: `${entry.ruleId} (coarse, fix)` }] : []),
	];
});

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
		...floatingTests,
		...coarseTests,
	],
});
