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
		// Documentation code fences intentionally show incorrect YAML samples.
		files: ["**/*.md/**"],
		rules: {
			"flawless/yaml-block-key-blank-lines": "off",
		},
	},
);
