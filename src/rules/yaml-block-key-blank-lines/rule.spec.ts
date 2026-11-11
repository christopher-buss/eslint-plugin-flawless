import { TSESLint } from "@typescript-eslint/utils";

import yml from "eslint-plugin-yml";
import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";
import { describe, expect, it } from "vitest";

import plugin from "../../index.ts";
import { runYaml } from "../test.ts";
import { RULE_NAME, yamlBlockKeyBlankLines } from "./rule.ts";

const messageId = "blankLine";

const valid: Array<ValidTestCase> = [
	// Scalars stay compact, block keys separated by a single blank line.
	unindent`
		name: test
		version: 1.0.0

		packages:
		  - a

		overrides:
		  foo: bar
	`,
	// Nested block keys are left untouched (root mapping has a single pair).
	unindent`
		catalogs:
		  dev:
		    a: 1
		  prod:
		    b: 2
	`,
	// A comment in the gap is left as-is, even when spacing would otherwise
	// change.
	unindent`
		name: a

		# note
		version: b
	`,
	// Flow collections count as scalars: no blank line required between them.
	unindent`
		matrix: [1, 2, 3]
		build: { ci: true }
	`,
];

const invalid: Array<InvalidTestCase> = [
	// Missing blank line before a block sequence key is inserted.
	{
		code: unindent`
			version: 1.0.0
			packages:
			  - a
		`,
		output: unindent`
			version: 1.0.0

			packages:
			  - a
		`,
		errors: [{ messageId }],
	},
	// Extra blank lines between two scalars are collapsed away.
	{
		code: unindent`
			name: a


			version: b
		`,
		output: unindent`
			name: a
			version: b
		`,
		errors: [{ messageId }],
	},
	// A single blank line between two scalars is removed.
	{
		code: unindent`
			name: a

			version: b
		`,
		output: unindent`
			name: a
			version: b
		`,
		errors: [{ messageId }],
	},
	// Extra blank lines around a block mapping key are collapsed to one.
	{
		code: unindent`
			version: b


			overrides:
			  foo: bar
		`,
		output: unindent`
			version: b

			overrides:
			  foo: bar
		`,
		errors: [{ messageId }],
	},
	// Adjacent block keys (sequence then mapping) get a blank line between them.
	{
		code: unindent`
			packages:
			  - a
			overrides:
			  foo: bar
		`,
		output: unindent`
			packages:
			  - a

			overrides:
			  foo: bar
		`,
		errors: [{ messageId }],
	},
];

runYaml({
	name: RULE_NAME,
	invalid,
	rule: yamlBlockKeyBlankLines,
	valid,
});

describe("yaml language mode (Languages API)", () => {
	const config: TSESLint.FlatConfig.Config = {
		files: ["**/*.yaml"],
		language: "yaml/yaml",

		plugins: {
			flawless: plugin,
			yaml: yml,
		},
		rules: {
			"flawless/yaml-block-key-blank-lines": "error",
		},
	};

	const code = unindent`
		version: 1.0.0
		packages:
		  - a
	`;

	it("reports under the language provider", () => {
		const linter = new TSESLint.Linter();
		const messages = linter.verify(code, config, { filename: "file.yaml" });
		expect(messages).toHaveLength(1);
		expect(messages[0]?.messageId).toBe(messageId);
	});

	it("fixes identically to parser mode", () => {
		const linter = new TSESLint.Linter();
		const { output } = linter.verifyAndFix(code, config, { filename: "file.yaml" });
		expect(output).toBe(
			unindent`
				version: 1.0.0

				packages:
				  - a
			`,
		);
	});
});
