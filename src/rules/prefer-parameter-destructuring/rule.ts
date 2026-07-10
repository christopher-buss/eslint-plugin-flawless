import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { createEslintRule } from "../../util";

export const RULE_NAME = "prefer-parameter-destructuring";

const MESSAGE_ID = "default";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]: "Destructure parameter '{{name}}' in the function signature instead of the body.",
};

type Context = Readonly<TSESLint.RuleContext<MessageIds, Options>>;

type FunctionLike =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

/**
 * A body destructuring statement of a parameter: the declarator, its object
 * pattern, and the `const`/`let`/`var` declaration hosting it.
 */
interface Destructure {
	readonly declaration: TSESTree.VariableDeclaration;
	readonly declarator: TSESTree.VariableDeclarator;
	readonly pattern: TSESTree.ObjectPattern;
}

/** Everything needed to rewrite the parameter and delete the body statements. */
interface FixPlan {
	readonly parameterRange: TSESTree.Range;
	readonly parameterText: string;
	readonly removalRanges: Array<TSESTree.Range>;
}

/** The inputs shared by the fix-planning helpers. */
interface RewriteQuery {
	readonly body: TSESTree.BlockStatement;
	readonly identifier: TSESTree.Identifier;
	readonly node: FunctionLike;
	readonly otherParameterNames: ReadonlySet<string>;
	readonly scope: TSESLint.Scope.Scope;
	readonly sourceCode: Readonly<TSESLint.SourceCode>;
	readonly statements: Array<Destructure>;
}

/**
 * Collects the binding names introduced by a pattern (or parameter), including
 * names nested in object/array patterns, defaults, and rest elements.
 *
 * @param node - The pattern node to walk.
 * @param out - Receives every bound name, in source order.
 */
function collectBoundNames(node: TSESTree.Node, out: Array<string>): void {
	// eslint-disable-next-line ts/switch-exhaustiveness-check -- We have a default case
	switch (node.type) {
		case AST_NODE_TYPES.ArrayPattern: {
			for (const element of node.elements) {
				if (element !== null) {
					collectBoundNames(element, out);
				}
			}

			break;
		}
		case AST_NODE_TYPES.AssignmentPattern: {
			collectBoundNames(node.left, out);

			break;
		}
		case AST_NODE_TYPES.Identifier: {
			out.push(node.name);

			break;
		}
		case AST_NODE_TYPES.ObjectPattern: {
			for (const property of node.properties) {
				collectBoundNames(property, out);
			}

			break;
		}
		case AST_NODE_TYPES.Property: {
			collectBoundNames(node.value, out);

			break;
		}
		case AST_NODE_TYPES.RestElement: {
			collectBoundNames(node.argument, out);

			break;
		}
		case AST_NODE_TYPES.TSParameterProperty: {
			collectBoundNames(node.parameter, out);

			break;
		}
		default: {
			break;
		}
	}
}

/**
 * Collects every top-level-body object destructuring of the parameter, or
 * bails when the parameter has any other reference (member access, call
 * argument, reassignment, a destructure inside a nested block or closure, …) —
 * those mean the parameter is genuinely used and must stay.
 *
 * @param variable - The parameter's resolved scope variable.
 * @param identifier - The parameter identifier (its default-value write
 *   reference is not a use).
 * @param body - The function body; only its direct child declarations qualify.
 * @returns The qualifying destructuring statements in source order, or `null`
 *   when the parameter has a non-destructuring reference.
 */
function collectDestructureStatements(
	variable: TSESLint.Scope.Variable,
	identifier: TSESTree.Identifier,
	body: TSESTree.BlockStatement,
): Array<Destructure> | null {
	const statements: Array<Destructure> = [];
	for (const reference of variable.references) {
		const referenceIdentifier = reference.identifier;
		if (referenceIdentifier === identifier) {
			continue;
		}

		const { parent } = referenceIdentifier;
		if (
			parent.type === AST_NODE_TYPES.VariableDeclarator &&
			parent.init === referenceIdentifier &&
			parent.id.type === AST_NODE_TYPES.ObjectPattern &&
			parent.parent.parent === body
		) {
			statements.push({ declaration: parent.parent, declarator: parent, pattern: parent.id });
		} else {
			return null;
		}
	}

	statements.sort((left, right) => left.declarator.range[0] - right.declarator.range[0]);
	return statements;
}

