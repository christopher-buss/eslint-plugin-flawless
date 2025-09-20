/* eslint-disable eslint-plugin/no-property-in-node -- For now */

import { PatternVisitor } from "@typescript-eslint/scope-manager";
import { requiresQuoting as _requiresQuoting } from "@typescript-eslint/type-utils";
import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES, TSESLint } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import { createEslintRule } from "src/util";
import { collectVariables } from "src/utils/collect-variables";
import type { ScriptTarget } from "typescript";

import {
	type Context,
	type NamingSelector,
	parseOptions,
	SCHEMA,
	type ValidatorFunction,
} from "./utils";
import { Modifier, type ModifierType } from "./utils/enums";

export const RULE_NAME = "naming-convention";

export type MessageIds =
	| "doesNotMatchFormat"
	| "doesNotMatchFormatTrimmed"
	| "missingAffix"
	| "missingUnderscore"
	| "satisfyCustom"
	| "unexpectedUnderscore";

const messages = {
	doesNotMatchFormat:
		"{{type}} name `{{name}}` must match one of the following formats: {{formats}}",
	doesNotMatchFormatTrimmed:
		"{{type}} name `{{name}}` trimmed as `{{processedName}}` must match one of the following formats: {{formats}}",
	missingAffix:
		"{{type}} name `{{name}}` must have one of the following {{position}}es: {{affixes}}",
	missingUnderscore: "{{type}} name `{{name}}` must have {{count}} {{position}} underscore(s).",
	satisfyCustom: "{{type}} name `{{name}}` must {{regexMatch}} the RegExp: {{regex}}",
	unexpectedUnderscore: "{{type}} name `{{name}}` must not have a {{position}} underscore.",
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

	const compilerOptions = getParserServices(context, true).program?.getCompilerOptions() ?? {};
	function handleMember(
		validator: ValidatorFunction,
		node:
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
		const { key } = node;
		if (requiresQuoting(key, compilerOptions.target)) {
			modifiers.add(Modifier.requiresQuotes);
		}

		validator(key, modifiers);
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

	// eslint-disable-next-line unicorn/consistent-function-scoping -- Retain
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

	// eslint-disable-next-line unicorn/consistent-function-scoping -- Retain
	function isAsyncVariableIdentifier(id: TSESTree.Identifier): boolean {
		return Boolean(
			("async" in id.parent && id.parent.async) ||
				("init" in id.parent &&
					id.parent.init &&
					"async" in id.parent.init &&
					id.parent.init.async),
		);
	}

	/**
	 * Determines if a VariableDeclarator represents an object-style enum declaration.
	 *
	 * Object-style enums are const assertions applied to object expressions, commonly
	 * used as an alternative to TypeScript enums. Examples:
	 * - `const Colors = { RED: 'red', BLUE: 'blue' } as const`
	 * - `const Status = <const>{ OK: 200, ERROR: 500 }`.
	 *
	 * @param node - The VariableDeclarator AST node to check.
	 * @param parent - The parent VariableDeclaration node.
	 * @returns True if this represents an object-style enum declaration.
	 */
	function isObjectStyleEnumDeclaration(
		node: TSESTree.VariableDeclarator,
		parent: TSESTree.VariableDeclaration,
	): boolean {
		// Must be a const declaration
		if (parent.kind !== "const") {
			return false;
		}

		if (!node.init) {
			return false;
		}

		// Check for const assertion: `as const`
		if (
			node.init.type === AST_NODE_TYPES.TSAsExpression &&
			node.init.typeAnnotation.type === AST_NODE_TYPES.TSTypeReference &&
			node.init.typeAnnotation.typeName.type === AST_NODE_TYPES.Identifier &&
			node.init.typeAnnotation.typeName.name === "const" &&
			node.init.expression.type === AST_NODE_TYPES.ObjectExpression
		) {
			return true;
		}

		// Check for type assertion: `<const>`
		if (
			node.init.type === AST_NODE_TYPES.TSTypeAssertion &&
			node.init.typeAnnotation.type === AST_NODE_TYPES.TSTypeReference &&
			node.init.typeAnnotation.typeName.type === AST_NODE_TYPES.Identifier &&
			node.init.typeAnnotation.typeName.name === "const" &&
			node.init.expression.type === AST_NODE_TYPES.ObjectExpression
		) {
			return true;
		}

		return false;
	}

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
		const services = getParserServices(context, true);
		if (!services.program) {
			return false;
		}

		const checker = services.program.getTypeChecker();

		// Find the class that contains this method
		let parentClass: null | TSESTree.ClassDeclaration | TSESTree.ClassExpression = null;
		let current: TSESTree.Node | undefined = node.parent as TSESTree.Node | undefined;

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
				const { abstract, id } = node;
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
			handler: (node: TSESTree.TSEnumMember, validator): void => {
				const { id } = node;
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
				const { parent } = node;
				if (parent.kind === "const") {
					baseModifiers.add(Modifier.const);
				}

				if (isGlobal(context.sourceCode.getScope(node))) {
					baseModifiers.add(Modifier.global);
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
						validators.objectStyleEnum(id, modifiers);
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
					handler(node, validator);
				},
			] as const;
		}),
	);
}

export const namingConvention = createEslintRule<Options, MessageIds>({
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
	name: RULE_NAME,
});

function getIdentifiersFromPattern(
	pattern: TSESTree.DestructuringPattern,
): Array<TSESTree.Identifier> {
	const identifiers: Array<TSESTree.Identifier> = [];
	const visitor = new PatternVisitor({}, pattern, (id) => identifiers.push(id));
	visitor.visit(pattern);
	return identifiers;
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

function requiresQuoting(
	node: TSESTree.Identifier | TSESTree.Literal | TSESTree.PrivateIdentifier,
	target: ScriptTarget | undefined,
): boolean {
	const name =
		node.type === AST_NODE_TYPES.Identifier || node.type === AST_NODE_TYPES.PrivateIdentifier
			? node.name
			: `${node.value}`;
	return _requiresQuoting(name, target);
}
