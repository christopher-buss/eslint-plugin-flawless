/** Compiler failures caused by removing annotations in issue #70. */
export const regressions = [
	{
		name: "assertion callback parameter",
		code: `
type Assert = (condition: unknown) => asserts condition;
declare function run(use: (check: Assert) => void): void;
run((check: Assert) => { check(true); });`,
	},
	{
		name: "assertion call target",
		code: `
declare function assert(condition: unknown): asserts condition;
const check: (condition: unknown) => asserts condition = assert;
check(true);`,
	},
	{
		name: "assertion method receiver",
		code: `
interface Assertions { check(condition: unknown): asserts condition }
declare function getAssertions(): Assertions;
const assertions: Assertions = getAssertions();
assertions.check(true);`,
	},
	{
		name: "loop assignment cycle",
		code: `
interface TreeNode<T> { readonly left?: TreeNode<T>; readonly value: T }
export function descend<T>(root: TreeNode<T>): T {
	let node: TreeNode<T> | undefined = root;
	let last = root.value;
	while (node !== undefined) {
		last = node.value;
		const left: TreeNode<T> | undefined = node.left;
		node = left;
	}
	return last;
}`,
	},
	{
		name: "loop call argument cycle",
		code: `
type Found = [start?: number, end?: number];
declare function find(text: string, pattern: string, init?: number): Found;
export function spaces(text: string): void {
	let at = find(text, "_")[0];
	if (at === undefined) return;
	do {
		const after: number = at + 1;
		at = find(text, "_", after)[0];
	} while (at !== undefined);
}`,
	},
	{
		name: "loop assertion cycle",
		code: `
declare function assert<T>(condition: T, message?: string): asserts condition;
export function check(values: ReadonlyArray<number> | undefined): void {
	if (values === undefined) return;
	let index = 0;
	for (const _ of values) {
		const value: number = values[index]!;
		index += 1;
		assert(value >= 0);
	}
}`,
	},
	{
		name: "union behind generic context",
		code: `
type Creator<P = undefined> = P extends undefined ? () => void : (payload: P) => void;
type Creators<A> = {
	readonly [K in keyof A]: A[K] extends (s: unknown) => void
		? Creator
		: A[K] extends (s: unknown, p: infer P) => void ? Creator<P> : never;
};
export function f<A extends Record<string, (s: number, p: unknown) => number>>(
	k: keyof Creators<A>, out: Partial<Creators<A>>,
): void {
	out[k] = ((payload?: unknown): void => { void payload; }) as Creators<A>[keyof Creators<A>];
}`,
	},
	{
		name: "generic parameter default",
		code: `
declare function readFile<T>(path: string): T;
export function load(
	read: <T>(path: string) => T = <T>(path: string) => readFile<T>(path),
): void {
	void read;
}`,
	},
] as const;
