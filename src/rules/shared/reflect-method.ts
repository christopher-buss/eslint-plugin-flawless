import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

/**
 * Whether a call target names one method on the global `Reflect` object. Both
 * `Reflect.get(…)` and the computed `Reflect["get"](…)` form match.
 *
 * The method name is compared before the object is resolved, so a `Reflect`
 * call this rule does not care about never pays for a scope-chain walk.
 *
 * @param sourceCode - The source code of the linted file.
 * @param callee - The callee of the call expression under inspection.
 * @param methodName - The `Reflect` method the callee must name.
 * @returns True when the callee reads `methodName` off the global `Reflect`.
 */
export function isGlobalReflectMethodCall(
	sourceCode: Readonly<TSESLint.SourceCode>,
	callee: TSESTree.Node,
	methodName: string,
): boolean {
	if (callee.type !== AST_NODE_TYPES.MemberExpression) {
		return false;
	}

	const { computed, object, property } = callee;
	const namesMethod = computed
		? property.type === AST_NODE_TYPES.Literal && property.value === methodName
		: property.type === AST_NODE_TYPES.Identifier && property.name === methodName;

	return namesMethod && isGlobalReflect(sourceCode, object);
}

/**
 * Whether an expression names the global `Reflect` object rather than a local
 * binding that shadows it. An unresolved name is the global; so is a resolved
 * variable with no declaration, which is how a configured global appears.
 *
 * @param sourceCode - The source code of the linted file.
 * @param expression - The expression the method is read from.
 * @returns True when the expression is the global `Reflect`.
 */
function isGlobalReflect(
	sourceCode: Readonly<TSESLint.SourceCode>,
	expression: TSESTree.Expression,
): boolean {
	if (expression.type !== AST_NODE_TYPES.Identifier || expression.name !== "Reflect") {
		return false;
	}

	const variable = findVariable(sourceCode.getScope(expression), expression);
	return variable === null || variable.defs.length === 0;
}
