import { isentinel } from "@isentinel/eslint-config/oxlint";

export default isentinel(
	{
		name: "project/options",
		eslintPlugin: true,
		ignores: ["**/fixtures/**", "benchmark/**"],
		jsPlugins: false,
		options: {
			typeAware: true,
		},
		roblox: false,
		rules: {
			"max-lines": "off",
			"max-lines-per-function": "off",
		},
		type: "package",
	},
	{
		// ESLint and oxlint load a plugin from its entry's default export.
		files: ["src/index.ts", "src/oxlint.ts"],
		rules: {
			"import/no-default-export": "off",
		},
	},
);
