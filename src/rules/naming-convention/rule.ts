/* eslint-disable eslint-plugin/no-property-in-node -- For now */

import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES, AST_TOKEN_TYPES, TSESLint } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import { isIdentifierPart, isIdentifierStart, ScriptTarget } from "typescript";

import { createEslintRule } from "../../util";
import { collectVariables } from "../../utils/collect-variables";
import {
	type Context,
	type ContextualTypeCache,
	isDictatedByContextualType,
	type NamingSelector,
	parseOptions,
	SCHEMA,
	type ValidatorFunction,
} from "./utils";
import { Modifier, type ModifierType } from "./utils/enums";

export const RULE_NAME = "naming-convention";

export type MessageIds =
	| "doesNotMatchFormat"
	| "doesNotMatchFormatForeignContract"
	| "doesNotMatchFormatTrimmed"
	| "doesNotMatchFormatTrimmedForeignContract"
	| "missingAffix"
	| "missingAffixForeignContract"
	| "missingUnderscore"
	| "missingUnderscoreForeignContract"
	| "satisfyCustom"
	| "satisfyCustomForeignContract"
	| "unexpectedUnderscore"
	| "unexpectedUnderscoreForeignContract";

// The `*ForeignContract` variants are reported instead of their base
// counterpart when the name belongs to an `objectStyleEnum` - a plain object
// literal, not a real enum. They append a pointer to the `satisfies` escape,
// since renaming the container or a key is never the intended fix for data
// that's meant to conform to an externally-owned shape.
const FOREIGN_CONTRACT_HINT =
	" If this is data conforming to an external shape, declare it with `satisfies` instead.";

const messages = {
	doesNotMatchFormat:
		"{{type}} name `{{name}}` must match one of the following formats: {{formats}}",
	doesNotMatchFormatForeignContract: `{{type}} name \`{{name}}\` must match one of the following formats: {{formats}}${FOREIGN_CONTRACT_HINT}`,
	doesNotMatchFormatTrimmed:
		"{{type}} name `{{name}}` trimmed as `{{processedName}}` must match one of the following formats: {{formats}}",
	doesNotMatchFormatTrimmedForeignContract: `{{type}} name \`{{name}}\` trimmed as \`{{processedName}}\` must match one of the following formats: {{formats}}${FOREIGN_CONTRACT_HINT}`,
	missingAffix:
		"{{type}} name `{{name}}` must have one of the following {{position}}es: {{affixes}}",
	missingAffixForeignContract: `{{type}} name \`{{name}}\` must have one of the following {{position}}es: {{affixes}}${FOREIGN_CONTRACT_HINT}`,
	missingUnderscore: "{{type}} name `{{name}}` must have {{count}} {{position}} underscore(s).",
	missingUnderscoreForeignContract: `{{type}} name \`{{name}}\` must have {{count}} {{position}} underscore(s).${FOREIGN_CONTRACT_HINT}`,
	satisfyCustom: "{{type}} name `{{name}}` must {{regexMatch}} the RegExp: {{regex}}",
	satisfyCustomForeignContract: `{{type}} name \`{{name}}\` must {{regexMatch}} the RegExp: {{regex}}${FOREIGN_CONTRACT_HINT}`,
	unexpectedUnderscore: "{{type}} name `{{name}}` must not have a {{position}} underscore.",
	unexpectedUnderscoreForeignContract: `{{type}} name \`{{name}}\` must not have a {{position}} underscore.${FOREIGN_CONTRACT_HINT}`,
};

// Note that this intentionally does not strictly type the modifiers/types
// properties. This is because doing so creates a huge headache, as the rule's
// code doesn't need to care. The JSON Schema strictly types these properties, so
// we know the user won't input invalid config.
export type Options = Array<NamingSelector>;

// This essentially mirrors ESLint's `camelcase` rule
// note that that rule ignores leading and trailing underscores and only checks
// those in the middle of a variable name
const camelCaseNamingConfig: Options = [
	{
		format: ["camelCase"],
		leadingUnderscore: "allow",
		selector: "default",
		trailingUnderscore: "allow",
	},

	{
		format: ["camelCase", "PascalCase"],
		selector: "import",
	},

	{
		format: ["camelCase", "UPPER_CASE"],
		leadingUnderscore: "allow",
		selector: "variable",
		trailingUnderscore: "allow",
	},

	{
		format: ["PascalCase"],
		selector: "typeLike",
	},
];

