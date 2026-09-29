import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import { parameterAnnotation, parameterName } from "../shared/function-parameters";
import { lookupAlias } from "../shared/type-bindings";

export const RULE_NAME = "no-object-parameters";

const MESSAGE_ID = "objectParameter";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Parameter `{{parameter}}` accepts any object shape (`{{type}}`). Use the expected owner type or decode the external input at its boundary.",
};

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
			if (member.type !== AST_NODE_TYPES.TSIndexSignature) {
				return false;
			}

			const value = member.typeAnnotation?.typeAnnotation;
			return value !== undefined && isOpenValueType(value);
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
