import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { preferMockThrow, RULE_NAME } from "./rule";

const messageId = "preferMockThrow";

const valid: Array<ValidTestCase> = [
	"vi.fn()",
	'vi.fn().mockThrow(new Error("boom"))',
	'vi.fn().mockThrowOnce(new Error("boom"))',
	"mock.mockImplementation",
	"mock.mockImplementation()",
	// An implementation held in a variable is not inspected.
	"mock.mockImplementation(impl)",
	// `vi.fn(impl)` keeps `impl` across `mockReset()`; `mockThrow` would not.
	'vi.fn(() => { throw new Error("boom"); })',
	// A dynamic property name is not a known setter.
	'mock[name](() => { throw new Error("boom"); })',
	// An extra argument would be kept by the rewrite, so it is left alone.
	'mock.mockImplementation(() => { throw new Error("boom"); }, extra)',
	// Not a lone `throw`.
	"vi.fn().mockImplementation(() => 42)",
	"vi.fn().mockImplementation(() => {})",
	unindent`
		mock.mockImplementation(() => {
			console.log("about to throw");
			throw new Error("boom");
		});
	`,
	unindent`
		mock.mockImplementation(() => {
			throw new Error("boom");
			console.log("unreachable");
		});
	`,
	unindent`
		mock.mockImplementation(() => {
			if (condition) {
				throw new Error("boom");
			}
		});
	`,
	// An async function rejects rather than throws; a generator throws only
	// once iterated.
	'vi.fn().mockImplementation(async () => { throw new Error("boom"); })',
	'vi.fn().mockImplementationOnce(async function () { throw new Error("boom"); })',
	'vi.fn().mockImplementation(function* () { throw new Error("boom"); })',
	// The thrown value reads a parameter.
	"vi.fn().mockImplementation((message) => { throw new Error(message); })",
	"vi.fn().mockImplementation(function (message) { throw new Error(message); })",
	// A default or destructured parameter runs code before the `throw`.
	'vi.fn().mockImplementation((value = sideEffect()) => { throw new Error("boom"); })',
	'vi.fn().mockImplementation(({ value }) => { throw new Error("boom"); })',
	// `arguments`, `this`, and `new.target` differ once moved out of the
	// implementation.
	"vi.fn().mockImplementation(function () { throw arguments[0]; })",
	"vi.fn().mockImplementation(function () { throw new Error(arguments); })",
	"vi.fn().mockImplementation(function () { throw this; })",
	"vi.fn().mockImplementation(function () { throw { self: this }; })",
	"vi.fn().mockImplementation(function () { throw new.target; })",
	"vi.fn().mockImplementation(() => { throw this; })",
	unindent`
		function setup() {
			mock.mockImplementation(() => { throw arguments; });
		}
	`,
	// A mutable binding may change between setup and the call.
	unindent`
		let error = new Error("boom");
		mock.mockImplementation(() => { throw error; });
	`,
	unindent`
		var error = new Error("boom");
		mock.mockImplementation(() => { throw error; });
	`,
	unindent`
		function setup(error) {
			error = wrap(error);
			mock.mockImplementation(() => { throw error; });
		}
	`,
	unindent`
		function setup() {
			mock.mockImplementation(() => { throw new Failure(); });
		}
		function Failure() {}
		Failure = class {};
	`,
	unindent`
		mock.mockImplementation(() => { throw globalError; });
		globalError = new Error("boom");
	`,
	unindent`
		let message = "boom";
		mock.mockImplementation(() => { throw new Error(message); });
	`,
	unindent`
		let message = "boom";
		mock.mockImplementation(() => { throw new Error(\`failed: \${message}\`); });
	`,
	// Declared after the call: eagerly reading it would hit the temporal dead
	// zone, where the implementation reads it later.
	unindent`
		beforeEach(() => {
			mock.mockImplementation(() => { throw error; });
		});
		const error = new Error("boom");
	`,
	unindent`
		mock.mockImplementation(() => { throw new Failure(); });
		class Failure extends Error {}
	`,
	// A hoisted function declaration can run the call before the binding exists.
	unindent`
		const error = new Error("boom");
		function setup() {
			mock.mockImplementation(() => { throw error; });
		}
	`,
	// A `vi.mock` factory is hoisted above every outer binding.
	unindent`
		import { vi } from "vitest";
		const error = new Error("boom");
		vi.mock("./module", () => ({
			load: vi.fn().mockImplementation(() => { throw error; }),
		}));
	`,
	unindent`
		import { Failure } from "./failure";
		vi.mock("./module", () => ({
			load: vi.fn().mockImplementation(() => { throw new Failure(); }),
		}));
	`,
	unindent`
		const message = "boom";
		vi.hoisted(() => {
			mock.mockImplementation(() => { throw new Error(message); });
		});
	`,
	// A `switch` case can skip the declaration it would read.
	unindent`
		switch (kind) {
			case 1:
				const error = new Error("boom");
				break;
			case 2:
				mock.mockImplementation(() => { throw error; });
		}
	`,
	// Side effects or reads that may change between setup and the call.
	"vi.fn().mockImplementation(() => { throw makeError(); })",
	"vi.fn().mockImplementation(() => { throw state.error; })",
	"vi.fn().mockImplementation(() => { throw errors[index]; })",
	"vi.fn().mockImplementation(() => { throw count++; })",
	"vi.fn().mockImplementation(() => { throw (count = 1); })",
	"vi.fn().mockImplementation(() => { throw new errors.Failure(); })",
	"vi.fn().mockImplementation(() => { throw new Error(describe()); })",
	'vi.fn().mockImplementation(() => { throw new Error("a" + "b"); })',
	'vi.fn().mockImplementation(() => { throw { ...base, code: "E" }; })',
	"vi.fn().mockImplementation(() => { throw [...errors]; })",
	'vi.fn().mockImplementation(() => { throw { toString() { return "x"; } }; })',
	"vi.fn().mockImplementation(() => { throw () => 1; })",
	// eslint-disable-next-line no-template-curly-in-string -- test source
	"vi.fn().mockImplementation(() => { throw `${makeMessage()}`; })",
	"vi.fn().mockImplementation(() => { throw condition ? a : b; })",
	"vi.fn().mockImplementation(() => { throw -value; })",
	"vi.fn().mockImplementation(() => { throw new Error(...parts); })",
	"vi.fn().mockImplementation(() => { throw (makeError(), 1); })",
];

