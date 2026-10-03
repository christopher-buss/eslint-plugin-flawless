import type { TSESTree } from "@typescript-eslint/utils";
import { AST_TOKEN_TYPES } from "@typescript-eslint/utils";

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

const EM_DASH = "—";

const CHAR_TAB = 0x09;
const CHAR_SPACE = 0x20;
const CHAR_BANG = 0x21;
const CHAR_DOLLAR = 0x24;
const CHAR_STAR = 0x2a;
const CHAR_DOT = 0x2e;
const CHAR_SLASH = 0x2f;
const CHAR_GREATER = 0x3e;
const CHAR_QUESTION = 0x3f;
const CHAR_LEFT_BRACKET = 0x5b;
const CHAR_BACKSLASH = 0x5c;
const CHAR_BACKTICK = 0x60;
const CHAR_LEFT_BRACE = 0x7b;
const CHAR_RIGHT_BRACE = 0x7d;

interface SentenceRange {
	end: number;
	start: number;
}

/** A `[start, end)` run of prose; markup or code may sit between two runs. */
type Segment = readonly [start: number, end: number];

/** An em dash offset and the index of the segment that holds it. */
interface DashPosition {
	readonly index: number;
	readonly segmentIndex: number;
}

/** How a span's source wraps its prose. */
interface SpanSyntax {
	/** Block comment: a line may open with a JSDoc `*` gutter. */
	readonly gutter?: boolean;
	/**
	 * Markdown: `\.` is not a terminator, and a line may open with `>`
	 * container markers.
	 */
	readonly markdown?: boolean;
}

/** Minimal mdast node shape; only the fields this rule reads. */
interface MarkdownNode {
	alt?: null | string;
	children?: Array<MarkdownNode>;
	position?: { end: { offset?: number }; start: { offset?: number } };
	title?: null | string;
	type: string;
}

/** Mdast blocks whose children are phrasing content (one prose span each). */
const MARKDOWN_PROSE_BLOCKS = new Set(["heading", "paragraph", "tableCell"]);

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
 * Whether a code unit is whitespace, matching the `\s` class without running a
 * regex per character.
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit is whitespace.
 */
