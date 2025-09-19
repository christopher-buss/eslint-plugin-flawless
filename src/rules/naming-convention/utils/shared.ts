import type {
	IndividualAndMetaSelectorsString,
	MetaSelectorString,
	MetaSelectorType,
	SelectorString,
	SelectorType,
} from "./enums";
import { MetaSelector } from "./enums";

export function isMetaSelector(
	selector: IndividualAndMetaSelectorsString | MetaSelectorType | SelectorType,
): selector is MetaSelectorString {
	return selector in MetaSelector;
}

export function isMethodOrPropertySelector(
	selector: IndividualAndMetaSelectorsString | MetaSelectorType | SelectorType,
): boolean {
	return selector === MetaSelector.method || selector === MetaSelector.property;
}

export function selectorTypeToMessageString(selectorType: SelectorString): string {
	const notCamelCase = selectorType.replaceAll(/([A-Z])/g, " $1");
	return notCamelCase.charAt(0).toUpperCase() + notCamelCase.slice(1);
}
