import isentinel from "@isentinel/eslint-config";

export default isentinel(
	{
		eslintPlugin: true,
		pnpm: true,
		roblox: false,
		rules: {
			"max-lines": "off",
			"max-lines-per-function": "off",
		},
		type: "package",
	},
	{
		ignores: ["src/rules/example-rule/**"],
	},
);
