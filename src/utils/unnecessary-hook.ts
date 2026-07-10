import * as core from "@eslint-react/core";
import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { hasNestedCallOrNew } from "./nested-expressions";
import { resolve } from "./resolve";

/**
 * Configuration distinguishing the `useMemo` and `useCallback` variants.
 *
 * @template MessageIds - The rule's message identifiers.
 */
export interface UnnecessaryHookConfig<MessageIds extends string> {
	/** Which hook this rule targets. */
	readonly hook: "useCallback" | "useMemo";
	/** Message ids to report. */
	readonly messageIds: {
		readonly default: MessageIds;
		readonly insideUseEffect: MessageIds;
	};
}

/**
 * The context type `@eslint-react/core`'s predicates expect. Derived from an
 * exported predicate so this module does not need to depend on
 * `@eslint-react/eslint` directly.
 */
type ReactContext = Parameters<typeof core.isUseMemoCall>[0];

type FunctionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

/**
 * A minimal report descriptor built by the "inside useEffect" check.
 *
 * @template MessageIds - The rule's message identifiers.
 */
interface HookReport<MessageIds extends string> {
	readonly data?: Readonly<Record<string, string>>;
	readonly messageId: MessageIds;
	readonly node: TSESTree.Node;
}

/**
 * Builds the `create` for the `no-unnecessary-use-memo` /
 * `no-unnecessary-use-callback` rules.
 *
 * Faithfully ports the rules removed from `eslint-plugin-react-x` (they were
 * dropped because the React Compiler makes them redundant; the Roblox /
 * `@rbxts/react` ecosystem has no Compiler). Hook detection is delegated to
 * `@eslint-react/core` so it matches the upstream semantics (fully-qualified
 * name resolution across imports, namespaces and `require`).
 *
 * @param config - The hook-specific configuration.
 * @returns A rule `create` function.
 * @template MessageIds - The rule's message identifiers.
 */
export function createUnnecessaryHookRule<MessageIds extends string>({
	hook,
	messageIds,
}: UnnecessaryHookConfig<MessageIds>): (
	context: Readonly<TSESLint.RuleContext<MessageIds, []>>,
) => TSESLint.RuleListener {
	// Only `useMemo` skips factories that perform real computation.
	const skipComputation = hook === "useMemo";

	return (context) => {
		const { sourceCode } = context;
		const reactContext = context as unknown as ReactContext;
		const detectHookCall = hook === "useMemo" ? core.isUseMemoCall : core.isUseCallbackCall;

		return {
			VariableDeclarator(node: TSESTree.VariableDeclarator): void {
				const { id, init } = node;
				if (
					id.type !== AST_NODE_TYPES.Identifier ||
					init?.type !== AST_NODE_TYPES.CallExpression ||
					!detectHookCall(reactContext, init)
				) {
					return;
				}

				const [variable, ...rest] = sourceCode.getDeclaredVariables(node);
				// Skip non-standard usages (e.g. destructuring) to avoid false
				// positives.
				if (variable === undefined || rest.length > 0) {
					return;
				}

				const insideEffectReport = checkForUsageInsideUseEffect(
					sourceCode,
					init,
					messageIds.insideUseEffect,
				);

				const component = sourceCode.getScope(init).block;
				if (!ASTUtils.isFunction(component)) {
					return;
				}

				const [argument0, argument1] = init.arguments;
				if (argument0 === undefined || argument1 === undefined) {
					return;
				}

				if (
					skipComputation &&
					ASTUtils.isFunction(argument0) &&
					hasNestedCallOrNew(argument0.body)
				) {
					reportIf(context, insideEffectReport);
					return;
				}

				if (!hasEmptyDeps(sourceCode, argument1)) {
					reportIf(context, insideEffectReport);
					return;
				}

				const factory = resolveFactory(sourceCode, argument0);
				if (factory === null) {
					return;
				}

				if (!referencesComponentScope(sourceCode, factory, component)) {
					context.report({ messageId: messageIds.default, node });
					return;
				}

				reportIf(context, insideEffectReport);
			},
		};
	};
}

/**
 * Finds the nearest ancestor that is a `useEffect`-like call.
 *
 * @param node - The node to search upward from.
 * @returns The enclosing effect call, or `null` when there is none.
 */
function findEnclosingEffect(node: TSESTree.Node): null | TSESTree.Node {
	let current: TSESTree.Node | undefined = node.parent;
	while (current !== undefined) {
		if (core.isUseEffectLikeCall(current)) {
			return current;
		}

		if (current.type === AST_NODE_TYPES.Program) {
			return null;
		}

		current = current.parent;
	}

	return null;
}

