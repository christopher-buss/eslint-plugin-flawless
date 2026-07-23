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

export type Context = Readonly<TSESLint.RuleContext<MessageIds, Options>>;

export interface MatchRegex {
	match: boolean;
	regex: string;
}

/**
 * Object-form entry in a selector's `types` array. At least one of `name` or
 * `returns` must be present (enforced by the rule schema).
 */
export interface TypeReference {
	/** Symbol name the value's type must resolve to. */
	name?: string;
	/** Module specifier the matched symbol must be declared in. */
	from?: string;
	/**
	 * Matches callable types by return type: at least one call signature's
	 * return type must satisfy this nested matcher.
	 */
	returns?: TypeReference;
}

export type TypeMatcher = TypeModifierString | TypeReference;

export interface NamingSelector {
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
	 * True when this name is the container binding or a key of an
	 * `objectStyleEnum` — an object literal, not a real enum, so a violation
	 * message should point authors at the `satisfies` escape rather than a
	 * rename.
	 */
	isObjectStyleEnumName?: boolean,
) => void;
export type ParsedOptions = Record<SelectorString, ValidatorFunction>;
