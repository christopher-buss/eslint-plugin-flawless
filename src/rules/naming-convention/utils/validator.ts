import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type ts from "typescript";
import { TypeFlags } from "typescript";

import type { MessageIds } from "../rule";
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
import { AllowedWordsFormats, applyAllowedWords, FormatCheckersMap } from "./format";
import { isMetaSelector, isMethodOrPropertySelector, selectorTypeToMessageString } from "./shared";
import type { Context, NormalizedSelector, TypeReference } from "./types";

type ValidatorNode = TSESTree.Identifier | TSESTree.Literal | TSESTree.PrivateIdentifier;

export function createValidator(
	type: SelectorString,
	context: Context,
	allConfigs: Array<NormalizedSelector>,
): (node: ValidatorNode) => void {
	// make sure the "highest priority" configs are checked first
	const selectorType = Selector[type];
	// `objectStyleEnumMember` is a split-off of `enumMember`: a config written
	// for `enumMember` still governs object-style enum members, so that adding
	// this selector didn't silently un-validate them. An explicit
	// `objectStyleEnumMember` config carries the higher selector value and so
	// sorts ahead of the `enumMember` fallback below.
	const matchedSelectors =
		type === "objectStyleEnumMember" ? selectorType | Selector.enumMember : selectorType;
	const configs = allConfigs
		// gather all of the applicable selectors
		.filter((configItem) => {
			return (
				(configItem.selector & matchedSelectors) !== 0 ||
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

	return (
		node: ValidatorNode,
		modifiers: Set<ModifierType> = new Set<ModifierType>(),
		showForeignContractHint = false,
	): void => {
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

			name = validateUnderscore({
				name,
				config,
				node,
				originalName,
				position: "leading",
				showForeignContractHint,
			});
			if (name === undefined) {
				// fail
				return;
			}

			name = validateUnderscore({
				name,
				config,
				node,
				originalName,
				position: "trailing",
				showForeignContractHint,
			});
			if (name === undefined) {
				// fail
				return;
			}

			name = validateAffix({
				name,
				config,
				node,
				originalName,
				position: "prefix",
				showForeignContractHint,
			});
			if (name === undefined) {
				// fail
				return;
			}

			name = validateAffix({
				name,
				config,
				node,
				originalName,
				position: "suffix",
				showForeignContractHint,
			});
			if (name === undefined) {
				// fail
				return;
			}

			if (!validateCustom({ name, config, node, originalName, showForeignContractHint })) {
				// fail
				return;
			}

			if (
				!validatePredefinedFormat({
					name,
					config,
					modifiers,
					node,
					originalName,
					showForeignContractHint,
				})
			) {
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
			name: originalName,
			affixes: affixes?.join(", "),
			count,
			formats: formats
				?.map((formatItem) => PredefinedFormatValueToKey[formatItem])
				.join(", "),
			position,
			processedName,
			regex: custom?.regex.toString(),
			regexMatch,
			type: selectorTypeToMessageString(type),
		};
	}

	function validateUnderscore({
		name,
		config,
		node,
		originalName,
		position,
		showForeignContractHint,
	}: {
		config: NormalizedSelector;
		name: string;
		node: ValidatorNode;
		originalName: string;
		position: "leading" | "trailing";
		showForeignContractHint: boolean;
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
						messageId: pickMessageId("unexpectedUnderscore", showForeignContractHint),
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
						messageId: pickMessageId("missingUnderscore", showForeignContractHint),
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
						messageId: pickMessageId("missingUnderscore", showForeignContractHint),
						node,
					});
					return undefined;
				}

				return trimDoubleUnderscore();
			}
		}
	}

	function validateAffix({
		name,
		config,
		node,
		originalName,
		position,
		showForeignContractHint,
	}: {
		config: NormalizedSelector;
		name: string;
		node: ValidatorNode;
		originalName: string;
		position: "prefix" | "suffix";
		showForeignContractHint: boolean;
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
			messageId: pickMessageId("missingAffix", showForeignContractHint),
			node,
		});

		return undefined;
	}

	function validateCustom({
		name,
		config,
		node,
		originalName,
		showForeignContractHint,
	}: {
		config: NormalizedSelector;
		name: string;
		node: ValidatorNode;
		originalName: string;
		showForeignContractHint: boolean;
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
			messageId: pickMessageId("satisfyCustom", showForeignContractHint),
			node,
		});

		return false;
	}

	function validatePredefinedFormat({
		name,
		config,
		modifiers,
		node,
		originalName,
		showForeignContractHint,
	}: {
		config: NormalizedSelector;
		modifiers: Set<ModifierType>;
		name: string;
		node: ValidatorNode;
		originalName: string;
		showForeignContractHint: boolean;
	}): boolean {
		const formats = config.format;
		if (!formats || formats.length === 0) {
			return true;
		}

		if (!modifiers.has(Modifier.requiresQuotes)) {
			const { allowedWords } = config;
			// the rewrite only ever lowercases, so a name that already passes
			// cannot need it - most names never pay for the word list at all.
			// Computed lazily and reused across formats when they do.
			let relaxedName: string | undefined;

			for (const format of formats) {
				const checker = FormatCheckersMap[format];
				if (checker(name)) {
					return true;
				}

				// only the strict formats reject consecutive capitals, so they
				// are the only ones the word list applies to
				if (allowedWords !== undefined && AllowedWordsFormats.has(format)) {
					relaxedName ??= applyAllowedWords(name, allowedWords);
					if (checker(relaxedName)) {
						return true;
					}
				}
			}
		}

		context.report({
			data: formatReportData({
				formats,
				originalName,
				processedName: name,
			}),
			messageId: pickMessageId(
				originalName === name ? "doesNotMatchFormat" : "doesNotMatchFormatTrimmed",
				showForeignContractHint,
			),
			node,
		});

		return false;
	}
}

