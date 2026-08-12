import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-conditional-empty-object-spread";

const MESSAGE_ID = "avoid";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Do not use conditional empty-object spreads. Prefer a direct property or build the object in separate statements.",
};

function isEmptyObjectExpression(node: TSESTree.Expression): boolean {
	return node.type === AST_NODE_TYPES.ObjectExpression && node.properties.length === 0;
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		SpreadElement(node: TSESTree.SpreadElement): void {
			if (node.parent.type !== AST_NODE_TYPES.ObjectExpression) {
				return;
			}

			if (node.argument.type !== AST_NODE_TYPES.ConditionalExpression) {
				return;
			}

			if (
				!isEmptyObjectExpression(node.argument.consequent) &&
				!isEmptyObjectExpression(node.argument.alternate)
			) {
				return;
			}

			context.report({ messageId: MESSAGE_ID, node });
		},
	};
}

export const noConditionalEmptyObjectSpread = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow conditional empty-object spreads",
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
