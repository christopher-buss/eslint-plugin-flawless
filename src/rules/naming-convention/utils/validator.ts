import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type ts from "typescript";

import type { ModifierType, PredefinedFormatType, SelectorString, SelectorType } from "./enums";
import {
	MetaSelector,
	Modifier,
	PredefinedFormatValueToKey,
	Selector,
	TypeModifier,
	TypeModifierValueToKey,
	UnderscoreOption,
} from "./enums";
import { FormatCheckersMap } from "./format";
import { isMetaSelector, isMethodOrPropertySelector, selectorTypeToMessageString } from "./shared";
import type { Context, NormalizedSelector } from "./types";

type ValidatorNode = TSESTree.Identifier | TSESTree.Literal | TSESTree.PrivateIdentifier;

export function createValidator(
	type: SelectorString,
	context: Context,
	allConfigs: Array<NormalizedSelector>,
): (node: ValidatorNode) => void {
	// make sure the "highest priority" configs are checked first
	const selectorType = Selector[type];
	const configs = allConfigs
		// gather all of the applicable selectors
		.filter((configItem) => {
			return (
				(configItem.selector & selectorType) !== 0 ||
				configItem.selector === MetaSelector.default
			);
		})
		.sort((a, b) => {
			if (a.selector === b.selector) {
				// in the event of the same selector, order by modifier weight
				// sort descending - the type modifiers are "more important"
				return b.modifierWeight - a.modifierWeight;
			}

			const aIsMeta = isMetaSelector(a.selector);
			const bIsMeta = isMetaSelector(b.selector);

			// non-meta selectors should go ahead of meta selectors
			if (aIsMeta && !bIsMeta) {
				return 1;
			}

			if (!aIsMeta && bIsMeta) {
				return -1;
			}

			const aIsMethodOrProperty = isMethodOrPropertySelector(a.selector);
			const bIsMethodOrProperty = isMethodOrPropertySelector(b.selector);

			// for backward compatibility, method and property have higher
			// precedence than other meta selectors
			if (aIsMethodOrProperty && !bIsMethodOrProperty) {
				return -1;
			}

			if (!aIsMethodOrProperty && bIsMethodOrProperty) {
				return 1;
			}

			// both aren't meta selectors
			// sort descending - the meta selectors are "least important"
			return b.selector - a.selector;
		});

	return (node: ValidatorNode, modifiers: Set<ModifierType> = new Set<ModifierType>()): void => {
		const originalName =
			node.type === AST_NODE_TYPES.Identifier ||
			node.type === AST_NODE_TYPES.PrivateIdentifier
				? node.name
				: `${node.value}`;

		// return will break the loop and stop checking configs
		// it is only used when the name is known to have failed or succeeded a
		// config.
		for (const config of configs) {
			if (config.filter?.regex.test(originalName) !== config.filter?.match) {
				// name does not match the filter
				continue;
			}

			if (config.modifiers?.some((modifier) => !modifiers.has(modifier)) === true) {
				// does not have the required modifiers
				continue;
			}

			if (!isCorrectType(node, config, context, selectorType)) {
				// is not the correct type
				continue;
			}

			let name: string | undefined = originalName;

			name = validateUnderscore({ config, name, node, originalName, position: "leading" });
			if (name === undefined) {
				// fail
				return;
			}

			name = validateUnderscore({ config, name, node, originalName, position: "trailing" });
			if (name === undefined) {
				// fail
				return;
			}

			name = validateAffix({ config, name, node, originalName, position: "prefix" });
			if (name === undefined) {
				// fail
				return;
			}

			name = validateAffix({ config, name, node, originalName, position: "suffix" });
			if (name === undefined) {
				// fail
				return;
			}

			if (!validateCustom({ config, name, node, originalName })) {
				// fail
				return;
			}

			if (!validatePredefinedFormat({ config, modifiers, name, node, originalName })) {
				// fail
				return;
			}

			// it's valid for this config, so we don't need to check any more
			// configs
			return;
		}
	};

	function formatReportData({
		affixes,
		count,
		custom,
		formats,
		originalName,
		position,
		processedName,
	}: {
		affixes?: Array<string>;
		count?: "one" | "two";
		custom?: NonNullable<NormalizedSelector["custom"]>;
		formats?: Array<PredefinedFormatType>;
		originalName: string;
		position?: "leading" | "prefix" | "suffix" | "trailing";
		processedName?: string;
	}): Record<string, unknown> {
		let regexMatch: null | string = null;
		if (custom?.match === true) {
			regexMatch = "match";
		} else if (custom?.match === false) {
			regexMatch = "not match";
		}

		return {
			affixes: affixes?.join(", "),
			count,
			formats: formats
				?.map((formatItem) => PredefinedFormatValueToKey[formatItem])
				.join(", "),
			name: originalName,
			position,
			processedName,
			regex: custom?.regex.toString(),
			regexMatch,
			type: selectorTypeToMessageString(type),
		};
	}

	function validateUnderscore({
		config,
		name,
		node,
		originalName,
		position,
	}: {
		config: NormalizedSelector;
		name: string;
		node: ValidatorNode;
		originalName: string;
		position: "leading" | "trailing";
	}): string | undefined {
		const option =
			position === "leading" ? config.leadingUnderscore : config.trailingUnderscore;
		if (!option) {
			return name;
		}

		const hasSingleUnderscore =
			position === "leading"
				? (): boolean => name.startsWith("_")
				: (): boolean => name.endsWith("_");
		const trimSingleUnderscore =
			position === "leading" ? (): string => name.slice(1) : (): string => name.slice(0, -1);

		const hasDoubleUnderscore =
			position === "leading"
				? (): boolean => name.startsWith("__")
				: (): boolean => name.endsWith("__");
		const trimDoubleUnderscore =
			position === "leading" ? (): string => name.slice(2) : (): string => name.slice(0, -2);

		switch (option) {
			// ALLOW - no conditions as the user doesn't care if it's there or not
			case UnderscoreOption.allow: {
				if (hasSingleUnderscore()) {
					return trimSingleUnderscore();
				}

				return name;
			}
			case UnderscoreOption.allowDouble: {
				if (hasDoubleUnderscore()) {
					return trimDoubleUnderscore();
				}

				return name;
			}
			case UnderscoreOption.allowSingleOrDouble: {
				if (hasDoubleUnderscore()) {
					return trimDoubleUnderscore();
				}

				if (hasSingleUnderscore()) {
					return trimSingleUnderscore();
				}

				return name;
			}
			// FORBID
			case UnderscoreOption.forbid: {
				if (hasSingleUnderscore()) {
					context.report({
						data: formatReportData({
							count: "one",
							originalName,
							position,
						}),
						messageId: "unexpectedUnderscore",
						node,
					});
					return undefined;
				}

				return name;
			}
			// REQUIRE
			case UnderscoreOption.require: {
				if (!hasSingleUnderscore()) {
					context.report({
						data: formatReportData({
							count: "one",
							originalName,
							position,
						}),
						messageId: "missingUnderscore",
						node,
					});
					return undefined;
				}

				return trimSingleUnderscore();
			}
			case UnderscoreOption.requireDouble: {
				if (!hasDoubleUnderscore()) {
					context.report({
						data: formatReportData({
							count: "two",
							originalName,
							position,
						}),
						messageId: "missingUnderscore",
						node,
					});
					return undefined;
				}

				return trimDoubleUnderscore();
			}
		}
	}

	function validateAffix({
		config,
		name,
		node,
		originalName,
		position,
	}: {
		config: NormalizedSelector;
		name: string;
		node: ValidatorNode;
		originalName: string;
		position: "prefix" | "suffix";
	}): string | undefined {
		const affixes = config[position];
		if (!affixes || affixes.length === 0) {
			return name;
		}

		for (const affix of affixes) {
			const hasAffix = position === "prefix" ? name.startsWith(affix) : name.endsWith(affix);
			const trimAffix =
				position === "prefix"
					? (): string => name.slice(affix.length)
					: (): string => name.slice(0, -affix.length);

			if (hasAffix) {
				// matches, so trim it and return
				return trimAffix();
			}
		}

		context.report({
			data: formatReportData({
				affixes,
				originalName,
				position,
			}),
			messageId: "missingAffix",
			node,
		});

		return undefined;
	}

	function validateCustom({
		config,
		name,
		node,
		originalName,
	}: {
		config: NormalizedSelector;
		name: string;
		node: ValidatorNode;
		originalName: string;
	}): boolean {
		const { custom } = config;
		if (!custom) {
			return true;
		}

		const result = custom.regex.test(name);
		if (custom.match && result) {
			return true;
		}

		if (!custom.match && !result) {
			return true;
		}

		context.report({
			data: formatReportData({
				custom,
				originalName,
			}),
			messageId: "satisfyCustom",
			node,
		});

		return false;
	}

	function validatePredefinedFormat({
		config,
		modifiers,
		name,
		node,
		originalName,
	}: {
		config: NormalizedSelector;
		modifiers: Set<ModifierType>;
		name: string;
		node: ValidatorNode;
		originalName: string;
	}): boolean {
		const formats = config.format;
		if (!formats || formats.length === 0) {
			return true;
		}

		if (!modifiers.has(Modifier.requiresQuotes)) {
			for (const format of formats) {
				const checker = FormatCheckersMap[format];
				if (checker(name)) {
					return true;
				}
			}
		}

		context.report({
			data: formatReportData({
				formats,
				originalName,
				processedName: name,
			}),
			messageId: originalName === name ? "doesNotMatchFormat" : "doesNotMatchFormatTrimmed",
			node,
		});

		return false;
	}
}

