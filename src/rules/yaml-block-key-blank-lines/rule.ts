import type { TSESLint } from "@typescript-eslint/utils";

import type { YAMLSourceCode } from "eslint-plugin-yml";
import type { AST } from "yaml-eslint-parser";

import { createEslintRule } from "../../util";
import type { YamlContext } from "../../utils/types";

export const RULE_NAME = "yaml-block-key-blank-lines";

export type MessageIds = "blankLine";

export type Options = [];

type Context = YamlContext<MessageIds, Options>;

const messages = {
	blankLine: "Expected {{count}} blank line(s) around this top-level key.",
};

/**
 * Determines whether a pair value is a block collection (block mapping or block
 * sequence). Flow collections (`{ ... }` / `[ ... ]`) count as scalars.
 *
 * @param value - The value node of a YAML pair.
 * @returns True if the value is a block mapping or block sequence.
 */
function isBlock(value: AST.YAMLContent | AST.YAMLWithMeta | null): boolean {
	return (
		value !== null &&
		(value.type === "YAMLMapping" || value.type === "YAMLSequence") &&
		value.style === "block"
	);
}

function create(context: Context): TSESLint.RuleListener {
	// Both YAML entry points (the `yaml/yaml` language and `yaml-eslint-parser`)
	// expose the same token/AST API; typing the source code as `YAMLSourceCode`
	// lets us pass YAML nodes to the token store without per-call casts.
	const { sourceCode } = context;
	if (sourceCode.parserServices.isYAML !== true) {
		return {};
	}

	return {
		YAMLMapping(yamlNode: AST.YAMLMapping): void {
			// Only the root mapping of each document; nested keys are excluded.
			if (yamlNode.parent.type !== "YAMLDocument") {
				return;
			}

			const { pairs } = yamlNode;
			for (let index = 1; index < pairs.length; index += 1) {
				const previous = pairs[index - 1];
				const current = pairs[index];
				if (previous === undefined || current === undefined) {
					continue;
				}

				const left = sourceCode.getLastToken(previous);
				const right = sourceCode.getFirstToken(current);

				// A comment in the gap makes direct rewriting unsafe (would
				// re-attach the comment), so leave these gaps untouched.
				if (sourceCode.commentsExistBetween(left, right)) {
					continue;
				}

				const blanks = right.loc.start.line - left.loc.end.line - 1;
				const want = isBlock(previous.value) || isBlock(current.value) ? 1 : 0;
				if (blanks === want) {
					continue;
				}

				context.report({
					data: { count: want },
					fix(fixer) {
						return fixer.replaceTextRange(
							[left.range[1], right.range[0]],
							"\n".repeat(want + 1),
						);
					},
					loc: (current.key ?? current).loc,
					messageId: "blankLine",
				});
			}
		},
	};
}

export const yamlBlockKeyBlankLines = createEslintRule<Options, MessageIds, YAMLSourceCode>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Enforce blank lines around top-level YAML block collection keys",
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
