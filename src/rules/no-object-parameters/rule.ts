import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-object-parameters";

const MESSAGE_ID = "objectParameter";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Parameter `{{parameter}}` accepts any object shape (`{{type}}`). Use the expected owner type or decode the external input at its boundary.",
};

/** Every node kind that may carry a parameter's type annotation. */
type AnnotatedNode = TSESTree.DestructuringPattern | TSESTree.Parameter;

/** What is left of a parameter once rest, default, and modifiers are stripped. */
type ParameterBinding =
	| TSESTree.ArrayPattern
	| TSESTree.Identifier
	| TSESTree.MemberExpression
	| TSESTree.ObjectPattern;

type ParameterOwner =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression
	| TSESTree.TSCallSignatureDeclaration
	| TSESTree.TSConstructorType
	| TSESTree.TSConstructSignatureDeclaration
	| TSESTree.TSDeclareFunction
	| TSESTree.TSEmptyBodyFunctionExpression
	| TSESTree.TSFunctionType
	| TSESTree.TSMethodSignature;

function parameterAnnotation(node: AnnotatedNode): TSESTree.TSTypeAnnotation | undefined {
	if (node.type === AST_NODE_TYPES.TSParameterProperty) {
		return parameterAnnotation(node.parameter);
	}

	if (node.type === AST_NODE_TYPES.RestElement) {
		return node.typeAnnotation ?? parameterAnnotation(node.argument);
	}

	if (node.type === AST_NODE_TYPES.AssignmentPattern) {
		return node.typeAnnotation ?? parameterAnnotation(node.left);
	}

	if (node.type === AST_NODE_TYPES.MemberExpression) {
		return undefined;
	}

	return node.typeAnnotation;
}

function parameterBinding(node: AnnotatedNode): ParameterBinding {
	if (node.type === AST_NODE_TYPES.TSParameterProperty) {
		return parameterBinding(node.parameter);
	}

	if (node.type === AST_NODE_TYPES.RestElement) {
		return parameterBinding(node.argument);
	}

	if (node.type === AST_NODE_TYPES.AssignmentPattern) {
		return parameterBinding(node.left);
	}

	return node;
}

/**
 * Names the reported parameter. Destructured parameters have no name, so the
 * binding pattern's own source text is used with any type annotation removed
 * (the annotation is part of the pattern node's range).
 *
 * @param parameter - The offending parameter.
 * @param sourceCode - The source code of the linted file.
 * @returns A human-readable name for the parameter.
 */
function parameterName(
	parameter: TSESTree.Parameter,
	sourceCode: Readonly<TSESLint.SourceCode>,
): string {
	const binding = parameterBinding(parameter);
	if (binding.type === AST_NODE_TYPES.Identifier) {
		return binding.name;
	}

	const text = sourceCode.getText(binding);
	const annotation =
		binding.type === AST_NODE_TYPES.MemberExpression ? undefined : binding.typeAnnotation;
	if (annotation === undefined) {
		return text;
	}

	return text.slice(0, annotation.range[0] - binding.range[0]).replace(/\s*:?\s*$/u, "");
}

/**
 * The statements a node introduces as a type-alias scope, if it is one. Type
 * aliases are block scoped and hoisted, so every statement of the enclosing
 * block is a candidate regardless of where the reference sits.
 *
 * @param node - The node to inspect.
 * @returns The scope's statements, or undefined when the node is not a scope.
 */
function scopeStatements(node: TSESTree.Node): ReadonlyArray<TSESTree.Node> | undefined {
	if (
		node.type === AST_NODE_TYPES.BlockStatement ||
		node.type === AST_NODE_TYPES.Program ||
		node.type === AST_NODE_TYPES.StaticBlock ||
		node.type === AST_NODE_TYPES.TSModuleBlock
	) {
		return node.body;
	}

	return node.type === AST_NODE_TYPES.SwitchCase ? node.consequent : undefined;
}

function declaredStatement(statement: TSESTree.Node): TSESTree.Node | undefined {
	return statement.type === AST_NODE_TYPES.ExportNamedDeclaration
		? (statement.declaration ?? undefined)
		: statement;
}

/**
 * The names a statement adds to the type namespace of its scope.
 *
 * @param declaration - The statement to inspect.
 * @returns The declared type names, empty when the statement declares no type.
 */
function declaredTypeNames(declaration: TSESTree.Node): ReadonlyArray<string> {
	if (declaration.type === AST_NODE_TYPES.ImportDeclaration) {
		return declaration.specifiers.map((specifier) => specifier.local.name);
	}

	if (
		declaration.type === AST_NODE_TYPES.ClassDeclaration ||
		declaration.type === AST_NODE_TYPES.TSEnumDeclaration ||
		declaration.type === AST_NODE_TYPES.TSInterfaceDeclaration ||
		declaration.type === AST_NODE_TYPES.TSTypeAliasDeclaration
	) {
		return declaration.id === null ? [] : [declaration.id.name];
	}

	return [];
}

/**
 * The node enclosing another, stopping at the program root. `parent` is typed as
 * always present, so the walk needs an explicit end.
 *
 * @param node - The node to step out of.
 * @returns The enclosing node, or undefined at the program root.
 */
function enclosingNode(node: TSESTree.Node): TSESTree.Node | undefined {
	return node.type === AST_NODE_TYPES.Program ? undefined : node.parent;
}

/**
 * Resolves a type name to its alias declaration by walking outwards from the
 * reference, so the nearest declaration of that name wins. A nearer declaration
 * that is not an alias (an interface, class, enum, or import) shadows the alias
 * and ends the search.
 *
 * @param name - The referenced type name.
 * @param from - The node the reference appears in.
 * @returns The nearest matching alias declaration, if any.
 */
