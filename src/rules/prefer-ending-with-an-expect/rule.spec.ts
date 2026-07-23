import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { preferEndingWithAnExpect, RULE_NAME } from "./rule";

const messageId = "mustEndWithExpect";

const valid: Array<ValidTestCase> = [
	// Ends with a bare expect (globals).
	unindent`
		it("works", () => {
			doThing();
			expect(value).toBe(1);
		});
	`,
	// Ends with a chained matcher.
	unindent`
		test("works", () => {
			expect(value).toEqual({ a: 1 });
		});
	`,
	// Ends with an awaited expect.
	unindent`
		it("resolves", async () => {
			await expect(promise).resolves.toBe(1);
		});
	`,
	// Concise arrow body.
	'it("works", () => expect(value).toBe(1));',
	// Resolved through a vitest import.
	unindent`
		import { expect, it } from "vitest";
		it("works", () => {
			expect(value).toBe(1);
		});
	`,
	// Aliased vitest import still resolves.
	unindent`
		import { it as renamedIt, expect } from "vitest";
		renamedIt("works", () => {
			expect(value).toBe(1);
		});
	`,
	// A locally-defined `it` is not a vitest test block.
	unindent`
		const it = (_name, fn) => fn();
		it("noop", () => {
			doThing();
		});
	`,
	// Not a test block at all.
	unindent`
		doSomething("label", () => {
			sideEffect();
		});
	`,
	// Custom assertion via assertFunctionNames.
	{
		code: unindent`
			it("type checks", () => {
				expectTypeOf(value).toBeString();
			});
		`,
		options: [{ assertFunctionNames: ["expect", "expectTypeOf"] }],
	},
	// Wildcard assertFunctionNames pattern.
	{
		code: unindent`
			it("saga", () => {
				request(app).get("/").expect(200);
			});
		`,
		options: [{ assertFunctionNames: ["request.**.expect"] }],
	},
];

const invalid: Array<InvalidTestCase> = [
	// Last statement is not an assertion.
	{
		code: unindent`
			it("updates selection", () => {
				container.setProp("selected", 2);
			});
		`,
		errors: [{ messageId }],
	},
	// `test` alias of the same behavior.
	{
		code: unindent`
			test("does work", () => {
				doThing();
			});
		`,
		errors: [{ messageId }],
	},
	// Nested inside describe.
	{
		code: unindent`
			describe("suite", () => {
				it("does work", () => {
					doThing();
				});
			});
		`,
		errors: [{ messageId }],
	},
	// Empty test body has no ending assertion.
	{
		code: 'it("todo", () => {});',
		errors: [{ messageId }],
	},
	// An expect that is not the last statement does not satisfy the rule.
	{
		code: unindent`
			it("does work", () => {
				expect(value).toBe(1);
				cleanup();
			});
		`,
		errors: [{ messageId }],
	},
	// Custom test block via additionalTestBlockFunctions.
	{
		code: unindent`
			myTest("does work", () => {
				doThing();
			});
		`,
		errors: [{ messageId }],
		options: [{ additionalTestBlockFunctions: ["myTest"] }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferEndingWithAnExpect,
	valid,
});
