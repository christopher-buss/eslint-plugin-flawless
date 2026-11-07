import { AST_TOKEN_TYPES, type JSONSchema, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";

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
const CHAR_LINE_SEPARATOR = 0x2028;
const CHAR_PARAGRAPH_SEPARATOR = 0x2029;

/**
 * Whether a code unit matches `\s` in a `u`-flag regular expression.
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit is whitespace or a line break.
 */
function isWhitespace(code: number): boolean {
	if (code <= 0x20) {
		return code === 0x20 || (code >= 0x09 && code <= 0x0d);
	}

	if (code < 0xa0) {
		return false;
	}

	return (
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === CHAR_LINE_SEPARATOR ||
		code === CHAR_PARAGRAPH_SEPARATOR ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

/**
 * Whether a code unit ends a line, matching ESLint's line-break set.
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit is a line break.
 */
function isLineBreak(code: number): boolean {
	return (
		code === CHAR_LF ||
		code === CHAR_CR ||
		code === CHAR_LINE_SEPARATOR ||
		code === CHAR_PARAGRAPH_SEPARATOR
	);
}

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
 * Counts whitespace-separated words in a comment body. In a block comment, one
 * `*` gutter at the start of each line is not a word.
 *
 * @param text - The source text.
 * @param comment - The comment to count.
 * @returns The number of words.
 */
function countWords(text: string, comment: TSESTree.Comment): number {
	const isBlock = comment.type === AST_TOKEN_TYPES.Block;
	const end = comment.range[1] - (isBlock ? 2 : 0);
	let count = 0;
	let inWord = false;
	let atLineStart = isBlock;
	for (let index = comment.range[0] + 2; index < end; index += 1) {
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

		if (
			ignoreJSDoc &&
			first === last &&
			firstComment.type === AST_TOKEN_TYPES.Block &&
			text.charCodeAt(start + 2) === CHAR_STAR
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
			// Index of the open group's first comment, or -1 before any group.
			let first = -1;
			let isHeader = false;
			let previousEnd = 0;
			let previousIsLine = false;
			let shebangEnd = 0;
			for (let index = 0; index < comments.length; index += 1) {
				const comment = comments[index];
				if (comment === undefined) {
					continue;
				}

				const [start, end] = comment.range;
				const isLine = comment.type === AST_TOKEN_TYPES.Line;
				// ESLint lists a shebang as a comment; it is not prose.
				if (text.charCodeAt(start) === CHAR_HASH) {
					shebangEnd = end;
					previousEnd = end;
					continue;
				}

				const joins =
					isLine &&
					previousIsLine &&
					first !== -1 &&
					isNextLineGap(text, previousEnd, start);
				previousEnd = end;
				previousIsLine = isLine;
				if (joins) {
					continue;
				}

				if (first === -1) {
					// The first group is the file header when only whitespace
					// (or a shebang) comes before it.
					isHeader = isBlank(text, shebangEnd, start);
				} else if (isHeader) {
					isHeader = false;
				} else {
					checkGroup(comments, first, index - 1);
				}

				first = index;
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
	defaultOptions: [DEFAULTS],
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
