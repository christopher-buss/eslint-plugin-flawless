import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "padding-after-expect-assertions";

const MESSAGE_ID = "missingPadding";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]: "Expected a blank line after '{{name}}'.",
};

/**
 * Matches a statement that declares the expected assertion count at the top of
 * a test: `expect.assertions(n)` or `expect.hasAssertions()`.
 *
 * Detection is purely syntactic (a non-computed `expect.assertions` /
 * `expect.hasAssertions` call) with no scope analysis, mirroring the deliberate
 * looseness of `@vitest/eslint-plugin`'s own padding rules. A shadowed local
 * `expect` is vanishingly rare, and the only consequence is a harmless blank
 * line.
 *
 * @param node - The expression statement to inspect.
 * @returns The matched member name (`expect.assertions` / `expect.hasAssertions`)
 *   for the message, or `undefined` when the statement is not an assertion count.
 */
function getAssertionName({ expression }: TSESTree.ExpressionStatement): string | undefined {
	if (expression.type !== AST_NODE_TYPES.CallExpression) {
		return undefined;
	}

	const { callee } = expression;
	if (
		callee.type !== AST_NODE_TYPES.MemberExpression ||
		callee.computed ||
		callee.object.type !== AST_NODE_TYPES.Identifier ||
		callee.object.name !== "expect" ||
		callee.property.type !== AST_NODE_TYPES.Identifier
	) {
		return undefined;
	}

	const { name } = callee.property;
	if (name !== "assertions" && name !== "hasAssertions") {
		return undefined;
	}

	return `expect.${name}`;
}

/**
 * Returns the statement list that directly contains a node, so its following
 * sibling can be found. The assertion count opens an `it`/`test` callback body
 * (a `BlockStatement`) or, at worst, sits at the top level (`Program`).
 *
 * @param node - The node whose containing list is wanted.
 * @returns The sibling statements, or `undefined` when the parent holds no list.
 */
function getContainingList({
	parent,
}: TSESTree.ExpressionStatement): ReadonlyArray<TSESTree.Node> | undefined {
	if (parent.type === AST_NODE_TYPES.BlockStatement || parent.type === AST_NODE_TYPES.Program) {
		return parent.body;
	}

	return undefined;
}

/**
 * Locates the two tokens the padding is measured and inserted between: the last
 * token of the assertion statement (advanced past any trailing comment on the
 * same line) and the first token of the following statement (a leading comment
 * included). This mirrors ESLint core's `padding-line-between-statements`, so a
 * trailing `// note` does not defeat the rule and the fix lands in the right
 * place. Note that `yaml-block-key-blank-lines` deliberately takes the opposite
 * stance and bails on comments, since rewriting there would re-attach them.
 *
 * @param sourceCode - The source code, for token lookups.
 * @param node - The assertion statement.
 * @param nextNode - The statement that follows it.
 * @returns The anchor tokens, or `undefined` when either cannot be resolved.
 */
function findPaddingAnchor(
	sourceCode: Readonly<TSESLint.SourceCode>,
	node: TSESTree.ExpressionStatement,
	nextNode: TSESTree.Node,
): undefined | { nextToken: TSESTree.Token; previousToken: TSESTree.Token } {
	const lastToken = sourceCode.getLastToken(node);
	if (lastToken === null) {
		return undefined;
	}

	let previousToken: TSESTree.Token = lastToken;
	const nextToken =
		sourceCode.getFirstTokenBetween(previousToken, nextNode, {
			filter(token) {
				// A comment on the assertion's own line belongs to it, so treat
				// it as part of `previousToken` rather than the next statement.
				if (ASTUtils.isTokenOnSameLine(previousToken, token)) {
					previousToken = token;
					return false;
				}

				return true;
			},
			includeComments: true,
		}) ?? sourceCode.getFirstToken(nextNode);
	if (nextToken === null) {
		return undefined;
	}

	return { nextToken, previousToken };
}

/**
 * Requires a blank line after the assertion count that opens a test, keeping the
 * bookkeeping visually separate from the expectations that follow.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		ExpressionStatement(node: TSESTree.ExpressionStatement): void {
			const name = getAssertionName(node);
			if (name === undefined) {
				return;
			}

			const list = getContainingList(node);
			if (list === undefined) {
				return;
			}

			const nextNode = list[list.indexOf(node) + 1];
			if (nextNode === undefined) {
				return;
			}

			const { sourceCode } = context;
			const anchor = findPaddingAnchor(sourceCode, node, nextNode);
			if (anchor === undefined) {
				return;
			}

			const { nextToken, previousToken } = anchor;
			const gap = nextToken.loc.start.line - previousToken.loc.end.line;
			// At least one blank line already present: nothing to do (extra blank
			// lines are intentionally left untouched).
			if (gap > 1) {
				return;
			}

			context.report({
				data: { name },
				fix(fixer) {
					// On the same line (gap 0) a bare newline only ends the line;
					// two are needed to leave a blank one between the statements.
					return fixer.insertTextAfter(previousToken, gap === 0 ? "\n\n" : "\n");
				},
				loc: node.loc,
				messageId: MESSAGE_ID,
			});
		},
	};
}

export const paddingAfterExpectAssertions = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Enforce a blank line after `expect.assertions` and `expect.hasAssertions`",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "whitespace",
		hasSuggestions: false,
		messages,
		schema: [],
		type: "layout",
	},
});
