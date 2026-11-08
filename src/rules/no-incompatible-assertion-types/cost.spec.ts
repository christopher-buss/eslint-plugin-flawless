import parser from "@typescript-eslint/parser";
import type { ParserServicesWithTypeInformation, TSESLint } from "@typescript-eslint/utils";

import { Linter } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { noIncompatibleAssertionTypes } from "./rule";

const directory = path.resolve(__dirname, "../../../fixtures");

interface Counts {
	scopes: number;
	types: number;
}

/**
 * Lints `code` with the rule and counts its scope lookups and type queries.
 *
 * @param code - The source to lint.
 * @returns The counts and the number of reports.
 */
function lint(code: string): Counts & { reports: number } {
	const counts: Counts = { scopes: 0, types: 0 };
	const counted: TSESLint.RuleModule<string> = {
		...noIncompatibleAssertionTypes,
		create(context) {
			const { sourceCode } = context;
			const services = sourceCode.parserServices as ParserServicesWithTypeInformation;
			const wrappedServices: ParserServicesWithTypeInformation = {
				...services,
				getTypeAtLocation(node) {
					counts.types += 1;
					return services.getTypeAtLocation(node);
				},
			};
			// Inherit from the originals and override only the counted members.
			const wrappedSource = Object.create(sourceCode, {
				getScope: {
					value(node: never) {
						counts.scopes += 1;
						return sourceCode.getScope(node);
					},
				},
				parserServices: { value: wrappedServices },
			}) as typeof sourceCode;
			const wrapped = Object.create(context, {
				sourceCode: { value: wrappedSource },
			}) as typeof context;
			return noIncompatibleAssertionTypes.create(wrapped);
		},
	};

	const messages = new Linter({ configType: "flat" }).verify(
		code,
		{
			files: ["**/*.ts"],
			languageOptions: {
				parser,
				parserOptions: {
					project: path.join(directory, "tsconfig.json"),
					tsconfigRootDir: directory,
				},
			},
			plugins: { flawless: { rules: { counted } } as never },
			rules: { "flawless/counted": "error" },
		},
		path.join(directory, "file.ts"),
	);
	expect(messages.filter((message) => message.ruleId === null)).toStrictEqual([]);
	return { ...counts, reports: messages.length };
}

const PRELUDE = `
import { expect } from "vitest";
import assert, { strictEqual } from "node:assert";
declare const count: number;
declare const api: { read(value: number): number; get(): number };
declare function service(value: number): number;
`;

describe("no-incompatible-assertion-types cost", () => {
	it("does no scope lookup or type query for calls that are not assertions", () => {
		expect.assertions(7);

		const result = lint(`${PRELUDE}
			service(api.read(count));
			expect(count).toBeTruthy();
			expect(count).toBeCloseTo(1);
			expect(count).resolves.toBe("1");
			assert.ok(count);
			assert.equal(count, "1");
			const local = { get: () => 1 };
			local.get = () => 2;
			[count].map((item) => service(item));
			function helper() {}
			helper();
		`);

		expect(result.scopes).toBe(0);
		expect(result.types).toBe(0);
		expect(result.reports).toBe(0);

		// The counters work: one assertion pays for its lookups.
		const control = lint(`${PRELUDE}
			expect(count).toBe("1");
			strictEqual(count, "1");
		`);

		expect(control.scopes).toBeGreaterThan(0);
		expect(control.types).toBeGreaterThan(0);
	});
});
