import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { paddingAfterExpectAssertions, RULE_NAME } from "./rule";

const messageId = "missingPadding";

const valid: Array<ValidTestCase> = [
	// The wanted form: one blank line separates the count from the expectations.
	unindent`
		it("divides", () => {
			expect.assertions(1);

			expect(divide(10, 2)).toBe(5);
		});
	`,
	// Extra blank lines are left alone (the rule only requires at least one).
	unindent`
		it("divides", () => {
			expect.assertions(1);


			expect(divide(10, 2)).toBe(5);
		});
	`,
	// hasAssertions is covered too.
	unindent`
		it("divides", () => {
			expect.hasAssertions();

			expect(divide(10, 2)).toBe(5);
		});
	`,
	// Nothing follows the assertion, so there is nothing to pad.
	unindent`
		it("divides", () => {
			expect.assertions(1);
		});
	`,
	// Adjacent expectations are padding-around-expect-groups' concern, not
	// this rule's; they stay untouched.
	unindent`
		it("divides", () => {
			expect.assertions(2);

			expect(divide(10, 2)).toBe(5);
			expect(divide(9, 3)).toBe(3);
		});
	`,
	// A member read rather than a call is not an assertion count.
	unindent`
		it("divides", () => {
			const count = expect.assertions;
			use(count);
		});
	`,
	// Computed access is not matched.
	unindent`
		it("divides", () => {
			expect["assertions"](1);
			expect(divide(10, 2)).toBe(5);
		});
	`,
];

const invalid: Array<InvalidTestCase> = [
	// The motivating case: a blank line is inserted after the count.
	{
		code: unindent`
			it("divides", () => {
				expect.assertions(1);
				expect(divide(10, 2)).toBe(5);
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			it("divides", () => {
				expect.assertions(1);

				expect(divide(10, 2)).toBe(5);
			});
		`,
	},
	// hasAssertions is padded the same way.
	{
		code: unindent`
			it("divides", () => {
				expect.hasAssertions();
				expect(divide(10, 2)).toBe(5);
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			it("divides", () => {
				expect.hasAssertions();

				expect(divide(10, 2)).toBe(5);
			});
		`,
	},
	// Padding is required regardless of what follows, not just expectations.
	{
		code: unindent`
			it("divides", () => {
				expect.assertions(1);
				const result = divide(10, 2);
				expect(result).toBe(5);
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			it("divides", () => {
				expect.assertions(1);

				const result = divide(10, 2);
				expect(result).toBe(5);
			});
		`,
	},
	// A trailing same-line comment keeps its place; the blank line lands after
	// it.
	{
		code: unindent`
			it("divides", () => {
				expect.assertions(1); // exactly one
				expect(divide(10, 2)).toBe(5);
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			it("divides", () => {
				expect.assertions(1); // exactly one

				expect(divide(10, 2)).toBe(5);
			});
		`,
	},
	// A comment on its own line in the gap gets the blank line before it.
	{
		code: unindent`
			it("divides", () => {
				expect.assertions(1);
				// then the expectation
				expect(divide(10, 2)).toBe(5);
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			it("divides", () => {
				expect.assertions(1);

				// then the expectation
				expect(divide(10, 2)).toBe(5);
			});
		`,
	},
	// An awaited expectation is still just the following statement.
	{
		code: unindent`
			it("resolves", async () => {
				expect.assertions(1);
				await expect(promise).resolves.toBe(5);
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			it("resolves", async () => {
				expect.assertions(1);

				await expect(promise).resolves.toBe(5);
			});
		`,
	},
	// Realistic shape: the assertion still gets padded inside a nested describe.
	{
		code: unindent`
			describe("math", () => {
				it("divides", () => {
					expect.assertions(1);
					expect(divide(10, 2)).toBe(5);
				});
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			describe("math", () => {
				it("divides", () => {
					expect.assertions(1);

					expect(divide(10, 2)).toBe(5);
				});
			});
		`,
	},
	// Both statements on one line: the same-line branch adds a full blank line.
	{
		code: "expect.assertions(1);expect(divide(10, 2)).toBe(5);",
		errors: [{ messageId }],
		output: unindent`
			expect.assertions(1);

			expect(divide(10, 2)).toBe(5);
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: paddingAfterExpectAssertions,
	valid,
});
