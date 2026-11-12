import { TSESLint } from "@typescript-eslint/utils";

import toml from "eslint-plugin-toml";
import yml from "eslint-plugin-yml";
import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";
import { describe, expect, it } from "vitest";

import plugin from "../../index.ts";
import { run, runMarkdown, runToml, runYaml } from "../test.ts";
import { maxCommentLength, RULE_NAME } from "./rule.ts";

const messageId = "tooLong";

const valid: Array<ValidTestCase> = [
	// At the limit.
	{
		code: unindent`
			export const a = 1;
			// one two three
		`,
		options: [{ maximumWords: 3 }],
	},
	// A blank line splits two groups.
	{
		code: unindent`
			export const a = 1;
			// one two three

			// four five six
		`,
		options: [{ maximumWords: 3 }],
	},
	// The first group before any code is the file header.
	{
		code: unindent`
			// one two three four
			// five six seven
			export const a = 1;
		`,
		options: [{ maximumWords: 3 }],
	},
	// A shebang does not take the header slot.
	{
		code: "#!/usr/bin/env node\n// one two three four five\nexport const a = 1;\n",
		options: [{ maximumWords: 3 }],
	},
	// The comment after a shebang and a blank line is the header.
	{
		code: "#!/usr/bin/env node\n\n// one two three four\nexport const a = 1;\n",
		options: [{ maximumWords: 3 }],
	},
	// JSDoc is exempt by default.
	{
		code: unindent`
			export const a = 1;
			/** one two three four */
			export function run() {}
		`,
		options: [{ maximumWords: 3 }],
	},
	// The JSDoc `*` gutter is not a word.
	{
		code: unindent`
			export const a = 1;
			/*
			 * one
			 * two three
			 */
		`,
		options: [{ maximumWords: 3 }],
	},
	// Line comments on lines with code between them do not join.
	{
		code: unindent`
			export const a = 1;
			// one two
			export const b = 2;
			// three four
		`,
		options: [{ maximumWords: 2 }],
	},
	// A block comment does not join an adjacent line comment.
	{
		code: unindent`
			export const a = 1;
			/* one two */
			// three four
		`,
		options: [{ maximumWords: 2 }],
	},
	// A trailing comment does not join the comment on the next line.
	{
		code: unindent`
			export const a = 1; // one two
			// three four
			export const b = 2;
		`,
		options: [{ maximumWords: 2 }],
	},
	// Directives are not prose.
	{
		code: unindent`
			export const a = 1;
			// oxlint-disable-next-line no-console -- logging is needed for the CLI output
			console.log(a);
			// @ts-expect-error -- the upstream types are wrong for this overload today
			a.b();
			/* global window, document, navigator, location */
			/// <reference types="node" lib="dom" path="x" />
		`,
		options: [{ maximumWords: 3 }],
	},
	// A directive before the header keeps the header exempt.
	{
		code: unindent`
			// @ts-nocheck

			// one two three four five
			export const a = 1;
		`,
		options: [{ maximumWords: 3 }],
	},
	// Extra slashes and a closing star run are not words.
	{
		code: "export const a = 1;\n//// one two three\n/* four five six **/\n",
		options: [{ maximumWords: 3 }],
	},
	// Default limit is 50.
	`export const a = 1;\n// ${"word ".repeat(50)}\n`,
];

