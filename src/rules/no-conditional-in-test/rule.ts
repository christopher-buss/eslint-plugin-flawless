import type { ImportBindingDefinition } from "@typescript-eslint/scope-manager";
import { DefinitionType } from "@typescript-eslint/scope-manager";
import {
	AST_NODE_TYPES,
	type JSONSchema,
	type TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-conditional-in-test";

const MESSAGE_ID = "conditionalInTest";

export type MessageIds = typeof MESSAGE_ID;

export interface NoConditionalInTestOptions {
	/**
	 * Callee names, in addition to a resolved vitest `it`/`test`, whose call is
	 * treated as a test block. Matched by exact dotted name (no scope resolution),
	 * for libraries with custom test blocks such as `myTest` or `each.test`.
	 */
	readonly additionalTestBlockFunctions?: ReadonlyArray<string>;
	/**
	 * Whether optional chaining (`?.`) is allowed in tests. When `false`, optional
	 * chains are reported and auto-fixed to a non-null assertion (`a?.b` -> `a!.b`).
	 */
	readonly allowOptionalChaining?: boolean;
}

export type Options = [NoConditionalInTestOptions?];

type Config = Required<NoConditionalInTestOptions>;

const DEFAULTS: Config = {
	additionalTestBlockFunctions: [],
	allowOptionalChaining: true,
};

/** Callee identifiers that name a vitest test block (`describe` is excluded). */
const TEST_BLOCK_NAMES = new Set(["it", "test"]);

const messages = {
	[MESSAGE_ID]: "Avoid having conditionals in tests.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			additionalTestBlockFunctions: {
				description:
					"Callee names, besides a resolved vitest it/test, whose call is a test block (matched by exact dotted name).",
				items: { type: "string" },
				type: "array",
			},
			allowOptionalChaining: {
				description:
					"Allow optional chaining (?.) in tests. When false, it is reported and auto-fixed to a non-null assertion (a?.b -> a!.b).",
				type: "boolean",
			},
		},
		type: "object",
	},
];

/** A replacement of a single optional-chaining `?.` token. */
interface OptionalTokenFix {
	readonly text: string;
	readonly token: TSESTree.Token;
}

/**
 * Builds the dotted name of a callee chain, unwrapping intervening calls
 * (`each.test` -> `each.test`, `request(app).get` -> `request.get`). A computed
 * member access yields `null`, since its property is not a static name. Ported
 * from eslint-plugin-jest's `getNodeName`.
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
 * Resolves the vitest name an identifier refers to. An unresolved reference is a
 * global (vitest's `globals: true` / `@vitest/globals`); a named import from
 * `"vitest"` resolves to its imported name (so aliases work); anything bound to
 * a local variable, function, or parameter resolves to `null` and is ignored.
 * Ported from eslint-plugin-flawless's `prefer-ending-with-an-expect`.
 *
 * @param sourceCode - Provides the scope used to look up the binding.
 * @param identifier - The identifier to resolve.
 * @returns The vitest name (`it`/`test`/...), or `null` when the identifier is a
 *   local binding rather than a vitest global or import.
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
 * Collects the `?.` tokens along an optional chain's primary spine and the text
 * that replaces each with a non-null assertion. A non-computed member becomes
 * `!.` (`a?.b` -> `a!.b`); a computed member or optional call becomes `!`
 * (`a?.[x]` -> `a![x]`, `fn?.()` -> `fn!()`). Only the object/callee spine is
 * walked — optional chains inside computed keys or call arguments are their own
 * `ChainExpression` nodes and are visited (and fixed) separately.
 *
 * @param chain - The chain expression to convert.
 * @param sourceCode - Provides token lookups.
 * @returns The per-token replacements, outermost link first.
 */
function collectOptionalTokenFixes(
	chain: TSESTree.ChainExpression,
	sourceCode: Readonly<TSESLint.SourceCode>,
): Array<OptionalTokenFix> {
	const fixes: Array<OptionalTokenFix> = [];
	let node: TSESTree.Node = chain.expression;

	for (;;) {
		if (node.type === AST_NODE_TYPES.MemberExpression) {
			if (node.optional) {
				const token = sourceCode.getTokenAfter(node.object, {
					filter: (candidate) => candidate.value === "?.",
				});
				if (token !== null) {
					fixes.push({ text: node.computed ? "!" : "!.", token });
				}
			}

			node = node.object;
			continue;
		}

		if (node.type === AST_NODE_TYPES.CallExpression) {
			if (node.optional) {
				const token = sourceCode.getTokenAfter(node.callee, {
					filter: (candidate) => candidate.value === "?.",
				});
				if (token !== null) {
					fixes.push({ text: "!", token });
				}
			}

			node = node.callee;
			continue;
		}

		return fixes;
	}
}

/**
 * Disallows conditional logic inside vitest test bodies (`it`/`test`), which
 * makes a test's behavior depend on runtime state. Ported from
 * eslint-plugin-jest's `no-conditional-in-test` with vitest-aware resolution and
 * an auto-fix that rewrites disallowed optional chaining to a non-null assertion.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let config: Config;
	let sourceCode: Readonly<TSESLint.SourceCode>;
	let inTestCase = false;

	/**
	 * Determines whether a call opens a test block (a resolved vitest `it`/`test`,
	 * or a configured `additionalTestBlockFunctions` name).
	 *
	 * @param node - The call to inspect.
	 * @returns `true` when the call opens a test.
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
	 * Reports a conditional node when the traversal is inside a test body.
	 *
	 * @param node - The `if`/`switch`/ternary/logical construct to flag.
	 */
	function maybeReportConditional(node: TSESTree.Node): void {
		if (inTestCase) {
			context.report({ messageId: MESSAGE_ID, node });
		}
	}

	return {
		"before": function (): void {
			const options = context.options[0];
			config = {
				additionalTestBlockFunctions:
					options?.additionalTestBlockFunctions ?? DEFAULTS.additionalTestBlockFunctions,
				allowOptionalChaining:
					options?.allowOptionalChaining ?? DEFAULTS.allowOptionalChaining,
			};
			({ sourceCode } = context);
			inTestCase = false;
		},
		"CallExpression": function (node: TSESTree.CallExpression): void {
			if (isTestBlock(node)) {
				inTestCase = true;
			}
		},
		"CallExpression:exit": function (node: TSESTree.CallExpression): void {
			if (isTestBlock(node)) {
				inTestCase = false;
			}
		},
		"ChainExpression": function (node: TSESTree.ChainExpression): void {
			if (!inTestCase || config.allowOptionalChaining) {
				return;
			}

			context.report({
				fix: (fixer) => {
					return collectOptionalTokenFixes(node, sourceCode).map((optionalFix) => {
						return fixer.replaceText(optionalFix.token, optionalFix.text);
					});
				},
				messageId: MESSAGE_ID,
				node,
			});
		},
		"ConditionalExpression": maybeReportConditional,
		"IfStatement": maybeReportConditional,
		"LogicalExpression": maybeReportConditional,
		"SwitchStatement": maybeReportConditional,
	};
}

export const noConditionalInTest = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [DEFAULTS],
	meta: {
		defaultOptions: [DEFAULTS],
		docs: {
			description: "Disallow conditional logic in tests",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema,
		type: "problem",
	},
});
