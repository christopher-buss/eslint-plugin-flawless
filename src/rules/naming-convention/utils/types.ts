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
	types?: Array<TypeModifierString>;
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
	types: Array<TypeModifierType> | undefined;
}
export type ParsedOptions = Record<SelectorString, ValidatorFunction>;
export type ValidatorFunction = (
	node: TSESTree.Identifier | TSESTree.Literal | TSESTree.PrivateIdentifier,
	modifiers?: Set<ModifierType>,
) => void;
