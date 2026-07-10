import {
	type InvalidTestCase,
	unindent as ts,
	type ValidTestCase,
} from "eslint-vitest-rule-tester";

import { run } from "../test";
import { preferParameterDestructuring, RULE_NAME } from "./rule";

const messageId = "default";

const valid: Array<ValidTestCase> = [
	// Already destructured in the signature.
	"function foo({ a }) { return a; }",
	"function foo({ a }: { a: number }) { return a; }",
	"const foo = ({ a }) => a;",
	// The parameter is passed on, so the destructuring must stay in the body.
	ts`
		function bar(obj) {
			const { a } = obj;
			console.log(a);
			baz(obj);
		}
	`,
	// Member access is a real use (core prefer-destructuring's territory).
	"function f(obj) { return obj.a; }",
	// Returned wholesale.
	ts`
		function f(obj) {
			const { a } = obj;
			return [a, obj];
		}
	`,
	// Spread is a real use.
	ts`
		function f(obj) {
			const { a } = obj;
			return { ...obj, a };
		}
	`,
	// Reassigned before destructuring.
	ts`
		function f(obj) {
			obj = { a: 1 };
			const { a } = obj;
			return a;
		}
	`,
	// Destructured from a member expression, not the parameter itself.
	ts`
		function f(obj) {
			const { a } = obj.nested;
			return a;
		}
	`,
	// Conditional destructuring must not move to the signature.
	ts`
		function f(obj) {
			if (globalThis.flag) {
				const { a } = obj;
				return a;
			}
			return null;
		}
	`,
	// Destructuring inside a closure is deferred; moving it changes semantics.
	ts`
		function f(obj) {
			return () => {
				const { a } = obj;
				return a;
			};
		}
	`,
	// Array destructuring is out of scope (objects only).
	ts`
		function f(pair) {
			const [first] = pair;
			return first;
		}
	`,
	// Assignment destructuring reuses existing bindings.
	ts`
		function f(obj) {
			let a;
			({ a } = obj);
			return a;
		}
	`,
	// An unused parameter is no-unused-vars' business.
	"function f(obj) { return 1; }",
	// A non-null assertion or type assertion on the init is a real use.
	ts`
		function f(obj) {
			const { a } = obj!;
			return a;
		}
	`,
	ts`
		function f(obj) {
			const { a } = obj as { a: number };
			return a;
		}
	`,
	// `await` may not appear in parameter initializers, so no signature form
	// exists and the destructuring must stay in the body.
	ts`
		async function f(obj) {
			const { a = await Promise.resolve(1) } = obj;
			return a;
		}
	`,
	ts`
		async function pnpm(options) {
			const { catalogs = await detectCatalogUsage(), isInEditor } = options;
			return [catalogs, isInEditor];
		}
	`,
	// Same for `yield` in a generator.
	ts`
		function* g(obj) {
			const { a = yield } = obj;
			return a;
		}
	`,
	// A "use strict" directive is illegal with a non-simple parameter list.
	ts`
		function f(obj) {
			"use strict";
			const { a } = obj;
			return a;
		}
	`,
	// A for-loop init is not a top-level body destructure.
	ts`
		function f(obj) {
			for (const { a } = obj; a > 0; ) {
				return a;
			}
			return null;
		}
	`,
];

