import * as core from "@eslint-react/core";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type { Type } from "typescript";

import { createEslintRule } from "../../util";
import { isTypeFullyReadonly } from "./readonly-type";

export const RULE_NAME = "prefer-read-only-props";

type MessageIds = "preferReadOnlyProps";
type Options = [];

const messages = {
	preferReadOnlyProps: "A function component's props should be read-only.",
};

/** Names of the `React.forwardRef` wrapper whose props are its second type argument. */
const FORWARD_REF_NAMES = new Set(["forwardRef"]);
/** Names of the `React.memo` wrapper whose props are its first type argument. */
const MEMO_NAMES = new Set(["memo"]);
/** Named function-component type aliases whose props are their first type argument. */
const FC_TYPE_NAMES = new Set(["FC", "FunctionComponent", "VFC", "VoidFunctionComponent"]);

/**
 * Strips assignment defaults and rest wrappers to reach the binding pattern
 * that may carry a type annotation.
 *
 * @param node - The component's first parameter.
 * @returns The underlying binding pattern.
 */
function unwrapParameter(node: TSESTree.Node): TSESTree.Node {
	if (node.type === AST_NODE_TYPES.AssignmentPattern) {
		return unwrapParameter(node.left);
	}

	if (node.type === AST_NODE_TYPES.RestElement) {
		return unwrapParameter(node.argument);
	}

	return node;
}

function getEntityName(typeName: TSESTree.EntityName): string | undefined {
	if (typeName.type === AST_NODE_TYPES.Identifier) {
		return typeName.name;
	}

	if (typeName.type === AST_NODE_TYPES.TSQualifiedName) {
		return typeName.right.name;
	}

	return undefined;
}

function getCalleeName(callee: TSESTree.Expression): string | undefined {
	if (
		callee.type === AST_NODE_TYPES.MemberExpression &&
		callee.property.type === AST_NODE_TYPES.Identifier
	) {
		return callee.property.name;
	}

	if (callee.type === AST_NODE_TYPES.Identifier) {
		return callee.name;
	}

	return undefined;
}

/**
 * Extracts the props type argument from a `FC<Props>`-style type reference.
 *
 * @param typeNode - The variable's type annotation.
 * @returns The props type argument node, if the reference is a known FC alias.
 */
function getFcTypeArgument(typeNode: TSESTree.TypeNode): TSESTree.TypeNode | undefined {
	if (typeNode.type !== AST_NODE_TYPES.TSTypeReference) {
		return undefined;
	}

	const { typeArguments, typeName } = typeNode;
	if (typeArguments === undefined || typeArguments.params.length === 0) {
		return undefined;
	}

	const name = getEntityName(typeName);
	if (name === undefined || !FC_TYPE_NAMES.has(name)) {
		return undefined;
	}

	return typeArguments.params[0];
}

/**
 * Locates the props type argument of a `forwardRef`/`memo` wrapper call whose
 * callback is the component function.
 *
 * @param functionNode - The component function node.
 * @returns The props type argument node, if present.
 */
function getWrapperCallTypeArgument({ parent }: TSESTree.Node): TSESTree.TypeNode | undefined {
	if (parent?.type !== AST_NODE_TYPES.CallExpression || parent.typeArguments === undefined) {
		return undefined;
	}

	const name = getCalleeName(parent.callee);
	if (name === undefined) {
		return undefined;
	}

	if (FORWARD_REF_NAMES.has(name)) {
		return parent.typeArguments.params[1];
	}

	if (MEMO_NAMES.has(name)) {
		return parent.typeArguments.params[0];
	}

	return undefined;
}

/**
 * Finds the source type node expressing a component's props, so it can be
 * wrapped in `Readonly<>`. Prefers an explicit parameter annotation and falls
 * back to an `FC`/`forwardRef`/`memo` type argument.
 *
 * @param functionNode - The component function node.
 * @returns The props type node to wrap, or `undefined` when none is locatable.
 */
function findPropsTypeNode(functionNode: TSESTree.Node): TSESTree.TypeNode | undefined {
	if (
		functionNode.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
		functionNode.type !== AST_NODE_TYPES.FunctionDeclaration &&
		functionNode.type !== AST_NODE_TYPES.FunctionExpression
	) {
		return undefined;
	}

	const [firstParameter] = functionNode.params;
	if (firstParameter !== undefined) {
		const binding = unwrapParameter(firstParameter);
		if (
			(binding.type === AST_NODE_TYPES.Identifier ||
				binding.type === AST_NODE_TYPES.ObjectPattern ||
				binding.type === AST_NODE_TYPES.ArrayPattern) &&
			binding.typeAnnotation
		) {
			return binding.typeAnnotation.typeAnnotation;
		}
	}

	const { parent } = functionNode;
	if (
		parent.type === AST_NODE_TYPES.VariableDeclarator &&
		parent.id.type === AST_NODE_TYPES.Identifier &&
		parent.id.typeAnnotation
	) {
		const fromAnnotation = getFcTypeArgument(parent.id.typeAnnotation.typeAnnotation);
		if (fromAnnotation !== undefined) {
			return fromAnnotation;
		}
	}

	return getWrapperCallTypeArgument(functionNode);
}

function create(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const services = getParserServices(context, true);
	if (!services.program) {
		return {};
	}

	const checker = services.program.getTypeChecker();
	const { sourceCode } = context;
	const collector = core.getFunctionComponentCollector(context);

	function getParameterType(parameter: TSESTree.Parameter): Type {
		return checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(parameter));
	}

	function checkComponent(functionNode: TSESTree.Node): void {
		if (
			functionNode.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
			functionNode.type !== AST_NODE_TYPES.FunctionDeclaration &&
			functionNode.type !== AST_NODE_TYPES.FunctionExpression
		) {
			return;
		}

		const [firstParameter] = functionNode.params;
		if (firstParameter === undefined) {
			return;
		}

		const propsType = getParameterType(firstParameter);
		if (isTypeFullyReadonly(checker, propsType)) {
			return;
		}

		const typeNode = findPropsTypeNode(functionNode);
		context.report({
			fix:
				typeNode === undefined
					? undefined
					: (fixer): TSESLint.RuleFix => {
							return fixer.replaceText(
								typeNode,
								`Readonly<${sourceCode.getText(typeNode)}>`,
							);
						},
			messageId: "preferReadOnlyProps",
			node: functionNode,
		});
	}

	const { api, visitor } = collector;
	const collectorExit = visitor["Program:exit"];

	return {
		...visitor,
		"Program:exit": (node): void => {
			collectorExit?.(node);
			for (const component of api.getAllComponents(node)) {
				checkComponent(component.node);
			}
		},
	} satisfies TSESLint.RuleListener;
}

export const preferReadOnlyProps = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Enforce that function component props are read-only",
			recommended: false,
			requiresTypeChecking: true,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
