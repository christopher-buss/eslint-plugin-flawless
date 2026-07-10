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
		ignores: ["fixtures/**"],
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
);