function create(
	contextWithoutDefaults: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const context =
		contextWithoutDefaults.options.length > 0
			? contextWithoutDefaults
			: (Object.setPrototypeOf(
					{
						options: camelCaseNamingConfig,
					},
					contextWithoutDefaults,
				) as Context);

	const validators = parseOptions(context);

	const services = getParserServices(context, true);
	const compilerOptions = services.program?.getCompilerOptions() ?? {};
	const contextualTypeCache: ContextualTypeCache = new WeakMap();
	function handleMember(
		validator: ValidatorFunction,
		{
			key,
		}:
			| TSESTree.AccessorPropertyNonComputedName
			| TSESTree.MethodDefinitionNonComputedName
			| TSESTree.PropertyDefinitionNonComputedName
			| TSESTree.PropertyNonComputedName
			| TSESTree.TSAbstractMethodDefinitionNonComputedName
			| TSESTree.TSAbstractPropertyDefinitionNonComputedName
			| TSESTree.TSMethodSignatureNonComputedName
			| TSESTree.TSPropertySignatureNonComputedName,
		modifiers: Set<ModifierType>,
	): void {
		if (requiresQuoting(key, compilerOptions.target)) {
			modifiers.add(Modifier.requiresQuotes);
		}

		validator(key, modifiers);
	}

	const { unusedVariables } = collectVariables(context);
	function isUnused(name: string, initialScope: null | TSESLint.Scope.Scope): boolean {
		let variable: null | TSESLint.Scope.Variable = null;
		let scope: null | TSESLint.Scope.Scope = initialScope;
		while (scope) {
			variable = scope.set.get(name) ?? null;
			if (variable) {
				break;
			}

			scope = scope.upper;
		}

		if (!variable) {
			return false;
		}

		return unusedVariables.has(variable);
	}

	/**
	 * Determines if a class method is implementing an interface method.
	 *
	 * @param node - The class method node to check.
	 * @returns True if the method is implementing an interface method.
	 */
	function isImplementingInterfaceMethod(
		node:
			| TSESTree.MethodDefinitionNonComputedName
			| TSESTree.PropertyDefinitionNonComputedName
			| TSESTree.TSAbstractMethodDefinitionNonComputedName
			| TSESTree.TSAbstractPropertyDefinitionNonComputedName,
	): boolean {
		if (!services.program) {
			return false;
		}

		const checker = services.program.getTypeChecker();

		// Find the class that contains this method
		let parentClass: null | TSESTree.ClassDeclaration | TSESTree.ClassExpression = null;
		let current: TSESTree.Node | undefined = node.parent;

		// eslint-disable-next-line ts/no-unnecessary-condition, ts/strict-boolean-expressions -- Incorrect type narrowing
		while (current) {
			if (
				current.type === AST_NODE_TYPES.ClassDeclaration ||
				current.type === AST_NODE_TYPES.ClassExpression
			) {
				parentClass = current;
				break;
			}

			current = current.parent;
		}

		if (!parentClass?.implements || parentClass.implements.length === 0) {
			return false;
		}

		// Get the method name
		let methodName: null | string = null;
		if (node.key.type === AST_NODE_TYPES.Identifier) {
			methodName = node.key.name;
		} else if (node.key.type === AST_NODE_TYPES.Literal) {
			methodName = String(node.key.value);
		}

		if (methodName === null) {
			return false;
		}

		return checkInterfacesForMethod(parentClass.implements, methodName, checker, services);
	}

	const selectors: {
		readonly [k in keyof TSESLint.RuleListener]: Readonly<{
			handler: (
				node: Parameters<NonNullable<TSESLint.RuleListener[k]>>[0],
				validator: ValidatorFunction,
			) => void;
			validator: ValidatorFunction;
		}>;
	} = {
		// #region import

		// #region parameter
		':matches(PropertyDefinition, TSAbstractPropertyDefinition)[computed = false][value.type != "ArrowFunctionExpression"][value.type != "FunctionExpression"][value.type != "TSEmptyBodyFunctionExpression"]':
			{
				handler: (
					node:
						| TSESTree.PropertyDefinitionNonComputedName
						| TSESTree.TSAbstractPropertyDefinitionNonComputedName,
					validator,
				): void => {
					const modifiers = getMemberModifiers(node);
					handleMember(validator, node, modifiers);
				},
				validator: validators.classProperty,
			},

		// #endregion

		// #region variable

		':not(ObjectPattern) > Property[computed = false][kind = "init"][value.type != "ArrowFunctionExpression"][value.type != "FunctionExpression"][value.type != "TSEmptyBodyFunctionExpression"]':
			{
				handler: (node: TSESTree.PropertyNonComputedName, validator): void => {
					// Skip naming validation if the name is dictated by the
					// contextual type of the enclosing object literal
					if (isDictatedByContextualType(node, services, contextualTypeCache)) {
						return;
					}

					// The keys of an object-style enum (`const X = {...} as
					// const`) are a closed set of member names, not
					// object-literal properties - validate them as enumMembers so
					// a laundering rename can't sneak a foreign-shaped key past
					// this rule; the intended escape is `satisfies` (see
					// isObjectStyleEnumKey).
					if (isObjectStyleEnumKey(node)) {
						const enumModifiers = new Set<ModifierType>();
						if (requiresQuoting(node.key, compilerOptions.target)) {
							enumModifiers.add(Modifier.requiresQuotes);
						}

						validators.enumMember(node.key, enumModifiers, true);
						return;
					}

					const modifiers = new Set<ModifierType>([Modifier.public]);
					handleMember(validator, node, modifiers);
				},
				validator: validators.objectLiteralProperty,
			},

		// #endregion

		// #region function

		[[
			"TSMethodSignature[computed = false]",
			'TSPropertySignature[computed = false][typeAnnotation.typeAnnotation.type = "TSFunctionType"]',
		].join(", ")]: {
			handler: (
				node:
					| TSESTree.TSMethodSignatureNonComputedName
					| TSESTree.TSPropertySignatureNonComputedName,
				validator,
			): void => {
				// Skip naming validation for members of a type that's declared to
				// mirror a foreign wire format
				if (isExternalMember(node, context.sourceCode)) {
					return;
				}

				const modifiers = new Set<ModifierType>([Modifier.public]);
				handleMember(validator, node, modifiers);
			},
			validator: validators.typeMethod,
		},

		// #endregion function

		[[
			':matches(PropertyDefinition, TSAbstractPropertyDefinition)[computed = false][value.type = "ArrowFunctionExpression"]',
			':matches(PropertyDefinition, TSAbstractPropertyDefinition)[computed = false][value.type = "FunctionExpression"]',
			':matches(PropertyDefinition, TSAbstractPropertyDefinition)[computed = false][value.type = "TSEmptyBodyFunctionExpression"]',
			':matches(MethodDefinition, TSAbstractMethodDefinition)[computed = false][kind = "method"]',
		].join(", ")]: {
			handler: (
				node:
					| TSESTree.MethodDefinitionNonComputedName
					| TSESTree.PropertyDefinitionNonComputedName
					| TSESTree.TSAbstractMethodDefinitionNonComputedName
					| TSESTree.TSAbstractPropertyDefinitionNonComputedName,
				validator,
			): void => {
				// Skip naming validation if this method is implementing an
				// interface method
				if (isImplementingInterfaceMethod(node)) {
					return;
				}

				const modifiers = getMemberModifiers(node);

				if (isAsyncMemberOrProperty(node)) {
					modifiers.add(Modifier.async);
				}

				handleMember(validator, node, modifiers);
			},
			validator: validators.classMethod,
		},

		// #endregion parameter

		// #region parameterProperty

		[[
			'MethodDefinition[computed = false]:matches([kind = "get"], [kind = "set"])',
			'TSAbstractMethodDefinition[computed = false]:matches([kind="get"], [kind="set"])',
		].join(", ")]: {
			handler: (node: TSESTree.MethodDefinitionNonComputedName, validator): void => {
				const modifiers = getMemberModifiers(node);
				handleMember(validator, node, modifiers);
			},
			validator: validators.classicAccessor,
		},

		// #endregion parameterProperty

		// #region property

		[[
			'Property[computed = false][kind = "init"][value.type = "ArrowFunctionExpression"]',
			'Property[computed = false][kind = "init"][value.type = "FunctionExpression"]',
			'Property[computed = false][kind = "init"][value.type = "TSEmptyBodyFunctionExpression"]',
		].join(", ")]: {
			handler: (
				node: TSESTree.PropertyNonComputedName | TSESTree.TSMethodSignatureNonComputedName,
				validator,
			): void => {
				// Skip naming validation if the name is dictated by the
				// contextual type of the enclosing object literal
				if (
					node.type === AST_NODE_TYPES.Property &&
					isDictatedByContextualType(node, services, contextualTypeCache)
				) {
					return;
				}

				const modifiers = new Set<ModifierType>([Modifier.public]);

				if (isAsyncMemberOrProperty(node)) {
					modifiers.add(Modifier.async);
				}

				handleMember(validator, node, modifiers);
			},
			validator: validators.objectLiteralMethod,
		},

		[[AST_NODE_TYPES.AccessorProperty, AST_NODE_TYPES.TSAbstractAccessorProperty].join(", ")]: {
			handler: (node: TSESTree.AccessorPropertyNonComputedName, validator): void => {
				const modifiers = getMemberModifiers(node);
				handleMember(validator, node, modifiers);
			},
			validator: validators.autoAccessor,
		},

		// computed is optional, so can't do [computed = false]
		"ClassDeclaration, ClassExpression": {
			handler: (
				node: TSESTree.ClassDeclaration | TSESTree.ClassExpression,
				validator,
			): void => {
				const { id, abstract } = node;
				if (id === null) {
					return;
				}

				const modifiers = new Set<ModifierType>();
				// classes create their own nested scope
				const scope = context.sourceCode.getScope(node).upper;

				if (abstract) {
					modifiers.add(Modifier.abstract);
				}

				if (isExported(node, id.name, scope)) {
					modifiers.add(Modifier.exported);
				}

				if (isUnused(id.name, scope)) {
					modifiers.add(Modifier.unused);
				}

				validator(id, modifiers);
			},
			validator: validators.class,
		},

		// #endregion property

		// #region method

		"FunctionDeclaration, TSDeclareFunction, FunctionExpression": {
			handler: (
				node:
					| TSESTree.FunctionDeclaration
					| TSESTree.FunctionExpression
					| TSESTree.TSDeclareFunction,
				validator,
			): void => {
				if (node.id === null) {
					return;
				}

				const modifiers = new Set<ModifierType>();
				// functions create their own nested scope
				const scope = context.sourceCode.getScope(node).upper;

				if (isGlobal(scope)) {
					modifiers.add(Modifier.global);
				}

				if (isExported(node, node.id.name, scope)) {
					modifiers.add(Modifier.exported);
				}

				if (isUnused(node.id.name, scope)) {
					modifiers.add(Modifier.unused);
				}

				if (node.async) {
					modifiers.add(Modifier.async);
				}

				validator(node.id, modifiers);
			},
			validator: validators.function,
		},

		"FunctionDeclaration, TSDeclareFunction, TSEmptyBodyFunctionExpression, FunctionExpression, ArrowFunctionExpression":
			{
				handler: (
					node:
						| TSESTree.ArrowFunctionExpression
						| TSESTree.FunctionDeclaration
						| TSESTree.FunctionExpression
						| TSESTree.TSDeclareFunction
						| TSESTree.TSEmptyBodyFunctionExpression,
					validator,
				): void => {
					for (const parameter of node.params) {
						if (parameter.type === AST_NODE_TYPES.TSParameterProperty) {
							continue;
						}

						const identifiers = getIdentifiersFromPattern(parameter);

						for (const index of identifiers) {
							const modifiers = new Set<ModifierType>();

							if (isDestructured(index)) {
								modifiers.add(Modifier.destructured);
							}

							if (isUnused(index.name, context.sourceCode.getScope(index))) {
								modifiers.add(Modifier.unused);
							}

							validator(index, modifiers);
						}
					}
				},
				validator: validators.parameter,
			},

		"ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier": {
			handler: (
				node:
					| TSESTree.ImportDefaultSpecifier
					| TSESTree.ImportNamespaceSpecifier
					| TSESTree.ImportSpecifier,
				validator,
			): void => {
				const modifiers = new Set<ModifierType>();

				switch (node.type) {
					case AST_NODE_TYPES.ImportDefaultSpecifier: {
						modifiers.add(Modifier.default);
						break;
					}
					case AST_NODE_TYPES.ImportNamespaceSpecifier: {
						modifiers.add(Modifier.namespace);
						break;
					}
					case AST_NODE_TYPES.ImportSpecifier: {
						// Handle `import { default as Foo }`
						if (
							node.imported.type === AST_NODE_TYPES.Identifier &&
							node.imported.name !== "default"
						) {
							return;
						}

						modifiers.add(Modifier.default);
						break;
					}
				}

				validator(node.local, modifiers);
			},
			validator: validators.import,
		},

		// #endregion method

		// #region accessor

		'Property[computed = false]:matches([kind = "get"], [kind = "set"])': {
			handler: (node: TSESTree.PropertyNonComputedName, validator): void => {
				const modifiers = new Set<ModifierType>([Modifier.public]);
				handleMember(validator, node, modifiers);
			},
			validator: validators.classicAccessor,
		},

		"TSEnumDeclaration": {
			handler: (node, validator): void => {
				const modifiers = new Set<ModifierType>();
				// enums create their own nested scope
				const scope = context.sourceCode.getScope(node).upper;

				if (isExported(node, node.id.name, scope)) {
					modifiers.add(Modifier.exported);
				}

				if (isUnused(node.id.name, scope)) {
					modifiers.add(Modifier.unused);
				}

				validator(node.id, modifiers);
			},
			validator: validators.enum,
		},

		// #endregion accessor

		// #region autoAccessor

		"TSEnumMember": {
			handler: ({ id }: TSESTree.TSEnumMember, validator): void => {
				const modifiers = new Set<ModifierType>();

				if (requiresQuoting(id, compilerOptions.target)) {
					modifiers.add(Modifier.requiresQuotes);
				}

				validator(id, modifiers);
			},
			validator: validators.enumMember,
		},

		// #endregion autoAccessor

		// #region enumMember

		"TSInterfaceDeclaration": {
			handler: (node, validator): void => {
				const modifiers = new Set<ModifierType>();
				const scope = context.sourceCode.getScope(node);

				if (isExported(node, node.id.name, scope)) {
					modifiers.add(Modifier.exported);
				}

				if (isUnused(node.id.name, scope)) {
					modifiers.add(Modifier.unused);
				}

				validator(node.id, modifiers);
			},
			validator: validators.interface,
		},

		// #endregion enumMember

		// #region class

		"TSParameterProperty": {
			handler: (node, validator): void => {
				const modifiers = getMemberModifiers(node);

				const identifiers = getIdentifiersFromPattern(node.parameter);

				for (const index of identifiers) {
					validator(index, modifiers);
				}
			},
			validator: validators.parameterProperty,
		},

		// #endregion class

		// #region interface

		'TSPropertySignature[computed = false][typeAnnotation.typeAnnotation.type != "TSFunctionType"]':
			{
				handler: (node: TSESTree.TSPropertySignatureNonComputedName, validator): void => {
					// Skip naming validation for members of a type that's
					// declared to mirror a foreign wire format
					if (isExternalMember(node, context.sourceCode)) {
						return;
					}

					const modifiers = new Set<ModifierType>([Modifier.public]);
					if (node.readonly) {
						modifiers.add(Modifier.readonly);
					}

					handleMember(validator, node, modifiers);
				},
				validator: validators.typeProperty,
			},

		// #endregion interface

		// #region typeAlias

		"TSTypeAliasDeclaration": {
			handler: (node, validator): void => {
				const modifiers = new Set<ModifierType>();
				const scope = context.sourceCode.getScope(node);

				if (isExported(node, node.id.name, scope)) {
					modifiers.add(Modifier.exported);
				}

				if (isUnused(node.id.name, scope)) {
					modifiers.add(Modifier.unused);
				}

				validator(node.id, modifiers);
			},
			validator: validators.typeAlias,
		},

		// #endregion typeAlias

		// #region enum

		"TSTypeParameterDeclaration > TSTypeParameter": {
			handler: (node: TSESTree.TSTypeParameter, validator): void => {
				const modifiers = new Set<ModifierType>();
				const scope = context.sourceCode.getScope(node);

				if (isUnused(node.name.name, scope)) {
					modifiers.add(Modifier.unused);
				}

				validator(node.name, modifiers);
			},
			validator: validators.typeParameter,
		},

		// #endregion enum

		// #region typeParameter

		"VariableDeclarator": {
			handler: (node, validator): void => {
				const identifiers = getIdentifiersFromPattern(node.id);

				const baseModifiers = new Set<ModifierType>();
				const { init, parent } = node;
				if (parent.kind === "const") {
					baseModifiers.add(Modifier.const);
				}

				if (isGlobal(context.sourceCode.getScope(node))) {
					baseModifiers.add(Modifier.global);
				}

				// Computed uniformly regardless of foreign-contract escape: a
				// bare-const-asserted object is claimed by the objectStyleEnum
				// validator below, so in practice this modifier only ever reaches
				// the `variable` validator for the `satisfies`-wrapped form.
				if (isConstAssertedInitializer(init)) {
					baseModifiers.add(Modifier.constAsserted);
				}

				// Check if this is an object-style enum (const assertion)
				const isObjectStyleEnum = isObjectStyleEnumDeclaration(node, parent);

				for (const id of identifiers) {
					const modifiers = new Set(baseModifiers);

					if (isDestructured(id)) {
						modifiers.add(Modifier.destructured);
					}

					const scope = context.sourceCode.getScope(id);
					if (isExported(parent, id.name, scope)) {
						modifiers.add(Modifier.exported);
					}

					if (isUnused(id.name, scope)) {
						modifiers.add(Modifier.unused);
					}

					if (isAsyncVariableIdentifier(id)) {
						modifiers.add(Modifier.async);
					}

					// Use the appropriate validator based on whether it's an
					// object-style enum
					if (isObjectStyleEnum) {
						validators.objectStyleEnum(id, modifiers, true);
					} else {
						validator(id, modifiers);
					}
				}
			},
			validator: validators.variable,
		},

		// #endregion typeParameter
	};

	return Object.fromEntries(
		Object.entries(selectors).map(([selector, { handler, validator }]) => {
			return [
				selector,
				(node: Parameters<typeof handler>[0]): void => {
					// eslint-disable-next-line ts/no-unnecessary-type-assertion -- Breaks otherwise
					handler(node as never, validator);
				},
			] as const;
		}),
	);
}

