/**
 * @file Helpers ported from ESLint core's `lib/rules/utils/ast-utils.js` and
 * `lib/shared/string-utils.js`, so this rule's diagnostics read and point
 * identically to core's `max-lines-per-function`. `@typescript-eslint/utils`
 * re-exports `@eslint-community/eslint-utils` equivalents
 * (`getFunctionNameWithKind`, `getFunctionHeadLocation`), but those diverge from
 * core — they name variable-bound functions (`const f = () => {}` →
 * `arrow function 'f'`) and bracket computed keys — so the port is what keeps
 * parity with core, not availability. ESLint is MIT licensed — Copyright OpenJS
 * Foundation and other contributors.
 */

import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";
import { isArrowToken, isOpeningParenToken } from "@typescript-eslint/utils/ast-utils";

/** The function nodes this rule measures. */
export type FunctionNode =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

/** The member kinds whose key supplies a function's reported name. */
type NamedMember = TSESTree.MethodDefinition | TSESTree.Property | TSESTree.PropertyDefinition;

/**
 * Describes a function by name and kind, as core does, so diagnostics read the
 * same. Examples: `function 'foo'`, `arrow function`, `constructor`,
 * `static async generator method 'foo'`, `private method #foo`.
 *
 * Core's `TSPropertySignature` / `TSMethodSignature` branches are omitted: this
 * rule only visits the three function node types, so a signature node can never
 * reach here.
 *
 * @param node - The function to describe.
 * @returns The space-joined description.
 */
export function getFunctionNameWithKind({
	id,
	async,
	generator,
	parent,
	type,
}: FunctionNode): string {
	const tokens: Array<string> = [];

	if (
		parent.type === AST_NODE_TYPES.MethodDefinition ||
		parent.type === AST_NODE_TYPES.PropertyDefinition
	) {
		// The static class features proposal puts `static` before visibility.
		if (parent.static) {
			tokens.push("static");
		}

		if (!parent.computed && parent.key.type === AST_NODE_TYPES.PrivateIdentifier) {
			tokens.push("private");
		}
	}

	if (async) {
		tokens.push("async");
	}

	if (generator) {
		tokens.push("generator");
	}

	// `Property` and `MethodDefinition` must be tested together: narrowing to
	// `Property` alone makes `kind === "constructor"` a no-overlap error, since
	// `Property["kind"]` is only `"get" | "init" | "set"`.
	if (
		parent.type === AST_NODE_TYPES.Property ||
		parent.type === AST_NODE_TYPES.MethodDefinition
	) {
		if (parent.kind === "constructor") {
			return "constructor";
		}

		if (parent.kind === "get") {
			tokens.push("getter");
		} else if (parent.kind === "set") {
			tokens.push("setter");
		} else {
			tokens.push("method");
		}
	} else if (parent.type === AST_NODE_TYPES.PropertyDefinition) {
		tokens.push("method");
	} else {
		if (type === AST_NODE_TYPES.ArrowFunctionExpression) {
			tokens.push("arrow");
		}

		tokens.push("function");
	}

	if (
		parent.type === AST_NODE_TYPES.Property ||
		parent.type === AST_NODE_TYPES.MethodDefinition ||
		parent.type === AST_NODE_TYPES.PropertyDefinition
	) {
		if (!parent.computed && parent.key.type === AST_NODE_TYPES.PrivateIdentifier) {
			tokens.push(`#${parent.key.name}`);
		} else {
			const name = getStaticPropertyName(parent);
			if (name !== null) {
				tokens.push(`'${name}'`);
			} else if (id !== null) {
				tokens.push(`'${id.name}'`);
			}
		}
	} else if (id !== null) {
		tokens.push(`'${id.name}'`);
	}

	return tokens.join(" ");
}

