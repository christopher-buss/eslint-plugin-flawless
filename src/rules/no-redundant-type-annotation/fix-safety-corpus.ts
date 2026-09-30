import { unindent } from "eslint-vitest-rule-tester";

/** A snippet the fix-safety oracle lints and fixes, with no expectation on what is reported. */
export interface CorpusCase {
	readonly name: string;
	readonly code: string;
	readonly tsx?: boolean;
}

// Shapes that have broken the rule's fix, or came close: generic inference
// through callbacks and returned functions, every call-like site, multi-fix
// passes that remove an annotation and the context it anchors, and
// config-sensitive cases. Ported from the probe behind #56, #59, #60, and #61.
export const corpus: ReadonlyArray<CorpusCase> = [
	{
		name: "issue: arrow body fn",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => (s: string) => s.length);
		`,
	},
	{
		name: "issue: arrow body object",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => ({ format: (n: number) => \`\${n}\` }));
		`,
	},
	{
		name: "issue: return object",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => { return { format: (n: number) => \`\${n}\` }; });
		`,
	},
	{
		name: "control: non-generic return",
		code: unindent`
			declare function run<T>(items: T[], fn: () => (s: string) => number): void;
			run([1], () => (s: string) => s.length);
		`,
	},
	{
		name: "ret: nested 2 levels",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => () => (s: string) => s);
		`,
	},
	{
		name: "ret: if branches",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], (x) => { if (x) { return (s: string) => s; } return (s: string) => s + "!"; });
		`,
	},
	{
		name: "ret: array",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => [(s: string) => s]);
		`,
	},
	{
		name: "ret: tuple as const",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => [(s: string) => s] as const);
		`,
	},
	{
		name: "ret: conditional",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], (x) => (x ? (s: string) => s : (s: string) => s));
		`,
	},
	{
		name: "ret: logical",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			declare const f: ((s: string) => string) | undefined;
			const r = map([1], () => f ?? ((s: string) => s));
		`,
	},
	{
		name: "ret: async",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], async () => (s: string) => s);
		`,
	},
	{
		name: "ret: async await",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			declare function id<T>(x: T): Promise<T>;
			const r = map([1], async () => await id((s: string) => s));
		`,
	},
	{
		name: "ret: generator yield",
		code: unindent`
			declare function gen<T>(fn: () => Generator<T>): T;
			const r = gen(function* () { yield (s: string) => s; });
		`,
	},
	{
		name: "ret: function expression callback",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], function () { return (s: string) => s; });
		`,
	},
	{
		name: "ret: object method shorthand",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => ({ format(n: number) { return \`\${n}\`; } }));
		`,
	},
	{
		name: "ret: satisfies",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => ((s: string) => s) satisfies (s: string) => string);
		`,
	},
	{
		name: "ret: parenthesised",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => (((s: string) => s)));
		`,
	},
	{
		name: "ret: uses T",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], (n) => (s: string) => s.length + n);
		`,
	},
	{
		name: "ret: destructured param",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => ({ a }: { a: string }) => a);
		`,
	},
	{
		name: "ret: default param",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => (s: string = "x") => s);
		`,
	},
	{
		name: "ret: rest param",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => (...s: string[]) => s);
		`,
	},
	{
		name: "ret: optional param",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => (s?: string) => s);
		`,
	},
	{
		name: "Array#map returns fn",
		code: unindent`
			const r = [1].map(() => (s: string) => s.length);
		`,
	},
	{
		name: "Array#map returns object",
		code: unindent`
			const r = [1].map((n) => ({ f: (x: number) => x + n }));
		`,
	},
	{
		name: "Array#reduce (overloaded)",
		code: unindent`
			const r = [1].reduce((acc, n) => acc, (s: string) => s);
		`,
	},
	{
		name: "Promise#then returns fn",
		code: unindent`
			declare const p: Promise<number>;
			const r = p.then(() => (s: string) => s);
		`,
	},
	{
		name: "new Promise resolve",
		code: unindent`
			const r = new Promise((resolve) => resolve((s: string) => s));
		`,
	},
	{
		name: "Promise.resolve",
		code: unindent`
			const r = Promise.resolve((s: string) => s);
		`,
	},
	{
		name: "Object.fromEntries",
		code: unindent`
			const r = Object.fromEntries([["a", (s: string) => s]]);
		`,
	},
	{
		name: "Object.entries map",
		code: unindent`
			declare const o: Record<string, number>;
			const r = Object.entries(o).map(([k]) => [k, (s: string) => s] as const);
		`,
	},
	{
		name: "generic new",
		code: unindent`
			declare class Box<T> { constructor(fn: () => T); value: T }
			const r = new Box(() => (s: string) => s);
		`,
	},
	{
		name: "generic new direct",
		code: unindent`
			declare class Box<T> { constructor(value: T); value: T }
			const r = new Box((s: string) => s);
		`,
	},
	{
		name: "tagged template",
		code: unindent`
			declare function tag<T>(s: TemplateStringsArray, ...v: T[]): T;
			const r = tag\`\${(s: string) => s}\`;
		`,
	},
	{
		name: "spread arg",
		code: unindent`
			declare function f<T>(...fns: T[]): T;
			const r = f(...[(s: string) => s]);
		`,
	},
	{
		name: "optional call",
		code: unindent`
			declare const f: (<T>(fn: T) => T) | undefined;
			const r = f?.((s: string) => s);
		`,
	},
	{
		name: "pipe multi-arg",
		code: unindent`
			declare function pipe<A, B>(a: (x: A) => B, b: (y: B) => B): (x: A) => B;
			const r = pipe((x: number) => String(x), (y) => y);
		`,
	},
	{
		name: "pipe second annotated",
		code: unindent`
			declare function pipe<A, B>(a: (x: A) => B, b: (y: B) => B): (x: A) => B;
			const r = pipe((x: number) => String(x), (y: string) => y);
		`,
	},
	{
		name: "inner generic call inside callback",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			declare function id<T>(x: T): T;
			const r = map([1], () => id((s: string) => s));
		`,
	},
	{
		name: "non-generic inner call in generic cb",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			declare function take(fn: (s: string) => string): (s: string) => string;
			const r = map([1], () => take((s: string) => s));
		`,
	},
	{
		name: "generic default type param",
		code: unindent`
			declare function f<T = (s: string) => string>(fn: T): T;
			const r = f((s: string) => s);
		`,
	},
	{
		name: "constraint",
		code: unindent`
			declare function f<T extends (s: string) => unknown>(fn: T): T;
			const r = f((s: string) => s);
		`,
	},
	{
		name: "const type param",
		code: unindent`
			declare function f<const T>(x: T): T;
			const r = f({ g: (s: string) => s });
		`,
	},
	{
		name: "NoInfer",
		code: unindent`
			declare function f<T>(x: T, fn: (v: NoInfer<T>) => void): void;
			f(1, (v: number) => {});
		`,
	},
	{
		name: "explicit type args + cb return",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map<number, (s: string) => string>([1], () => (s: string) => s);
		`,
	},
	{
		name: "var annotation generic call",
		code: unindent`
			declare function box<T>(fn: T): { v: T };
			const r: { v: (s: string) => string } = box((s: string) => s);
		`,
	},
	{
		name: "return of generic fn decl",
		code: unindent`
			function make<T>(): (x: T) => T { return (x: T) => x; }
		`,
	},
	{
		name: "generic arrow return",
		code: unindent`
			const make = <T,>() => (x: T) => x;
		`,
	},
	{
		name: "default param init",
		code: unindent`
			function g(fn: (s: string) => string = (s: string) => s) { return fn; }
		`,
	},
	{
		name: "destructuring default",
		code: unindent`
			declare const o: { f?: (s: string) => string };
			const { f = (s: string) => s } = o;
		`,
	},
	{
		name: "assignment",
		code: unindent`
			let f: (s: string) => string;
			f = (s: string) => s;
		`,
	},
	{
		name: "class property",
		code: unindent`
			class C { f: (s: string) => string = (s: string) => s; }
		`,
	},
	{
		name: "object in var",
		code: unindent`
			const o: { f: (s: string) => string } = { f: (s: string) => s };
		`,
	},
	{
		name: "satisfies record",
		code: unindent`
			const o = { f: (n: number) => n } satisfies Record<string, (n: number) => number>;
		`,
	},
	{
		name: "union contextual",
		code: unindent`
			const f: ((s: string) => void) | ((n: number) => void) = (s: string) => {};
		`,
	},
	{
		name: "generic contextual sig",
		code: unindent`
			const f: <T>(x: T) => T = (x) => x;
			const g: (x: string) => string = f;
		`,
	},
	{
		name: "this param",
		code: unindent`
			declare function on(fn: (this: Window, e: Event) => void): void;
			on(function (this: Window, e: Event) {});
		`,
	},
	{
		name: "jsx generic component",
		code: unindent`
			declare function List<T>(props: { items: T[]; render: (item: T) => string }): JSX.Element;
			const r = <List items={[1]} render={(item: number) => String(item)} />;
		`,
		tsx: true,
	},
	{
		name: "jsx generic component, fn in render return",
		code: unindent`
			declare function List<T, R>(props: { items: T[]; make: () => R; use: (r: R) => void }): JSX.Element;
			const r = <List items={[1]} make={() => (s: string) => s} use={(f) => f("x")} />;
		`,
		tsx: true,
	},
	{
		name: "jsx non-generic component",
		code: unindent`
			declare function Btn(props: { onClick: (n: number) => void }): JSX.Element;
			const r = <Btn onClick={(n: number) => {}} />;
		`,
		tsx: true,
	},
	{
		name: "R2 new generic class, array arg",
		code: unindent`
			declare class Box<T> { constructor(value: T); value: T }
			const r = new Box([(s: string) => s]);
		`,
	},
	{
		name: "R2 new generic class, cb returns array",
		code: unindent`
			declare class Box<T> { constructor(fn: () => T); value: T }
			const r = new Box(() => [(s: string) => s]);
		`,
	},
	{
		name: "R2 new generic class, two args",
		code: unindent`
			declare class Pair<T> { constructor(a: T, b: T) }
			const r = new Pair((s: string) => s, (s: string) => s);
		`,
	},
	{
		name: "R2 tagged template array",
		code: unindent`
			declare function tag<T>(s: TemplateStringsArray, ...v: T[]): T;
			const r = tag\`\${[(s: string) => s]}\`;
		`,
	},
	{
		name: "R2 tagged template two holes",
		code: unindent`
			declare function tag<T>(s: TemplateStringsArray, ...v: T[]): T;
			const r = tag\`\${(s: string) => s}\${(s: string) => s}\`;
		`,
	},
	{
		name: "R2 generator two yields",
		code: unindent`
			declare function gen<T>(fn: () => Generator<T>): T;
			const r = gen(function* () { yield (s: string) => s; yield (s: string) => s; });
		`,
	},
	{
		name: "R2 generator yield array",
		code: unindent`
			declare function gen<T>(fn: () => Generator<T>): T;
			const r = gen(function* () { yield [(s: string) => s]; });
		`,
	},
	{
		name: "R2 jsx two attrs same T",
		code: unindent`
			declare function Pair<T>(props: { a: T; b: T }): JSX.Element;
			const r = <Pair a={(s: string) => s} b={(s: string) => s} />;
		`,
		tsx: true,
	},
	{
		name: "R2 jsx attr array",
		code: unindent`
			declare function One<T>(props: { a: T[] }): JSX.Element;
			const r = <One a={[(s: string) => s]} />;
		`,
		tsx: true,
	},
	{
		name: "R2 jsx children fn",
		code: unindent`
			declare function Render<T>(props: { value: T; children: (v: T) => string }): JSX.Element;
			const r = <Render value={1}>{(v: number) => String(v)}</Render>;
		`,
		tsx: true,
	},
	{
		name: "R2 direct two args same T",
		code: unindent`
			declare function f<T>(a: T, b: T): T;
			const r = f((s: string) => s, (s: string) => s);
		`,
	},
	{
		name: "R2 method on generic class instance",
		code: unindent`
			declare class Store<S> { select<R>(fn: (s: S) => R): R }
			declare const st: Store<number>;
			const r = st.select(() => (s: string) => s);
		`,
	},
	{
		name: "R2 arrow body satisfies generic",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => ({ f: (s: string) => s }) satisfies object);
		`,
	},
	{
		name: "R2 arrow body as const obj",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => ({ f: (s: string) => s }) as const);
		`,
	},
	{
		name: "R2 return non-null",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => ((s: string) => s)!);
		`,
	},
	{
		name: "R2 return in nested block/try",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => { try { return (s: string) => s; } finally {} });
		`,
	},
	{
		name: "R2 return in switch",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], (n) => { switch (n) { case 1: return (s: string) => s; default: return (s: string) => s; } });
		`,
	},
	{
		name: "R2 return fn assigned to local then returned",
		code: unindent`
			declare function map<T, R>(items: T[], fn: (item: T) => R): R[];
			const r = map([1], () => { const g = (s: string) => s; return g; });
		`,
	},
	{
		name: "R2 this param index shift",
		code: unindent`
			declare function on(fn: (this: Window, a: number, b: string) => void): void;
			on(function (this: Window, a: number, b: string) {});
		`,
	},
	{
		name: "R2 this param index shift mismatch",
		code: unindent`
			declare function on(fn: (this: Window, a: string, b: string) => void): void;
			on(function (this: Window, a: string, b: string) {});
		`,
	},
	{
		name: "R2 spread in array arg",
		code: unindent`
			declare function f<T>(xs: T[]): T;
			const r = f([...[(s: string) => s]]);
		`,
	},
	{
		name: "R2 await in arg",
		code: unindent`
			declare function f<T>(x: T): T;
			async function g() { return f(await Promise.resolve((s: string) => s)); }
		`,
	},
	{
		name: "R2 object spread",
		code: unindent`
			declare function f<T>(x: T): T;
			const r = f({ ...{ g: (s: string) => s } });
		`,
	},
	{
		name: "R2 comma/sequence",
		code: unindent`
			declare function f<T>(x: T): T;
			const r = f((0, (s: string) => s));
		`,
	},
	{
		name: "R2 IIFE generic",
		code: unindent`
			const r = (<T,>(fn: () => T) => fn())(() => (s: string) => s);
		`,
	},
	{
		name: "R2 curried generic",
		code: unindent`
			declare function curry<A>(a: A): <B>(fn: (a: A) => B) => B;
			const r = curry(1)(() => (s: string) => s);
		`,
	},
	{
		name: "R2 overload + cb return",
		code: unindent`
			declare function o(fn: () => number): number;
			declare function o<R>(fn: () => R): R;
			const r = o(() => (s: string) => s);
		`,
	},
	{
		name: "R3 this shift literal",
		code: unindent`
			declare function on(fn: (this: Window, a: "x", b: string) => void): void;
			on(function (this: Window, a: string, b: string) {});
		`,
	},
	{
		name: "R3 jsx children cb return",
		code: unindent`
			declare function Render<T, R>(props: { value: T; make: (v: T) => R; children: (r: R) => string }): JSX.Element;
			const r = <Render value={1} make={() => (s: string) => s}>{(f) => f("x")}</Render>;
		`,
		tsx: true,
	},
	{
		name: "R4 codex1 typeof hides T",
		code: unindent`
			function run<T>(make: () => typeof source, source: () => T = null!): T { return null!; }
			const r = run(() => () => (s: string) => s);
		`,
	},
	{
		name: "R4 codex1 alias hides T",
		code: unindent`
			type Wrap<X> = () => X;
			declare function run<T>(make: Wrap<T>): T;
			const r = run(() => (s: string) => s);
		`,
	},
	{
		name: "R4 codex1 outer-scope T name collision",
		code: unindent`
			type R = (s: string) => string;
			declare function run<R>(make: () => R): R;
			const r = run(() => (s: string) => s);
		`,
	},
	{
		name: "R4 codex3 sequence var+param",
		code: unindent`
			declare function side(): void;
			const f: (x: number) => number = (side(), (x: number) => x);
		`,
	},
	{
		name: "R4 var+param non-null",
		code: unindent`
			const f: (x: number) => number = ((x: number) => x)!;
		`,
	},
	{
		name: "R4 var+param in object",
		code: unindent`
			const o: { f: (x: number) => number } = { f: (x: number) => x };
		`,
	},
	{
		name: "R4 var+param in array",
		code: unindent`
			const a: Array<(x: number) => number> = [(x: number) => x];
		`,
	},
	{
		name: "R4 var+param as const",
		code: unindent`
			const f: (x: number) => number = ((x: number) => x) as const;
		`,
	},
	{
		name: "R4 var+param satisfies",
		code: unindent`
			const f: (x: number) => number = ((x: number) => x) satisfies unknown;
		`,
	},
	{
		name: "R4 var+param via IIFE return",
		code: unindent`
			const f: (x: number) => number = (() => (x: number) => x)();
		`,
	},
	{
		name: "R4 var+param returned fn",
		code: unindent`
			const f: () => (x: number) => number = () => (x: number) => x;
		`,
	},
	{
		name: "R4 param default + outer param",
		code: unindent`
			const g: (cb?: (s: string) => string) => void = (cb: (s: string) => string = (s: string) => s) => {};
		`,
	},
	{
		name: "R4 exported satisfies",
		code: unindent`
			export const o = { f: (s: string) => s } satisfies Record<string, (s: string) => string>;
		`,
	},
	{
		name: "R4 exported object in annotated var",
		code: unindent`
			export const o: { f: (s: string) => string } = { f: (s: string) => s };
		`,
	},
	{
		name: "R4 exported default satisfies",
		code: unindent`
			export default { f: (s: string) => s } satisfies Record<string, (s: string) => string>;
		`,
	},
	{
		name: "R4 optional param exactOptional",
		code: unindent`
			declare function on(fn: (s?: string) => void): void;
			on((s?: string) => {});
		`,
	},
	{
		name: "R4 null union param",
		code: unindent`
			declare function on(fn: (s: string | null) => void): void;
			on((s: string | null) => {});
		`,
	},
	{
		name: "R4 var null union",
		code: unindent`
			declare function get(): string | null;
			let v: string | null = get();
			v = null;
		`,
	},
	{
		name: "R4 index access var",
		code: unindent`
			declare const arr: string[];
			const v: string | undefined = arr[0];
		`,
	},
	{
		name: "variable: typeof hides T in return",
		code: unindent`
			function pick<T = number>(fallback: T = null!): typeof fallback { return fallback; }
			const value: string = pick();
		`,
	},
	// --- context anchors
	{
		name: "anchor: variable annotation",
		code: unindent`
			const f: (x: number) => number = (x: number) => x;
		`,
	},
	{
		name: "anchor: return type",
		code: unindent`
			function make(): (s: string) => string {
				return (s: string) => s;
			}
		`,
	},
	{
		name: "anchor: arrow return type",
		code: unindent`
			const make = (): ((s: string) => string) => (s: string) => s;
		`,
	},
	{
		name: "anchor: generator return type",
		code: unindent`
			function* make(): Generator<(s: string) => string> {
				yield (s: string) => s;
			}
		`,
	},
	{
		name: "anchor: delegating yield",
		code: unindent`
			const make: () => Generator<(s: string) => string> = function* () {
				yield* [(s: string) => s];
			};
		`,
	},
	{
		name: "anchor: class method return",
		code: unindent`
			class C {
				make() {
					return (s: string) => s;
				}
			}
		`,
	},
	{
		name: "anchor: object getter return",
		code: unindent`
			const o: { readonly f: (s: string) => string } = {
				get f() {
					return (s: string) => s;
				},
			};
		`,
	},
	{
		name: "anchor: parameter default, untyped outer",
		code: unindent`
			const g = (cb: (s: string) => string = (s: string) => s) => cb;
		`,
	},
	{
		name: "anchor: parameter default, typed outer",
		code: unindent`
			const g: (cb: (s: string) => string) => void = (cb: (s: string) => string = (s: string) => s) => {};
		`,
	},
	{
		name: "anchor: parameter property default",
		code: unindent`
			class C {
				constructor(private readonly cb: (s: string) => string = (s: string) => s) {}
			}
		`,
	},
	{
		name: "anchor: await",
		code: unindent`
			async function g(): Promise<void> {
				const f: (s: string) => string = await Promise.resolve((s: string) => s);
			}
		`,
	},
	{
		name: "anchor: discriminated union",
		code: unindent`
			type U = { kind: "a"; f: (s: string) => void } | { kind: "b"; f: (n: number) => void };
			const u: U = { kind: "a", f: (s: string) => {} };
		`,
	},
	{
		name: "anchor: spread argument",
		code: unindent`
			declare function f(...fns: Array<(s: string) => void>): void;
			f(...[(s: string) => {}]);
		`,
	},
	{
		name: "anchor: optional call",
		code: unindent`
			declare const f: ((fn: (s: string) => void) => void) | undefined;
			f?.((s: string) => {});
		`,
	},
	{
		name: "anchor: super call",
		code: unindent`
			class A {
				constructor(fn: (s: string) => void) {}
			}
			class B extends A {
				constructor() {
					super((s: string) => {});
				}
			}
		`,
	},
	{
		name: "anchor: non-generic tag",
		code: unindent`
			declare function tag(strings: TemplateStringsArray, ...values: Array<(s: string) => string>): void;
			tag\`\${(s: string) => s}\`;
		`,
	},
	{
		name: "anchor: overload with explicit type argument",
		code: unindent`
			declare function f<T>(fn: (value: T) => void): void;
			declare function f<T>(fn: (value: T) => void, extra: number): void;
			f<string>((value: string) => {});
		`,
	},
	{
		name: "anchor: union callee",
		code: unindent`
			declare const f: ((fn: (s: string) => void) => void) | ((fn: (s: string) => void) => number);
			f((s: string) => {});
		`,
	},
	{
		name: "anchor: IIFE callee typed by its argument",
		code: unindent`
			const r = ((cb) => cb)((s: string) => s);
		`,
	},
	{
		name: "anchor: IIFE callee with typed parameter",
		code: unindent`
			const r = ((cb: (s: string) => string) => cb)((s: string) => s);
		`,
	},
	{
		name: "anchor: IIFE function callee typed by its argument",
		code: unindent`
			const r = (function (cb) {
				return cb;
			})((s: string) => s);
		`,
	},
	{
		name: "anchor: nested generic inside fixed call",
		code: unindent`
			declare function run(fn: () => (s: string) => string): void;
			declare function id<T>(value: T): T;
			run(() => id((s: string) => s));
		`,
	},
	{
		name: "anchor: assignment",
		code: unindent`
			let f: (s: string) => string = (s) => s;
			f = (s: string) => s;
		`,
	},
	{
		name: "anchor: exported as",
		code: unindent`
			export const f = ((s: string) => s) as (s: string) => string;
		`,
	},
	{
		name: "anchor: exported object as",
		code: unindent`
			export const o = { f: (s: string) => s } as Record<string, (s: string) => string>;
		`,
	},
	{
		name: "anchor: exported class property satisfies",
		code: unindent`
			export class C {
				f = { g: (s: string) => s } satisfies Record<string, (s: string) => string>;
			}
		`,
	},
	{
		name: "anchor: exported list satisfies",
		code: unindent`
			const o = { f: (s: string) => s } satisfies Record<string, (s: string) => string>;
			export { o };
		`,
	},
	{
		name: "anchor: exported function body",
		code: unindent`
			declare function each(fn: (s: string) => void): void;
			export function run(): void {
				each((s: string) => {});
			}
		`,
	},
	{
		name: "anchor: jsx intrinsic element",
		code: unindent`
			const r = <button onClick={(event: { x: number }) => {}} />;
		`,
		tsx: true,
	},
	{
		name: "anchor: jsx fragment child",
		code: unindent`
			const r = <>{(s: string) => s}</>;
		`,
		tsx: true,
	},

	// --- variable annotations over calls
	{
		name: "variable: implicit generic constructor",
		code: unindent`
			class Box<T> {
				value?: T;
			}
			const box: Box<string> = new Box();
		`,
	},
	{
		name: "variable: generic call not returning its parameter",
		code: unindent`
			declare function count<T>(items: Array<T>): number;
			const n: number = count([1]);
		`,
	},
	{
		name: "variable: generic method on instance",
		code: unindent`
			declare const map: Map<string, number>;
			const value: number | undefined = map.get("a");
		`,
	},

	// --- round 5: contextual signatures, optional chains, callee shapes
	{
		name: "R5 ctx via typed IIFE callee var",
		code: unindent`
			const run: (fn: (s: string) => void) => void = (fn: (s: string) => void) => {};
			run((s: string) => {});
		`,
	},
	{
		name: "R5 satisfies callee",
		code: unindent`
			type R = (fn: (s: string) => void) => void;
			const run = ((fn: (s: string) => void) => {}) satisfies R;
			run((s: string) => {});
		`,
	},
	{
		name: "R5 var over call of var",
		code: unindent`
			declare function make(): (fn: (s: string) => void) => void;
			const run: (fn: (s: string) => void) => void = make();
			run((s: string) => {});
		`,
	},
	{
		name: "R5 let widening fn",
		code: unindent`
			let f: (s: string) => string = (s: string) => s;
			f = (s) => s;
		`,
	},
	{
		name: "R5 nested decl default",
		code: unindent`
			const g: (cb?: (s: string) => string) => string = (cb: (s: string) => string = (s: string) => s) => cb("a");
		`,
	},
	{
		name: "R5 method on class instance callee",
		code: unindent`
			class C { run(fn: (s: string) => void): void {} }
			new C().run((s: string) => {});
		`,
	},
	{
		name: "R5 generic class instance method non-generic",
		code: unindent`
			class C<T> { run(fn: (v: T) => void): void {} }
			new C<string>().run((v: string) => {});
		`,
	},
	{
		name: "R5 generic class inferred instance",
		code: unindent`
			class C<T> { constructor(v: T) {} run(fn: (v: T) => void): void {} }
			new C("a").run((v: string) => {});
		`,
	},
	{
		name: "R5 chained generic",
		code: unindent`
			declare function box<T>(v: T): { run(fn: (v: T) => void): void };
			box("a" as string).run((v: string) => {});
		`,
	},
	{
		name: "R5 callee from generic call same statement",
		code: unindent`
			declare function mk<T>(fn: (v: T) => void): (v: T) => void;
			const h = mk((v: string) => {});
			h("a");
		`,
	},
	{
		name: "R5 callee depends on arg via generic returned",
		code: unindent`
			declare function mk<T>(v: T): (fn: (x: T) => void) => void;
			mk((s: string) => s)((x: (s: string) => string) => {});
		`,
	},
	{
		name: "R5 object method shorthand in fixed call",
		code: unindent`
			declare function reg(h: { on(s: string): void }): void;
			reg({ on(s: string) {} });
		`,
	},
	{
		name: "R5 union ctx two sigs",
		code: unindent`
			declare function reg(h: ((s: string) => void) | ((s: string, n: number) => void)): void;
			reg((s: string) => {});
		`,
	},
	{
		name: "R5 intersection ctx",
		code: unindent`
			declare function reg(h: ((s: string) => void) & { id: number }): void;
			reg(Object.assign((s: string) => {}, { id: 1 }));
		`,
	},
	{
		name: "R5 conditional type ctx",
		code: unindent`
			type F<T> = T extends string ? (s: T) => void : never;
			declare function reg(h: F<string>): void;
			reg((s: string) => {});
		`,
	},
	{
		name: "R5 contextual this type",
		code: unindent`
			declare function reg(h: (this: { x: number }, s: string) => void): void;
			reg(function (s: string) { this.x; });
		`,
	},
	{
		name: "R5 async return type anchor",
		code: unindent`
			async function make(): Promise<(s: string) => string> { return (s: string) => s; }
		`,
	},
	{
		name: "R5 generator return in class field",
		code: unindent`
			class C { g: () => Generator<(s: string) => string> = function* () { yield (s: string) => s; }; }
		`,
	},
	{
		name: "R5 var multiple fns",
		code: unindent`
			const o: { a: (s: string) => string; b: (n: number) => number } = { a: (s: string) => s, b: (n) => n };
		`,
	},
	{
		name: "R5 var conditional mixed",
		code: unindent`
			declare const c: boolean;
			const f: (s: string) => string = c ? (s: string) => s : (s) => s;
		`,
	},
	{
		name: "R5 var await fn",
		code: unindent`
			async function g() { const f: (s: string) => string = await ((s: string) => s); }
		`,
	},
	{
		name: "R5 tuple ctx",
		code: unindent`
			const t: [(s: string) => string, (n: number) => number] = [(s: string) => s, (n: number) => n];
		`,
	},
	{
		name: "R5 spread tuple ctx",
		code: unindent`
			declare const head: [(s: string) => string];
			const t: [(s: string) => string, (n: number) => number] = [...head, (n: number) => n];
		`,
	},
	{
		name: "R5 rest tuple fixed callee",
		code: unindent`
			declare function f(...args: [(s: string) => void, (n: number) => void]): void;
			f((s: string) => {}, (n: number) => {});
		`,
	},
	{
		name: "R5 overloaded method single-sig after narrowing",
		code: unindent`
			declare const el: { on(type: "a", fn: (s: string) => void): void };
			el.on("a", (s: string) => {});
		`,
	},
	{
		name: "R5 JSX class component",
		code: unindent`
			declare class Btn { constructor(props: { onClick: (n: number) => void }); props: { onClick: (n: number) => void }; render(): JSX.Element }
			const r = <Btn onClick={(n: number) => {}} />;
		`,
		tsx: true,
	},
	{
		name: "R5 variable fn let widening",
		code: unindent`
			let f: () => string = () => "a" as string;
		`,
	},
	{
		name: "R5 var alias typeof var",
		code: unindent`
			const a = (s: string) => s;
			const b: typeof a = (s: string) => s;
		`,
	},
	{
		name: "R5 ctx through NoInfer fixed",
		code: unindent`
			declare function f(fn: NoInfer<(s: string) => void>): void;
			f((s: string) => {});
		`,
	},
	{
		name: "R5 generic default only",
		code: unindent`
			declare function f<T = string>(fn: (s: string) => void): T;
			const r: number = f((s: string) => {});
		`,
	},
	{
		name: "R5 var over generic returning non-T",
		code: unindent`
			declare function f<T>(fn: (v: T) => void): number;
			const r: number = f((v: string) => {});
		`,
	},
	{
		name: "R5 var generic return keyof",
		code: unindent`
			declare function f<T>(): keyof T;
			const r: "a" = f();
		`,
	},
	{
		name: "R5 var generic return conditional",
		code: unindent`
			declare function f<T = 1>(): T extends 1 ? string : number;
			const r: string = f();
		`,
	},
	{
		name: "R5 var over tagged generic",
		code: unindent`
			declare function t<T = number>(s: TemplateStringsArray): T;
			const r: string = t\`\`;
		`,
	},
	{
		name: "R5 var over new generic implicit",
		code: unindent`
			declare const B: new <T = number>() => { v: T };
			const b: { v: string } = new B();
		`,
	},
	{
		name: "R5 var over union callee generic",
		code: unindent`
			declare const f: (<T = number>() => T) | (<T = number>() => T);
			const v: string = f();
		`,
	},
	{
		name: "R5 var over optional call generic",
		code: unindent`
			declare const f: (<T = number>() => T) | undefined;
			const v: string | undefined = f?.();
		`,
	},
	{
		name: "R5 var over this-returning",
		code: unindent`
			declare class Q { self(): this }
			declare class R extends Q { x: number }
			const r: R = new R().self();
		`,
	},
	{
		name: "R5 var over overloads",
		code: unindent`
			declare function f(): string;
			declare function f<T>(v: T): T;
			const r: string = f();
		`,
	},
	{
		name: "R5 param with any context",
		code: unindent`
			declare function f(fn: (s: any) => void): void;
			f((s: string) => {});
		`,
	},
	{
		name: "R5 default in destructuring anchor",
		code: unindent`
			declare const o: { f?: (s: string) => string };
			const { f = (s: string) => s }: { f?: (s: string) => string } = o;
		`,
	},
	{
		name: "R5 var let widening literal return",
		code: unindent`
			let f: () => string = () => "a";
		`,
	},
	{
		name: "R5 fn in array in generic callee with type args two sigs",
		code: unindent`
			declare function f<T>(v: T[]): void;
			f<(s: string) => string>([(s: string) => s]);
		`,
	},
	{
		name: "R5 export default arrow isolated",
		code: unindent`
			export default ((s: string) => s) satisfies (s: string) => string;
		`,
	},
	{
		name: "R5 export namespace const",
		code: unindent`
			export namespace N { export const o = { f: (s: string) => s } satisfies Record<string, (s: string) => string>; }
		`,
	},
	{
		name: "R5 export class static prop",
		code: unindent`
			export class C { static f = { g: (s: string) => s } satisfies Record<string, (s: string) => string>; }
		`,
	},
	{
		name: "R5 export const arrow with satisfies return",
		code: unindent`
			export const f = (): Record<string, (s: string) => string> => ({ g: (s: string) => s });
		`,
	},
	{
		name: "R5 export const object as const",
		code: unindent`
			export const o = { f: ((s: string) => s) as (s: string) => string } as const;
		`,
	},
	{
		name: "R5 export assignment",
		code: unindent`
			declare function reg(fn: (s: string) => void): number;
			export const n: number = reg((s: string) => {});
		`,
	},
	{
		name: "R5 export fn default param",
		code: unindent`
			export function f(cb: (s: string) => string = (s: string) => s): void {}
		`,
	},
	{
		name: "R5 more required parameters than the context passes",
		code: unindent`
			declare function f(fn: (a: string) => void): void;
			f((a: string, b: number) => {});
		`,
	},
];
