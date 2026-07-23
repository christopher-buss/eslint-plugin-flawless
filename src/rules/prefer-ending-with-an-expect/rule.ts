import type { ImportBindingDefinition } from "@typescript-eslint/scope-manager";
import { DefinitionType } from "@typescript-eslint/scope-manager";
import {
	AST_NODE_TYPES,
	ASTUtils,
	type JSONSchema,
	type TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "prefer-ending-with-an-expect";

const MESSAGE_ID = "mustEndWithExpect";

export type MessageIds = typeof MESSAGE_ID;

export interface PreferEndingWithAnExpectOptions {
	/**
	 * Callee names, in addition to a resolved vitest `it`/`test`, whose second
	 * argument is treated as a test body. Matched by exact dotted name (no scope
	 * resolution), for libraries with custom test blocks such as `each.test`.
	 */
	readonly additionalTestBlockFunctions?: ReadonlyArray<string>;
	/**
	 * Function names, in addition to a resolved vitest `expect`, that count as an
	 * assertion when they end a test. Matched by name against the callee chain,
	 * so no scope resolution applies. A `*` matches a single dotted segment and
	 * `**` matches any number, allowing patterns such as `request.*.expect`.
	 */
	readonly assertFunctionNames?: ReadonlyArray<string>;
}

export type Options = [PreferEndingWithAnExpectOptions?];

type Config = Required<PreferEndingWithAnExpectOptions>;

const DEFAULTS: Config = {
	additionalTestBlockFunctions: [],
	assertFunctionNames: ["expect"],
};

/** Callee identifiers that name a vitest test block (`describe` is excluded). */
const TEST_BLOCK_NAMES = new Set(["it", "test"]);

const messages = {
	[MESSAGE_ID]: "Test should end with an assertion.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			additionalTestBlockFunctions: {
				description:
					"Callee names, besides a resolved vitest it/test, whose second argument is a test body (matched by exact dotted name).",
				items: { type: "string" },
				type: "array",
			},
			assertFunctionNames: {
				description:
					"Function names, besides a resolved vitest expect, that count as an assertion (matched by name; * and ** are wildcards).",
				items: { type: "string" },
				type: "array",
			},
		},
		type: "object",
	},
];

/**
 * Tests a dotted callee name against the `assertFunctionNames` patterns. A `*`
 * stands for a single dotted segment and `**` for any run of segments, so
 * `request.*.expect` and `request.**.expect` both match a chained assertion.
 * Ported from eslint-plugin-jest.
 *
 * @param nodeName - The dotted callee name (e.g. `expect.toBe`).
 * @param patterns - The configured assertion-name patterns.
 * @returns `true` when any pattern matches the name.
 */
function matchesAssertFunctionName(nodeName: string, patterns: ReadonlyArray<string>): boolean {
	return patterns.some((pattern) => {
		return new RegExp(
			`^${pattern
				.split(".")
				.map((segment) => {
					if (segment === "**") {
						return "[a-z\\d\\.]*";
					}

					return segment.replace(/\*/gu, "[a-z\\d]*");
				})
				.join("\\.")}(\\.|$)`,
			"ui",
		).test(nodeName);
	});
}

/**
 * Builds the dotted name of a callee chain, unwrapping intervening calls
 * (`request(app).get("/").expect` -> `request.get.expect`) the way
 * eslint-plugin-jest's `getNodeChain` does. A computed member access yields
 * `null`, since its property is not a static name.
 *
 * @param node - The callee node.
 * @returns The dotted name, or `null` when it cannot be built statically.
 */
function getNodeName(node: TSESTree.Node): null | string {
	if (node.type === AST_NODE_TYPES.Identifier) {
		return node.name;
	}

	if (node.type === AST_NODE_TYPES.CallExpression) {
		return getNodeName(node.callee);
	}

	if (
		node.type === AST_NODE_TYPES.MemberExpression &&
		!node.computed &&
		node.property.type === AST_NODE_TYPES.Identifier
	) {
		const objectName = getNodeName(node.object);
		return objectName === null ? null : `${objectName}.${node.property.name}`;
	}

	return null;
}

/**
 * Walks a callee chain down to the identifier it is rooted at, stepping through
 * member accesses (`it.each` -> `it`) and intervening calls
 * (`it.each(cases)()` -> `it`).
 *
 * @param node - The callee node.
 * @returns The root identifier, or `null` when the chain is not rooted at one.
 */
