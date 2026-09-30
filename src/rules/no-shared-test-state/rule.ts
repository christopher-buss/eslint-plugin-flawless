// cspell:ignore xtest
import {
	AST_NODE_TYPES,
	ASTUtils,
	type JSONSchema,
	TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import {
	getCalleeRootIdentifier,
	getTestGlobalSources,
	resolveTestGlobalName,
} from "../../utils/test-globals";

export const RULE_NAME = "no-shared-test-state";

const MESSAGE_ID = "sharedState";

export type MessageIds = typeof MESSAGE_ID;

export interface NoSharedTestStateOptions {
	/** Method names, besides the built-in ones, whose call mutates the receiver. */
	readonly additionalMutatingMethods?: ReadonlyArray<string>;
}

export type Options = [NoSharedTestStateOptions?];

type FunctionNode =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

type Variable = TSESLint.Scope.Variable;

/** What a function does to bindings declared outside it. */
interface DirectWrites {
	/** Local functions it references, whose writes it may trigger. */
	readonly helpers: ReadonlySet<FunctionNode>;
	/** Bindings it reassigns or mutates. */
	readonly variables: ReadonlySet<Variable>;
}

const messages = {
	[MESSAGE_ID]:
		"'{{name}}' is declared outside the tests and written inside one, so its state carries from test to test. Create it inside each test, or in a factory each test calls.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			additionalMutatingMethods: {
				description:
					"Method names, besides the built-in ones, whose call mutates the object it is called on.",
				items: { type: "string" },
				type: "array",
			},
		},
		type: "object",
	},
];

/** Callee roots whose function arguments run once per test (or once per suite). */
const TEST_CALLBACK_NAMES = new Set([
	"afterAll",
	"afterEach",
	"beforeAll",
	"beforeEach",
	"fit",
	"it",
	"test",
	"xit",
	"xtest",
]);

/**
 * Method names that mutate the object they are called on: those of `Array`,
 * `Map`, `Set`, and the weak collections, plus roblox-ts's array extensions.
 * With no type information the receiver is unknown, so this is a name
 * allowlist.
 */
const MUTATING_METHODS: ReadonlySet<string> = new Set([
	"add",
	"clear",
	"copyWithin",
	"delete",
	"fill",
	"insert",
	"pop",
	"push",
	"remove",
	"reverse",
	"set",
	"shift",
	"sort",
	"splice",
	"unorderedRemove",
	"unshift",
]);

/** Global static methods that mutate their first argument. */
const MUTATING_STATICS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["Object", new Set(["assign", "defineProperties", "defineProperty", "setPrototypeOf"])],
	["Reflect", new Set(["defineProperty", "deleteProperty", "set", "setPrototypeOf"])],
]);

/** Expression wrappers that leave the wrapped value's identity intact. */
const TRANSPARENT_TYPES: ReadonlySet<string> = new Set<string>([
	AST_NODE_TYPES.ChainExpression,
	AST_NODE_TYPES.TSAsExpression,
	AST_NODE_TYPES.TSNonNullExpression,
	AST_NODE_TYPES.TSSatisfiesExpression,
	AST_NODE_TYPES.TSTypeAssertion,
]);

/**
 * Narrows a node to a function whose body can be analyzed.
 *
 * @param node - The node to test.
 * @returns `true` for function declarations and expressions.
 */
function isFunctionNode(node: null | TSESTree.Node | undefined): node is FunctionNode {
	return node !== null && node !== undefined && ASTUtils.isFunction(node);
}

/**
 * Reads the static name of a member access's property.
 *
 * @param node - The member access.
 * @returns The property name, or `null` when it is computed from a value.
 */
function getPropertyName(node: TSESTree.MemberExpression): null | string {
	if (!node.computed && node.property.type === AST_NODE_TYPES.Identifier) {
		return node.property.name;
	}

	if (node.property.type === AST_NODE_TYPES.Literal && typeof node.property.value === "string") {
		return node.property.value;
	}

	return null;
}

/**
 * Determines whether a node is written to by the pattern or statement holding
 * it: the left side of an assignment, the target of a destructuring
 * assignment, or the loop variable of a `for...in`/`for...of`.
 *
 * @param node - The node to inspect.
 * @returns `true` when evaluating the parent writes to the node.
 */
function isAssignmentTarget(node: TSESTree.Node): boolean {
	let current = node;
	for (;;) {
		const { parent } = current;
		if (parent === undefined) {
			return false;
		}

		if (
			parent.type === AST_NODE_TYPES.ArrayPattern ||
			parent.type === AST_NODE_TYPES.ObjectPattern ||
			parent.type === AST_NODE_TYPES.RestElement
		) {
			current = parent;
		} else if (parent.type === AST_NODE_TYPES.AssignmentPattern) {
			if (parent.left !== current) {
				return false;
			}

			current = parent;
		} else if (
			parent.type === AST_NODE_TYPES.Property &&
			parent.parent.type === AST_NODE_TYPES.ObjectPattern
		) {
			if (parent.value !== current) {
				return false;
			}

			current = parent;
		} else if (parent.type === AST_NODE_TYPES.AssignmentExpression) {
			return parent.left === current;
		} else if (
			parent.type === AST_NODE_TYPES.ForInStatement ||
			parent.type === AST_NODE_TYPES.ForOfStatement
		) {
			return parent.left === current;
		} else {
			return false;
		}
	}
}

