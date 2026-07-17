import * as core from "@eslint-react/core";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type { Declaration, Type } from "typescript";

import { createEslintRule } from "../../util";
import type { MutableMembers } from "./readonly-type";
import { collectMutableProperties, isTypeFullyReadonly } from "./readonly-type";

export const RULE_NAME = "prefer-read-only-props";

type MessageIds = "preferReadOnlyProps";
type Options = [
	{
		/**
		 * How the autofix makes props read-only. `"wrap"` (the default) wraps the
		 * props type in `wrapperType`; `"modifier"` instead adds a `readonly`
		 * modifier to each mutable property, but only when every one is inline or
		 * declared in the same file (otherwise no fix is offered).
		 */
		fixStyle?: "modifier" | "wrap";
		/**
		 * Module to import the wrapper from when the autofix inserts it. Omit when
		 * the wrapper is globally available (the default `Readonly` needs no
		 * import).
		 */
		importSource?: string;
		/**
		 * Utility type the autofix wraps props in. Defaults to `Readonly`; set to a
		 * deep-readonly type such as `Immutable` to enforce nested immutability.
		 */
		wrapperType?: string;
	},
];

const DEFAULT_WRAPPER_TYPE = "Readonly";

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

/**
 * Builds a fix that makes `name` importable from `source`, or `undefined` when
 * it is already imported. Merges into an existing named import from the same
 * module when possible, otherwise prepends a fresh `import type` statement.
 *
 * @param fixer - The rule fixer.
 * @param sourceCode - The source code, for locating existing imports.
 * @param name - The type name to import.
 * @param source - The module specifier to import it from.
 * @returns An import fix, or `undefined` when no import is needed.
 */