const invalid: Array<InvalidTestCase> = [
	// Adjacent line comments form one group.
	{
		code: unindent`
			export const a = 1;
			// one two three
			// four five six
		`,
		options: [{ maximumWords: 5 }],
		errors: [
			{
				column: 1,
				data: { count: 6, maximum: 5 },
				endColumn: 17,
				endLine: 3,
				line: 2,
				messageId,
			},
		],
	},
	// A banner is not JSDoc.
	{
		code: "export const a = 1;\n/***** one two three four *****/\n",
		options: [{ maximumWords: 3 }],
		errors: [{ data: { count: 4, maximum: 3 }, line: 2, messageId }],
	},
	// A directive splits groups and does not count.
	{
		code: unindent`
			export const a = 1;
			// one two three four
			// oxlint-disable-next-line no-console -- a long reason here
			console.log(a);
		`,
		options: [{ maximumWords: 3 }],
		errors: [{ data: { count: 4, maximum: 3 }, endLine: 2, line: 2, messageId }],
	},
	{
		code: "export const a = 1;\n/* one two three four */\n",
		options: [{ maximumWords: 3 }],
		errors: [
			{
				column: 1,
				data: { count: 4, maximum: 3 },
				endColumn: 25,
				endLine: 2,
				line: 2,
				messageId,
			},
		],
	},
	// JSDoc counts when `ignoreJSDoc` is off.
	{
		code: unindent`
			export const a = 1;
			/** one two three four */
			export function run() {}
		`,
		options: [{ ignoreJSDoc: false, maximumWords: 3 }],
		errors: [{ data: { count: 4, maximum: 3 }, line: 2, messageId }],
	},
	// Only the first group is the header.
	{
		code: unindent`
			// header

			// one two three four
			export const a = 1;
		`,
		options: [{ maximumWords: 3 }],
		errors: [{ data: { count: 4, maximum: 3 }, line: 3, messageId }],
	},
	// A comment-only file keeps only its first group as the header.
	{
		code: "// one two three four\n\n// five six seven eight\n",
		options: [{ maximumWords: 3 }],
		errors: [{ data: { count: 4, maximum: 3 }, line: 3, messageId }],
	},
	// CRLF line endings still join adjacent line comments.
	{
		code: "export const a = 1;\r\n// one two\r\n// three\r\n",
		options: [{ maximumWords: 2 }],
		errors: [{ data: { count: 3, maximum: 2 }, endLine: 3, line: 2, messageId }],
	},
	// Words do not merge across adjacent comments.
	{
		code: "export const a = 1;\n//one\n//two\n//three\n",
		options: [{ maximumWords: 2 }],
		errors: [{ data: { count: 3, maximum: 2 }, line: 2, messageId }],
	},
	// `//region` without `#` is prose.
	{
		code: "export const a = 1;\n//region one two three four\n",
		options: [{ maximumWords: 3 }],
		errors: [{ data: { count: 5, maximum: 3 }, line: 2, messageId }],
	},
	// Over the default limit of 50.
	{
		code: `export const a = 1;\n// ${"word ".repeat(51)}\n`,
		errors: [{ data: { count: 51, maximum: 50 }, line: 2, messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: maxCommentLength,
	valid,
});

const yamlValid: Array<ValidTestCase> = [
	// The `#` marker and extra `#` are not words.
	{
		code: "a: 1\n## one two three\n",
		options: [{ maximumWords: 3 }],
	},
	// The first group before any key is the file header.
	{
		code: "# one two three four\n# five six\na: 1\n",
		options: [{ maximumWords: 3 }],
	},
	// Directives are not prose.
	{
		code: unindent`
			# yaml-language-server: $schema=https://example.com/one/two/three.json
			a: 1
			# cspell:words one two three four
			b: 2
			#region one two three four
			c: 3
		`,
		options: [{ maximumWords: 3 }],
	},
	// A trailing comment does not join the comment on the next line.
	{
		code: "a: 1 # one two\n# three four\nb: 2\n",
		options: [{ maximumWords: 2 }],
	},
];

const yamlInvalid: Array<InvalidTestCase> = [
	// Adjacent `#` comments form one group.
	{
		code: "a: 1\n# one two three\n# four five six\nb: 2\n",
		errors: [
			{
				column: 1,
				data: { count: 6, maximum: 5 },
				endColumn: 16,
				endLine: 3,
				line: 2,
				messageId,
			},
		],
		options: [{ maximumWords: 5 }],
	},
	// A `#!` comment in YAML is prose, not a shebang.
	{
		code: "a: 1\n#!one two three four\n",
		errors: [{ data: { count: 4, maximum: 3 }, line: 2, messageId }],
		options: [{ maximumWords: 3 }],
	},
	// A space after `#` makes `region` prose.
	{
		code: "a: 1\n# region one two three\n",
		errors: [{ data: { count: 4, maximum: 3 }, line: 2, messageId }],
		options: [{ maximumWords: 3 }],
	},
	// A `# *` bullet is not JSDoc.
	{
		code: "a: 1\n# * one two three four\n",
		errors: [{ data: { count: 5, maximum: 3 }, line: 2, messageId }],
		options: [{ maximumWords: 3 }],
	},
	// A one-character word directly after `#` counts.
	{
		code: "a: 1\n#a b c d\n",
		errors: [{ data: { count: 4, maximum: 3 }, line: 2, messageId }],
		options: [{ maximumWords: 3 }],
	},
];

runYaml({
	name: `${RULE_NAME} (yaml)`,
	invalid: yamlInvalid,
	rule: maxCommentLength,
	valid: yamlValid,
});

runToml({
	name: `${RULE_NAME} (toml)`,
	invalid: [
		{
			code: "a = 1\n# one two three\n# four five six\n",
			options: [{ maximumWords: 5 }],
			errors: [{ data: { count: 6, maximum: 5 }, endLine: 3, line: 2, messageId }],
		},
	],
	rule: maxCommentLength,
	valid: [
		// The `#:schema` comment is a directive.
		{
			code: "#:schema ./one/two/three/four.json\na = 1\n# one two three\n",
			options: [{ maximumWords: 3 }],
		},
	],
});

// A language with no `Program` node does not make the config throw.
runMarkdown({
	name: `${RULE_NAME} (markdown)`,
	invalid: [],
	rule: maxCommentLength,
	valid: ["# Title\n"],
});

describe("language mode (Languages API)", () => {
	const options = { maximumWords: 3 };

	it("reports under the yaml language", () => {
		const linter = new TSESLint.Linter();
		const messages = linter.verify(
			"a: 1\n# one two three four\n",
			{
				files: ["**/*.yaml"],
				language: "yaml/yaml",
				plugins: { flawless: plugin, yaml: yml },
				rules: { "flawless/max-comment-length": ["error", options] },
			},
			{ filename: "file.yaml" },
		);
		expect(messages.map(({ line, messageId: id }) => ({ id, line }))).toStrictEqual([
			{ id: messageId, line: 2 },
		]);
	});

	it("reports under the toml language", () => {
		const linter = new TSESLint.Linter();
		const messages = linter.verify(
			"a = 1\n# one two three four\n",
			{
				files: ["**/*.toml"],
				language: "toml/toml",
				plugins: { flawless: plugin, toml },
				rules: { "flawless/max-comment-length": ["error", options] },
			},
			{ filename: "file.toml" },
		);
		expect(messages.map(({ line, messageId: id }) => ({ id, line }))).toStrictEqual([
			{ id: messageId, line: 2 },
		]);
	});
});
