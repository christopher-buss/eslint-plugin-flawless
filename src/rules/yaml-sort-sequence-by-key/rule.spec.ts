import { Linter } from "eslint";
import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import { describe, expect, it } from "vitest";
import * as yamlParser from "yaml-eslint-parser";

import plugin from "../../index";
import { runYaml } from "../test";
import { RULE_NAME, yamlSortSequenceByKey } from "./rule";

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
	// No options: the rule does nothing.
	unindent`
		- name: b
		- name: a
	`,
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
		errors: [
			{
				message:
					"Expected sequence entries to be in ascending order by 'name'. 'feature' should be after 'experiment'.",
			},
		],
		options: root,
		output: labelsFixed,
	},
	// Desc.
	{
		code: unindent`
			- name: a
			- name: b
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", order: { type: "desc" }, pathPattern: "^$" }],
		output: unindent`
			- name: b
			- name: a
		`,
	},
	// Natural.
	{
		code: unindent`
			- name: item10
			- name: item2
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		output: unindent`
			- name: item2
			- name: item10
		`,
	},
	// Natural order matches the natural-compare package used by yml.
	{
		code: unindent`
			- name: a1
			- name: a-1
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		output: unindent`
			- name: a-1
			- name: a1
		`,
	},
	{
		code: unindent`
			- name: x10
			- name: x 2
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		output: unindent`
			- name: x 2
			- name: x10
		`,
	},
	{
		code: unindent`
			- name: a1
			- name: a_b
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", order: { natural: true }, pathPattern: "^$" }],
		output: unindent`
			- name: a_b
			- name: a1
		`,
	},
	// pathPattern has no `u` flag, so an identity escape is valid.
	{
		code: unindent`
			a-b:
			  - name: b
			  - name: a
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", pathPattern: String.raw`^\["a\-b"\]$` }],
		output: unindent`
			a-b:
			  - name: a
			  - name: b
		`,
	},
	// Case sensitive by default: uppercase sorts first.
	{
		code: unindent`
			- name: a
			- name: B
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: root,
		output: unindent`
			- name: B
			- name: a
		`,
	},
	// Case insensitive.
	{
		code: unindent`
			- name: B
			- name: a
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", order: { caseSensitive: false }, pathPattern: "^$" }],
		output: unindent`
			- name: a
			- name: B
		`,
	},
	// Nested path; first matching option wins.
	{
		code: unindent`
			updates:
			  - name: b
			  - name: a
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [
			{ key: "name", pathPattern: "^updates$" },
			{ key: "name", order: { type: "desc" }, pathPattern: ".*" },
		],
		output: unindent`
			updates:
			  - name: a
			  - name: b
		`,
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
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "id", pathPattern: "^foo\\.bar\\[0\\]\\.baz$" }],
		output: unindent`
			foo:
			  bar:
			    - baz:
			        - id: 1
			        - id: 2
		`,
	},
	// No blank lines between entries stays that way; leading comment moves.
	{
		code: unindent`
			- name: c
			# about b
			- name: b
			- name: a
		`,
		errors: [{ messageId: "shouldBeBefore" }, { messageId: "shouldBeBefore" }],
		options: root,
		output: unindent`
			- name: a
			# about b
			- name: b
			- name: c
		`,
	},
	// Trailing inline comments move with their entry.
	{
		code: unindent`
			- name: b # second
			  color: x # b color
			- name: a # first
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: root,
		output: unindent`
			- name: a # first
			- name: b # second
			  color: x # b color
		`,
	},
	// A loose comment between entries: report without a fix.
	{
		code: unindent`
			- name: b

			# loose

			- name: a
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: root,
		output: null,
	},
	// Flow sequence.
	{
		code: "list: [{ name: b }, { name: c }, { name: a }]\n",
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "name", pathPattern: "^list$" }],
		output: "list: [{ name: a }, { name: b }, { name: c }]\n",
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
		errors: [{ messageId: "shouldBeAfter" }],
		options: root,
		output: unindent`
			- name: a
			  id: 1
			- name: a
			  id: 2
			- name: b
		`,
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
		errors: [{ messageId: "shouldBeBefore" }],
		options: root,
		output: unindent`
			- name: b
			- name: c
			  base: &base 1
			- name: a
			  base: *base
		`,
	},
	// Numbers compare numerically.
	{
		code: unindent`
			- id: 10
			- id: 9
		`,
		errors: [{ messageId: "shouldBeBefore" }],
		options: [{ key: "id", pathPattern: "^$" }],
		output: unindent`
			- id: 9
			- id: 10
		`,
	},
];

runYaml({
	name: RULE_NAME,
	invalid,
	rule: yamlSortSequenceByKey,
	valid,
});

describe("idempotent fix", () => {
	const config: Linter.Config = {
		files: ["**/*.yaml"],
		languageOptions: { parser: yamlParser },
		plugins: { flawless: plugin } as unknown as NonNullable<Linter.Config["plugins"]>,
		rules: { "flawless/yaml-sort-sequence-by-key": ["error", ...root] },
	};

	it("converges in one pass and leaves no reports", () => {
		const linter = new Linter();
		const { messages, output } = linter.verifyAndFix(labels, config, {
			filename: "labels.yaml",
		});
		expect(output).toBe(labelsFixed);
		expect(messages).toHaveLength(0);
		expect(linter.verify(labelsFixed, config, { filename: "labels.yaml" })).toHaveLength(0);
	});
});
