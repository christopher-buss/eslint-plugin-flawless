import { AST_NODE_TYPES, type JSONSchema, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "jsx-shorthand-fragment";

const MESSAGE_ID_NAMED = "useNamedFragment";
const MESSAGE_ID_SHORTHAND = "useShorthandFragment";

export type MessageIds = typeof MESSAGE_ID_NAMED | typeof MESSAGE_ID_SHORTHAND;

export interface JsxShorthandFragmentOptions {
	/**
	 * The identifier used for the named fragment element in `"element"` mode
	 * (e.g. `"Fragment"` or `"React.Fragment"`). Defaults to `"Fragment"`.
	 */
	readonly fragmentName?: string;
	/**
	 * Which form to enforce: `"syntax"` (shorthand `<>...</>`, the default) or
	 * `"element"` (a named fragment such as `<Fragment>...</Fragment>`).
	 */
	readonly mode?: Mode;
}

export type Options = [JsxShorthandFragmentOptions?];

type Mode = "element" | "syntax";

const DEFAULT_MODE: Mode = "syntax";
const DEFAULT_FRAGMENT_NAME = "Fragment";

const messages = {
	[MESSAGE_ID_NAMED]: "Use the '{{name}}' component instead of fragment shorthand syntax.",
	[MESSAGE_ID_SHORTHAND]:
		"Use the fragment shorthand syntax '<>...</>' instead of the '{{name}}' component.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			fragmentName: {
				description:
					'The identifier to use for the named fragment element in "element" mode.',
				type: "string",
			},
			mode: {
				description:
					'Which form to enforce: "syntax" (shorthand `<>...</>`, default) or "element" (a named fragment).',
				enum: ["element", "syntax"],
				type: "string",
			},
		},
		type: "object",
	},
];

/**
 * Flattens a JSX element name into a dotted string, e.g. `Fragment` or
 * `React.Fragment`. Returns `null` for namespaced names (`<a:b>`) which cannot
 * be a fragment.
 *
 * @param node - The JSX element name node.
 * @returns The dotted name, or `null` when it is not a plain identifier chain.
 */
function jsxNameToString(node: TSESTree.JSXTagNameExpression): null | string {
	if (node.type === AST_NODE_TYPES.JSXIdentifier) {
		return node.name;
	}

	if (node.type === AST_NODE_TYPES.JSXMemberExpression) {
		const object = jsxNameToString(node.object);
		if (object === null) {
			return null;
		}

		return `${object}.${node.property.name}`;
	}

	return null;
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let mode: Mode;
	// `"syntax"` mode rewrites the canonical fragment components (plus any
	// configured `fragmentName`) back to the shorthand `<>...</>`.
	let fragmentName: string;
	let namedFragments: Set<string>;

	return {
		before(): void {
			const options = context.options[0] ?? {};
			mode = options.mode ?? DEFAULT_MODE;
			fragmentName = options.fragmentName ?? DEFAULT_FRAGMENT_NAME;
			namedFragments = new Set(["Fragment", fragmentName, "React.Fragment"]);
		},
		JSXElement(node: TSESTree.JSXElement): void {
			if (mode !== "syntax") {
				return;
			}

			const { openingElement } = node;

			const name = jsxNameToString(openingElement.name);
			if (name === null || !namedFragments.has(name)) {
				return;
			}

			// A fragment carrying a `key` or other attribute cannot be expressed
			// with the shorthand, so it is left as the named form.
			if (openingElement.attributes.length > 0) {
				return;
			}

			context.report({
				data: { name },
				fix: (fixer) => {
					const { closingElement } = node;
					if (closingElement === null) {
						// `<Fragment />` — a childless self-closing fragment.
						return fixer.replaceText(node, "<></>");
					}

					return [
						fixer.replaceText(openingElement, "<>"),
						fixer.replaceText(closingElement, "</>"),
					];
				},
				messageId: MESSAGE_ID_SHORTHAND,
				node,
			});
		},
		JSXFragment(node: TSESTree.JSXFragment): void {
			if (mode !== "element") {
				return;
			}

			const { closingFragment, openingFragment } = node;

			context.report({
				data: { name: fragmentName },
				fix: (fixer) => {
					return [
						fixer.replaceText(openingFragment, `<${fragmentName}>`),
						fixer.replaceText(closingFragment, `</${fragmentName}>`),
					];
				},
				messageId: MESSAGE_ID_NAMED,
				node,
			});
		},
	};
}

export const jsxShorthandFragment = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [{ fragmentName: DEFAULT_FRAGMENT_NAME, mode: DEFAULT_MODE }],
	meta: {
		defaultOptions: [{ fragmentName: DEFAULT_FRAGMENT_NAME, mode: DEFAULT_MODE }],
		docs: {
			description:
				"Enforce a consistent fragment form: the shorthand `<>...</>` or a named fragment",
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
