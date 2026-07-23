import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "prefer-expect-assertions-count";

const MESSAGE_ID = "preferCount";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Use `expect.assertions(<count>)` with an explicit count instead of `expect.hasAssertions()`.",
};

/**
 * Matches a `expect.hasAssertions()` call. Detection is purely syntactic (a
 * non-computed `expect.hasAssertions` member call) with no scope analysis,
 * mirroring the sibling `padding-after-expect-assertions` rule. Both vitest and
 * jest name the global `expect`, so this covers either framework regardless of
 * import style; a shadowed local `expect` is vanishingly rare and its only cost
 * is a spurious report the author can disable inline.
 *
 * @param callee - The call's callee.
 * @returns `true` when the callee is `expect.hasAssertions`.
 */
function isExpectHasAssertions(callee: TSESTree.Node): boolean {
	return (
		callee.type === AST_NODE_TYPES.MemberExpression &&
		!callee.computed &&
		callee.object.type === AST_NODE_TYPES.Identifier &&
		callee.object.name === "expect" &&
		callee.property.type === AST_NODE_TYPES.Identifier &&
		callee.property.name === "hasAssertions"
	);
}

/**
 * Flags `expect.hasAssertions()`, which only asserts that at least one assertion
 * ran, in favour of `expect.assertions(<count>)`, which pins the exact count and
 * so catches an expectation skipped by an early return or a branch never taken.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		CallExpression(node: TSESTree.CallExpression): void {
			if (!isExpectHasAssertions(node.callee)) {
				return;
			}

			context.report({
				messageId: MESSAGE_ID,
				node,
			});
		},
	};
}

export const preferExpectAssertionsCount = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Prefer `expect.assertions(<count>)` over `expect.hasAssertions()`",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
