import * as core from "@eslint-react/core";
import {
	AST_NODE_TYPES,
	ASTUtils,
	type JSONSchema,
	type TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";

import { createEslintRule } from "../../util";

export const RULE_NAME = "purity";

const MESSAGE_ID = "impureCall";

export type MessageIds = typeof MESSAGE_ID;

export interface PurityOptions {
	/**
	 * Extra dotted call signatures to treat as impure, added to the defaults
	 * (e.g. `"Math.random"` when using a Luau `Math` polyfill).
	 */
	readonly additionalFunctions?: ReadonlyArray<string>;
	/** Default signatures to exclude (e.g. `"os.date"`). */
	readonly ignore?: ReadonlyArray<string>;
}

export type Options = [PurityOptions?];

/**
 * Non-deterministic Luau / Roblox calls, written as dotted paths matching how
 * they appear in roblox-ts source. `new Random()` is normalized to
 * `"Random.new"` (see the `NewExpression` visitor).
 */
const DEFAULT_SIGNATURES = [
	"DateTime.now",
	"HttpService.GenerateGUID",
	"Random.new",
	"Workspace.GetServerTimeNow",
	"elapsedTime",
	"math.random",
	"math.randomseed",
	"os.clock",
	"os.date",
	"os.time",
	"tick",
	"time",
] as const;

/**
 * Bare Luau globals for which a matching local binding means the reference is
 * shadowed rather than the ambient global. Service objects are intentionally
 * excluded because they are impure even when imported from `@rbxts/services`.
 */
const GUARDED_GLOBALS = new Set(["elapsedTime", "math", "os", "tick", "time"]);

const messages = {
	[MESSAGE_ID]:
		"Do not call '{{name}}' during render. Components and hooks must be pure. Move this call into an event handler, effect, or state initializer.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			additionalFunctions: {
				description:
					'Extra dotted call signatures to treat as impure (e.g. "Math.random").',
				items: { type: "string" },
				type: "array",
				uniqueItems: true,
			},
			ignore: {
				description: 'Default signatures to exclude (e.g. "os.date").',
				items: { type: "string" },
				type: "array",
				uniqueItems: true,
			},
		},
		type: "object",
	},
];

/**
 * The context type `@eslint-react/core`'s predicates expect, derived from an
 * exported predicate (mirrors `src/utils/unnecessary-hook.ts`).
 */
type ReactContext = Parameters<typeof core.isUseMemoCall>[0];

type FunctionNode =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

interface CalleeMatch {
	/** The dotted path, e.g. `"math.random"` or `"tick"`. */
	readonly path: string;
	/** The leading identifier node, used for the shadowing guard. */
	readonly root: TSESTree.Identifier;
}

/**
 * Strips wrappers that are irrelevant to the callee identity so that
 * `a.b?.()` and `a.b!()` still match.
 *
 * @param node - The node to unwrap.
 * @returns The unwrapped node.
 */
function unwrap(node: TSESTree.Node): TSESTree.Node {
	let current = node;
	while (
		current.type === AST_NODE_TYPES.ChainExpression ||
		current.type === AST_NODE_TYPES.TSNonNullExpression
	) {
		current = current.expression;
	}

	return current;
}

/**
 * Builds the dotted path for a callee, e.g. `math.random` or `tick`.
 *
 * @param callee - The callee expression.
 * @returns The match, or `null` when the callee cannot be represented as a
 *   simple dotted path (computed access, or an object that is an expression).
 */
function dottedCalleePath(callee: TSESTree.Node): CalleeMatch | null {
	let current = unwrap(callee);
	const parts: Array<string> = [];
	while (current.type === AST_NODE_TYPES.MemberExpression) {
		if (current.computed || current.property.type !== AST_NODE_TYPES.Identifier) {
			return null;
		}

		parts.unshift(current.property.name);
		current = unwrap(current.object);
	}

	if (current.type !== AST_NODE_TYPES.Identifier) {
		return null;
	}

	parts.unshift(current.name);
	return { path: parts.join("."), root: current };
}

