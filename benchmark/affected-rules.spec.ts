import { affectedRules, ALL } from "./affected-rules.mjs";

describe(affectedRules, () => {
	it("maps rule sources to their rule", () => {
		expect.assertions(1);

		expect(
			affectedRules([
				"src/rules/purity/rule.ts",
				"src/rules/arrow-return-style/worker.ts",
				"src/rules/purity/rule.ts",
			]),
		).toStrictEqual(["arrow-return-style", "purity"]);
	});

	it("maps benchmark fixtures to their rule", () => {
		expect.assertions(1);

		expect(
			affectedRules([
				"benchmark/cases/all/no-reflect-get.tsx",
				"benchmark/cases/floating-literals.ts",
				"benchmark/cases/realistic.ts",
			]),
		).toStrictEqual(["arrow-return-style", "no-floating-point-equality", "no-reflect-get"]);
	});

	it("ignores tests, docs, and files outside the benchmark's reach", () => {
		expect.assertions(1);

		expect(
			affectedRules([
				"src/rules/purity/rule.spec.ts",
				"src/rules/purity/documentation.md",
				"src/rules/test.ts",
				"src/oxlint.ts",
				"benchmark/README.md",
				"README.md",
				".github/workflows/ci.yaml",
			]),
		).toStrictEqual([]);
	});

	it.each([
		"src/rules/shared/reflect-method.ts",
		"src/utils/resolve.ts",
		"src/plugin.ts",
		"benchmark/config.ts",
		"benchmark/generate-cases.mjs",
		"patches/eslint-rule-benchmark.patch",
		".github/workflows/benchmark.yaml",
		"pnpm-lock.yaml",
	])("runs everything when %s changes", (file) => {
		expect.assertions(1);

		expect(affectedRules(["src/rules/purity/rule.ts", file])).toBe(ALL);
	});
});
