import type { TSESLint } from "@typescript-eslint/utils";

import type { Linter } from "eslint";

import { name as packageName, version as packageVersion } from "../package.json";
import { arrowReturnStyle } from "./rules/arrow-return-style/rule";
import { jsxShorthandBoolean } from "./rules/jsx-shorthand-boolean/rule";
import { jsxShorthandFragment } from "./rules/jsx-shorthand-fragment/rule";
import { namingConvention } from "./rules/naming-convention/rule";
import { noExportDefaultArrow } from "./rules/no-export-default-arrow/rule";
import { noUnnecessaryUseCallback } from "./rules/no-unnecessary-use-callback/rule";
import { noUnnecessaryUseMemo } from "./rules/no-unnecessary-use-memo/rule";
import { preferDestructuringAssignment } from "./rules/prefer-destructuring-assignment/rule";
import { preferParameterDestructuring } from "./rules/prefer-parameter-destructuring/rule";
import { preferReadOnlyProps } from "./rules/prefer-read-only-props/rule";
import { purity } from "./rules/purity/rule";
import { tomlSortKeys } from "./rules/toml-sort-keys/rule";
import { yamlBlockKeyBlankLines } from "./rules/yaml-block-key-blank-lines/rule";

export const PLUGIN_NAME = packageName.replace(/^eslint-plugin-/, "");

/**
 * Generates a rules record where all plugin rules are set to "error".
 *
 * @param pluginName - The plugin identifier used to prefix rule names.
 * @param rules - The rules record to transform.
 * @returns A Linter.RulesRecord with all rules enabled.
 */
export function getRules(
	pluginName: string,
	rules: Record<string, TSESLint.RuleModule<any, any>>,
): Linter.RulesRecord {
	return Object.fromEntries(
		Object.keys(rules).map((ruleName) => [`${pluginName}/${ruleName}`, "error"]),
	);
}

export const plugin = {
	meta: {
		name: PLUGIN_NAME,
		version: packageVersion,
	},
	rules: {
		"arrow-return-style": arrowReturnStyle,
		"jsx-shorthand-boolean": jsxShorthandBoolean,
		"jsx-shorthand-fragment": jsxShorthandFragment,
		"naming-convention": namingConvention,
		"no-export-default-arrow": noExportDefaultArrow,
		"no-unnecessary-use-callback": noUnnecessaryUseCallback,
		"no-unnecessary-use-memo": noUnnecessaryUseMemo,
		"prefer-destructuring-assignment": preferDestructuringAssignment,
		"prefer-parameter-destructuring": preferParameterDestructuring,
		"prefer-read-only-props": preferReadOnlyProps,
		"purity": purity,
		"toml-sort-keys": tomlSortKeys,
		"yaml-block-key-blank-lines": yamlBlockKeyBlankLines,
	},
} satisfies TSESLint.FlatConfig.Plugin;

export const allRules = getRules(PLUGIN_NAME, plugin.rules);