/**
 * Picks the `*ForeignContract` variant of a message id when the name is a
 * member of an object literal, so the violation message can point at the
 * `satisfies` escape instead of a rename.
 *
 * @param baseMessageId - The base message id for the violation kind.
 * @param showForeignContractHint - Whether the `satisfies` escape applies to
 *   this name.
 * @returns The message id to report.
 */
function pickMessageId(
	baseMessageId:
		| "doesNotMatchFormat"
		| "doesNotMatchFormatTrimmed"
		| "missingAffix"
		| "missingUnderscore"
		| "satisfyCustom"
		| "unexpectedUnderscore",
	showForeignContractHint: boolean,
): MessageIds {
	return showForeignContractHint ? `${baseMessageId}ForeignContract` : baseMessageId;
}

const SelectorsAllowedToHaveTypes =
	Selector.variable |
	Selector.function |
	Selector.parameter |
	Selector.classProperty |
	Selector.objectLiteralProperty |
	Selector.typeProperty |
	Selector.parameterProperty |
	Selector.classicAccessor |
	Selector.classMethod |
	Selector.objectLiteralMethod |
	Selector.typeMethod;

function isAllTypesMatch(type: ts.Type, callback: (type: ts.Type) => boolean): boolean {
	if (type.isUnion()) {
		return type.types.every((inner) => callback(inner));
	}

	return callback(type);
}

function isAnyType(type: ts.Type): boolean {
	return (type.flags & TypeFlags.Any) !== 0;
}

function symbolMatchesTypeReference(
	symbol: ts.Symbol | undefined,
	reference: TypeReference,
): boolean {
	if (symbol === undefined) {
		return false;
	}

	if (reference.name !== undefined && symbol.name !== reference.name) {
		return false;
	}

	if (reference.from === undefined) {
		return true;
	}

	const { declarations } = symbol;
	if (!declarations || declarations.length === 0) {
		return false;
	}

	for (const declaration of declarations) {
		const { fileName } = declaration.getSourceFile();
		if (moduleSpecifierMatches(fileName, reference.from)) {
			return true;
		}
	}

	return false;
}

function matchesSymbolTypeReference(type: ts.Type, reference: TypeReference): boolean {
	if (isAnyType(type)) {
		return false;
	}

	if (symbolMatchesTypeReference(type.aliasSymbol, reference)) {
		return true;
	}

	if (symbolMatchesTypeReference(type.symbol, reference)) {
		return true;
	}

	if (type.isIntersection() || type.isUnion()) {
		for (const inner of type.types) {
			if (matchesSymbolTypeReference(inner, reference)) {
				return true;
			}
		}
	}

	return false;
}

function matchesReturnTypeReference(type: ts.Type, reference: TypeReference): boolean {
	if (isAnyType(type)) {
		return false;
	}

	for (const signature of type.getCallSignatures()) {
		if (matchesTypeReference(signature.getReturnType(), reference)) {
			return true;
		}
	}

	if (type.isIntersection() || type.isUnion()) {
		for (const inner of type.types) {
			if (matchesReturnTypeReference(inner, reference)) {
				return true;
			}
		}
	}

	return false;
}

