import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noUnknownParameters, RULE_NAME } from "./rule";

const causeMessageId = "causeNotRecorded";
const messageId = "unknownParameter";

function unknownParameter(parameter: string): {
	data: { parameter: string };
	messageId: typeof messageId;
} {
	return { data: { parameter }, messageId };
}

const valid: Array<ValidTestCase> = [
	// A cause handed on to a construction's options object is recorded.
	"function wrap(message: string, cause: unknown): Error { return new Error(message, { cause }); }",
	"function wrap(message: string, cause: unknown): Error { return new WrapError(message, { cause: cause }); }",
	"function wrap(message: string, cause: unknown): Error { return new Error(message, { 'cause': cause }); }",
	"function wrap(message: string, cause: unknown = undefined): Error { return new Error(message, { cause }); }",
	"function wrap(cause: Error | unknown): Error { return new Error('m', { cause }); }",
	"const wrap = (cause: unknown): Error => new Error('m', { cause });",
	"function toError(cause: unknown): Error { return cause instanceof Error ? cause : new Error(String(cause), { cause }); }",
	// Type-only wrappers leave the runtime value as is.
	"function wrap(cause: unknown): Error { return new Error('m', { cause } as ErrorOptions); }",
	"function wrap(cause: unknown): Error { return new Error('m', { cause } satisfies ErrorOptions); }",
	"function wrap(cause: unknown): Error { return new Error('m', { cause: cause as Error }); }",
	"function wrap(cause: unknown): Error { return new Error('m', { cause: cause! }); }",
	"function attach(error: Error, cause: unknown): void { error.cause = cause as Error; }",
	// A read in a nested closure still records the caller's value.
	"function wrap(cause: unknown): () => Error { return () => new Error('m', { cause }); }",
	// A plain assignment to `.cause` records it.
	"function attach(error: Error, cause: unknown): void { error.cause = cause; }",
	// `super(…, { cause })` and a parameter property record it too.
	"class WrapError extends Error { constructor(message: string, cause: unknown) { super(message, { cause }); } }",
	"class WrapError extends Error { constructor(message: string, public override readonly cause: unknown) { super(message); } }",
	// A type-predicate subject is where narrowing happens.
	"function isString(value: unknown): value is string { return true; }",
	"const isString = (value: unknown): value is string => true;",
	"function assertString(value: unknown): asserts value is string {}",
	"type Guard = (value: unknown) => value is string;",
	"declare function isString(value: unknown): value is string;",
	"type Guards = { isString(value: unknown): value is string };",
	// `this is T` narrows the `this` parameter.
	"interface Node { isText(this: unknown): this is Text }",
	"class Node { isText(this: unknown): this is Text { return true; } }",
	"class Node { assertText(this: unknown): asserts this is Text {} }",
	// Overloads defer to an implementation that records the cause.
	unindent`
		function wrap(message: string): Error;
		function wrap(message: string, cause: unknown): Error;
		function wrap(message: string, cause?: unknown): Error {
			return new Error(message, { cause });
		}
	`,
	unindent`
		function wrap(cause: unknown): Error;
		function wrap(cause: Error): Error;
		function wrap(cause: unknown): Error {
			return new Error("m", { cause });
		}
	`,
	unindent`
		export function wrap(cause: unknown): Error;
		export function wrap(cause: unknown): Error {
			return new Error("m", { cause });
		}
	`,
	unindent`
		class Wrapper {
			wrap(cause: unknown): Error;
			wrap(cause: unknown): Error {
				return new Error("m", { cause });
			}
		}
	`,
	unindent`
		class Wrapper {
			#wrap(cause: unknown): Error;
			#wrap(cause: unknown): Error {
				return new Error("m", { cause });
			}
		}
	`,
	unindent`
		class WrapError extends Error {
			constructor(cause: unknown);
			constructor(cause: unknown) {
				super("m", { cause });
			}
		}
	`,
	unindent`
		class Wrappers {
			static {
				function wrap(cause: unknown): Error;
				function wrap(cause: unknown): Error {
					return new Error("m", { cause });
				}
			}
		}
	`,
	unindent`
		switch (mode) {
			case "wrap":
				function wrap(cause: unknown): Error;
				function wrap(cause: unknown): Error {
					return new Error("m", { cause });
				}
		}
	`,
	// Types without `unknown` are out of scope.
	"function parse(value: string | number): void {}",
	"function parse(values: Array<unknown>): void {}",
	"function parse(value): void {}",
];