export const namingConvention = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: camelCaseNamingConfig,
	meta: {
		docs: {
			description: "Enforce naming conventions for everything across a codebase",
			recommended: true,
			requiresTypeChecking: true,
		},
		fixable: undefined,
		hasSuggestions: false,
		messages,
		schema: SCHEMA,
		type: "suggestion",
	},
});

/**
 * Checks if a method name exists in any of the implemented interfaces.
 *
 * @param implementsList - List of implemented interfaces.
 * @param methodName - Name of the method to check.
 * @param checker - TypeScript type checker.
 * @param services - Parser services.
 * @returns True if the method name is found in any interface.
 */
function checkInterfacesForMethod(
	implementsList: Array<TSESTree.TSClassImplements>,
	methodName: string,
	checker: import("typescript").TypeChecker,
	services: ReturnType<typeof getParserServices>,
): boolean {
	for (const implementsClause of implementsList) {
		const interfaceType = checker.getTypeAtLocation(
			services.esTreeNodeToTSNodeMap.get(implementsClause),
		);
		const interfaceSymbol = interfaceType.getSymbol();

		if (!interfaceSymbol) {
			continue;
		}

		const interfaceMembers = checker.getPropertiesOfType(interfaceType);

		for (const member of interfaceMembers) {
			if (member.name === methodName) {
				return true;
			}
		}
	}

	return false;
}

