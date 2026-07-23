import type { JSONSchema } from "@typescript-eslint/utils";

import type { IndividualAndMetaSelectorsString, ModifierString } from "./enums";
import {
	MetaSelector,
	Modifier,
	PredefinedFormat,
	Selector,
	TypeModifier,
	UnderscoreOption,
} from "./enums";

const $DEFS: Record<string, JSONSchema.JSONSchema4> = {
	// repeated types
	formatOptionsConfig: {
		oneOf: [
			{
				additionalItems: false,
				items: {
					$ref: "#/$defs/predefinedFormats",
				},
				type: "array",
			},
			{
				type: "null",
			},
		],
	},
	matchRegexConfig: {
		additionalProperties: false,
		properties: {
			match: { type: "boolean" },
			regex: { type: "string" },
		},
		required: ["match", "regex"],
		type: "object",
	},
	// enums
	predefinedFormats: {
		enum: Object.keys(PredefinedFormat),
		type: "string",
	},

	prefixSuffixConfig: {
		additionalItems: false,
		items: {
			minLength: 1,
			type: "string",
		},
		type: "array",
	},
	typeMatcher: {
		oneOf: [
			{
				description: "Built-in type modifier matching by widened TS type.",
				enum: Object.keys(TypeModifier),
				type: "string",
			},
			{
				$ref: "#/$defs/typeReferenceMatcher",
			},
		],
	},
	typeReferenceMatcher: {
		additionalProperties: false,
		anyOf: [
			{ required: ["name"], type: "object" },
			{ required: ["returns"], type: "object" },
		],
		dependencies: { from: ["name"] },
		description:
			"Type-reference matcher. Matches when the variable's type resolves to a symbol with the given `name`; if `from` is supplied, the symbol's declaration must also live in a file the specifier resolves to. `returns` instead (or additionally) matches callable types by the return type of their call signatures.",
		properties: {
			name: {
				description:
					"Symbol name to match (compared against the type's `aliasSymbol` then `symbol`).",
				minLength: 1,
				type: "string",
			},
			from: {
				description:
					"Module specifier the type must originate from. Bare package name (e.g. `@rbxts/jecs`) matches `/node_modules/<from>/` in the declaration path. Path-form (starts with `.`, `/`, or a Windows drive letter) matches the declaration path with extension stripped. Omit to match any source.",
				minLength: 1,
				type: "string",
			},
			returns: {
				$ref: "#/$defs/typeReferenceMatcher",
				description:
					"Nested matcher applied to call-signature return types. The type matches when at least one call signature's return type satisfies it. Lets anonymous function types (which have no symbol name) be matched, e.g. React components typed `(props: P) => ReactNode`.",
			},
		},
		type: "object",
	},
	underscoreOptions: {
		enum: Object.keys(UnderscoreOption),
		type: "string",
	},
};

const UNDERSCORE_SCHEMA: JSONSchema.JSONSchema4 = {
	$ref: "#/$defs/underscoreOptions",
};
const PREFIX_SUFFIX_SCHEMA: JSONSchema.JSONSchema4 = {
	$ref: "#/$defs/prefixSuffixConfig",
};
const MATCH_REGEX_SCHEMA: JSONSchema.JSONSchema4 = {
	$ref: "#/$defs/matchRegexConfig",
};
type JSONSchemaProperties = Record<string, JSONSchema.JSONSchema4>;
const FORMAT_OPTIONS_PROPERTIES: JSONSchemaProperties = {
	custom: MATCH_REGEX_SCHEMA,
	failureMessage: {
		type: "string",
	},
	format: {
		$ref: "#/$defs/formatOptionsConfig",
	},
	leadingUnderscore: UNDERSCORE_SCHEMA,
	prefix: PREFIX_SUFFIX_SCHEMA,
	suffix: PREFIX_SUFFIX_SCHEMA,
	trailingUnderscore: UNDERSCORE_SCHEMA,
};
function selectorSchema(
	selectorString: IndividualAndMetaSelectorsString,
	allowType: boolean,
	modifiers?: Array<ModifierString>,
): Array<JSONSchema.JSONSchema4> {
	const selector: JSONSchemaProperties = {
		filter: {
			oneOf: [
				{
					minLength: 1,
					type: "string",
				},
				MATCH_REGEX_SCHEMA,
			],
		},
		selector: {
			enum: [selectorString],
			type: "string",
		},
	};

	if (modifiers && modifiers.length > 0) {
		selector["modifiers"] = {
			additionalItems: false,
			items: {
				enum: modifiers,
				type: "string",
			},
			type: "array",
		};
	}

	if (allowType) {
		selector["types"] = {
			additionalItems: false,
			items: {
				$ref: "#/$defs/typeMatcher",
			},
			type: "array",
		};
	}

	return [
		{
			additionalProperties: false,
			description: `Selector '${selectorString}'`,
			properties: {
				...FORMAT_OPTIONS_PROPERTIES,
				...selector,
			},
			required: ["selector", "format"],
			type: "object",
		},
	];
}

