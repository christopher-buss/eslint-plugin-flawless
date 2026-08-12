import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type ts from "typescript";
import { SymbolFlags, SyntaxKind } from "typescript";

import { moduleSpecifierMatches } from "./module-specifier";
import type { Context, TypeArgumentReference } from "./types";

/**
 * `export default function withAttributes() {}` binds the export under this
 * internal name rather than the name the author wrote.
 */
const DEFAULT_EXPORT_SYMBOL_NAME = "default";

/**
 * Resolved callee symbols, keyed by the callee node. A type literal passed as a
 * type argument names many properties, and every one of them walks back out to
 * the same callee - resolve it once per node instead. Keys are AST nodes, which
 * a re-parse replaces wholesale, so a stale program can never be read from here.
 */
const calleeSymbolCache = new WeakMap<TSESTree.Node, null | ts.Symbol>();

/**
 * Checks whether a declaration sits inside the explicit type arguments of a
 * call whose callee is one of the configured functions.
 *
 * The search walks the whole ancestor chain rather than stopping at the nearest
 * enclosing call, so a declaration nested in type arguments of an inner call
 * still matches an outer configured one.
 *
 * @param node - The node being validated (an identifier or literal naming a
 *   declaration).
 * @param references - The selector's `typeArgumentOf` matchers.
 * @param context - The rule context of the file being linted.
 * @returns True if any enclosing call's type arguments belong to a matching
 *   callee.
 */
export function isInMatchingTypeArgument(
	node: TSESTree.Node,
	references: ReadonlyArray<TypeArgumentReference>,
	context: Context,
): boolean {
	if (references.length === 0) {
		return false;
	}

	// the walk stops at `Program` rather than at an empty parent: the root's own
	// parent is null at runtime, whatever the types say
	let current: TSESTree.Node | undefined = node.parent;
	while (current !== undefined && current.type !== AST_NODE_TYPES.Program) {
		const callee = getTypeArgumentCallee(current);
		if (callee !== undefined && calleeMatches(callee, references, context)) {
			return true;
		}

		current = current.parent;
	}

	return false;
}

/**
 * Reads the callee of the call whose *explicit* type arguments the given node
 * is, if it is one. Type arguments written on a type reference (`Foo<Bar>`) or
 * inferred at a call site have no instantiation node here, so neither matches.
 *
 * @param node - The ancestor node under inspection.
 * @returns The callee expression, or undefined when the node is not a call's
 *   type-argument list.
 */
function getTypeArgumentCallee(node: TSESTree.Node): TSESTree.Expression | undefined {
	if (node.type !== AST_NODE_TYPES.TSTypeParameterInstantiation) {
		return undefined;
	}

	const { parent } = node;
	if (
		parent.type !== AST_NODE_TYPES.CallExpression &&
		parent.type !== AST_NODE_TYPES.NewExpression
	) {
		return undefined;
	}

	// `new Foo<T>()` also carries the arguments of the constructed type, so
	// confirm this instantiation is the call's own type-argument list
	return parent.typeArguments === node ? parent.callee : undefined;
}

/**
 * Resolves the callee through TypeScript's symbol table, following import
 * aliases so a renamed import resolves to the declaration it was imported from
 * rather than to the local name it was bound to.
 *
 * @param callee - The callee expression of the enclosing call.
 * @param context - The rule context of the file being linted.
 * @returns The declaring symbol, or undefined when the callee has none.
 */
function resolveCalleeSymbol(callee: TSESTree.Expression, context: Context): ts.Symbol | undefined {
	const cached = calleeSymbolCache.get(callee);
	if (cached !== undefined) {
		return cached ?? undefined;
	}

	const services = getParserServices(context);
	const symbol = services.getSymbolAtLocation(callee);
	const resolved =
		symbol !== undefined && (symbol.flags & SymbolFlags.Alias) !== 0
			? services.program.getTypeChecker().getAliasedSymbol(symbol)
			: symbol;

	calleeSymbolCache.set(callee, resolved ?? null);

	return resolved;
}

/**
 * Reads the identifier a declaration was written with.
 *
 * @param declaration - A declaration of the callee symbol.
 * @returns The identifier the declaration was written with, when it has one.
 */
function getDeclaredName(declaration: ts.Declaration): string | undefined {
	const { name } = declaration as { name?: ts.Node };
	if (name?.kind !== SyntaxKind.Identifier) {
		return undefined;
	}

	return (name as ts.Identifier).text;
}

/**
 * Matches a resolved symbol against a configured callee name.
 *
 * @param symbol - The resolved callee symbol.
 * @param name - The configured callee name.
 * @returns True if the symbol carries that name, either directly or as the name
 *   written on a default-exported declaration.
 */
function symbolMatchesName(symbol: ts.Symbol, name: string): boolean {
	if (symbol.name === name) {
		return true;
	}

	// a default export is bound as `default`, so fall back to the name the
	// declaration itself was written with - `export default function
	// withAttributes() {}` is configured as `withAttributes`, not as `default`
	if (symbol.name !== DEFAULT_EXPORT_SYMBOL_NAME) {
		return false;
	}

	return (
		symbol.declarations?.some((declaration) => getDeclaredName(declaration) === name) === true
	);
}

/**
 * Applies one matcher's constraints to a resolved callee symbol.
 *
 * @param symbol - The resolved callee symbol.
 * @param reference - One `typeArgumentOf` matcher.
 * @returns True if the symbol satisfies every constraint the matcher carries.
 */
function symbolMatchesReference(symbol: ts.Symbol, { name, from }: TypeArgumentReference): boolean {
	// an empty matcher would match every call; the schema requires at least one
	// of `name` / `from`, so treat it as a non-match defensively
	if (name === undefined && from === undefined) {
		return false;
	}

	if (name !== undefined && !symbolMatchesName(symbol, name)) {
		return false;
	}

	if (from === undefined) {
		return true;
	}

	const { declarations } = symbol;
	if (!declarations || declarations.length === 0) {
		return false;
	}

	return declarations.some((declaration) => {
		return moduleSpecifierMatches(declaration.getSourceFile().fileName, from);
	});
}

/**
 * Checks a call's callee against the configured matchers.
 *
 * @param callee - The callee expression of the enclosing call.
 * @param references - The selector's `typeArgumentOf` matchers.
 * @param context - The rule context of the file being linted.
 * @returns True if the callee resolves to a symbol satisfying any matcher.
 */
function calleeMatches(
	callee: TSESTree.Expression,
	references: ReadonlyArray<TypeArgumentReference>,
	context: Context,
): boolean {
	const symbol = resolveCalleeSymbol(callee, context);
	if (symbol === undefined) {
		return false;
	}

	return references.some((reference) => symbolMatchesReference(symbol, reference));
}
