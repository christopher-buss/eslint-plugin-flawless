import { DefinitionType } from "@typescript-eslint/scope-manager";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

/**
 * Resolves an identifier to the AST node that represents its value.
 *
 * This is a focused re-implementation of `@eslint-react/var`'s `resolve`
 * covering only the cases the unnecessary-hook rules need: variable
 * initializers and function/class declarations. Every other definition kind
 * (imports, parameters, catch bindings, ...) resolves to `null`.
 *
 * @param sourceCode - Provides the scope used to look up the binding.
 * @param node - The identifier to resolve.
 * @returns The resolved value node, or `null` when it cannot be determined.
 */
export function resolve(
	sourceCode: Readonly<TSESLint.SourceCode>,
	node: TSESTree.Identifier,
): null | TSESTree.Node {
	const scope = sourceCode.getScope(node);
	const variable = findVariable(scope, node);
	if (variable === null) {
		return null;
	}

	const definition = variable.defs.at(0);
	if (definition === undefined) {
		return null;
	}

	if (
		definition.type === DefinitionType.ClassName ||
		definition.type === DefinitionType.FunctionName
	) {
		return definition.node;
	}

	if (definition.type === DefinitionType.Variable) {
		return definition.node.init;
	}

	return null;
}