const invalid: Array<InvalidTestCase> = [
	// The name `cause` alone exempts nothing.
	{
		code: "function enrich(cause: unknown): void {}",
		errors: [{ column: 24, endColumn: 31, endLine: 1, line: 1, messageId: causeMessageId }],
	},
	{
		code: "function enrich(cause: Error | unknown): void {}",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function logError(cause: unknown) { console.log(cause); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function logError(cause: unknown): void { console.log(cause); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function describe(cause: unknown): string { return String(cause); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function isFatal(cause: unknown): boolean { return cause instanceof FatalError; }",
		errors: [{ messageId: causeMessageId }],
	},
	// A converted value is not the cause.
	{
		code: "function wrap(cause: unknown): Error { return new Error(String(cause), { cause: String(cause) }); }",
		errors: [{ messageId: causeMessageId }],
	},
	// A shadowing `cause` is a different variable.
	{
		code: "function wrap(cause: unknown): Error { { const cause = 1; return new Error('m', { cause }); } }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "const wrap = (cause: unknown) => [1].map((cause) => new Error('m', { cause }));",
		errors: [{ messageId: causeMessageId }],
	},
	// `{ cause }` outside a construction's options object records nothing.
	{
		code: "function wrap(cause: unknown) { return { cause }; }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown) { return make('m', { cause }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown) { return new Error('m', { details: { cause } }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown) { return new Error('m', { reason: cause }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown) { ({ cause } = { cause: 1 }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown) { return new Error('m', { [cause]: 1 }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown) { return new Error(cause, {}); }",
		errors: [{ messageId: causeMessageId }],
	},
	// A reassigned cause no longer holds the caller's value.
	{
		code: "function wrap(cause: unknown): Error { cause = String(cause); return new Error('m', { cause }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown): Error { cause += ''; return new Error('m', { cause }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown = undefined): Error { const reset = () => { cause = undefined; }; reset(); return new Error('m', { cause }); }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function wrap(cause: unknown): Error { var cause: unknown = String(cause); return new Error('m', { cause }); }",
		errors: [{ messageId: causeMessageId }],
	},
	// A wrapper does not turn a plain call into a construction.
	{
		code: "function wrap(cause: unknown) { return make('m', { cause } as ErrorOptions); }",
		errors: [{ messageId: causeMessageId }],
	},
	// Only a plain `=` to `.cause` records the value.
	{
		code: "function attach(error: Error, cause: unknown): void { error.reason = cause; }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function attach(error: Error, cause: unknown): void { error.cause ??= cause; }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "function attach(error: Error, cause: unknown): void { error.cause = String(cause); }",
		errors: [{ messageId: causeMessageId }],
	},
	// A signature without a body has nowhere to record a cause.
	{
		code: "declare function wrap(cause: unknown): Error;",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "type Wrap = (cause: unknown) => Error;",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "interface Wrapper { wrap(cause: unknown): Error }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "abstract class Wrapper { abstract wrap(cause: unknown): Error; }",
		errors: [{ messageId: causeMessageId }],
	},
	{
		code: "declare class Wrapper { wrap(cause: unknown): Error; }",
		errors: [{ messageId: causeMessageId }],
	},
	// An overload defers to an implementation that does not record the cause.
	{
		code: unindent`
			function wrap(cause: unknown): Error;
			function wrap(cause: unknown): Error {
				return new Error(String(cause));
			}
		`,
		errors: [
			{ line: 1, messageId: causeMessageId },
			{ line: 2, messageId: causeMessageId },
		],
	},
	// The implementation receives the value at the same position.
	{
		code: unindent`
			function wrap(cause: unknown): Error;
			function wrap(message: string, cause?: Error): Error {
				return new Error(message, { cause });
			}
		`,
		errors: [{ line: 1, messageId: causeMessageId }],
	},
	// An implementation in another scope is not the overload's.
	{
		code: unindent`
			function wrap(cause: unknown): Error;
			function outer(): void {
				function wrap(cause: Error): Error {
					return new Error("m", { cause });
				}
			}
		`,
		errors: [{ line: 1, messageId: causeMessageId }],
	},
	{
		code: unindent`
			class Wrapper {
				wrap(cause: unknown): Error;
				wrap(cause: unknown): Error {
					return new Error(String(cause));
				}
			}
		`,
		errors: [
			{ line: 2, messageId: causeMessageId },
			{ line: 3, messageId: causeMessageId },
		],
	},
	{
		code: unindent`
			class Wrapper {
				wrap(cause: unknown): Error;
				static wrap(cause: unknown): Error {
					return new Error("m", { cause });
				}
			}
		`,
		errors: [{ line: 2, messageId: causeMessageId }],
	},
	// `#wrap` is a different method from `wrap`.
	{
		code: unindent`
			class Wrapper {
				wrap(cause: unknown): Error;
				#wrap(cause: unknown): Error {
					return new Error("m", { cause });
				}
			}
		`,
		errors: [{ line: 2, messageId: causeMessageId }],
	},
	{
		code: unindent`
			class Wrapper {
				#wrap(cause: unknown): Error;
				wrap(cause: unknown): Error {
					return new Error("m", { cause });
				}
			}
		`,
		errors: [{ line: 2, messageId: causeMessageId }],
	},
	// A destructured or rest `cause` is not a plain cause parameter.
	{
		code: "function wrap({ cause }: unknown): Error { return new Error('m', { cause }); }",
		errors: [unknownParameter("{ cause }")],
	},
	{
		code: "function wrap(...cause: unknown): Error { return new Error('m', { cause }); }",
		errors: [unknownParameter("cause")],
	},
	// Everything else leaves input unparsed.
	{
		code: "function parse(value: unknown): void {}",
		errors: [{ ...unknownParameter("value"), column: 23, endColumn: 30, endLine: 1, line: 1 }],
	},
	{
		code: "function parse(value: string | unknown): void {}",
		errors: [unknownParameter("value")],
	},
	{
		code: "function parse(value: string | (number | unknown)): void {}",
		errors: [unknownParameter("value")],
	},
	// Only the predicate subject is exempt.
	{
		code: "function isString(value: unknown, context: unknown): value is string { return true; }",
		errors: [unknownParameter("context")],
	},
	{
		code: "class Node { isText(this: unknown, other: unknown): this is Text { return true; } }",
		errors: [unknownParameter("other")],
	},
	{
		code: "function isString(this: unknown, value: unknown): value is string { return true; }",
		errors: [unknownParameter("this")],
	},
	{
		code: "export function parse({ value }: unknown = {}): void {}",
		errors: [unknownParameter("{ value }")],
	},
	{
		code: "const parse = (value: unknown): void => {};",
		errors: [unknownParameter("value")],
	},
	{
		code: "const parse = function (value: unknown): void {};",
		errors: [unknownParameter("value")],
	},
	{
		code: "declare function parse(value: unknown): void;",
		errors: [unknownParameter("value")],
	},
	{
		code: "type Parse = (value: unknown) => void;",
		errors: [unknownParameter("value")],
	},
	{
		code: "type Make = new (value: unknown) => object;",
		errors: [unknownParameter("value")],
	},
	{
		code: "interface Parser { (value: unknown): void }",
		errors: [unknownParameter("value")],
	},
	{
		code: "interface Factory { new (value: unknown): object }",
		errors: [unknownParameter("value")],
	},
	{
		code: "interface Parser { parse(value: unknown): void }",
		errors: [unknownParameter("value")],
	},
	{
		code: "abstract class Parser { abstract parse(value: unknown): void; }",
		errors: [unknownParameter("value")],
	},
	{
		code: "class Parser { parse(value: unknown): void {} }",
		errors: [unknownParameter("value")],
	},
	{
		code: "class Holder { constructor(private readonly value: unknown) {} }",
		errors: [unknownParameter("value")],
	},
	{
		code: "class Holder { constructor(private readonly value: unknown = 1) {} }",
		errors: [unknownParameter("value")],
	},
	{
		code: "function parse(...values: unknown): void {}",
		errors: [unknownParameter("values")],
	},
	{
		code: "function parse(...[first]: unknown): void {}",
		errors: [unknownParameter("[first]")],
	},
	{
		code: "function parse(value: unknown = 1): void {}",
		errors: [unknownParameter("value")],
	},
	{
		code: "function parse([first]: unknown): void {}",
		errors: [unknownParameter("[first]")],
	},
	{
		code: "function parse(value: unknown, other: unknown): void {}",
		errors: [unknownParameter("value"), unknownParameter("other")],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noUnknownParameters,
	valid,
});