const SelectorsAllowedToHaveTypes =
	Selector.variable |
	Selector.parameter |
	Selector.classProperty |
	Selector.objectLiteralProperty |
	Selector.typeProperty |
	Selector.parameterProperty |
	Selector.classicAccessor;

function isAllTypesMatch(type: ts.Type, callback: (type: ts.Type) => boolean): boolean {
	if (type.isUnion()) {
		return type.types.every((inner) => callback(inner));
	}

	return callback(type);
}

function isCorrectType(
	node: TSESTree.Node,
	config: NormalizedSelector,
	context: Context,
	selector: SelectorType,
): boolean {
	if (config.types === undefined) {
		return true;
	}

	if ((SelectorsAllowedToHaveTypes & selector) === 0) {
		return true;
	}

	const services = getParserServices(context);
	const checker = services.program.getTypeChecker();
	const type = services
		.getTypeAtLocation(node)
		// remove null and undefined from the type, as we don't care about it here
		.getNonNullableType();

	for (const allowedType of config.types) {
		switch (allowedType) {
			case TypeModifier.array: {
				if (
					isAllTypesMatch(
						type,
						(inner) => checker.isArrayType(inner) || checker.isTupleType(inner),
					)
				) {
					return true;
				}

				break;
			}
			case TypeModifier.boolean:
			case TypeModifier.number:
			case TypeModifier.string: {
				const typeString = checker.typeToString(
					// this will resolve things like true => boolean, 'a' =>
					// string and 1 => number
					checker.getWidenedType(checker.getBaseTypeOfLiteralType(type)),
				);
				const allowedTypeString = TypeModifierValueToKey[allowedType];
				if (typeString === allowedTypeString) {
					return true;
				}

				break;
			}
			case TypeModifier.function: {
				if (isAllTypesMatch(type, (inner) => inner.getCallSignatures().length > 0)) {
					return true;
				}

				break;
			}
		}
	}

	return false;
}
