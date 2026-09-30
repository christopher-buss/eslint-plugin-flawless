import { DefinitionType, ScopeType } from "@typescript-eslint/scope-manager";
import {
	AST_NODE_TYPES,
	AST_TOKEN_TYPES,
	type TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import { getTestGlobalSources, resolveTestGlobalName } from "../../utils/test-globals";
import { unwrapAssertedExpression } from "../shared/dictionary-types";

export const RULE_NAME = "prefer-mock-throw";

const MESSAGE_ID = "preferMockThrow";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]:
		"This `{{method}}` implementation only throws. Pass the thrown value to `{{replacement}}` instead.",
};

/** The implementation setters this rule rewrites, and what they become. */
const REPLACEMENTS: ReadonlyMap<string, string> = new Map([
	["mockImplementation", "mockThrow"],
	["mockImplementationOnce", "mockThrowOnce"],
]);

/** Namespaces whose module mock factories are hoisted above the file. */
const HOISTING_NAMESPACES = new Set(["jest", "vi"]);

/** Members of {@link HOISTING_NAMESPACES} whose factory is hoisted. */
const HOISTED_METHODS = new Set(["hoisted", "mock"]);

/** Unary operators that are side-effect free on a literal operand. */
const LITERAL_UNARY_OPERATORS = new Set(["!", "+", "-", "typeof", "void", "~"]);

type Implementation = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

/**
 * Reads the static name of a member access property: `m.name`, `m["name"]`, or
 * `` m[`name`] ``.
 *
 * @param member - The member expression.
 * @returns The property name, or `null` when it is not static.
 */
function getStaticPropertyName({ computed, property }: TSESTree.MemberExpression): null | string {
	if (!computed) {
		return property.type === AST_NODE_TYPES.Identifier ? property.name : null;
	}

	if (property.type === AST_NODE_TYPES.Literal && typeof property.value === "string") {
		return property.value;
	}

	if (property.type === AST_NODE_TYPES.TemplateLiteral && property.expressions.length === 0) {
		return property.quasis[0]?.value.cooked ?? null;
	}

	return null;
}

/**
 * Extracts the value an implementation throws when its body is exactly one
 * `throw` statement and nothing else can run first: no `async` (it would
 * reject instead), no generator (it throws only once iterated), and no
 * parameter that evaluates something on the way in (a default, or a
 * destructuring pattern that throws on `undefined`).
 *
 * @param implementation - The function passed to `mockImplementation`.
 * @returns The thrown expression, or `null` when the function does more.
 */
function getThrownExpression(implementation: Implementation): null | TSESTree.Expression {
	if (implementation.async || implementation.generator) {
		return null;
	}

	const { body, params } = implementation;
	const isPlainParameter = params.every((parameter) => {
		return (
			parameter.type === AST_NODE_TYPES.Identifier ||
			(parameter.type === AST_NODE_TYPES.RestElement &&
				parameter.argument.type === AST_NODE_TYPES.Identifier)
		);
	});
	if (!isPlainParameter || body.type !== AST_NODE_TYPES.BlockStatement) {
		return null;
	}

	const [statement, ...rest] = body.body;
	if (statement?.type !== AST_NODE_TYPES.ThrowStatement || rest.length > 0) {
		return null;
	}

	return statement.argument;
}

/**
 * Finds the leading whitespace of the line a node starts on.
 *
 * @param sourceCode - Provides the lines of the file.
 * @param line - The one-based line number.
 * @returns The indentation of that line.
 */
function getIndentation(sourceCode: Readonly<TSESLint.SourceCode>, line: number): string {
	return /^\s*/.exec(sourceCode.lines[line - 1] ?? "")?.[0] ?? "";
}

