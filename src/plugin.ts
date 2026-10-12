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
import { noEmDash } from "./rules/no-em-dash/rule";
import { noExportDefaultArrow } from "./rules/no-export-default-arrow/rule";
import { noFloatingPointEquality } from "./rules/no-floating-point-equality/rule";
import { noKnownValueWidening } from "./rules/no-known-value-widening/rule";
import { noMaterializedFilterMap } from "./rules/no-materialized-filter-map/rule";
import { noObjectParameters } from "./rules/no-object-parameters/rule";
import { noRedundantTsconfigOptions } from "./rules/no-redundant-tsconfig-options/rule";
import { noRedundantTypeAnnotation } from "./rules/no-redundant-type-annotation/rule";
import { noReflectGet } from "./rules/no-reflect-get/rule";
import { noReflectSet } from "./rules/no-reflect-set/rule";
import { noShapeInSymbolNames } from "./rules/no-shape-in-symbol-names/rule";
import { noSharedMocks } from "./rules/no-shared-mocks/rule";
import { noSharedTestState } from "./rules/no-shared-test-state/rule";
import { noTrivialFunctions } from "./rules/no-trivial-functions/rule";
import { noUnknownParameters } from "./rules/no-unknown-parameters/rule";
import { noUnknownReturns } from "./rules/no-unknown-returns/rule";
import { noUnnecessaryUseCallback } from "./rules/no-unnecessary-use-callback/rule";
import { noUnnecessaryUseMemo } from "./rules/no-unnecessary-use-memo/rule";
import { noUnsafeDictionaryType } from "./rules/no-unsafe-dictionary-type/rule";
import { paddingAfterExpectAssertions } from "./rules/padding-after-expect-assertions/rule";
import { preferDestructuringAssignment } from "./rules/prefer-destructuring-assignment/rule";
import { preferEndingWithAnExpect } from "./rules/prefer-ending-with-an-expect/rule";
import { preferExpectAssertionsCount } from "./rules/prefer-expect-assertions-count/rule";
import { preferMockThrow } from "./rules/prefer-mock-throw/rule";
import { preferParameterDestructuring } from "./rules/prefer-parameter-destructuring/rule";
import { preferReadOnlyProps } from "./rules/prefer-read-only-props/rule";
import { preferVitestLocalContext } from "./rules/prefer-vitest-local-context/rule";
import { purity } from "./rules/purity/rule";
import { reactNamespace } from "./rules/react-namespace/rule";
import { tomlSortKeys } from "./rules/toml-sort-keys/rule";
import { yamlBlockKeyBlankLines } from "./rules/yaml-block-key-blank-lines/rule";

export const PLUGIN_NAME: string = packageName.replace(/^eslint-plugin-/, "");