/**
 * Determines whether a variable is a binding a test could leak state through:
 * a `let`/`const`/`var` or a parameter. Imports, functions, classes, enums,
 * namespaces and globals are left out, since their state belongs to another
 * module or is not a value the file controls.
 *
 * @param variable - The variable to inspect.
 * @returns `true` when the variable is a candidate binding.
 */
function isStateBinding(variable: Variable): boolean {
	const definition = variable.defs.at(0);
	return (
		definition?.type === TSESLint.Scope.DefinitionType.Variable ||
		definition?.type === TSESLint.Scope.DefinitionType.Parameter
	);
}

/**
 * Determines whether a variable is declared inside a function, parameters
 * included.
 *
 * @param variable - The variable to locate.
 * @param node - The function to test against.
 * @returns `true` when the variable's scope lies within the function.
 */
function isDeclaredInside(variable: Variable, node: FunctionNode): boolean {
	const [start, end] = variable.scope.block.range;
	return start >= node.range[0] && end <= node.range[1];
}

/**
 * Resolves a variable to the local function it names: a function declaration,
 * or a `const` initialized with a function expression.
 *
 * @param variable - The variable to resolve.
 * @returns The function, or `null` when the variable does not name one.
 */
function getLocalFunction(variable: Variable): FunctionNode | null {
	if (variable.defs.length !== 1) {
		return null;
	}

	const [definition] = variable.defs;
	if (definition === undefined) {
		return null;
	}

	if (definition.type === TSESLint.Scope.DefinitionType.FunctionName) {
		return isFunctionNode(definition.node) ? definition.node : null;
	}

	if (
		definition.type !== TSESLint.Scope.DefinitionType.Variable ||
		definition.parent.kind !== "const" ||
		definition.node.id !== definition.name
	) {
		return null;
	}

	const { init } = definition.node;
	return isFunctionNode(init) ? init : null;
}

