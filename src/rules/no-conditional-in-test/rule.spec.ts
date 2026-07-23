import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noConditionalInTest, RULE_NAME } from "./rule";

const messageId = "conditionalInTest";

const valid: Array<ValidTestCase> = [
	// Conditional outside any test.
	unindent`
		if (process.env.CI) {
			doThing();
		}
	`,
	// Conditional in a describe block (not a test body).
	unindent`
		describe("suite", () => {
			if (setupFlag) {
				configure();
			}
		});
	`,
	// Conditional in a lifecycle hook.
	unindent`
		describe("suite", () => {
			beforeEach(() => {
				if (needsReset) {
					reset();
				}
			});
		});
	`,
	// Conditional in a helper defined outside the test.
	unindent`
		function pick(flag) {
			return flag ? "a" : "b";
		}
		it("works", () => {
			expect(pick(true)).toBe("a");
		});
	`,
	// Optional chaining is allowed by default.
	unindent`
		it("works", () => {
			expect(user?.name).toBe("ada");
		});
	`,
	// Optional chaining allowed explicitly.
	{
		code: unindent`
			it("works", () => {
				expect(user?.name).toBe("ada");
			});
		`,
		options: [{ allowOptionalChaining: true }],
	},
	// A locally-defined `it` is not a vitest test block.
	unindent`
		const it = (_name, fn) => fn();
		it("noop", () => {
			if (flag) {
				doThing();
			}
		});
	`,
	// Logical expression outside a test.
	"const value = fallback || defaultValue;",
];

const invalid: Array<InvalidTestCase> = [
	// If statement in a test.
	{
		code: unindent`
			it("works", () => {
				if (flag) {
					doThing();
				}
			});
		`,
		errors: [{ messageId }],
	},
	// Switch statement in a test.
	{
		code: unindent`
			test("works", () => {
				switch (value) {
					case 1:
						doThing();
						break;
				}
			});
		`,
		errors: [{ messageId }],
	},
	// Ternary in a test modifier (`it.skip`).
	{
		code: unindent`
			it.skip("works", () => {
				expect(flag ? "a" : "b").toBe("a");
			});
		`,
		errors: [{ messageId }],
	},
	// Logical `&&` in a test.
	{
		code: unindent`
			it("works", () => {
				expect(a && b).toBe(true);
			});
		`,
		errors: [{ messageId }],
	},
	// Nullish coalescing in a test.
	{
		code: unindent`
			test("works", () => {
				expect(a ?? b).toBe(1);
			});
		`,
		errors: [{ messageId }],
	},
	// Conditional in a function defined inside the test body.
	{
		code: unindent`
			it("works", () => {
				function pick(flag) {
					if (flag) {
						return "a";
					}
					return "b";
				}
				expect(pick(true)).toBe("a");
			});
		`,
		errors: [{ messageId }],
	},
	// Custom test block via additionalTestBlockFunctions.
	{
		code: unindent`
			myTest("works", () => {
				if (flag) {
					doThing();
				}
			});
		`,
		errors: [{ messageId }],
		options: [{ additionalTestBlockFunctions: ["myTest"] }],
	},
	// Optional chaining reported and fixed when disallowed (member).
	{
		code: unindent`
			it("works", () => {
				expect(user?.name).toBe("ada");
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(user!.name).toBe("ada");
			});
		`,
	},
	// Computed optional member.
	{
		code: unindent`
			it("works", () => {
				expect(items?.[0]).toBe(1);
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(items![0]).toBe(1);
			});
		`,
	},
	// Optional call.
	{
		code: unindent`
			it("works", () => {
				expect(getValue?.()).toBe(1);
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(getValue!()).toBe(1);
			});
		`,
	},
	// Multi-link chain converts every optional link.
	{
		code: unindent`
			it("works", () => {
				expect(a?.b?.c).toBe(1);
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(a!.b!.c).toBe(1);
			});
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noConditionalInTest,
	valid,
});
