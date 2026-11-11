import { AST_TOKEN_TYPES } from "@typescript-eslint/utils";
import type { JSONSchema, TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util.ts";
import { createFlawlessRule } from "../../util.ts";
import { isLineBreak, isWhitespace } from "../../utils/char-codes.ts";

export const RULE_NAME = "max-comment-length";

const MESSAGE_ID = "tooLong";

export type MessageIds = typeof MESSAGE_ID;

export interface MaxCommentLengthOptions {
	/** Whether a lone `/** ... *\/` block is exempt. */
	readonly ignoreJSDoc?: boolean;
	/** The maximum number of words one comment group may hold. */
	readonly maximumWords?: number;
}

export type Options = [MaxCommentLengthOptions?];

type Config = Required<MaxCommentLengthOptions>;

const DEFAULTS: Config = {
	ignoreJSDoc: true,
	maximumWords: 50,
};

const messages = {
	[MESSAGE_ID]:
		"This comment has {{count}} words; the configured maximum is {{maximum}}. Keep only context the code cannot express.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			ignoreJSDoc: {
				description: "Whether a lone `/** ... */` block is exempt.",
				type: "boolean",
			},
			maximumWords: {
				description: "The maximum number of words one comment group may hold.",
				minimum: 1,
				type: "integer",
			},
		},
		type: "object",
	},
];

const CHAR_LF = 0x0a;
const CHAR_CR = 0x0d;
const CHAR_HASH = 0x23;
const CHAR_STAR = 0x2a;
const CHAR_SLASH = 0x2f;

/**
 * A tool directive, matched (sticky) at the start of a comment body, after the
 * `//` or `/*` marker. Directives are not prose: they are never counted and
 * they split groups.
 */
const DIRECTIVE =
	/\s*(?:(?:eslint|oxlint)(?:-disable|-enable|-env)?\b|globals?\s|exported\s|@ts-|prettier-ignore|(?:istanbul|c8|v8)\s+ignore|cspell:|#(?:end)?region\b|@(?:vitest|jest)-environment|@flow\b|@jsx|\/\s*<(?:reference|amd-))/uy;

/**
 * Whether `text[start, end)` is whitespace that holds exactly one line break
 * (`\r\n` counts as one), so the next comment sits on the next line.
 *
 * @param text - The source text.
 * @param start - The offset after the previous comment.
 * @param end - The offset of the next comment.
 * @returns True when the gap is a single line break plus indentation.
 */
function isNextLineGap(text: string, start: number, end: number): boolean {
	let breaks = 0;
	for (let index = start; index < end; index += 1) {
		const code = text.charCodeAt(index);
		if (isLineBreak(code)) {
			if (code === CHAR_CR && text.charCodeAt(index + 1) === CHAR_LF) {
				index += 1;
			}

			breaks += 1;
			if (breaks > 1) {
				return false;
			}
		} else if (!isWhitespace(code)) {
			return false;
		}
	}

	return breaks === 1;
}

/**
 * Whether `text[start, end)` is all whitespace.
 *
 * @param text - The source text.
 * @param start - The first offset.
 * @param end - The offset after the last.
 * @returns True when no code sits in the range.
 */
function isBlank(text: string, start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (!isWhitespace(text.charCodeAt(index))) {
			return false;
		}
	}

	return true;
}

/**
 * Whether code sits before `start` on the same line.
 *
 * @param text - The source text.
 * @param start - The offset of a comment.
 * @returns True when the comment trails code.
 */
function isTrailing(text: string, start: number): boolean {
	for (let index = start - 1; index >= 0; index -= 1) {
		const code = text.charCodeAt(index);
		if (isLineBreak(code)) {
			return false;
		}

		if (!isWhitespace(code)) {
			return true;
		}
	}

	return false;
}

/**
 * Whether a comment is a tool directive rather than prose.
 *
 * @param text - The source text.
 * @param comment - The comment to test.
 * @returns True for directives such as `eslint-disable` or `@ts-expect-error`.
 */
function isDirective(text: string, comment: TSESTree.Comment): boolean {
	DIRECTIVE.lastIndex = comment.range[0] + 2;
	return DIRECTIVE.test(text);
}

/**
 * Counts whitespace-separated words in a comment body. Extra `/` after `//`,
 * `*` runs next to the block markers, and one `*` gutter at the start of each
 * later block line are not words.
 *
 * @param text - The source text.
 * @param comment - The comment to count.
 * @returns The number of words.
 */
