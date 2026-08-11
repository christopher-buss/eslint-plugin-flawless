/* eslint-disable unicorn/no-keyword-prefix -- Enums are allowed to have keyword prefixes */
/* eslint-disable perfectionist/sort-objects -- Kept in this way for readability */

export const Selector = {
	// variableLike
	variable: 1,
	function: 2,
	parameter: 4,
	objectStyleEnum: 8,

	// memberLike
	parameterProperty: 16,
	classicAccessor: 32,
	enumMember: 64,
	// must stay above `enumMember`: object-style enum members fall back to
	// `enumMember` configs, and the higher value makes an explicit
	// `objectStyleEnumMember` config win the descending selector sort
	objectStyleEnumMember: 128,
	classMethod: 256,
	objectLiteralMethod: 512,
	typeMethod: 1024,
	classProperty: 2048,
	objectLiteralProperty: 4096,
	typeProperty: 8192,
	autoAccessor: 16384,

	// typeLike
	class: 32768,
	interface: 65536,
	typeAlias: 131072,
	enum: 262144,
	typeParameter: 524288,

	// other
	import: 1048576,
} as const;

export type SelectorString = keyof typeof Selector;
export type SelectorType = (typeof Selector)[keyof typeof Selector];

export const MetaSelector = {
	/* eslint-disable no-inline-comments -- Comments improve readability here */
	default: -1,
	variableLike: 15, // 0 | 1 | 2 | 4 | 8
	memberLike: 32752, // 0 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384
	typeLike: 1015808, // 0 | 32768 | 65536 | 131072 | 262144 | 524288
	method: 1792, // 0 | 256 | 512 | 1024
	property: 14336, // 0 | 2048 | 4096 | 8192
	accessor: 16416, // 0 | 32 | 16384
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
	// variables whose initializer is a const-asserted object expression, bare
	// (`{...} as const`) or `satisfies`-wrapped (`{...} as const satisfies T`)
	"constAsserted": 131072,

	// make sure TypeModifiers starts at Modifiers + 1 or else sorting won't work
} as const;

export type ModifierString = keyof typeof Modifier;
export type ModifierType = (typeof Modifier)[keyof typeof Modifier];

export const PredefinedFormat = {
	camelCase: 1,
	strictCamelCase: 2,
	PascalCase: 3,
	StrictPascalCase: 4,
	snake_case: 5,
	UPPER_CASE: 6,
} as const;

export const PredefinedFormatValueToKey = Object.fromEntries(
	Object.entries(PredefinedFormat).map(([key, value]) => [value, key]),
) as Record<PredefinedFormatType, keyof typeof PredefinedFormat>;

export type PredefinedFormatString = keyof typeof PredefinedFormat;
export type PredefinedFormatType = (typeof PredefinedFormat)[keyof typeof PredefinedFormat];

export const TypeModifier = {
	boolean: 262144,
	string: 524288,
	number: 1048576,
	function: 2097152,
	array: 4194304,
} as const;

export const TypeModifierValueToKey = Object.fromEntries(
	Object.entries(TypeModifier).map(([key, value]) => [value, key]),
) as Record<TypeModifierType, keyof typeof TypeModifier>;

export type TypeModifierString = keyof typeof TypeModifier;
export type TypeModifierType = (typeof TypeModifier)[keyof typeof TypeModifier];

// weights for the object-form type-reference matchers in `types`; strict
// (from + name) sorts ahead of loose (name only), and both sort ahead of the
// built-in type modifiers above. The filter weight (1 << 30) stays highest.
export const TYPE_REFERENCE_LOOSE_WEIGHT = 1 << 23;
export const TYPE_REFERENCE_STRICT_WEIGHT = 1 << 24;

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