/**
 * Prefers `mockThrow(value)` / `mockThrowOnce(value)` over a
 * `mockImplementation` / `mockImplementationOnce` whose implementation only
 * throws. `mockThrow` evaluates its argument once, when the mock is set up,
 * whereas the implementation evaluates it on every call; the rule therefore
 * only reports a thrown value whose eager evaluation cannot be told apart:
 * literals, stable bindings initialized before the call, and object, array, and
 * `new` expressions built from them.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let sourceCode: Readonly<TSESLint.SourceCode>;
	let sources: ReadonlySet<string>;

	/**
	 * Finds the hoisted `vi.mock()` / `vi.hoisted()` factory a node sits in. The
	 * factory runs before the rest of the module, so any outer binding it reads
	 * eagerly is still in its temporal dead zone.
	 *
	 * @param node - The node to start from.
	 * @returns The enclosing hoisted factory, or `null` when there is none.
	 */
	function getHoistedFactory(node: TSESTree.Node): null | TSESTree.Node {
		let current = node;
		while (current.type !== AST_NODE_TYPES.Program) {
			const { parent } = current;
			if (
				(current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
					current.type === AST_NODE_TYPES.FunctionExpression) &&
				parent.type === AST_NODE_TYPES.CallExpression &&
				parent.arguments.includes(current) &&
				parent.callee.type === AST_NODE_TYPES.MemberExpression &&
				parent.callee.object.type === AST_NODE_TYPES.Identifier &&
				HOISTED_METHODS.has(getStaticPropertyName(parent.callee) ?? "") &&
				HOISTING_NAMESPACES.has(
					resolveTestGlobalName(sourceCode, parent.callee.object, sources) ?? "",
				)
			) {
				return current;
			}

			current = parent;
		}

		return null;
	}

	/**
	 * Determines whether a binding is initialized before the call and stays
	 * initialized: its declaration ends before the call in source order, no
	 * hoisted function declaration lets the call run earlier than that, and it
	 * does not live in a `switch` whose `case` may skip the declaration.
	 *
	 * @param variable - The binding.
	 * @param declaration - The node that initializes the binding.
	 * @param call - The `mockImplementation` call.
	 * @returns `true` when the binding is initialized whenever the call runs.
	 */
	function isInitializedBefore(
		variable: TSESLint.Scope.Variable,
		declaration: TSESTree.Node,
		call: TSESTree.CallExpression,
	): boolean {
		if (declaration.range[1] > call.range[0] || variable.scope.type === ScopeType.switch) {
			return false;
		}

		const scopeBlock = variable.scope.block;
		let current: TSESTree.Node = call;
		while (current !== scopeBlock && current.type !== AST_NODE_TYPES.Program) {
			if (current.type === AST_NODE_TYPES.FunctionDeclaration) {
				return false;
			}

			current = current.parent;
		}

		return true;
	}

	/**
	 * Determines whether an identifier reads a binding whose value is the same
	 * when evaluated at setup as on any later call.
	 *
	 * @param identifier - The identifier in the thrown expression.
	 * @param implementation - The implementation the identifier sits in.
	 * @param call - The `mockImplementation` call.
	 * @returns `true` when reading the identifier eagerly is safe.
	 */
	function isStableIdentifier(
		identifier: TSESTree.Identifier,
		implementation: Implementation,
		call: TSESTree.CallExpression,
	): boolean {
		const variable = findVariable(sourceCode.getScope(identifier), identifier);
		if (variable === null) {
			// An unresolved global, unless something in this file assigns it.
			return !sourceCode
				.getScope(sourceCode.ast)
				.through.some(
					(reference) =>
						reference.identifier.name === identifier.name && reference.isWrite(),
				);
		}

		const isReassigned = variable.references.some((reference) => {
			return reference.isWrite() && reference.init !== true;
		});
		if (isReassigned || variable.scope.block === implementation) {
			// Written after its declaration, or the implementation's own
			// parameter or `arguments`.
			return false;
		}

		const [definition, ...redeclarations] = variable.defs;
		if (definition === undefined) {
			// Only a global has no definition; an outer function's `arguments`
			// is live and so not stable.
			return variable.scope.type === ScopeType.global;
		}

		if (redeclarations.length > 0) {
			return false;
		}

		const hoistedFactory = getHoistedFactory(call);
		if (
			hoistedFactory !== null &&
			(variable.scope.block.range[0] < hoistedFactory.range[0] ||
				variable.scope.block.range[1] > hoistedFactory.range[1])
		) {
			return false;
		}

		// eslint-disable-next-line ts/switch-exhaustiveness-check -- We have a default case
		switch (definition.type) {
			case DefinitionType.CatchClause:
			case DefinitionType.FunctionName:
			case DefinitionType.ImportBinding:
			case DefinitionType.Parameter: {
				return true;
			}
			case DefinitionType.ClassName: {
				return isInitializedBefore(variable, definition.node, call);
			}
			case DefinitionType.Variable: {
				return (
					definition.parent.kind === "const" &&
					isInitializedBefore(variable, definition.node, call)
				);
			}
			default: {
				return false;
			}
		}
	}

	/**
	 * Determines whether evaluating an expression once at setup is
	 * indistinguishable from evaluating it on every call: it has no side
	 * effects and reads nothing that can change in between. Anything outside
	 * this allow-list — calls, member accesses (a getter, or a mutated
	 * container), `this`, `new.target`, updates, assignments, `await`,
	 * functions — is rejected.
	 *
	 * @param node - The expression to inspect.
	 * @param implementation - The implementation the expression sits in.
	 * @param call - The `mockImplementation` call.
	 * @returns `true` when the expression is safe to evaluate eagerly.
	 */
	function isStableExpression(
		node: TSESTree.Node,
		implementation: Implementation,
		call: TSESTree.CallExpression,
	): boolean {
		function isStable(child: null | TSESTree.Node): boolean {
			return child !== null && isStableExpression(child, implementation, call);
		}

		const expression = unwrapAssertedExpression(node as TSESTree.Expression);
		// eslint-disable-next-line ts/switch-exhaustiveness-check -- Anything off the allow-list is unstable
		switch (expression.type) {
			case AST_NODE_TYPES.ArrayExpression: {
				// A hole is fine; a spread would iterate eagerly.
				return expression.elements.every((element) => {
					return (
						element === null ||
						(element.type !== AST_NODE_TYPES.SpreadElement && isStable(element))
					);
				});
			}
			case AST_NODE_TYPES.Identifier: {
				return isStableIdentifier(expression, implementation, call);
			}
			case AST_NODE_TYPES.Literal: {
				return true;
			}
			case AST_NODE_TYPES.NewExpression: {
				return (
					expression.callee.type === AST_NODE_TYPES.Identifier &&
					isStable(expression.callee) &&
					expression.arguments.every((argument) => {
						return argument.type !== AST_NODE_TYPES.SpreadElement && isStable(argument);
					})
				);
			}
			case AST_NODE_TYPES.ObjectExpression: {
				return expression.properties.every((property) => {
					return (
						property.type === AST_NODE_TYPES.Property &&
						property.kind === "init" &&
						!property.method &&
						(!property.computed || isStable(property.key)) &&
						isStable(property.value)
					);
				});
			}
			case AST_NODE_TYPES.SequenceExpression: {
				return expression.expressions.every(isStable);
			}
			case AST_NODE_TYPES.TemplateLiteral: {
				return expression.expressions.every(isStable);
			}
			case AST_NODE_TYPES.UnaryExpression: {
				return (
					LITERAL_UNARY_OPERATORS.has(expression.operator) &&
					expression.argument.type === AST_NODE_TYPES.Literal
				);
			}
			default: {
				return false;
			}
		}
	}

	/**
	 * Builds the argument text for `mockThrow`, carrying over every comment in
	 * the implementation that sits outside the thrown expression. A sequence
	 * expression is the only allowed value below assignment precedence, so it
	 * alone needs parentheses to stay one argument.
	 *
	 * @param implementation - The implementation being replaced.
	 * @param thrown - The thrown expression.
	 * @returns The replacement text for the implementation.
	 */
	function buildArgumentText(
		implementation: Implementation,
		thrown: TSESTree.Expression,
	): string {
		const thrownText = sourceCode.getText(thrown);
		const value =
			thrown.type === AST_NODE_TYPES.SequenceExpression ? `(${thrownText})` : thrownText;

		const comments = sourceCode.getCommentsInside(implementation).filter((comment) => {
			return comment.range[1] <= thrown.range[0] || comment.range[0] >= thrown.range[1];
		});
		if (comments.length === 0) {
			return value;
		}

		const texts = comments.map((comment) => sourceCode.getText(comment));
		if (comments.every((comment) => comment.type === AST_TOKEN_TYPES.Block)) {
			return `${texts.join(" ")} ${value}`;
		}

		// A line comment ends its line, so lay the argument out on its own lines
		// at the depth the thrown value already had.
		const indentation = getIndentation(sourceCode, thrown.loc.start.line);
		const closing = getIndentation(sourceCode, implementation.loc.end.line);
		const lines = [...texts, value].map((text) => `${indentation}${text}`);
		return `\n${lines.join("\n")}\n${closing}`;
	}

	return {
		before(): void {
			({ sourceCode } = context);
			sources = getTestGlobalSources(context.settings);
		},
		CallExpression(node: TSESTree.CallExpression): void {
			const { arguments: callArguments, callee } = node;
			if (callee.type !== AST_NODE_TYPES.MemberExpression || callArguments.length !== 1) {
				return;
			}

			const method = getStaticPropertyName(callee);
			const replacement = REPLACEMENTS.get(method ?? "");
			const [implementation] = callArguments;
			if (
				method === null ||
				replacement === undefined ||
				(implementation?.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
					implementation?.type !== AST_NODE_TYPES.FunctionExpression)
			) {
				return;
			}

			const thrown = getThrownExpression(implementation);
			if (thrown === null) {
				return;
			}

			// A parameter the thrown value reads is per-call input; an unread one
			// is harmless.
			const readsParameter = sourceCode
				.getDeclaredVariables(implementation)
				.some((variable) => variable.references.length > 0);
			if (readsParameter || !isStableExpression(thrown, implementation, node)) {
				return;
			}

			const { property } = callee;
			context.report({
				data: { method, replacement },
				fix: (fixer) => {
					return [
						fixer.replaceText(
							property,
							sourceCode.getText(property).replace(method, replacement),
						),
						fixer.replaceText(
							implementation,
							buildArgumentText(implementation, thrown),
						),
					];
				},
				messageId: MESSAGE_ID,
				node: property,
			});
		},
	};
}

export const preferMockThrow = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Prefer `mockThrow` / `mockThrowOnce` over a mock implementation that only throws",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
