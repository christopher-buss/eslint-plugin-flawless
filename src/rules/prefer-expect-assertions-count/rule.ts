import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import { getTestGlobalSources, resolveTestGlobalName } from "../../utils/test-globals";

export const RULE_NAME = "prefer-expect-assertions-count";

const MESSAGE_ID = "preferCount";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Use `expect.assertions(<count>)` with an explicit count instead of `expect.hasAssertions()`.",
};

/**
 * Matches a `expect.hasAssertions()` call. The callee must be a non-computed
 * `<expect>.hasAssertions` member access whose object resolves to a vitest/jest
 * `expect` (a global or an import from a test global source); a locally shadowed
 * `expect` is ignored. Covers either framework, since both name the global
 * `expect`.
 *
 * @param sourceCode - Provides the scope used to resolve `expect`.
 * @param callee - The call's callee.
 * @param sources - The modules whose named exports count as test globals.
 * @returns `true` when the callee is a resolved `expect.hasAssertions`.
 */
function isExpectHasAssertions(
	sourceCode: Readonly<TSESLint.SourceCode>,
	callee: TSESTree.Node,
	sources: ReadonlySet<string>,
): boolean {
	return (
		callee.type === AST_NODE_TYPES.MemberExpression &&
		!callee.computed &&
		callee.object.type === AST_NODE_TYPES.Identifier &&
		callee.property.type === AST_NODE_TYPES.Identifier &&
		callee.property.name === "hasAssertions" &&
		resolveTestGlobalName(sourceCode, callee.object, sources) === "expect"
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
	let sources: ReadonlySet<string>;

	return {
		before(): void {
			sources = getTestGlobalSources(context.settings);
		},
		CallExpression(node: TSESTree.CallExpression): void {
			if (!isExpectHasAssertions(context.sourceCode, node.callee, sources)) {
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
