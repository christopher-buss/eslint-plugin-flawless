import isentinel, { GLOB_YAML } from "@isentinel/eslint-config";

export default isentinel(
	{
		eslintPlugin: true,
		flawless: true,
		pnpm: true,
		roblox: false,
		rules: {
			"flawless/naming-convention": "off",
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
		// Documentation code fences intentionally show incorrect YAML samples.
		files: ["**/*.md/**"],
		rules: {
			"flawless/yaml-block-key-blank-lines": "off",
		},
	},
);
