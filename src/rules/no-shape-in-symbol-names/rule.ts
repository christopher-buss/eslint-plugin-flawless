import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-shape-in-symbol-names";

const MESSAGE_ID = "shapeInName";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const FORBIDDEN_TERM = "shape";

const messages = {
	[MESSAGE_ID]:
		"Rename `{{name}}` for the role it plays: `shape` describes structure, not what the value is.",
};

type NamedNode = TSESTree.Identifier | TSESTree.PrivateIdentifier;

function containsForbiddenTerm(name: string): boolean {
	return name.toLowerCase().includes(FORBIDDEN_TERM);
}

/**
 * Reports whether a specifier was written with an `as` clause.
 *
 * Both names of a specifier are present in the AST even when the source omits
 * `as`, in which case they cover the same source range and the name is the one
 * the other module chose.
 *
 * @param left - The first of the two specifier names.
 * @param right - The second of the two specifier names.
 * @returns Whether the two names come from separate source ranges.
 */
function isAliased(left: TSESTree.Node, right: TSESTree.Node): boolean {
	return left.range[0] !== right.range[0];
}

/**
 * Reports whether a node is a parameter of the function that encloses it.
 *
 * @param parent - The candidate function node.
 * @param node - The node to look for among the parameters.
 * @returns Whether the node is one of the function's parameters.
 */
function isFunctionParameter(parent: TSESTree.Node, node: TSESTree.Node): boolean {
	if (
		parent.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		parent.type === AST_NODE_TYPES.FunctionDeclaration ||
		parent.type === AST_NODE_TYPES.FunctionExpression ||
		parent.type === AST_NODE_TYPES.TSConstructorType ||
		parent.type === AST_NODE_TYPES.TSDeclareFunction ||
		parent.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression ||
		parent.type === AST_NODE_TYPES.TSFunctionType ||
		parent.type === AST_NODE_TYPES.TSMethodSignature
	) {
		return (parent.params as ReadonlyArray<TSESTree.Node>).includes(node);
	}

	return false;
}

/**
 * Reports whether a name introduces a binding.
 *
 * Walks out through the destructuring patterns that wrap the name until it
 * reaches the construct that owns the binding. A name reached from anywhere
 * other than the bound position — the key of an object pattern, a value in an
 * object literal — belongs to something this file only reads.
 *
 * @param node - The name, or the pattern already walked out to.
 * @returns Whether the name declares a variable, parameter, or caught error.
 */
function isBindingName(node: TSESTree.Node): boolean {
	// Only the program root has no parent, and it is never a binding.
	const parent: TSESTree.Node | undefined = node.parent;
	if (parent === undefined) {
		return false;
	}

	if (
		parent.type === AST_NODE_TYPES.ArrayPattern ||
		parent.type === AST_NODE_TYPES.ObjectPattern
	) {
		return isBindingName(parent);
	}

	if (parent.type === AST_NODE_TYPES.AssignmentPattern) {
		return parent.left === node && isBindingName(parent);
	}

	if (parent.type === AST_NODE_TYPES.Property) {
		return parent.value === node && isBindingName(parent);
	}

	if (parent.type === AST_NODE_TYPES.RestElement) {
		return parent.argument === node && isBindingName(parent);
	}

	if (parent.type === AST_NODE_TYPES.TSParameterProperty) {
		return parent.parameter === node && isBindingName(parent);
	}

	if (parent.type === AST_NODE_TYPES.CatchClause) {
		return parent.param === node;
	}

	if (parent.type === AST_NODE_TYPES.VariableDeclarator) {
		return parent.id === node;
	}

	return isFunctionParameter(parent, node);
}

/**
 * Reports whether a name is the `id` of a declaration.
 *
 * @param node - The name to classify.
 * @returns Whether the name is the one its declaration introduces.
 */
