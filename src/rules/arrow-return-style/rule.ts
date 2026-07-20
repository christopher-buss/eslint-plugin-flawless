import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSyncFn } from "synckit";

import type { FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import type { FormatRequest, FormatResponse } from "./worker";

export const RULE_NAME = "arrow-return-style";

const IMPLICIT = "useImplicitReturn";
const EXPLICIT = "useExplicitReturn";
const COMPLEX_EXPLICIT = "useExplicitReturnComplex";

export type MessageIds = typeof COMPLEX_EXPLICIT | typeof EXPLICIT | typeof IMPLICIT;

export type ObjectReturnStyle = "always-explicit" | "complex-explicit" | "off";

export type Options = [
	{
		/** Always use explicit returns for JSX bodies. */
		jsxAlwaysUseExplicitReturn?: boolean;
		/** Maximum emitted line length (tab-expanded) before requiring an explicit return. */
		maxLen?: number;
		/** Object property / array element count above which a literal body counts as complex. */
		maxObjectProperties?: number;
		/** Always use explicit returns for arrows assigned to named exports. */
		namedExportsAlwaysUseExplicitReturn?: boolean;
		/** When to force explicit returns for object/array literal bodies. */
		objectReturnStyle?: ObjectReturnStyle;
		/** Columns a tab occupies when measuring against `maxLen`. */
		tabWidth?: number;
		/** Consult oxfmt for boundary decisions; `printWidth` defaults to `maxLen`. */
		useOxfmt?: boolean | { printWidth?: number };
	},
];

type Config = Required<Options[0]>;

const DEFAULTS: Config = {
	jsxAlwaysUseExplicitReturn: false,
	maxLen: 80,
	maxObjectProperties: 4,
	namedExportsAlwaysUseExplicitReturn: true,
	objectReturnStyle: "complex-explicit",
	tabWidth: 4,
	useOxfmt: true,
};

type Context = Readonly<TSESLint.RuleContext<MessageIds, Options>>;

/**
 * A deferred oxfmt question: how would the formatter render `request.code` —
 * the enclosing statement with this rule's candidate fix already applied?
 * Explicit consults report when the arrow does not survive on one fitting
 * line; implicit consults report when it does.
 */
type PendingConsult = {
	baseIndent: string;
	cacheKey: string;
	node: TSESTree.ArrowFunctionExpression;
	request: FormatRequest;
} & (
	| { block: TSESTree.BlockStatement; kind: "implicit"; replacement: string }
	| { kind: "explicit" }
);

// --- oxfmt worker bridge ----------------------------------------------------

type FormatSync = (requests: Array<FormatRequest>) => Array<FormatResponse>;

/** `undefined` = not initialized yet; `null` = initialization failed. */
let formatSync: FormatSync | null | undefined;

function getFormatSync(): FormatSync | null {
	if (formatSync !== undefined) {
		return formatSync;
	}

	try {
		const directory = path.dirname(fileURLToPath(import.meta.url));
		const candidates = [
			// Sibling in the source tree (vitest runs the TS sources directly).
			path.join(directory, "worker.mjs"),
			// Built layout: rule code is bundled into dist root chunks while the
			// worker entry keeps its directory structure.
			path.join(directory, "rules", "arrow-return-style", "worker.mjs"),
			path.join(directory, "worker.ts"),
		];
		const workerPath = candidates.find((candidate) => existsSync(candidate));
		if (workerPath === undefined) {
			formatSync = null;
		} else {
			formatSync = createSyncFn<FormatSync>(workerPath, {
				timeout: 15_000,
				...(workerPath.endsWith(".ts") ? { tsRunner: "tsx" as never } : {}),
			});
		}
	} catch {
		formatSync = null;
	}

	return formatSync;
}

// --- format cache -----------------------------------------------------------

/**
 * Worker verdicts cached across files and fix passes: a snippet formats the
 * same way regardless of which file (or autofix iteration) asked. Bounded LRU
 * so long sessions (editors, watch mode) cannot grow it without limit.
 */
const formatCache = new Map<string, FormatResponse>();
const FORMAT_CACHE_MAX_ENTRIES = 1024;

function formatCacheGet(key: string): FormatResponse | undefined {
	const value = formatCache.get(key);
	if (value !== undefined) {
		formatCache.delete(key);
		formatCache.set(key, value);
	}

	return value;
}

function formatCacheSet(key: string, value: FormatResponse): void {
	formatCache.delete(key);
	formatCache.set(key, value);
	if (formatCache.size > FORMAT_CACHE_MAX_ENTRIES) {
		const oldest = formatCache.keys().next().value;
		if (oldest !== undefined) {
			formatCache.delete(oldest);
		}
	}
}

// --- measurement helpers ----------------------------------------------------

/**
 * Visual width of `text` with tabs expanded to `tabWidth`-column tab stops.
 *
 * @param text - The text to measure.
 * @param tabWidth - Columns a tab occupies.
 * @returns The tab-expanded width in columns.
 */
function expandedWidth(text: string, tabWidth: number): number {
	let width = 0;
	for (const character of text) {
		width += character === "\t" ? tabWidth - (width % tabWidth) : 1;
	}

	return width;
}

function leadingWhitespace(line: string): string {
	return /^[\t ]*/.exec(line)?.[0] ?? "";
}

// --- AST helpers ------------------------------------------------------------

function isJsx(node: TSESTree.Node): boolean {
	return node.type === AST_NODE_TYPES.JSXElement || node.type === AST_NODE_TYPES.JSXFragment;
}

function isNamedExportArrow(node: TSESTree.ArrowFunctionExpression): boolean {
	if (node.parent.type !== AST_NODE_TYPES.VariableDeclarator) {
		return false;
	}

	return node.parent.parent.parent.type === AST_NODE_TYPES.ExportNamedDeclaration;
}

/**
 * Does the collapsed body need wrapping parens to stay an expression body?
 *
 * @param node - The would-be implicit body expression.
 * @returns Whether the fixer must wrap the body in parentheses.
 */
function needsParens(node: TSESTree.Expression): boolean {
	return (
		node.type === AST_NODE_TYPES.ObjectExpression ||
		node.type === AST_NODE_TYPES.SequenceExpression
	);
}

function countObjectComplexity(node: TSESTree.ObjectExpression): number {
	let features = 0;
	for (const property of node.properties) {
		if (property.type === AST_NODE_TYPES.SpreadElement) {
			features += 1;
			continue;
		}

		if (property.computed) {
			features += 1;
		}

		if (property.value.type === AST_NODE_TYPES.CallExpression) {
			features += 1;
		}
	}

	return features;
}

function isComplexLiteral(node: TSESTree.Expression, maxObjectProperties: number): boolean {
	if (node.type === AST_NODE_TYPES.ObjectExpression) {
		if (node.properties.length > maxObjectProperties) {
			return true;
		}

		return countObjectComplexity(node) >= 2;
	}

	if (node.type === AST_NODE_TYPES.ArrayExpression) {
		const spreads = node.elements.filter(
			(element) => element?.type === AST_NODE_TYPES.SpreadElement,
		).length;
		const calls = node.elements.filter(
			(element) => element?.type === AST_NODE_TYPES.CallExpression,
		).length;
		return (spreads >= 1 && node.elements.length > 1) || calls >= 2 || spreads + calls >= 2;
	}

	return false;
}

function isLiteralBody(node: TSESTree.Expression): boolean {
	return (
		node.type === AST_NODE_TYPES.ObjectExpression ||
		node.type === AST_NODE_TYPES.ArrayExpression
	);
}

/**
 * Walks up to the outermost node whose parent is the Program.
 *
 * @param node - The node to walk up from.
 * @returns The top-level statement containing `node`.
 */
function statementOf(node: TSESTree.Node): TSESTree.Node {
	let current: TSESTree.Node = node;
	while (current.parent !== undefined && current.parent.type !== AST_NODE_TYPES.Program) {
		current = current.parent;
	}

	return current;
}

function pushChildNodes(stack: Array<TSESTree.Node>, value: unknown): void {
	const candidates = Array.isArray(value) ? value : [value];
	for (const item of candidates) {
		if (typeof item === "object" && item !== null && "type" in item) {
			stack.push(item as TSESTree.Node);
		}
	}
}

/**
 * Collects arrow functions in `root`'s subtree, ordered by source position.
 *
 * @param root - The subtree to search.
 * @returns All arrow function nodes, sorted by range start.
 */
function collectArrows(root: TSESTree.Node): Array<TSESTree.ArrowFunctionExpression> {
	const arrows: Array<TSESTree.ArrowFunctionExpression> = [];
	const stack: Array<TSESTree.Node> = [root];

	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) {
			continue;
		}

		if (current.type === AST_NODE_TYPES.ArrowFunctionExpression) {
			arrows.push(current);
		}

		for (const [key, value] of Object.entries(current)) {
			if (key !== "parent" && key !== "loc" && key !== "range") {
				pushChildNodes(stack, value);
			}
		}
	}

	return arrows.sort((a, b) => a.range[0] - b.range[0]);
}