/**
 * Reports the "used inside a single useEffect" case when applicable.
 *
 * @param sourceCode - Provides declared-variable and text lookups.
 * @param node - The hook call expression.
 * @param messageId - The message id to report.
 * @returns A report descriptor, or `null` when the case does not apply.
 * @template MessageIds - The rule's message identifiers.
 */
function checkForUsageInsideUseEffect<MessageIds extends string>(
	sourceCode: Readonly<TSESLint.SourceCode>,
	node: TSESTree.CallExpression,
	messageId: MessageIds,
): HookReport<MessageIds> | null {
	// Fast path: bail unless the file mentions an effect hook at all.
	if (!/use\w*Effect/u.test(sourceCode.text)) {
		return null;
	}

	const { parent } = node;
	if (
		parent.type !== AST_NODE_TYPES.VariableDeclarator ||
		parent.id.type !== AST_NODE_TYPES.Identifier
	) {
		return null;
	}

	const references = sourceCode.getDeclaredVariables(parent).at(0)?.references ?? [];
	const usages = references.filter((reference) => reference.init !== true);
	// No usages: `no-unused-vars` will flag it instead.
	if (usages.length === 0) {
		return null;
	}

	const effects = new Set<TSESTree.Node>();
	for (const usage of usages) {
		const effect = findEnclosingEffect(usage.identifier);
		if (effect === null) {
			return null;
		}

		effects.add(effect);
		if (effects.size > 1) {
			return null;
		}
	}

	return { data: { name: parent.id.name }, messageId, node };
}

/**
 * Determines whether a dependency argument is an empty array (directly or via a
 * resolvable identifier).
 *
 * @param sourceCode - Provides scope lookup to resolve identifiers.
 * @param node - The dependency argument node.
 * @returns `true` if the dependencies are empty.
 */
function hasEmptyDeps(sourceCode: Readonly<TSESLint.SourceCode>, node: TSESTree.Node): boolean {
	if (node.type === AST_NODE_TYPES.ArrayExpression) {
		return node.elements.length === 0;
	}

	if (node.type === AST_NODE_TYPES.Identifier) {
		const resolved = resolve(sourceCode, node);
		return resolved?.type === AST_NODE_TYPES.ArrayExpression && resolved.elements.length === 0;
	}

	return false;
}

/**
 * Collects a scope together with all of its descendant scopes.
 *
 * @param scope - The root scope.
 * @returns The scope and every nested child scope.
 */
function flattenScopes(scope: TSESLint.Scope.Scope): Array<TSESLint.Scope.Scope> {
	return scope.childScopes.reduce<Array<TSESLint.Scope.Scope>>(
		(accumulator, child) => [...accumulator, ...flattenScopes(child)],
		[scope],
	);
}

/**
 * Determines whether any reference inside the factory resolves to a binding
 * declared in the component's scope.
 *
 * @param sourceCode - Provides scope lookup for the factory.
 * @param factory - The memoized factory function node.
 * @param component - The enclosing component function node.
 * @returns `true` if the factory reads from the component scope.
 */
function referencesComponentScope(
	sourceCode: Readonly<TSESLint.SourceCode>,
	factory: FunctionNode,
	component: TSESTree.Node,
): boolean {
	const references = flattenScopes(sourceCode.getScope(factory)).flatMap(
		(scope) => scope.references,
	);
	return references.some((reference) => reference.resolved?.scope.block === component);
}

/**
 * Reports the descriptor when it is present.
 *
 * @param context - The rule context.
 * @param descriptor - The descriptor to report, or `null` to skip.
 * @template MessageIds - The rule's message identifiers.
 */
function reportIf<MessageIds extends string>(
	context: Readonly<TSESLint.RuleContext<MessageIds, []>>,
	descriptor: HookReport<MessageIds> | null,
): void {
	if (descriptor !== null) {
		context.report(descriptor);
	}
}

/**
 * Resolves the first argument of the hook call to the underlying factory
 * function node, unwrapping a curried arrow (`() => () => ...`) and resolving
 * identifiers to their initializer.
 *
 * @param sourceCode - Provides scope lookup to resolve identifiers.
 * @param node - The first hook argument.
 * @returns The factory function node, or `null` when it is not a function.
 */
function resolveFactory(
	sourceCode: Readonly<TSESLint.SourceCode>,
	node: TSESTree.Node,
): FunctionNode | null {
	if (node.type === AST_NODE_TYPES.ArrowFunctionExpression) {
		return node.body.type === AST_NODE_TYPES.ArrowFunctionExpression ? node.body : node;
	}

	if (node.type === AST_NODE_TYPES.FunctionExpression) {
		return node;
	}

	if (node.type === AST_NODE_TYPES.Identifier) {
		const resolved = resolve(sourceCode, node);
		if (
			resolved?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
			resolved?.type === AST_NODE_TYPES.FunctionExpression
		) {
			return resolved;
		}
	}

	return null;
}
