import {
	AST_NODE_TYPES,
	ASTUtils,
	type JSONSchema,
	type TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import {
	getCalleeRootIdentifier,
	getNodeName,
	resolveTestGlobalName,
} from "../../utils/test-globals";

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

/** The only module whose named exports count as test globals for this rule. */
const VITEST_SOURCES: ReadonlySet<string> = new Set(["vitest"]);

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
		const root = getCalleeRootIdentifier(node.callee);
		if (
			root !== null &&
			TEST_BLOCK_NAMES.has(resolveTestGlobalName(sourceCode, root, VITEST_SOURCES) ?? "")
		) {
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
		const root = getCalleeRootIdentifier(node.callee);
		if (root !== null && resolveTestGlobalName(sourceCode, root, VITEST_SOURCES) === "expect") {
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