function getIdentifiersFromPattern(
	pattern: TSESTree.DestructuringPattern,
): Array<TSESTree.Identifier> {
	const identifiers: Array<TSESTree.Identifier> = [];
	const stack: Array<TSESTree.Node> = [pattern];

	// `for...of` re-checks length each step, so entries pushed during iteration
	// are still visited
	for (const node of stack) {
		// eslint-disable-next-line ts/switch-exhaustiveness-check -- Only pattern nodes can bind names; everything else falls through
		switch (node.type) {
			case AST_NODE_TYPES.ArrayPattern: {
				for (const element of node.elements) {
					if (element !== null) {
						stack.push(element);
					}
				}

				break;
			}
			case AST_NODE_TYPES.AssignmentPattern: {
				stack.push(node.left);
				break;
			}
			case AST_NODE_TYPES.Identifier: {
				identifiers.push(node);
				break;
			}
			case AST_NODE_TYPES.ObjectPattern: {
				for (const property of node.properties) {
					stack.push(property);
				}

				break;
			}
			case AST_NODE_TYPES.Property: {
				stack.push(node.value);
				break;
			}
			case AST_NODE_TYPES.RestElement: {
				stack.push(node.argument);
				break;
			}
			default: {
				// Other node types (e.g. MemberExpression) cannot bind new names
				break;
			}
		}
	}

	return identifiers;
}

