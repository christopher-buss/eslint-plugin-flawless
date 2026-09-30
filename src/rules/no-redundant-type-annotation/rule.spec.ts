import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import path from "node:path";

import { run } from "../test";
import { noRedundantTypeAnnotation, RULE_NAME } from "./rule";

const catchMessageId = "redundantCatch";
const messageId = "redundant";
const parameterMessageId = "redundantParameter";

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
	// A generic tag infers from the annotation the same way a generic call does.
	unindent`
		declare function tag<T>(strings: TemplateStringsArray): T;
		const value: string = tag\`\`;
		value.toUpperCase();
	`,
	unindent`
		declare function tag<T>(strings: TemplateStringsArray): Array<T>;
		const value: Array<string> = tag\`\`;
	`,
	unindent`
		declare function tag<T>(strings: TemplateStringsArray, ...values: Array<T>): Array<T>;
		const value: Array<"a"> = tag\`\${"a"}\`;
	`,
	unindent`
		interface Box<T> {
			value: T;
		}
		declare function tag<T>(strings: TemplateStringsArray): Box<T>;
		const value: Box<string> = tag\`\`;
	`,
	unindent`
		declare function tag<T>(strings: TemplateStringsArray): Promise<T>;
		async function load(): Promise<void> {
			const value: string = await tag\`\`;
		}
	`,
	unindent`
		declare const tags: { tag<T>(strings: TemplateStringsArray): Array<T> };
		const value: Array<string> = tags.tag\`\`;
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
	// The annotation reaches a literal in either branch of a conditional.
	unindent`
		declare const choose: boolean;
		declare const tuple: [number];
		const value: [number] = choose ? [1] : tuple;
	`,
	unindent`
		declare const choose: boolean;
		declare const owner: { kind: "a" };
		const value: { kind: "a" } = choose ? { kind: "a" } : owner;
	`,

	// --- function return values ---

	// The annotation keeps a returned literal from widening.
	unindent`
		const fn: () => 1 = () => 1;
	`,
	unindent`
		const getTag: () => "div" = () => "div";
	`,
	unindent`
		const getFlag: () => true = () => true;
	`,
	unindent`
		enum Colour {
			Red,
			Blue,
		}
		const getColour: () => Colour.Red = () => Colour.Red;
	`,
	unindent`
		declare const key: unique symbol;
		const getKey: () => typeof key = () => key;
	`,
	unindent`
		const tag = "a";
		const getTag: () => "a" = () => tag;
	`,
	unindent`
		const fn: () => 1 = () => 1 satisfies number;
	`,
	// ...through the promise of an async function.
	unindent`
		const load: () => Promise<1> = async () => 1;
	`,
	// A template expression is a template type only under a context.
	unindent`
		declare const suffix: string;
		const getName: () => \`a\${string}\` = () => \`a\${suffix}\`;
	`,
	unindent`
		declare const choose: boolean;
		declare const suffix: string;
		const getName: () => \`a\${string}\` | \`b\${string}\` = () =>
			choose ? \`a\${suffix}\` : \`b\${suffix}\`;
	`,
	// A returned array or object literal is typed against the annotation.
	unindent`
		const usePair: () => [number, string] = () => [1, "a"];
	`,
	unindent`
		declare const choose: boolean;
		declare const tuple: [number];
		const get: () => [number] = () => (choose ? [1] : tuple);
	`,
	unindent`
		const get: () => { kind: "a" } = () => ({ kind: "a" });
	`,
	// A returned function takes its parameter types from the annotation.
	unindent`
		const outer: () => (x: number) => number = () => x => x;
	`,
	unindent`
		const outer: () => () => 1 = () => () => 1;
	`,
	// A returned generic call infers from the annotation.
	unindent`
		const make: () => Set<string> = () => new Set();
	`,
	// Returns nested in blocks count too.
	unindent`
		declare const choose: boolean;
		const fn: () => 1 = () => {
			if (choose) {
				return 1;
			}
			return 1;
		};
	`,
	// The annotation types `this`.
	unindent`
		interface Owner {
			x: number;
		}
		const read: (this: Owner) => number = function () {
			return this.x;
		};
	`,
	unindent`
		interface Owner {
			x: number;
		}
		const read: (this: Owner) => () => number = function () {
			return () => this.x;
		};
	`,
	// A generator's `yield` is contextually typed, which the rule does not
	// follow.
	unindent`
		const gen: () => Generator<1, void, unknown> = function* () {
			yield 1;
		};
	`,
	// Both branches of a conditional are followed.
	unindent`
		declare const choose: boolean;
		const fn: () => 1 = choose ? () => 1 : () => 1;
	`,

	// --- parameters ---

	// A declaration has no contextual type, so its parameters must say so.
	unindent`
		function handle(value: string): void {}
	`,
	// Nothing supplies a context here either.
	unindent`
		const handle = (value: string): void => {};
	`,
	// The annotation is narrower than the context gives.
	unindent`
		declare function each(callback: (value: number | string) => void): void;
		each((value: string) => {});
	`,
	// The annotation is an inference source for the generic, not a restatement.
	unindent`
		declare function wrap<T>(callback: (value: T) => T): void;
		wrap((value: number) => value);
	`,
	// An overloaded callee can be picked by the parameter type.
	unindent`
		declare function on(event: "click", handler: (payload: number) => void): void;
		declare function on(event: "key", handler: (payload: string) => void): void;
		on("click", (payload: number) => {});
	`,
	// A function the callback returns infers the generic's return type, so its
	// annotation is the only source of the context it would appear to restate.
	unindent`
		declare function map<T, R>(items: Array<T>, fn: (item: T) => R): Array<R>;
		map([1], () => (s: string) => s.length);
	`,
	unindent`
		declare function map<T, R>(items: Array<T>, fn: (item: T) => R): Array<R>;
		map([1], () => ({ format: (n: number) => \`\${n}\` }));
	`,
	unindent`
		declare function map<T, R>(items: Array<T>, fn: (item: T) => R): Array<R>;
		map([1], () => {
			return { format: (n: number) => \`\${n}\` };
		});
	`,
	unindent`
		declare const choose: boolean;
		declare function map<T, R>(items: Array<T>, fn: (item: T) => R): Array<R>;
		map([1], () => {
			if (choose) {
				return (s: string) => s.length;
			}
			return (s: string) => s.length + 1;
		});
	`,
	unindent`
		declare function map<T, R>(items: Array<T>, fn: (item: T) => R): Array<R>;
		map([1], () => [(s: string) => s]);
	`,
	unindent`
		declare function map<T, R>(items: Array<T>, fn: (item: T) => R): Array<R>;
		map([1], async () => (s: string) => s);
	`,
	// A generic class declares its type parameters on the class, not on the
	// constructor, and `new` infers them all the same.
	unindent`
		declare class Box<T> {
			constructor(value: T);
		}
		new Box((s: string) => s);
	`,
	unindent`
		declare class Box<T> {
			constructor(value: T);
		}
		new Box([(s: string) => s]);
	`,
	unindent`
		declare class Box<T> {
			constructor(make: () => T);
		}
		new Box(() => [(s: string) => s]);
	`,
	unindent`
		declare class Box<T> {
			constructor(value?: T);
			value: T;
		}
		const box: Box<string> = new Box();
	`,
	// An overloaded constructor can be picked by the parameter type.
	unindent`
		declare class Box {
			constructor(fn: (payload: number) => void);
			constructor(fn: (payload: string) => void);
		}
		new Box((payload: string) => {});
	`,
	// A tagged template passes its holes to the tag as arguments.
	unindent`
		declare function tag<T>(strings: TemplateStringsArray, ...values: Array<T>): T;
		tag\`\${(s: string) => s}\`;
	`,
	unindent`
		declare function tag<T>(strings: TemplateStringsArray, ...values: Array<T>): T;
		tag\`\${[(s: string) => s]}\`;
	`,
	// A yielded value infers the generator's type like a returned one.
	unindent`
		declare function gen<T>(make: () => Generator<T>): T;
		gen(function* () {
			yield (s: string) => s;
		});
	`,
	unindent`
		declare function gen<T>(make: () => Generator<T>): T;
		gen(function* () {
			yield [(s: string) => s];
		});
	`,
	// A spread and a sequence's last expression pass the call's context on.
	unindent`
		declare function wrap<T>(value: T): T;
		wrap({ ...{ format: (s: string) => s } });
	`,
	unindent`
		declare function wrap<T>(value: T): T;
		wrap([...[(s: string) => s]]);
	`,
	unindent`
		declare function tick(): void;
		declare function wrap<T>(value: T): T;
		wrap((tick(), (s: string) => s));
	`,
	// After `this`, the annotation is narrower than the parameter in its
	// position.
	unindent`
		interface Target {}
		declare function on(fn: (this: Target, event: "click", detail: string) => void): void;
		on(function (this: Target, event: string) {});
	`,
	// A rest parameter holds the array, not the element the signature pairs it
	// with.
	unindent`
		declare function each(callback: (value: string) => void): void;
		each((...values: Array<string>) => {});
	`,
	// An optional parameter carries `| undefined` that the annotation does not.
	unindent`
		declare function each(callback: (value?: number) => void): void;
		each((value: number) => {});
	`,
	// An `any` contextual type is not something to inherit silently.
	unindent`
		declare function each(callback: (value: any) => void): void;
		each((value: string) => {});
	`,

	// --- catch clauses ---

	// Nothing is written, so there is nothing to restate.
	unindent`
		try {
		} catch (error) {}
	`,
	// `any` opts the variable back out of `unknown`, which is real work.
	unindent`
		try {
		} catch (error: any) {}
	`,
	// The alias is the only mention of the name, as for a variable.
	unindent`
		type Thrown = unknown;
		try {
		} catch (error: Thrown) {}
	`,
	// `as const` hands the outer call's inferred type back as context, so the
	// annotation is the only inference source.
	unindent`
		declare function each<T>(cases: ReadonlyArray<T>): void;
		each([["a", (n: number) => n]] as const);
	`,
	unindent`
		declare function each<T>(cases: ReadonlyArray<T>): void;
		each([{ run: (n: number) => n }] as const);
	`,
	unindent`
		declare function each<T>(cases: ReadonlyArray<T>): void;
		each(<const>[["a", (n: number) => n]]);
	`,
	// A non-null assertion passes the same circular context through.
	unindent`
		declare function each<T>(cases: ReadonlyArray<T>): void;
		each([((n: number) => n)!]);
	`,
];

