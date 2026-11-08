import { AST_NODE_TYPES, type JSONSchema, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "cognitive-complexity";

const MESSAGE_ID_TOO_COMPLEX = "tooComplex";

export type MessageIds = typeof MESSAGE_ID_TOO_COMPLEX;

export interface CognitiveComplexityOptions {
	/** The highest Cognitive Complexity a function may have. */
	readonly threshold?: number;
}

export type Options = [CognitiveComplexityOptions?];

type FunctionNode =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

/** The score of one function. Only the function's own code adds to it. */
interface Frame {
	readonly node: FunctionNode;
	score: number;
}

/** The result of one walk over a flattened logical chain. */
interface ChainState {
	/** The number of runs of `&&` operators. */
	andRuns: number;
	/** `true` when a direct operand of the chain is a `?:` expression. */
	hasConditionalOperand: boolean;
	/** `true` when the chain uses more than one operator. */
	isMixed: boolean;
	/** The operator before the current position, or `undefined` at the start. */
	previous: TSESTree.LogicalExpression["operator"] | undefined;
}

const DEFAULT_THRESHOLD = 15;

const messages = {
	[MESSAGE_ID_TOO_COMPLEX]:
		"This function has a Cognitive Complexity of {{complexity}}. The maximum is {{threshold}}.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			threshold: {
				description: "The highest Cognitive Complexity a function may have.",
				minimum: 0,
				type: "integer",
			},
		},
		type: "object",
	},
];

/**
 * Determines whether a node is a function that gets its own score.
 *
 * @param node - The node to test.
 * @returns `true` for a function declaration, function expression or arrow.
 */
function isFunction(node: TSESTree.Node): node is FunctionNode {
	return (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionDeclaration ||
		node.type === AST_NODE_TYPES.FunctionExpression
	);
}

/**
 * Determines whether an `if` is the `else if` of another `if`.
 *
 * @param node - The `if` statement to test.
 * @returns `true` when the node is the `alternate` of its parent `if`.
 */
function isElseIf(node: TSESTree.IfStatement): boolean {
	const { parent } = node;
	return parent.type === AST_NODE_TYPES.IfStatement && parent.alternate === node;
}

/**
 * Determines whether a parent-child edge raises the nesting level.
 *
 * @param parent - The parent node.
 * @param child - The direct child of `parent` on the path being walked.
 * @returns `true` when code inside `child` is one level deeper than `parent`.
 */
function isNestingEdge(parent: TSESTree.Node, child: TSESTree.Node): boolean {
	// eslint-disable-next-line ts/switch-exhaustiveness-check -- Other nodes add no nesting
	switch (parent.type) {
		case AST_NODE_TYPES.CatchClause:
		case AST_NODE_TYPES.DoWhileStatement:
		case AST_NODE_TYPES.ForInStatement:
		case AST_NODE_TYPES.ForOfStatement:
		case AST_NODE_TYPES.ForStatement:
		case AST_NODE_TYPES.WhileStatement: {
			return child === parent.body;
		}
		case AST_NODE_TYPES.ConditionalExpression: {
			return child !== parent.test;
		}
		case AST_NODE_TYPES.IfStatement: {
			return (
				child === parent.consequent ||
				(child === parent.alternate && child.type !== AST_NODE_TYPES.IfStatement)
			);
		}
		case AST_NODE_TYPES.SwitchStatement: {
			return child.type === AST_NODE_TYPES.SwitchCase;
		}
		default: {
			return false;
		}
	}
}

/**
 * Counts the nesting level of a node in its function. The walk stops at the
 * nearest function, so an outer function does not add to the level. The walk
 * also stops at a node with a known level, and it stores the level of each node
 * that it passes. Thus each node is walked at most once per file, and deep or
 * long chains of nesting stay linear.
 *
 * @param node - The node that gets a structural increment.
 * @param cache - The known nesting levels of nodes in this file.
 * @returns The nesting level of the node.
 */
function getNesting(node: TSESTree.Node, cache: Map<TSESTree.Node, number>): number {
	const path: Array<TSESTree.Node> = [];
	let current = node;
	let level = 0;

	for (;;) {
		const known = cache.get(current);
		if (known !== undefined) {
			level = known;
			break;
		}

		const { parent } = current;
		if (parent === undefined || isFunction(parent)) {
			break;
		}

		path.push(current);
		current = parent;
	}

	// Go back down the path and store the level of each node.
	let parent = current;
	for (const child of path.toReversed()) {
		if (isNestingEdge(parent, child)) {
			level += 1;
		}

		cache.set(child, level);
		parent = child;
	}

	return level;
}

/**
 * Walks a logical chain in source order. The walk goes through direct
 * `LogicalExpression` children only, so a chain in parentheses joins the
 * outer chain, but a chain under `!` or a call is a different chain.
 *
 * @param node - The current node of the chain.
 * @param state - The state that the walk updates.
 */
function walkChain(node: TSESTree.Expression, state: ChainState): void {
	if (node.type !== AST_NODE_TYPES.LogicalExpression) {
		if (node.type === AST_NODE_TYPES.ConditionalExpression) {
			state.hasConditionalOperand = true;
		}

		return;
	}

	const { left, operator, right } = node;
	walkChain(left, state);

	if (operator !== state.previous) {
		if (state.previous !== undefined) {
			state.isMixed = true;
		}

		if (operator === "&&") {
			state.andRuns += 1;
		}

		state.previous = operator;
	}

	walkChain(right, state);
}

