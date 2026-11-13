import { TSESLint } from "@typescript-eslint/utils";

import toml from "eslint-plugin-toml";
import yml from "eslint-plugin-yml";
import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";
import { describe, expect, it } from "vitest";

import plugin from "../../index.ts";
import { run, runMarkdown, runToml, runYaml } from "../test.ts";
import { noEmDash, RULE_NAME } from "./rule.ts";

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
		output: null,
		errors: [{ column: 4, endColumn: 27, endLine: 1, line: 1, messageId }],
	},
	{
		code: 'export const s = "left \u2014 right";',
		output: null,
		errors: [{ column: 19, endColumn: 31, endLine: 1, line: 1, messageId }],
	},
	{
		// oxlint-disable-next-line no-template-curly-in-string -- Test input is a template literal.
		code: "export const t = `a \u2014 ${b}`;",
		output: null,
		errors: [{ column: 19, endColumn: 22, endLine: 1, line: 1, messageId }],
	},
	// The sentence stops at the `${` and `}` around an expression.
	{
		// oxlint-disable-next-line no-template-curly-in-string -- Test input is a template literal.
		code: "export const t = `${a} x \u2014 y ${b} z`;",
		output: null,
		errors: [{ column: 24, endColumn: 29, endLine: 1, line: 1, messageId }],
	},
	{
		filename: "file.tsx",
		code: "export const el = <p>Wait \u2014 what? Fine.</p>;",
		output: null,
		errors: [{ column: 22, endColumn: 34, endLine: 1, line: 1, messageId }],
	},
	{
		filename: "file.tsx",
		code: 'export const el = <p title="a \u2014 b" />;',
		output: null,
		errors: [{ column: 29, endColumn: 34, endLine: 1, line: 1, messageId }],
	},
	{
		code: "/* a \u2014 b */\nexport const a = 1;",
		output: null,
		errors: [{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId }],
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
		output: null,
		errors: [{ column: 4, endColumn: 42, endLine: 3, line: 3, messageId }],
	},
	// Several dashes in one sentence report once.
	{
		code: unindent`
			// One \u2014 two \u2014 three.
			export const a = 1;
		`,
		output: null,
		errors: [{ column: 4, endColumn: 22, endLine: 1, line: 1, messageId }],
	},
	// Dashes in separate sentences report separately.
	{
		code: unindent`
			// One \u2014 two. Three \u2014 four!
			export const a = 1;
		`,
		output: null,
		errors: [
			{ column: 4, endColumn: 14, endLine: 1, line: 1, messageId },
			{ column: 15, endColumn: 28, endLine: 1, line: 1, messageId },
		],
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
		output: null,
		errors: [{ column: 3, endColumn: 14, endLine: 3, line: 3, messageId }],
	},
	// CRLF: the `\r` stays out of the range.
	{
		code: "// a \u2014 b\r\n// c \u2014 d\r\nexport const a = 1;\r\n",
		output: null,
		errors: [
			{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 4, endColumn: 9, endLine: 2, line: 2, messageId },
		],
	},
	// CR-only line endings also bound the sentence.
	{
		code: "// a \u2014 b\r// c \u2014 d\rexport const a = 1;\r",
		output: null,
		errors: [
			{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 4, endColumn: 9, endLine: 2, line: 2, messageId },
		],
	},
	// U+2028 is a line break to ESLint, so it bounds the sentence too.
	{
		code: `/* a \u2014 b${LINE_SEPARATOR}c \u2014 d */\nexport const a = 1;\n`,
		output: null,
		errors: [
			{ column: 4, endColumn: 9, endLine: 1, line: 1, messageId },
			{ column: 1, endColumn: 6, endLine: 2, line: 2, messageId },
		],
	},
	// CRLF inside a template: the content comes from source, not the
	// normalized raw value.
	{
		code: "export const t = `first\r\nsecond — line`;\r\n",
		output: null,
		errors: [{ column: 1, endColumn: 14, endLine: 2, line: 2, messageId }],
	},
	// A single-line JSDoc block: the extra `*` stays out of the range.
	{
		code: "/** a — b. */\nexport const a = 1;\n",
		output: null,
		errors: [{ column: 5, endColumn: 11, endLine: 1, line: 1, messageId }],
	},
	// A triple-slash comment: the extra `/` stays out of the range.
	{
		code: "/// a — b\nexport const a = 1;\n",
		output: null,
		errors: [{ column: 5, endColumn: 10, endLine: 1, line: 1, messageId }],
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
			output: null,
			errors: [{ column: 1, endColumn: 15, endLine: 1, line: 1, messageId }],
		},
		{
			code: "# Title — sub\n",
			output: null,
			errors: [{ column: 3, endColumn: 14, endLine: 1, line: 1, messageId }],
		},
		// A sentence spans emphasis and links.
		{
			code: "Some *bold — text* and [a link](https://example.com) here.\n",
			output: null,
			errors: [{ column: 1, endColumn: 59, endLine: 1, line: 1, messageId }],
		},
		{
			code: "- first item\n- item — x\n",
			output: null,
			errors: [{ column: 3, endColumn: 11, endLine: 2, line: 2, messageId }],
		},
		// Blockquote markers stay out of the range.
		{
			code: "> first line\n> second — line.\n",
			output: null,
			errors: [{ column: 3, endColumn: 17, endLine: 2, line: 2, messageId }],
		},
		// Alt text and titles are prose.
		{
			code: "![a — b](x.png)\n",
			output: null,
			errors: [{ column: 3, endColumn: 8, endLine: 1, line: 1, messageId }],
		},
		{
			code: '[t](x "c — d")\n',
			output: null,
			errors: [{ column: 8, endColumn: 13, endLine: 1, line: 1, messageId }],
		},
		{
			code: '[r]: https://x.test "e — f"\n',
			output: null,
			errors: [{ column: 22, endColumn: 27, endLine: 1, line: 1, messageId }],
		},
		// An escaped `\.` is literal text, not a terminator.
		{
			code: "a\\. b — c. d\n",
			output: null,
			errors: [{ column: 1, endColumn: 11, endLine: 1, line: 1, messageId }],
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
			output: null,
			errors: [{ column: 3, endColumn: 8, endLine: 1, line: 1, messageId }],
		},
	],
	language: "markdown/gfm",
	rule: noEmDash,
	valid: [
		// A GFM literal autolink is a URL, not prose.
		"See https://x.test/a—b now.\n",
	],
});