/**
 * Determines whether an identifier resolves to a real user binding (import,
 * parameter, or local declaration) rather than the ambient Luau global.
 *
 * @param sourceCode - Provides scope lookup.
 * @param node - The identifier node.
 * @returns `true` when the identifier is a user binding rather than the ambient
 *   global.
 */
function isUserBinding(
	sourceCode: Readonly<TSESLint.SourceCode>,
	node: TSESTree.Identifier,
): boolean {
	let scope: null | TSESLint.Scope.Scope = sourceCode.getScope(node);
	while (scope !== null) {
		const variable = scope.variables.find((candidate) => candidate.name === node.name);
		if (variable !== undefined) {
			return variable.defs.length > 0;
		}

		scope = scope.upper;
	}

	return false;
}

/**
 * Finds the immediate enclosing function of a node, stopping at the program.
 *
 * @param node - The node to search upward from.
 * @returns The enclosing function, or `null` when the node is at module level.
 */
function enclosingFunction(node: TSESTree.Node): FunctionNode | null {
	let current: TSESTree.Node | undefined = node.parent;
	while (current !== undefined) {
		if (ASTUtils.isFunction(current)) {
			return current;
		}

		if (current.type === AST_NODE_TYPES.Program) {
			return null;
		}

		current = current.parent;
	}

	return null;
}

/**
 * Determines whether a function executes during render: a component body, a
 * custom/builtin hook body, or a `useMemo` callback.
 *
 * @param reactContext - The context `@eslint-react/core` predicates expect.
 * @param func - The enclosing function node.
 * @returns `true` when the function runs during render.
 */
function isRenderContext(reactContext: ReactContext, func: FunctionNode): boolean {
	if (
		core.isFunctionComponentDefinition(
			reactContext,
			func,
			core.DEFAULT_COMPONENT_DETECTION_HINT,
		)
	) {
		return true;
	}

	if (core.isHookDefinition(func)) {
		return true;
	}

	const { parent } = func;
	return (
		parent.type === AST_NODE_TYPES.CallExpression &&
		parent.arguments[0] === func &&
		core.isUseMemoCall(reactContext, parent)
	);
}

function create(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const { sourceCode } = context;
	const reactContext = context as unknown as ReactContext;

	const options = context.options[0] ?? {};
	const signatures = new Set<string>(DEFAULT_SIGNATURES);
	for (const signature of options.additionalFunctions ?? []) {
		signatures.add(signature);
	}

	for (const signature of options.ignore ?? []) {
		signatures.delete(signature);
	}

	function handle(
		node: TSESTree.CallExpression | TSESTree.NewExpression,
		match: CalleeMatch,
		path: string,
	): void {
		if (!signatures.has(path)) {
			return;
		}

		// `new Random(seed)` with an explicit seed is deterministic; only the
		// seedless `new Random()` reads the clock. Any impure seed expression is
		// caught on its own.
		if (path === "Random.new" && node.arguments.length > 0) {
			return;
		}

		if (GUARDED_GLOBALS.has(match.root.name) && isUserBinding(sourceCode, match.root)) {
			return;
		}

		const func = enclosingFunction(node);
		if (func === null || !isRenderContext(reactContext, func)) {
			return;
		}

		context.report({ data: { name: path }, messageId: MESSAGE_ID, node });
	}

	return {
		CallExpression(node: TSESTree.CallExpression): void {
			const match = dottedCalleePath(node.callee);
			if (match !== null) {
				handle(node, match, match.path);
			}
		},
		NewExpression(node: TSESTree.NewExpression): void {
			const match = dottedCalleePath(node.callee);
			if (match !== null) {
				handle(node, match, `${match.path}.new`);
			}
		},
	};
}

export const purity = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [{}],
	meta: {
		defaultOptions: [{}],
		docs: {
			description: "Disallow impure calls such as `math.random` or `os.clock` during render",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "problem",
	},
});
