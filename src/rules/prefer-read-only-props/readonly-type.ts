import { isPropertyReadonlyInType } from "ts-api-utils";
import type { IndexInfo, Symbol as TSSymbol, Type, TypeChecker } from "typescript";

/**
 * Type aliases whose presence guarantees every property is read-only, so the
 * type is treated as fully read-only without inspecting its members.
 */
const READONLY_WRAPPER_NAMES = new Set([
	"DeepReadOnly",
	"DeepReadonly",
	"Readonly",
	"ReadonlyArray",
	"ReadonlyDeep",
]);

/**
 * Props React manages itself; they are always effectively read-only from a
 * component's perspective and never need a `readonly` modifier.
 */
const REACT_BUILTIN_PROPS = new Set(["children", "key", "ref"]);

/** The mutable members of a props type, as needed to insert `readonly` modifiers. */
export interface MutableMembers {
	/** Index signatures (`[key: string]: T`) that are not already `readonly`. */
	readonly indexInfos: ReadonlyArray<IndexInfo>;
	/** Property symbols that are not already read-only (nor React built-ins). */
	readonly properties: ReadonlyArray<TSSymbol>;
}

/**
 * Determines whether every property of a props type is read-only.
 *
 * Ported from `eslint-cease-nonsense-rules`. Union and intersection members are
 * checked recursively, index signatures must be read-only, and base (extended)
 * types are traversed so an inherited `readonly` modifier still counts. A type
 * aliased to a known read-only wrapper (such as `Readonly<T>`) short-circuits to
 * read-only.
 *
 * @param checker - The TypeScript type checker.
 * @param type - The props type to inspect.
 * @param extraWrapperName - An additional alias name (the configured autofix
 *   wrapper, such as `Immutable`) whose presence short-circuits to read-only,
 *   so already-wrapped props are recognized in O(1) without walking members.
 * @returns `true` when the type exposes no mutable properties.
 */
export function isTypeFullyReadonly(
	checker: TypeChecker,
	type: Type,
	extraWrapperName?: string,
): boolean {
	const aliasSymbol = type.aliasSymbol ?? type.getSymbol();
	if (aliasSymbol) {
		const name = aliasSymbol.getName();
		if (READONLY_WRAPPER_NAMES.has(name) || name === extraWrapperName) {
			return true;
		}
	}

	if (type.isUnion()) {
		return type.types.every((unionType) => {
			return isTypeFullyReadonly(checker, unionType, extraWrapperName);
		});
	}

	if (type.isIntersection()) {
		return type.types.every((intersectionType) => {
			return isTypeFullyReadonly(checker, intersectionType, extraWrapperName);
		});
	}

	const indexInfos: ReadonlyArray<IndexInfo> = checker.getIndexInfosOfType(type);
	for (const indexInfo of indexInfos) {
		if (!indexInfo.isReadonly) {
			return false;
		}
	}

	const properties = checker.getPropertiesOfType(type);
	if (properties.length === 0) {
		return true;
	}

	for (const property of properties) {
		if (!isReadonlyPropertiesProperty(checker, type, property)) {
			return false;
		}
	}

	return true;
}

/**
 * Collects the mutable members of a props type so the autofix can add a
 * `readonly` modifier to each. Mirrors {@link isTypeFullyReadonly}'s notion of
 * read-only (React built-ins and inherited `readonly` count as read-only), but
 * gathers the offenders instead of returning a boolean.
 *
 * Union and intersection types are not attributable to a single declaration, so
 * they return `null` — the caller withholds the `readonly`-modifier fix.
 *
 * @param checker - The TypeScript type checker.
 * @param type - The props type to inspect.
 * @returns The mutable members, or `null` when the type is a union/intersection.
 */
export function collectMutableProperties(checker: TypeChecker, type: Type): MutableMembers | null {
	if (type.isUnion() || type.isIntersection()) {
		return null;
	}

	const indexInfos = checker
		.getIndexInfosOfType(type)
		.filter((indexInfo) => !indexInfo.isReadonly);
	const properties = checker
		.getPropertiesOfType(type)
		.filter((property) => !isReadonlyPropertiesProperty(checker, type, property));
	return { indexInfos, properties };
}

function isTypePropertyReadonly(checker: TypeChecker, type: Type, property: TSSymbol): boolean {
	return isPropertyReadonlyInType(type, property.getEscapedName(), checker);
}

function getBaseTypes(type: Type): ReadonlyArray<Type> {
	return type.getBaseTypes() ?? [];
}

function isPropertyReadonlyInBaseType(
	checker: TypeChecker,
	type: Type,
	property: TSSymbol,
): boolean {
	const propertyName = property.getName();
	const baseTypes = [...getBaseTypes(type)];

	for (const baseType of baseTypes) {
		const baseProperty = baseType.getProperty(propertyName);
		if (baseProperty === undefined) {
			continue;
		}

		if (isTypePropertyReadonly(checker, baseType, baseProperty)) {
			return true;
		}

		baseTypes.push(...getBaseTypes(baseType));
	}

	return false;
}

function isReadonlyPropertiesProperty(
	checker: TypeChecker,
	type: Type,
	property: TSSymbol,
): boolean {
	const propertyName = property.getName();
	if (REACT_BUILTIN_PROPS.has(propertyName)) {
		return true;
	}

	if (isTypePropertyReadonly(checker, type, property)) {
		return true;
	}

	return isPropertyReadonlyInBaseType(checker, type, property);
}