function getRootIdentifier(node: TSESTree.Node): null | TSESTree.Identifier {
	let current = node;
	for (;;) {
		if (current.type === AST_NODE_TYPES.Identifier) {
			return current;
		}

		if (current.type === AST_NODE_TYPES.CallExpression) {
			current = current.callee;
			continue;
		}

		if (current.type === AST_NODE_TYPES.MemberExpression) {
			current = current.object;
			continue;
		}

		return null;
	}
}

/**
 * Resolves the vitest name an identifier refers to, mirroring how
 * eslint-plugin-jest resolves jest functions. An unresolved reference is a
 * global (vitest's `globals: true` / `@vitest/globals`); a named import from
 * `"vitest"` resolves to its imported name (so aliases work); anything bound to
 * a local variable, function, or parameter resolves to `null` and is ignored.
 *
 * @param sourceCode - Provides the scope used to look up the binding.
 * @param identifier - The identifier to resolve.
 * @returns The vitest name (`it`/`test`/`expect`/...), or `null` when the
 *   identifier is a local binding rather than a vitest global or import.
 */
function resolveVitestName(
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
	if (
		declaration.type !== AST_NODE_TYPES.ImportDeclaration ||
		declaration.source.value !== "vitest"
	) {
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
 * Returns the node that ends a test body: the last statement of a block body
 * (unwrapped to its expression when it is an expression statement), or the
 * expression of a concise arrow body. Ported from eslint-plugin-jest.
 *
 * @param func - The test callback.
 * @returns The ending node, or `null` for an empty block body.
 */
function getLastStatement(
	func: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): null | TSESTree.Node {
	if (func.body.type !== AST_NODE_TYPES.BlockStatement) {
		return func.body;
	}

	const lastStatement = func.body.body.at(-1);
	if (lastStatement === undefined) {
		return null;
	}

	if (lastStatement.type === AST_NODE_TYPES.ExpressionStatement) {
		return lastStatement.expression;
	}

	return lastStatement;
}

/**
 * Flags a test whose last statement is not an assertion, a common sign of an
 * unfinished test. Ported from eslint-plugin-jest's
 * `prefer-ending-with-an-expect`, with vitest-aware resolution of `it`/`test`
 * and `expect`.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let config: Config;
	let sourceCode: Readonly<TSESLint.SourceCode>;

	/**
	 * Determines whether a call is a test block whose second argument is a body.
	 *
	 * @param node - The call to inspect.
	 * @returns `true` when the call opens a vitest (or configured) test.
	 */
	function isTestBlock(node: TSESTree.CallExpression): boolean {
		const root = getRootIdentifier(node.callee);
		if (root !== null && TEST_BLOCK_NAMES.has(resolveVitestName(sourceCode, root) ?? "")) {
			return true;
		}

		const name = getNodeName(node.callee);
		return name !== null && config.additionalTestBlockFunctions.includes(name);
	}

	/**
	 * Determines whether a call is an assertion: a resolved vitest `expect`, or a
	 * call whose dotted name matches an `assertFunctionNames` pattern.
	 *
	 * @param node - The call ending the test body.
	 * @returns `true` when the call counts as an assertion.
	 */
	function isAssertion(node: TSESTree.CallExpression): boolean {
		const root = getRootIdentifier(node.callee);
		if (root !== null && resolveVitestName(sourceCode, root) === "expect") {
			return true;
		}

		return matchesAssertFunctionName(
			getNodeName(node.callee) ?? "",
			config.assertFunctionNames,
		);
	}

	return {
		before(): void {
			const options = context.options[0];
			config = {
				additionalTestBlockFunctions:
					options?.additionalTestBlockFunctions ?? DEFAULTS.additionalTestBlockFunctions,
				assertFunctionNames: options?.assertFunctionNames ?? DEFAULTS.assertFunctionNames,
			};
			({ sourceCode } = context);
		},
		CallExpression(node: TSESTree.CallExpression): void {
			if (!isTestBlock(node)) {
				return;
			}

			const callback = node.arguments[1];
			if (callback === undefined || !ASTUtils.isFunction(callback)) {
				return;
			}

			let lastStatement = getLastStatement(callback);
			if (lastStatement?.type === AST_NODE_TYPES.AwaitExpression) {
				lastStatement = lastStatement.argument;
			}

			if (
				lastStatement?.type === AST_NODE_TYPES.CallExpression &&
				isAssertion(lastStatement)
			) {
				return;
			}

			context.report({
				messageId: MESSAGE_ID,
				node: node.callee,
			});
		},
	};
}

export const preferEndingWithAnExpect = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [DEFAULTS],
	meta: {
		defaultOptions: [DEFAULTS],
		docs: {
			description: "Prefer having the last statement in a test be an assertion",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "suggestion",
	},
});