runYaml({
	name: `${RULE_NAME} (yaml)`,
	invalid: [
		{
			code: "# Keep it short — really.\na: 1\n",
			output: null,
			errors: [{ column: 3, endColumn: 26, endLine: 1, line: 1, messageId }],
		},
		// Extra `#` after the marker stays out of the range.
		{
			code: "a: 1\n## a — b\n",
			output: null,
			errors: [{ column: 4, endColumn: 9, endLine: 2, line: 2, messageId }],
		},
		{
			code: "a: left — right\n",
			output: null,
			errors: [{ column: 4, endColumn: 16, endLine: 1, line: 1, messageId }],
		},
		// Quotes stay out of the range.
		{
			code: 'a: "left — right"\n',
			output: null,
			errors: [{ column: 5, endColumn: 17, endLine: 1, line: 1, messageId }],
		},
		{
			code: "a: 'x — y'\n",
			output: null,
			errors: [{ column: 5, endColumn: 10, endLine: 1, line: 1, messageId }],
		},
		// A key is a string too.
		{
			code: "a — b: 1\n",
			output: null,
			errors: [{ column: 1, endColumn: 6, endLine: 1, line: 1, messageId }],
		},
		// A comment on a block scalar header reports once, apart from the body.
		{
			code: "a: | # c — x\n  one — two\n",
			output: null,
			errors: [
				{ column: 8, endColumn: 13, endLine: 1, line: 1, messageId },
				{ column: 3, endColumn: 12, endLine: 2, line: 2, messageId },
			],
		},
		{
			code: "a: >-\n  First line.\n  Then — this.\n",
			output: null,
			errors: [{ column: 3, endColumn: 15, endLine: 3, line: 3, messageId }],
		},
	],
	rule: noEmDash,
	valid: [
		"# Plain prose - with a hyphen.\na: one - two\n",
		// An escape in source holds no raw dash.
		'a: "\\u2014"\n',
		// En dash (U+2013) is not an em dash.
		"a: 1\u20135\n",
	],
});

runToml({
	name: `${RULE_NAME} (toml)`,
	invalid: [
		{
			code: "# c — d\na = 1\n",
			output: null,
			errors: [{ column: 3, endColumn: 8, endLine: 1, line: 1, messageId }],
		},
		{
			code: 'a = "x — y"\n',
			output: null,
			errors: [{ column: 6, endColumn: 11, endLine: 1, line: 1, messageId }],
		},
		{
			code: "a = 'x — y'\n",
			output: null,
			errors: [{ column: 6, endColumn: 11, endLine: 1, line: 1, messageId }],
		},
		// Triple quotes stay out of the range.
		{
			code: 'a = """x — y"""\n',
			output: null,
			errors: [{ column: 8, endColumn: 13, endLine: 1, line: 1, messageId }],
		},
		{
			code: 'a = """\nFirst. x — y."""\n',
			output: null,
			errors: [{ column: 8, endColumn: 14, endLine: 2, line: 2, messageId }],
		},
		// A quoted key is a string too.
		{
			code: '"k — 1" = 1\n',
			output: null,
			errors: [{ column: 2, endColumn: 7, endLine: 1, line: 1, messageId }],
		},
	],
	rule: noEmDash,
	valid: [
		'# Plain prose - with a hyphen.\na = "one - two"\n',
		// An escape in source holds no raw dash.
		'a = "\\u2014"\n',
	],
});

describe("language mode (Languages API)", () => {
	it("reports under the yaml language", () => {
		const linter = new TSESLint.Linter();
		const messages = linter.verify(
			"# a — b\nc: d — e\n",
			{
				files: ["**/*.yaml"],
				language: "yaml/yaml",
				plugins: { flawless: plugin, yaml: yml },
				rules: { "flawless/no-em-dash": "error" },
			},
			{ filename: "file.yaml" },
		);
		expect(messages.map(({ line, messageId: id }) => ({ id, line }))).toStrictEqual([
			{ id: messageId, line: 1 },
			{ id: messageId, line: 2 },
		]);
	});

	it("reports under the toml language", () => {
		const linter = new TSESLint.Linter();
		const messages = linter.verify(
			'# a — b\nc = "d — e"\n',
			{
				files: ["**/*.toml"],
				language: "toml/toml",
				plugins: { flawless: plugin, toml },
				rules: { "flawless/no-em-dash": "error" },
			},
			{ filename: "file.toml" },
		);
		expect(messages.map(({ line, messageId: id }) => ({ id, line }))).toStrictEqual([
			{ id: messageId, line: 1 },
			{ id: messageId, line: 2 },
		]);
	});
});
