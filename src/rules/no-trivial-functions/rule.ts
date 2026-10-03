import { ScopeType } from "@typescript-eslint/scope-manager";
import type { JSONSchema, TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import { referenceContainsTypeQuery } from "../../utils/reference-contains-type-query";

export const RULE_NAME = "no-trivial-functions";

const MESSAGE_ID = "trivial";

export type MessageIds = typeof MESSAGE_ID;

export interface NoTrivialFunctionsOptions {
	/**
	 * The number of external calls at which a trivial function has
	 * earned its name and is no longer reported.
	 */
	readonly minimumReferences?: number;
}

export type Options = [NoTrivialFunctionsOptions?];

type Config = Required<NoTrivialFunctionsOptions>;

type FunctionNode =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

/** A top-level, non-exported function together with the node that names it. */
interface Candidate {
	readonly name: string;
	readonly declaration: TSESTree.FunctionDeclaration | TSESTree.VariableDeclarator;
	readonly functionNode: FunctionNode;
}

const DEFAULTS: Config = {
	minimumReferences: 5,
};

const messages = {
	[MESSAGE_ID]:
		"Trivial function '{{name}}' has {{count}} external call(s); the minimum is {{minimum}}. Inline it or give the abstraction a broader role.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			minimumReferences: {
				description:
					"The number of external calls at which a trivial function is no longer reported.",
				minimum: 1,
				type: "integer",
			},
		},
		type: "object",
	},
];

/**
 * Gets the single expression a function body evaluates: a concise arrow body,
 * or the lone `return` argument or expression statement of a block body.
 *
 * @param node - The function to inspect.
 * @returns The expression, or `undefined` when the body is anything else.
 */
function getSingleExpression({ body }: FunctionNode): TSESTree.Expression | undefined {
	if (body.type !== AST_NODE_TYPES.BlockStatement) {
		return body;
	}

	if (body.body.length !== 1) {
		return undefined;
	}

	const [statement] = body.body;
	if (statement?.type === AST_NODE_TYPES.ReturnStatement) {
		return statement.argument ?? undefined;
	}

	if (statement?.type === AST_NODE_TYPES.ExpressionStatement) {
		return statement.expression;
	}

	return undefined;
}

/**
 * Gets the name a parameter binds, provided it is a plain identifier or an
 * identifier rest element.
 *
 * @param parameter - The parameter to inspect.
 * @returns The bound name, or `undefined` for destructured, defaulted, or
 *   parameter-property forms.
 */
function getPlainParameterName(parameter: TSESTree.Parameter): string | undefined {
	if (parameter.type === AST_NODE_TYPES.Identifier) {
		return parameter.name;
	}

	if (
		parameter.type === AST_NODE_TYPES.RestElement &&
		parameter.argument.type === AST_NODE_TYPES.Identifier
	) {
		return parameter.argument.name;
	}

	return undefined;
}

/**
 * Whether a parameter is TypeScript's `this` parameter, which declares the
 * receiver type and is not part of the call's arity.
 *
 * @param parameter - The parameter to inspect.
 * @returns `true` for `this: Foo`.
 */
function isThisParameter(parameter: TSESTree.Parameter): boolean {
	return parameter.type === AST_NODE_TYPES.Identifier && parameter.name === "this";
}

/**
 * Whether a name is bound by a plain, non-rest parameter.
 *
 * @param name - The name to look up.
 * @param parameters - The function's forwarded parameters.
 * @returns `true` when a non-rest parameter binds `name`.
 */
function isPlainParameter(name: string, parameters: Array<TSESTree.Parameter>): boolean {
	return parameters.some(
		(parameter) => parameter.type === AST_NODE_TYPES.Identifier && parameter.name === name,
	);
}

/**
 * Whether an expression is a member chain rooted at a plain, non-rest
 * parameter. A computed key must be a literal or a parameter, so the access
 * stays side-effect free. Optional chains are wrapped in a `ChainExpression`
 * and so never match.
 *
 * @param expression - The body expression.
 * @param parameters - The function's forwarded parameters.
 * @returns `true` for an access such as `user.profile.name` or `list[index]`.
 */
function isParameterAccess(
	expression: TSESTree.Expression,
	parameters: Array<TSESTree.Parameter>,
): boolean {
	let current: TSESTree.Expression = expression;
	while (current.type === AST_NODE_TYPES.MemberExpression) {
		const { computed, object, property } = current;
		if (
			computed &&
			property.type !== AST_NODE_TYPES.Literal &&
			(property.type !== AST_NODE_TYPES.Identifier ||
				!isPlainParameter(property.name, parameters))
		) {
			return false;
		}

		current = object;
	}

	return (
		current !== expression &&
		current.type === AST_NODE_TYPES.Identifier &&
		isPlainParameter(current.name, parameters)
	);
}

