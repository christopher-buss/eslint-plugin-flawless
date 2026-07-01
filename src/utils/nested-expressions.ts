import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

/**
 * Determines whether the given AST subtree contains a call or `new`
 * expression.
 *
 * Replaces `@eslint-react/ast`'s `getNestedCallExpressions` /
 * `getNestedNewExpressions` (not exposed by `@eslint-react/kit`). The `useMemo`
 * rule uses this to avoid flagging a factory that performs real computation.
 * The walk descends into every child node (skipping the `parent` back-link to
 * avoid cycles), so calls nested in awaits, tagged templates, computed member
 * expressions, call targets and the like are all detected.
 *
 * @param root - The subtree root to inspect (typically a function body).
 * @returns `true` if a `CallExpression` or `NewExpression` is present.
 */
export function hasNestedCallOrNew(root: TSESTree.Node): boolean {
	const stack: Array<TSESTree.Node> = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) {
			break;
		}

		if (
			current.type === AST_NODE_TYPES.CallExpression ||
			current.type === AST_NODE_TYPES.NewExpression
		) {
			return true;
		}

		pushChildNodes(current, stack);
	}

	return false;
}

/**
 * Type guard for an AST node value encountered while walking arbitrary
 * properties of a parent node.
 *
 * @param value - The candidate value.
 * @returns `true` if the value looks like a `TSESTree.Node`.
 */
function isNode(value: unknown): value is TSESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string"
	);
}

/**
 * Pushes every child node of `node` onto the traversal stack, skipping the
 * `parent` back-link.
 *
 * @param node - The node whose children to enqueue.
 * @param stack - The traversal stack to push onto.
 */
function pushChildNodes(node: TSESTree.Node, stack: Array<TSESTree.Node>): void {
	for (const key of Object.keys(node)) {
		if (key === "parent") {
			continue;
		}

		const value = (node as unknown as Record<string, unknown>)[key];
		if (Array.isArray(value)) {
			for (const item of value) {
				if (isNode(item)) {
					stack.push(item);
				}
			}
		} else if (isNode(value)) {
			stack.push(value);
		}
	}
}
