import type { ImportBindingDefinition } from "@typescript-eslint/scope-manager";
import { DefinitionType } from "@typescript-eslint/scope-manager";
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "prefer-expect-assertions-count";

const MESSAGE_ID = "preferCount";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Use `expect.assertions(<count>)` with an explicit count instead of `expect.hasAssertions()`.",
};

/**
 * Resolves the name an identifier refers to, mirroring how eslint-plugin-jest
 * resolves test functions. An unresolved reference is a global (vitest's
 * `globals: true` / jest's injected globals); a named import from `"vitest"` or
 * `"@jest/globals"` resolves to its imported name (so aliases work); anything
 * bound to a local variable, function, or parameter resolves to `null` and is
 * ignored.
 *
 * @param sourceCode - Provides the scope used to look up the binding.
 * @param identifier - The identifier to resolve.
 * @returns The resolved name (`expect`/...), or `null` when the identifier is a
 *   local binding rather than a test global or a vitest/jest import.
 */
function resolveTestGlobalName(
	sourceCode: Readonly<TSESLint.SourceCode>,
	identifier: TSESTree.Identifier,
): null | string {
	const variable = findVariable(sourceCode.getScope(identifier), identifier);
	if (variable === null) {
		return identifier.name;
	}

	const definition = variable.defs.at(0);
	if (definition === undefined) {
		return identifier.name;
	}

	if (definition.type !== DefinitionType.ImportBinding) {
		return null;
	}

	const importDefinition: ImportBindingDefinition = definition;
	const declaration = importDefinition.parent;
	const source =
		declaration.type === AST_NODE_TYPES.ImportDeclaration && declaration.source.value;
	if (source !== "vitest" && source !== "@jest/globals") {
		return null;
	}

	const { node } = importDefinition;
	if (
		node.type === AST_NODE_TYPES.ImportSpecifier &&
		node.imported.type === AST_NODE_TYPES.Identifier
	) {
		return node.imported.name;
	}

	return null;
}

/**
 * Matches a `expect.hasAssertions()` call. The callee must be a non-computed
 * `<expect>.hasAssertions` member access whose object resolves to a vitest/jest
 * `expect` (a global or an import from `"vitest"` / `"@jest/globals"`); a locally
 * shadowed `expect` is ignored. Covers either framework, since both name the
 * global `expect`.
 *
 * @param sourceCode - Provides the scope used to resolve `expect`.
 * @param callee - The call's callee.
 * @returns `true` when the callee is a resolved `expect.hasAssertions`.
 */
function isExpectHasAssertions(
	sourceCode: Readonly<TSESLint.SourceCode>,
	callee: TSESTree.Node,
): boolean {
	return (
		callee.type === AST_NODE_TYPES.MemberExpression &&
		!callee.computed &&
		callee.object.type === AST_NODE_TYPES.Identifier &&
		callee.property.type === AST_NODE_TYPES.Identifier &&
		callee.property.name === "hasAssertions" &&
		resolveTestGlobalName(sourceCode, callee.object) === "expect"
	);
}

/**
 * Flags `expect.hasAssertions()`, which only asserts that at least one assertion
 * ran, in favour of `expect.assertions(<count>)`, which pins the exact count and
 * so catches an expectation skipped by an early return or a branch never taken.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		CallExpression(node: TSESTree.CallExpression): void {
			if (!isExpectHasAssertions(context.sourceCode, node.callee)) {
				return;
			}

			context.report({
				messageId: MESSAGE_ID,
				node,
			});
		},
	};
}

export const preferExpectAssertionsCount = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Prefer `expect.assertions(<count>)` over `expect.hasAssertions()`",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