/**
 * Whether a callee is a plain name or a non-computed member chain rooted at
 * one, so evaluating it has no side effect and no dynamic receiver.
 *
 * @param callee - The callee to inspect.
 * @returns `true` for `format` or `utils.text.format`.
 */
function isStaticCallee(callee: TSESTree.Expression): boolean {
	let current = callee;
	while (current.type === AST_NODE_TYPES.MemberExpression) {
		if (current.computed) {
			return false;
		}

		current = current.object;
	}

	return current.type === AST_NODE_TYPES.Identifier;
}

/**
 * Whether an expression is a call with a static callee forwarding exactly the
 * function's parameters, in order, with a rest parameter spread back out.
 * Optional calls are wrapped in a `ChainExpression` and so never match.
 *
 * @param expression - The body expression.
 * @param parameters - The function's forwarded parameters.
 * @returns `true` for a call such as `format(value, ...rest)`.
 */
function isForwardingCall(
	expression: TSESTree.Expression,
	parameters: Array<TSESTree.Parameter>,
): boolean {
	if (
		expression.type !== AST_NODE_TYPES.CallExpression ||
		expression.arguments.length !== parameters.length ||
		!isStaticCallee(expression.callee)
	) {
		return false;
	}

	return expression.arguments.every((argument, index) => {
		const parameter = parameters[index];
		if (parameter?.type === AST_NODE_TYPES.RestElement) {
			return (
				argument.type === AST_NODE_TYPES.SpreadElement &&
				argument.argument.type === AST_NODE_TYPES.Identifier &&
				argument.argument.name === getPlainParameterName(parameter)
			);
		}

		return (
			parameter?.type === AST_NODE_TYPES.Identifier &&
			argument.type === AST_NODE_TYPES.Identifier &&
			argument.name === parameter.name
		);
	});
}

/**
 * Whether a function only reads a parameter's property or forwards its
 * parameters to another call.
 *
 * @param node - The function to inspect.
 * @returns `true` when the function is trivial.
 */
function isTrivialFunction(node: FunctionNode): boolean {
	if (node.async || node.generator) {
		return false;
	}

	const parameters = node.params.filter((parameter) => !isThisParameter(parameter));
	if (parameters.some((parameter) => getPlainParameterName(parameter) === undefined)) {
		return false;
	}

	const expression = getSingleExpression(node);
	if (expression === undefined) {
		return false;
	}

	return isParameterAccess(expression, parameters) || isForwardingCall(expression, parameters);
}

/**
 * Collects the trivial top-level function declarations and function-valued
 * variable declarators of a declaration statement.
 *
 * @param statement - A top-level, non-exported declaration statement.
 * @param candidates - The list receiving each trivial function.
 */
function collectCandidates(
	statement: TSESTree.FunctionDeclaration | TSESTree.VariableDeclaration,
	candidates: Array<Candidate>,
): void {
	if (statement.type === AST_NODE_TYPES.FunctionDeclaration) {
		if (statement.id !== null && isTrivialFunction(statement)) {
			candidates.push({
				name: statement.id.name,
				declaration: statement,
				functionNode: statement,
			});
		}

		return;
	}

	for (const declarator of statement.declarations) {
		const { id, init } = declarator;
		if (
			id.type === AST_NODE_TYPES.Identifier &&
			(init?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
				init?.type === AST_NODE_TYPES.FunctionExpression) &&
			isTrivialFunction(init)
		) {
			candidates.push({ name: id.name, declaration: declarator, functionNode: init });
		}
	}
}

/**
 * Whether an assignment target is `module.exports`, `exports.x`, or a property
 * chain on either.
 *
 * @param target - The assignment's left-hand side.
 * @returns `true` for `module.exports`, `module.exports.x`, or `exports.x`.
 */
function isCommonJsExportTarget(target: TSESTree.Expression): boolean {
	let current = target;
	while (current.type === AST_NODE_TYPES.MemberExpression) {
		const { object, property } = current;
		if (
			object.type === AST_NODE_TYPES.Identifier &&
			object.name === "module" &&
			property.type === AST_NODE_TYPES.Identifier &&
			property.name === "exports"
		) {
			return true;
		}

		current = object;
	}

	return (
		current !== target &&
		current.type === AST_NODE_TYPES.Identifier &&
		current.name === "exports"
	);
}

/**
 * Whether a top-level statement exposes values to other modules: an ESM
 * export, `export =`, or a CommonJS export assignment.
 *
 * @param statement - A direct child of the program.
 * @returns `true` when a reference inside it makes a name public.
 */