function getMemberModifiers(
	node:
		| TSESTree.AccessorProperty
		| TSESTree.MethodDefinition
		| TSESTree.PropertyDefinition
		| TSESTree.TSAbstractAccessorProperty
		| TSESTree.TSAbstractMethodDefinition
		| TSESTree.TSAbstractPropertyDefinition
		| TSESTree.TSParameterProperty,
): Set<ModifierType> {
	const modifiers = new Set<ModifierType>();
	if ("key" in node && node.key.type === AST_NODE_TYPES.PrivateIdentifier) {
		modifiers.add(Modifier["#private"]);
	} else if (node.accessibility) {
		modifiers.add(Modifier[node.accessibility]);
	} else {
		modifiers.add(Modifier.public);
	}

	if (node.static) {
		modifiers.add(Modifier.static);
	}

	if ("readonly" in node && node.readonly) {
		modifiers.add(Modifier.readonly);
	}

	if ("override" in node && node.override) {
		modifiers.add(Modifier.override);
	}

	if (
		node.type === AST_NODE_TYPES.TSAbstractPropertyDefinition ||
		node.type === AST_NODE_TYPES.TSAbstractMethodDefinition ||
		node.type === AST_NODE_TYPES.TSAbstractAccessorProperty
	) {
		modifiers.add(Modifier.abstract);
	}

	return modifiers;
}

