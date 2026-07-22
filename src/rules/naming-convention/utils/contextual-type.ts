import type { ParserServices, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type ts from "typescript";

export type ContextualTypeCache = WeakMap<TSESTree.ObjectExpression, null | ReadonlyArray<ts.Type>>;

/**
 * Determines if an object literal member's name is dictated by the contextual
 * type of the enclosing object literal (e.g. `{ ... } satisfies
 * Partial<Service>`). In that case the name is not the author's choice - it is
 * required by the declared type, which is itself validated at its declaration
 * site - so naming validation should be skipped.
 *
 * @param node - The non-computed object literal property or method node.
 * @param services - Parser services (may lack type information).
 * @param cache - Per-file cache of contextual types keyed by object literal.
 * @returns True if the member name is required by a contextual type.
 */
export function isDictatedByContextualType(
	node: TSESTree.PropertyNonComputedName,
	services: ParserServices,
	cache: ContextualTypeCache,
): boolean {
	if (!services.program || node.parent.type !== AST_NODE_TYPES.ObjectExpression) {
		return false;
	}

	const checker = services.program.getTypeChecker();
	const tsObject = services.esTreeNodeToTSNodeMap.get(node.parent);
	const candidates = getCandidateTypes(node.parent, tsObject, checker, cache);
	if (candidates === null) {
		return false;
	}

	const name =
		node.key.type === AST_NODE_TYPES.Identifier ? node.key.name : String(node.key.value);

	return candidates.some((candidate) => {
		const property = checker.getPropertyOfType(candidate, name);
		return property !== undefined && !isDeclaredWithinLiteral(property, tsObject);
	});
}

/**
 * Resolves the contextual type of an object literal into its candidate
 * constituent types, cached per object literal.
 *
 * Union arms are checked individually because `getPropertyOfType` on a union
 * only finds properties present in every arm, while a name dictated by a
 * single arm still isn't the author's choice.
 *
 * @param objectNode - The enclosing object literal (ESTree).
 * @param tsObject - The corresponding TypeScript node.
 * @param checker - The type checker.
 * @param cache - Per-file cache of contextual types keyed by object literal.
 * @returns The candidate types, or null if there is no contextual type.
 */
function getCandidateTypes(
	objectNode: TSESTree.ObjectExpression,
	tsObject: ts.ObjectLiteralExpression,
	checker: ts.TypeChecker,
	cache: ContextualTypeCache,
): null | ReadonlyArray<ts.Type> {
	const cached = cache.get(objectNode);
	if (cached !== undefined) {
		return cached;
	}

	const contextualType = checker.getContextualType(tsObject);

	let candidates: null | ReadonlyArray<ts.Type> = null;
	if (contextualType !== undefined) {
		// Strip `| undefined` from optional positions (e.g. optional parameters)
		// and resolve type parameters to their apparent (constraint) types.
		const nonNullable = contextualType.getNonNullableType();
		const arms = nonNullable.isUnion() ? nonNullable.types : [nonNullable];
		candidates = arms.map((arm) => checker.getApparentType(arm));
	}

	cache.set(objectNode, candidates);
	return candidates;
}

/**
 * Guards against self-inference: in generic calls like `identity({ Name: 1 })`
 * the contextual type is inferred from the literal itself, so the property
 * symbol's declarations all live inside the literal - the name is still the
 * author's choice. Transient symbols without declarations (such as those from
 * mapped types like `Partial<T>`) originate from the contextual type and count
 * as dictated.
 *
 * @param symbol - The property symbol found on a candidate contextual type.
 * @param literal - The object literal being checked.
 * @returns True if every declaration of the symbol lies inside the literal.
 */
function isDeclaredWithinLiteral(symbol: ts.Symbol, literal: ts.ObjectLiteralExpression): boolean {
	const declarations = symbol.declarations ?? [];
	if (declarations.length === 0) {
		return false;
	}

	return declarations.every((declaration) => {
		return (
			declaration.getSourceFile() === literal.getSourceFile() &&
			declaration.pos >= literal.pos &&
			declaration.end <= literal.end
		);
	});
}
