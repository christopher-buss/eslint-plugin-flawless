import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { maxCommentLength, RULE_NAME } from "./rule";

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
		options: [{ maximumWords: 5 }],
	},
	// A banner is not JSDoc.
	{
		code: "export const a = 1;\n/***** one two three four *****/\n",
		errors: [{ data: { count: 4, maximum: 3 }, line: 2, messageId }],
		options: [{ maximumWords: 3 }],
	},
	// A directive splits groups and does not count.
	{
		code: unindent`
			export const a = 1;
			// one two three four
			// oxlint-disable-next-line no-console -- a long reason here
			console.log(a);
		`,
		errors: [{ data: { count: 4, maximum: 3 }, endLine: 2, line: 2, messageId }],
		options: [{ maximumWords: 3 }],
	},
	{
		code: "export const a = 1;\n/* one two three four */\n",
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
		options: [{ maximumWords: 3 }],
	},
	// JSDoc counts when `ignoreJSDoc` is off.
	{
		code: unindent`
			export const a = 1;
			/** one two three four */
			export function run() {}
		`,
		errors: [{ data: { count: 4, maximum: 3 }, line: 2, messageId }],
		options: [{ ignoreJSDoc: false, maximumWords: 3 }],
	},
	// Only the first group is the header.
	{
		code: unindent`
			// header

			// one two three four
			export const a = 1;
		`,
		errors: [{ data: { count: 4, maximum: 3 }, line: 3, messageId }],
		options: [{ maximumWords: 3 }],
	},
	// A comment-only file keeps only its first group as the header.
	{
		code: "// one two three four\n\n// five six seven eight\n",
		errors: [{ data: { count: 4, maximum: 3 }, line: 3, messageId }],
		options: [{ maximumWords: 3 }],
	},
	// CRLF line endings still join adjacent line comments.
	{
		code: "export const a = 1;\r\n// one two\r\n// three\r\n",
		errors: [{ data: { count: 3, maximum: 2 }, endLine: 3, line: 2, messageId }],
		options: [{ maximumWords: 2 }],
	},
	// Words do not merge across adjacent comments.
	{
		code: "export const a = 1;\n//one\n//two\n//three\n",
		errors: [{ data: { count: 3, maximum: 2 }, line: 2, messageId }],
		options: [{ maximumWords: 2 }],
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
