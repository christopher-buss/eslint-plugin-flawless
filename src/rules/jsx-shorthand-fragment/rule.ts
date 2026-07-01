import type { JSONSchema, TSESLint, TSESTree } from "@typescript-eslint/utils";

import { createEslintRule } from "../../util";

export const RULE_NAME = "jsx-shorthand-fragment";

const MESSAGE_ID = "useNamedFragment";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [fragmentName?: string];

const DEFAULT_FRAGMENT_NAME = "Fragment";

const messages = {
	[MESSAGE_ID]: "Use the '{{name}}' component instead of fragment shorthand syntax.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		description: "The identifier to use for the named fragment element.",
		type: "string",
	},
];

function create(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const name = context.options[0] ?? DEFAULT_FRAGMENT_NAME;

	return {
		JSXFragment(node: TSESTree.JSXFragment): void {
			const { closingFragment, openingFragment } = node;

			context.report({
				data: { name },
				fix: (fixer) => {
					return [
						fixer.replaceText(openingFragment, `<${name}>`),
						fixer.replaceText(closingFragment, `</${name}>`),
					];
				},
				messageId: MESSAGE_ID,
				node,
			});
		},
	};
}

export const jsxShorthandFragment = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [DEFAULT_FRAGMENT_NAME],
	meta: {
		defaultOptions: [DEFAULT_FRAGMENT_NAME],
		docs: {
			description: "Disallow the shorthand fragment syntax in favour of a named fragment",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema,
		type: "suggestion",
	},
});
