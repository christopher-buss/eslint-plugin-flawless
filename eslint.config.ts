import isentinel, { GLOB_YAML } from "@isentinel/eslint-config";

export default isentinel(
	{
		eslintPlugin: true,
		flawless: true,
		pnpm: true,
		roblox: false,
		rules: {
			"flawless/naming-convention": "off",
			"flawless/prefer-parameter-destructuring": "warn",
			"max-lines": "off",
			"max-lines-per-function": "off",
			"package-json/require-bin": "off",
			"package-json/restrict-top-level-properties": "off",
			"sonar/cognitive-complexity": "off",
			"sonar/no-duplicate-string": "off",
		},
		type: "package",
	},
	{
		ignores: ["fixtures/**", "benchmark/**"],
	},
	{
		files: [GLOB_YAML],
		rules: {
			"flawless/yaml-block-key-blank-lines": "error",
		},
	},
	{
		files: ["**/mise.toml", "**/.mise.toml", "**/.config/mise/config.toml"],
		rules: {
			"flawless/toml-sort-keys": [
				"error",
				{ order: ["env", "vars", "settings", "tools"], pathPattern: "^$" },
				{ order: ["experimental", "lockfile"], pathPattern: "^settings$" },
				{ order: { natural: true, type: "asc" }, pathPattern: ".*" },
			],
		},
	},
	{
		// A rule's own documentation intentionally shows incorrect samples, and
		// prefer-destructuring-assignment's documentation shows body
		// destructuring as an accepted form.
		files: [
			"src/rules/prefer-destructuring-assignment/documentation.md/**",
			"src/rules/prefer-parameter-destructuring/documentation.md/**",
		],
		rules: {
			"flawless/prefer-parameter-destructuring": "off",
		},
	},
	{
		// Documentation code fences intentionally show incorrect YAML samples.
		files: ["src/rules/yaml-block-key-blank-lines/documentation.md/**"],
		rules: {
			"flawless/yaml-block-key-blank-lines": "off",
		},
	},
	{
		// The documentation intentionally shows incorrect samples that the
		// legacy arrow-style plugin and the oxfmt formatting rule would
		// rewrite, and its arrow examples are the rule's subject matter.
		files: ["src/rules/arrow-return-style/documentation.md/**"],
		rules: {
			"arrow-style/arrow-return-style": "off",
			"flawless/arrow-return-style": "off",
			"func-style": "off",
			"oxfmt/oxfmt": "off",
			"ts/explicit-function-return-type": "off",
		},
	},
);
