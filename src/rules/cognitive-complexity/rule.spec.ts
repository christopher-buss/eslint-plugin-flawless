import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test.ts";
import { cognitiveComplexity, RULE_NAME } from "./rule.ts";

const messageId = "tooComplex";
const filename = "file.tsx";

/** One report: line, column, end line, end column, score. */
type Expected = [number, number, number, number, number];

// Parity fixtures. The expected values come from the reference implementation
// of this metric (SonarJS S3776, 4.2.2), run at threshold 0 so that each
// function with a score above 0 reports. Only the numbers are kept here.
const PARITY: Array<[string, Array<Expected>]> = [
	["function f() { if (x) {} return a || b || c; }", [[1, 10, 1, 11, 1]]],
	["function f() { if (x) {} return a && b && c; }", [[1, 10, 1, 11, 2]]],
	["function f() { if (x) {} return a && b || c && d; }", [[1, 10, 1, 11, 3]]],
	["function f() { if (x) {} return a ?? b; }", [[1, 10, 1, 11, 1]]],
	["function f(n) { if (n) {} return f(n - 1); }", [[1, 10, 1, 11, 1]]],
	["function f() { if (a) { for (;;) { if (b) {} } } }", [[1, 10, 1, 11, 6]]],
	["function f() { if (a) {} else if (b) {} else {} }", [[1, 10, 1, 11, 3]]],
	["function f() { l: for (;;) { continue l; } }", [[1, 10, 1, 11, 2]]],
	["function f() { return a ? b ? 1 : 2 : 3; }", [[1, 10, 1, 11, 3]]],
	["function f() { try {} catch (e) { if (a) {} } finally {} }", [[1, 10, 1, 11, 3]]],
	[
		"function f() { switch (a) { case 1: if (b) {} break; case 2: break; } }",
		[[1, 10, 1, 11, 3]],
	],
	["function f() { return (a && b) && (c || d && e); }", [[1, 10, 1, 11, 2]]],
	["function f() { return !(a && b) && c; }", [[1, 10, 1, 11, 2]]],
	["function f() { return <div>{a && b && <span />}</div>; }", []],
	["function a() { function b() { function c() { if (x) {} } } }", [[1, 40, 1, 41, 1]]],
	["function named() { if (x) {} }", [[1, 10, 1, 15, 1]]],
	["export default function () { if (x) {} }", [[1, 16, 1, 24, 1]]],
	["export default async function () { if (x) {} }", [[1, 22, 1, 30, 1]]],
	["const f = function () { if (x) {} };", [[1, 11, 1, 19, 1]]],
	["const f = function g() { if (x) {} };", [[1, 11, 1, 19, 1]]],
	["const f = async function () { if (x) {} };", [[1, 17, 1, 25, 1]]],
	["(function () { if (a) {} })();", [[1, 2, 1, 10, 1]]],
	[
		"class C { m() { if (x) {} } get g() { if (x) {} return 1; } set s(v) { if (v) {} } }",
		[
			[1, 11, 1, 12, 1],
			[1, 33, 1, 34, 1],
			[1, 65, 1, 66, 1],
		],
	],
	[
		"class C { constructor() { if (a) {} } *gen() { if (a) {} } [k]() { if (x) {} } #q() { if (x) {} } }",
		[
			[1, 11, 1, 22, 1],
			[1, 40, 1, 43, 1],
			[1, 61, 1, 62, 1],
			[1, 80, 1, 82, 1],
		],
	],
	[
		"class C { p = () => { if (x) {} }; q = function () { if (x) {} }; }",
		[
			[1, 18, 1, 20, 1],
			[1, 40, 1, 48, 1],
		],
	],
	[
		"const o = { m() { if (x) {} }, n: function () { if (x) {} }, p: () => { if (x) {} } };",
		[
			[1, 13, 1, 14, 1],
			[1, 32, 1, 33, 1],
			[1, 68, 1, 70, 1],
		],
	],
	["const f = (): (() => void) => { if (x) {} return () => {}; };", [[1, 28, 1, 30, 1]]],
	["const f = async <T,>(x: T) => { if (x) {} };", [[1, 28, 1, 30, 1]]],
	["const f = (/* => */ x) => { if (x) {} };", [[1, 24, 1, 26, 1]]],
	["const f = () => ({ a: x ? 1 : 2 });", [[1, 14, 1, 16, 1]]],
	[
		"function f(g = () => x ? 1 : 2) { if (y) {} }",
		[
			[1, 10, 1, 11, 1],
			[1, 19, 1, 21, 1],
		],
	],
	["function f(): void; function f(x?: number): void { if (x) {} }", [[1, 30, 1, 31, 1]]],
	["const f = () => {\n\tif (a) {\n\t\tfor (;;) {}\n\t}\n};", [[1, 14, 1, 16, 3]]],
	["function f() {\n\treturn () =>\n\t\ta ? 1 : 2;\n}", [[2, 12, 2, 14, 1]]],
	["function f() { if (a) {} else { if (b) {} } }", [[1, 10, 1, 11, 4]]],
	["function f() { if (a) {} else if (b) { if (c) {} } }", [[1, 10, 1, 11, 4]]],
	["function f() { for (; a ? 1 : 2;) {} }", [[1, 10, 1, 11, 2]]],
	[
		"function f() { do {} while (a ? b : c); for (let i = a ? 1 : 2; i < (b ? 1 : 2); i++) {} }",
		[[1, 10, 1, 11, 5]],
	],
	[
		"function f() { switch (a) { case 1: if (b) {} break; case 2: if (c) {} } }",
		[[1, 10, 1, 11, 5]],
	],
	["function f() { switch (a ? 1 : 2) { case b ? 1 : 2: break; } }", [[1, 10, 1, 11, 4]]],
	["function f() { try { if (a) {} } catch { for (;;) {} } }", [[1, 10, 1, 11, 4]]],
	[
		"function f() { if (a) { function g() { if (b) { function h() { if (c) {} } } } } }",
		[
			[1, 10, 1, 11, 1],
			[1, 34, 1, 35, 1],
			[1, 58, 1, 59, 1],
		],
	],
	[
		"function f() { if (a) { const g = () => { if (b) {} }; } }",
		[
			[1, 10, 1, 11, 1],
			[1, 38, 1, 40, 1],
		],
	],
	[
		"function f() { return a ? () => { if (b) {} } : null; }",
		[
			[1, 10, 1, 11, 1],
			[1, 30, 1, 32, 1],
		],
	],
	["function f() { if (a) { return b ? c : d; } }", [[1, 10, 1, 11, 3]]],
	["function f() { return a ? b : c ? d : e; }", [[1, 10, 1, 11, 3]]],
	[
		"function f() { while (a) { if (b) {} else if (c) { if (d) {} } else { if (e) {} } } }",
		[[1, 10, 1, 11, 11]],
	],
	[
		"function f() { for (const x of y) { for (const z in x) { while (z) { do {} while (q); } } } }",
		[[1, 10, 1, 11, 10]],
	],
	["function f() { if (a) x(); else y(); }", [[1, 10, 1, 11, 2]]],
	[
		"function f() { class C { x = a ? 1 : 2; m() { if (b) {} } } }",
		[
			[1, 10, 1, 11, 1],
			[1, 41, 1, 42, 1],
		],
	],
	["function f() { if (a) { class C { x = b ? 1 : 2; } } }", [[1, 10, 1, 11, 3]]],
	["if (x) {} for (;;) {}", []],
	["class C { x = a ? 1 : 2; static { if (x) {} } }", []],
	["function f() { return a && b && c || d; }", [[1, 10, 1, 11, 1]]],
	["function f() { return a || b && c; }", [[1, 10, 1, 11, 1]]],
	["function f() { return (a && b) || (c && d); }", [[1, 10, 1, 11, 2]]],
	["function f() { return a && (b && c); }", [[1, 10, 1, 11, 1]]],
	["function f() { return a && (b || c) && d; }", [[1, 10, 1, 11, 2]]],
	["function f() { return (a && b) as boolean && c; }", [[1, 10, 1, 11, 2]]],
	["function f() { return x = a && b; }", [[1, 10, 1, 11, 1]]],
	["function f() { return a && b ? c : d; }", [[1, 10, 1, 11, 2]]],
	["function f() { if (a && !b) {} while (c || d) {} }", [[1, 10, 1, 11, 3]]],
	["function f() { a &&= b; a ??= c; a ||= d; }", []],
	["function f() { return a?.b ?? c; }", []],
	["function f() { return <div>{a && <X />}</div>; }", []],
	["function f() { return <div>{a && b || <X />}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{a ? <X /> : <Y />}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{a || b}</div>; }", []],
	["function f() { return <div attr={a && b} />; }", []],
	["function f() { return <>{a && b}</>; }", []],
	["function f() { return <div>{a && (b ? <X /> : <Y />)}</div>; }", [[1, 10, 1, 11, 2]]],
	["function f() { return <div>{a && b && (c ? 1 : 2)}</div>; }", [[1, 10, 1, 11, 2]]],
	["function f() { return <div>{a && f(b ? 1 : 2)}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{a && (() => b ? 1 : 2)}</div>; }", [[1, 38, 1, 40, 1]]],
	["function f() { return <div>{f(a && b)}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{a || b && c}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{a && b && (c || d)}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{!(a && b)}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{a && <X p={b ? 1 : 2} />}</div>; }", [[1, 10, 1, 11, 1]]],
	["function f() { return <div>{a ? b && c : <X />}</div>; }", [[1, 10, 1, 11, 2]]],
	["function f() { return <div>{a && b && <X q={c && d} />}</div>; }", []],
	["function f() { for (;;) { break; } }", [[1, 10, 1, 11, 1]]],
	["function f() { l: for (;;) { break l; } }", [[1, 10, 1, 11, 2]]],
	["function f() { l: while (a) { break l; } m: for (;;) { break; } }", [[1, 10, 1, 11, 3]]],
	["function f() { for (const k in o) { if (k) continue; } }", [[1, 10, 1, 11, 3]]],
	["function f() { l: { break l; } }", [[1, 10, 1, 11, 1]]],
];