function isAsyncMemberOrProperty(
	propertyOrMemberNode:
		| TSESTree.MethodDefinitionNonComputedName
		| TSESTree.PropertyDefinitionNonComputedName
		| TSESTree.PropertyNonComputedName
		| TSESTree.TSAbstractMethodDefinitionNonComputedName
		| TSESTree.TSAbstractPropertyDefinitionNonComputedName
		| TSESTree.TSMethodSignatureNonComputedName,
): boolean {
	return Boolean(
		"value" in propertyOrMemberNode &&
		propertyOrMemberNode.value &&
		"async" in propertyOrMemberNode.value &&
		propertyOrMemberNode.value.async,
	);
}

function isAsyncVariableIdentifier(id: TSESTree.Identifier): boolean {
	return Boolean(
		("async" in id.parent && id.parent.async) ||
		("init" in id.parent &&
			id.parent.init &&
			"async" in id.parent.init &&
			id.parent.init.async),
	);
}

function isDestructured(id: TSESTree.Identifier): boolean {
	return (
		// `const { x }`
		// does not match `const { x: y }`
		(id.parent.type === AST_NODE_TYPES.Property && id.parent.shorthand) ||
		// `const { x = 2 }`
		// does not match const `{ x: y = 2 }`
		(id.parent.type === AST_NODE_TYPES.AssignmentPattern &&
			id.parent.parent.type === AST_NODE_TYPES.Property &&
			id.parent.parent.shorthand)
	);
}

function isExported(
	node: TSESTree.Node | undefined,
	name: string,
	scope: null | TSESLint.Scope.Scope,
): boolean {
	if (
		node?.parent?.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
		node?.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration
	) {
		return true;
	}

	if (scope === null) {
		return false;
	}

	const variable = scope.set.get(name);
	if (variable) {
		for (const ref of variable.references) {
			const refParent = ref.identifier.parent;
			if (
				refParent.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
				refParent.type === AST_NODE_TYPES.ExportSpecifier
			) {
				return true;
			}
		}
	}

	return false;
}

