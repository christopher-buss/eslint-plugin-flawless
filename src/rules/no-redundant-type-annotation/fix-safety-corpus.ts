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

	// --- round 6: adversarial sweep over both checks (literal widening, cycles,
	// emitter reads, unique symbols, and every parameter anchor)
	{
		name: "R6 let non-fresh const",
		code: unindent`
			declare const a: "a"; let x: string = a; x = "b"; export {};
		`,
	},
	{
		name: "R6 let as const",
		code: unindent`
			let x: string = "a" as const; x = "b"; export {};
		`,
	},
	{
		name: "R6 let as literal",
		code: unindent`
			let x: number = 1 as 1; x = 2; export {};
		`,
	},
	{
		name: "R6 let angle literal",
		code: unindent`
			let x: number = <1>1; x = 2; export {};
		`,
	},
	{
		name: "R6 let fn literal ret",
		code: unindent`
			declare function f(): 1; let x: number = f(); x = 2; export {};
		`,
	},
	{
		name: "R6 let enum non-fresh",
		code: unindent`
			enum E { A, B } declare const e: E.A; let x: E = e; x = E.B; export {};
		`,
	},
	{
		name: "R6 let true non-fresh",
		code: unindent`
			declare const t: true; let x: boolean = t; x = false; export {};
		`,
	},
	{
		name: "R6 let readonly prop",
		code: unindent`
			const o = { k: "a" } as const; let x: string = o.k; x = "b"; export {};
		`,
	},
	{
		name: "R6 let tuple elem",
		code: unindent`
			declare const t: readonly ["a"]; let x: string = t[0]; x = "b"; export {};
		`,
	},
	{
		name: "R6 let fresh union cond",
		code: unindent`
			declare const c: boolean; let x: 1 | 2 = c ? 1 : 2; export { x };
		`,
	},
	{
		name: "R6 let fresh union str",
		code: unindent`
			declare const c: boolean; let x: "a" | "b" = c ? "a" : "b"; export { x };
		`,
	},
	{
		name: "R6 let fresh 1|undef",
		code: unindent`
			declare const c: boolean; let x: 1 | undefined = c ? 1 : undefined; export { x };
		`,
	},
	{
		name: "R6 let non-null lit",
		code: unindent`
			declare const a: "a" | undefined; let x: string = a!; x = "b"; export {};
		`,
	},
	{
		name: "R6 let await lit",
		code: unindent`
			declare const p: Promise<"a">; async function g() { let x: string = await p; x = "b"; return x; } export { g };
		`,
	},
	{
		name: "R6 let optional chain lit",
		code: unindent`
			declare const o: { k: "a" } | undefined; let x: string | undefined = o?.k; x = "b"; export {};
		`,
	},
	{
		name: "R6 let template lit",
		code: unindent`
			declare const n: number; let x: string = \`a\${n}\` as const; x = "b"; export {};
		`,
	},
	{
		name: "R6 const template ctx",
		code: unindent`
			declare const n: number; const x: \`a\${number}\` = \`a\${n}\`; export { x };
		`,
	},
	{
		name: "R6 let bigint non-fresh",
		code: unindent`
			declare const b: 1n; let x: bigint = b; x = 2n; export {};
		`,
	},
	{
		name: "R6 const unique sym alias",
		code: unindent`
			declare const s: unique symbol; const a: typeof s = s; export const o = { [a]: 1 };
		`,
	},
	{
		name: "R6 let seq lit",
		code: unindent`
			declare const a: "a"; let x: string = (0, a); x = "b"; export {};
		`,
	},
	{
		name: "R6 fn ret fresh union",
		code: unindent`
			declare const c: boolean; const f: () => 1 | 2 = () => (c ? 1 : 2); export const r: 1 | 2 = f();
		`,
	},
	{
		name: "R6 fn ret fresh union block",
		code: unindent`
			declare const c: boolean; const f: () => "a" | "b" = () => { if (c) return "a"; return "b"; }; export const r: "a" | "b" = f();
		`,
	},
	{
		name: "R6 async fn ret fresh union",
		code: unindent`
			declare const c: boolean; const f: () => Promise<1 | 2> = async () => (c ? 1 : 2); export const r: Promise<1 | 2> = f();
		`,
	},
	{
		name: "R6 fn ret lit|undef",
		code: unindent`
			declare const c: boolean; const f: () => 1 | undefined = () => (c ? 1 : undefined); export const r: 1 | undefined = f();
		`,
	},
	{
		name: "R6 fn ret enum union",
		code: unindent`
			enum E { A, B, C } declare const c: boolean; const f: () => E.A | E.B = () => (c ? E.A : E.B); export const r: E.A | E.B = f();
		`,
	},
	{
		name: "R6 recursive arrow",
		code: unindent`
			const f: () => number = () => f(); export { f };
		`,
	},
	{
		name: "R6 recursive fib",
		code: unindent`
			const fib: (n: number) => number = (n: number) => (n < 2 ? n : fib(n - 1) + fib(n - 2)); export { fib };
		`,
	},
	{
		name: "R6 circular via cb",
		code: unindent`
			declare function g(cb: () => number): number; const x: number = g(() => x); export { x };
		`,
	},
	{
		name: "R6 circular via obj",
		code: unindent`
			interface Api { get(): number } declare function make(o: { get: () => Api }): Api; const o: Api = make({ get: () => o }); export { o };
		`,
	},
	{
		name: "R6 recursive fn expr",
		code: unindent`
			const f: (n: number) => number = function (n: number) { return n ? f(n - 1) : 0; }; export { f };
		`,
	},
	{
		name: "R6 rec block return",
		code: unindent`
			const f: (n: number) => number = (n: number) => { if (n) return f(n - 1); return 0; }; export { f };
		`,
	},
	{
		name: "R6 rec only self",
		code: unindent`
			const f: (n: number) => number = (n: number) => f(n); export { f };
		`,
	},
	{
		name: "R6 rec method obj",
		code: unindent`
			interface O { m(): number } declare function mk(): O; const o: O = mk(); const g: () => number = () => g2(); const g2: () => number = () => g(); export { o, g };
		`,
	},
	{
		name: "R6 rec let",
		code: unindent`
			let f: () => string = () => f(); export { f };
		`,
	},
	{
		name: "R6 rec fn expr named",
		code: unindent`
			const f: () => number = function () { return f(); }; export { f };
		`,
	},
	{
		name: "R6 rec async",
		code: unindent`
			const f: () => Promise<number> = async () => f(); export { f };
		`,
	},
	{
		name: "R6 circular getter",
		code: unindent`
			declare function lazy(cb: () => number): { value: number }; const x: { value: number } = lazy(() => x.value); export { x };
		`,
	},
	{
		name: "R6 circular class expr",
		code: unindent`
			const C: new () => { v: number } = class { v = new C().v; }; export { C };
		`,
	},
	{
		name: "R6 circular new",
		code: unindent`
			declare class L { constructor(cb: () => number); v: number } const l: L = new L(() => l.v); export { l };
		`,
	},
	{
		name: "R6 circular tagged",
		code: unindent`
			declare function t(s: TemplateStringsArray, f: () => number): number; const x: number = t\`\${() => x}\`; export { x };
		`,
	},
	{
		name: "R6 unique sym let",
		code: unindent`
			declare const s: unique symbol; let a: typeof s = s; export { a };
		`,
	},
	{
		name: "R6 unique sym Symbol()",
		code: unindent`
			const s: unique symbol = Symbol(); export const o = { [s]: 1 };
		`,
	},
	{
		name: "R6 template ctx cond",
		code: unindent`
			declare const n: number; declare const c: boolean; const x: \`a\${number}\` | "b" = c ? \`a\${n}\` : "b"; export { x };
		`,
	},
	{
		name: "R6 template ctx fn ret",
		code: unindent`
			declare const n: number; const f: () => \`a\${number}\` = () => \`a\${n}\`; export { f };
		`,
	},
	{
		name: "R6 template ctx upper",
		code: unindent`
			declare const n: Uppercase<string>; const x: Uppercase<string> = \`\${n}\`; export { x };
		`,
	},
	{
		name: "R6 template ctx arg",
		code: unindent`
			declare function g(s: \`a\${number}\`): \`a\${number}\`; declare const n: number; const x: \`a\${number}\` = g(\`a\${n}\`); export { x };
		`,
	},
	{
		name: "R6 param anchor union rest",
		code: unindent`
			declare function f(...a: [cb: (x: number) => void] | [n: number, cb: (x: string) => void]): void; f(1, (x: string) => {}); f((x: number) => {});
		`,
	},
	{
		name: "R6 param default undef",
		code: unindent`
			declare function f(cb: (x: number | undefined) => void): void; f((x: number | undefined = 1) => { const y: number = x; void y; });
		`,
	},
	{
		name: "R6 param optional",
		code: unindent`
			declare function f(cb: (x?: number) => void): void; f((x?: number) => { void x; });
		`,
	},
	{
		name: "R6 param and-left",
		code: unindent`
			type F = (x: number) => void; declare const g: F; const h: F = ((x: number) => {}) && g; void h;
		`,
	},
	{
		name: "R6 param or-right no ctx",
		code: unindent`
			declare const g: ((x: number) => void) | undefined; declare function k(f: (x: number) => void): void; k(g || ((x: number) => {}));
		`,
	},
	{
		name: "R6 param this cls",
		code: unindent`
			class A { on(cb: (self: this) => void) { cb(this); } m() { this.on((self: this) => { self.m(); }); } } export { A };
		`,
	},
	{
		name: "R6 param super ctor",
		code: unindent`
			class A { constructor(cb: (x: number) => void) { cb(1); } } class B extends A { constructor() { super((x: number) => {}); } } export { B };
		`,
	},
	{
		name: "R6 param super generic",
		code: unindent`
			class A<T> { constructor(cb: (x: T) => void) {} } class B extends A<number> { constructor() { super((x: number) => {}); } } export { B };
		`,
	},
	{
		name: "R6 param union callee",
		code: unindent`
			declare const f: ((cb: (x: number) => void) => void) | ((cb: (x: number) => void, y?: string) => void); f((x: number) => {});
		`,
	},
	{
		name: "R6 param union callee differ",
		code: unindent`
			declare const f: ((cb: (x: 1) => void) => void) | ((cb: (x: 2) => void) => void); f((x: never) => {});
		`,
	},
	{
		name: "R6 param intersection ctx",
		code: unindent`
			declare function f(cb: ((x: number) => void) & { tag?: 1 }): void; f((x: number) => {});
		`,
	},
	{
		name: "R6 param generic fn ctx",
		code: unindent`
			declare function f(cb: <T>(x: T) => T): void; f(<U,>(x: U) => x);
		`,
	},
	{
		name: "R6 param nested same pass",
		code: unindent`
			declare function f(cb: (g: (h: (x: number) => void) => void) => void): void; f((g: (h: (x: number) => void) => void) => { g((x: number) => {}); });
		`,
	},
	{
		name: "R6 param via var anchor nested",
		code: unindent`
			const o: { f: (g: (x: number) => void) => void } = { f: (g: (x: number) => void) => { g(1); } }; export { o };
		`,
	},
	{
		name: "R6 iso export default id",
		code: unindent`
			declare function f(): number; const x: number = f(); export default x;
		`,
	},
	{
		name: "R6 iso typeof ref",
		code: unindent`
			declare function f(): number; const x: number = f(); export const y: typeof x = x;
		`,
	},
	{
		name: "R6 iso computed key",
		code: unindent`
			declare const k: "a"; const key: "a" = k; export class C { [key] = 1; }
		`,
	},
	{
		name: "R6 iso ns export",
		code: unindent`
			declare function f(): number; export namespace N { export const x: number = f(); }
		`,
	},
	{
		name: "R6 iso export default obj param",
		code: unindent`
			declare function wrap<T>(x: T): T; const o = wrap({ f: (x: number) => x }); export default o;
		`,
	},
	{
		name: "R6 iso class prop typed arrow",
		code: unindent`
			export class C { f: (x: number) => number = (x: number) => x; }
		`,
	},
	{
		name: "R6 iso param prop default",
		code: unindent`
			export class C { constructor(public cb: (x: number) => void = (x: number) => {}) {} }
		`,
	},
	{
		name: "R6 iso fn default",
		code: unindent`
			export function f(cb: (x: number) => number = (x: number) => x): number { return cb(1); }
		`,
	},
	{
		name: "R6 iso satisfies exported",
		code: unindent`
			export const o = { f: (x: number) => x } satisfies { f: (x: number) => number };
		`,
	},
	{
		name: "R6 iso export as",
		code: unindent`
			const f = (x: number): number => x; export { f as g };
		`,
	},
	{
		name: "R6 iso typeof ref var",
		code: unindent`
			declare function mk(): { a: number }; const cfg: { a: number } = mk(); export type Cfg = typeof cfg;
		`,
	},
	{
		name: "R6 gen NoInfer",
		code: unindent`
			declare function f<T>(x: T, cb: (v: NoInfer<T>) => void): void; f(1, (v: number) => {});
		`,
	},
	{
		name: "R6 gen const tp",
		code: unindent`
			declare function f<const T>(x: T): T; const r: readonly [1, 2] = f([1, 2]); export { r };
		`,
	},
	{
		name: "R6 gen default ret",
		code: unindent`
			declare function f<T = string>(): T[]; const r: string[] = f(); export { r };
		`,
	},
	{
		name: "R6 gen cond ret",
		code: unindent`
			declare function f<T extends boolean = false>(): T extends true ? 1 : 2; const r: 2 = f(); export { r };
		`,
	},
	{
		name: "R6 gen method this",
		code: unindent`
			declare class B { self<T extends this>(): T } class D extends B { d = 1 } const r: D = new D().self(); export { r };
		`,
	},
	{
		name: "R6 gen inferred ret typeof",
		code: unindent`
			function id<T>(): T { return null!; } const g = id; const r: number = g(); export { r };
		`,
	},
	{
		name: "R6 gen via alias call",
		code: unindent`
			type Fn = <T = number>() => T; declare const f: Fn; const r: number = f(); export { r };
		`,
	},
	{
		name: "R6 gen overload one generic",
		code: unindent`
			declare function f(): number; declare function f<T>(x: T): T; const r: number = f(); export { r };
		`,
	},
	{
		name: "R6 gen class static",
		code: unindent`
			declare class P<T> { static of<U = string>(): P<U>; } const r: P<string> = P.of(); export { r };
		`,
	},
	{
		name: "R6 gen optional call",
		code: unindent`
			declare const o: { f?: <T = number>() => T }; const r: number | undefined = o.f?.(); export { r };
		`,
	},
	{
		name: "R6 gen await call",
		code: unindent`
			declare function f<T = number>(): Promise<T>; async function g() { const r: number = await f(); return r; } export { g };
		`,
	},
	{
		name: "R6 gen in arg non-generic",
		code: unindent`
			declare function f<T = number>(): T; declare function h(x: string): string; const r: string = h(f()); export { r };
		`,
	},
	{
		name: "R6 gen tagged",
		code: unindent`
			declare function t<T = number>(s: TemplateStringsArray): T; const r: number = t\`\`; export { r };
		`,
	},
	{
		name: "R6 gen new default",
		code: unindent`
			class Box<T = number> { v!: T } const b: Box<number> = new Box(); export { b };
		`,
	},
	{
		name: "R6 gen implicit ctor",
		code: unindent`
			class Box<T> { v?: T } const b: Box<string> = new Box(); export { b };
		`,
	},
	{
		name: "R6 gen JSX elem",
		code: unindent`
			declare function C<T>(p: { v: T; f: (x: T) => void }): any; const e: any = <C v={1} f={(x: number) => {}} />; export { e };
		`,
		tsx: true,
	},
	{
		name: "R6 jsx overloaded",
		code: unindent`
			declare function C(p: { f: (x: number) => void }): any; declare function C(p: { g: (x: string) => void }): any; export const e = <C f={(x: number) => {}} />;
		`,
		tsx: true,
	},
	{
		name: "R6 jsx class comp",
		code: unindent`
			declare class C { constructor(p: { f: (x: number) => void }); props: { f: (x: number) => void } } export const e = <C f={(x: number) => {}} />;
		`,
		tsx: true,
	},
	{
		name: "R6 jsx children fn",
		code: unindent`
			declare function C(p: { children: (x: number) => any }): any; export const e = <C>{(x: number) => null}</C>;
		`,
		tsx: true,
	},
	{
		name: "R6 disc union param",
		code: unindent`
			type U = { k: "a"; f: (x: number) => void } | { k: "b"; f: (x: string) => void }; const o: U = { k: "a", f: (x: number) => {} }; export { o };
		`,
	},
	{
		name: "R6 missing-prop disc",
		code: unindent`
			type U = { a: (x: number) => void } | { b: (x: string) => void }; const o: U = { a: (x: number) => {} }; export { o };
		`,
	},
	{
		name: "R6 ThisType method",
		code: unindent`
			type O = { m(x: number): void } & ThisType<{ n: number }>; const o: O = { m(x: number) { void this.n; } }; export { o };
		`,
	},
	{
		name: "R6 mapped keyed",
		code: unindent`
			const o: { [K in "a" | "b"]: (x: K) => void } = { a: (x: "a") => {}, b: (x: "b") => {} }; export { o };
		`,
	},
	{
		name: "R6 index sig param",
		code: unindent`
			const o: Record<string, (x: number) => void> = { a: (x: number) => {} }; export { o };
		`,
	},
	{
		name: "R6 obj setter",
		code: unindent`
			const o: { v: number } = { set v(x: number) {}, get v() { return 1; } }; export { o };
		`,
	},
	{
		name: "R6 class field typed",
		code: unindent`
			class C { h: (e: { x: number }) => void = (e: { x: number }) => {}; } export { C };
		`,
	},
	{
		name: "R6 class accessor field",
		code: unindent`
			class C { accessor h: (x: number) => void = (x: number) => {}; } export { C };
		`,
	},
	{
		name: "R6 static block",
		code: unindent`
			declare function on(cb: (x: number) => void): void; class C { static { on((x: number) => {}); } } export { C };
		`,
	},
	{
		name: "R6 implements method",
		code: unindent`
			interface I { m(x: number): void } class C implements I { m = (x: number) => {}; } export { C };
		`,
	},
	{
		name: "R6 returned fn anchor",
		code: unindent`
			const mk: () => (x: number) => void = () => (x: number) => {}; export { mk };
		`,
	},
	{
		name: "R6 returned fn var+param",
		code: unindent`
			const mk: () => (x: number) => number = () => { return (x: number) => x; }; export { mk };
		`,
	},
	{
		name: "R6 yielded fn",
		code: unindent`
			const g: () => Generator<(x: number) => void> = function* () { yield (x: number) => {}; }; export { g };
		`,
	},
	{
		name: "R6 async returned fn",
		code: unindent`
			const g: () => Promise<(x: number) => void> = async () => (x: number) => {}; export { g };
		`,
	},
	{
		name: "R6 cond anchor",
		code: unindent`
			declare const c: boolean; const f: (x: number) => void = c ? (x: number) => {} : (x: number) => {}; export { f };
		`,
	},
	{
		name: "R6 seq anchor",
		code: unindent`
			const f: (x: number) => void = (0, (x: number) => {}); export { f };
		`,
	},
	{
		name: "R6 as anchor",
		code: unindent`
			export const f = ((x: number) => {}) as (x: number) => void;
		`,
	},
	{
		name: "R6 non-null anchor",
		code: unindent`
			const f: (x: number) => void = ((x: number) => {})!; export { f };
		`,
	},
	{
		name: "R6 spread array anchor",
		code: unindent`
			const fs: Array<(x: number) => void> = [...[(x: number) => {}]]; export { fs };
		`,
	},
	{
		name: "R6 tuple rest param",
		code: unindent`
			declare function f(cb: (...a: [number, string]) => void): void; f((...a: [number, string]) => {});
		`,
	},
	{
		name: "R6 tuple destructured rest",
		code: unindent`
			declare function f(cb: (...a: [1, string] | [2, number]) => void): void; f((...[k, v]: [1, string] | [2, number]) => { if (k === 1) { const s: string = v; void s; } });
		`,
	},
	{
		name: "R6 destructured param",
		code: unindent`
			declare function f(cb: (o: { a: number }) => void): void; f(({ a }: { a: number }) => { void a; });
		`,
	},
	{
		name: "R6 this param fn",
		code: unindent`
			declare function f(cb: (this: { n: number }, x: number) => void): void; f(function (this: { n: number }, x: number) { void this.n; void x; });
		`,
	},
	{
		name: "R6 extra optional param",
		code: unindent`
			declare function f(cb: (x: number) => void): void; f((x: number, y?: string) => { void y; });
		`,
	},
	{
		name: "R6 method sig method variance",
		code: unindent`
			interface I { m(cb: (x: "a") => void): void } declare const i: I; i.m((x: "a") => {});
		`,
	},
	{
		name: "R6 enum param",
		code: unindent`
			enum E { A, B } declare function f(cb: (e: E) => void): void; f((e: E) => {});
		`,
	},
	{
		name: "R6 catch unknown",
		code: unindent`
			try {} catch (e: unknown) { void e; } export {};
		`,
	},
	{
		name: "R6 catch unknown alias typeof",
		code: unindent`
			declare const u: unknown; try {} catch (e: typeof u) { void e; } export {};
		`,
	},
	{
		name: "R6 catch unknown union",
		code: unindent`
			try {} catch (e: unknown | undefined) { void e; } export {};
		`,
	},
	{
		name: "R6 for let",
		code: unindent`
			for (let i: number = 0; i < 3; i++) {} export {};
		`,
	},
	{
		name: "R6 rec cond",
		code: unindent`
			declare const c: boolean; const f: () => number = () => (c ? f() : 1); export { f };
		`,
	},
	{
		name: "R6 rec param",
		code: unindent`
			const f: (n: number) => number = (n: number) => f(n); export { f };
		`,
	},
	{
		name: "R6 rec void body",
		code: unindent`
			const f: () => void = () => { f(); }; export { f };
		`,
	},
	{
		name: "R6 rec via prop",
		code: unindent`
			const o: { n: number } = { n: 1 }; const f: () => number = () => o.n + f(); export { f };
		`,
	},
	{
		name: "R6 circ call method",
		code: unindent`
			declare const api: { run(cb: () => number): number }; const x: number = api.run(() => x); export { x };
		`,
	},
	{
		name: "R6 circ call obj arg",
		code: unindent`
			declare function g(o: { f: () => number }): number; const x: number = g({ f: () => x }); export { x };
		`,
	},
	{
		name: "R6 circ call arr arg",
		code: unindent`
			declare function g(o: Array<() => number>): number; const x: number = g([() => x]); export { x };
		`,
	},
	{
		name: "R6 circ opt chain",
		code: unindent`
			declare const api: { run?(cb: () => number): number }; const x: number | undefined = api.run?.(() => x ?? 0); export { x };
		`,
	},
	{
		name: "R6 circ await",
		code: unindent`
			declare function g(cb: () => number): Promise<number>; async function h() { const x: number = await g(() => x); return x; } export { h };
		`,
	},
	{
		name: "R6 circ cond",
		code: unindent`
			declare const c: boolean; declare function g(cb: () => number): number; const x: number = c ? g(() => x) : 0; export { x };
		`,
	},
	{
		name: "R6 circ fn expr arg",
		code: unindent`
			declare function g(cb: () => number): number; const x: number = g(function () { return x; }); export { x };
		`,
	},
	{
		name: "R6 circ new L2",
		code: unindent`
			declare class L { constructor(o: { f: () => L }); } const l: L = new L({ f: () => l }); export { l };
		`,
	},
	{
		name: "R6 circ fn typed ret",
		code: unindent`
			declare function g(cb: () => number): number; const x: number = g((): number => x); export { x };
		`,
	},
	{
		name: "R6 unique sym non-null",
		code: unindent`
			declare const s: unique symbol | undefined; const a: typeof s & {} = s!; export { a };
		`,
	},
	{
		name: "R6 unique sym prop",
		code: unindent`
			declare const o: { readonly k: unique symbol }; const a: typeof o.k = o.k; export const r = { [a]: 1 };
		`,
	},
	{
		name: "R6 let widen getter",
		code: unindent`
			declare const o: { get k(): "a" }; let x: string = o.k; x = "b"; export {};
		`,
	},
	{
		name: "R6 let widen intersection",
		code: unindent`
			declare const v: "a" & {}; let x: string = v; x = "b"; export {};
		`,
	},
	{
		name: "R6 let widen typeof",
		code: unindent`
			declare const v: number | string; let x: string = typeof v === "string" ? "s" : "n"; x = "b"; export {};
		`,
	},
	{
		name: "R6 let widen enum str",
		code: unindent`
			enum S { A = "a", B = "b" } declare const s: S.A; let x: S = s; x = S.B; export {};
		`,
	},
	{
		name: "R6 let widen cond non-fresh",
		code: unindent`
			declare const a: "a"; declare const c: boolean; let x: string = c ? a : a; x = "b"; export {};
		`,
	},
	{
		name: "R6 let widen logical",
		code: unindent`
			declare const a: "a" | undefined; let x: string = a ?? "a"; x = "b"; export {};
		`,
	},
	{
		name: "R6 let fresh union 3 enum",
		code: unindent`
			enum E { A, B, C } declare const c: boolean; let x: E.A | E.B = c ? E.A : E.B; export { x };
		`,
	},
	{
		name: "R6 let fresh union bool+lit",
		code: unindent`
			declare const c: boolean; let x: 1 | true = c ? 1 : true; export { x };
		`,
	},
	{
		name: "R6 const template in obj ret",
		code: unindent`
			declare const n: number; const x: \`a\${number}\` = (0, \`a\${n}\`); export { x };
		`,
	},
	{
		name: "R6 let template ctx",
		code: unindent`
			declare const n: number; let x: \`a\${number}\` = \`a\${n}\`; x = "a1"; export {};
		`,
	},
	{
		name: "R6 iso non-exported used by fn ret",
		code: unindent`
			declare function f(): number; const x: number = f(); export function g(): typeof x { return x; }
		`,
	},
	{
		name: "R6 iso export default expr",
		code: unindent`
			declare function f(): number; const x: number = f(); export default [x] as number[];
		`,
	},
	{
		name: "R6 iso export spec default",
		code: unindent`
			declare function f(): number; const x: number = f(); export { x as default };
		`,
	},
	{
		name: "R6 this type var",
		code: unindent`
			class A { m() { const s: this = this; return s; } } export { A };
		`,
	},
	{
		name: "R6 narrowed let",
		code: unindent`
			declare const v: string | number; if (typeof v === "string") { let x: string = v; x = "b"; void x; } export {};
		`,
	},
];
