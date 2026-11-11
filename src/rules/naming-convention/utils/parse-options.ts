import type { SelectorString } from "./enums.ts";
import {
	COMPONENT_PROP_WEIGHT,
	MetaSelector,
	Modifier,
	PredefinedFormat,
	Selector,
	TYPE_ARGUMENT_LOOSE_WEIGHT,
	TYPE_ARGUMENT_STRICT_WEIGHT,
	TYPE_REFERENCE_LOOSE_WEIGHT,
	TYPE_REFERENCE_STRICT_WEIGHT,
	TypeModifier,
	UnderscoreOption,
} from "./enums.ts";
import type { AllowedWordIndex } from "./format.ts";
import { indexAllowedWords } from "./format.ts";
import { isMetaSelector } from "./shared.ts";
import type {
	Context,
	NamingSelector,
	NormalizedSelector,
	ParsedOptions,
	TypeReference,
} from "./types.ts";
import { createValidator } from "./validator.ts";

export function parseOptions(context: Context, options: Context["options"]): ParsedOptions {
	const settingsAllowedWords = getSettingsAllowedWords(context);
	const normalizedOptions = options.flatMap((option) => {
		return normalizeOption(option, settingsAllowedWords);
	});

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Object.fromEntries` widens keys to `string`; the keys come from the typed const object.
	return Object.fromEntries(
		Object.keys(Selector).map((key) => [
			key,

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Object.keys` widens keys to `string`; the keys come from the typed const object.
			createValidator(key as SelectorString, context, normalizedOptions),
		]),
	) as ParsedOptions;
}

/**
 * Drops empty entries, deduplicates, and sorts longest-first so that
 * overlapping words resolve to the longest match (`UDim2` before `UDim`), then
 * buckets the result by first character. The bucketing happens here, once per
 * selector, rather than on every name that gets validated.
 *
 * @param allowedWords - The configured words.
 * @returns The indexed words, or undefined when nothing usable remains.
 */
function normalizeAllowedWords(allowedWords: ReadonlyArray<string>): AllowedWordIndex | undefined {
	const unique = [...new Set(allowedWords.filter((word) => word.length > 0))].sort(
		(left, right) => right.length - left.length,
	);

	return unique.length > 0 ? indexAllowedWords(unique) : undefined;
}

/**
 * Reads the shared `settings.flawless.namingConvention.allowedWords` list,
 * which every selector inherits unless it declares its own `allowedWords`.
 *
 * Shared settings are not validated by the rule schema, so anything
 * unrecognized is ignored rather than thrown - a mis-typed setting must not
 * take the whole rule down.
 *
 * @param context - The rule context of the file being linted.
 * @returns The normalized shared word list, or undefined when unset.
 */
function getSettingsAllowedWords(context: Context): AllowedWordIndex | undefined {
	const { flawless } = context.settings;
	if (typeof flawless !== "object" || flawless === null) {
		return undefined;
	}

	const { namingConvention } = flawless as { namingConvention?: unknown };
	if (typeof namingConvention !== "object" || namingConvention === null) {
		return undefined;
	}

	const { allowedWords } = namingConvention as { allowedWords?: unknown };
	if (!Array.isArray(allowedWords)) {
		return undefined;
	}

	return normalizeAllowedWords(allowedWords.filter((word) => typeof word === "string"));
}

/**
 * A type-reference matcher counts as "strict" for sorting when any level of it
 * (including nested `returns` matchers) constrains the declaring module.
 *
 * @param reference - The matcher to inspect.
 * @returns True if the matcher carries a `from` constraint at any depth.
 */
function hasFromConstraint(reference: TypeReference): boolean {
	if (reference.from !== undefined) {
		return true;
	}

	return reference.returns !== undefined && hasFromConstraint(reference.returns);
}

function normalizeOption(
	option: NamingSelector,
	settingsAllowedWords: AllowedWordIndex | undefined,
): Array<NormalizedSelector> {
	let weight = 0;
	/* oxlint-disable oxc/bad-bitwise-operator -- the weight is a bit set of modifier flags */

	if (option.modifiers) {
		for (const modifier of option.modifiers) {
			weight |= Modifier[modifier];
		}
	}

	if (option.types) {
		for (const type of option.types) {
			if (typeof type === "string") {
				weight |= TypeModifier[type];
			} else {
				weight |= hasFromConstraint(type)
					? TYPE_REFERENCE_STRICT_WEIGHT
					: TYPE_REFERENCE_LOOSE_WEIGHT;
			}
		}
	}

	if (option.typeArgumentOf) {
		for (const reference of option.typeArgumentOf) {
			weight |=
				reference.from !== undefined
					? TYPE_ARGUMENT_STRICT_WEIGHT
					: TYPE_ARGUMENT_LOOSE_WEIGHT;
		}
	}

	/* oxlint-enable oxc/bad-bitwise-operator */
	if (option.componentProp === true) {
		weight |= COMPONENT_PROP_WEIGHT;
	}

	// give selectors with a filter the _highest_ priority
	if (option.filter !== undefined) {
		weight |= 1 << 30;
	}

	const normalizedOption = {
		// format options
		// the presence of the key - not its length - decides the fallback, so
		// `allowedWords: []` opts a selector out of the shared list
		allowedWords:
			option.allowedWords !== undefined
				? normalizeAllowedWords(option.allowedWords)
				: settingsAllowedWords,
		componentProp: option.componentProp === true,
		custom: option.custom
			? {
					match: option.custom.match,
					regex: new RegExp(option.custom.regex, "u"),
				}
			: undefined,
		filter:
			option.filter !== undefined
				? // eslint-disable-next-line sonar/no-nested-conditional -- refactor this later
					typeof option.filter === "string"
					? {
							match: true,
							regex: new RegExp(option.filter, "u"),
						}
					: {
							match: option.filter.match,
							regex: new RegExp(option.filter.regex, "u"),
						}
				: undefined,
		format: option.format ? option.format.map((format) => PredefinedFormat[format]) : undefined,
		leadingUnderscore:
			option.leadingUnderscore !== undefined
				? UnderscoreOption[option.leadingUnderscore]
				: undefined,
		modifiers: option.modifiers?.map((modifier) => Modifier[modifier]) ?? undefined,
		// calculated ordering weight based on modifiers
		modifierWeight: weight,
		prefix: option.prefix && option.prefix.length > 0 ? option.prefix : undefined,
		suffix: option.suffix && option.suffix.length > 0 ? option.suffix : undefined,
		trailingUnderscore:
			option.trailingUnderscore !== undefined
				? UnderscoreOption[option.trailingUnderscore]
				: undefined,
		typeArgumentOf: option.typeArgumentOf ?? undefined,
		types:
			option.types?.map((type) => (typeof type === "string" ? TypeModifier[type] : type)) ??
			undefined,
	};

	const selectors = Array.isArray(option.selector) ? option.selector : [option.selector];

	// oxlint-disable-next-line oxc/no-map-spread -- each selector needs its own object; normalizedOption is shared
	return selectors.map((selector) => {
		return {
			selector: isMetaSelector(selector) ? MetaSelector[selector] : Selector[selector],
			...normalizedOption,
		};
	});
}
