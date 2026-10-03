import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-em-dash";

const MESSAGE_ID = "emDash";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Avoid em dashes in prose. Rephrase this sentence with shorter, more natural wording.",
};

const EM_DASH = "\u2014";

interface SentenceRange {
	end: number;
	start: number;
}

/**
 * Whether a code unit ends a line, matching ESLint's line-break set (`\n`,
 * `\r`, U+2028, U+2029).
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit is a line break.
 */
function isLineBreak(code: number): boolean {
	return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

/**
 * Whether a code unit is a sentence terminator: `.`, `!`, or `?`.
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit ends a sentence.
 */
function isTerminator(code: number): boolean {
	return code === 0x2e || code === 0x21 || code === 0x3f;
}

/**
 * Whether a code unit is whitespace, matching the `\s` class without running a
 * regex per character.
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit is whitespace.
 */
function isWhitespace(code: number): boolean {
	return (
		(code >= 0x09 && code <= 0x0d) ||
		code === 0x20 ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

/**
 * Finds the sentence around a dash: back to the previous line break or
 * terminator (exclusive), forward to the next line break (exclusive) or
 * terminator (inclusive), with surrounding whitespace trimmed.
 *
 * @param text - The full source text.
 * @param index - The index of the em dash.
 * @returns The trimmed sentence range.
 */
function getSentenceRange(text: string, index: number): SentenceRange {
	let start = index;
	while (start > 0) {
		const code = text.charCodeAt(start - 1);
		if (isLineBreak(code) || isTerminator(code)) {
			break;
		}

		start -= 1;
	}

	let end = index + 1;
	while (end < text.length) {
		const code = text.charCodeAt(end);
		if (isLineBreak(code)) {
			break;
		}

		end += 1;
		if (isTerminator(code)) {
			break;
		}
	}

	while (start < index && isWhitespace(text.charCodeAt(start))) {
		start += 1;
	}

	while (end > index + 1 && isWhitespace(text.charCodeAt(end - 1))) {
		end -= 1;
	}

	return { end, start };
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		Program(): void {
			const { sourceCode } = context;
			const { text } = sourceCode;

			let index = text.indexOf(EM_DASH);
			while (index !== -1) {
				const { end, start } = getSentenceRange(text, index);
				context.report({
					loc: {
						end: sourceCode.getLocFromIndex(end),
						start: sourceCode.getLocFromIndex(start),
					},
					messageId: MESSAGE_ID,
				});

				// Every dash before `end` shares this sentence: one report each.
				index = text.indexOf(EM_DASH, end);
			}
		},
	};
}

export const noEmDash = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow em dashes in source text",
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
