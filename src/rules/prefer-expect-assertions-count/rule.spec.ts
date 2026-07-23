import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { preferExpectAssertionsCount, RULE_NAME } from "./rule";

const messageId = "preferCount";

const valid: Array<ValidTestCase> = [
	// The counted form is exactly what the rule prefers.
	unindent`
		it("works", () => {
			expect.assertions(2);
			expect(value).toBe(1);
			expect(other).toBe(2);
		});
	`,
	// A bare expectation is untouched.
	'it("works", () => expect(value).toBe(1));',
	// Computed access is out of scope for the syntactic match.
	'it("works", () => { expect["hasAssertions"](); });',
	// A different member call is untouched.
	'it("works", () => { expect.anything(); });',
];

const invalid: Array<InvalidTestCase> = [
	// Inside an `it` body.
	{
		code: unindent`
			it("works", () => {
				expect.hasAssertions();
				expect(value).toBe(1);
			});
		`,
		errors: [{ messageId }],
	},
	// Inside a `test` body.
	{
		code: unindent`
			test("works", () => {
				expect.hasAssertions();
				await doThing();
			});
		`,
		errors: [{ messageId }],
	},
	// Inside a lifecycle hook.
	{
		code: unindent`
			beforeEach(() => {
				expect.hasAssertions();
			});
		`,
		errors: [{ messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferExpectAssertionsCount,
	valid,
});