/**
 * Collects the binding names of every parameter other than the target one, so
 * the fix can avoid creating a duplicate parameter name (a SyntaxError in a
 * non-simple parameter list).
 *
 * @param node - The function whose parameters are inspected.
 * @param parameter - The parameter being rewritten (excluded).
 * @returns The other parameters' bound names.
 */
function collectOtherParameterNames(
	node: FunctionLike,
	parameter: TSESTree.Parameter,
): Set<string> {
	const names: Array<string> = [];
	for (const other of node.params) {
		if (other !== parameter) {
			collectBoundNames(other, names);
		}
	}

	return new Set(names);
}

/**
 * A structural check for AST nodes reached through visitor keys.
 *
 * @param value - The child value to test.
 * @returns `true` when the value is an AST node.
 */
function isNodeLike(value: unknown): value is TSESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string"
	);
}

/**
 * Checks whether a pattern subtree contains `await` or `yield` (in a computed
 * key or default value). Parameter initializers may not contain either, so no
 * signature form exists and the destructuring is not reported.
 *
 * @param root - The pattern to walk.
 * @param visitorKeys - The parser's visitor keys, used to walk without
 *   following `parent` links.
 * @returns `true` if `await`/`yield` appears anywhere in the pattern.
 */
function containsAwaitOrYield(
	root: TSESTree.Node,
	visitorKeys: TSESLint.SourceCode.VisitorKeys,
): boolean {
	const stack: Array<TSESTree.Node> = [root];
	for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
		if (
			current.type === AST_NODE_TYPES.AwaitExpression ||
			current.type === AST_NODE_TYPES.YieldExpression
		) {
			return true;
		}

		for (const key of visitorKeys[current.type] ?? []) {
			const child = (current as unknown as Record<string, unknown>)[key];
			const children = Array.isArray(child) ? child : [child];
			for (const item of children) {
				if (isNodeLike(item)) {
					stack.push(item);
				}
			}
		}
	}

	return false;
}

/**
 * Extracts the identifier a parameter binds, unwrapping a default value
 * (`obj = {}`); patterns, rest parameters, and TS parameter properties yield
 * `null`.
 *
 * @param parameter - The parameter node.
 * @returns The parameter's identifier, or `null` when it is not a plain one.
 */
function getParameterIdentifier(parameter: TSESTree.Parameter): null | TSESTree.Identifier {
	if (parameter.type === AST_NODE_TYPES.Identifier) {
		return parameter;
	}

	if (
		parameter.type === AST_NODE_TYPES.AssignmentPattern &&
		parameter.left.type === AST_NODE_TYPES.Identifier
	) {
		return parameter.left;
	}

	return null;
}

/**
 * Determines whether any expression inside the patterns (computed keys,
 * default values, moved type annotations) references a binding that would be
 * out of scope — or in its temporal dead zone — at the parameter position:
 * anything declared in the function body, a parameter at or after the target,
 * or this function's own `arguments`.
 *
 * @param query - The rewrite being planned.
 * @param patterns - The object patterns being moved.
 * @returns `true` when moving the patterns would break a reference.
 */