const invalid: Array<InvalidTestCase> = [
	{
		code: 'vi.fn().mockImplementation(() => { throw new Error("boom"); })',
		errors: [
			{
				column: 9,
				data: { method: "mockImplementation", replacement: "mockThrow" },
				line: 1,
				messageId,
			},
		],
		output: 'vi.fn().mockThrow(new Error("boom"))',
	},
	{
		code: 'vi.fn().mockImplementationOnce(() => { throw new Error("boom"); })',
		errors: [
			{ data: { method: "mockImplementationOnce", replacement: "mockThrowOnce" }, messageId },
		],
		output: 'vi.fn().mockThrowOnce(new Error("boom"))',
	},
	{
		code: 'mock.mockImplementation(function () { throw new Error("boom"); })',
		errors: [{ messageId }],
		output: 'mock.mockThrow(new Error("boom"))',
	},
	// Literals, globals, and object and array literals of stable parts.
	{
		code: 'mock.mockImplementation(() => { throw "boom"; })',
		errors: [{ messageId }],
		output: 'mock.mockThrow("boom")',
	},
	{
		code: "mock.mockImplementation(() => { throw undefined; })",
		errors: [{ messageId }],
		output: "mock.mockThrow(undefined)",
	},
	{
		code: "mock.mockImplementation(() => { throw -1; })",
		errors: [{ messageId }],
		output: "mock.mockThrow(-1)",
	},
	{
		code: 'mock.mockImplementation(() => { throw { code: 42, [`key`]: "value", nested: [1, , "x"] }; })',
		errors: [{ messageId }],
		output: 'mock.mockThrow({ code: 42, [`key`]: "value", nested: [1, , "x"] })',
	},
	{
		code: 'mock.mockImplementation(() => { throw new TypeError("nope", { cause: "inner" }); })',
		errors: [{ messageId }],
		output: 'mock.mockThrow(new TypeError("nope", { cause: "inner" }))',
	},
	// Stable bindings initialized before the call.
	{
		code: unindent`
			const error = new Error("boom");
			vi.fn().mockImplementation(() => {
				throw error;
			});
		`,
		errors: [{ column: 9, line: 2, messageId }],
		output: unindent`
			const error = new Error("boom");
			vi.fn().mockThrow(error);
		`,
	},
	{
		code: unindent`
			const message = "boom";
			beforeEach(() => {
				mock.mockImplementation(() => { throw new Error(\`failed: \${message}\`); });
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			const message = "boom";
			beforeEach(() => {
				mock.mockThrow(new Error(\`failed: \${message}\`));
			});
		`,
	},
	{
		code: unindent`
			import { Failure } from "./failure";
			mock.mockImplementation(() => { throw new Failure(); });
		`,
		errors: [{ messageId }],
		output: unindent`
			import { Failure } from "./failure";
			mock.mockThrow(new Failure());
		`,
	},
	{
		code: unindent`
			class Failure extends Error {}
			mock.mockImplementation(() => { throw new Failure(); });
		`,
		errors: [{ messageId }],
		output: unindent`
			class Failure extends Error {}
			mock.mockThrow(new Failure());
		`,
	},
	{
		code: unindent`
			function setup(error) {
				mock.mockImplementation(() => { throw error; });
			}
		`,
		errors: [{ messageId }],
		output: unindent`
			function setup(error) {
				mock.mockThrow(error);
			}
		`,
	},
	{
		code: unindent`
			try {
				run();
			} catch (error) {
				mock.mockImplementation(() => { throw error; });
			}
		`,
		errors: [{ messageId }],
		output: unindent`
			try {
				run();
			} catch (error) {
				mock.mockThrow(error);
			}
		`,
	},
	{
		code: unindent`
			vi.mock("./module", () => {
				const error = new Error("boom");
				return { load: vi.fn().mockImplementation(() => { throw error; }) };
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			vi.mock("./module", () => {
				const error = new Error("boom");
				return { load: vi.fn().mockThrow(error) };
			});
		`,
	},
	// An unread parameter is harmless.
	{
		code: 'mock.mockImplementation((_value, ..._rest) => { throw new Error("boom"); })',
		errors: [{ messageId }],
		output: 'mock.mockThrow(new Error("boom"))',
	},
	// A sequence stays one argument.
	{
		code: 'mock.mockImplementation(() => { throw "first", "second"; })',
		errors: [{ messageId }],
		output: 'mock.mockThrow(("first", "second"))',
	},
	// Type-only wrappers are looked through and kept.
	{
		code: 'mock.mockImplementation((): never => { throw new Error("boom"); })',
		errors: [{ messageId }],
		output: 'mock.mockThrow(new Error("boom"))',
	},
	{
		code: unindent`
			const error: unknown = new Error("boom");
			mock.mockImplementation(() => { throw error as Error; });
			mock.mockImplementation(() => { throw error satisfies unknown; });
			mock.mockImplementation(() => { throw error!; });
			mock.mockImplementation(() => { throw <Error>error; });
		`,
		errors: [{ messageId }, { messageId }, { messageId }, { messageId }],
		output: unindent`
			const error: unknown = new Error("boom");
			mock.mockThrow(error as Error);
			mock.mockThrow(error satisfies unknown);
			mock.mockThrow(error!);
			mock.mockThrow(<Error>error);
		`,
	},
	// Optional chaining and computed access.
	{
		code: 'mock?.mockImplementation(() => { throw new Error("boom"); })',
		errors: [{ messageId }],
		output: 'mock?.mockThrow(new Error("boom"))',
	},
	{
		code: 'mock.mockImplementation?.(() => { throw new Error("boom"); })',
		errors: [{ messageId }],
		output: 'mock.mockThrow?.(new Error("boom"))',
	},
	{
		code: "mock['mockImplementationOnce'](() => { throw new Error('boom'); })",
		errors: [{ messageId }],
		output: "mock['mockThrowOnce'](new Error('boom'))",
	},
	{
		code: "mock[`mockImplementation`](() => { throw new Error('boom'); })",
		errors: [{ messageId }],
		output: "mock[`mockThrow`](new Error('boom'))",
	},
	{
		code: unindent`
			vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
				throw new Error("boom");
			});
		`,
		errors: [{ column: 30, line: 1, messageId }],
		output: 'vi.spyOn(fs, "readFileSync").mockThrowOnce(new Error("boom"));',
	},
	{
		code: unindent`
			mock
				.mockImplementation(() => { throw new Error("one"); })
				.mockImplementation(async () => { throw new Error("two"); })
				.mockImplementationOnce(() => { throw new Error("three"); });
		`,
		errors: [
			{ column: 3, line: 2, messageId },
			{ column: 3, line: 4, messageId },
		],
		output: unindent`
			mock
				.mockThrow(new Error("one"))
				.mockImplementation(async () => { throw new Error("two"); })
				.mockThrowOnce(new Error("three"));
		`,
	},
	// Comments in the implementation move into the argument.
	{
		code: 'mock.mockImplementation(() => { /* offline */ throw new Error("boom"); /* done */ })',
		errors: [{ messageId }],
		output: 'mock.mockThrow(/* offline */ /* done */ new Error("boom"))',
	},
	{
		code: 'mock.mockImplementation(() => { throw new Error(/* why */ "boom"); })',
		errors: [{ messageId }],
		output: 'mock.mockThrow(new Error(/* why */ "boom"))',
	},
	{
		code: unindent`
			it("fails", () => {
				mock.mockImplementation(() => {
					// Simulate a network failure.
					throw new Error("offline"); // Always.
				});
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			it("fails", () => {
				mock.mockThrow(
					// Simulate a network failure.
					// Always.
					new Error("offline")
				);
			});
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferMockThrow,
	valid,
});