function isDeclarationId(node: NamedNode): boolean {
	const { parent } = node;

	return (
		(parent.type === AST_NODE_TYPES.ClassDeclaration ||
			parent.type === AST_NODE_TYPES.ClassExpression ||
			parent.type === AST_NODE_TYPES.FunctionDeclaration ||
			parent.type === AST_NODE_TYPES.FunctionExpression ||
			parent.type === AST_NODE_TYPES.TSDeclareFunction ||
			parent.type === AST_NODE_TYPES.TSEnumDeclaration ||
			parent.type === AST_NODE_TYPES.TSEnumMember ||
			parent.type === AST_NODE_TYPES.TSInterfaceDeclaration ||
			parent.type === AST_NODE_TYPES.TSModuleDeclaration ||
			parent.type === AST_NODE_TYPES.TSTypeAliasDeclaration) &&
		parent.id === node
	);
}

/**
 * Reports whether a name is a member declared by an object literal, a class, or
 * a type.
 *
 * @param node - The name to classify.
 * @returns Whether the name is a static key of a member this file declares.
 */
function isMemberKey(node: NamedNode): boolean {
	const { parent } = node;

	if (parent.type === AST_NODE_TYPES.Property) {
		// An object pattern key names a property of the value being
		// destructured; only its binding belongs to this file.
		return (
			parent.parent.type === AST_NODE_TYPES.ObjectExpression &&
			parent.key === node &&
			!parent.computed
		);
	}

	return (
		(parent.type === AST_NODE_TYPES.AccessorProperty ||
			parent.type === AST_NODE_TYPES.MethodDefinition ||
			parent.type === AST_NODE_TYPES.PropertyDefinition ||
			parent.type === AST_NODE_TYPES.TSAbstractAccessorProperty ||
			parent.type === AST_NODE_TYPES.TSAbstractMethodDefinition ||
			parent.type === AST_NODE_TYPES.TSAbstractPropertyDefinition ||
			parent.type === AST_NODE_TYPES.TSMethodSignature ||
			parent.type === AST_NODE_TYPES.TSPropertySignature) &&
		parent.key === node &&
		!parent.computed
	);
}

/**
 * Reports whether a name is one an import or export declaration introduces.
 *
 * A name reached without an `as` clause is the one the other module chose, so
 * it is left alone.
 *
 * @param node - The name to classify.
 * @returns Whether the name is a local or exported name this file picked.
 */
function isSpecifierName(node: NamedNode): boolean {
	const { parent } = node;

	if (
		parent.type === AST_NODE_TYPES.ImportDefaultSpecifier ||
		parent.type === AST_NODE_TYPES.ImportNamespaceSpecifier
	) {
		return parent.local === node;
	}

	if (parent.type === AST_NODE_TYPES.ImportSpecifier) {
		return parent.local === node && isAliased(parent.imported, parent.local);
	}

	if (parent.type === AST_NODE_TYPES.ExportSpecifier) {
		return parent.exported === node && isAliased(parent.local, parent.exported);
	}

	if (parent.type === AST_NODE_TYPES.ExportAllDeclaration) {
		return parent.exported === node;
	}

	return false;
}

/**
 * Reports whether a name is one this file declares.
 *
 * A name the code only reads — a member access, an import without an alias, a
 * JSX reference — is dictated by whoever declares it, so renaming it here is
 * never the fix.
 *
 * @param node - The name to classify.
 * @returns Whether the author of this file chose the name.
 */
function isDeclaredName(node: NamedNode): boolean {
	const { parent } = node;

	if (parent.type === AST_NODE_TYPES.TSTypeParameter) {
		return parent.name === node;
	}

	return (
		isDeclarationId(node) || isMemberKey(node) || isSpecifierName(node) || isBindingName(node)
	);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	function report(node: NamedNode): void {
		if (!containsForbiddenTerm(node.name) || !isDeclaredName(node)) {
			return;
		}

		context.report({ data: { name: node.name }, messageId: MESSAGE_ID, node });
	}

	return {
		Identifier: report,
		PrivateIdentifier: report,
	};
}

export const noShapeInSymbolNames = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow the term 'shape' in declared symbol names",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: undefined,
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
