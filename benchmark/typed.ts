/** Typed fixtures and the reports each must produce before timing. */
export const TYPE_ANNOTATION_CASES = [
	{
		expectedIssues: 0,
		name: "40 blocks without annotations",
		testPath: "./cases/typed/annotation-none.ts",
	},
	{
		expectedIssues: 10,
		name: "10 verified variable removals",
		testPath: "./cases/typed/annotation-removals.ts",
	},
	{
		expectedIssues: 40,
		name: "40 candidates, bounded verification",
		testPath: "./cases/typed/annotation-dense.ts",
	},
	{
		expectedIssues: 8,
		name: "8 contextual parameter removals",
		testPath: "./cases/typed/annotation-parameters.ts",
	},
	{
		expectedIssues: 16,
		name: "16 return type removals",
		options: [{ checkReturnTypes: true }],
		testPath: "./cases/typed/annotation-returns.ts",
	},
	{
		expectedIssues: 0,
		name: "8 retained loop annotations",
		testPath: "./cases/typed/annotation-retained.ts",
	},
] as const;

/** Typed fixtures for no-incompatible-assertion-types and their report counts. */
export const INCOMPATIBLE_ASSERTION_CASES = [
	{
		expectedIssues: 0,
		name: "500 non-assertion calls",
		testPath: "./cases/typed/assertion-unrelated.ts",
	},
	{
		expectedIssues: 200,
		name: "400 equality assertions, 200 reports",
		testPath: "./cases/typed/assertion-mixed.ts",
	},
] as const;