/**
 * Gets the score of a logical chain.
 *
 * @param root - The top `LogicalExpression` of the chain.
 * @returns The number of `&&` runs, or `0` for a JSX guard such as
 *   `{a && b && <X />}`.
 */
function getChainScore(root: TSESTree.LogicalExpression): number {
	const state: ChainState = {
		andRuns: 0,
		hasConditionalOperand: false,
		isMixed: false,
		previous: undefined,
	};
	walkChain(root, state);

	if (
		root.parent.type === AST_NODE_TYPES.JSXExpressionContainer &&
		!state.isMixed &&
		!state.hasConditionalOperand
	) {
		return 0;
	}

	return state.andRuns;
}

/**
 * Builds the rule's per-file listener.
 *
 * @param context - The rule context.
 * @returns The visitors that score each function.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let threshold = DEFAULT_THRESHOLD;
	let frames: Array<Frame> = [];
	const nestingCache = new Map<TSESTree.Node, number>();

	/**
	 * Gets the location to report for a function. This runs only for a
	 * function that reports, so the token lookups have no cost for others.
	 *
	 * @param node - The function to locate.
	 * @returns The location of the function's name, key, `function` keyword or
	 *   `=>` token.
	 */
	function getReportLoc(node: FunctionNode): TSESTree.SourceLocation {
		const { sourceCode } = context;

		if (node.type === AST_NODE_TYPES.ArrowFunctionExpression) {
			const arrow = sourceCode.getTokenBefore(node.body, {
				filter: (token) => token.value === "=>",
			});
			return arrow?.loc ?? node.loc;
		}

		if (node.type === AST_NODE_TYPES.FunctionDeclaration && node.id !== null) {
			return node.id.loc;
		}

		const { loc, parent } = node;
		if (
			(parent.type === AST_NODE_TYPES.MethodDefinition ||
				parent.type === AST_NODE_TYPES.Property) &&
			parent.value === node
		) {
			return parent.key.loc;
		}

		const keyword = sourceCode.getFirstToken(node, {
			filter: (token) => token.value === "function",
		});
		return keyword?.loc ?? loc;
	}

	/**
	 * Adds to the score of the current function. Code outside all functions
	 * has no score.
	 *
	 * @param amount - The amount to add.
	 */
	function add(amount: number): void {
		const frame = frames.at(-1);
		if (frame !== undefined) {
			frame.score += amount;
		}
	}

	/**
	 * Adds a structural increment: one, plus the nesting level.
	 *
	 * @param node - The node that gets the increment.
	 */
	function addStructural(node: TSESTree.Node): void {
		if (frames.length > 0) {
			add(1 + getNesting(node, nestingCache));
		}
	}

	/**
	 * Adds one for a `break` or `continue` with a label.
	 *
	 * @param node - The jump statement.
	 */
	function addLabeledJump(node: TSESTree.BreakStatement | TSESTree.ContinueStatement): void {
		if (node.label !== null) {
			add(1);
		}
	}

	/**
	 * Starts the score of a function.
	 *
	 * @param node - The function that the new frame scores.
	 */
	function enterFunction(node: FunctionNode): void {
		frames.push({ node, score: 0 });
	}

	/**
	 * Ends the score of a function and reports it when it is too high.
	 */
	function exitFunction(): void {
		const frame = frames.pop();
		if (frame === undefined || frame.score <= threshold) {
			return;
		}

		context.report({
			data: { complexity: frame.score, threshold },
			loc: getReportLoc(frame.node),
			messageId: MESSAGE_ID_TOO_COMPLEX,
		});
	}

	return {
		"ArrowFunctionExpression": enterFunction,
		"ArrowFunctionExpression:exit": exitFunction,
		"before": function (): void {
			threshold = context.options[0]?.threshold ?? DEFAULT_THRESHOLD;
			frames = [];
			nestingCache.clear();
		},
		"BreakStatement": addLabeledJump,
		"CatchClause": addStructural,
		"ConditionalExpression": addStructural,
		"ContinueStatement": addLabeledJump,
		"DoWhileStatement": addStructural,
		"ForInStatement": addStructural,
		"ForOfStatement": addStructural,
		"ForStatement": addStructural,
		"FunctionDeclaration": enterFunction,
		"FunctionDeclaration:exit": exitFunction,
		"FunctionExpression": enterFunction,
		"FunctionExpression:exit": exitFunction,
		"IfStatement": function (node): void {
			if (frames.length === 0) {
				return;
			}

			if (isElseIf(node)) {
				add(1);
			} else {
				addStructural(node);
			}

			const { alternate } = node;
			if (alternate !== null && alternate.type !== AST_NODE_TYPES.IfStatement) {
				add(1);
			}
		},
		"LogicalExpression": function (node): void {
			if (frames.length > 0 && node.parent.type !== AST_NODE_TYPES.LogicalExpression) {
				add(getChainScore(node));
			}
		},
		"SwitchStatement": addStructural,
		"WhileStatement": addStructural,
	};
}

export const cognitiveComplexity: FlawlessRuleModule<Options, MessageIds> = createFlawlessRule<
	Options,
	MessageIds
>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [{ threshold: DEFAULT_THRESHOLD }],
	meta: {
		defaultOptions: [{ threshold: DEFAULT_THRESHOLD }],
		docs: {
			description: "Limit the Cognitive Complexity of each function",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "suggestion",
	},
});
