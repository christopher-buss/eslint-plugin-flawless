import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

/**
 * Recursively checks whether a given reference has a type query declaration among its parents.
 * @param node - The AST node to check.
 * @returns True if a TSTypeQuery is found in the parent chain, false otherwise.
 */
export function referenceContainsTypeQuery(node: TSESTree.Node): boolean {
	// eslint-disable-next-line ts/switch-exhaustiveness-check -- We have a default case
	switch (node.type) {
		case AST_NODE_TYPES.Identifier:
		case AST_NODE_TYPES.TSQualifiedName: {
			return referenceContainsTypeQuery(node.parent);
		}
		case AST_NODE_TYPES.TSTypeQuery: {
			return true;
		}
		default: {
			// if we find a different node, there's no chance that we're in a
			// TSTypeQuery
			return false;
		}
	}
}
