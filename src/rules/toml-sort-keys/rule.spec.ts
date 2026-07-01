import { Linter } from "eslint";
import toml from "eslint-plugin-toml";
import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import { describe, expect, it } from "vitest";

import plugin from "../../index";
import { runToml } from "../test";
import { RULE_NAME, tomlSortKeys } from "./rule";

const messageId = "unsorted";

// Top-level tables ordered semantically; keys inside [settings] grouped, with a
// catch-all natural-ascending fallback for everything else.
const options = [
	{ order: ["env", "vars", "settings", "tools"], pathPattern: "^$" },
	{ order: ["experimental", "lockfile"], pathPattern: "^settings$" },
	{ order: { natural: true, type: "asc" }, pathPattern: ".*" },
];

const valid: Array<ValidTestCase> = [
	// No spec set: rule is a no-op.
	{
		code: unindent`
		[tools]
		node = "lts"

		[env]
		foo = "bar"
	`,
		options: [],
	},
	// Top-level tables already in configured order.
	{
		code: unindent`
			[env]
			foo = "bar"

			[settings]
			experimental = true

			[tools]
			node = "lts"
		`,
		options,
	},
	// Keys inside a table already in configured order.
	{
		code: unindent`
			[settings]
			experimental = true
			lockfile = true
		`,
		options,
	},
	// Unlisted keys fall back to natural-ascending order.
	{
		code: unindent`
			[tools]
			bun = "latest"
			node = "lts"
		`,
		options,
	},
];

const invalid: Array<InvalidTestCase> = [
	// Top-level tables reordered; whole [table] blocks move together.
	{
		code: unindent`
			[tools]
			node = "lts"

			[settings]
			experimental = true
		`,
		errors: [{ messageId }],
		options,
		output: unindent`
			[settings]
			experimental = true

			[tools]
			node = "lts"
		`,
	},
	// Keys within a table reordered.
	{
		code: unindent`
			[settings]
			lockfile = true
			experimental = true
		`,
		errors: [{ messageId }],
		options,
		output: unindent`
			[settings]
			experimental = true
			lockfile = true
		`,
	},
	// An attached own-line comment travels with its key.
	{
		code: unindent`
			[settings]
			# lock it down
			lockfile = true
			experimental = true
		`,
		errors: [{ messageId }],
		options,
		output: unindent`
			[settings]
			experimental = true
			# lock it down
			lockfile = true
		`,
	},
	// Sub-tables stay grouped under their parent and sort A-Z after it.
	{
		code: unindent`
			[settings.python]
			compile = false

			[settings.node]
			compile = false

			[settings]
			experimental = true
		`,
		errors: [{ messageId }],
		options,
		output: unindent`
			[settings]
			experimental = true

			[settings.node]
			compile = false

			[settings.python]
			compile = false
		`,
	},
	// A floating comment (blank line before the key) is unattributable: report
	// only, no autofix.
	{
		code: unindent`
			[settings]
			lockfile = true
			# stray

			experimental = true
		`,
		errors: [{ messageId }],
		options,
		output: null,
	},
];

runToml({
	name: RULE_NAME,
	invalid,
	rule: tomlSortKeys,
	valid,
});

describe("toml language mode (Languages API)", () => {
	// The plugin objects mix `@eslint/core` type versions (TSESLint vs
	// eslint-plugin-toml), so the flat-config `plugins` map is cast to bridge
	// them.
	const config: Linter.Config = {
		files: ["**/*.toml"],
		language: "toml/toml",
		plugins: {
			flawless: plugin,
			toml,
		} as unknown as Linter.Config["plugins"],
		rules: {
			"flawless/toml-sort-keys": ["error", ...options],
		},
	};

	const code = unindent`
		[settings]
		lockfile = true
		experimental = true
	`;

	it("reports under the language provider", () => {
		const linter = new Linter();
		const messages = linter.verify(code, config, { filename: "file.toml" });
		expect(messages).toHaveLength(1);
		expect(messages[0]?.messageId).toBe(messageId);
	});

	it("fixes identically to parser mode", () => {
		const linter = new Linter();
		const { output } = linter.verifyAndFix(code, config, { filename: "file.toml" });
		expect(output).toBe(
			unindent`
				[settings]
				experimental = true
				lockfile = true
			`,
		);
	});
});
