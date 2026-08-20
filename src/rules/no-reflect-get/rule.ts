import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import { isGlobalReflectMethodCall } from "../shared/reflect-method";

export const RULE_NAME = "no-reflect-get";

const MESSAGE_ID = "reflectGet";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Replace `Reflect.get` with typed property access. When the value is still `unknown`, narrow it to a keyed record first; otherwise parse it into a named domain type before reading it.",
};

/**
 * Whether a call passes exactly two arguments, neither of them spread.
 *
 * Only that arity has a property-access equivalent. The three-argument form
 * takes a receiver that rebinds `this` for a getter, and a spread hides how
 * many arguments actually arrive.
 *
 * @param callArguments - The arguments of the call under inspection.
 * @returns True when the call is the plain target-and-key form.
 */
function isTargetAndKeyCall(callArguments: Array<TSESTree.CallExpressionArgument>): boolean {
	if (callArguments.length !== 2) {
		return false;
	}

	const [target, key] = callArguments;
	return (
		target?.type !== AST_NODE_TYPES.SpreadElement && key?.type !== AST_NODE_TYPES.SpreadElement
	);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		CallExpression(node: TSESTree.CallExpression): void {
			if (!isGlobalReflectMethodCall(context.sourceCode, node.callee, "get")) {
				return;
			}

			if (!isTargetAndKeyCall(node.arguments)) {
				return;
			}

			context.report({ messageId: MESSAGE_ID, node });
		},
	};
}

export const noReflectGet = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Disallow the two-argument `Reflect.get` in favour of typed property access",
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