const valid: Array<ValidTestCase> = [
	...PARITY.filter(([, reports]) => reports.length === 0).map(([code]) => {
		return { code, filename, options: [{ threshold: 0 }] };
	}),
	// At the threshold: no report.
	{
		code: "function f() { if (a) {} if (b) {} }",
		options: [{ threshold: 2 }],
	},
	// The default threshold is 15.
	{
		code: unindent`
			function f() {
				if (a) {} if (b) {} if (c) {} if (d) {} if (e) {}
				if (f) {} if (g) {} if (h) {} if (i) {} if (j) {}
				if (k) {} if (l) {} if (m) {} if (n) {} if (o) {}
			}
		`,
	},
	// Known difference: a function that is a branch of `?:` does not raise the
	// nesting level of the code after it. The reference gives 3 here.
	{
		code: "function f() { g(t ? 1 : () => 1); if (u) {} }",
		options: [{ threshold: 2 }],
	},
	// A nested function does not add to the outer score.
	{
		code: unindent`
			function f() {
				if (a) {}
				const g = () => { if (b) {} };
			}
		`,
		options: [{ threshold: 1 }],
	},
];

const invalid: Array<InvalidTestCase> = [
	...PARITY.filter(([, reports]) => reports.length > 0).map(([code, reports]) => {
		return {
			code,
			errors: reports.map(([line, column, endLine, endColumn, complexity]) => {
				return {
					column,
					data: { complexity, threshold: 0 },
					endColumn,
					endLine,
					line,
					messageId,
				};
			}),
			filename,
			options: [{ threshold: 0 }],
		};
	}),
	// Known difference (see above): a function that is a branch of `?:` does
	// not raise the nesting level of the code after it. Each row gives the
	// score of this rule, then the score of the reference.
	...(
		[
			// Function in the alternate (reference: 3).
			["function f() { g(t ? 1 : () => 1); if (u) {} }", 2],
			// Function in the consequent (reference: 3).
			["function f() { g(t ? () => 1 : 1); if (u) {} }", 2],
			// Function expression (reference: 3).
			["function f() { g(t ? 1 : function () { return 1; }); if (u) {} }", 2],
			// Two such branches; the reference adds up the levels (reference: 6).
			["function f() { g(t ? 1 : () => 1); g(t ? 1 : () => 1); if (u) {} }", 3],
			// Inside an `if`; the level does not stay after the `if` (reference:
			// 5).
			["function f() { if (s) { g(t ? 1 : () => 1); } if (u) {} }", 4],
			// A later `?:` (reference: 3).
			["function f() { g(t ? 1 : () => 1); g(u ? 1 : 2); }", 2],
		] as const
	).map(([code, complexity]) => {
		return {
			code,
			errors: [{ data: { complexity, threshold: 1 }, messageId }],
			options: [{ threshold: 1 }],
		};
	}),
	// Above the threshold: report.
	{
		code: "function f() { if (a) {} if (b) {} if (c) {} }",
		options: [{ threshold: 2 }],
		errors: [{ data: { complexity: 3, threshold: 2 }, messageId }],
	},
	// Above the default threshold of 15.
	{
		code: unindent`
			function f() {
				if (a) {} if (b) {} if (c) {} if (d) {} if (e) {}
				if (f) {} if (g) {} if (h) {} if (i) {} if (j) {}
				if (k) {} if (l) {} if (m) {} if (n) {} if (o) {}
				if (p) {}
			}
		`,
		errors: [{ data: { complexity: 16, threshold: 15 }, messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	parserOptions: {
		ecmaFeatures: { jsx: true },
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: cognitiveComplexity,
	valid,
});
