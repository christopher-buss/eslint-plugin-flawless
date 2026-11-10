import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { run } from "../test";
import { checkFixes, checkRuleFixes, type FixedSnippet } from "./fix-safety";
import { corpus } from "./fix-safety-corpus";
import { regressions } from "./regressions";
import { noRedundantTypeAnnotation, RULE_NAME } from "./rule";

const catchMessageId = "redundantCatch";
const messageId = "redundant";
const parameterMessageId = "redundantParameter";

const valid: Array<ValidTestCase> = [
	...regressions.map(({ code }) => code),
	// Nothing to restate.
	unindent`
		declare function getString(): string;
		const value = getString();
	`,
	// A method whose object has no context gets no parameter types.
	unindent`
		const handlers = {
			format(text: string) {
				return text;
			},
		};
	`,
	// A union of object contexts types a method from each member.
	unindent`
		declare const handlers:
			| { format(text: string): string }
			| { format(text: number): string };
		const next: typeof handlers = {
			format(text: string) {
				return text;
			},
		};
	`,
	// A union of different callbacks gives no contextual signature.
	unindent`
		const read: ((value: string) => void) | ((value: number) => void) = (value: string) => {};
	`,
	// A type parameter only the context can fill.
	unindent`
		declare function fromAny<T>(value: unknown): T;
		declare const raw: unknown;
		const value: string = fromAny(raw);
	`,
	// A callback parameter typed by an inferred type parameter.
	unindent`
		declare function wrap<T>(value: T, callback: (value: T) => void): void;
		wrap("a", (value: string) => {});
	`,
	// An object literal argument can leave out what infers `T`.
	unindent`
		declare function from<T>(source: { length: number; item?: T }): Array<T>;
		const items: Array<string> = from({ length: 2 });
	`,
	// An array literal argument can be empty.
	unindent`
		declare function first<T>(items: Array<T>): T;
		const value: string = first([]);
	`,
	// A function callback's `this` is inferred from the call.
	unindent`
		declare function map<U, This = undefined>(
			callback: (this: This, item: string) => U,
			thisArg?: This,
		): Array<U>;
		const lengths = map(function (item: string) {
			return item.length;
		});
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
	// A generic alias to a primitive is erased too.
	unindent`
		type Id<T> = string;
		declare function getString(): string;
		const id: Id<number> = getString();
	`,
	// An imported alias is erased the same way.
	unindent`
		import type { UserId } from "./no-redundant-type-annotation/aliases";
		declare function getString(): string;
		const id: UserId = getString();
	`,
	unindent`
		import type { UserId as Id } from "./no-redundant-type-annotation/aliases";
		declare function getString(): string;
		const id: Id = getString();
	`,
	unindent`
		import type { UserId } from "./no-redundant-type-annotation/aliases";
		declare function each(callback: (id: string) => void): void;
		each((id: UserId) => {});
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
	// The return type involves `T` even where no written name says so.
	unindent`
		function pick<T = number>(fallback: T = null!): typeof fallback {
			return fallback;
		}
		const value: string = pick();
	`,
	// An optional call infers the same way.
	unindent`
		declare const pick: (<T = number>() => T) | undefined;
		const value: string | undefined = pick?.();
	`,
	// `let` widens only a literal written in place, so a literal type read from
	// elsewhere stays narrow without the annotation.
	unindent`
		declare const a: "a";
		let value: string = a;
		value = "b";
	`,
	unindent`
		let value: number = 1 as 1;
		value = 2;
	`,
	// A union of fresh literals widens under `let` too.
	unindent`
		declare const choose: boolean;
		let value: 1 | 2 = choose ? 1 : 2;
	`,
	// A template expression is a template type only under the annotation.
	unindent`
		declare const n: number;
		const value: \`a\${number}\` = \`a\${n}\`;
	`,
	// A `unique symbol` widens to `symbol` without the annotation.
	unindent`
		declare const key: unique symbol;
		const alias: typeof key = key;
	`,
	// Without the annotation, a variable its initializer reads is implicitly
	// `any`.
	unindent`
		const count: () => number = () => count();
	`,
	unindent`
		const ping: () => number = () => pong();
		const pong: () => number = () => ping();
	`,
	// A class without a constructor still infers its type parameters on `new`.
	unindent`
		class Box<T> {
			value?: T;
		}
		const box: Box<string> = new Box();
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

	// --- function-valued variables ---

	// Other rules read the annotation as the function's signature (`func-style`
	// with `allowTypeAnnotation`, `explicit-function-return-type`).
	unindent`
		export function track(): void {
			let onClose: () => void = () => {};
			onClose = () => {
				console.log("closed");
			};
			onClose();
		}
	`,
	"const fn: () => number = () => 1;",
	"const fn: () => void = function () {};",
	unindent`
		declare function getNumber(): number;
		const fn: () => number = () => getNumber();
	`,

	// --- never annotations ---

	// An exhaustiveness check: it fails when a new case is added later.
	unindent`
		type Shape = { kind: "a" } | { kind: "b" };
		export function area(shape: Shape): number {
			switch (shape.kind) {
				case "a": return 1;
				case "b": return 2;
				default: {
					const unreachable: never = shape;
					throw new Error(String(unreachable));
				}
			}
		}
	`,
	unindent`
		declare function each(callback: (value: never) => void): void;
		each((value: never) => {
			void value;
		});
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
	// Any generic callee is left alone, even when the parameter it types names
	// no type parameter and the annotation really is redundant. Telling the two
	// apart by name is unsound: `typeof` and aliases hide a type parameter.
	unindent`
		declare function run<T>(items: Array<T>, fn: () => (s: string) => number): void;
		run([1], () => (s: string) => s.length);
	`,
	unindent`
		function run<T>(make: () => typeof source, source: () => T = null!): T {
			return source();
		}
		run(() => () => (s: string) => s);
	`,
	// An IIFE types an untyped parameter from its argument, so the argument's
	// context would come from itself.
	unindent`
		((cb) => cb)((s: string) => s);
	`,
	// Only a context the rule can prove stable counts. An assignment or a
	// delegating `yield*` passes one on too, but is not followed.
	unindent`
		let f: (s: string) => string = (s) => s;
		f = (s: string) => s;
	`,
	unindent`
		const make: () => Generator<(s: string) => string> = function* () {
			yield* [(s: string) => s];
		};
	`,
	// More than one signature means the arguments may pick one, even with type
	// arguments written out.
	unindent`
		declare function f<T>(fn: (value: T) => void): void;
		declare function f<T>(fn: (value: T) => void, extra: number): void;
		f<string>((value: string) => {});
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
	// A union of function types gives a contextual signature only when every
	// member agrees, so the annotation may be all the parameter has.
	unindent`
		declare function each(callback: ((value: string) => void) | ((value: string, index: number) => void)): void;
		each((value: string) => {});
	`,
	// A function that needs more arguments than the context passes gets no
	// contextual signature at all.
	unindent`
		declare function each(callback: (value: string) => void): void;
		each((value: string, index: number) => {});
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
	// A class member takes no parameter types from a context, not even from
	// an interface the class implements.
	unindent`
		interface Handler {
			handle(value: string): void;
		}
		class Impl implements Handler {
			handle(value: string): void {}
		}
	`,
	// The same holds for a class expression with a written context, and for a
	// constructor's parameter property.
	unindent`
		const Make: new (value: string) => { value: string; read(n: number): void } = class {
			constructor(public value: string) {}
			read(n: number): void {}
		};
	`,
	// The annotation gives a callback argument its context, so the verifier
	// keeps it.
	unindent`
		declare const items: Array<number>;
		const v1: Array<"a"> = items.map(() => "a");
	`,
	unindent`
		declare const items: Array<number>;
		const v2: Array<{ k: "a" }> = items.map(() => ({ k: "a" }));
	`,
	unindent`
		declare function wrap<F>(f: F): F;
		const h: (x: number) => number = wrap((x) => x);
	`,
	unindent`
		declare function make<T>(cb: (x: T) => void): T;
		const v3: string = make((x) => {});
	`,
	unindent`
		declare function pick<T>(cb: (x: T) => void): T;
		declare function pick(cb: (x: number) => void, n: number): number;
		const v4: string = pick((x) => {});
	`,
	"const p1: Promise<number> = new Promise((resolve) => resolve(1));",
	unindent`
		declare const items: Array<number>;
		declare function id<T>(x: T): T;
		const v5: Array<"a"> = id(items.map(() => "a"));
	`,
	unindent`
		declare function on2<E = string>(cb: (e: E) => void): E;
		const v6: number = on2((e) => {});
	`,
];

