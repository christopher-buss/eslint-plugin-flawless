/* eslint-disable unicorn/no-keyword-prefix -- Enums are allowed to have keyword prefixes */
/* eslint-disable perfectionist/sort-objects -- Kept in this way for readability */

export const Selector = {
	// variableLike
	variable: 1,
	function: 2,
	parameter: 4,

	// memberLike
	parameterProperty: 8,
	classicAccessor: 16,
	enumMember: 32,
	classMethod: 64,
	objectLiteralMethod: 128,
	typeMethod: 256,
	classProperty: 512,
	objectLiteralProperty: 1024,
	typeProperty: 2048,
	autoAccessor: 4096,

	// typeLike
	class: 8192,
	interface: 16384,
	typeAlias: 32768,
	enum: 65536,
	typeParameter: 131072,

	// other
	import: 262144,
} as const;

export type SelectorString = keyof typeof Selector;
export type SelectorType = (typeof Selector)[keyof typeof Selector];

export const MetaSelector = {
	/* eslint-disable no-inline-comments -- Comments improve readability here */
	default: -1,
	variableLike: 7, // 0 | 1 | 2 | 4
	memberLike: 8184, // 0 | 512 | 1024 | 2048 | 8 | 32 | 64 | 128 | 256 | 16 | 4096
	typeLike: 253952, // 0 | 8192 | 16384 | 32768 | 65536 | 131072
	method: 448, // 0 | 64 | 128 | 256
	property: 3584, // 0 | 512 | 1024 | 2048
	accessor: 4112, // 0 | 16 | 4096
	/* eslint-enable no-inline-comments */
} as const;

export type MetaSelectorString = keyof typeof MetaSelector;
export type MetaSelectorType = (typeof MetaSelector)[keyof typeof MetaSelector];

export const Modifier = {
	// const variable
	"const": 1,
	// readonly members
	"readonly": 2,
	// static members
	"static": 4,
	// member accessibility
	"public": 8,
	"protected": 16,
	"private": 32,
	"#private": 64,
	"abstract": 128,
	// destructured variable
	"destructured": 256,
	// variables declared in the top-level scope
	"global": 512,
	// things that are exported
	"exported": 1024,
	// things that are unused
	"unused": 2048,
	// properties that require quoting
	"requiresQuotes": 4096,
	// class members that are overridden
	"override": 8192,
	// class methods, object function properties, or functions that are async via
	// the `async` keyword
	"async": 16384,
	// default imports
	"default": 32768,
	// namespace imports
	"namespace": 65536,

	// make sure TypeModifiers starts at Modifiers + 1 or else sorting won't work
} as const;

export type ModifierString = keyof typeof Modifier;
export type ModifierType = (typeof Modifier)[keyof typeof Modifier];

export const PredefinedFormat = {
	camelCase: 1,
	strictCamelCase: 2,
	PascalCase: 3,
	StrictPascalCase: 4,
	// eslint-disable-next-line camelcase -- Formatted in snake_case
	snake_case: 5,
	UPPER_CASE: 6,
} as const;

export const PredefinedFormatValueToKey = Object.fromEntries(
	Object.entries(PredefinedFormat).map(([key, value]) => [value, key]),
) as Record<PredefinedFormatType, keyof typeof PredefinedFormat>;

export type PredefinedFormatString = keyof typeof PredefinedFormat;
export type PredefinedFormatType = (typeof PredefinedFormat)[keyof typeof PredefinedFormat];

export const TypeModifier = {
	boolean: 131072,
	string: 262144,
	number: 524288,
	function: 1048576,
	array: 2097152,
} as const;

export const TypeModifierValueToKey = Object.fromEntries(
	Object.entries(TypeModifier).map(([key, value]) => [value, key]),
) as Record<TypeModifierType, keyof typeof TypeModifier>;

export type TypeModifierString = keyof typeof TypeModifier;
export type TypeModifierType = (typeof TypeModifier)[keyof typeof TypeModifier];

export const UnderscoreOption = {
	forbid: 1,
	allow: 2,
	require: 3,

	// special cases as it's common practice to use double underscore
	requireDouble: 4,
	allowDouble: 5,
	allowSingleOrDouble: 6,
} as const;

export type IndividualAndMetaSelectorsString = MetaSelectorString | SelectorString;
export type UnderscoreOptionString = keyof typeof UnderscoreOption;

export type UnderscoreOptionType = (typeof UnderscoreOption)[keyof typeof UnderscoreOption];
