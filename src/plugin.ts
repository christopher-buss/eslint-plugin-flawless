import type { TSESLint } from "@typescript-eslint/utils";

import type { Linter } from "eslint";

import { name as packageName, version as packageVersion } from "../package.json";
import { arrowReturnStyle } from "./rules/arrow-return-style/rule";
import { jsxShorthandBoolean } from "./rules/jsx-shorthand-boolean/rule";
import { jsxShorthandFragment } from "./rules/jsx-shorthand-fragment/rule";
import { maxLinesPerFunction } from "./rules/max-lines-per-function/rule";
import { namingConvention } from "./rules/naming-convention/rule";
import { noConditionalEmptyObjectSpread } from "./rules/no-conditional-empty-object-spread/rule";
import { noConditionalInTest } from "./rules/no-conditional-in-test/rule";
import { noExportDefaultArrow } from "./rules/no-export-default-arrow/rule";
import { noFloatingPointEquality } from "./rules/no-floating-point-equality/rule";
import { noKnownValueWidening } from "./rules/no-known-value-widening/rule";
import { noObjectParameters } from "./rules/no-object-parameters/rule";
import { noRedundantTsconfigOptions } from "./rules/no-redundant-tsconfig-options/rule";
import { noRedundantTypeAnnotation } from "./rules/no-redundant-type-annotation/rule";
import { noReflectGet } from "./rules/no-reflect-get/rule";
import { noReflectSet } from "./rules/no-reflect-set/rule";
import { noShapeInSymbolNames } from "./rules/no-shape-in-symbol-names/rule";
import { noSharedMocks } from "./rules/no-shared-mocks/rule";
import { noUnnecessaryUseCallback } from "./rules/no-unnecessary-use-callback/rule";
import { noUnnecessaryUseMemo } from "./rules/no-unnecessary-use-memo/rule";
import { noUnsafeDictionaryType } from "./rules/no-unsafe-dictionary-type/rule";
import { paddingAfterExpectAssertions } from "./rules/padding-after-expect-assertions/rule";
import { preferDestructuringAssignment } from "./rules/prefer-destructuring-assignment/rule";
import { preferEndingWithAnExpect } from "./rules/prefer-ending-with-an-expect/rule";
import { preferExpectAssertionsCount } from "./rules/prefer-expect-assertions-count/rule";
import { preferParameterDestructuring } from "./rules/prefer-parameter-destructuring/rule";
import { preferReadOnlyProps } from "./rules/prefer-read-only-props/rule";
import { purity } from "./rules/purity/rule";
import { reactNamespace } from "./rules/react-namespace/rule";
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
		"max-lines-per-function": maxLinesPerFunction,
		"naming-convention": namingConvention,
		"no-conditional-empty-object-spread": noConditionalEmptyObjectSpread,
		"no-conditional-in-test": noConditionalInTest,
		"no-export-default-arrow": noExportDefaultArrow,
		"no-floating-point-equality": noFloatingPointEquality,
		"no-known-value-widening": noKnownValueWidening,
		"no-object-parameters": noObjectParameters,
		"no-redundant-tsconfig-options": noRedundantTsconfigOptions,
		"no-redundant-type-annotation": noRedundantTypeAnnotation,
		"no-reflect-get": noReflectGet,
		"no-reflect-set": noReflectSet,
		"no-shape-in-symbol-names": noShapeInSymbolNames,
		"no-shared-mocks": noSharedMocks,
		"no-unnecessary-use-callback": noUnnecessaryUseCallback,
		"no-unnecessary-use-memo": noUnnecessaryUseMemo,
		"no-unsafe-dictionary-type": noUnsafeDictionaryType,
		"padding-after-expect-assertions": paddingAfterExpectAssertions,
		"prefer-destructuring-assignment": preferDestructuringAssignment,
		"prefer-ending-with-an-expect": preferEndingWithAnExpect,
		"prefer-expect-assertions-count": preferExpectAssertionsCount,
		"prefer-parameter-destructuring": preferParameterDestructuring,
		"prefer-read-only-props": preferReadOnlyProps,
		"purity": purity,
		"react-namespace": reactNamespace,
		"toml-sort-keys": tomlSortKeys,
		"yaml-block-key-blank-lines": yamlBlockKeyBlankLines,
	},
} satisfies TSESLint.FlatConfig.Plugin;

export const allRules = getRules(PLUGIN_NAME, plugin.rules);
