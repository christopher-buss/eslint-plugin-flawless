import { TSESLint } from "@typescript-eslint/utils";

import yml from "eslint-plugin-yml";
import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";
import { describe, expect, it } from "vitest";
import * as yamlParser from "yaml-eslint-parser";

import plugin from "../../index.ts";
import { runYaml } from "../test.ts";
import { RULE_NAME, yamlSortSequenceByKey } from "./rule.ts";

const root = [{ key: "name", pathPattern: "^$" }];

const valid: Array<ValidTestCase> = [
	// Already sorted.
	{
		code: unindent`
			- name: a
			- name: b
		`,
		options: root,
	},
	// Path does not match.
	{
		code: unindent`
			labels:
			  - name: b
			  - name: a
		`,
		options: root,
	},
	// An entry without the key skips the whole sequence.
	{
		code: unindent`
			- name: b
			- color: red
			- name: a
		`,
		options: root,
	},
	// A non-mapping entry skips the whole sequence.
	{
		code: unindent`
			- name: b
			- a
		`,
		options: root,
	},
	// A non-scalar key value skips the whole sequence.
	{
		code: unindent`
			- name: [b]
			- name: a
		`,
		options: root,
	},
	// Duplicate keys keep their order.
	{
		code: unindent`
			- name: a
			  id: 2
			- name: a
			  id: 1
		`,
		options: root,
	},
	// An alias must stay after its anchor.
	{
		code: unindent`
			- name: b
			  base: &base { x: 1 }
			- name: a
			  base: *base
		`,
		options: root,
	},
	// Desc.
	{
		code: unindent`
			- name: b
			- name: a
		`,
		options: [{ key: "name", order: { type: "desc" }, pathPattern: "^$" }],
	},
	// natural is off by default: code-unit order puts item10 first.
	{
		code: unindent`
			- name: item10
			- name: item2
		`,
		options: root,
	},
	// An entry that redefines an anchor used by an earlier alias keeps order.
	{
		code: unindent`
			base: &x 0
			list:
			  - name: b
			    v: *x
			  - name: a
			    v: &x 1
		`,
		options: [{ key: "name", pathPattern: "^list$" }],
	},
	// A boolean key value skips the sequence.
	{
		code: unindent`
			- name: b
			- name: a
			- name: true
		`,
		options: root,
	},
	// An empty entry skips the sequence.
	{
		code: unindent`
			- name: b
			-
			- name: a
		`,
		options: root,
	},
	// An anchor on a key, or inside a nested sequence, and an alias inside a
	// tagged node all count for keeping order.
	{
		code: unindent`
			- name: b
			  &k extra: 1
			- name: a
			  *k : 2
		`,
		options: root,
	},
	{
		code: unindent`
			- name: b
			  tags: [&t x]
			- name: a
			  refs: !!seq [*t]
		`,
		options: root,
	},
	// A string and a number are never compared.
	{
		code: unindent`
			- name: b
			- name: 1
			- name: a
		`,
		options: root,
	},
	// .nan never counts as out of order (and must not loop).
	{
		code: unindent`
			- id: .nan
			- id: 1
		`,
		options: [{ key: "id", pathPattern: "^$" }],
	},
	{
		code: unindent`
			- id: 1
			- id: .nan
		`,
		options: [{ key: "id", pathPattern: "^$" }],
	},
	{
		code: unindent`
			- id: .nan
			- id: .nan
		`,
		options: [{ key: "id", pathPattern: "^$" }],
	},
];

const labels = unindent`
	# GitHub Labels Configuration

	- name: feature
	  color: 0e8a16
	  description: New feature

	- name: bug
	  color: d73a4a
	  description: Bug fix

	# Additional Project Labels
	- name: experiment
	  color: 5319e7
	  description: Experimental changes
`;

const labelsFixed = unindent`
	# GitHub Labels Configuration

	- name: bug
	  color: d73a4a
	  description: Bug fix

	# Additional Project Labels
	- name: experiment
	  color: 5319e7
	  description: Experimental changes

	- name: feature
	  color: 0e8a16
	  description: New feature
`;

