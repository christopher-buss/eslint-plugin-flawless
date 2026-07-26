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

/**
 * Root identifiers whose call arguments are assertion conditions. Matched by
 * name as well as by vitest resolution, so `assert` from `node:assert` counts.
 */
const ASSERTION_ROOT_NAMES = new Set(["assert", "expect"]);

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
	/** Token the `!` is appended to; `!` may not be preceded by a line break. */
	readonly anchor: TSESTree.Token;
	/** Text replacing `?.` — `.` for a plain member, empty otherwise. */
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
 * Determines whether a node sits directly in the argument list of an assertion
 * call (`expect(...)`, `assert(...)`, `assert.ok(...)`, `expect(x).toBe(...)`).
 * The search walks up to the nearest enclosing call and stops there, so an
 * argument of some other function nested inside an assertion
 * (`expect(wrap(a && b))`) does not qualify; it also stops at a function
 * boundary, since a callback's body runs on the callback's terms rather than as
 * part of the assertion's condition.
 *
 * @param node - The node to locate.
 * @param sourceCode - Provides the scope used to resolve the callee.
 * @returns `true` when the node is an argument of an assertion call.
 */
function isInAssertionArgument(
	node: TSESTree.Node,
	sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
	let current = node;
	for (;;) {
		const { parent } = current;
		if (parent === undefined) {
			return false;
		}

		if (
			parent.type === AST_NODE_TYPES.ArrowFunctionExpression ||
			parent.type === AST_NODE_TYPES.FunctionDeclaration ||
			parent.type === AST_NODE_TYPES.FunctionExpression
		) {
			return false;
		}

		if (parent.type === AST_NODE_TYPES.CallExpression) {
			// Having arrived here by walking parent links, `current` is either
			// the callee or one of the arguments.
			if (current === parent.callee) {
				return false;
			}

			const root = getRootIdentifier(parent.callee);
			if (root === null) {
				return false;
			}

			return (
				ASSERTION_ROOT_NAMES.has(root.name) ||
				ASSERTION_ROOT_NAMES.has(resolveVitestName(sourceCode, root) ?? "")
			);
		}

		current = parent;
	}
}

/**
 * Collects the `?.` tokens along an optional chain's primary spine and the parts
 * that convert each into a non-null assertion. The `!` is anchored to the token
 * preceding `?.` rather than written in place of it, because TypeScript forbids
 * a line break before `!` — a chain wrapped as `a\n?.b` has to become `a!\n.b`,
 * not `a\n!.b`. What replaces `?.` is therefore only the connector: `.` for a
 * plain member (`a?.b` -> `a!.b`), nothing for a computed member or optional
 * call (`a?.[x]` -> `a![x]`, `fn?.()` -> `fn!()`). Only the object/callee spine
 * is walked — optional chains inside computed keys or call arguments are their
 * own `ChainExpression` nodes and are visited (and fixed) separately.
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
				const anchor = token === null ? null : sourceCode.getTokenBefore(token);
				if (token !== null && anchor !== null) {
					fixes.push({ anchor, text: node.computed ? "" : ".", token });
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
				const anchor = token === null ? null : sourceCode.getTokenBefore(token);
				if (token !== null && anchor !== null) {
					fixes.push({ anchor, text: "", token });
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
	const testBlocks: Array<TSESTree.CallExpression> = [];

	/**
	 * Determines whether a call names a test block (a resolved vitest `it`/`test`,
	 * or a configured `additionalTestBlockFunctions` name).
	 *
	 * @param node - The call to inspect.
	 * @returns `true` when the call is rooted at a test block name.
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
	 * Determines whether a test block call is a modifier applied to the block
	 * rather than the call that opens it. In `it.skipIf(cond)("works", fn)` both
	 * calls are rooted at `it`, but only the outer one takes the test body — the
	 * inner one sits in its callee position.
	 *
	 * @param node - The test block call to inspect.
	 * @returns `true` when the call is a modifier in a callee chain.
	 */
	function isTestBlockModifier(node: TSESTree.CallExpression): boolean {
		const { parent } = node;
		return parent.type === AST_NODE_TYPES.CallExpression && parent.callee === node;
	}

	/**
	 * Determines whether a node sits in the body of the innermost open test block.
	 * A node reached through that block's callee — a modifier's arguments
	 * (`it.skipIf(cond)`, `it.each(cases)`) or a computed key (`it[flag ? …]`) —
	 * decides whether and how the test runs rather than what it does, so it is not
	 * part of the body.
	 *
	 * @param node - The node to locate.
	 * @returns `true` when the node is inside a test body.
	 */
	function isInTestBody(node: TSESTree.Node): boolean {
		const block = testBlocks.at(-1);
		if (block === undefined) {
			return false;
		}

		let current: TSESTree.Node = node;
		for (;;) {
			const parent: TSESTree.Node | undefined = current.parent;
			if (parent === undefined) {
				return false;
			}

			if (parent === block) {
				return current !== block.callee;
			}

			current = parent;
		}
	}

	/**
	 * Reports a conditional node when the traversal is inside a test body.
	 *
	 * @param node - The `if`/`switch`/ternary/logical construct to flag.
	 */
	function maybeReportConditional(node: TSESTree.Node): void {
		if (isInTestBody(node)) {
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
			testBlocks.length = 0;
		},
		"CallExpression": function (node: TSESTree.CallExpression): void {
			// A modifier is not tracked, so the block stays open across it: its
			// `:exit` fires before the body is walked, which would otherwise
			// close the block early and leave the body unchecked.
			if (isTestBlock(node) && !isTestBlockModifier(node)) {
				testBlocks.push(node);
			}
		},
		"CallExpression:exit": function (node: TSESTree.CallExpression): void {
			if (testBlocks.at(-1) === node) {
				testBlocks.pop();
			}
		},
		"ChainExpression": function (node: TSESTree.ChainExpression): void {
			if (config.allowOptionalChaining || !isInTestBody(node)) {
				return;
			}

			context.report({
				fix: (fixer) => {
					return collectOptionalTokenFixes(node, sourceCode).flatMap((optionalFix) => {
						return [
							fixer.insertTextAfter(optionalFix.anchor, "!"),
							fixer.replaceText(optionalFix.token, optionalFix.text),
						];
					});
				},
				messageId: MESSAGE_ID,
				node,
			});
		},
		"ConditionalExpression": maybeReportConditional,
		"IfStatement": maybeReportConditional,
		"LogicalExpression": function (node: TSESTree.LogicalExpression): void {
			// `&&` in an assertion is a compound condition, not a branch:
			// both operands feed the one outcome the assertion checks, and
			// nothing is skipped that would otherwise have been asserted.
			// `||` and `??` pick between values, so they still hide which
			// operand was tested.
			if (node.operator === "&&" && isInAssertionArgument(node, sourceCode)) {
				return;
			}

			maybeReportConditional(node);
		},
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