/** The rule modules the plugin exposes, keyed by rule name. */
// A type alias, not an interface: `getRules` and `satisfies` need the implicit
// index signature that only type aliases get.
// eslint-disable-next-line ts/consistent-type-definitions -- see above
export type PluginRules = {
	"arrow-return-style": typeof arrowReturnStyle;
	"jsx-shorthand-boolean": typeof jsxShorthandBoolean;
	"jsx-shorthand-fragment": typeof jsxShorthandFragment;
	"max-lines-per-function": typeof maxLinesPerFunction;
	"naming-convention": typeof namingConvention;
	"no-conditional-empty-object-spread": typeof noConditionalEmptyObjectSpread;
	"no-conditional-in-test": typeof noConditionalInTest;
	"no-em-dash": typeof noEmDash;
	"no-export-default-arrow": typeof noExportDefaultArrow;
	"no-floating-point-equality": typeof noFloatingPointEquality;
	"no-known-value-widening": typeof noKnownValueWidening;
	"no-materialized-filter-map": typeof noMaterializedFilterMap;
	"no-object-parameters": typeof noObjectParameters;
	"no-redundant-tsconfig-options": typeof noRedundantTsconfigOptions;
	"no-redundant-type-annotation": typeof noRedundantTypeAnnotation;
	"no-reflect-get": typeof noReflectGet;
	"no-reflect-set": typeof noReflectSet;
	"no-shape-in-symbol-names": typeof noShapeInSymbolNames;
	"no-shared-mocks": typeof noSharedMocks;
	"no-shared-test-state": typeof noSharedTestState;
	"no-trivial-functions": typeof noTrivialFunctions;
	"no-unknown-parameters": typeof noUnknownParameters;
	"no-unknown-returns": typeof noUnknownReturns;
	"no-unnecessary-use-callback": typeof noUnnecessaryUseCallback;
	"no-unnecessary-use-memo": typeof noUnnecessaryUseMemo;
	"no-unsafe-dictionary-type": typeof noUnsafeDictionaryType;
	"padding-after-expect-assertions": typeof paddingAfterExpectAssertions;
	"prefer-destructuring-assignment": typeof preferDestructuringAssignment;
	"prefer-ending-with-an-expect": typeof preferEndingWithAnExpect;
	"prefer-expect-assertions-count": typeof preferExpectAssertionsCount;
	"prefer-mock-throw": typeof preferMockThrow;
	"prefer-parameter-destructuring": typeof preferParameterDestructuring;
	"prefer-read-only-props": typeof preferReadOnlyProps;
	"prefer-vitest-local-context": typeof preferVitestLocalContext;
	"purity": typeof purity;
	"react-namespace": typeof reactNamespace;
	"toml-sort-keys": typeof tomlSortKeys;
	"yaml-block-key-blank-lines": typeof yamlBlockKeyBlankLines;
};

/** The ESLint plugin object: metadata plus every rule. */
// A type alias, not an interface: `getRules` and `satisfies` need the implicit
// index signature that only type aliases get.
// eslint-disable-next-line ts/consistent-type-definitions -- see above
export type FlawlessPlugin = {
	meta: {
		name: string;
		version: string;
	};
	rules: PluginRules;
};

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

export const plugin: FlawlessPlugin = {
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
		"no-em-dash": noEmDash,
		"no-export-default-arrow": noExportDefaultArrow,
		"no-floating-point-equality": noFloatingPointEquality,
		"no-known-value-widening": noKnownValueWidening,
		"no-materialized-filter-map": noMaterializedFilterMap,
		"no-object-parameters": noObjectParameters,
		"no-redundant-tsconfig-options": noRedundantTsconfigOptions,
		"no-redundant-type-annotation": noRedundantTypeAnnotation,
		"no-reflect-get": noReflectGet,
		"no-reflect-set": noReflectSet,
		"no-shape-in-symbol-names": noShapeInSymbolNames,
		"no-shared-mocks": noSharedMocks,
		"no-shared-test-state": noSharedTestState,
		"no-trivial-functions": noTrivialFunctions,
		"no-unknown-parameters": noUnknownParameters,
		"no-unknown-returns": noUnknownReturns,
		"no-unnecessary-use-callback": noUnnecessaryUseCallback,
		"no-unnecessary-use-memo": noUnnecessaryUseMemo,
		"no-unsafe-dictionary-type": noUnsafeDictionaryType,
		"padding-after-expect-assertions": paddingAfterExpectAssertions,
		"prefer-destructuring-assignment": preferDestructuringAssignment,
		"prefer-ending-with-an-expect": preferEndingWithAnExpect,
		"prefer-expect-assertions-count": preferExpectAssertionsCount,
		"prefer-mock-throw": preferMockThrow,
		"prefer-parameter-destructuring": preferParameterDestructuring,
		"prefer-read-only-props": preferReadOnlyProps,
		"prefer-vitest-local-context": preferVitestLocalContext,
		"purity": purity,
		"react-namespace": reactNamespace,
		"toml-sort-keys": tomlSortKeys,
		"yaml-block-key-blank-lines": yamlBlockKeyBlankLines,
	},
} satisfies TSESLint.FlatConfig.Plugin;

export const allRules: Linter.RulesRecord = getRules(PLUGIN_NAME, plugin.rules);
