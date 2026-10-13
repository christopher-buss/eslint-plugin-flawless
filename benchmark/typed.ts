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
		expectedIssues: 10,
		name: "40 candidates, bounded verification",
		testPath: "./cases/typed/annotation-dense.ts",
	},
	{
		expectedIssues: 8,
		name: "8 contextual parameter removals",
		testPath: "./cases/typed/annotation-parameters.ts",
	},
	{
		expectedIssues: 0,
		name: "8 retained loop annotations",
		testPath: "./cases/typed/annotation-retained.ts",
	},
] as const;