const invalid: Array<InvalidTestCase> = [
	// A non-const assertion supplies a real contextual type.
	{
		code: unindent`
			const f = ((n: number) => n) as (n: number) => number;
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			const f = ((n) => n) as (n: number) => number;
		`,
	},
	// An explicit type argument fixes `T`, so the annotation restates it.
	{
		code: unindent`
			declare function each<T>(cases: ReadonlyArray<T>): void;
			each<[string, (n: number) => number]>([["a", (n: number) => n]] as const);
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function each<T>(cases: ReadonlyArray<T>): void;
			each<[string, (n: number) => number]>([["a", (n) => n]] as const);
		`,
	},
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
	{
		code: unindent`
			declare function tag<T>(strings: TemplateStringsArray): Array<T>;
			const value: Array<string> = tag<string>\`\`;
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function tag<T>(strings: TemplateStringsArray): Array<T>;
			const value = tag<string>\`\`;
		`,
	},
	// A tag that is not generic has nothing to infer.
	{
		code: unindent`
			declare function tag(strings: TemplateStringsArray): Array<string>;
			const value: Array<string> = tag\`\`;
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function tag(strings: TemplateStringsArray): Array<string>;
			const value = tag\`\`;
		`,
	},
	// Both annotations go: the parameter's context comes from `wrap`, not from
	// the variable, so neither removal depends on the other.
	{
		code: unindent`
			declare function wrap(value: (input: number) => number): (input: number) => number;
			const fn: (input: number) => number = wrap((input: number) => input);
		`,
		errors: [{ messageId }, { messageId: parameterMessageId }],
		output: unindent`
			declare function wrap(value: (input: number) => number): (input: number) => number;
			const fn = wrap((input) => input);
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

	// --- function return values ---

	// A context of `number` gives the literal nothing, so it widens anyway.
	{
		code: "const fn: () => number = () => 1;",
		errors: [{ messageId }],
		output: "const fn = () => 1;",
	},
	{
		code: unindent`
			declare function getNumber(): number;
			const fn: () => number = () => getNumber();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getNumber(): number;
			const fn = () => getNumber();
		`,
	},
	{
		code: "const load: () => Promise<number> = async () => 1;",
		errors: [{ messageId }],
		output: "const load = async () => 1;",
	},
	// A union of literals does not widen.
	{
		code: unindent`
			declare const choose: boolean;
			const fn: () => "a" | "b" = () => (choose ? "a" : "b");
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const choose: boolean;
			const fn = () => (choose ? "a" : "b");
		`,
	},
	{
		code: unindent`
			declare const choose: boolean;
			const fn: () => "a" | "b" = () => {
				if (choose) {
					return "a";
				}
				return "b";
			};
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const choose: boolean;
			const fn = () => {
				if (choose) {
					return "a";
				}
				return "b";
			};
		`,
	},
	// Nothing is returned, so nothing takes the context.
	{
		code: "const fn: () => void = () => {};",
		errors: [{ messageId }],
		output: "const fn = () => {};",
	},
	{
		code: unindent`
			const fn: () => never = () => {
				throw new Error("fail");
			};
		`,
		errors: [{ messageId }],
		output: unindent`
			const fn = () => {
				throw new Error("fail");
			};
		`,
	},
	// The function's own return type stops the context.
	{
		code: "const fn: () => 1 = (): 1 => 1;",
		errors: [{ messageId }],
		output: "const fn = (): 1 => 1;",
	},
	// A callback passed to a plain call takes its context from the callee, so
	// what it returns says nothing about the variable's annotation.
	{
		code: unindent`
			declare function run(fn: () => "a"): number;
			const value: number = run(() => "a");
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function run(fn: () => "a"): number;
			const value = run(() => "a");
		`,
	},
	{
		code: unindent`
			declare function run(fn: () => object): number;
			const value: number = run(() => ({}));
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function run(fn: () => object): number;
			const value = run(() => ({}));
		`,
	},
	{
		code: unindent`
			declare function run(fn: (this: { x: number }) => number): number;
			const value: number = run(function () {
				return this.x;
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function run(fn: (this: { x: number }) => number): number;
			const value = run(function () {
				return this.x;
			});
		`,
	},

	// --- parameters ---

	// The callback's parameter type comes from the signature it is passed to.
	{
		code: unindent`
			interface Item {
				id: string;
			}
			declare const items: Array<Item>;
			items.forEach((item: Item) => {
				console.log(item.id);
			});
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			interface Item {
				id: string;
			}
			declare const items: Array<Item>;
			items.forEach((item) => {
				console.log(item.id);
			});
		`,
	},
	// A destructured parameter is annotated the same way.
	{
		code: unindent`
			interface Props {
				a: string;
			}
			declare function render(callback: (props: Props) => void): void;
			render(({ a }: Props) => {
				console.log(a);
			});
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			interface Props {
				a: string;
			}
			declare function render(callback: (props: Props) => void): void;
			render(({ a }) => {
				console.log(a);
			});
		`,
	},
	// Only the parameter is reported: the variable annotation is what supplies
	// its context, so both cannot go.
	{
		code: unindent`
			type Handler = (payload: string) => void;
			const handle: Handler = (payload: string) => {};
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			type Handler = (payload: string) => void;
			const handle: Handler = (payload) => {};
		`,
	},
	// Each parameter is judged on its own.
	{
		code: unindent`
			declare function each(callback: (value: string, index: number) => void): void;
			each((value: string, index: number | string) => {});
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function each(callback: (value: string, index: number) => void): void;
			each((value, index: number | string) => {});
		`,
	},
	// A rest parameter matched against a rest parameter is comparable.
	{
		code: unindent`
			declare function each(callback: (...values: Array<string>) => void): void;
			each((...values: Array<string>) => {});
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function each(callback: (...values: Array<string>) => void): void;
			each((...values) => {});
		`,
	},
	// An explicit type argument pins the generic, so the annotation restates it.
	{
		code: unindent`
			declare function wrap<T>(callback: (value: T) => T): void;
			wrap<number>((value: number) => value);
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function wrap<T>(callback: (value: T) => T): void;
			wrap<number>((value) => value);
		`,
	},
	{
		code: unindent`
			declare class Box<T> {
				constructor(value: T);
			}
			new Box<(s: string) => string>((s: string) => s);
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare class Box<T> {
				constructor(value: T);
			}
			new Box<(s: string) => string>((s) => s);
		`,
	},
	// Without a type parameter, a tag or a generator's yield type is the
	// context the annotation restates.
	{
		code: unindent`
			declare function tag(strings: TemplateStringsArray, ...values: Array<(s: string) => string>): void;
			tag\`\${(s: string) => s}\`;
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function tag(strings: TemplateStringsArray, ...values: Array<(s: string) => string>): void;
			tag\`\${(s) => s}\`;
		`,
	},
	{
		code: unindent`
			declare function gen(make: () => Generator<(s: string) => string>): void;
			gen(function* () {
				yield (s: string) => s;
			});
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function gen(make: () => Generator<(s: string) => string>): void;
			gen(function* () {
				yield (s) => s;
			});
		`,
	},
	// A `this` parameter does not shift the positions after it.
	{
		code: unindent`
			interface Target {}
			declare function on(fn: (this: Target, event: "click", detail: string) => void): void;
			on(function (this: Target, event: string, detail: string) {});
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			interface Target {}
			declare function on(fn: (this: Target, event: "click", detail: string) => void): void;
			on(function (this: Target, event: string, detail) {});
		`,
	},
	// The callback's return type names no type parameter, so the returned
	// function's context holds without its annotation.
	{
		code: unindent`
			declare function run<T>(items: Array<T>, fn: () => (s: string) => number): void;
			run([1], () => (s: string) => s.length);
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function run<T>(items: Array<T>, fn: () => (s: string) => number): void;
			run([1], () => (s) => s.length);
		`,
	},
	// A function expression in an object literal gets its context from the
	// object's contextual type.
	{
		code: unindent`
			interface Handlers {
				click: (payload: number) => void;
			}
			declare function register(handlers: Handlers): void;
			register({
				click: function (payload: number) {},
			});
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			interface Handlers {
				click: (payload: number) => void;
			}
			declare function register(handlers: Handlers): void;
			register({
				click: function (payload) {},
			});
		`,
	},
	// A catch variable is already `unknown` under the compiler option, and
	// `unknown` is the only thing the annotation can be saying.
	{
		code: unindent`
			try {
			} catch (error: unknown) {}
		`,
		errors: [{ messageId: catchMessageId }],
		output: unindent`
			try {
			} catch (error) {}
		`,
	},
	// The catch body is irrelevant; only the annotation is read.
	{
		code: unindent`
			declare function report(value: unknown): void;
			try {
			} catch (error: unknown) {
				report(error);
			}
		`,
		errors: [{ messageId: catchMessageId }],
		output: unindent`
			declare function report(value: unknown): void;
			try {
			} catch (error) {
				report(error);
			}
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noRedundantTypeAnnotation,
	valid,
});

// A JSX element calls its component with the attributes as props, so a
// generic component infers from them like a generic call.
const jsxFilename = "file.tsx";

/**
 * Declares the JSX namespace a component's return type needs.
 *
 * @param code - The test source.
 * @returns The source with the namespace declared above it.
 */
function withJsx(code: string): string {
	return `declare global { namespace JSX { interface Element {} } }\n${code}`;
}

run({
	name: `${RULE_NAME}/jsx`,
	invalid: [
		{
			code: withJsx(unindent`
				declare function Button(props: { onClick: (count: number) => void }): JSX.Element;
				<Button onClick={(count: number) => {}} />;
			`),
			errors: [{ messageId: parameterMessageId }],
			filename: jsxFilename,
			output: withJsx(unindent`
				declare function Button(props: { onClick: (count: number) => void }): JSX.Element;
				<Button onClick={(count) => {}} />;
			`),
		},
		{
			// An explicit type argument pins the generic, as for a call.
			code: withJsx(unindent`
				declare function One<T>(props: { a: T }): JSX.Element;
				<One<(s: string) => string> a={(s: string) => s} />;
			`),
			errors: [{ messageId: parameterMessageId }],
			filename: jsxFilename,
			output: withJsx(unindent`
				declare function One<T>(props: { a: T }): JSX.Element;
				<One<(s: string) => string> a={(s) => s} />;
			`),
		},
	],
	rule: noRedundantTypeAnnotation,
	valid: [
		{
			code: withJsx(unindent`
				declare function One<T>(props: { a: Array<T> }): JSX.Element;
				<One a={[(s: string) => s]} />;
			`),
			filename: jsxFilename,
		},
		{
			code: withJsx(unindent`
				declare function List<T, R>(props: {
					items: Array<T>;
					make: () => R;
					use: (made: R) => void;
				}): JSX.Element;
				<List items={[1]} make={() => (s: string) => s} use={(made) => made("x")} />;
			`),
			filename: jsxFilename,
		},
		{
			// Each annotation alone would do, but the fix removes both.
			code: withJsx(unindent`
				declare function Pair<T>(props: { a: T; b: T }): JSX.Element;
				<Pair a={(s: string) => s} b={(s: string) => s} />;
			`),
			filename: jsxFilename,
		},
		{
			code: withJsx(unindent`
				declare function One<T>(props: { a: T }): JSX.Element;
				<One {...{ a: (s: string) => s }} />;
			`),
			filename: jsxFilename,
		},
		{
			code: withJsx(unindent`
				declare function Render<T>(props: { children: T }): JSX.Element;
				<Render>{(s: string) => s}</Render>;
			`),
			filename: jsxFilename,
		},
	],
});

// `useUnknownInCatchVariables` is what makes a bare catch variable `unknown`.
// Proving the rule stands down when it is off needs a project that turns it
// off, so these cases run against `fixtures/no-redundant-type-annotation/
// loose-catch`.
const looseCatchDirectory = path.resolve(
	__dirname,
	"../../../fixtures/no-redundant-type-annotation/loose-catch",
);

run({
	name: `${RULE_NAME}/loose-catch`,
	invalid: [],
	parserOptions: {
		ecmaVersion: "latest",
		project: path.join(looseCatchDirectory, "tsconfig.json"),
		sourceType: "module",
		tsconfigRootDir: looseCatchDirectory,
	},
	rule: noRedundantTypeAnnotation,
	valid: [
		{
			// Without the option the variable is `any`, so the annotation is
			// narrowing it rather than restating it.
			code: unindent`
				try {
				} catch (error: unknown) {}
			`,
			filename: path.join(looseCatchDirectory, "case.ts"),
		},
	],
});

// Without `strictNullChecks`, an inferred `null` or `undefined` return widens
// to `any`. These cases run against
// `fixtures/no-redundant-type-annotation/loose-null`.
const looseNullDirectory = path.resolve(
	__dirname,
	"../../../fixtures/no-redundant-type-annotation/loose-null",
);

run({
	name: `${RULE_NAME}/loose-null`,
	invalid: [
		{
			// A returned value that is not `null` does not widen.
			code: unindent`
				declare function getNumber(): number;
				const fn: () => number = () => getNumber();
			`,
			errors: [{ messageId }],
			filename: path.join(looseNullDirectory, "case.ts"),
			output: unindent`
				declare function getNumber(): number;
				const fn = () => getNumber();
			`,
		},
	],
	parserOptions: {
		ecmaVersion: "latest",
		project: path.join(looseNullDirectory, "tsconfig.json"),
		sourceType: "module",
		tsconfigRootDir: looseNullDirectory,
	},
	rule: noRedundantTypeAnnotation,
	valid: [
		{
			// Without the annotation the function returns `any`.
			code: "const fn: () => null = () => null;",
			filename: path.join(looseNullDirectory, "case.ts"),
		},
		{
			code: "const fn: () => undefined = () => undefined;",
			filename: path.join(looseNullDirectory, "case.ts"),
		},
	],
});

// `isolatedDeclarations` makes an exported variable's annotation the only copy
// of its type the declaration emitter can read, so removing it is a compile
// error rather than a cleanup. These cases run against
// `fixtures/no-redundant-type-annotation/isolated-declarations`.
const isolatedDeclarationsDirectory = path.resolve(
	__dirname,
	"../../../fixtures/no-redundant-type-annotation/isolated-declarations",
);

run({
	name: `${RULE_NAME}/isolated-declarations`,
	invalid: [
		{
			// A variable that stays inside the module is out of the option's
			// reach.
			code: unindent`
				declare function getDate(): Date;
				const value: Date = getDate();
				export function use(): void {
					void value;
				}
			`,
			errors: [{ messageId }],
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
			output: unindent`
				declare function getDate(): Date;
				const value = getDate();
				export function use(): void {
					void value;
				}
			`,
		},
		{
			// The variable annotation is what the emitter reads, so it stays; the
			// parameter annotation it supplies is still a restatement.
			code: unindent`
				type Handler = (value: string) => void;
				export const handler: Handler = (value: string) => {};
			`,
			errors: [{ messageId: parameterMessageId }],
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
			output: unindent`
				type Handler = (value: string) => void;
				export const handler: Handler = (value) => {};
			`,
		},
	],
	parserOptions: {
		ecmaVersion: "latest",
		project: path.join(isolatedDeclarationsDirectory, "tsconfig.json"),
		sourceType: "module",
		tsconfigRootDir: isolatedDeclarationsDirectory,
	},
	rule: noRedundantTypeAnnotation,
	valid: [
		{
			// Dropping the annotation here reports error TS9010, so the rule
			// leaves the exported declaration alone.
			code: unindent`
				export const RbxPathParent: unique symbol = Symbol("Parent");
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
		{
			code: unindent`
				declare function getDate(): Date;
				export const value: Date = getDate();
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
		{
			// An export list reaches the declaration just the same.
			code: unindent`
				declare function getDate(): Date;
				const value: Date = getDate();
				export { value };
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
	],
});
