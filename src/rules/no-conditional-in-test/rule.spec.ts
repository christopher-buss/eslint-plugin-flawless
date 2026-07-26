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
	// `&&` in an assertion is a compound condition, not a branch: it always runs
	// and always decides the assertion's outcome.
	unindent`
		it("works", () => {
			expect(a && b).toBe(true);
		});
	`,
	// The narrowing idiom this exemption exists for.
	unindent`
		import assert from "node:assert";
		it("works", () => {
			assert(typeof submitBody === "object" && "timeout" in submitBody);
		});
	`,
	// `assert` imported from vitest.
	unindent`
		import { assert } from "vitest";
		it("works", () => {
			assert(a && b);
		});
	`,
	// A dotted assertion callee.
	unindent`
		it("works", () => {
			assert.ok(a && b);
		});
	`,
	// A chain of `&&` — every link is exempt.
	unindent`
		it("works", () => {
			assert(a && b && c);
		});
	`,
	// Matcher arguments count as assertion arguments too.
	unindent`
		it("works", () => {
			expect(value).toBe(a && b);
		});
	`,
	// An aliased vitest `expect` resolves to `expect`.
	unindent`
		import { expect as check } from "vitest";
		it("works", () => {
			check(a && b).toBe(true);
		});
	`,
	// A non-first argument still counts.
	unindent`
		it("works", () => {
			assert(value, a && b);
		});
	`,
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
	// Logical `&&` outside an assertion — the exemption is scoped to assertions.
	{
		code: unindent`
			it("works", () => {
				const value = a && b;
				expect(value).toBe(true);
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
	// `||` picks between values, so it hides which operand was asserted — still
	// reported inside an assertion.
	{
		code: unindent`
			it("works", () => {
				expect(a || b).toBe(true);
			});
		`,
		errors: [{ messageId }],
	},
	// `??` inside an assertion.
	{
		code: unindent`
			it("works", () => {
				assert(a ?? b);
			});
		`,
		errors: [{ messageId }],
	},
	// Only the `||` is reported; the enclosing `&&` is exempt.
	{
		code: unindent`
			it("works", () => {
				assert((a || b) && c);
			});
		`,
		errors: [{ messageId }],
	},
	// The exemption does not cross a function boundary: this `&&` is evaluated by
	// the callback, not by the assertion.
	{
		code: unindent`
			it("works", () => {
				expect(() => doThing(a && b)).toThrow();
			});
		`,
		errors: [{ messageId }],
	},
	// A call that is not rooted at an assertion name is not an assertion.
	{
		code: unindent`
			it("works", () => {
				doThing(a && b);
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
	// A wrapped chain keeps `!` on the object's line — TypeScript forbids a line
	// break before `!`, so `a\n?.b` may not become `a\n!.b`.
	{
		code: unindent`
			it("works", () => {
				expect(
					descend(parsed.tree, "ServerStorage", "TestService")
						?.$properties,
				).toBeUndefined();
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(
					descend(parsed.tree, "ServerStorage", "TestService")!
						.$properties,
				).toBeUndefined();
			});
		`,
	},
	// Wrapped computed member. Replacing in place would yield `items\n![0]`,
	// which ASI silently reinterprets as `items; ![0];`.
	{
		code: unindent`
			it("works", () => {
				expect(items
					?.[0]).toBe(1);
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(items!
					[0]).toBe(1);
			});
		`,
	},
	// Wrapped optional call.
	{
		code: unindent`
			it("works", () => {
				expect(getValue
					?.()).toBe(1);
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(getValue!
					()).toBe(1);
			});
		`,
	},
	// The `!` anchors to the token before `?.`, so a parenthesized object keeps
	// the assertion outside its closing paren.
	{
		code: unindent`
			it("works", () => {
				expect((user)?.name).toBe("ada");
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect((user)!.name).toBe("ada");
			});
		`,
	},
	// Multi-link chain where only the outer link wraps.
	{
		code: unindent`
			it("works", () => {
				expect(a?.b
					?.c).toBe(1);
			});
		`,
		errors: [{ messageId }],
		options: [{ allowOptionalChaining: false }],
		output: unindent`
			it("works", () => {
				expect(a!.b!
					.c).toBe(1);
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
