import type { SelectorString } from "./enums";
import {
	MetaSelector,
	Modifier,
	PredefinedFormat,
	Selector,
	TYPE_REFERENCE_LOOSE_WEIGHT,
	TYPE_REFERENCE_STRICT_WEIGHT,
	TypeModifier,
	UnderscoreOption,
} from "./enums";
import { isMetaSelector } from "./shared";
import type {
	Context,
	NamingSelector,
	NormalizedSelector,
	ParsedOptions,
	TypeReference,
} from "./types";
import { createValidator } from "./validator";

export function parseOptions(context: Context): ParsedOptions {
	const settingsAllowedWords = getSettingsAllowedWords(context);
	const normalizedOptions = context.options.flatMap((option) => {
		return normalizeOption(option, settingsAllowedWords);
	});

	return Object.fromEntries(
		Object.keys(Selector).map((key) => [
			key,
			createValidator(key as SelectorString, context, normalizedOptions),
		]),
	) as ParsedOptions;
}

/**
 * Drops empty entries, deduplicates, and sorts longest-first so that
 * overlapping words resolve to the longest match (`UDim2` before `UDim`).
 *
 * @param allowedWords - The configured words.
 * @returns The normalized words, or undefined when nothing usable remains.
 */
function normalizeAllowedWords(
	allowedWords: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined {
	const unique = [...new Set(allowedWords.filter((word) => word.length > 0))].sort(
		(left, right) => right.length - left.length,
	);

	return unique.length > 0 ? unique : undefined;
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
function getSettingsAllowedWords(context: Context): ReadonlyArray<string> | undefined {
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
	settingsAllowedWords: ReadonlyArray<string> | undefined,
): Array<NormalizedSelector> {
	let weight = 0;

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
		types:
			option.types?.map((type) => (typeof type === "string" ? TypeModifier[type] : type)) ??
			undefined,
	};

	const selectors = Array.isArray(option.selector) ? option.selector : [option.selector];

	return selectors.map((selector) => {
		return {
			selector: isMetaSelector(selector) ? MetaSelector[selector] : Selector[selector],
			...normalizedOption,
		};
	});
}