/**
 * Locates the head of a function — the part worth underlining in a diagnostic,
 * rather than the function's whole multi-line body. For example the
 * `function foo` of a declaration, or the `=>` of an arrow function.
 *
 * Core's `TSPropertySignature` / `TSMethodSignature` branches are omitted for
 * the same reason as in {@link getFunctionNameWithKind}: those nodes never
 * reach here.
 *
 * @param node - The function to locate.
 * @param sourceCode - The source code being linted.
 * @returns The location of the function's head.
 */
export function getFunctionHeadLoc(
	node: FunctionNode,
	sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.SourceLocation {
	const { body, loc, parent, type } = node;

	if (
		parent.type === AST_NODE_TYPES.Property ||
		parent.type === AST_NODE_TYPES.MethodDefinition ||
		parent.type === AST_NODE_TYPES.PropertyDefinition
	) {
		return {
			end: getOpeningParenOfParameters(node, sourceCode)?.loc.start ?? loc.end,
			start: parent.loc.start,
		};
	}

	if (type === AST_NODE_TYPES.ArrowFunctionExpression) {
		const arrowToken = sourceCode.getTokenBefore(body, isArrowToken);
		if (arrowToken !== null) {
			return { end: arrowToken.loc.end, start: arrowToken.loc.start };
		}
	}

	return {
		end: getOpeningParenOfParameters(node, sourceCode)?.loc.start ?? loc.end,
		start: loc.start,
	};
}

/**
 * Upper-cases the first character of a string.
 *
 * @param value - The string to convert.
 * @returns The converted string.
 */
export function upperCaseFirst(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * Reads the statically known string value of a property key.
 *
 * @param node - The key node.
 * @returns The value as a string, or `null` when it is not statically known.
 */
function getStaticStringValue(node: TSESTree.Node): null | string {
	if (node.type === AST_NODE_TYPES.Literal) {
		// `Literal` is a union whose members all share `type: "Literal"`, so it
		// cannot be narrowed further by type. Falling back to `raw` covers the
		// members whose `value` is null — the null literal, plus regexes and
		// bigints on engines that cannot construct them — and yields the same
		// text core produces for each.
		return node.value === null ? node.raw : String(node.value);
	}

	if (
		node.type === AST_NODE_TYPES.TemplateLiteral &&
		node.expressions.length === 0 &&
		node.quasis.length === 1
	) {
		return node.quasis[0]?.value.cooked ?? null;
	}

	return null;
}

/**
 * Reads the property name of a member definition.
 *
 * @param node - The member whose key to read.
 * @returns The property name, or `null` when the key is computed from a
 *   dynamic expression.
 */
function getStaticPropertyName(node: NamedMember): null | string {
	if (!node.computed && node.key.type === AST_NODE_TYPES.Identifier) {
		return node.key.name;
	}

	return getStaticStringValue(node.key);
}

/**
 * Finds the token opening a function's parameter list.
 *
 * @param node - The function whose parameters to locate.
 * @param sourceCode - The source code being linted.
 * @returns The opening paren, or — for an arrow function with a single
 *   parameter written without parentheses — that parameter's first token.
 *   `null` when neither can be found.
 */
function getOpeningParenOfParameters(
	node: FunctionNode,
	sourceCode: Readonly<TSESLint.SourceCode>,
): null | TSESTree.Token {
	const [firstParameter] = node.params;

	// An arrow function may write a lone parameter without parens, in which case
	// the parameter's own first token stands in for the opening paren.
	if (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression &&
		node.params.length === 1 &&
		firstParameter !== undefined
	) {
		const argumentToken = sourceCode.getFirstToken(firstParameter);
		if (argumentToken === null) {
			return null;
		}

		const maybeParenToken = sourceCode.getTokenBefore(argumentToken);

		return maybeParenToken !== null && isOpeningParenToken(maybeParenToken)
			? maybeParenToken
			: argumentToken;
	}

	return node.id === null
		? sourceCode.getFirstToken(node, isOpeningParenToken)
		: sourceCode.getTokenAfter(node.id, isOpeningParenToken);
}