function buildImportFix(
	fixer: TSESLint.RuleFixer,
	sourceCode: Readonly<TSESLint.SourceCode>,
	name: string,
	source: string,
): TSESLint.RuleFix | undefined {
	const { body } = sourceCode.ast;

	let matchingImport: TSESTree.ImportDeclaration | undefined;
	for (const statement of body) {
		if (
			statement.type !== AST_NODE_TYPES.ImportDeclaration ||
			statement.source.value !== source
		) {
			continue;
		}

		matchingImport = statement;
		for (const specifier of statement.specifiers) {
			if (
				specifier.type === AST_NODE_TYPES.ImportSpecifier &&
				specifier.imported.type === AST_NODE_TYPES.Identifier &&
				specifier.imported.name === name
			) {
				return undefined;
			}
		}
	}

	if (matchingImport !== undefined) {
		const named = matchingImport.specifiers.filter(
			(specifier) => specifier.type === AST_NODE_TYPES.ImportSpecifier,
		);
		const lastNamed = named.at(-1);
		if (lastNamed !== undefined) {
			const prefix = matchingImport.importKind === "type" ? "" : "type ";
			return fixer.insertTextAfter(lastNamed, `, ${prefix}${name}`);
		}
	}

	const insertText = `import type { ${name} } from "${source}";\n`;
	const firstStatement = body.find(
		(statement) => statement.type === AST_NODE_TYPES.ImportDeclaration,
	);
	if (firstStatement !== undefined) {
		return fixer.insertTextBefore(firstStatement, insertText);
	}

	if (body[0] !== undefined) {
		return fixer.insertTextBefore(body[0], insertText);
	}

	return fixer.insertTextBeforeRange([0, 0], insertText);
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
	const options = context.options.at(0) ?? {};
	const wrapperType = options.wrapperType ?? DEFAULT_WRAPPER_TYPE;
	const fixStyle = options.fixStyle ?? "wrap";
	const { importSource } = options;
	const collector = core.getFunctionComponentCollector(context);

	function getParameterType(parameter: TSESTree.Parameter): Type {
		return checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(parameter));
	}

	/**
	 * Maps a member's TypeScript declaration back to its editable AST node.
	 *
	 * @param declaration - The member's declaration, or `undefined` when the
	 *   symbol has none (a synthesized member).
	 * @param expected - The AST node type the declaration must map to.
	 * @returns The AST node, or `undefined` when the declaration is missing, lives
	 *   in another file (absent from this file's node map), or is not the expected
	 *   kind (such as a method signature, which cannot take a `readonly`).
	 */
	function resolveMemberNode(
		declaration: Declaration | undefined,
		expected: AST_NODE_TYPES.TSIndexSignature | AST_NODE_TYPES.TSPropertySignature,
	): TSESTree.Node | undefined {
		if (declaration === undefined) {
			return undefined;
		}

		const node = services.tsNodeToESTreeNodeMap.get(declaration) as TSESTree.Node | undefined;
		if (node?.type !== expected) {
			return undefined;
		}

		return node;
	}

	/**
	 * Resolves every mutable member to its editable AST node, so a `readonly`
	 * modifier can be inserted before each.
	 *
	 * @param members - The mutable properties and index signatures of the props.
	 * @returns The member nodes, or `undefined` when any member cannot be edited
	 *   here (cross-file, synthesized, or a method signature) — in which case the
	 *   `"modifier"` fix is withheld.
	 */
	function resolveModifierTargets(members: MutableMembers): Array<TSESTree.Node> | undefined {
		const nodes = new Set<TSESTree.Node>();
		for (const property of members.properties) {
			const node = resolveMemberNode(
				property.valueDeclaration,
				AST_NODE_TYPES.TSPropertySignature,
			);
			if (node === undefined) {
				return undefined;
			}

			nodes.add(node);
		}

		for (const indexInfo of members.indexInfos) {
			const node = resolveMemberNode(indexInfo.declaration, AST_NODE_TYPES.TSIndexSignature);
			if (node === undefined) {
				return undefined;
			}

			nodes.add(node);
		}

		return nodes.size === 0 ? undefined : [...nodes];
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
		if (isTypeFullyReadonly(checker, propsType, wrapperType)) {
			return;
		}

		if (fixStyle === "modifier") {
			const members = collectMutableProperties(checker, propsType);
			const targets = members === null ? undefined : resolveModifierTargets(members);
			context.report({
				fix:
					targets === undefined
						? undefined
						: (fixer): Array<TSESLint.RuleFix> => {
								return targets.map((node) =>
									fixer.insertTextBefore(node, "readonly "),
								);
							},
				messageId: "preferReadOnlyProps",
				node: functionNode,
			});
			return;
		}

		const typeNode = findPropsTypeNode(functionNode);
		context.report({
			fix:
				typeNode === undefined
					? undefined
					: (fixer): Array<TSESLint.RuleFix> => {
							const fixes = [
								fixer.replaceText(
									typeNode,
									`${wrapperType}<${sourceCode.getText(typeNode)}>`,
								),
							];

							if (importSource !== undefined) {
								const importFix = buildImportFix(
									fixer,
									sourceCode,
									wrapperType,
									importSource,
								);
								if (importFix !== undefined) {
									fixes.push(importFix);
								}
							}

							return fixes;
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
	defaultOptions: [{}],
	meta: {
		defaultOptions: [{}],
		docs: {
			description: "Enforce that function component props are read-only",
			recommended: false,
			requiresTypeChecking: true,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [
			{
				additionalProperties: false,
				properties: {
					fixStyle: {
						description:
							'How the autofix makes props read-only: "wrap" wraps the type in the wrapper (Readonly<> by default); "modifier" adds a readonly modifier to each property, but only when every property is inline or declared in the same file, otherwise no fix is offered. "modifier" ignores wrapperType/importSource.',
						enum: ["wrap", "modifier"],
						type: "string",
					},
					importSource: {
						description:
							"Module to import `wrapperType` from when the autofix inserts it. Omit when the wrapper is globally available (the default `Readonly` needs no import).",
						type: "string",
					},
					wrapperType: {
						description:
							"Utility type the autofix wraps props in. Defaults to `Readonly`; set to a deep-readonly type such as `Immutable` to enforce nested immutability.",
						type: "string",
					},
				},
				type: "object",
			},
		],
		type: "suggestion",
	},
});
