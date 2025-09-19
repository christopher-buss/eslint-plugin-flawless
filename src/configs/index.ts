import type { TSESLint } from "@typescript-eslint/utils";

import { plugin, PLUGIN_NAME } from "../plugin";

export const configs = {
	recommended: {
		plugins: {
			[PLUGIN_NAME]: plugin,
		},
		rules: {},
	},
} satisfies Record<string, TSESLint.FlatConfig.Config>;
