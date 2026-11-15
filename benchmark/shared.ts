import type { ESLint, Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";

import path from "node:path";
import ts from "typescript";

import { typedParserOptions } from "./eslint.config.mjs";

// Helpers shared by the benchmark scripts (codspeed.ts, scaling.ts,
// type-annotation.ts). No `dist` import here: type-annotation.ts runs the rule
// from source, without a build.

/** Parses a tsconfig, throwing `missingMessage` if it cannot be read. */
export function parseTsconfig(configPath: string, missingMessage: string): ts.ParsedCommandLine {
	const parsed = ts.getParsedCommandLineOfConfigFile(
		configPath,
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic(diagnostic) {
				throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
			},
		},
	);
	if (parsed === undefined) {
		throw new Error(missingMessage);
	}

	return parsed;
}

/** The parsed typed benchmark project (`cases/typed/`). */
export function parseTypedProject(): ts.ParsedCommandLine {
	return parseTsconfig(
		path.resolve(typedParserOptions.tsconfigRootDir, typedParserOptions.project),
		"Cannot read the typed benchmark project",
	);
}

/** Whether a fixture lives in the typed project and so needs a program. */
export function isTypedFixture(testPath: string): boolean {
	return testPath.startsWith("./cases/typed/");
}

/** A flat config that enables one plugin rule with its options. */
export function ruleConfig(
	plugin: ESLint.Plugin,
	ruleKey: string,
	options: Array<unknown> | undefined,
	languageOptions: Linter.Config["languageOptions"] = { parser: tsParser },
): Linter.Config {
	return {
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions,
		plugins: { flawless: plugin },
		rules: { [ruleKey]: ["error", ...(options ?? [])] },
	};
}

/** Throws on a fatal (parse) message. */
export function throwOnFatal(messages: Array<Linter.LintMessage>, label: string): void {
	const fatal = messages.find((message) => message.fatal === true);
	if (fatal !== undefined) {
		throw new Error(`${label}: ${fatal.message}`);
	}
}

/**
 * Throws on a fatal message, or when the rule's report count is wrong: exactly
 * `expected` if set, else more than zero. Returns the report count.
 */
export function checkReports(
	messages: Array<Linter.LintMessage>,
	ruleKey: string,
	expected: number | undefined,
	label: string,
): number {
	throwOnFatal(messages, label);

	const reports = messages.filter((message) => message.ruleId === ruleKey).length;
	if (expected === undefined ? reports === 0 : reports !== expected) {
		throw new Error(`${label}: expected ${expected ?? "> 0"} reports, received ${reports}`);
	}

	return reports;
}
