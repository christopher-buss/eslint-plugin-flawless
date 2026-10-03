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
	 * The number of external value references at which a trivial function has
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
		"Trivial function '{{name}}' has {{count}} external reference(s); the minimum is {{minimum}}. Inline it or give the abstraction a broader role.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			minimumReferences: {
				description:
					"The number of external value references at which a trivial function is no longer reported.",
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
 * Whether an expression is a non-optional member chain rooted at a plain,
 * non-rest parameter.
 *
 * @param expression - The body expression.
 * @param parameters - The function's parameters, all already known plain.
 * @returns `true` for an access such as `user.profile.name`.
 */
function isParameterAccess(
	expression: TSESTree.Expression,
	parameters: Array<TSESTree.Parameter>,
): boolean {
	let current: TSESTree.Expression = expression;
	while (current.type === AST_NODE_TYPES.MemberExpression) {
		if (current.optional) {
			return false;
		}

		current = current.object;
	}

	if (current === expression || current.type !== AST_NODE_TYPES.Identifier) {
		return false;
	}

	const rootName = current.name;
	return parameters.some(
		(parameter) => parameter.type === AST_NODE_TYPES.Identifier && parameter.name === rootName,
	);
}

/**
 * Whether an expression is a non-optional call forwarding exactly the
 * function's parameters, in order, with a rest parameter spread back out.
 *
 * @param expression - The body expression.
 * @param parameters - The function's parameters, all already known plain.
 * @returns `true` for a call such as `format(value, ...rest)`.
 */
function isForwardingCall(
	expression: TSESTree.Expression,
	parameters: Array<TSESTree.Parameter>,
): boolean {
	if (
		expression.type !== AST_NODE_TYPES.CallExpression ||
		expression.optional ||
		expression.arguments.length !== parameters.length
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

	const { params } = node;
	if (params.some((parameter) => getPlainParameterName(parameter) === undefined)) {
		return false;
	}

	const expression = getSingleExpression(node);
	if (expression === undefined) {
		return false;
	}

	return isParameterAccess(expression, params) || isForwardingCall(expression, params);
}

/**
 * Collects the trivial top-level function declarations and function-valued
 * variable declarators of a declaration statement.
 *
 * @param statement - A top-level statement or exported declaration.
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
 * Records the local names an `export { ... }` or `export default` statement
 * exposes.
 *
 * @param statement - A top-level export statement.
 * @param exportedNames - The set receiving each exported local name.
 */
function collectExportedNames(
	statement: TSESTree.ExportDefaultDeclaration | TSESTree.ExportNamedDeclaration,
	exportedNames: Set<string>,
): void {
	if (statement.type === AST_NODE_TYPES.ExportDefaultDeclaration) {
		if (statement.declaration.type === AST_NODE_TYPES.Identifier) {
			exportedNames.add(statement.declaration.name);
		}

		return;
	}

	if (statement.source !== null || statement.exportKind === "type") {
		return;
	}

	for (const specifier of statement.specifiers) {
		if (specifier.exportKind !== "type") {
			exportedNames.add(specifier.local.name);
		}
	}
}

/**
 * Counts a candidate's value references outside its own declaration, stopping
 * once the count reaches `limit`.
 *
 * @param sourceCode - The file's source code.
 * @param candidate - The trivial function.
 * @param limit - The count at which counting can stop.
 * @returns The number of external value references, capped at `limit`.
 */
function countExternalReferences(
	sourceCode: Readonly<TSESLint.SourceCode>,
	candidate: Candidate,
	limit: number,
): number {
	const [start, end] = candidate.functionNode.range;
	let count = 0;

	for (const variable of sourceCode.getDeclaredVariables(candidate.declaration)) {
		if (variable.name !== candidate.name) {
			continue;
		}

		for (const reference of variable.references) {
			const { identifier, init, isValueReference } = reference;
			const position = identifier.range[0];
			if (
				init === true ||
				!isValueReference ||
				(position >= start && position < end) ||
				referenceContainsTypeQuery(identifier)
			) {
				continue;
			}

			count += 1;
			if (count >= limit) {
				return count;
			}
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
			const candidates: Array<Candidate> = [];
			const exportedNames = new Set<string>();

			for (const statement of program.body) {
				// `export function f` and `export const f` are never collected;
				// only names exported separately need recording.
				if (
					statement.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
					statement.type === AST_NODE_TYPES.ExportNamedDeclaration
				) {
					collectExportedNames(statement, exportedNames);
				} else if (
					statement.type === AST_NODE_TYPES.FunctionDeclaration ||
					statement.type === AST_NODE_TYPES.VariableDeclaration
				) {
					collectCandidates(statement, candidates);
				}
			}

			if (candidates.length === 0) {
				return;
			}

			const { sourceCode } = context;
			const { minimumReferences } = config;
			for (const candidate of candidates) {
				if (exportedNames.has(candidate.name)) {
					continue;
				}

				const count = countExternalReferences(sourceCode, candidate, minimumReferences);
				if (count >= minimumReferences) {
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
