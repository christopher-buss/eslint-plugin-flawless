import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noIgnoredReturn, RULE_NAME } from "./rule";

const DECLARATIONS = unindent`
	declare const list: number[];
	declare const text: string;
	declare const date: Date;
	declare const re: RegExp;
	declare const n: number;
	declare const lit: "a" | "b";
	declare const ro: ReadonlyArray<number>;
	declare const tuple: [number, number];
	declare const boxed: String;
	declare const branded: string & { __brand: "x" };
	declare const either: string | number;
	declare const maybe: string | undefined;
	declare const anyValue: any;
	declare function save(value: number): void;
	enum E { A }
	let found = 0;
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
	// A `find` callback that writes state works as a loop with an early exit.
	"list.find((x) => { found = x; return true; });",
	"list.findIndex((x) => (found = x) > 1);",
	"list.findLast(function (x) { found += x; return false; });",
	"list.findLastIndex((x) => { if (x > 1) { found = x; } return false; });",
	// Only `Array` itself is in the table.
	"ro.map((x) => x);",
	"tuple.map((x) => x);",
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
	// eslint-disable-next-line no-template-curly-in-string -- code under test
	{ code: "`a${text}`.trim();", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "list.find((x) => x > 1);", errors: [{ messageId: "ignoredReturn" }] },
	{ code: "maybe!.trim();", errors: [{ messageId: "ignoredReturn" }] },
	// The name comes from the key, so a literal key is the same method.
	{
		code: 'list["map"]((x: number) => x);',
		errors: [{ messageId: "ignoredMap" }],
	},
	{ code: "text[`trim`]();", errors: [{ messageId: "ignoredReturn" }] },
	// A union of two callbacks is not one function type.
	{
		code: unindent`
			declare const replacer: ((m: string) => string) | ((m: string, g: string) => string);
			text.replace(/a/g, replacer);
		`,
		errors: [{ messageId: "ignoredReturn" }],
	},
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
	// A local class named `Date` matches by name.
	{
		code: unindent`
			{
				class Date { getTime(): number { return 0; } }
				new Date().getTime();
			}
		`,
		errors: [{ messageId: "ignoredReturn" }],
	},
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
	// shared declarations.
	const offset = DECLARATIONS.split("\n").length;
	return {
		...testCase,
		code: withDeclarations(testCase.code),
		errors: testCase.errors.map((error) => {
			return "line" in error ? { ...error, line: error.line + offset } : error;
		}),
	};
});

run({
	name: RULE_NAME,
	invalid,
	rule: noIgnoredReturn,
	valid,
});