function isGlobal(scope: null | TSESLint.Scope.Scope): boolean {
	if (scope === null) {
		return false;
	}

	return (
		scope.type === TSESLint.Scope.ScopeType.global ||
		scope.type === TSESLint.Scope.ScopeType.module
	);
}

/**
 * Checks whether a type annotation is the bare `const` type reference used by
 * const assertions (`as const`, `<const>`).
 *
 * @param typeAnnotation - The type node to check.
 * @returns True if the type node is the `const` reference.
 */
function isConstTypeReference(typeAnnotation: TSESTree.TypeNode): boolean {
	return (
		typeAnnotation.type === AST_NODE_TYPES.TSTypeReference &&
		typeAnnotation.typeName.type === AST_NODE_TYPES.Identifier &&
		typeAnnotation.typeName.name === "const"
	);
}

/**
 * Unwraps a *bare* const-asserted object expression - `{...} as const` or
 * `<const>{...}` - directly, with no `satisfies` wrapper. A `satisfies`
 * wrapper is a distinct, intentional escape hatch (declaring conformance to
 * an externally-owned type) and must never be treated as the same thing by
 * this helper; callers that also want to recognize the `satisfies`-wrapped
 * form unwrap it themselves first (see `isConstAssertedInitializer`).
 *
 * @param expression - The expression to unwrap.
 * @returns The inner object expression, or undefined if `expression` isn't a
 *   bare const-asserted object literal.
 */
function getConstAssertedObject(
	expression: TSESTree.Expression,
): TSESTree.ObjectExpression | undefined {
	if (
		(expression.type === AST_NODE_TYPES.TSAsExpression ||
			expression.type === AST_NODE_TYPES.TSTypeAssertion) &&
		isConstTypeReference(expression.typeAnnotation) &&
		expression.expression.type === AST_NODE_TYPES.ObjectExpression
	) {
		return expression.expression;
	}

	return undefined;
}

/**
 * Determines if a VariableDeclarator represents an object-style enum
 * declaration.
 *
 * Object-style enums are *bare* const assertions applied to object
 * expressions, commonly used as an alternative to TypeScript enums. Examples:
 * - `const Colors = { RED: 'red', BLUE: 'blue' } as const`
 * - `const Status = <const>{ OK: 200, ERROR: 500 }`
 * - `const Config: Options = { RED: 'red' } as const` (a type annotation on
 *   the binding doesn't opt out - `satisfies` is the intended escape).
 *
 * A const assertion wrapped in `satisfies` (`{...} as const satisfies T`) is
 * explicitly excluded: it declares conformance to an externally-owned type,
 * which is the foreign-contract escape hatch this rule wants authors to
 * reach for instead of renaming keys to fit.
 *
 * @param node - The VariableDeclarator AST node to check.
 * @param parent - The parent VariableDeclaration node.
 * @returns True if this represents an object-style enum declaration.
 */
function isObjectStyleEnumDeclaration(
	node: TSESTree.VariableDeclarator,
	parent: TSESTree.VariableDeclaration,
): boolean {
	if (parent.kind !== "const" || !node.init) {
		return false;
	}

	// `satisfies` is the foreign-contract escape hatch - never classify it as
	// an object-style enum, even though its expression is `as const` too.
	if (node.init.type === AST_NODE_TYPES.TSSatisfiesExpression) {
		return false;
	}

	return getConstAssertedObject(node.init) !== undefined;
}

/**
 * True when `init` is a const-asserted object expression, bare (`{...} as
 * const`) or `satisfies`-wrapped (`{...} as const satisfies T`). Used for the
 * `constAsserted` variable modifier, which - unlike `isObjectStyleEnumDeclaration`
 * - deliberately covers both forms: it exists so consumers can pin a format on
 * const-asserted data objects regardless of whether they carry a `satisfies`
 * clause.
 *
 * @param init - The VariableDeclarator's initializer, if any.
 * @returns True if `init` is a const-asserted object expression.
 */
function isConstAssertedInitializer(init: null | TSESTree.Expression | undefined): boolean {
	if (!init) {
		return false;
	}

	const expression = init.type === AST_NODE_TYPES.TSSatisfiesExpression ? init.expression : init;

	return getConstAssertedObject(expression) !== undefined;
}

/**
 * Determines if an object literal property is a direct key of an
 * object-style-enum declaration's object literal - i.e. `RED` in `const
 * Colors = { RED: 'red' } as const`, but not a key of a nested object value.
 * Nested object values aren't reached because their enclosing ObjectExpression
 * is parented by a Property, not the const-assertion node this checks for.
 *
 * @param node - The non-computed object literal property node.
 * @returns True if this property is a top-level object-style-enum key.
 */
