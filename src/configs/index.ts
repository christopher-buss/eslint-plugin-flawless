import type { TSESLint } from "@typescript-eslint/utils";

import type { FlawlessPlugin } from "../plugin";
import { plugin, PLUGIN_NAME } from "../plugin";

/** The shareable configs the plugin exposes. */
export interface FlawlessConfigs {
	recommended: {
		plugins: Record<string, FlawlessPlugin>;
		rules: TSESLint.FlatConfig.Rules;
	};
}

export const configs: FlawlessConfigs = {
	recommended: {
		plugins: {
			[PLUGIN_NAME]: plugin,
		},
		rules: {},
	},
} satisfies Record<string, TSESLint.FlatConfig.Config>;