const invalid: Array<InvalidTestCase> = [
	// A generic alias with type arguments keeps its name in the inferred type.
	{
		code: unindent`
			declare function getReadonly(): Readonly<Record<string, number>>;
			const map: Readonly<Record<string, number>> = getReadonly();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getReadonly(): Readonly<Record<string, number>>;
			const map = getReadonly();
		`,
	},
	{
		code: unindent`
			declare function getRecord(): Record<string, number>;
			const record: Record<string, number> = getRecord();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getRecord(): Record<string, number>;
			const record = getRecord();
		`,
	},
	// Only a `const` aliases a condition, so a `let` narrows nothing.
	{
		code: unindent`
			declare const v: string | number;
			export function f(): boolean {
				let isText: boolean = typeof v === "string";
				return isText && v === 5;
			}
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const v: string | number;
			export function f(): boolean {
				let isText = typeof v === "string";
				return isText && v === 5;
			}
		`,
	},
	// A `const` that no condition reads narrows nothing.
	{
		code: unindent`
			declare const v: string | number;
			declare function log(value: boolean): void;
			export function f(): void {
				const isText: boolean = typeof v === "string";
				log(isText);
				v.toString();
			}
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const v: string | number;
			declare function log(value: boolean): void;
			export function f(): void {
				const isText = typeof v === "string";
				log(isText);
				v.toString();
			}
		`,
	},
	// An argument infers `T` before the context is consulted.
	{
		code: unindent`
			declare function first<T>(items: Array<T>): T;
			declare const items: Array<string>;
			const value: string = first(items);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function first<T>(items: Array<T>): T;
			declare const items: Array<string>;
			const value = first(items);
		`,
	},
	// The callback parameter names no type parameter of the call.
	{
		code: unindent`
			declare function attempt<R>(onError: (reason: unknown) => R): R;
			const result = attempt((reason: unknown) => String(reason));
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function attempt<R>(onError: (reason: unknown) => R): R;
			const result = attempt((reason) => String(reason));
		`,
	},
	// An arrow callback ignores an inferred `this`.
	{
		code: unindent`
			declare function map<U, This = undefined>(
				callback: (this: This, item: string) => U,
				thisArg?: This,
			): Array<U>;
			const lengths = map((item: string) => item.length);
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function map<U, This = undefined>(
				callback: (this: This, item: string) => U,
				thisArg?: This,
			): Array<U>;
			const lengths = map((item) => item.length);
		`,
	},
	{
		code: unindent`
			declare const items: ReadonlyArray<unknown>;
			declare const list: Array<string>;
			const flat = items.flatMap((item: unknown) => [item]);
			const flatList = list.flatMap((item: string) => [item]);
		`,
		errors: [{ messageId: parameterMessageId }, { messageId: parameterMessageId }],
		output: unindent`
			declare const items: ReadonlyArray<unknown>;
			declare const list: Array<string>;
			const flat = items.flatMap((item) => [item]);
			const flatList = list.flatMap((item) => [item]);
		`,
	},
	// An object literal method takes its context from the property it fills.
	{
		code: unindent`
			interface Handlers {
				format(text: string, width: number): string;
			}
			const handlers: Handlers = {
				format(text: string, width: number) {
					return text.padEnd(width);
				},
			};
		`,
		errors: [{ messageId: parameterMessageId }, { messageId: parameterMessageId }],
		output: unindent`
			interface Handlers {
				format(text: string, width: number): string;
			}
			const handlers: Handlers = {
				format(text, width) {
					return text.padEnd(width);
				},
			};
		`,
	},
	// An optional callback's `undefined` offers no signature of its own.
	{
		code: unindent`
			interface Options {
				onChange?: (value: string) => void;
			}
			declare function report(value: string): void;
			const options: Options = { onChange: (value: string) => report(value) };
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			interface Options {
				onChange?: (value: string) => void;
			}
			declare function report(value: string): void;
			const options: Options = { onChange: (value) => report(value) };
		`,
	},
	{
		code: unindent`
			interface Options {
				read?(value: string): void;
			}
			declare function report(value: string): void;
			const options: Options = {
				read(value: string) {
					report(value);
				},
			};
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			interface Options {
				read?(value: string): void;
			}
			declare function report(value: string): void;
			const options: Options = {
				read(value) {
					report(value);
				},
			};
		`,
	},
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

	// An untyped callback takes its parameters from the receiver, not from
	// the variable's annotation.
	{
		code: unindent`
			type Option = "a" | "b";
			declare const options: ReadonlyArray<{ value: Option }>;
			const values: Array<Option> = options.map(({ value }) => value);
		`,
		errors: [{ messageId }],
		output: unindent`
			type Option = "a" | "b";
			declare const options: ReadonlyArray<{ value: Option }>;
			const values = options.map(({ value }) => value);
		`,
	},

	{
		code: unindent`
			interface Item { name: string }
			declare const items: Array<Item>;
			const v: Array<string> = items.map((i) => { return i.name; });
		`,
		errors: [{ messageId }],
		output: unindent`
			interface Item { name: string }
			declare const items: Array<Item>;
			const v = items.map((i) => { return i.name; });
		`,
	},
	{
		code: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			const v: Array<"a" | "b"> = items.map((i) => (i.ok ? "a" : "b"));
		`,
		errors: [{ messageId }],
		output: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			const v = items.map((i) => (i.ok ? "a" : "b"));
		`,
	},
	{
		code: unindent`
			interface Item { name: string }
			declare const items: Array<Item>;
			const s: Set<string> = new Set(items.map((i) => i.name));
		`,
		errors: [{ messageId }],
		output: unindent`
			interface Item { name: string }
			declare const items: Array<Item>;
			const s = new Set(items.map((i) => i.name));
		`,
	},
	{
		code: unindent`
			declare function run(cb: (x: number) => string): string;
			const s: string = run((x) => String(x));
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function run(cb: (x: number) => string): string;
			const s = run((x) => String(x));
		`,
	},
	{
		code: unindent`
			declare function on(cb: (x: string) => void): 1;
			declare function on(cb: (x: number) => void, n: number): 2;
			const v: 1 = on((x) => {});
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function on(cb: (x: string) => void): 1;
			declare function on(cb: (x: number) => void, n: number): 2;
			const v = on((x) => {});
		`,
	},
	// A generic or overloaded call can take the callback's context from the
	// annotation, so these are reported only when the removal is verified.
	{
		code: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			const f: Array<Item> = items.filter((i) => i.ok);
		`,
		errors: [{ messageId }],
		output: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			const f = items.filter((i) => i.ok);
		`,
	},
	{
		code: unindent`
			declare const nums: Array<number>;
			const total: number = nums.reduce((a, b) => a + b, 0);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const nums: Array<number>;
			const total = nums.reduce((a, b) => a + b, 0);
		`,
	},
	{
		code: unindent`
			declare function pipe<T>(x: T, f: (v: T) => T): T;
			const r: number = pipe(1, (v) => v);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function pipe<T>(x: T, f: (v: T) => T): T;
			const r = pipe(1, (v) => v);
		`,
	},

	// Past the verification work limit, a removal is not verified. It is
	// reported without a fix, and the next fix pass verifies and removes it.
	// A variable that needs proof is verified first, so other candidates do
	// not hide it.
	...[
		{
			code: "const last: Array<Item> = items.filter((item) => item.ok);",
			errors: 11,
			fixed: "const last = items.filter((item) => item.ok);",
		},
		{
			code: "const last: Array<string> = items.map((item) => item.name);",
			errors: 11,
			fixed: "const last = items.map((item) => item.name);",
		},
		// A sequence hands its context to its last expression, so this
		// callback also takes its context from the annotation. The removal
		// changes the type, so it is not reported.
		{
			code: 'const last: Array<"a"> = items.map((0, (item) => "a"));',
			errors: 10,
			fixed: 'const last: Array<"a"> = items.map((0, (item) => "a"));',
		},
		// A callback without untyped parameters can still take the type of
		// its returned value from the annotation. These removals change the
		// type, so they are not reported.
		...[
			'const last: Array<"a"> = items.map(() => "a");',
			'const last: Array<{ k: "a" }> = items.map(() => ({ k: "a" }));',
			'const last: Array<["a"]> = items.map(() => ["a"]);',
			// A sequence or a conditional hands the context on to the callback.
			'const last: Array<"a"> = items.map((0, () => "a"));',
			'const last: Array<"a" | "b"> = items.map(read() > 0 ? () => "a" : () => "b");',
			'const last: Array<"a"> = items.map((0, (item: Item) => "a"));',
			// A tagged template hands a substitution the context of a parameter.
			...["() =>", "(x) =>"].map((callback) => {
				return [
					"declare function tag<T>(s: TemplateStringsArray, cb: (x: number) => T): Array<T>;",
					`const last: Array<"a"> = tag\`\${${callback} "a"}\`;`,
				].join(" ");
			}),
		].map((code) => {
			return { code, errors: 10, fixed: code };
		}),
	].map(({ code, errors, fixed }) => {
		const prefix = unindent`
			interface Item { name: string; ok: boolean }
			declare const items: Array<Item>;
			declare function read(): number;
		`;
		const reads = Array.from({ length: 10 }, (_, index) => `const n${index}`);
		return {
			code: [prefix, ...reads.map((name) => `${name}: number = read();`), code].join("\n"),
			errors: Array.from({ length: errors }, () => ({ messageId })),
			output: [prefix, ...reads.map((name) => `${name} = read();`), fixed].join("\n"),
		};
	}),

	// Past the work limit, a variable that needs proof is not verified, so it
	// is not reported. The next fix pass verifies it.
	{
		code: [
			"interface Item { ok: boolean }",
			"declare const items: Array<Item>;",
			...Array.from({ length: 11 }, (_, index) => {
				return `const kept${index}: Array<Item> = items.filter((item) => item.ok);`;
			}),
		].join("\n"),
		errors: Array.from({ length: 10 }, () => ({ messageId })),
		output: [
			"interface Item { ok: boolean }",
			"declare const items: Array<Item>;",
			...Array.from({ length: 11 }, (_, index) => {
				return `const kept${index} = items.filter((item) => item.ok);`;
			}),
		].join("\n"),
	},

	// Each removal of a pair is safe alone, but not together, so the pairs
	// use all the programs of the combined check. A variable that needs
	// proof is reported when its removal alone is safe, so it is still
	// reported, without a fix. This holds also for two such variables that
	// are coupled.
	...[
		{
			errors: [3, 6, 12, 18, 24],
			kept: ["const kept: Array<Item> = items.filter((item) => item.ok);"],
		},
		{
			errors: [3, 4, 7, 13, 19, 25],
			kept: [
				"const kept: Array<Item> = items.filter((item) => item.ok);",
				"const more: Array<Item> = kept.filter((item) => item.ok);",
			],
		},
	].map(({ errors, kept }) => {
		return {
			code: [
				"interface Item { ok: boolean }",
				"declare const items: Array<Item>;",
				...kept,
				...Array.from({ length: 4 }, (_, index) => {
					return [
						`function narrow${index}(v: string | number) {`,
						`const ok${index}: boolean = typeof v === "string";`,
						`const same${index}: boolean = ok${index};`,
						`if (!same${index}) return "none";`,
						"return v;",
						"}",
					];
				}).flat(),
			].join("\n"),
			errors: errors.map((line) => ({ line, messageId })),
			output: null,
		};
	}),

	// The removal of isNum narrows v in its block, which the narrowing of ok
	// also observes. The two are coupled, so the problem of isNum does not
	// reject ok.
	{
		code: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			declare const v: string | number;
			const ok: boolean = typeof v === "string" && items.reduce((a, i) => a && i.ok, true);
			if (ok) {}
			const isNum: boolean = typeof v === "number";
			if (isNum) { console.log(v); }
		`,
		errors: [{ line: 4, messageId }],
		output: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			declare const v: string | number;
			const ok = typeof v === "string" && items.reduce((a, i) => a && i.ok, true);
			if (ok) {}
			const isNum: boolean = typeof v === "number";
			if (isNum) { console.log(v); }
		`,
	},
	// Each removal alone is safe, but not both: without both annotations, same
	// narrows v. The fix of same is verified. ok, which needs proof, is safe
	// alone, so it is reported without a fix.
	{
		code: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			export function narrow(v: string | number) {
				const ok: boolean = typeof v === "string" && items.reduce((a, i) => a && i.ok, true);
				const same: boolean = ok;
				if (!same) return "none";
				return v;
			}
		`,
		errors: [
			{ line: 4, messageId },
			{ line: 5, messageId },
		],
		output: unindent`
			interface Item { ok: boolean }
			declare const items: Array<Item>;
			export function narrow(v: string | number) {
				const ok: boolean = typeof v === "string" && items.reduce((a, i) => a && i.ok, true);
				const same = ok;
				if (!same) return "none";
				return v;
			}
		`,
	},

	// The removal of q widens w, which is not a candidate, so the static
	// coupling does not see that p reads it. The combined check gives the
	// problem of q to p. p is then checked alone, and its removal alone is
	// safe, so it is reported without a fix.
	{
		code: unindent`
			declare function use(...values: Array<unknown>): void;
			const q: "a" = "a";
			let w = q;
			const p: Array<"a"> = [w].filter((x) => x.length > 0);
			use(p, w);
			export {};
		`,
		errors: [{ line: 4, messageId }],
		output: null,
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
	// Wherever the variable's annotation reaches the parameter, only the
	// parameter is reported: removing both in one pass would leave it
	// implicitly `any`.
	{
		code: unindent`
			declare function side(): void;
			const f: (x: number) => number = (side(), (x: number) => x);
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function side(): void;
			const f: (x: number) => number = (side(), (x) => x);
		`,
	},
	{
		code: unindent`
			const f: (x: number) => number = ((x: number) => x)!;
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			const f: (x: number) => number = ((x) => x)!;
		`,
	},
	{
		code: unindent`
			const f: (x: number) => number = ((x: number) => x) as const;
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			const f: (x: number) => number = ((x) => x) as const;
		`,
	},
	{
		code: unindent`
			const f: () => (x: number) => number = () => (x: number) => x;
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			const f: () => (x: number) => number = () => (x) => x;
		`,
	},
	// An outer parameter's annotation that types an annotated default value
	// waits for the next pass, once the default no longer depends on it.
	{
		code: unindent`
			const g: (cb: (s: string) => string) => void = (cb: (s: string) => string = (s: string) => s) => {};
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			const g: (cb: (s: string) => string) => void = (cb = (s) => s) => {};
		`,
	},
	// A function an IIFE returns has no proven context, so only the variable
	// is reported.
	{
		code: unindent`
			const f: (x: number) => number = (() => (x: number) => x)();
		`,
		errors: [{ messageId }],
		output: unindent`
			const f = (() => (x: number) => x)();
		`,
	},
	// An IIFE whose parameter is annotated fixes its argument's context.
	{
		code: unindent`
			((cb: (s: string) => string) => cb)((s: string) => s);
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			((cb: (s: string) => string) => cb)((s) => s);
		`,
	},
	// A `super` call passes its arguments to the base constructor.
	{
		code: unindent`
			class Base {
				constructor(fn: (s: string) => void) {}
			}
			class Derived extends Base {
				constructor() {
					super((s: string) => {});
				}
			}
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			class Base {
				constructor(fn: (s: string) => void) {}
			}
			class Derived extends Base {
				constructor() {
					super((s) => {});
				}
			}
		`,
	},
	// A written return type is the returned function's context.
	{
		code: unindent`
			function make(): (s: string) => string {
				return (s: string) => s;
			}
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			function make(): (s: string) => string {
				return (s) => s;
			}
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
	// The fix keeps a comment inside the annotation.
	{
		code: unindent`
			declare function getS(): string;
			const x: /* keep me */ string = getS();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getS(): string;
			const x /* keep me */ = getS();
		`,
	},
	// A line comment still ends before the code after it.
	{
		code: unindent`
			declare function getS(): string;
			const x: // keep me
				string = getS();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getS(): string;
			const x // keep me
			 = getS();
		`,
	},
	// The line comment keeps the line break of the source.
	{
		code: "declare function getS(): string;\r\nconst x: // keep me\r\n\tstring = getS();\r\n",
		errors: [{ messageId }],
		output: "declare function getS(): string;\r\nconst x // keep me\r\n = getS();\r\n",
	},
	// A comment in the type itself is kept too.
	{
		code: unindent`
			declare function getS(): Array<string>;
			const x: Array</* keep me */ string> = getS();
		`,
		errors: [{ messageId }],
		output: unindent`
			declare function getS(): Array<string>;
			const x /* keep me */ = getS();
		`,
	},
	{
		code: unindent`
			declare function attempt<R>(onError: (reason: unknown) => R): R;
			const result = attempt((reason: /* keep me */ unknown) => String(reason));
		`,
		errors: [{ messageId: parameterMessageId }],
		output: unindent`
			declare function attempt<R>(onError: (reason: unknown) => R): R;
			const result = attempt((reason /* keep me */) => String(reason));
		`,
	},
	{
		code: unindent`
			try {
			} catch (error: /* keep me */ unknown) {}
		`,
		errors: [{ messageId: catchMessageId }],
		output: unindent`
			try {
			} catch (error /* keep me */) {}
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

const jsxInvalid: Array<InvalidTestCase> = [
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
	{
		// An intrinsic element's props are a fixed entry, with nothing to infer.
		code: unindent`
			declare global {
				namespace JSX {
					interface Element {}
					interface IntrinsicElements {
						button: { onClick: (event: { x: number }) => void };
					}
				}
			}
			<button onClick={(event: { x: number }) => {}} />;
		`,
		errors: [{ messageId: parameterMessageId }],
		filename: jsxFilename,
		output: unindent`
			declare global {
				namespace JSX {
					interface Element {}
					interface IntrinsicElements {
						button: { onClick: (event: { x: number }) => void };
					}
				}
			}
			<button onClick={(event) => {}} />;
		`,
	},
];

run({
	name: `${RULE_NAME}/jsx`,
	invalid: jsxInvalid,
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

const looseNullInvalid: Array<InvalidTestCase> = [
	{
		// A returned value that is not `null` does not widen.
		code: unindent`
			declare function getNumber(): number;
			declare const choose: boolean;
			const fn: () => number = choose ? () => getNumber() : () => 0;
		`,
		errors: [{ messageId }],
		filename: path.join(looseNullDirectory, "case.ts"),
		output: unindent`
			declare function getNumber(): number;
			declare const choose: boolean;
			const fn = choose ? () => getNumber() : () => 0;
		`,
	},
];

run({
	name: `${RULE_NAME}/loose-null`,
	invalid: looseNullInvalid,
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

const isolatedDeclarationsInvalid: Array<InvalidTestCase> = [
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
	{
		// A type assertion is what the emitter reads, so the parameter's
		// annotation is not needed there.
		code: unindent`
			export const handler = ((value: string) => value) as (value: string) => string;
		`,
		errors: [{ messageId: parameterMessageId }],
		filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		output: unindent`
			export const handler = ((value) => value) as (value: string) => string;
		`,
	},
	{
		// A function that stays inside the module is out of the option's
		// reach.
		code: unindent`
			const kinds = new Set<string>();
			function getKinds(): Set<string> {
				return kinds;
			}
			export function use(): void {
				getKinds();
			}
		`,
		errors: [{ messageId: "redundantReturn" }],
		filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		options: [{ checkReturnTypes: true }],
		output: unindent`
			const kinds = new Set<string>();
			function getKinds() {
				return kinds;
			}
			export function use(): void {
				getKinds();
			}
		`,
	},
	{
		// The emitter does not print a top-level call, so the read does not
		// need the annotation.
		code: unindent`
			interface Config { a: number }
			declare function load(): Config;
			declare function start(c: Config): void;
			const config: Config = load();
			start(config);
			export {};
		`,
		errors: [{ messageId }],
		filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		output: unindent`
			interface Config { a: number }
			declare function load(): Config;
			declare function start(c: Config): void;
			const config = load();
			start(config);
			export {};
		`,
	},
	{
		// A type assertion is what the emitter reads, not the variable.
		code: unindent`
			interface Config { a: number }
			declare function load(): Config;
			const c: Config = load();
			export const x = c as Config;
		`,
		errors: [{ messageId }],
		filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		output: unindent`
			interface Config { a: number }
			declare function load(): Config;
			const c = load();
			export const x = c as Config;
		`,
	},
	{
		// The emitter does not print a `typeof` inside a function body.
		code: unindent`
			interface Config { a: number }
			declare function load(): Config;
			const c: Config = load();
			export function f(): void {
				let y: typeof c | undefined;
				void y;
			}
		`,
		errors: [{ messageId }],
		filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		output: unindent`
			interface Config { a: number }
			declare function load(): Config;
			const c = load();
			export function f(): void {
				let y: typeof c | undefined;
				void y;
			}
		`,
	},
	{
		// A namespace member the namespace does not export stays inside it.
		code: unindent`
			interface Config { a: number }
			declare function load(): Config;
			export namespace N {
				const c: Config = load();
				export function f(): void {
					void c;
				}
			}
		`,
		errors: [{ messageId }],
		filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		output: unindent`
			interface Config { a: number }
			declare function load(): Config;
			export namespace N {
				const c = load();
				export function f(): void {
					void c;
				}
			}
		`,
	},
	{
		// A block-scoped variable in a script is not global.
		code: unindent`
			declare function n(): number;
			{
				const x: number = n();
			}
		`,
		errors: [{ messageId }],
		filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		output: unindent`
			declare function n(): number;
			{
				const x = n();
			}
		`,
	},
	...[
		{
			// A top-level call of the arrow function is not printed.
			code: unindent`
				const kinds = new Set<string>();
				const g = (): Set<string> => kinds;
				g();
				export {};
			`,
			output: unindent`
				const kinds = new Set<string>();
				const g = () => kinds;
				g();
				export {};
			`,
		},
		{
			// Nor is a `new` of the class.
			code: unindent`
				const kinds = new Set<string>();
				class K {
					m(): Set<string> {
						return kinds;
					}
				}
				new K();
				export {};
			`,
			output: unindent`
				const kinds = new Set<string>();
				class K {
					m() {
						return kinds;
					}
				}
				new K();
				export {};
			`,
		},
		{
			// A parameter's `typeof` reads the parameter, not the function.
			code: unindent`
				const kinds = new Set<string>();
				function fn(a: number, b: typeof a): Set<string> {
					void b;
					return kinds;
				}
				fn(1, 2);
				export {};
			`,
			output: unindent`
				const kinds = new Set<string>();
				function fn(a: number, b: typeof a) {
					void b;
					return kinds;
				}
				fn(1, 2);
				export {};
			`,
		},
		{
			// The emitter prints nothing inside a static block.
			code: unindent`
				const kinds = new Set<string>();
				export class C {
					static {
						const K = class {
							m(): Set<string> {
								return kinds;
							}
						};
						void K;
					}
				}
			`,
			output: unindent`
				const kinds = new Set<string>();
				export class C {
					static {
						const K = class {
							m() {
								return kinds;
							}
						};
						void K;
					}
				}
			`,
		},
	].map(({ code, output }): InvalidTestCase => {
		return {
			code,
			errors: [{ messageId: "redundantReturn" }],
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
			options: [{ checkReturnTypes: true }],
			output,
		};
	}),
];

run({
	name: `${RULE_NAME}/isolated-declarations`,
	invalid: isolatedDeclarationsInvalid,
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
			// The emitter still reads a variable an exported declaration
			// mentions.
			code: unindent`
				declare function getDate(): Date;
				const value: Date = getDate();
				export default value;
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
		{
			// `satisfies` leaves the emitter to type the object from its syntax,
			// so the parameter must keep its annotation: the fix gives TS9011.
			code: unindent`
				export const handlers = { f: (s: string) => s } satisfies Record<string, (s: string) => string>;
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
		{
			code: unindent`
				export default { f: (s: string) => s } satisfies Record<string, (s: string) => string>;
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
		{
			code: unindent`
				const handlers = { f: (s: string) => s } satisfies Record<string, (s: string) => string>;
				export { handlers };
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
		{
			code: unindent`
				export class Handlers {
					f = { g: (s: string) => s } satisfies Record<string, (s: string) => string>;
				}
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
		{
			// A script has no exports: its top-level declarations are global,
			// and the emitter prints all of them.
			code: unindent`
				declare function n(): number;
				let x: number = n();
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
		},
		{
			code: unindent`
				declare const kinds: Set<string>;
				function fn(): Set<string> {
					return kinds;
				}
			`,
			filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
			options: [{ checkReturnTypes: true }],
		},
		// The emitter prints these reads, so the variable keeps its
		// annotation (TS9010 or TS9020 without it).
		...[
			unindent`
				interface Config { a: number }
				declare function load(): Config;
				const c: Config = load();
				export type T = typeof c;
			`,
			unindent`
				interface Config { a: number }
				declare function load(): Config;
				const c: Config = load();
				export type T = typeof c.a;
			`,
			unindent`
				interface Config { a: number }
				declare function load(): Config;
				const c: Config = load();
				export function f(x: typeof c): void {
					void x;
				}
			`,
			unindent`
				interface Config { a: number }
				declare function load(): Config;
				const c: Config = load();
				declare global {
					var g: typeof c;
				}
				export {};
			`,
			unindent`
				declare function key(): "k";
				const c: "k" = key();
				export interface I {
					[c]: number;
				}
			`,
			unindent`
				declare function key(): "k";
				const c: "k" = key();
				export type I = { [c]: number };
			`,
			unindent`
				interface Config { a: number }
				declare function load(): Config;
				const c: Config = load();
				export = c;
			`,
			unindent`
				declare function n(): number;
				const c: number = n();
				export enum E {
					A = c + 1,
				}
			`,
			unindent`
				declare class Base0 {
					a: number;
				}
				declare function mk(): typeof Base0;
				const B: typeof Base0 = mk();
				export class D extends B {}
			`,
		].map((code) => {
			return { code, filename: path.join(isolatedDeclarationsDirectory, "case.ts") };
		}),
		// The emitter reads a function or class that an emitted
		// declaration names (TS9007, TS9008).
		...[
			unindent`
				const kinds = new Set<string>();
				function fn(): Set<string> {
					return kinds;
				}
				export type T = typeof fn;
			`,
			unindent`
				const kinds = new Set<string>();
				function fn(): Set<string> {
					return kinds;
				}
				export default fn;
			`,
			unindent`
				const kinds = new Set<string>();
				class K {
					m(): Set<string> {
						return kinds;
					}
				}
				export class D extends K {}
			`,
			unindent`
				const kinds = new Set<string>();
				class K {
					m(): Set<string> {
						return kinds;
					}
				}
				export declare function make(): K;
			`,
			unindent`
				const kinds = new Set<string>();
				class K {
					m(): Set<string> {
						return kinds;
					}
				}
				export interface I extends K {}
			`,
		].map((code) => {
			return {
				code,
				filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
				options: [{ checkReturnTypes: true }],
			};
		}),
		// The emitter reads an exported function's return type (TS9007).
		...[
			unindent`
				const kinds = new Set<string>();
				export function getKinds(): Set<string> {
					return kinds;
				}
			`,
			unindent`
				const kinds = new Set<string>();
				function getKinds(): Set<string> {
					return kinds;
				}
				export { getKinds };
			`,
			unindent`
				const kinds = new Set<string>();
				export const getKinds = (): Set<string> => kinds;
			`,
			unindent`
				const kinds = new Set<string>();
				export class Store {
					read(): Set<string> {
						return kinds;
					}
				}
			`,
			unindent`
				const kinds = new Set<string>();
				export const store = { read: (): Set<string> => kinds };
			`,
		].map((code) => {
			return {
				code,
				filename: path.join(isolatedDeclarationsDirectory, "case.ts"),
				options: [{ checkReturnTypes: true }],
			};
		}),
	],
});

// Return types are checked only when an option asks for them, since
// `explicit-function-return-type` may require the same annotations.
const returnMessageId = "redundantReturn";
const checkAll = [{ checkReturnTypes: true }];
const checkExpressions = [{ allowExpressions: true }];

const returnInvalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			declare const cond: boolean;
			const kinds = new Set<string>();
			const classify = (): Set<string> | null => (cond ? kinds : null);
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			declare const cond: boolean;
			const kinds = new Set<string>();
			const classify = () => (cond ? kinds : null);
		`,
	},
	{
		code: unindent`
			const kinds = new Set<string>();
			function getKinds(): Set<string> {
				return kinds;
			}
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			const kinds = new Set<string>();
			function getKinds() {
				return kinds;
			}
		`,
	},
	{
		// A union of literals does not widen.
		code: unindent`
			declare const cond: boolean;
			function pick(): "a" | "b" {
				return cond ? "a" : "b";
			}
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			declare const cond: boolean;
			function pick() {
				return cond ? "a" : "b";
			}
		`,
	},
	{
		code: unindent`
			declare const cond: boolean;
			function pick(): "a" | "b" {
				if (cond) {
					return "a";
				}

				return "b";
			}
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			declare const cond: boolean;
			function pick() {
				if (cond) {
					return "a";
				}

				return "b";
			}
		`,
	},
	{
		// A single literal widens to the annotated base type.
		code: "const count = (): number => 1;",
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: "const count = () => 1;",
	},
	{
		// A body that returns no value infers `void`.
		code: unindent`
			declare function log(): void;
			function run(): void {
				log();
			}
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			declare function log(): void;
			function run() {
				log();
			}
		`,
	},
	{
		code: unindent`
			const kinds = new Set<string>();
			async function load(): Promise<Set<string>> {
				return kinds;
			}
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			const kinds = new Set<string>();
			async function load() {
				return kinds;
			}
		`,
	},
	{
		code: unindent`
			const kinds = new Set<string>();
			class Store {
				read(): Set<string> {
					return kinds;
				}
			}
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			const kinds = new Set<string>();
			class Store {
				read() {
					return kinds;
				}
			}
		`,
	},
	{
		// `allowExpressions` checks a callback.
		code: unindent`
			declare const items: Array<{ name: string }>;
			const names = items.map((item): string => item.name);
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkExpressions,
		output: unindent`
			declare const items: Array<{ name: string }>;
			const names = items.map((item) => item.name);
		`,
	},
	{
		// An object property value is an expression to `allowExpressions`.
		code: unindent`
			const kinds = new Set<string>();
			const store = { read: (): Set<string> => kinds };
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkExpressions,
		output: unindent`
			const kinds = new Set<string>();
			const store = { read: () => kinds };
		`,
	},
	// The fix keeps a comment inside the annotation.
	{
		code: unindent`
			const kinds = new Set<string>();
			const getKinds = (): /* keep me */ Set<string> => kinds;
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			const kinds = new Set<string>();
			const getKinds = () /* keep me */ => kinds;
		`,
	},
	// A line break before `=>` is a syntax error, so a line comment moves
	// after the arrow.
	{
		code: unindent`
			const kinds = new Set<string>();
			const getKinds = (): // keep me
				Set<string> => kinds;
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			const kinds = new Set<string>();
			const getKinds = () => // keep me
			 kinds;
		`,
	},
	// A block comment with a line break moves after the arrow too.
	{
		code: unindent`
			const kinds = new Set<string>();
			const getKinds = (): /* keep
				me */ Set<string> => kinds;
		`,
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: unindent`
			const kinds = new Set<string>();
			const getKinds = () => /* keep
				me */ kinds;
		`,
	},
	// A kept line comment ends with the line break of the source.
	{
		code: "const kinds = new Set<string>();\r\nconst getKinds = (): // keep me\r\n\tSet<string> => kinds;\r\n",
		errors: [{ messageId: returnMessageId }],
		options: checkAll,
		output: "const kinds = new Set<string>();\r\nconst getKinds = () => // keep me\r\n kinds;\r\n",
	},
];

const returnValid: Array<ValidTestCase> = [
	// An imported alias to a primitive is erased, so the name must stay.
	{
		code: unindent`
			import type { UserId } from "./no-redundant-type-annotation/aliases";
			declare function getString(): string;
			function read(): UserId {
				return getString();
			}
		`,
		options: checkAll,
	},
	// Return types are not checked by default.
	unindent`
		const kinds = new Set<string>();
		function getKinds(): Set<string> {
			return kinds;
		}
	`,
	...[
		// Without the annotation the function has no type to start from (TS7023).
		"const visit = (n: number): boolean => (n > 0 ? visit(n - 1) : true);",
		// Either could go, but not both (TS7023). The rule keeps both.
		unindent`
			const isEven = (n: number): boolean => n == 0 || isOdd(n - 1);
			const isOdd = (n: number): boolean => n != 0 && isEven(n - 1);
		`,
		// A literal widens to `string`.
		"const lit = (): 'a' => 'a';",
		// Without the annotation, `Set<unknown>`.
		"const empty = (): Set<string> => new Set();",
		// Without the annotation, `{ kind: string }`.
		"const obj = (): { kind: 'a' } => ({ kind: 'a' });",
		// A body with no value infers `void`, not `undefined`.
		"const none = (): undefined => {};",
		unindent`
			function* items(): Generator<number> {
				yield 1;
			}
		`,
		"function isString(value: unknown): value is string { return typeof value === 'string'; }",
		unindent`
			function assertString(value: unknown): asserts value is string {
				if (typeof value !== "string") {
					throw new Error("not a string");
				}
			}
		`,
		unindent`
			function parse(text: string): string;
			function parse(text: string): string {
				return text;
			}
		`,
		unindent`
			class Box {
				get value(): string {
					return "a";
				}
			}
		`,
		unindent`
			declare function getUnknown(): any;
			function read(): any {
				return getUnknown();
			}
		`,
		unindent`
			function fail(): never {
				throw new Error("fail");
			}
		`,
		// The end of the body may be reached, so `undefined` may join.
		unindent`
			declare const cond: boolean;
			function maybe(): number | undefined {
				if (cond) {
					return 1;
				}
			}
		`,
		// The alias name is kept.
		unindent`
			type Point = { x: number; y: number };
			declare function makePoint(): { x: number; y: number };
			function origin(): Point {
				return makePoint();
			}
		`,
		// Inference builds the union again, without the alias name.
		unindent`
			type Kind = "file" | "directory";
			declare const cond: boolean;
			function classify(): Kind {
				if (cond) {
					return "file";
				}

				return "directory";
			}
		`,
		// Without the annotation, TypeScript 5.5 infers a type predicate.
		unindent`
			type Node = { type: "local" } | { type: "call" };
			function isLocal(node: Node): boolean {
				return node.type === "local";
			}
		`,
		// A function expression that cannot end infers `never`.
		unindent`
			declare function exit(): never;
			declare function onDone(callback: () => void): void;
			onDone((): void => {
				exit();
			});
		`,
		// A method that calls itself through `this`.
		unindent`
			class Counter {
				count(n: number): number {
					return n > 0 ? this.count(n - 1) : 0;
				}
			}
		`,
	].map((code) => ({ code, options: checkAll })),
	// `allowExpressions` leaves the return types that
	// `explicit-function-return-type` requires.
	...[
		unindent`
			const kinds = new Set<string>();
			function getKinds(): Set<string> {
				return kinds;
			}
		`,
		unindent`
			const kinds = new Set<string>();
			const getKinds = (): Set<string> => kinds;
		`,
		unindent`
			const kinds = new Set<string>();
			class Store {
				read(): Set<string> {
					return kinds;
				}
			}
		`,
	].map((code) => ({ code, options: checkExpressions })),
];

run({
	name: `${RULE_NAME}/return-types`,
	invalid: returnInvalid,
	rule: noRedundantTypeAnnotation,
	valid: returnValid,
});

// Under `isolatedDeclarations` the emit guards keep a class field's and an
// export default's return types before `allowExpressions` is read. The
// `loose-null` fixture turns it off, so these cases test the option alone.
const fieldReturn = unindent`
	const kinds = new Set<string>();
	export class Store {
		field = (): Set<string> => kinds;
	}
`;
const exportDefaultReturn = unindent`
	const kinds = new Set<string>();
	export default (): Set<string> => kinds;
`;

const looseNullReturnInvalid: Array<InvalidTestCase> = [
	{
		code: fieldReturn,
		errors: [{ messageId: returnMessageId }],
		filename: path.join(looseNullDirectory, "case.ts"),
		options: checkAll,
		output: fieldReturn.replace("(): Set<string>", "()"),
	},
	{
		code: exportDefaultReturn,
		errors: [{ messageId: returnMessageId }],
		filename: path.join(looseNullDirectory, "case.ts"),
		options: checkAll,
		output: exportDefaultReturn.replace("(): Set<string>", "()"),
	},
];

run({
	name: `${RULE_NAME}/loose-null-return-types`,
	invalid: looseNullReturnInvalid,
	parserOptions: {
		ecmaVersion: "latest",
		project: path.join(looseNullDirectory, "tsconfig.json"),
		sourceType: "module",
		tsconfigRootDir: looseNullDirectory,
	},
	rule: noRedundantTypeAnnotation,
	valid: [
		{
			// A class field declares the function, so it keeps its return type.
			code: fieldReturn,
			filename: path.join(looseNullDirectory, "case.ts"),
			options: checkExpressions,
		},
		{
			// An export default declares the function too.
			code: exportDefaultReturn,
			filename: path.join(looseNullDirectory, "case.ts"),
			options: checkExpressions,
		},
	],
});

// The fix-safety oracle checks what every report above promises: type-check
// the source and the fixed output with the case's own project, and require no
// new diagnostic and no changed type. See `./fix-safety.ts`.
const fixturesDirectory = path.resolve(__dirname, "../../../fixtures");

const declarationsDirectory = path.join(
	fixturesDirectory,
	"no-redundant-type-annotation/declarations",
);
const declarationSource = `
import type { Box, ReadonlyData } from "./component";
import { register } from "./component";
export const value: Box<ReadonlyData<undefined | string>> = register<undefined | string>();
`;

run({
	name: `${RULE_NAME}/declarations`,
	invalid: [
		{
			code: "declare function getDate(): Date; export const value: Date = getDate();",
			errors: [{ messageId }],
			filename: path.join(declarationsDirectory, "case.ts"),
			output: "declare function getDate(): Date; export const value = getDate();",
		},
	],
	parserOptions: {
		project: path.join(declarationsDirectory, "tsconfig.json"),
		tsconfigRootDir: declarationsDirectory,
	},
	rule: noRedundantTypeAnnotation,
	valid: [
		{ code: declarationSource, filename: path.join(declarationsDirectory, "case.ts") },
		{
			code: `${declarationSource.replace(
				"export const value",
				"const value",
			)}export { value };`,
			filename: path.join(declarationsDirectory, "case.ts"),
		},
		{
			// A local symbol with the same spelling cannot name the library's
			// tag.
			code: declarationSource.replace(
				"export const value",
				"declare const tag: unique symbol;\nexport const value",
			),
			filename: path.join(declarationsDirectory, "case.ts"),
		},
	],
});

/**
 * Pairs each invalid case with its fixed output and the file it runs as.
 *
 * @param cases - The invalid cases.
 * @param defaultFilename - The file a case without its own runs as.
 * @returns The cases the oracle can check.
 */
function toFixedSnippets(
	cases: ReadonlyArray<InvalidTestCase>,
	defaultFilename: string,
): Array<FixedSnippet> {
	return cases.flatMap((testCase) => {
		if (typeof testCase === "string" || typeof testCase.output !== "string") {
			return [];
		}

		const filename = path.resolve(fixturesDirectory, testCase.filename ?? defaultFilename);
		return [{ code: testCase.code, filename, output: testCase.output }];
	});
}

describe(`${RULE_NAME}/fix-safety`, () => {
	it("detects the declaration error hidden by an annotated alias", () => {
		const failures = checkFixes([
			{
				code: declarationSource,
				filename: path.join(declarationsDirectory, "case.ts"),
				output: declarationSource.replace(": Box<ReadonlyData<undefined | string>>", ""),
			},
		]);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("new TS4023");
	});

	it("keeps every type an invalid case's fix touches", () => {
		expect.hasAssertions();

		const failures = checkFixes([
			...toFixedSnippets(invalid, "file.ts"),
			...toFixedSnippets(jsxInvalid, jsxFilename),
			...toFixedSnippets(looseNullInvalid, "file.ts"),
			...toFixedSnippets(looseNullReturnInvalid, "file.ts"),
			...toFixedSnippets(isolatedDeclarationsInvalid, "file.ts"),
			...toFixedSnippets(returnInvalid, "file.ts"),
		]);

		expect(failures).toStrictEqual([]);
	});

	// The corpus makes no claim about what is reported, only that whatever is
	// fixed keeps every type, under each project the rule reads options from.
	// Full compiler checks over the corpus can exceed the default timeout on CI.
	it.each([
		["strict", fixturesDirectory],
		["isolated-declarations", isolatedDeclarationsDirectory],
		["loose-catch", looseCatchDirectory],
	])(
		"keeps every type the corpus fix touches under %s",
		(_, directory) => {
			expect.hasAssertions();

			const failures = checkRuleFixes(
				noRedundantTypeAnnotation,
				corpus.map(({ name, code, tsx }) => {
					return {
						name,
						code,
						filename: path.join(directory, tsx === true ? "case.tsx" : "case.ts"),
					};
				}),
			);

			expect(failures).toStrictEqual([]);
		},
		30_000,
	);
});
