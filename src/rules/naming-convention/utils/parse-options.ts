import type { SelectorString } from "./enums";
import {
	MetaSelector,
	Modifier,
	PredefinedFormat,
	Selector,
	TypeModifier,
	UnderscoreOption,
} from "./enums";
import { isMetaSelector } from "./shared";
import type { Context, NamingSelector, NormalizedSelector, ParsedOptions } from "./types";
import { createValidator } from "./validator";

export function parseOptions(context: Context): ParsedOptions {
	const normalizedOptions = context.options.flatMap(normalizeOption);

	return Object.fromEntries(
		Object.keys(Selector).map((key) => [
			key,
			createValidator(key as SelectorString, context, normalizedOptions),
		]),
	) as ParsedOptions;
}

function normalizeOption(option: NamingSelector): Array<NormalizedSelector> {
	let weight = 0;

	if (option.modifiers) {
		for (const modifier of option.modifiers) {
			weight |= Modifier[modifier];
		}
	}

	if (option.types) {
		for (const type of option.types) {
			weight |= TypeModifier[type];
		}
	}

	// give selectors with a filter the _highest_ priority
	if (option.filter !== undefined) {
		weight |= 1 << 30;
	}

	const normalizedOption = {
		// format options
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
		types: option.types?.map((type) => TypeModifier[type]) ?? undefined,
	};

	const selectors = Array.isArray(option.selector) ? option.selector : [option.selector];

	return selectors.map((selector) => {
		return {
			selector: isMetaSelector(selector) ? MetaSelector[selector] : Selector[selector],
			...normalizedOption,
		};
	});
}
