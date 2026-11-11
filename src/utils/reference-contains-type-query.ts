import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

/**
 * Recursively checks whether a given reference has a type query declaration among its parents.
 * @param node - The AST node to check.
 * @returns True if a TSTypeQuery is found in the parent chain, false otherwise.
 */
export function referenceContainsTypeQuery(node: TSESTree.Node): boolean {
	let current = node;
	while (
		current.type === AST_NODE_TYPES.Identifier ||
		current.type === AST_NODE_TYPES.TSQualifiedName
	) {
		current = current.parent;
	}

	// Any other node means there is no chance that we are in a TSTypeQuery.
	return current.type === AST_NODE_TYPES.TSTypeQuery;
}
