import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";
import path from "node:path";

import { run } from "../test.ts";
import { noIgnoredReturn, RULE_NAME } from "./rule.ts";

const DECLARATIONS = unindent`
	declare const list: number[];
	declare const text: string;
	declare const date: Date;
	declare const re: RegExp;
	declare const n: number;
	declare const lit: "a" | "b";
	declare const ro: ReadonlyArray<number>;
	declare const tuple: [number, number];
	declare const frozen: readonly number[];
	declare const dict: Map<string, number>;
	declare const tags: Set<string>;
	declare const boxed: String;
	declare const branded: string & { __brand: "x" };
	declare const either: string | number;
	declare const maybe: string | undefined;
	declare const anyValue: any;
	declare function save(value: number): void;
	enum E { A }
	let found = 0;
	declare const holder: { last: number };
	const method = "map";
`;

function withDeclarations(code: string): string {
	return `${DECLARATIONS}\n${code}`;
}

const valid: Array<ValidTestCase> = [
	"list.forEach((x) => x);",
	"list.push(1);",
	// Only a bare statement discards the result.
	"void list.map((x) => x);",
	"list?.map((x) => x);",
	"export const kept = list.map((x) => x);",
	"found = list.indexOf(1);",
	// A replacer function can do work.
	"text.replace(/a/g, (m) => m.toUpperCase());",
	"text.replace(/a/g, function (m) { return m.toUpperCase(); });",
	// A replacer passed by name or typed as a union is still a function.
	unindent`
		declare const replacer: ((m: string) => string) | ((m: string, g: string) => string);
		text.replace(/a/g, replacer);
	`,
	unindent`
		type Replacer = (m: string) => string;
		declare const named: Replacer;
		text.replace(/a/g, named);
	`,
	// A callback that does work makes the call a loop with an early exit.
	"list.find((x) => { found = x; return true; });",
	"list.findIndex((x) => (found = x) > 1);",
	"list.findLast(function (x) { found += x; return false; });",
	"list.findLastIndex((x) => { if (x > 1) { found = x; } return false; });",
	"list.find((x) => { found++; return x > 1; });",
	"list.reduce((sum, x) => { found += x; return sum + x; }, 0);",
	"list.find((x) => { holder.last = x; return x > 1; });",
	"list.some((x) => { save(x); return x > 1; });",
	"list.every((x) => { save(x); return true; });",
	// Mutating methods are not in a readonly interface.
	'dict.set("a", 1);',
	'tags.add("a");',
	"list.sort();",
	// A boxed, branded or union receiver matches no table.
	"boxed.trim();",
	"branded.trim();",
	"either.toString();",
	"maybe?.trim();",
	"anyValue.map((x: number) => x);",
	"E.A.toString();",
	// A computed key that is not a literal has no static name.
	"list[method]((x: number) => x);",
	// A method of another kind's table.
	"text.map((x: string) => x);",
	"list.trim();",
	"date.setTime(0);",
	"re.exec(text);",
	// Optional calls, private names and calls that are not the whole statement.
	"list.map?.((x) => x);",
	"(list?.map)((x) => x);",
	"0, text.trim();",
	"text.trim()!;",
	unindent`
		export class Holder {
			#trim(): string { return ""; }
			run(): void { this.#trim(); }
		}
	`,
	// A local class or object with a library name is not the library type.
	unindent`
		{
			class Date { getTime(): number { return 0; } }
			new Date().getTime();
		}
	`,
	unindent`
		{
			const Math = { max: (a: number, b: number): number => a + b };
			Math.max(1, 2);
		}
	`,
	// A user augmentation of a library interface is not in the table.
	unindent`
		declare global { interface String { shout(): string } }
		text.shout();
	`,
	// A user object with a table method name.
	unindent`
		declare const store: { map(callback: () => void): void; trim(): void };
		store.map(() => {});
		store.trim();
	`,
].map((code) => withDeclarations(code));

