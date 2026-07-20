import {
	AST_NODE_TYPES,
	type JSONSchema,
	type TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import type { FunctionNode } from "./core-ast-utils";
import { getFunctionHeadLoc, getFunctionNameWithKind, upperCaseFirst } from "./core-ast-utils";

export const RULE_NAME = "max-lines-per-function";

const MESSAGE_ID_EXCEED = "exceed";

export type MessageIds = typeof MESSAGE_ID_EXCEED;

export interface MaxLinesPerFunctionOptions {
	/**
	 * Whether immediately-invoked function expressions are measured. Off by
	 * default, matching ESLint core.
	 */
	readonly IIFEs?: boolean;
	/** The maximum number of lines a function may span. */
	readonly max?: number;
	/** Whether lines containing only whitespace are excluded from the count. */
	readonly skipBlankLines?: boolean;
	/**
	 * Whether lines consisting solely of a comment are excluded from the count.
	 * A comment trailing real code does not make its line skippable.
	 */
	readonly skipComments?: boolean;
}

export type Options = [MaxLinesPerFunctionOptions?];

type Config = Required<MaxLinesPerFunctionOptions>;

const DEFAULTS: Config = {
	IIFEs: false,
	max: 50,
	skipBlankLines: false,
	skipComments: false,
};

const messages = {
	[MESSAGE_ID_EXCEED]:
		"{{name}} has too many lines ({{lineCount}}). Maximum allowed is {{maxLines}}.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			IIFEs: {
				description: "Whether immediately-invoked function expressions are measured.",
				type: "boolean",
			},
			max: {
				description: "The maximum number of lines a function may span.",
				minimum: 0,
				type: "integer",
			},
			skipBlankLines: {
				description:
					"Whether lines containing only whitespace are excluded from the count.",
				type: "boolean",
			},
			skipComments: {
				description:
					"Whether lines consisting solely of a comment are excluded from the count.",
				type: "boolean",
			},
		},
		type: "object",
	},
];

/**
 * Indexes comments by every source line they occupy, so a line can be tested
 * for comment-only status in constant time.
 *
 * @param comments - Every comment in the file.
 * @returns A map from one-indexed line number to the comment on that line.
 */
function getCommentLineNumbers(
	comments: ReadonlyArray<TSESTree.Comment>,
): Map<number, TSESTree.Comment> {
	const map = new Map<number, TSESTree.Comment>();

	for (const comment of comments) {
		for (let { line } = comment.loc.start; line <= comment.loc.end.line; line += 1) {
			// Unconditional, matching core: where two comments share a line the
			// later one wins.
			map.set(line, comment);
		}
	}

	return map;
}

/**
 * Determines whether a comment occupies a whole line, leaving no code beside
 * it.
 *
 * @param line - The source text of the line.
 * @param lineNumber - The one-indexed number of that line.
 * @param comment - The comment occupying part of the line.
 * @returns `true` when nothing but the comment appears on the line.
 */
function isFullLineComment(line: string, lineNumber: number, comment: TSESTree.Comment): boolean {
	const { end, start } = comment.loc;
	const isFirstTokenOnLine =
		start.line === lineNumber && line.slice(0, start.column).trim() === "";
	const isLastTokenOnLine = end.line === lineNumber && line.slice(end.column).trim() === "";

	return (
		(start.line < lineNumber || isFirstTokenOnLine) &&
		(end.line > lineNumber || isLastTokenOnLine)
	);
}

/**
 * Determines whether a function is the callee of its own call expression.
 *
 * @param node - The node to test.
 * @returns `true` when the node is immediately invoked.
 */
function isIIFE(node: TSESTree.Node): boolean {
	if (
		node.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
		node.type !== AST_NODE_TYPES.FunctionExpression
	) {
		return false;
	}

	const { parent } = node;

	return parent.type === AST_NODE_TYPES.CallExpression && parent.callee === node;
}

/**
 * Determines whether a function is the value of a class method or of an object
 * shorthand method or accessor. In that case the enclosing member — not the
 * bare function expression — is the unit measured and reported.
 *
 * @param node - The function to test.
 * @returns `true` when the function is embedded in a member definition.
 */
function isEmbedded(node: FunctionNode): boolean {
	const { parent } = node;

	if (parent.type === AST_NODE_TYPES.MethodDefinition) {
		return parent.value === node;
	}

	if (parent.type === AST_NODE_TYPES.Property) {
		return (
			parent.value === node &&
			(parent.method || parent.kind === "get" || parent.kind === "set")
		);
	}

	return false;
}

/**
 * Builds the rule's per-file listener.
 *
 * @param context - The rule context.
 * @returns The visitors measuring each function.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let commentLineNumbers: Map<number, TSESTree.Comment>;
	let config: Config;
	let lines: Array<string>;
	let sourceCode: Readonly<TSESLint.SourceCode>;

	/**
	 * Counts a function's lines and reports it when it exceeds the maximum.
	 *
	 * @param funcNode - The function to measure.
	 */
	function processFunction(funcNode: FunctionNode): void {
		const node: TSESTree.Node = isEmbedded(funcNode) ? funcNode.parent : funcNode;

		if (!config.IIFEs && isIIFE(node)) {
			return;
		}

		const { end, start } = node.loc;
		let lineCount = 0;

		for (let index = start.line - 1; index < end.line; index += 1) {
			const line = lines[index] ?? "";
			const lineNumber = index + 1;

			if (config.skipComments) {
				const comment = commentLineNumbers.get(lineNumber);
				if (comment !== undefined && isFullLineComment(line, lineNumber, comment)) {
					continue;
				}
			}

			if (config.skipBlankLines && /^\s*$/u.test(line)) {
				continue;
			}

			lineCount += 1;
		}

		if (lineCount > config.max) {
			context.report({
				data: {
					name: upperCaseFirst(getFunctionNameWithKind(funcNode)),
					lineCount,
					maxLines: config.max,
				},
				// Underline just the function's head; the whole node would
				// squiggle every line the diagnostic is complaining about.
				loc: getFunctionHeadLoc(funcNode, sourceCode),
				messageId: MESSAGE_ID_EXCEED,
				node,
			});
		}
	}

	return {
		ArrowFunctionExpression: processFunction,
		before(): void {
			// Merged field by field rather than by spread: a flat config may pass
			// an explicit `{ max: undefined }`, which satisfies the schema but
			// would survive a spread and defeat the default.
			const options = context.options[0];
			config = {
				IIFEs: options?.IIFEs ?? DEFAULTS.IIFEs,
				max: options?.max ?? DEFAULTS.max,
				skipBlankLines: options?.skipBlankLines ?? DEFAULTS.skipBlankLines,
				skipComments: options?.skipComments ?? DEFAULTS.skipComments,
			};

			({ sourceCode } = context);
			lines = [...sourceCode.lines];
			commentLineNumbers = getCommentLineNumbers(sourceCode.getAllComments());
		},
		FunctionDeclaration: processFunction,
		FunctionExpression: processFunction,
	};
}

export const maxLinesPerFunction = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [DEFAULTS],
	meta: {
		defaultOptions: [DEFAULTS],
		docs: {
			description: "Enforce a maximum number of lines of code in a function",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "suggestion",
	},
});
