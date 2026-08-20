import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noRedundantTypeAnnotation, RULE_NAME } from "./rule";

const messageId = "redundant";

const valid: Array<ValidTestCase> = [
	// Nothing to restate.
	unindent`
		declare function getString(): string;
		const value = getString();
	`,
	// No initializer, so inference has nothing to work from.
	unindent`
		declare const value: string;
	`,
	// The annotation widens a literal, so it is doing work.
	unindent`
		const count: number = 5;
	`,
	unindent`
		const label: string = "hello";
	`,
	unindent`
		const flag: boolean = true;
	`,
	// The annotation is wider than the call's return type.
	unindent`
		declare function getString(): string;
		let value: number | string = getString();
	`,
	// `any` narrowed to `unknown` is the point of the annotation.
	unindent`
		declare function parse(): any;
		const value: unknown = parse();
	`,
	// `any` nested inside a type argument counts too.
	unindent`
		declare function load(): Promise<any>;
		const value: Promise<string> = load();
	`,
	unindent`
		declare function load(): Array<any>;
		const value: Array<number> = load();
	`,
	// An `any` annotation is mutually assignable with everything, so identity
	// proves nothing about it.
	unindent`
		declare function getUnknown(): unknown;
		const value: any = getUnknown();
	`,
	// An alias to a primitive leaves no trace in the type system, so removing the
	// annotation would erase the only mention of the name.
	unindent`
		type UserId = string;
		declare function getString(): string;
		const id: UserId = getString();
	`,
	unindent`
		type UserId = string;
		declare function getId(): UserId;
		const id: UserId = getId();
	`,
	// Destructuring is out of scope.
	unindent`
		declare const source: { a: string };
		const { a }: { a: string } = source;
	`,
	// Object and array literals belong to no-known-value-widening.
	unindent`
		const items: Array<string> = [];
	`,
	unindent`
		const owner: { id: number } = { id: 1 };
	`,
	// The annotation supplies the contextual type for the untyped parameter.
	unindent`
		const double: (value: number) => number = value => value * 2;
	`,
	unindent`
		const double: (value: number) => number = function (value) {
			return value * 2;
		};
	`,
	// Contextual typing reaches into call arguments.
	unindent`
		declare function wrap<T>(value: T): T;
		type Reducer = (state: number, action: string) => number;
		const reducer: Reducer = wrap((state, action) => state);
	`,
	// ...and into both branches of a conditional.
	unindent`
		declare function typed(): (value: number) => number;
		declare const choose: boolean;
		const fn: (value: number) => number = choose ? typed() : value => value;
	`,
	unindent`
		declare function typed(): (value: number) => number;
		declare const choose: boolean;
		const fn: (value: number) => number = choose ? value => value : typed();
	`,
	// ...and through a logical expression.
	unindent`
		declare const maybe: ((value: number) => number) | null;
		const fn: (value: number) => number = maybe || (value => value);
	`,
	// The annotation is what pins `T`; without it the default wins.
	unindent`
		declare function pick<T = number>(): T;
		const value: string = pick();
	`,
	// A generic whose declared return type mentions its own parameter.
	unindent`
		declare function first<T>(items: Array<T>): T;
		declare const items: Array<string>;
		const value: string = first(items);
	`,
	// A generic with an inferred return type is treated the same way.
	unindent`
		function identity<T>(value: T) {
			return value;
		}
		const value: string = identity("a");
	`,
	// The annotation widens away from a type parameter.
	unindent`
		function example<T extends string>(value: T): string {
			const url: string = value;
			return url;
		}
	`,
	// The annotation adds an index signature the initializer lacks.
	unindent`
		type Registry = Record<string, { key: string }>;
		declare function getObject(): {};
		const value: Registry = getObject();
	`,
	// The annotation adds an optional property.
	unindent`
		interface Base {
			a: string;
		}
		type Extended = Base & { extra?: number };
		declare function getBase(): Base;
		const value: Extended = getBase();
	`,
	// `let` widening makes the annotation narrower than the inferred type.
	unindent`
		let value: "a" = "a";
	`,
	// A union is not collapsed by `let` widening.
	unindent`
		declare const choose: boolean;
		let value: string = choose ? "a" : "b";
	`,
	// `const` keeps the enum member type, so the annotation widens it.
	unindent`
		enum Colour {
			Red,
			Blue,
		}
		const value: Colour = Colour.Red;
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			declare function getString(): string;
			const value: string = getString();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getString(): string;
			const value = getString();
		`,
	},
	{
		code: unindent`
			declare function getNumber(): number;
			const value: number = getNumber();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getNumber(): number;
			const value = getNumber();
		`,
	},
	// The case this rule exists for: `unknown` restating `unknown`.
	{
		code: unindent`
			declare function getUnknown(): unknown;
			const value: unknown = getUnknown();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getUnknown(): unknown;
			const value = getUnknown();
		`,
	},
	{
		code: unindent`
			declare function getString(): string;
			let value: string = getString();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getString(): string;
			let value = getString();
		`,
	},
	// `let` widens the literal to `string` anyway.
	{
		code: 'let value: string = "";',
		errors: [{ messageId }],
		output: 'let value = "";',
	},
	// `const` keeps the literal type, so the annotation restates it.
	{
		code: 'const value: "a" = "a";',
		errors: [{ messageId }],
		output: 'const value = "a";',
	},
	// A class instance restating its own class.
	{
		code: unindent`
			class Owner {}
			const value: Owner = new Owner();
		`,
		errors: [{ messageId }],
		output: unindent`
			class Owner {}
			const value = new Owner();
		`,
	},
	// An alias TypeScript keeps by name survives the fix, so it is reported.
	{
		code: unindent`
			type Handler = () => void;
			declare function getHandler(): Handler;
			const handler: Handler = getHandler();
		`,
		errors: [{ messageId }],
		output: unindent`
			type Handler = () => void;
			declare function getHandler(): Handler;
			const handler = getHandler();
		`,
	},
	// Explicit type arguments pin the generic, so inference cannot shift.
	{
		code: unindent`
			declare function pick<T = number>(): T;
			const value: string = pick<string>();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function pick<T = number>(): T;
			const value = pick<string>();
		`,
	},
	// Every parameter is annotated, so nothing depends on the context.
	{
		code: unindent`
			declare function wrap(value: (input: number) => number): (input: number) => number;
			const fn: (input: number) => number = wrap((input: number) => input);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function wrap(value: (input: number) => number): (input: number) => number;
			const fn = wrap((input: number) => input);
		`,
	},
	// `await` is transparent to the comparison.
	{
		code: unindent`
			declare function load(): Promise<string>;
			async function main(): Promise<void> {
				const value: string = await load();
			}
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function load(): Promise<string>;
			async function main(): Promise<void> {
				const value = await load();
			}
		`,
	},
	// `let` widens the enum member to the enum, which the annotation restates.
	{
		code: unindent`
			enum Colour {
				Red,
			}
			let value: Colour = Colour.Red;
		`,
		errors: [{ messageId }],
		output: unindent`
			enum Colour {
				Red,
			}
			let value = Colour.Red;
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noRedundantTypeAnnotation,
	valid,
});