const invalid: Array<InvalidTestCase> = [
	{
		code: "list.map((x) => x * 2);",
		errors: [{ messageId: "ignoredMap" }],
	},
	{
		code: "list.map((item) => save(item));",
		errors: [{ messageId: "ignoredMap" }],
	},
	{
		code: "list.filter(Boolean);",
		errors: [{ data: { methodName: "filter" }, messageId: "ignoredReturn" }],
	},
	{ code: "text.trim();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: 'text.replace("a", "b");', errors: [{ messageId: "ignoredReturn" }] },
	{ code: "text.replace(/a/g);", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "n.toFixed(2);", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "date.getTime();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "date.getUTCFullYear();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: 're.test("a");', errors: [{ messageId: "ignoredReturn" }] },
	{ code: "Math.max(1, 2);", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "Math.random();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: '"abc".toUpperCase();', errors: [{ messageId: "ignoredReturn" }] },
	{ code: "lit.toUpperCase();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "(1.5).toFixed(0);", errors: [{ messageId: "ignoredReturn" }] },

	// oxlint-disable-next-line no-template-curly-in-string -- code under test
	{ code: "`a${text}`.trim();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "list.find((x) => x > 1);", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "list.some((x) => x > 1);", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "list.at(0);", errors: [{ messageId: "ignoredReturn" }] },
	{ code: 'text.replaceAll("a", "b");', errors: [{ messageId: "ignoredReturn" }] },
	// Readonly arrays and tuples have the same methods.
	{ code: "ro.map((x) => x);", errors: [{ messageId: "ignoredMap" }] },
	{ code: "tuple.map((x) => x);", errors: [{ messageId: "ignoredMap" }] },
	{ code: "frozen.filter(Boolean);", errors: [{ messageId: "ignoredReturn" }] },
	// The readonly methods of `Map` and `Set`.
	{ code: 'dict.get("a");', errors: [{ messageId: "ignoredReturn" }] },
	{ code: 'tags.has("a");', errors: [{ messageId: "ignoredReturn" }] },
	// A write to a parameter or a local stays inside the callback.
	{
		code: "list.reduce((sum, x) => { sum += x; return sum; }, 0);",
		errors: [{ messageId: "ignoredReturn" }],
	},
	{
		code: unindent`
			list.reduce((acc: Record<number, number>, x) => {
				acc[x] = x;
				return acc;
			}, {});
		`,
		errors: [{ messageId: "ignoredReturn" }],
	},
	{
		code: "list.find((x) => { let seen = 0; seen++; return x > seen; });",
		errors: [{ messageId: "ignoredReturn" }],
	},
	// An augmentation adds members, but the type is still the built-in.
	{
		code: unindent`
			declare global { interface Date { format(): string } }
			date.getTime();
		`,
		errors: [{ messageId: "ignoredReturn" }],
	},
	// A callback whose work is discarded with the array still reports.
	{
		code: "list.map((x) => { save(x); return x; });",
		errors: [{ messageId: "ignoredMap" }],
	},
	{ code: "maybe!.trim();", errors: [{ messageId: "ignoredReturn" }] },
	// The name comes from the key, so a literal key is the same method.
	{
		code: 'list["map"]((x: number) => x);',
		errors: [{ messageId: "ignoredMap" }],
	},
	{ code: "text[`trim`]();", errors: [{ messageId: "ignoredReturn" }] },
	// An assignment in a nested function does not count.
	{
		code: "list.find((x) => { const set = () => { found = x; }; return x > 1; });",
		errors: [{ messageId: "ignoredReturn" }],
	},
	// A callback passed by reference is not checked for assignments.
	{
		code: unindent`
			const isBig = (x: number): boolean => { found = x; return x > 1; };
			list.find(isBig);
		`,
		errors: [{ messageId: "ignoredReturn" }],
	},
	// A callback that returns a function does not run that function.
	{
		code: "list.find((x) => () => { found = x; });",
		errors: [{ messageId: "ignoredReturn" }],
	},
	{
		code: "list.find((x) => function () { found = x; });",
		errors: [{ messageId: "ignoredReturn" }],
	},
	{ code: "(text as string).trim();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "(text.trim());", errors: [{ messageId: "ignoredReturn" }] },
	{ code: 'Math["max"](1, 2);', errors: [{ messageId: "ignoredReturn" }] },
	{
		code: unindent`
			text.trim();
			list.map((x) => x);
		`,
		errors: [
			{ column: 1, endColumn: 12, line: 1, messageId: "ignoredReturn" },
			{ column: 1, endColumn: 19, line: 2, messageId: "ignoredMap" },
		],
	},
].map((testCase) => {
	// Report lines are written against the case body; shift them past the
	// shared declarations. Each case literal is used once, so it is updated
	// in place.
	const offset = DECLARATIONS.split("\n").length;
	testCase.code = withDeclarations(testCase.code);
	for (const error of testCase.errors) {
		if ("line" in error) {
			error.line += offset;
		}
	}

	return testCase;
});

run({
	name: RULE_NAME,
	invalid,
	rule: noIgnoredReturn,
	valid,
});

// Without type information the receiver kind is unknown, so nothing reports.
run({
	name: `${RULE_NAME} (untyped)`,
	parserOptions: { ecmaVersion: "latest", sourceType: "module" },
	rule: noIgnoredReturn,
	valid: ["declare const text: string; text.trim();", "[1].map((x) => x);"],
});

// cspell:words gsub setmetatable

// A replacement library, in the shape of the roblox-ts types, runs against
// `fixtures/no-ignored-return/no-lib`. Its files carry
// `/// <reference no-default-lib="true"/>`, so they count as library files.
const noLibraryDirectory = path.resolve(__dirname, "../../../fixtures/no-ignored-return/no-lib");

const NO_LIB_DECLARATIONS = unindent`
	declare const list: Array<number>;
	declare const view: ReadonlyArray<number>;
	declare const other: Array<number>;
	declare const text: string;
	declare const value: { a: number };
`;

function inNoLibrary<T extends { code: string }>(testCase: T): T {
	return {
		...testCase,
		code: `${NO_LIB_DECLARATIONS}\n${testCase.code}`,
		filename: path.join(noLibraryDirectory, "case.ts"),
	};
}

const pureFunctions = { pureFunctions: ["math", "table.clone", "typeIs"] };

run({
	name: `${RULE_NAME}/no-lib`,
	invalid: [
		{ code: "view.map((n) => n * 2);", errors: [{ messageId: "ignoredMap" }] },
		{ code: "list.size();", errors: [{ messageId: "ignoredReturn" }] },
		{ code: "list.isEmpty();", errors: [{ messageId: "ignoredReturn" }] },
		{ code: "list.filterUndefined();", errors: [{ messageId: "ignoredReturn" }] },
		{ code: "text.upper();", errors: [{ messageId: "ignoredReturn" }] },
		{ code: 'text.gsub("a", "b");', errors: [{ messageId: "ignoredReturn" }] },
		// A local interface in a package module does not replace the global.
		{
			code: unindent`
				import "@fixture/geo";
				text.upper();
			`,
			errors: [{ messageId: "ignoredReturn" }],
		},
		{
			code: "math.abs(-1);",
			errors: [{ data: { methodName: "abs" }, messageId: "ignoredReturn" }],
			options: [pureFunctions],
		},
		{
			code: "table.clone(value);",
			errors: [{ messageId: "ignoredReturn" }],
			options: [pureFunctions],
		},
		{
			code: 'typeIs(value, "table");',
			errors: [{ data: { methodName: "typeIs" }, messageId: "ignoredReturn" }],
			options: [pureFunctions],
		},
	].map(inNoLibrary),
	parserOptions: {
		ecmaVersion: "latest",
		project: path.join(noLibraryDirectory, "tsconfig.json"),
		sourceType: "module",
		tsconfigRootDir: noLibraryDirectory,
	},
	rule: noIgnoredReturn,
	valid: [
		// A namespace is pure only when an option names it.
		"math.abs(-1);",
		'typeIs(value, "table");',
		// A void method, a mutator, or one that writes into an argument.
		"list.forEach((n) => n);",
		"list.push(1);",
		"list.move(1, 2, 1, other);",
		"list.copyInto(other);",
		// A package module's class or augmentation is not the built-in.
		unindent`
			import { Map as GeoMap } from "@fixture/geo";
			declare const geo: GeoMap;
			geo.has("a");
			list.pick();
		`,
		'text.gsub("a", (match) => match);',
		// A namespace member returning void, or one the entry does not list.
		{ code: "math.randomseed(1);", options: [pureFunctions] },
		{ code: "table.freeze(value);", options: [pureFunctions] },
		{ code: "task.wait(1);", options: [pureFunctions] },
		{ code: "setmetatable(value, {});", options: [pureFunctions] },
		// A local shadows the library global.
		{
			code: "{ const math = { abs: (x: number): number => x }; math.abs(1); }",
			options: [pureFunctions],
		},
	].map((testCase) => inNoLibrary(typeof testCase === "string" ? { code: testCase } : testCase)),
});