function countWords(text: string, comment: TSESTree.Comment): number {
	const isBlock = comment.type === AST_TOKEN_TYPES.Block;
	let start = comment.range[0] + 2;
	let end = comment.range[1];
	if (isBlock) {
		end -= 2;
		while (end > start && text.charCodeAt(end - 1) === CHAR_STAR) {
			end -= 1;
		}

		while (start < end && text.charCodeAt(start) === CHAR_STAR) {
			start += 1;
		}
	} else {
		while (start < end && text.charCodeAt(start) === CHAR_SLASH) {
			start += 1;
		}
	}

	let count = 0;
	let inWord = false;
	let atLineStart = false;
	for (let index = start; index < end; index += 1) {
		const code = text.charCodeAt(index);
		if (isWhitespace(code)) {
			inWord = false;
			if (isBlock && isLineBreak(code)) {
				atLineStart = true;
			}

			continue;
		}

		if (atLineStart) {
			atLineStart = false;
			if (code === CHAR_STAR) {
				continue;
			}
		}

		if (!inWord) {
			inWord = true;
			count += 1;
		}
	}

	return count;
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let config: Config;
	let text: string;

	/**
	 * Checks one comment group and reports it when it holds too many words.
	 *
	 * @param comments - Every comment in the file.
	 * @param first - Index of the first comment in the group.
	 * @param last - Index of the last comment in the group.
	 */
	function checkGroup(
		comments: ReadonlyArray<TSESTree.Comment>,
		first: number,
		last: number,
	): void {
		const firstComment = comments[first];
		const lastComment = comments[last];
		if (firstComment === undefined || lastComment === undefined) {
			return;
		}

		const start = firstComment.range[0];
		const end = lastComment.range[1];
		const { ignoreJSDoc, maximumWords } = config;
		// A word takes at least two characters with its separator, so a short
		// span cannot exceed the limit. Most comments exit here.
		if (end - start <= 2 * maximumWords) {
			return;
		}

		// A block comment is always a group of its own. `/***` opens a banner,
		// not JSDoc.
		if (
			ignoreJSDoc &&
			firstComment.type === AST_TOKEN_TYPES.Block &&
			text.charCodeAt(start + 2) === CHAR_STAR &&
			text.charCodeAt(start + 3) !== CHAR_STAR
		) {
			return;
		}

		let count = 0;
		for (let index = first; index <= last; index += 1) {
			const comment = comments[index];
			if (comment !== undefined) {
				count += countWords(text, comment);
			}
		}

		if (count <= maximumWords) {
			return;
		}

		const { sourceCode } = context;
		context.report({
			data: { count, maximum: maximumWords },
			loc: { end: sourceCode.getLocFromIndex(end), start: sourceCode.getLocFromIndex(start) },
			messageId: MESSAGE_ID,
		});
	}

	return {
		after(): void {
			text = "";
		},
		before(): void {
			// Merged field by field: an explicit `undefined` would survive a
			// spread and defeat the default.
			const options = context.options[0];
			config = {
				ignoreJSDoc: options?.ignoreJSDoc ?? DEFAULTS.ignoreJSDoc,
				maximumWords: options?.maximumWords ?? DEFAULTS.maximumWords,
			};
			({ text } = context.sourceCode);
		},
		Program(): void {
			const comments = context.sourceCode.getAllComments();
			// Index of the open group's first comment, or -1 when none is open.
			let first = -1;
			let isHeader = false;
			// Until the first prose group: whether only whitespace, a shebang,
			// and directives come before the current comment.
			let headerPossible = true;
			let previousEnd = 0;
			// Whether the next line comment may join the open group.
			let canJoin = false;

			for (let index = 0; index < comments.length; index += 1) {
				const comment = comments[index];
				if (comment === undefined) {
					continue;
				}

				const [start, end] = comment.range;
				const isLine = comment.type === AST_TOKEN_TYPES.Line;
				if (
					canJoin &&
					isLine &&
					isNextLineGap(text, previousEnd, start) &&
					!isDirective(text, comment)
				) {
					previousEnd = end;
					continue;
				}

				if (first !== -1 && !isHeader) {
					checkGroup(comments, first, index - 1);
				}

				if (headerPossible && !isBlank(text, previousEnd, start)) {
					headerPossible = false;
				}

				previousEnd = end;
				// ESLint lists a shebang as a comment; it is not prose.
				if (text.charCodeAt(start) === CHAR_HASH || isDirective(text, comment)) {
					first = -1;
					canJoin = false;
					continue;
				}

				isHeader = headerPossible;
				headerPossible = false;
				first = index;
				canJoin = isLine && !isTrailing(text, start);
			}

			if (first !== -1 && !isHeader) {
				checkGroup(comments, first, comments.length - 1);
			}
		},
	};
}

export const maxCommentLength: FlawlessRuleModule<Options, MessageIds> = createFlawlessRule<
	Options,
	MessageIds
>({
	name: RULE_NAME,
	createOnce,
	meta: {
		defaultOptions: [DEFAULTS],
		docs: {
			description: "Limit comments by word count",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "suggestion",
	},
});
