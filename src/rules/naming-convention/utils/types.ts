import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import type { MessageIds, Options } from "../rule";
import type {
	IndividualAndMetaSelectorsString,
	MetaSelectorType,
	ModifierString,
	ModifierType,
	PredefinedFormatString,
	PredefinedFormatType,
	SelectorString,
	SelectorType,
	TypeModifierString,
	TypeModifierType,
	UnderscoreOptionString,
	UnderscoreOptionType,
} from "./enums";
import type { AllowedWordIndex } from "./format";

export type Context = Readonly<TSESLint.RuleContext<MessageIds, Options>>;

export interface MatchRegex {
	match: boolean;
	regex: string;
}

/**
 * Object-form entry in a selector's `types` array. At least one of `name`,
 * `from`, or `returns` must be present (enforced by the rule schema).
 */
export interface TypeReference {
	/** Symbol name the value's type must resolve to. Omit to match any name. */
	name?: string;
	/**
	 * Module specifier the matched symbol must be declared in. On its own (no
	 * `name`) it matches every type the module declares.
	 */
	from?: string;
	/**
	 * Matches callable types by return type: at least one call signature's
	 * return type must satisfy this nested matcher.
	 */
	returns?: TypeReference;
}

export type TypeMatcher = TypeModifierString | TypeReference;

export interface NamingSelector {
	/**
	 * Words that may keep their own casing inside a name when checking the
	 * strict formats. Replaces the shared
	 * `settings.flawless.namingConvention.allowedWords` list when present, so an
	 * empty array opts this selector out of it.
	 */
	allowedWords?: Array<string>;
	custom?: MatchRegex;
	filter?: MatchRegex | string;
	/**
	 * Format options.
	 */
	format: Array<PredefinedFormatString> | null;
	leadingUnderscore?: UnderscoreOptionString;
	modifiers?: Array<ModifierString>;
	prefix?: Array<string>;
	/**
	 * Selector options.
	 */
	selector: Array<IndividualAndMetaSelectorsString> | IndividualAndMetaSelectorsString;
	suffix?: Array<string>;
	trailingUnderscore?: UnderscoreOptionString;
	types?: Array<TypeMatcher>;
}

export interface NormalizedMatchRegex {
	match: boolean;
	regex: RegExp;
}

export interface NormalizedSelector {
	/**
	 * Deduplicated and sorted longest-first so the longest word wins when two
	 * overlap (`UDim2` over `UDim`), then bucketed by first character.
	 */
	allowedWords: AllowedWordIndex | undefined;
	custom: NormalizedMatchRegex | undefined;
	filter: NormalizedMatchRegex | undefined;
	/**
	 * Format options.
	 */
	format: Array<PredefinedFormatType> | undefined;
	leadingUnderscore: undefined | UnderscoreOptionType;
	modifiers: Array<ModifierType> | undefined;
	/**
	 * Calculated ordering weight based on modifiers.
	 */
	modifierWeight: number;
	prefix: Array<string> | undefined;
	/**
	 * Selector options.
	 */
	selector: MetaSelectorType | SelectorType;
	suffix: Array<string> | undefined;
	trailingUnderscore: undefined | UnderscoreOptionType;
	types: Array<TypeModifierType | TypeReference> | undefined;
}
export type ValidatorFunction = (
	node: TSESTree.Identifier | TSESTree.Literal | TSESTree.PrivateIdentifier,
	modifiers?: Set<ModifierType>,
	/**
	 * True when the name is a *member* of an object literal - an
	 * `objectStyleEnum` key, or an ordinary object-literal property/method - so
	 * a violation message should point authors at the `satisfies` escape rather
	 * than a rename. Container bindings are excluded: no external shape
	 * dictates the name a value is bound to.
	 */
	showForeignContractHint?: boolean,
) => void;
export type ParsedOptions = Record<SelectorString, ValidatorFunction>;
