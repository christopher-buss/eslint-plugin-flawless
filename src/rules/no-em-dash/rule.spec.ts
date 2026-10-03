import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run, runYaml } from "../test";
import { noEmDash, RULE_NAME } from "./rule";

const messageId = "emDash";

// Built at runtime: lint autofix would turn an escaped U+2028 into a raw one,
// which then trips `no-multi-str`.
const LINE_SEPARATOR = String.fromCharCode(0x2028);

const valid: Array<ValidTestCase> = [
	unindent`
		// Plain prose - with a hyphen.
		export const label = "one - two";
	`,
	// En dash (U+2013) is not an em dash.
	unindent`
		// Pages 1\u20135 cover setup.
		export const range = "1\u20135";
	`,
	unindent`
		export const html = "&mdash;";
	`,
];

// The sentence runs back to the previous newline or terminator, so code
// before the dash on the same line is part of the reported range.
const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			// Keep it short \u2014 really.
			export const a = 1;
		`,
		errors: [{ column: 1, endColumn: 27, endLine: 1, line: 1, messageId }],
		output: null,
	},
	{
		code: 'export const s = "left \u2014 right";',
		errors: [{ column: 1, endColumn: 33, endLine: 1, line: 1, messageId }],
		output: null,
	},
	{
		// eslint-disable-next-line no-template-curly-in-string -- Test input is a template literal.
		code: "export const t = `a \u2014 ${b}`;",
		errors: [{ column: 1, endColumn: 29, endLine: 1, line: 1, messageId }],
		output: null,
	},
	{
		code: "export const el = <p>Wait \u2014 what? Fine.</p>;",
		errors: [{ column: 1, endColumn: 34, endLine: 1, line: 1, messageId }],
		filename: "file.tsx",
		output: null,
	},
	// Several dashes in one sentence report once.
	{
		code: unindent`
			// One \u2014 two \u2014 three.
			export const a = 1;
		`,
		errors: [{ column: 1, endColumn: 22, endLine: 1, line: 1, messageId }],
		output: null,
	},
	// Dashes in separate sentences report separately.
	{
		code: unindent`
			// One \u2014 two. Three \u2014 four!
			export const a = 1;
		`,
		errors: [
			{ column: 1, endColumn: 14, endLine: 1, line: 1, messageId },
			{ column: 15, endColumn: 28, endLine: 1, line: 1, messageId },
		],
		output: null,
	},
	// A newline bounds the sentence on both sides.
	{
		code: unindent`
			/*
			 * first line
			 * dash \u2014 here
			 * last line
			 */
			export const a = 1;
		`,
		errors: [{ column: 2, endColumn: 15, endLine: 3, line: 3, messageId }],
		output: null,
	},
	// CRLF: the `\r` stays out of the range.
	{
		code: "// a \u2014 b\r\n// c \u2014 d\r\nexport const a = 1;\r\n",
		errors: [
			{ column: 1, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 1, endColumn: 9, endLine: 2, line: 2, messageId },
		],
		output: null,
	},
	// CR-only line endings also bound the sentence.
	{
		code: "// a — b\r// c — d\rexport const a = 1;\r",
		errors: [
			{ column: 1, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 1, endColumn: 9, endLine: 2, line: 2, messageId },
		],
		output: null,
	},
	// U+2028 is a line break to ESLint, so it bounds the sentence too.
	{
		code: `/* a \u2014 b${LINE_SEPARATOR}c \u2014 d */\nexport const a = 1;\n`,
		errors: [
			{ column: 1, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 1, endColumn: 9, endLine: 2, line: 2, messageId },
		],
		output: null,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noEmDash,
	valid,
});

// Non-JS parsers also produce a `Program` root, so the rule covers them too.
runYaml({
	name: `${RULE_NAME} (yaml)`,
	invalid: [
		{
			code: "# note \u2014 here\nkey: value\n",
			errors: [{ column: 1, endColumn: 14, endLine: 1, line: 1, messageId }],
			output: null,
		},
	],
	rule: noEmDash,
	valid: ["key: value - plain\n"],
});