function isExportStatement(statement: TSESTree.Node): boolean {
	if (
		statement.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
		statement.type === AST_NODE_TYPES.TSExportAssignment
	) {
		return true;
	}

	if (statement.type === AST_NODE_TYPES.ExportNamedDeclaration) {
		return statement.exportKind !== "type";
	}

	return (
		statement.type === AST_NODE_TYPES.ExpressionStatement &&
		statement.expression.type === AST_NODE_TYPES.AssignmentExpression &&
		isCommonJsExportTarget(statement.expression.left)
	);
}

/**
 * Gets the program-level statement enclosing a node.
 *
 * @param node - A node inside the program.
 * @returns The ancestor whose parent is the program.
 */
function getTopLevelStatement(node: TSESTree.Node): TSESTree.Node {
	let current = node;
	while (current.parent !== undefined && current.parent.type !== AST_NODE_TYPES.Program) {
		current = current.parent;
	}

	return current;
}

/**
 * Whether an identifier is the callee of a call or `new`, looking through
 * `as`, `!`, and angle-bracket assertions.
 *
 * @param identifier - The referencing identifier.
 * @returns `true` for `fn(x)`, `(fn as F)(x)`, or `fn!(x)`.
 */
function isDirectCallee(identifier: TSESTree.Node): boolean {
	let current = identifier;
	let { parent } = identifier;
	while (
		parent?.type === AST_NODE_TYPES.TSAsExpression ||
		parent?.type === AST_NODE_TYPES.TSNonNullExpression ||
		parent?.type === AST_NODE_TYPES.TSTypeAssertion
	) {
		current = parent;
		({ parent } = parent);
	}

	return (
		(parent?.type === AST_NODE_TYPES.CallExpression ||
			parent?.type === AST_NODE_TYPES.NewExpression) &&
		parent.callee === current
	);
}

/**
 * Counts a candidate's external calls, stopping once the count reaches
 * `limit`. Returns `undefined` when inlining cannot be proven safe: the
 * function is exported, reassigned, or used other than as a callee.
 *
 * @param variable - The candidate's binding.
 * @param candidate - The trivial function.
 * @param limit - The count at which counting can stop.
 * @returns The number of external calls capped at `limit`, or `undefined`.
 */
function countExternalCalls(
	variable: TSESLint.Scope.Variable,
	candidate: Candidate,
	limit: number,
): number | undefined {
	const [start, end] = candidate.functionNode.range;
	let count = 0;

	for (const reference of variable.references) {
		if (reference.init === true) {
			continue;
		}

		if (reference.isWrite()) {
			return undefined;
		}

		const { identifier, isValueReference } = reference;
		const position = identifier.range[0];
		if (
			!isValueReference ||
			(position >= start && position < end) ||
			referenceContainsTypeQuery(identifier)
		) {
			continue;
		}

		if (isExportStatement(getTopLevelStatement(identifier)) || !isDirectCallee(identifier)) {
			return undefined;
		}

		count += 1;
		if (count >= limit) {
			return count;
		}
	}

	return count;
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let config: Config;

	return {
		before(): void {
			const options = context.options[0];
			config = {
				minimumReferences: options?.minimumReferences ?? DEFAULTS.minimumReferences,
			};
		},
		Program(program: TSESTree.Program): void {
			// In a script, top-level declarations are globals other files may
			// use.
			if (program.sourceType !== "module") {
				return;
			}

			const candidates: Array<Candidate> = [];
			for (const statement of program.body) {
				// `export function f` and `export const f` are never collected.
				if (
					statement.type === AST_NODE_TYPES.FunctionDeclaration ||
					statement.type === AST_NODE_TYPES.VariableDeclaration
				) {
					collectCandidates(statement, candidates);
				}
			}

			if (candidates.length === 0) {
				return;
			}

			// `getScope(program)` is the global scope; module bindings live in
			// its module child.
			const globalScope = context.sourceCode.getScope(program);
			const moduleScope = globalScope.childScopes.find(
				(scope) => scope.type === ScopeType.module,
			);
			if (moduleScope === undefined) {
				return;
			}

			const { set } = moduleScope;
			const { minimumReferences } = config;
			for (const candidate of candidates) {
				const variable = set.get(candidate.name);
				if (variable === undefined) {
					continue;
				}

				const count = countExternalCalls(variable, candidate, minimumReferences);
				if (count === undefined || count >= minimumReferences) {
					continue;
				}

				context.report({
					data: { name: candidate.name, count, minimum: minimumReferences },
					messageId: MESSAGE_ID,
					node: candidate.declaration,
				});
			}
		},
	};
}

export const noTrivialFunctions = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [DEFAULTS],
	meta: {
		defaultOptions: [DEFAULTS],
		docs: {
			description:
				"Disallow rarely used top-level functions that only forward their parameters or read a parameter's property",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "suggestion",
	},
});
