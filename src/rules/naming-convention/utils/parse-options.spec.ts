import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import { describe, expect, it, vi } from "vitest";

import { parseOptions } from "./parse-options.ts";
import type { Context, NamingSelector } from "./types.ts";

const STRICT_CAMEL_CASE: NamingSelector = { format: ["strictCamelCase"], selector: "variable" };
const UPPER_CASE_FOO: NamingSelector = {
	filter: "^FOO",
	format: ["UPPER_CASE"],
	selector: "variable",
};

/**
 * Validates one variable name with freshly parsed options, as a new file would.
 *
 * @param name - The variable name to validate.
 * @param options - The rule options of the file.
 * @param settings - The shared settings of the file.
 * @returns The number of reports.
 */
function countReports(
	name: string,
	options: ReadonlyArray<NamingSelector>,
	settings: Record<string, unknown> = {},
): number {
	const report = vi.fn<Context["report"]>();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the validator reads only `report` and `settings` for these options
	const context = { options, report, settings } as unknown as Context;
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the validator reads only `type` and `name` of the node
	const node = { name, type: AST_NODE_TYPES.Identifier } as TSESTree.Identifier;

	parseOptions(context, [...options]).variable(node);

	return report.mock.calls.length;
}

describe("parseOptions across files", () => {
	it("reuses nothing between option lists that share their first option", () => {
		expect.assertions(3);

		expect(countReports("FOO_BAR", [STRICT_CAMEL_CASE])).toBe(1);
		expect(countReports("FOO_BAR", [STRICT_CAMEL_CASE, UPPER_CASE_FOO])).toBe(0);
		expect(countReports("FOO_BAR", [STRICT_CAMEL_CASE])).toBe(1);
	});

	it("reuses nothing between files with different shared allowed words", () => {
		expect.assertions(3);

		const withWord = { flawless: { namingConvention: { allowedWords: ["CFrame"] } } };

		expect(countReports("targetCFrame", [STRICT_CAMEL_CASE], withWord)).toBe(0);
		expect(countReports("targetCFrame", [STRICT_CAMEL_CASE])).toBe(1);
		expect(countReports("targetCFrame", [STRICT_CAMEL_CASE], withWord)).toBe(0);
	});
});