function hasUnsafePatternReferences(
	{ body, identifier, node, scope }: RewriteQuery,
	patterns: Array<TSESTree.ObjectPattern>,
): boolean {
	function inPattern(range: TSESTree.Range): boolean {
		return patterns.some(
			(pattern) => range[0] >= pattern.range[0] && range[1] <= pattern.range[1],
		);
	}

	const stack: Array<TSESLint.Scope.Scope> = [scope];
	for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
		stack.push(...current.childScopes);
		for (const reference of current.references) {
			if (!inPattern(reference.identifier.range)) {
				continue;
			}

			const { resolved } = reference;
			if (resolved === null) {
				// Unresolved references are globals, unaffected by the move.
				continue;
			}

			if (resolved.defs.length === 0) {
				// An implicit binding (`arguments`): unsafe when it belongs to
				// this function; an outer function's `arguments` (or a configured
				// global, whose scope block is the Program) is unaffected.
				const blockRange = resolved.scope.block.range;
				if (blockRange[0] >= node.range[0] && blockRange[1] <= node.range[1]) {
					return true;
				}

				continue;
			}

			const unsafe = resolved.defs.some((definition) => {
				const { range } = definition.name;
				if (inPattern(range)) {
					// The pattern's own bindings move along with it.
					return false;
				}

				if (range[1] <= node.range[0] || range[0] >= node.range[1]) {
					// Declared outside the function — still in scope at the
					// parameter.
					return false;
				}

				if (range[0] >= body.range[0]) {
					// Declared in the body — out of scope at the parameter.
					return true;
				}

				// A parameter: safe only when declared before the target
				// parameter, otherwise it is uninitialized when the pattern
				// evaluates.
				return range[0] >= identifier.range[0];
			});
			if (unsafe) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Checks whether a function body opens with a `"use strict"` directive. A
 * destructured parameter makes the parameter list non-simple, and a function
 * with a non-simple parameter list may not contain a `"use strict"` directive,
 * so such functions are skipped entirely.
 *
 * @param body - The function body.
 * @returns `true` if the body has a `"use strict"` directive.
 */
function hasUseStrictDirective(body: TSESTree.BlockStatement): boolean {
	for (const statement of body.body) {
		if (
			statement.type !== AST_NODE_TYPES.ExpressionStatement ||
			typeof statement.directive !== "string"
		) {
			break;
		}

		if (statement.directive === "use strict") {
			return true;
		}
	}

	return false;
}

/**
 * Computes the removal range for a declaration, swallowing the whole line
 * (indentation and trailing newline) when the declaration is alone on it.
 *
 * @param sourceCode - Provides the raw text around the declaration.
 * @param statement - The declaration to remove.
 * @returns The range to delete.
 */
function statementRemovalRange(
	{ text }: Readonly<TSESLint.SourceCode>,
	statement: TSESTree.VariableDeclaration,
): TSESTree.Range {
	const [start, end] = statement.range;
	const lineStart = text.lastIndexOf("\n", start - 1) + 1;
	const newlineIndex = text.indexOf("\n", end);
	const lineEnd = newlineIndex === -1 ? text.length : newlineIndex + 1;
	const leadingIsBlank = text.slice(lineStart, start).trim().length === 0;
	const trailingIsBlank =
		text.slice(end, newlineIndex === -1 ? text.length : newlineIndex).trim().length === 0;
	if (leadingIsBlank && trailingIsBlank) {
		return [lineStart, lineEnd];
	}

	return [start, end];
}

/**
 * Builds the autofix, or returns `null` when the rewrite is not unambiguously
 * safe: unrelated sibling declarators, unmergeable or annotated patterns,
 * duplicate or colliding binding names, or expressions that reference bindings
 * unavailable at the parameter position.
 *
 * @param query - The rewrite being planned.
 * @returns The fix plan, or `null` when only a report should be emitted.
 */
function planFix(query: RewriteQuery): FixPlan | null {
	const { identifier, node, otherParameterNames, sourceCode, statements } = query;

	// Removing a declaration removes every declarator in it, so unrelated
	// sibling declarators (`const { a } = obj, x = 1`) block the fix.
	const declaratorSet = new Set(statements.map((statement) => statement.declarator));
	const declarations = [...new Set(statements.map((statement) => statement.declaration))];
	const onlyOwnDeclarators = declarations.every((declaration) => {
		return declaration.declarations.every((declarator) => declaratorSet.has(declarator));
	});
	if (!onlyOwnDeclarators) {
		return null;
	}

	const patterns = statements.map((statement) => statement.pattern);

	// A pattern's type annotation can move to the signature only when it is the
	// sole pattern and the parameter is not annotated itself.
	const hasAnnotatedPattern = patterns.some((pattern) => pattern.typeAnnotation !== undefined);
	if (hasAnnotatedPattern && (patterns.length > 1 || identifier.typeAnnotation !== undefined)) {
		return null;
	}

	// A rest element must stay last, so merging patterns around one is unsafe.
	if (patterns.length > 1) {
		const hasRest = patterns.some((pattern) => {
			return pattern.properties.some(
				(property) => property.type === AST_NODE_TYPES.RestElement,
			);
		});
		if (hasRest) {
			return null;
		}
	}

	const boundNames: Array<string> = [];
	for (const pattern of patterns) {
		collectBoundNames(pattern, boundNames);
	}

	// Duplicate bindings (possible with `var`) and collisions with the other
	// parameters are SyntaxErrors in a non-simple parameter list.
	if (new Set(boundNames).size !== boundNames.length) {
		return null;
	}

	if (boundNames.some((name) => otherParameterNames.has(name))) {
		return null;
	}

	if (hasUnsafePatternReferences(query, patterns)) {
		return null;
	}

	const [firstPattern] = patterns;
	let parameterText: string;
	if (patterns.length === 1 && firstPattern !== undefined) {
		parameterText = sourceCode.getText(firstPattern);
	} else {
		const innerTexts = patterns
			.map((pattern) =>
				sourceCode.getText(pattern).slice(1, -1).trim().replace(/,$/u, "").trim(),
			)
			.filter((text) => text.length > 0);
		parameterText = innerTexts.length === 0 ? "{}" : `{ ${innerTexts.join(", ")} }`;
	}

	// An un-parenthesized single arrow parameter (`obj => ...`) needs
	// parentheses to host a destructuring pattern.
	const needsParentheses =
		node.type === AST_NODE_TYPES.ArrowFunctionExpression &&
		sourceCode.getTokenAfter(identifier)?.value === "=>";
	if (needsParentheses) {
		parameterText = `(${parameterText})`;
	}

	// Preserve any type annotation (`obj: Options` -> `{ id }: Options`).
	const parameterRange: TSESTree.Range = [
		identifier.range[0],
		identifier.typeAnnotation?.range[0] ?? identifier.range[1],
	];
	const removalRanges = declarations.map((declaration) => {
		return statementRemovalRange(sourceCode, declaration);
	});
	return { parameterRange, parameterText, removalRanges };
}

/**
 * Reports body destructuring statements of parameters that have no other use,
 * preferring the pattern in the function signature. The autofix rewrites the
 * parameter (merging multiple statements into one pattern) and removes the
 * statements; it is withheld when the rewrite is not unambiguously safe, see
 * {@link planFix}.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function create(context: Context): TSESLint.RuleListener {
	function checkFunction(node: FunctionLike): void {
		const { body, params } = node;
		if (body.type !== AST_NODE_TYPES.BlockStatement || hasUseStrictDirective(body)) {
			return;
		}

		const scope = context.sourceCode.getScope(node);
		for (const parameter of params) {
			const identifier = getParameterIdentifier(parameter);
			if (identifier === null || identifier.name === "this") {
				continue;
			}

			const variable = scope.variables.find((candidate) => {
				return candidate.defs.some((definition) => definition.name === identifier);
			});
			// A variable with extra definitions (`var` redeclaration of the
			// parameter) is not safely analyzable.
			if (variable?.defs.length !== 1) {
				continue;
			}

			const statements = collectDestructureStatements(variable, identifier, body);
			if (statements === null || statements.length === 0) {
				continue;
			}

			// `await`/`yield` may not appear in parameter initializers, so no
			// signature form exists at all — the destructuring must stay.
			const requiresBody = statements.some(({ pattern }) => {
				return containsAwaitOrYield(pattern, context.sourceCode.visitorKeys);
			});
			if (requiresBody) {
				continue;
			}

			const otherParameterNames = collectOtherParameterNames(node, parameter);
			// A duplicated simple parameter (sloppy mode) cannot become a
			// pattern.
			if (otherParameterNames.has(identifier.name)) {
				continue;
			}

			const plan = planFix({
				body,
				identifier,
				node,
				otherParameterNames,
				scope,
				sourceCode: context.sourceCode,
				statements,
			});
			for (const [index, statement] of statements.entries()) {
				context.report({
					data: { name: identifier.name },
					fix(fixer) {
						// Only the first report carries the (complete) fix, so
						// applying it in isolation still produces valid code.
						if (index !== 0 || plan === null) {
							return null;
						}

						return [
							fixer.replaceTextRange(plan.parameterRange, plan.parameterText),
							...plan.removalRanges.map((range) => fixer.removeRange(range)),
						];
					},
					messageId: MESSAGE_ID,
					node: statement.declarator,
				});
			}
		}
	}

	return {
		ArrowFunctionExpression: checkFunction,
		FunctionDeclaration: checkFunction,
		FunctionExpression: checkFunction,
	};
}

export const preferParameterDestructuring = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Enforce destructuring parameters in the function signature",
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