function selectorsSchema(): JSONSchema.JSONSchema4 {
	return {
		additionalProperties: false,
		description: "Multiple selectors in one config",
		properties: {
			...FORMAT_OPTIONS_PROPERTIES,
			filter: {
				oneOf: [
					{
						minLength: 1,
						type: "string",
					},
					MATCH_REGEX_SCHEMA,
				],
			},
			modifiers: {
				additionalItems: false,
				items: {
					enum: Object.keys(Modifier),
					type: "string",
				},
				type: "array",
			},
			selector: {
				additionalItems: false,
				items: {
					enum: [...Object.keys(MetaSelector), ...Object.keys(Selector)],
					type: "string",
				},
				type: "array",
			},
			types: {
				additionalItems: false,
				items: {
					$ref: "#/$defs/typeMatcher",
				},
				type: "array",
			},
		},
		required: ["selector", "format"],
		type: "object",
	};
}

export const SCHEMA: JSONSchema.JSONSchema4 = {
	$defs: $DEFS,
	additionalItems: false,
	items: {
		oneOf: [
			selectorsSchema(),
			...selectorSchema("default", false, Object.keys(Modifier) as Array<ModifierString>),

			...selectorSchema("variableLike", false, ["unused", "async"]),
			...selectorSchema("variable", true, [
				"const",
				"constAsserted",
				"destructured",
				"exported",
				"global",
				"unused",
				"async",
			]),
			...selectorSchema("function", true, ["exported", "global", "unused", "async"]),
			...selectorSchema("parameter", true, ["destructured", "unused"]),
			...selectorSchema("objectStyleEnum", false, ["const", "exported", "global", "unused"]),

			...selectorSchema("memberLike", false, [
				"abstract",
				"private",
				"#private",
				"protected",
				"public",
				"readonly",
				"requiresQuotes",
				"static",
				"override",
				"async",
			]),
			...selectorSchema("classProperty", true, [
				"abstract",
				"private",
				"#private",
				"protected",
				"public",
				"readonly",
				"requiresQuotes",
				"static",
				"override",
			]),
			...selectorSchema("objectLiteralProperty", true, ["public", "requiresQuotes"]),
			...selectorSchema("typeProperty", true, ["public", "readonly", "requiresQuotes"]),
			...selectorSchema("parameterProperty", true, [
				"private",
				"protected",
				"public",
				"readonly",
			]),
			...selectorSchema("property", true, [
				"abstract",
				"private",
				"#private",
				"protected",
				"public",
				"readonly",
				"requiresQuotes",
				"static",
				"override",
				"async",
			]),

			...selectorSchema("classMethod", true, [
				"abstract",
				"private",
				"#private",
				"protected",
				"public",
				"requiresQuotes",
				"static",
				"override",
				"async",
			]),
			...selectorSchema("objectLiteralMethod", true, ["public", "requiresQuotes", "async"]),
			...selectorSchema("typeMethod", true, ["public", "requiresQuotes"]),
			...selectorSchema("method", true, [
				"abstract",
				"private",
				"#private",
				"protected",
				"public",
				"requiresQuotes",
				"static",
				"override",
				"async",
			]),
			...selectorSchema("classicAccessor", true, [
				"abstract",
				"private",
				"protected",
				"public",
				"requiresQuotes",
				"static",
				"override",
			]),
			...selectorSchema("autoAccessor", true, [
				"abstract",
				"private",
				"protected",
				"public",
				"requiresQuotes",
				"static",
				"override",
			]),
			...selectorSchema("accessor", true, [
				"abstract",
				"private",
				"protected",
				"public",
				"requiresQuotes",
				"static",
				"override",
			]),
			...selectorSchema("enumMember", false, ["requiresQuotes"]),

			...selectorSchema("typeLike", false, ["abstract", "exported", "unused"]),
			...selectorSchema("class", false, ["abstract", "exported", "unused"]),
			...selectorSchema("interface", false, ["exported", "unused"]),
			...selectorSchema("typeAlias", false, ["exported", "unused"]),
			...selectorSchema("enum", false, ["exported", "unused"]),
			...selectorSchema("typeParameter", false, ["unused"]),
			...selectorSchema("import", false, ["default", "namespace"]),
		],
	},
	type: "array",
};