const invalid: Array<InvalidTestCase> = [
	// Labels file: header stays, comments move with their entry, blank lines
	// kept.
	{
		code: labels,
		output: labelsFixed,
		options: root,
		errors: [
			{
				message:
					"Expected sequence entries to be in ascending order by 'name'. 'feature' should be after 'experiment'.",
			},
		],
	},
	// Desc.
	{
		code: unindent`
			- name: a
			- name: b
		`,
		output: unindent`
			- name: b
			- name: a
		`,
		options: [{ key: "name", order: { type: "desc" }, pathPattern: "^$" }],
		errors: [
			{
				column: 3,
				data: { key: "name", orderText: "descending", targetValue: "a", thisValue: "b" },
				line: 2,
				messageId: "shouldBeBefore",
			},
		],
	},
	// Natural.
	{
		code: unindent`
			- name: item10
			- name: item2
		`,
		output: unindent`
			- name: item2
			- name: item10
		`,
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		errors: [
			{
				column: 3,
				data: {
					key: "name",
					orderText: "natural ascending",
					targetValue: "item10",
					thisValue: "item2",
				},
				line: 2,
				messageId: "shouldBeBefore",
			},
		],
	},
	// Natural order matches the natural-compare package used by yml.
	{
		code: unindent`
			- name: a1
			- name: a-1
		`,
		output: unindent`
			- name: a-1
			- name: a1
		`,
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	{
		code: unindent`
			- name: x10
			- name: x 2
		`,
		output: unindent`
			- name: x 2
			- name: x10
		`,
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	{
		code: unindent`
			- name: a1
			- name: a_b
		`,
		output: unindent`
			- name: a_b
			- name: a1
		`,
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// pathPattern has no `u` flag, so an identity escape is valid.
	{
		code: unindent`
			a-b:
			  - name: b
			  - name: a
		`,
		output: unindent`
			a-b:
			  - name: a
			  - name: b
		`,
		options: [{ key: "name", pathPattern: String.raw`^\["a\-b"\]$` }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// Case sensitive by default: uppercase sorts first.
	{
		code: unindent`
			- name: a
			- name: B
		`,
		output: unindent`
			- name: B
			- name: a
		`,
		options: root,
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// Case insensitive.
	{
		code: unindent`
			- name: B
			- name: a
		`,
		output: unindent`
			- name: a
			- name: B
		`,
		options: [{ key: "name", order: { caseSensitive: false }, pathPattern: "^$" }],
		errors: [
			{
				column: 3,
				data: {
					key: "name",
					orderText: "insensitive ascending",
					targetValue: "B",
					thisValue: "a",
				},
				line: 2,
				messageId: "shouldBeBefore",
			},
		],
	},
	// Nested path; first matching option wins.
	{
		code: unindent`
			updates:
			  - name: b
			  - name: a
		`,
		output: unindent`
			updates:
			  - name: a
			  - name: b
		`,
		options: [
			{ key: "name", pathPattern: "^updates$" },
			{ key: "name", order: { type: "desc" }, pathPattern: ".*" },
		],
		errors: [
			{
				column: 5,
				data: { key: "name", orderText: "ascending", targetValue: "b", thisValue: "a" },
				line: 3,
				messageId: "shouldBeBefore",
			},
		],
	},
	// Deeper nested path syntax.
	{
		code: unindent`
			foo:
			  bar:
			    - baz:
			        - id: 2
			        - id: 1
		`,
		output: unindent`
			foo:
			  bar:
			    - baz:
			        - id: 1
			        - id: 2
		`,
		options: [{ key: "id", pathPattern: "^foo\\.bar\\[0\\]\\.baz$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// No blank lines between entries stays that way; leading comment moves.
	{
		code: unindent`
			- name: c
			# about b
			- name: b
			- name: a
		`,
		output: unindent`
			- name: a
			# about b
			- name: b
			- name: c
		`,
		options: root,
		errors: [{ messageId: "shouldBeBefore" }, { messageId: "shouldBeBefore" }],
	},
	// Trailing inline comments move with their entry.
	{
		code: unindent`
			- name: b # second
			  color: x # b color
			- name: a # first
		`,
		output: unindent`
			- name: a # first
			- name: b # second
			  color: x # b color
		`,
		options: root,
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// A loose comment between entries: report without a fix.
	{
		code: unindent`
			- name: b

			# loose

			- name: a
		`,
		output: null,
		options: root,
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// Flow sequence.
	{
		code: "list: [{ name: b }, { name: c }, { name: a }]\n",
		output: "list: [{ name: a }, { name: b }, { name: c }]\n",
		options: [{ key: "name", pathPattern: "^list$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// Duplicate keys keep their relative order.
	{
		code: unindent`
			- name: b
			- name: a
			  id: 1
			- name: a
			  id: 2
		`,
		output: unindent`
			- name: a
			  id: 1
			- name: a
			  id: 2
			- name: b
		`,
		options: root,
		errors: [
			{
				column: 3,
				data: { key: "name", orderText: "ascending", targetValue: "a", thisValue: "b" },
				line: 1,
				messageId: "shouldBeAfter",
			},
		],
	},
	// Anchors: unrelated entries still sort, the alias stays after its anchor.
	{
		code: unindent`
			- name: c
			  base: &base 1
			- name: b
			- name: a
			  base: *base
		`,
		output: unindent`
			- name: b
			- name: c
			  base: &base 1
			- name: a
			  base: *base
		`,
		options: root,
		errors: [
			{
				column: 3,
				data: { key: "name", orderText: "ascending", targetValue: "c", thisValue: "b" },
				line: 3,
				messageId: "shouldBeBefore",
			},
		],
	},
	// Numbers compare numerically.
	{
		code: unindent`
			- id: 10
			- id: 9
		`,
		output: unindent`
			- id: 9
			- id: 10
		`,
		options: [{ key: "id", pathPattern: "^$" }],
		errors: [
			{
				column: 3,
				data: { key: "id", orderText: "ascending", targetValue: "10", thisValue: "9" },
				line: 2,
				messageId: "shouldBeBefore",
			},
		],
	},
	// An alias to an anchor outside the sequence does not block sorting.
	{
		code: unindent`
			base: &x 0
			list:
			  - name: b
			  - name: a
			    v: *x
		`,
		output: unindent`
			base: &x 0
			list:
			  - name: a
			    v: *x
			  - name: b
		`,
		options: [{ key: "name", pathPattern: "^list$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// A null value inside an entry is fine; explicit asc works.
	{
		code: unindent`
			- name: b
			  v:
			- name: a
		`,
		output: unindent`
			- name: a
			- name: b
			  v:
		`,
		options: [{ key: "name", order: { type: "asc" }, pathPattern: "^$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// Report targets: the first earlier entry that should follow.
	{
		code: unindent`
			- name: a
			- name: c
			- name: d
			- name: b
		`,
		output: unindent`
			- name: a
			- name: b
			- name: c
			- name: d
		`,
		options: root,
		errors: [
			{
				data: { key: "name", orderText: "ascending", targetValue: "c", thisValue: "b" },
				line: 4,
				messageId: "shouldBeBefore",
			},
		],
	},
	// Report targets: else the last later entry that should precede.
	{
		code: unindent`
			- name: c
			- name: a
			- name: b
			- name: d
		`,
		output: unindent`
			- name: a
			- name: b
			- name: c
			- name: d
		`,
		options: root,
		errors: [
			{
				data: { key: "name", orderText: "ascending", targetValue: "b", thisValue: "c" },
				line: 1,
				messageId: "shouldBeAfter",
			},
		],
	},
	// Path names: a number key uses its source text, a quoted key its value.
	{
		code: unindent`
			1:
			  - name: b
			  - name: a
		`,
		output: unindent`
			1:
			  - name: a
			  - name: b
		`,
		options: [{ key: "name", pathPattern: String.raw`^\["1"\]$` }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	{
		code: unindent`
			"my list":
			  - name: b
			  - name: a
		`,
		output: unindent`
			"my list":
			  - name: a
			  - name: b
		`,
		options: [{ key: "name", pathPattern: String.raw`^\["my list"\]$` }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// Numbers show only the direction, even with string-only options.
	{
		code: unindent`
			- id: 2
			- id: 1
		`,
		output: unindent`
			- id: 1
			- id: 2
		`,
		options: [{ key: "id", order: { caseSensitive: false, natural: true }, pathPattern: "^$" }],
		errors: [
			{
				data: { key: "id", orderText: "ascending", targetValue: "2", thisValue: "1" },
				messageId: "shouldBeBefore",
			},
		],
	},
	// An anchored entry still sorts.
	{
		code: unindent`
			- &x
			  name: b
			- name: a
		`,
		output: unindent`
			- name: a
			- &x
			  name: b
		`,
		options: root,
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// A tagged entry still sorts.
	{
		code: unindent`
			- !!map
			  name: b
			- name: a
		`,
		output: unindent`
			- name: a
			- !!map
			  name: b
		`,
		options: root,
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// A comment in another column than the dash is loose: no fix.
	{
		code: unindent`
			- name: b
			  color: x
			  # about b color
			- name: a
		`,
		output: null,
		options: root,
		errors: [{ messageId: "shouldBeBefore" }],
	},
	{
		code: unindent`
			labels:
			  - name: b
			# about a
			  - name: a
		`,
		output: null,
		options: [{ key: "name", pathPattern: "^labels$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// A nested comment in the dash's column moves with its entry.
	{
		code: unindent`
			labels:
			  - name: b
			  # about a
			  - name: a
		`,
		output: unindent`
			labels:
			  # about a
			  - name: a
			  - name: b
		`,
		options: [{ key: "name", pathPattern: "^labels$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
	// Pins current behaviour, same as yml/sort-sequence-values: entries that
	// define the same anchor still swap, so the outer alias changes target.
	{
		code: unindent`
			list:
			  - name: b
			    v: &x 2
			  - name: a
			    v: &x 1
			ref: *x
		`,
		output: unindent`
			list:
			  - name: a
			    v: &x 1
			  - name: b
			    v: &x 2
			ref: *x
		`,
		options: [{ key: "name", pathPattern: "^list$" }],
		errors: [{ messageId: "shouldBeBefore" }],
	},
];

runYaml({
	name: RULE_NAME,
	invalid,
	rule: yamlSortSequenceByKey,
	valid,
});

describe("idempotent fix", () => {
	const config: TSESLint.FlatConfig.Config = {
		files: ["**/*.yaml"],
		languageOptions: { parser: yamlParser },

		plugins: { flawless: plugin },
		rules: { "flawless/yaml-sort-sequence-by-key": ["error", ...root] },
	};

	it("converges in one pass and leaves no reports", () => {
		const linter = new TSESLint.Linter();
		const { messages, output } = linter.verifyAndFix(labels, config, {
			filename: "labels.yaml",
		});
		expect(output).toBe(labelsFixed);
		expect(messages).toHaveLength(0);
		expect(linter.verify(labelsFixed, config, { filename: "labels.yaml" })).toHaveLength(0);
	});
});

describe("yaml language mode (Languages API)", () => {
	const config: TSESLint.FlatConfig.Config = {
		files: ["**/*.yaml"],
		language: "yaml/yaml",

		plugins: {
			flawless: plugin,
			yaml: yml,
		},
		rules: { "flawless/yaml-sort-sequence-by-key": ["error", ...root] },
	};

	const code = unindent`
		- name: b
		- name: a
	`;

	it("reports under the language provider", () => {
		const linter = new TSESLint.Linter();
		const messages = linter.verify(code, config, { filename: "file.yaml" });
		expect(messages).toHaveLength(1);
		expect(messages[0]?.messageId).toBe("shouldBeBefore");
	});

	it("fixes identically to parser mode", () => {
		const linter = new TSESLint.Linter();
		const { output } = linter.verifyAndFix(code, config, { filename: "file.yaml" });
		expect(output).toBe(
			unindent`
				- name: a
				- name: b
			`,
		);
	});
});