export const arrowReturnStyle = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce(context: Context): FlawlessRuleListener {
		let config: Config = DEFAULTS;
		let sourceCode: Readonly<TSESLint.SourceCode>;
		let lines: Array<string>;
		let pendingConsults: Array<PendingConsult>;

		/**
		 * Effective line-length limit for emitted lines: the fixer must never
		 * produce a line the formatter would immediately rewrap.
		 *
		 * @returns The maximum permitted tab-expanded line width.
		 */
		function limit(): number {
			const { maxLen, useOxfmt } = config;
			return useOxfmt === false ? maxLen : Math.min(maxLen, printWidth());
		}

		function printWidth(): number {
			const { maxLen, useOxfmt } = config;
			if (typeof useOxfmt === "object" && typeof useOxfmt.printWidth === "number") {
				return useOxfmt.printWidth;
			}

			return maxLen;
		}

		function width(text: string): number {
			return expandedWidth(text, config.tabWidth);
		}

		function lineOf(lineNumber: number): string {
			return lines[lineNumber - 1] ?? "";
		}

		function objectStyleWantsExplicit(body: TSESTree.Expression): boolean {
			if (!isLiteralBody(body) || config.objectReturnStyle === "off") {
				return false;
			}

			if (config.objectReturnStyle === "always-explicit") {
				return true;
			}

			return isComplexLiteral(body, config.maxObjectProperties);
		}

		function arrowTokenOf(node: TSESTree.ArrowFunctionExpression): TSESTree.Token {
			let token = sourceCode.getTokenBefore(node.body);
			while (token !== null && token.value === "(") {
				token = sourceCode.getTokenBefore(token);
			}

			if (token?.value !== "=>") {
				throw new Error("arrow-return-style: could not locate the => token");
			}

			return token;
		}

		/**
		 * The `(`/`)` pair directly wrapping the body, if any.
		 *
		 * @param node - Function whose body may be parenthesized.
		 * @param arrowToken - Token of the `=>` operator, used to distinguish
		 *   body parens from parameter-list parens.
		 * @returns The wrapping paren tokens, or `null` when not parenthesized.
		 */
		function bodyParens(
			node: TSESTree.ArrowFunctionExpression,
			arrowToken: TSESTree.Token,
		): null | { close: TSESTree.Token; open: TSESTree.Token } {
			const before = sourceCode.getTokenBefore(node.body);
			if (before?.value !== "(" || before.range[0] < arrowToken.range[1]) {
				return null;
			}

			const after = sourceCode.getTokenAfter(node.body);
			if (after?.value !== ")") {
				return null;
			}

			return { close: after, open: before };
		}

		/**
		 * Prepares the oxfmt question for `node`: how would the formatter render
		 * the enclosing statement once the candidate fix is applied? `collapse`
		 * supplies the implicit-direction candidate (the block body textually
		 * replaced by its collapsed expression); omitting it asks about the
		 * statement as written.
		 *
		 * @param node - The arrow function in question.
		 * @param collapse - The implicit-direction candidate, if any.
		 * @returns The consult, or `null` when the arrow cannot be located.
		 */
		function buildConsult(
			node: TSESTree.ArrowFunctionExpression,
			collapse?: { block: TSESTree.BlockStatement; replacement: string },
		): null | Omit<PendingConsult, "kind"> {
			const statement = statementOf(node);
			const arrowIndex = collectArrows(statement).findIndex(
				(arrow) => arrow.range[0] === node.range[0],
			);
			if (arrowIndex === -1) {
				return null;
			}

			const offset = statement.range[0];
			const source = sourceCode.getText(statement);
			const snippet =
				collapse === undefined
					? source
					: source.slice(0, collapse.block.range[0] - offset) +
						collapse.replacement +
						source.slice(collapse.block.range[1] - offset);

			const request: FormatRequest = {
				arrowIndex,
				code: `${snippet}\n`,
				printWidth: printWidth(),
				tabWidth: config.tabWidth,
			};

			return {
				baseIndent: leadingWhitespace(lineOf(statement.loc.start.line)),
				cacheKey: `${arrowIndex} ${request.printWidth} ${request.tabWidth} ${snippet}`,
				node,
				request,
			};
		}

		/**
		 * Resolves every deferred oxfmt consult with a single worker round-trip:
		 * would the formatter render each candidate arrow (params through body) on
		 * a single line that fits `maxLen`? Explicit consults report when it
		 * cannot, implicit consults report when it can. Fails open (no report)
		 * when the worker or oxfmt is unavailable so that an unavailable formatter
		 * can never introduce reports it would have to fight over.
		 */
		function resolvePendingConsults(): void {
			if (pendingConsults.length === 0) {
				return;
			}

			const consults = pendingConsults;
			pendingConsults = [];
			const worker = getFormatSync();
			if (worker === null) {
				return;
			}

			const misses = new Map<string, FormatRequest>();
			for (const consult of consults) {
				if (formatCacheGet(consult.cacheKey) === undefined) {
					misses.set(consult.cacheKey, consult.request);
				}
			}

			if (misses.size > 0) {
				let responses: Array<FormatResponse> = [];
				try {
					responses = worker([...misses.values()]);
				} catch {
					responses = [];
				}

				for (const [index, cacheKey] of [...misses.keys()].entries()) {
					const response = responses[index];
					if (response !== undefined) {
						formatCacheSet(cacheKey, response);
					}
				}
			}

			for (const consult of consults) {
				const response = formatCacheGet(consult.cacheKey);
				if (response === undefined) {
					continue;
				}

				if (response.lineText === null) {
					continue;
				}

				const fits =
					response.singleLine &&
					width(consult.baseIndent) + width(response.lineText) <= config.maxLen;

				if (consult.kind === "implicit") {
					if (fits) {
						reportImplicit(consult.node, consult.block, consult.replacement);
					}
				} else if (!fits) {
					reportExplicit(consult.node, EXPLICIT);
				}
			}
		}

		/**
		 * Derives the one-level indent unit for an inserted block: prefer the
		 * offset between the arrow's line and the body's (or its continuation's)
		 * deeper indentation; otherwise infer from the indent character in use.
		 *
		 * @param arrowIndent - Leading whitespace of the arrow's line.
		 * @param node - The arrow function being fixed.
		 * @param bodyStart - The body's first token or node (including parens).
		 * @param bodyEnd - The body's last token or node (including parens).
		 * @returns The whitespace string for one indentation level.
		 */
		function indentUnit(
			arrowIndent: string,
			node: TSESTree.ArrowFunctionExpression,
			bodyStart: TSESTree.Node | TSESTree.Token,
			bodyEnd: TSESTree.Node | TSESTree.Token,
		): string {
			const referenceLines: Array<number> = [];
			const arrowLine = bodyStart.loc.start.line;
			if (bodyStart.loc.start.line !== node.loc.start.line) {
				referenceLines.push(bodyStart.loc.start.line);
			} else if (bodyEnd.loc.end.line > arrowLine) {
				referenceLines.push(arrowLine + 1);
			}

			for (const lineNumber of referenceLines) {
				const reference = leadingWhitespace(lineOf(lineNumber));
				if (reference.length > arrowIndent.length && reference.startsWith(arrowIndent)) {
					return reference.slice(arrowIndent.length);
				}
			}

			if (arrowIndent.includes("\t")) {
				return "\t";
			}

			return arrowIndent.length > 0 ? "  " : "\t";
		}

		/**
		 * The `)` of a wrapped sole-argument call whose trailing comma the fix
		 * should absorb. `foo(() =>\n\tbody,\n)` only carries that comma because
		 * the argument was wrapped; once the block body hugs the call again the
		 * comma is debris (`},\n)` where the formatter writes `})`).
		 *
		 * @param node - The arrow function being converted.
		 * @param bodyEnd - The body's last token or node (including parens).
		 * @returns The closing paren to absorb up to, or `null`.
		 */
		function danglingCloser(
			node: TSESTree.ArrowFunctionExpression,
			bodyEnd: TSESTree.Node | TSESTree.Token,
		): null | TSESTree.Token {
			const { loc, parent } = node;
			const isCall =
				parent.type === AST_NODE_TYPES.CallExpression ||
				parent.type === AST_NODE_TYPES.NewExpression;
			if (!isCall || parent.arguments.length !== 1 || parent.arguments[0] !== node) {
				return null;
			}

			// Only when the argument still hugs the call (`expect(() =>`). A call
			// expanded across lines keeps its trailing comma, which the formatter
			// wants there.
			const opener = sourceCode.getTokenBefore(node);
			if (opener?.value !== "(" || opener.loc.end.line !== loc.start.line) {
				return null;
			}

			const comma = sourceCode.getTokenAfter(bodyEnd);
			if (comma?.value !== ",") {
				return null;
			}

			const closer = sourceCode.getTokenAfter(comma);
			if (closer?.value !== ")" || closer.range[1] !== parent.range[1]) {
				return null;
			}

			// Comments in the gap would be swallowed with the comma.
			if (sourceCode.getCommentsBefore(closer).length > 0) {
				return null;
			}

			return closer;
		}

		/**
		 * Reports and fixes an implicit arrow into an explicit block body.
		 *
		 * @param node - The arrow function to convert.
		 * @param messageId - The violation to report.
		 */
		function reportExplicit(
			node: TSESTree.ArrowFunctionExpression,
			messageId: MessageIds,
		): void {
			const arrowToken = arrowTokenOf(node);
			const parens = bodyParens(node, arrowToken);
			const bodyStart = parens?.open ?? node.body;
			const bodyEnd = parens?.close ?? node.body;
			const comments = sourceCode.getCommentsBefore(bodyStart);

			const arrowIndent = leadingWhitespace(lineOf(node.loc.start.line));
			const unit = indentUnit(arrowIndent, node, bodyStart, bodyEnd);
			const targetIndent = arrowIndent + unit;

			const bodyText = sourceCode.getText(node.body);
			const bodyLines = bodyText.split("\n");
			const [firstLine, ...restLines] = bodyLines;

			// Re-anchor continuation lines so the body's closing line aligns with
			// the inserted `return`'s indentation.
			const lastLineIndent = leadingWhitespace(bodyLines.at(-1) ?? "");
			let shifted = restLines;
			if (restLines.length > 0) {
				if (targetIndent.startsWith(lastLineIndent)) {
					const prefix = targetIndent.slice(lastLineIndent.length);
					shifted = restLines.map((line) => prefix + line);
				} else if (lastLineIndent.startsWith(targetIndent)) {
					const strip = lastLineIndent.length - targetIndent.length;
					shifted = restLines.map((line) => {
						return leadingWhitespace(line).length >= strip ? line.slice(strip) : line;
					});
				}
			}

			const commentLines = comments.map(
				(comment) => targetIndent + sourceCode.getText(comment),
			);
			const returnLine = `${targetIndent}return ${[firstLine, ...shifted].join("\n")};`;
			const replacement = ` {\n${[...commentLines, returnLine].join("\n")}\n${arrowIndent}}`;

			const end = danglingCloser(node, bodyEnd)?.range[0] ?? bodyEnd.range[1];

			context.report({
				fix: (fixer) => fixer.replaceTextRange([arrowToken.range[1], end], replacement),
				messageId,
				node,
			});
		}

		/**
		 * Reports and fixes a single-`return` block into an implicit body.
		 *
		 * @param node - The arrow function to convert.
		 * @param block - The block body being replaced.
		 * @param replacement - The implicit body text.
		 */
		function reportImplicit(
			node: TSESTree.ArrowFunctionExpression,
			block: TSESTree.BlockStatement,
			replacement: string,
		): void {
			context.report({
				fix: (fixer) => fixer.replaceTextRange(block.range, replacement),
				messageId: IMPLICIT,
				node,
			});
		}

		function checkBlockBody(node: TSESTree.ArrowFunctionExpression): void {
			const block = node.body as TSESTree.BlockStatement;
			if (block.body.length !== 1) {
				return;
			}

			const [statement] = block.body;
			if (statement?.type !== AST_NODE_TYPES.ReturnStatement || statement.argument === null) {
				return;
			}

			// Comments anywhere in the block would be lost or displaced: bail.
			if (sourceCode.getCommentsInside(block).length > 0) {
				return;
			}

			const { argument } = statement;
			if (isJsx(argument) && config.jsxAlwaysUseExplicitReturn) {
				return;
			}

			if (isNamedExportArrow(node) && config.namedExportsAlwaysUseExplicitReturn) {
				return;
			}

			if (objectStyleWantsExplicit(argument)) {
				return;
			}

			// Never collapse a multiline return expression onto one line.
			if (argument.loc.start.line !== argument.loc.end.line) {
				return;
			}

			const argumentText = sourceCode.getText(argument);
			const collapsed = needsParens(argument) ? `(${argumentText})` : argumentText;

			const blockLine = lineOf(block.loc.start.line);
			const prefix = blockLine.slice(0, block.loc.start.column);
			const suffix = lineOf(block.loc.end.line).slice(block.loc.end.column);
			if (width(prefix + collapsed + suffix) > limit()) {
				return;
			}

			// `suffix` only reaches the end of the block's closing line. When the
			// statement continues past it the enclosing call is wrapped, so the
			// measurement above is missing the tail the formatter would pull back
			// up (`},\n).toThrow(x)` measures as `},`) and cannot decide alone.
			const statementEnd = statementOf(node).loc.end.line;
			if (statementEnd === block.loc.end.line || config.useOxfmt === false) {
				reportImplicit(node, block, collapsed);
				return;
			}

			// The formatter verdict is deferred so that all consults in the file
			// share one worker round-trip (see resolvePendingConsults).
			const consult = buildConsult(node, { block, replacement: collapsed });
			if (consult !== null) {
				pendingConsults.push({
					...consult,
					block,
					kind: "implicit",
					replacement: collapsed,
				});
			}
		}

		function checkExpressionBody(node: TSESTree.ArrowFunctionExpression): void {
			const body = node.body as TSESTree.Expression;
			const arrowToken = arrowTokenOf(node);
			const parens = bodyParens(node, arrowToken);
			const bodyStart = parens?.open ?? body;
			const bodyEnd = parens?.close ?? body;

			// Comments between `=>` and the body force an explicit block that can
			// host them as statements.
			if (sourceCode.getCommentsBefore(bodyStart).length > 0) {
				reportExplicit(node, EXPLICIT);
				return;
			}

			if (isJsx(body) && config.jsxAlwaysUseExplicitReturn) {
				reportExplicit(node, EXPLICIT);
				return;
			}

			if (isNamedExportArrow(node) && config.namedExportsAlwaysUseExplicitReturn) {
				reportExplicit(node, EXPLICIT);
				return;
			}

			// Body starting on a line after `=>` (the formatter's
			// wrap-after-arrow style): this rule prefers an explicit block
			// instead.
			if (bodyStart.loc.start.line !== arrowToken.loc.end.line) {
				reportExplicit(node, EXPLICIT);
				return;
			}

			const multiline = bodyEnd.loc.end.line !== bodyStart.loc.start.line;
			if (multiline) {
				// Multiline object literals prefer the explicit block form (oxfmt
				// preserves their multiline shape, so this is stable). Multiline
				// arrays are formatter-owned — oxfmt freely collapses/expands
				// them, so converting provably loops. Everything else is left
				// alone.
				if (body.type === AST_NODE_TYPES.ObjectExpression) {
					reportExplicit(node, EXPLICIT);
				}

				return;
			}

			const lineWidth = width(lineOf(bodyStart.loc.start.line));
			if (lineWidth > limit()) {
				if (config.useOxfmt === false) {
					reportExplicit(node, EXPLICIT);
					return;
				}

				// The formatter verdict is deferred so that all consults in the
				// file share one worker round-trip (see resolvePendingConsults).
				const consult = buildConsult(node);
				if (consult !== null) {
					pendingConsults.push({ ...consult, kind: "explicit" });
				}

				return;
			}

			if (objectStyleWantsExplicit(body)) {
				reportExplicit(node, COMPLEX_EXPLICIT);
			}
		}

		return {
			"ArrowFunctionExpression": function (node): void {
				if (node.body.type === AST_NODE_TYPES.BlockStatement) {
					checkBlockBody(node);
				} else {
					checkExpressionBody(node);
				}
			},
			"before": function (): void {
				config = { ...DEFAULTS, ...context.options[0] };
				({ sourceCode } = context);
				lines = [...sourceCode.lines];
				pendingConsults = [];
			},
			"Program:exit": function (): void {
				resolvePendingConsults();
			},
		};
	},
	defaultOptions: [DEFAULTS],
	meta: {
		docs: {
			description: "Enforce arrow function return style based on line length",
			requiresTypeChecking: false,
		},
		fixable: "code",
		messages: {
			[COMPLEX_EXPLICIT]: "Use an explicit return block for complex object or array bodies.",
			[EXPLICIT]: "Use an explicit return block for this arrow function body.",
			[IMPLICIT]: "Use an implicit return for this arrow function body.",
		},
		schema: [
			{
				additionalProperties: false,
				properties: {
					jsxAlwaysUseExplicitReturn: { type: "boolean" },
					maxLen: { minimum: 0, type: "integer" },
					maxObjectProperties: { minimum: 0, type: "integer" },
					namedExportsAlwaysUseExplicitReturn: { type: "boolean" },
					objectReturnStyle: {
						enum: ["always-explicit", "complex-explicit", "off"],
						type: "string",
					},
					tabWidth: { minimum: 1, type: "integer" },
					useOxfmt: {
						oneOf: [
							{ type: "boolean" },
							{
								additionalProperties: false,
								properties: { printWidth: { minimum: 0, type: "integer" } },
								type: "object",
							},
						],
					},
				},
				type: "object",
			},
		],
		type: "suggestion",
	},
});
