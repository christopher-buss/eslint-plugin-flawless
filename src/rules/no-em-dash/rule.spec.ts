import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run, runMarkdown } from "../test";
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
	// Code is not prose: a dash in a regex literal is left alone.
	"export const pattern = /a\u2014b/u;",
	// An escape in source holds no raw dash.
	'export const dash = "\\u2014";',
];

const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			// Keep it short \u2014 really.
			export const a = 1;
		`,
		errors: [{ column: 4, endColumn: 27, endLine: 1, line: 1, messageId }],
		output: null,
	},
	{
		code: 'export const s = "left \u2014 right";',
		errors: [{ column: 19, endColumn: 31, endLine: 1, line: 1, messageId }],
		output: null,
	},
	{
		// eslint-disable-next-line no-template-curly-in-string -- Test input is a template literal.
		code: "export const t = `a \u2014 ${b}`;",
		errors: [{ column: 19, endColumn: 22, endLine: 1, line: 1, messageId }],
		output: null,
	},
	// The sentence stops at the `${` and `}` around an expression.
	{
		// eslint-disable-next-line no-template-curly-in-string -- Test input is a template literal.
		code: "export const t = `${a} x \u2014 y ${b} z`;",
		errors: [{ column: 24, endColumn: 29, endLine: 1, line: 1, messageId }],
		output: null,
	},
	{
		code: "export const el = <p>Wait \u2014 what? Fine.</p>;",
		errors: [{ column: 22, endColumn: 34, endLine: 1, line: 1, messageId }],
		filename: "file.tsx",
		output: null,
	},
	{
		code: 'export const el = <p title="a \u2014 b" />;',
		errors: [{ column: 29, endColumn: 34, endLine: 1, line: 1, messageId }],
		filename: "file.tsx",
		output: null,
	},
	{
		code: "/* a \u2014 b */\nexport const a = 1;",
		errors: [{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId }],
		output: null,
	},
	// The JSDoc `*` gutter stays out of the range.
	{
		code: unindent`
			/**
			 * Formats a label.
			 * Short form \u2014 long form \u2014 either works.
			 */
			export function format() {}
		`,
		errors: [{ column: 4, endColumn: 42, endLine: 3, line: 3, messageId }],
		output: null,
	},
	// Several dashes in one sentence report once.
	{
		code: unindent`
			// One \u2014 two \u2014 three.
			export const a = 1;
		`,
		errors: [{ column: 4, endColumn: 22, endLine: 1, line: 1, messageId }],
		output: null,
	},
	// Dashes in separate sentences report separately.
	{
		code: unindent`
			// One \u2014 two. Three \u2014 four!
			export const a = 1;
		`,
		errors: [
			{ column: 4, endColumn: 14, endLine: 1, line: 1, messageId },
			{ column: 15, endColumn: 28, endLine: 1, line: 1, messageId },
		],
		output: null,
	},
	// A line break bounds the sentence on both sides.
	{
		code: unindent`
			/*
			  first line
			  dash \u2014 here
			  last line
			*/
			export const a = 1;
		`,
		errors: [{ column: 3, endColumn: 14, endLine: 3, line: 3, messageId }],
		output: null,
	},
	// CRLF: the `\r` stays out of the range.
	{
		code: "// a \u2014 b\r\n// c \u2014 d\r\nexport const a = 1;\r\n",
		errors: [
			{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 4, endColumn: 9, endLine: 2, line: 2, messageId },
		],
		output: null,
	},
	// CR-only line endings also bound the sentence.
	{
		code: "// a \u2014 b\r// c \u2014 d\rexport const a = 1;\r",
		errors: [
			{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 4, endColumn: 9, endLine: 2, line: 2, messageId },
		],
		output: null,
	},
	// U+2028 is a line break to ESLint, so it bounds the sentence too.
	{
		code: `/* a \u2014 b${LINE_SEPARATOR}c \u2014 d */\nexport const a = 1;\n`,
		errors: [
			{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 1, endColumn: 6, endLine: 2, line: 2, messageId },
		],
		output: null,
	},
	// CRLF inside a template: the content comes from source, not the
	// normalized raw value.
	{
		code: "export const t = `first\r\nsecond — line`;\r\n",
		errors: [{ column: 1, endColumn: 14, endLine: 2, line: 2, messageId }],
		output: null,
	},
	// A single-line JSDoc block: the extra `*` stays out of the range.
	{
		code: "/** a — b. */\nexport const a = 1;\n",
		errors: [{ column: 5, endColumn: 11, endLine: 1, line: 1, messageId }],
		output: null,
	},
	// A triple-slash comment: the extra `/` stays out of the range.
	{
		code: "/// a — b\nexport const a = 1;\n",
		errors: [{ column: 5, endColumn: 10, endLine: 1, line: 1, messageId }],
		output: null,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noEmDash,
	valid,
});

runMarkdown({
	name: `${RULE_NAME} (markdown)`,
	invalid: [
		{
			code: "Hello — world. Bye.\n",
			errors: [{ column: 1, endColumn: 15, endLine: 1, line: 1, messageId }],
			output: null,
		},
		{
			code: "# Title — sub\n",
			errors: [{ column: 3, endColumn: 14, endLine: 1, line: 1, messageId }],
			output: null,
		},
		// A sentence spans emphasis and links.
		{
			code: "Some *bold — text* and [a link](https://example.com) here.\n",
			errors: [{ column: 1, endColumn: 59, endLine: 1, line: 1, messageId }],
			output: null,
		},
		{
			code: "- first item\n- item — x\n",
			errors: [{ column: 3, endColumn: 11, endLine: 2, line: 2, messageId }],
			output: null,
		},
		// Blockquote markers stay out of the range.
		{
			code: "> first line\n> second — line.\n",
			errors: [{ column: 3, endColumn: 17, endLine: 2, line: 2, messageId }],
			output: null,
		},
		// Alt text and titles are prose.
		{
			code: "![a — b](x.png)\n",
			errors: [{ column: 3, endColumn: 8, endLine: 1, line: 1, messageId }],
			output: null,
		},
		{
			code: '[t](x "c — d")\n',
			errors: [{ column: 8, endColumn: 13, endLine: 1, line: 1, messageId }],
			output: null,
		},
		{
			code: '[r]: https://x.test "e — f"\n',
			errors: [{ column: 22, endColumn: 27, endLine: 1, line: 1, messageId }],
			output: null,
		},
		// An escaped `\.` is literal text, not a terminator.
		{
			code: "a\\. b — c. d\n",
			errors: [{ column: 1, endColumn: 11, endLine: 1, line: 1, messageId }],
			output: null,
		},
	],
	rule: noEmDash,
	valid: [
		"Plain prose - with a hyphen.\n",
		// Code blocks, inline code, and HTML are not prose.
		"```\na — b\n```\n\nUse `a — b` here.\n\n<p>a — b</p>\n",
		// Autolink text is a URL, not prose.
		"See <https://x.test/a—b> now.\n",
	],
});

runMarkdown({
	name: `${RULE_NAME} (gfm)`,
	invalid: [
		{
			code: "| a — b | c |\n| - | - |\n| d | e |\n",
			errors: [{ column: 3, endColumn: 8, endLine: 1, line: 1, messageId }],
			output: null,
		},
	],
	language: "markdown/gfm",
	rule: noEmDash,
	valid: [
		// A GFM literal autolink is a URL, not prose.
		"See https://x.test/a—b now.\n",
	],
});
