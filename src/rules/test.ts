import tsParser from "@typescript-eslint/parser";

import type { Linter } from "eslint";
import type { RuleTesterInitOptions, TestCasesOptions } from "eslint-vitest-rule-tester";
import { run as runInternal } from "eslint-vitest-rule-tester";
import path from "node:path";

export function run(options: RuleTesterInitOptions & TestCasesOptions): void {
	void runInternal({
		parser: tsParser as Linter.Parser,
		parserOptions: {
			ecmaVersion: "latest",
			project: path.resolve(__dirname, "../../fixtures/tsconfig.json"),
			sourceType: "module",
			tsconfigRootDir: path.resolve(__dirname, "../../fixtures"),
		},
		...options,
	});
}
