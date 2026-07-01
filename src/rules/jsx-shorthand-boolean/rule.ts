import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import { createEslintRule } from "../../util";

export const RULE_NAME = "jsx-shorthand-boolean";

const MESSAGE_ID = "setAttributeValue";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]: "Set an explicit value for boolean attribute '{{name}}'.",
};

function create(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const { sourceCode } = context;

	return {
		JSXAttribute(node: TSESTree.JSXAttribute): void {
			// A shorthand boolean attribute has no value, e.g. `<C disabled />`.
			if (node.value !== null) {
				return;
			}

			context.report({
				data: { name: sourceCode.getText(node.name) },
				fix: (fixer) => fixer.insertTextAfter(node.name, "={true}"),
				messageId: MESSAGE_ID,
				node,
			});
		},
	};
}

export const jsxShorthandBoolean = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow shorthand boolean JSX attributes",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