/**
 * Flags bindings declared outside a test and written from inside one, whose
 * state therefore carries from one test to the next. A binding counts as
 * written when a test or hook callback reassigns it, mutates it through a
 * member (`x.a = 1`, `delete x.a`, `x.push(1)`), or references a local helper
 * function that does either.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let sourceCode: Readonly<TSESLint.SourceCode>;
	let sources: ReadonlySet<string>;
	let mutatingMethods: ReadonlySet<string>;
	const callbacks = new Set<FunctionNode>();
	const directWritesCache = new Map<FunctionNode, DirectWrites>();

	/**
	 * Determines whether an identifier names the global of that name, with no
	 * local binding in the way.
	 *
	 * @param identifier - The identifier to resolve.
	 * @returns `true` when no local binding shadows the global.
	 */
	function isGlobal(identifier: TSESTree.Identifier): boolean {
		const variable = ASTUtils.findVariable(sourceCode.getScope(identifier), identifier);
		return variable === null || variable.defs.length === 0;
	}

	/**
	 * Determines whether a call mutates its first argument: `Object.assign`,
	 * `Reflect.set`, and the like.
	 *
	 * @param call - The call to inspect.
	 * @returns `true` when the callee is a global mutating static.
	 */
	function isMutatingStaticCall({ callee }: TSESTree.CallExpression): boolean {
		if (
			callee.type !== AST_NODE_TYPES.MemberExpression ||
			callee.object.type !== AST_NODE_TYPES.Identifier
		) {
			return false;
		}

		const methods = MUTATING_STATICS.get(callee.object.name);
		const name = getPropertyName(callee);
		return (
			methods !== undefined && name !== null && methods.has(name) && isGlobal(callee.object)
		);
	}

	/**
	 * Determines whether a read of a binding mutates the value it holds. The
	 * identifier is followed out through member accesses and type-only
	 * wrappers, so `x.a.b = 1`, `x!.push(1)` and `x?.set(k, v)` are all caught;
	 * the walk stops at a call, since a value returned from a method is not
	 * known to be part of the binding's value.
	 *
	 * @param identifier - The referencing identifier.
	 * @returns `true` when the expression around it mutates the binding.
	 */
	function isMutation(identifier: TSESTree.Identifier): boolean {
		let current: TSESTree.Node = identifier;
		let member: null | TSESTree.MemberExpression = null;
		let parent: TSESTree.Node | undefined = current.parent;
		while (parent !== undefined) {
			if (parent.type === AST_NODE_TYPES.MemberExpression && parent.object === current) {
				member = parent;
			} else if (!TRANSPARENT_TYPES.has(parent.type)) {
				break;
			}

			current = parent;
			({ parent } = current);
		}

		if (parent === undefined) {
			return false;
		}

		if (
			parent.type === AST_NODE_TYPES.CallExpression &&
			parent.arguments[0] === current &&
			isMutatingStaticCall(parent)
		) {
			return true;
		}

		if (member === null) {
			return false;
		}

		if (parent.type === AST_NODE_TYPES.CallExpression && parent.callee === current) {
			const name = getPropertyName(member);
			return name !== null && mutatingMethods.has(name);
		}

		if (parent.type === AST_NODE_TYPES.UpdateExpression) {
			return true;
		}

		if (parent.type === AST_NODE_TYPES.UnaryExpression) {
			return parent.operator === "delete";
		}

		return isAssignmentTarget(current);
	}

	/**
	 * Collects what a function does to bindings declared outside it, from the
	 * references its scope passes through — those of nested closures included,
	 * since a callback created in a test runs on the test's behalf.
	 *
	 * @param node - The function to analyze.
	 * @returns The bindings it writes and the local helpers it references.
	 */
	function getDirectWrites(node: FunctionNode): DirectWrites {
		const cached = directWritesCache.get(node);
		if (cached !== undefined) {
			return cached;
		}

		const variables = new Set<Variable>();
		const helpers = new Set<FunctionNode>();
		for (const reference of sourceCode.getScope(node).through) {
			const { identifier, resolved } = reference;
			if (resolved === null) {
				continue;
			}

			const helper = getLocalFunction(resolved);
			if (helper !== null) {
				helpers.add(helper);
				continue;
			}

			if (
				isStateBinding(resolved) &&
				identifier.type === AST_NODE_TYPES.Identifier &&
				(reference.isWrite() || isMutation(identifier))
			) {
				variables.add(resolved);
			}
		}

		const writes: DirectWrites = { helpers, variables };
		directWritesCache.set(node, writes);
		return writes;
	}

	/**
	 * Collects every shared binding a test callback writes, following the local
	 * helpers it references transitively.
	 *
	 * @param callback - The test or hook callback.
	 * @param found - Receives each binding declared outside the callback.
	 */
	function collectWrites(callback: FunctionNode, found: Set<Variable>): void {
		const visited = new Set<FunctionNode>([callback]);
		const pending: Array<FunctionNode> = [callback];
		for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
			const { helpers, variables } = getDirectWrites(next);
			for (const variable of variables) {
				if (!isDeclaredInside(variable, callback)) {
					found.add(variable);
				}
			}

			for (const helper of helpers) {
				if (!visited.has(helper)) {
					visited.add(helper);
					pending.push(helper);
				}
			}
		}
	}

	/**
	 * Resolves a test call argument to the function it runs: an inline
	 * function, or an identifier naming a local one.
	 *
	 * @param argument - The call argument.
	 * @returns The callback, or `null` when the argument is not a function.
	 */
	function getCallback(argument: TSESTree.CallExpressionArgument): FunctionNode | null {
		if (isFunctionNode(argument)) {
			return argument;
		}

		if (argument.type !== AST_NODE_TYPES.Identifier) {
			return null;
		}

		const variable = ASTUtils.findVariable(sourceCode.getScope(argument), argument);
		return variable === null ? null : getLocalFunction(variable);
	}

	return {
		"before": function (): void {
			({ sourceCode } = context);
			sources = getTestGlobalSources(context.settings);
			mutatingMethods = new Set([
				...MUTATING_METHODS,
				...(context.options[0]?.additionalMutatingMethods ?? []),
			]);
			callbacks.clear();
			directWritesCache.clear();
		},
		"CallExpression": function (node: TSESTree.CallExpression): void {
			// The inner call of `it.each(rows)(...)` takes data, not the test.
			if (node.parent.type === AST_NODE_TYPES.CallExpression && node.parent.callee === node) {
				return;
			}

			const root = getCalleeRootIdentifier(node.callee);
			if (
				root === null ||
				!TEST_CALLBACK_NAMES.has(resolveTestGlobalName(sourceCode, root, sources) ?? "")
			) {
				return;
			}

			for (const argument of node.arguments) {
				const callback = getCallback(argument);
				if (callback !== null) {
					callbacks.add(callback);
				}
			}
		},
		"Program:exit": function (): void {
			const found = new Set<Variable>();
			for (const callback of callbacks) {
				collectWrites(callback, found);
			}

			const reports = [...found]
				.map((variable) => ({ identifier: variable.identifiers[0], variable }))
				.filter(
					(entry): entry is { identifier: TSESTree.Identifier; variable: Variable } => {
						return entry.identifier !== undefined;
					},
				)
				.sort((a, b) => a.identifier.range[0] - b.identifier.range[0]);

			for (const { identifier, variable } of reports) {
				context.report({
					data: { name: variable.name },
					messageId: MESSAGE_ID,
					node: identifier,
				});
			}
		},
	};
}

export const noSharedTestState = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [{}],
	meta: {
		defaultOptions: [{}],
		docs: {
			description: "Disallow state declared outside tests and written inside them",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "problem",
	},
});