function isObjectStyleEnumKey(node: TSESTree.PropertyNonComputedName): boolean {
	const objectExpression = node.parent;
	if (objectExpression.type !== AST_NODE_TYPES.ObjectExpression) {
		return false;
	}

	const assertion = objectExpression.parent;
	if (
		(assertion.type !== AST_NODE_TYPES.TSAsExpression &&
			assertion.type !== AST_NODE_TYPES.TSTypeAssertion) ||
		getConstAssertedObject(assertion) !== objectExpression
	) {
		return false;
	}

	const declarator = assertion.parent;
	return (
		declarator.type === AST_NODE_TYPES.VariableDeclarator && declarator.parent.kind === "const"
	);
}

const EXTERNAL_JSDOC_TAG_PATTERN = /@external\b/u;

/**
 * Resolves the node whose leading comments should be inspected for JSDoc -
 * for an exported declaration, the JSDoc block precedes the `export` keyword,
 * not the declaration itself.
 *
 * @param node - The declaration node.
 * @returns The export wrapper if present, otherwise `node` itself.
 */
function getJsDocumentTargetNode(node: TSESTree.Node): TSESTree.Node {
	const { parent } = node;
	if (
		parent?.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
		parent?.type === AST_NODE_TYPES.ExportNamedDeclaration
	) {
		return parent;
	}

	return node;
}

/**
 * Checks whether `node`'s immediately preceding JSDoc block comment carries
 * an `@external` tag, marking the name(s) it documents as coming from a
 * foreign wire format.
 *
 * @param node - The node to check.
 * @param sourceCode - Used to read the comments preceding `node`.
 * @returns True if the leading JSDoc comment contains `@external`.
 */
function hasExternalJsDocumentTag(node: TSESTree.Node, sourceCode: TSESLint.SourceCode): boolean {
	const comments = sourceCode.getCommentsBefore(getJsDocumentTargetNode(node));
	const lastComment = comments.at(-1);
	return (
		lastComment?.type === AST_TOKEN_TYPES.Block &&
		lastComment.value.startsWith("*") &&
		EXTERNAL_JSDOC_TAG_PATTERN.test(lastComment.value)
	);
}

/**
 * Walks up from a type member to the nearest enclosing interface or type
 * alias declaration, passing through any nested type literals along the way
 * - foreign formats nest, so an `@external` tag on the outer declaration
 * covers members at any depth.
 *
 * @param node - The member node to walk up from.
 * @returns The enclosing declaration, or undefined if none is found.
 */
function findEnclosingTypeDeclaration(
	node: TSESTree.Node,
): TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeAliasDeclaration | undefined {
	let current: TSESTree.Node | undefined = node.parent;

	while (current) {
		if (
			current.type === AST_NODE_TYPES.TSInterfaceDeclaration ||
			current.type === AST_NODE_TYPES.TSTypeAliasDeclaration
		) {
			return current;
		}

		current = current.parent;
	}

	return undefined;
}

/**
 * Determines if a typeProperty/typeMethod member should skip naming
 * validation because it (or its enclosing interface/type-alias declaration)
 * is marked `@external` - a foreign wire-format name, not the author's
 * choice. The type's own name (validated via `typeLike`) is unaffected.
 *
 * @param node - The typeProperty/typeMethod node to check.
 * @param sourceCode - Used to read leading comments for the JSDoc check.
 * @returns True if the member should be skipped.
 */
function isExternalMember(node: TSESTree.Node, sourceCode: TSESLint.SourceCode): boolean {
	if (hasExternalJsDocumentTag(node, sourceCode)) {
		return true;
	}

	const enclosing = findEnclosingTypeDeclaration(node);
	return enclosing !== undefined && hasExternalJsDocumentTag(enclosing, sourceCode);
}

function isValidIdentifierText(name: string, languageVersion: ScriptTarget): boolean {
	if (name.length === 0) {
		return false;
	}

	const firstCodePoint = name.codePointAt(0);
	if (firstCodePoint === undefined || !isIdentifierStart(firstCodePoint, languageVersion)) {
		return false;
	}

	let index = firstCodePoint > 0xff_ff ? 2 : 1;
	while (index < name.length) {
		const codePoint = name.codePointAt(index);
		if (codePoint === undefined || !isIdentifierPart(codePoint, languageVersion)) {
			return false;
		}

		index += codePoint > 0xff_ff ? 2 : 1;
	}

	return true;
}

function requiresQuoting(
	node: TSESTree.Identifier | TSESTree.Literal | TSESTree.PrivateIdentifier,
	target: ScriptTarget | undefined,
): boolean {
	const name =
		node.type === AST_NODE_TYPES.Identifier || node.type === AST_NODE_TYPES.PrivateIdentifier
			? node.name
			: `${node.value}`;
	return !isValidIdentifierText(name, target ?? ScriptTarget.Latest);
}