const invalid: Array<InvalidTestCase> = [
	// The basic case.
	{
		code: ts`
			function bar(obj) {
				const { a } = obj;
				console.log(a);
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function bar({ a }) {
				console.log(a);
			}
		`,
	},
	// The parameter's type annotation is preserved.
	{
		code: ts`
			interface Item {
				a: number;
			}
			function bar(obj: Item) {
				const { a } = obj;
				console.log(a);
			}
		`,
		errors: [{ messageId }],
		output: ts`
			interface Item {
				a: number;
			}
			function bar({ a }: Item) {
				console.log(a);
			}
		`,
	},
	// An un-parenthesized arrow parameter gains parentheses.
	{
		code: ts`
			const f = obj => {
				const { a } = obj;
				return a;
			};
		`,
		errors: [{ messageId }],
		output: ts`
			const f = ({ a }) => {
				return a;
			};
		`,
	},
	// A parameter default is preserved.
	{
		code: ts`
			function f(obj = {}) {
				const { a } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f({ a } = {}) {
				return a;
			}
		`,
	},
	// Renames, defaults, and nesting move verbatim.
	{
		code: ts`
			function f(obj) {
				const { a: x, b = 1, c: { d } } = obj;
				return x + b + d;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f({ a: x, b = 1, c: { d } }) {
				return x + b + d;
			}
		`,
	},
	// A rest element is fine when it is the only statement.
	{
		code: ts`
			function f(obj) {
				const { a, ...rest } = obj;
				return [a, rest];
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f({ a, ...rest }) {
				return [a, rest];
			}
		`,
	},
	// Multiple statements merge into one pattern.
	{
		code: ts`
			function f(obj) {
				const { a } = obj;
				const { b } = obj;
				return a + b;
			}
		`,
		errors: [{ messageId }, { messageId }],
		output: ts`
			function f({ a, b }) {
				return a + b;
			}
		`,
	},
	// Two declarators of the same declaration merge as well.
	{
		code: ts`
			function f(obj) {
				const { a } = obj, { b } = obj;
				return a + b;
			}
		`,
		errors: [{ messageId }, { messageId }],
		output: ts`
			function f({ a, b }) {
				return a + b;
			}
		`,
	},
	// A default referencing an earlier sibling binding stays legal in a
	// parameter pattern.
	{
		code: ts`
			function f(obj) {
				const { a, b = a } = obj;
				return b;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f({ a, b = a }) {
				return b;
			}
		`,
	},
	// A plain pattern only performs property reads, so it may move past
	// earlier statements (the documented getter caveat).
	{
		code: ts`
			function f(obj) {
				log();
				const { a } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f({ a }) {
				log();
				return a;
			}
		`,
	},
	// A default value executes code; hoisting it past an earlier statement
	// reorders side effects, which the default options accept.
	{
		code: ts`
			function f(obj) {
				sideEffect();
				const { a = compute() } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f({ a = compute() }) {
				sideEffect();
				return a;
			}
		`,
	},
	// With allowSideEffectReordering: false the fix is withheld instead.
	{
		code: ts`
			function f(obj) {
				sideEffect();
				const { a = compute() } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		options: [{ allowSideEffectReordering: false }],
		output: null,
	},
	// ... but at the very top of the body nothing is reordered.
	{
		code: ts`
			function f(obj) {
				const { a = compute() } = obj;
				sideEffect();
				return a;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f({ a = compute() }) {
				sideEffect();
				return a;
			}
		`,
	},
	// A bound name referenced before the statement is in its temporal dead
	// zone; moving the binding into the parameter list would stop it throwing.
	{
		code: ts`
			function f(obj) {
				const early = () => a;
				const { a } = obj;
				return [early, a];
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// A setter legally takes a destructuring parameter.
	{
		code: ts`
			const target = {
				set value(obj) {
					const { a } = obj;
					console.log(a);
				},
			};
		`,
		errors: [{ messageId }],
		output: ts`
			const target = {
				set value({ a }) {
					console.log(a);
				},
			};
		`,
	},
	// A body-scoped type in the pattern annotation cannot move to the
	// signature.
	{
		code: ts`
			function f(obj) {
				type Local = { a: number };
				const { a }: Local = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// A later, not-yet-initialized parameter in a default blocks the fix; an
	// earlier one does not.
	{
		code: ts`
			function f(obj, limit) {
				const { a = limit } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: ts`
			function f(limit, obj) {
				const { a = limit } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f(limit, { a = limit }) {
				return a;
			}
		`,
	},
	// The second parameter can be rewritten, not just the first.
	{
		code: ts`
			function f(first, obj) {
				const { a } = obj;
				return first + a;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			function f(first, { a }) {
				return first + a;
			}
		`,
	},
	// Methods and class functions are checked like any other function.
	{
		code: ts`
			const api = {
				handle(request) {
					const { url } = request;
					return url;
				},
			};
		`,
		errors: [{ messageId }],
		output: ts`
			const api = {
				handle({ url }) {
					return url;
				},
			};
		`,
	},
	{
		code: ts`
			class Handler {
				run(options) {
					const { a } = options;
					return a;
				}
			}
		`,
		errors: [{ messageId }],
		output: ts`
			class Handler {
				run({ a }) {
					return a;
				}
			}
		`,
	},
	// A pattern annotation moves to the signature when the parameter has none.
	{
		code: ts`
			interface Options {
				a: number;
			}
			function f(obj) {
				const { a }: Options = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: ts`
			interface Options {
				a: number;
			}
			function f({ a }: Options) {
				return a;
			}
		`,
	},
	// Conflicting annotations on both sides block the fix.
	{
		code: ts`
			interface Wide {
				a: number;
			}
			interface Narrow {
				a: number;
			}
			function f(obj: Wide) {
				const { a }: Narrow = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// An unrelated sibling declarator blocks the fix.
	{
		code: ts`
			function f(obj) {
				const { a } = obj, extra = 1;
				return a + extra;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// A computed key referencing a body binding blocks the fix.
	{
		code: ts`
			function f(obj) {
				const key = "a";
				const { [key]: value } = obj;
				return value;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// A default referencing a body binding blocks the fix.
	{
		code: ts`
			function f(obj) {
				const fallback = 1;
				const { a = fallback } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// `arguments` is unavailable in parameter initializers of this function.
	{
		code: ts`
			function f(obj) {
				const { a = arguments[0] } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// Merging around a rest element would reorder it away from last place.
	{
		code: ts`
			function f(obj) {
				const { a, ...rest } = obj;
				const { b } = obj;
				return [a, b, rest];
			}
		`,
		errors: [{ messageId }, { messageId }],
		output: null,
	},
	// `var` can rebind a parameter name; the merged pattern would collide.
	{
		code: ts`
			function f(obj, a) {
				var { a } = obj;
				return a;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	// Two parameters can both be rewritten in one pass.
	{
		code: ts`
			function f(left, right) {
				const { a } = left;
				const { b } = right;
				return a + b;
			}
		`,
		errors: [{ messageId }, { messageId }],
		output: ts`
			function f({ a }, { b }) {
				return a + b;
			}
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferParameterDestructuring,
	valid,
});
