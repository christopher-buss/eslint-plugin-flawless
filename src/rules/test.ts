import tsParser from "@typescript-eslint/parser";

import type { RuleTesterInitOptions, TestCasesOptions } from "eslint-vitest-rule-tester";
import { run as runInternal } from "eslint-vitest-rule-tester";
import path from "node:path";
import * as tomlParser from "toml-eslint-parser";
import * as yamlParser from "yaml-eslint-parser";

export function run(options: RuleTesterInitOptions & TestCasesOptions): void {
	void runInternal({
		parser: tsParser,
		parserOptions: {
			ecmaVersion: "latest",
			project: path.resolve(__dirname, "../../fixtures/tsconfig.json"),
			sourceType: "module",
			tsconfigRootDir: path.resolve(__dirname, "../../fixtures"),
		},
		...options,
	});
}

export function runToml(options: RuleTesterInitOptions & TestCasesOptions): void {
	void runInternal({
		defaultFilenames: { js: "file.toml", jsx: "file.toml", ts: "file.toml", tsx: "file.toml" },
		languageOptions: {
			parser: tomlParser,
		},
		...options,
	});
}

export function runYaml(options: RuleTesterInitOptions & TestCasesOptions): void {
	void runInternal({
		defaultFilenames: { js: "file.yaml", jsx: "file.yaml", ts: "file.yaml", tsx: "file.yaml" },
		languageOptions: {
			parser: yamlParser,
		},
		...options,
	});
}
