import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import { isGlobalReflectMethodCall } from "../shared/reflect-method";

export const RULE_NAME = "no-reflect-set";

const MESSAGE_ID = "reflectSet";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Replace `Reflect.set` with a plain assignment. Declare the field on the target type, or use a test helper such as shoehorn's `fromAny` when the value deliberately violates it.",
};

/**
 * Whether an argument spells its key out in the source, so a plain assignment
 * can spell the same key.
 *
 * A template literal only qualifies while it holds no expressions; with one it
 * is as dynamic as an identifier.
 *
 * @param argument - The key argument of the call, or undefined when absent.
 * @returns True when the key is a string, number, or expressionless template.
 */
function isLiteralKey(argument: TSESTree.CallExpressionArgument | undefined): boolean {
	if (argument === undefined) {
		return false;
	}

	if (argument.type === AST_NODE_TYPES.TemplateLiteral) {
		return argument.expressions.length === 0;
	}

	if (argument.type !== AST_NODE_TYPES.Literal) {
		return false;
	}

	return typeof argument.value === "number" || typeof argument.value === "string";
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		CallExpression(node: TSESTree.CallExpression): void {
			// The four-argument form takes a receiver, which a plain assignment
			// cannot rebind.
			if (node.arguments.length !== 3) {
				return;
			}

			const [, key] = node.arguments;
			if (!isLiteralKey(key)) {
				return;
			}

			if (!isGlobalReflectMethodCall(context.sourceCode, node.callee, "set")) {
				return;
			}

			context.report({ messageId: MESSAGE_ID, node });
		},
	};
}

export const noReflectSet = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Disallow `Reflect.set` with a literal key in favour of a plain assignment",
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