function lookupAlias(
	name: string,
	from: TSESTree.Node,
): TSESTree.TSTypeAliasDeclaration | undefined {
	let current: TSESTree.Node | undefined = from;
	while (current !== undefined) {
		for (const statement of scopeStatements(current) ?? []) {
			const declaration = declaredStatement(statement);
			if (declaration === undefined || !declaredTypeNames(declaration).includes(name)) {
				continue;
			}

			return declaration.type === AST_NODE_TYPES.TSTypeAliasDeclaration
				? declaration
				: undefined;
		}

		current = enclosingNode(current);
	}

	return undefined;
}

function isEmptyTypeLiteral(type: TSESTree.TypeNode): boolean {
	return type.type === AST_NODE_TYPES.TSTypeLiteral && type.members.length === 0;
}

/**
 * Whether a dictionary value type constrains nothing about the value.
 *
 * @param type - The value type of an index signature or `Record`.
 * @returns True when the value type is `unknown`, `any`, `object`, or `{}`.
 */
function isOpenValueType(type: TSESTree.TypeNode): boolean {
	return (
		type.type === AST_NODE_TYPES.TSAnyKeyword ||
		type.type === AST_NODE_TYPES.TSObjectKeyword ||
		type.type === AST_NODE_TYPES.TSUnknownKeyword ||
		isEmptyTypeLiteral(type)
	);
}

/**
 * Whether a type literal is an open dictionary: index signatures with open
 * value types, and no named property to constrain the shape.
 *
 * @param type - The type literal to inspect.
 * @returns True for `{ [key: string]: unknown }` and friends.
 */
function isOpenDictionaryLiteral(type: TSESTree.TSTypeLiteral): boolean {
	return (
		type.members.length > 0 &&
		type.members.every((member) => {
			return (
				member.type === AST_NODE_TYPES.TSIndexSignature &&
				member.typeAnnotation !== undefined &&
				isOpenValueType(member.typeAnnotation.typeAnnotation)
			);
		})
	);
}

/**
 * Whether a reference is the built-in `Record` with an open value type. Callers
 * resolve local aliases first, so a shadowed `Record` never reaches here.
 *
 * @param type - The type reference to inspect.
 * @returns True for `Record<string, unknown>` and friends.
 */
function isOpenRecord(type: TSESTree.TSTypeReference): boolean {
	const [, value] = type.typeArguments?.params ?? [];
	return (
		type.typeName.type === AST_NODE_TYPES.Identifier &&
		type.typeName.name === "Record" &&
		type.typeArguments?.params.length === 2 &&
		value !== undefined &&
		isOpenValueType(value)
	);
}

/**
 * Finds the node that makes a parameter type accept any object shape, following
 * non-generic type aliases through their lexical scope.
 *
 * @param type - The type node to classify.
 * @param visited - Aliases already being resolved, guarding against cycles.
 * @returns The offending node, or undefined when the type constrains the shape.
 */
function openObjectType(
	type: TSESTree.TypeNode,
	visited: ReadonlySet<TSESTree.TSTypeAliasDeclaration>,
): TSESTree.TypeNode | undefined {
	if (type.type === AST_NODE_TYPES.TSObjectKeyword || isEmptyTypeLiteral(type)) {
		return type;
	}

	if (type.type === AST_NODE_TYPES.TSUnionType) {
		for (const member of type.types) {
			const open = openObjectType(member, visited);
			if (open !== undefined) {
				return open;
			}
		}

		return undefined;
	}

	if (type.type === AST_NODE_TYPES.TSTypeLiteral) {
		return isOpenDictionaryLiteral(type) ? type : undefined;
	}

	if (
		type.type !== AST_NODE_TYPES.TSTypeReference ||
		type.typeName.type !== AST_NODE_TYPES.Identifier
	) {
		return undefined;
	}

	const alias = lookupAlias(type.typeName.name, type);
	if (alias === undefined) {
		return isOpenRecord(type) ? type : undefined;
	}

	// A generic alias is skipped: its arguments decide the final shape.
	if (
		visited.has(alias) ||
		(alias.typeParameters?.params.length ?? 0) > 0 ||
		(type.typeArguments?.params.length ?? 0) > 0
	) {
		return undefined;
	}

	const nextVisited = new Set(visited);
	nextVisited.add(alias);
	return openObjectType(alias.typeAnnotation, nextVisited);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	function checkParameters(node: ParameterOwner): void {
		for (const parameter of node.params) {
			const annotation = parameterAnnotation(parameter);
			if (annotation === undefined) {
				continue;
			}

			const open = openObjectType(annotation.typeAnnotation, new Set());
			if (open === undefined) {
				continue;
			}

			const { sourceCode } = context;
			context.report({
				data: {
					parameter: parameterName(parameter, sourceCode),
					type: sourceCode.getText(open).replace(/\s+/gu, " "),
				},
				messageId: MESSAGE_ID,
				node: annotation.typeAnnotation,
			});
		}
	}

	return {
		ArrowFunctionExpression: checkParameters,
		FunctionDeclaration: checkParameters,
		FunctionExpression: checkParameters,
		TSCallSignatureDeclaration: checkParameters,
		TSConstructorType: checkParameters,
		TSConstructSignatureDeclaration: checkParameters,
		TSDeclareFunction: checkParameters,
		TSEmptyBodyFunctionExpression: checkParameters,
		TSFunctionType: checkParameters,
		TSMethodSignature: checkParameters,
	};
}

export const noObjectParameters = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow function parameters that accept any object shape",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: undefined,
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