function isWhitespace(code: number): boolean {
	return (
		(code >= CHAR_TAB && code <= 0x0d) ||
		code === CHAR_SPACE ||
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
 * Whether the code unit at `index` ends a sentence: `.`, `!`, or `?`. In
 * Markdown a backslash escape (`\.`) makes it literal text instead.
 *
 * @param text - The full source text.
 * @param index - The offset to test.
 * @param markdown - Whether Markdown escapes apply.
 * @returns True when the character ends a sentence.
 */
function isTerminatorAt(text: string, index: number, markdown: boolean): boolean {
	const code = text.charCodeAt(index);
	if (code !== CHAR_DOT && code !== CHAR_BANG && code !== CHAR_QUESTION) {
		return false;
	}

	return !markdown || text.charCodeAt(index - 1) !== CHAR_BACKSLASH;
}

/**
 * Whether a gap of markup between two prose runs holds a line break.
 *
 * @param text - The full source text.
 * @param start - Offset of the first markup character.
 * @param end - Offset just past the last markup character.
 * @returns True when the gap breaks the line.
 */
function gapHasLineBreak(text: string, start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (isLineBreak(text.charCodeAt(index))) {
			return true;
		}
	}

	return false;
}

/**
 * Steps past the container prefix that opens a line: a JSDoc `*` gutter in a
 * block comment, or `>` blockquote markers in Markdown. Only applies when
 * `start` opens a line (after optional indentation).
 *
 * @param text - The full source text.
 * @param start - The trimmed sentence start.
 * @param dash - The dash offset, which the start never passes.
 * @param syntax - How the span wraps its prose.
 * @returns The start past the prefix, or `start` when there is none.
 */
function skipLinePrefix(text: string, start: number, dash: number, syntax: SpanSyntax): number {
	let lineStart = start;
	while (lineStart > 0) {
		const code = text.charCodeAt(lineStart - 1);
		if (code !== CHAR_SPACE && code !== CHAR_TAB) {
			break;
		}

		lineStart -= 1;
	}

	if (lineStart > 0 && !isLineBreak(text.charCodeAt(lineStart - 1))) {
		return start;
	}

	let next = start;
	if (syntax.gutter === true && text.charCodeAt(next) === CHAR_STAR) {
		next += 1;
	} else if (syntax.markdown === true) {
		while (next < dash && text.charCodeAt(next) === CHAR_GREATER) {
			next += 1;
			while (next < dash && isWhitespace(text.charCodeAt(next))) {
				next += 1;
			}
		}
	}

	while (next < dash && isWhitespace(text.charCodeAt(next))) {
		next += 1;
	}

	return next;
}

/**
 * Finds the sentence around a dash: back to the previous line break or
 * terminator (exclusive), forward to the next line break (exclusive) or
 * terminator (inclusive), with surrounding whitespace and line prefixes
 * trimmed. The scan reads prose segments only, stepping over markup between
 * them, and stops at the edge of the span or at markup that breaks the line.
 *
 * @param text - The full source text.
 * @param dash - The em dash offset and the segment that holds it.
 * @param segments - The prose segments of the span, ascending.
 * @param syntax - How the span wraps its prose.
 * @returns The trimmed sentence range.
 */
function getSentenceRange(
	text: string,
	{ index, segmentIndex }: DashPosition,
	segments: ReadonlyArray<Segment>,
	syntax: SpanSyntax,
): SentenceRange {
	const markdown = syntax.markdown === true;

	let start = index;
	for (let current = segmentIndex; current >= 0; current -= 1) {
		const low = segments[current]?.[0] ?? start;
		while (
			start > low &&
			!isLineBreak(text.charCodeAt(start - 1)) &&
			!isTerminatorAt(text, start - 1, markdown)
		) {
			start -= 1;
		}

		const previous = segments[current - 1];
		if (start > low || previous === undefined || gapHasLineBreak(text, previous[1], low)) {
			break;
		}

		start = previous[1];
	}

	let end = index + 1;
	for (let current = segmentIndex; current < segments.length; current += 1) {
		const high = segments[current]?.[1] ?? end;
		let stopped = false;
		while (end < high) {
			if (isLineBreak(text.charCodeAt(end))) {
				stopped = true;
				break;
			}

			end += 1;
			if (isTerminatorAt(text, end - 1, markdown)) {
				stopped = true;
				break;
			}
		}

		const next = segments[current + 1];
		if (stopped || next === undefined || gapHasLineBreak(text, high, next[0])) {
			break;
		}

		end = next[0];
	}

	while (start < index && isWhitespace(text.charCodeAt(start))) {
		start += 1;
	}

	start = skipLinePrefix(text, start, index, syntax);

	while (end > index + 1 && isWhitespace(text.charCodeAt(end - 1))) {
		end -= 1;
	}

	return { end, start };
}

/**
 * Lists every em dash offset in ascending order.
 *
 * @param text - The full source text.
 * @returns The sorted dash offsets.
 */
function findDashes(text: string): Array<number> {
	const dashes: Array<number> = [];
	let index = text.indexOf(EM_DASH);
	while (index !== -1) {
		dashes.push(index);
		index = text.indexOf(EM_DASH, index + 1);
	}

	return dashes;
}

/**
 * Binary-searches the first dash at or after `offset`.
 *
 * @param dashes - The sorted dash offsets.
 * @param offset - The offset to search from.
 * @returns The index into `dashes` of the first dash `>= offset`.
 */
function lowerBound(dashes: ReadonlyArray<number>, offset: number): number {
	let low = 0;
	let high = dashes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((dashes[middle] ?? offset) < offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	return low;
}

/**
 * Finds the content of a template element in source text: after the opening
 * `` ` `` or `}`, before the closing `` ` `` or `${`. Parsers differ on whether
 * the node range covers the delimiters, and the cooked/raw values normalize
 * CRLF, so neither the range nor `raw.length` alone settles it.
 *
 * @param text - The full source text.
 * @param node - The template element.
 * @returns The content segment.
 */
function getTemplateContent(text: string, node: TSESTree.TemplateElement): Segment {
	const [start, end] = node.range;
	const opener = text.charCodeAt(start);
	const closesWithDelimiter = node.tail
		? text.charCodeAt(end - 1) === CHAR_BACKTICK
		: text.charCodeAt(end - 2) === CHAR_DOLLAR && text.charCodeAt(end - 1) === CHAR_LEFT_BRACE;
	const includesDelimiters =
		(opener === CHAR_BACKTICK || opener === CHAR_RIGHT_BRACE) && closesWithDelimiter;
	if (!includesDelimiters) {
		return [start, end];
	}

	return [start + 1, node.tail ? end - 1 : end - 2];
}

/**
 * Finds the prose of a comment: past the opener and any extra `/` or `*`
 * (`///`, `/**`), before a block comment's `*\/`. A line comment's content is
 * read back from its end by `value.length`, so `#` comments work too.
 *
 * @param text - The full source text.
 * @param comment - The comment token.
 * @returns The content segment.
 */
function getCommentContent(text: string, comment: TSESTree.Comment): Segment {
	const [start, end] = comment.range;
	const isBlock = comment.type === AST_TOKEN_TYPES.Block;
	let low = isBlock ? start + 2 : end - comment.value.length;
	const high = isBlock ? end - 2 : end;
	const extra = isBlock ? CHAR_STAR : CHAR_SLASH;
	while (low < high && text.charCodeAt(low) === extra) {
		low += 1;
	}

	return [low, high];
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let text = "";
	let dashes: Array<number> = [];

	/**
	 * Reports one sentence per dash group within a span. Dashes are visited in
	 * ascending order, so a dash before the previous sentence's end shares that
	 * sentence.
	 *
	 * @param segments - The prose segments of the span, ascending.
	 * @param syntax - How the span wraps its prose.
	 */
	function reportSpan(segments: ReadonlyArray<Segment>, syntax: SpanSyntax): void {
		let previousEnd = -1;
		for (const [segmentIndex, [low, high]] of segments.entries()) {
			for (let index = lowerBound(dashes, low); index < dashes.length; index += 1) {
				const dash = dashes[index] ?? high;
				if (dash >= high) {
					break;
				}

				if (dash < previousEnd) {
					continue;
				}

				const { end, start } = getSentenceRange(
					text,
					{ index: dash, segmentIndex },
					segments,
					syntax,
				);
				previousEnd = end;
				context.report({
					loc: {
						end: context.sourceCode.getLocFromIndex(end),
						start: context.sourceCode.getLocFromIndex(start),
					},
					messageId: MESSAGE_ID,
				});
			}
		}
	}

	function checkSpan([low, high]: Segment, syntax: SpanSyntax = {}): void {
		const first = dashes[lowerBound(dashes, low)];
		if (first !== undefined && first < high) {
			reportSpan([[low, high]], syntax);
		}
	}

	/**
	 * Locates an `alt` or `title` string in the source of its node. Escapes or
	 * entities make the value differ from the source; such values are skipped.
	 *
	 * @param node - The mdast node that carries the value.
	 * @param value - The `alt` or `title` value.
	 * @param fromEnd - Search from the node end (titles follow the URL).
	 */
	function checkAttribute(
		node: MarkdownNode,
		value: null | string | undefined,
		fromEnd: boolean,
	): void {
		const low = node.position?.start.offset;
		const high = node.position?.end.offset;
		if (
			value === undefined ||
			value === null ||
			value === "" ||
			low === undefined ||
			high === undefined
		) {
			return;
		}

		const found = fromEnd
			? text.lastIndexOf(value, high - value.length)
			: text.indexOf(value, low);
		if (found >= low && found + value.length <= high) {
			checkSpan([found, found + value.length], { markdown: true });
		}
	}

	/**
	 * Checks the `alt` and `title` attributes an mdast node may carry.
	 *
	 * @param node - Any mdast node.
	 */
	function checkAttributes(node: MarkdownNode): void {
		if (node.type === "image" || node.type === "imageReference") {
			checkAttribute(node, node.alt, false);
		}

		if (node.type === "image" || node.type === "link" || node.type === "definition") {
			checkAttribute(node, node.title, true);
		}
	}

	/**
	 * Whether a link is an autolink (`<https://...>` or a GFM literal URL).
	 * Its text is a URL, not prose. Only `[text](url)` source opens with `[`.
	 *
	 * @param node - A `link` node.
	 * @returns True when the link is an autolink.
	 */
	function isAutolink(node: MarkdownNode): boolean {
		const low = node.position?.start.offset;
		return low !== undefined && text.charCodeAt(low) !== CHAR_LEFT_BRACKET;
	}

	/**
	 * Collects the `text` descendants of a phrasing node as prose segments, and
	 * checks the alt text and titles met on the way. Code, inline code, HTML,
	 * and autolinks hold no prose, so they are gaps.
	 *
	 * @param block - The phrasing block.
	 * @returns The segments in document order.
	 */
	function collectProse(block: MarkdownNode): Array<Segment> {
		const segments: Array<Segment> = [];
		const stack: Array<MarkdownNode> = [block];
		for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
			checkAttributes(node);
			if (node.type === "text") {
				const low = node.position?.start.offset;
				const high = node.position?.end.offset;
				if (low !== undefined && high !== undefined) {
					segments.push([low, high]);
				}

				continue;
			}

			if (node.type === "link" && isAutolink(node)) {
				continue;
			}

			const children = node.children ?? [];
			for (let index = children.length - 1; index >= 0; index -= 1) {
				const child = children[index];
				if (child !== undefined) {
					stack.push(child);
				}
			}
		}

		return segments;
	}

	function checkMarkdown(root: MarkdownNode): void {
		const stack: Array<MarkdownNode> = [root];
		for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
			if (MARKDOWN_PROSE_BLOCKS.has(node.type)) {
				reportSpan(collectProse(node), { markdown: true });
				continue;
			}

			checkAttributes(node);
			for (const child of node.children ?? []) {
				stack.push(child);
			}
		}
	}

	return {
		after(): void {
			text = "";
			dashes = [];
		},
		before(): boolean {
			({ text } = context.sourceCode);
			dashes = findDashes(text);
			return dashes.length > 0;
		},
		JSXText(node: TSESTree.JSXText): void {
			checkSpan(node.range);
		},
		Literal(node: TSESTree.Literal): void {
			if (typeof node.value === "string") {
				checkSpan([node.range[0] + 1, node.range[1] - 1]);
			}
		},
		Program(): void {
			for (const comment of context.sourceCode.getAllComments()) {
				checkSpan(getCommentContent(text, comment), {
					gutter: comment.type === AST_TOKEN_TYPES.Block,
				});
			}
		},
		/**
		 * Checks the mdast root from the `@eslint/markdown` language (ESLint
		 * only; oxlint never visits it).
		 *
		 * @param node - The mdast `root` node.
		 */
		root(node: unknown): void {
			checkMarkdown(node as MarkdownNode);
		},
		TemplateElement(node: TSESTree.TemplateElement): void {
			checkSpan(getTemplateContent(text, node));
		},
	};
}

export const noEmDash = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow em dashes in comments, strings, JSX text, and Markdown prose",
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