function matchesTypeReference(type: ts.Type, reference: TypeReference): boolean {
	if (isAnyType(type)) {
		return false;
	}

	// an empty matcher would match every type; the schema requires at least one
	// of `name` / `from` / `returns`, so treat it as a non-match defensively
	if (
		reference.name === undefined &&
		reference.from === undefined &&
		reference.returns === undefined
	) {
		return false;
	}

	// `from` on its own matches every type the module declares, so the symbol
	// lookup runs whenever either constraint is present
	if (
		(reference.name !== undefined || reference.from !== undefined) &&
		!matchesSymbolTypeReference(type, reference)
	) {
		return false;
	}

	if (reference.returns !== undefined && !matchesReturnTypeReference(type, reference.returns)) {
		return false;
	}

	return true;
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

	const predicates: Array<(inner: ts.Type) => boolean> = [];
	for (const allowedType of config.types) {
		if (typeof allowedType === "object") {
			predicates.push((inner) => matchesTypeReference(inner, allowedType));
			continue;
		}

		switch (allowedType) {
			case TypeModifier.array: {
				predicates.push(
					(inner) => checker.isArrayType(inner) || checker.isTupleType(inner),
				);
				break;
			}
			case TypeModifier.boolean:
			case TypeModifier.number:
			case TypeModifier.string: {
				predicates.push((inner) => {
					const typeString = checker.typeToString(
						// this will resolve things like true => boolean, 'a' =>
						// string and 1 => number
						checker.getWidenedType(checker.getBaseTypeOfLiteralType(inner)),
					);
					return typeString === TypeModifierValueToKey[allowedType];
				});
				break;
			}
			case TypeModifier.function: {
				predicates.push((inner) => inner.getCallSignatures().length > 0);
				break;
			}
		}
	}

	// a union matches when each arm satisfies at least one configured type,
	// not necessarily the same one for every arm
	return isAllTypesMatch(type, (inner) => predicates.some((predicate) => predicate(inner)));
}

const BACKSLASH_PATTERN = /\\/gu;
const TYPESCRIPT_EXTENSION_PATTERN = /\.d\.ts$|\.tsx?$/u;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:\//u;
const LEADING_DOT_OR_SLASH_PATTERN = /^(\.\/|\/)/u;

/**
 * Path-form specifiers start with `.`, `/`, or a Windows drive letter (e.g.
 * `C:/`).
 *
 * @param specifier - The module specifier to classify.
 * @returns True if the specifier should be treated as a filesystem path rather
 *   than a package name.
 */
function looksLikePath(specifier: string): boolean {
	if (specifier.startsWith(".")) {
		return true;
	}

	if (specifier.startsWith("/")) {
		return true;
	}

	return WINDOWS_DRIVE_PATTERN.test(specifier);
}

/**
 * Checks whether a declaration's source file matches a module specifier.
 *
 * Two specifier shapes are supported:
 *
 * 1. **Bare package specifier** (e.g. `"@rbxts/jecs"`, `"lodash"`) — matches
 *    when the declaration's file path contains `/node_modules/<specifier>/` as
 *    a substring. Handles flat and pnpm-style layouts (pnpm paths still contain
 *    a final `/node_modules/<specifier>/` segment after the virtual store
 *    directory). **Not** supported: Yarn Plug'n'Play (no `node_modules` on
 *    disk), vendored packages outside `node_modules`, or types provided by
 *    separate `@types/*` packages.
 * 2. **Path specifier** (starts with `.`, `/`, or a Windows drive letter) —
 *    matches against the normalized declaration path with `.d.ts` / `.tsx?`
 *    stripped. Windows absolute paths require exact equality. POSIX-style
 *    absolute or relative paths are normalized to a bare tail and matched as a
 *    suffix; this means `"./shared/network"` matches a declaration at
 *    `<root>/shared/network.ts`.
 *
 * @param declarationFile - Path of the file declaring the matched symbol.
 * @param specifier - The `from` module specifier from the rule config.
 * @returns True if the declaration file matches the specifier.
 */
function moduleSpecifierMatches(declarationFile: string, specifier: string): boolean {
	const normalizedFile = declarationFile.replace(BACKSLASH_PATTERN, "/");
	const normalizedSpecifier = specifier.replace(BACKSLASH_PATTERN, "/");

	if (looksLikePath(normalizedSpecifier)) {
		const stripped = normalizedFile.replace(TYPESCRIPT_EXTENSION_PATTERN, "");
		if (WINDOWS_DRIVE_PATTERN.test(normalizedSpecifier)) {
			return stripped === normalizedSpecifier;
		}

		const tail = normalizedSpecifier.replace(LEADING_DOT_OR_SLASH_PATTERN, "");
		if (stripped === tail) {
			return true;
		}

		return stripped.endsWith(`/${tail}`);
	}

	return normalizedFile.includes(`/node_modules/${normalizedSpecifier}/`);
}
