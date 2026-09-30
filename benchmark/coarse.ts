// One coarse run per rule, shared by config.ts (timing) and scaling.ts (growth
// check). arrow-return-style and no-floating-point-equality are profiled in
// detail in config.ts, so they are intentionally absent here. A rule needing
// options (to report at all) passes them through, matching the shape it would
// take in eslint config.
export const COARSE: Array<{ options?: Array<unknown>; ruleId: string; testPath: string }> = [
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
	{
		ruleId: "no-known-value-widening",
		testPath: "./cases/all/no-known-value-widening.tsx",
	},
	{ ruleId: "no-object-parameters", testPath: "./cases/all/no-object-parameters.tsx" },
	{ ruleId: "no-reflect-get", testPath: "./cases/all/no-reflect-get.tsx" },
	{ ruleId: "no-reflect-set", testPath: "./cases/all/no-reflect-set.tsx" },
	{ ruleId: "no-shape-in-symbol-names", testPath: "./cases/all/no-shape-in-symbol-names.tsx" },
	{ ruleId: "no-shared-mocks", testPath: "./cases/all/no-shared-mocks.tsx" },
	{ ruleId: "no-shared-test-state", testPath: "./cases/all/no-shared-test-state.tsx" },
	{ ruleId: "no-unknown-parameters", testPath: "./cases/all/no-unknown-parameters.tsx" },
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
	{ ruleId: "prefer-mock-throw", testPath: "./cases/all/prefer-mock-throw.tsx" },
	{
		ruleId: "prefer-parameter-destructuring",
		testPath: "./cases/all/prefer-parameter-destructuring.tsx",
	},
	{
		ruleId: "prefer-vitest-local-context",
		testPath: "./cases/all/prefer-vitest-local-context.tsx",
	},
	{ ruleId: "purity", testPath: "./cases/all/purity.tsx" },
	{ ruleId: "react-namespace", testPath: "./cases/all/react-namespace.tsx" },
];
