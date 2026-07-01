import isentinel from "@isentinel/eslint-config";

export default isentinel(
	{
		eslintPlugin: true,
		pnpm: true,
		roblox: false,
		rules: {
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
);
