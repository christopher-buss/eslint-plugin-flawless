import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import {
	getTestGlobalSources,
	resolveImportedTestGlobalName,
	resolveTestGlobalName,
} from "../../utils/test-globals";

export const RULE_NAME = "no-shared-mocks";

const MESSAGE_ID = "sharedMock";
const PATTERN_MESSAGE_ID = "sharedMockPattern";

export type MessageIds = typeof MESSAGE_ID | typeof PATTERN_MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Mock '{{name}}' is created once outside the tests that use it, so every one of them shares its recorded calls. Create it in a factory function called from each test.",
	[PATTERN_MESSAGE_ID]:
		"This declaration creates a mock outside the tests that use it, so every one of them shares its recorded calls. Create it in a factory function called from each test.",
};

/** Namespaces whose `fn`/`spyOn` members create a mock function. */
const MOCK_NAMESPACES = new Set(["jest", "vi"]);

/** Members of {@link MOCK_NAMESPACES} that create a mock function. */
const MOCK_FACTORY_METHODS = new Set(["fn", "spyOn"]);

/** Bare test globals that create a mock function (bun's `mock` and `spyOn`). */
const BARE_MOCK_FACTORIES = new Set(["fn", "mock", "spyOn"]);

/** Members of {@link MOCK_NAMESPACES} that replace a whole module. */
const MODULE_MOCK_METHODS = new Set(["doMock", "mock", "unstable_mockModule"]);

/** Callee identifiers naming a block whose body is shared by several tests. */
const TEST_SUITE_NAMES = new Set(["describe"]);

/**
 * Node types whose subtree is not evaluated when the enclosing declaration is
 * initialized. Creating a mock inside one of these is the fix this rule pushes
 * towards, so the search for a mock deliberately stops at their boundary.
 */
const DEFERRED_TYPES: ReadonlySet<string> = new Set<string>([
	AST_NODE_TYPES.ArrowFunctionExpression,
	AST_NODE_TYPES.ClassBody,
	AST_NODE_TYPES.FunctionDeclaration,
	AST_NODE_TYPES.FunctionExpression,
]);

/**
 * Narrows an arbitrary property value to an AST node.
 *
 * @param value - The property value to test.
 * @returns `true` when the value looks like a node.
 */
function isNode(value: unknown): value is TSESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string"
	);
}

/**
 * Walks an expression looking for a call that creates a mock. The walk is
 * generic (rather than a list of known shapes) so that a mock nested in an
 * array, an object literal, a `fromPartial(...)` argument or a chained
 * `.mockReturnValue(...)` is found all the same, and it skips the `parent` back
 * reference to stay acyclic.
 *
 * @param node - The subtree to search.
 * @param isMockCreation - Decides whether a call creates a mock.
 * @param invoked - Whether the node is known to run as the expression is
 *   evaluated, which lets an immediately-invoked function past the deferral.
 * @returns `true` when the subtree creates a mock as it is evaluated.
 */
function containsMockCreation(
	node: TSESTree.Node,
	isMockCreation: (call: TSESTree.CallExpression) => boolean,
	invoked = false,
): boolean {
	if (!invoked && DEFERRED_TYPES.has(node.type)) {
		return false;
	}

	if (node.type === AST_NODE_TYPES.CallExpression) {
		if (isMockCreation(node)) {
			return true;
		}

		// An immediately-invoked function runs while the expression is evaluated,
		// so unlike a factory its body is not deferred.
		if (
			ASTUtils.isFunction(node.callee) &&
			containsMockCreation(node.callee, isMockCreation, true)
		) {
			return true;
		}
	}

	for (const [key, value] of Object.entries(node)) {
		if (key === "parent") {
			continue;
		}

		if (Array.isArray(value)) {
			if (
				value.some(
					(item: unknown) => isNode(item) && containsMockCreation(item, isMockCreation),
				)
			) {
				return true;
			}
		} else if (isNode(value) && containsMockCreation(value, isMockCreation)) {
			return true;
		}
	}

	return false;
}

/**
 * Finds the function a node is evaluated inside, which is the lifetime of any
 * binding declared there.
 *
 * @param node - The node to start from.
 * @returns The nearest enclosing function, or `null` at module scope.
 */
function getEnclosingFunction(node: TSESTree.Node): null | TSESTree.Node {
	let current = node;
	while (current.type !== AST_NODE_TYPES.Program) {
		const { parent } = current;
		if (ASTUtils.isFunction(parent)) {
			return parent;
		}

		current = parent;
	}

	return null;
}

/**
 * Walks a callee chain down to the identifier it is rooted at, stepping through
 * member accesses (`describe.each` -> `describe`) and intervening calls
 * (`describe.each(cases)()` -> `describe`).
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
 * Flags mock functions created once outside the tests that use them, whose
 * recorded calls and configured implementations persist from one test to the
 * next. Such a mock only behaves if each test remembers to reset it by hand;
 * forget once and a test reads state left behind by an earlier one, which passes
 * in isolation and fails in a different order.
 *
 * A mock passed to a `jest.mock()` factory is exempt: module mock factories are
 * hoisted above the file, so they cannot close over anything but a module-scope
 * binding.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let sourceCode: Readonly<TSESLint.SourceCode>;
	let sources: ReadonlySet<string>;

	/**
	 * Determines whether a call creates a mock function: a `jest`/`vi` namespaced
	 * `fn`/`spyOn`, or bun's imported `mock`/`spyOn`. The bare form is limited to
	 * real imports, since those names are too common to claim as globals.
	 *
	 * @param node - The call to inspect.
	 * @returns `true` when the call produces a stateful mock.
	 */
	function isMockCreation({ callee }: TSESTree.CallExpression): boolean {
		if (callee.type === AST_NODE_TYPES.Identifier) {
			const name = resolveImportedTestGlobalName(sourceCode, callee, sources);
			return name !== null && BARE_MOCK_FACTORIES.has(name);
		}

		if (
			callee.type !== AST_NODE_TYPES.MemberExpression ||
			callee.computed ||
			callee.property.type !== AST_NODE_TYPES.Identifier ||
			!MOCK_FACTORY_METHODS.has(callee.property.name) ||
			callee.object.type !== AST_NODE_TYPES.Identifier
		) {
			return false;
		}

		return MOCK_NAMESPACES.has(resolveTestGlobalName(sourceCode, callee.object, sources) ?? "");
	}

	/**
	 * Determines whether a call replaces a whole module: `jest.mock()`,
	 * `vi.mock()`, their `doMock` variants, or bun's `mock.module()`.
	 *
	 * @param node - The call to inspect.
	 * @returns `true` when the call takes a module mock factory.
	 */
	function isModuleMockCall({ callee }: TSESTree.CallExpression): boolean {
		if (
			callee.type !== AST_NODE_TYPES.MemberExpression ||
			callee.computed ||
			callee.property.type !== AST_NODE_TYPES.Identifier ||
			callee.object.type !== AST_NODE_TYPES.Identifier
		) {
			return false;
		}

		if (callee.property.name === "module") {
			return resolveImportedTestGlobalName(sourceCode, callee.object, sources) === "mock";
		}

		return (
			MODULE_MOCK_METHODS.has(callee.property.name) &&
			MOCK_NAMESPACES.has(resolveTestGlobalName(sourceCode, callee.object, sources) ?? "")
		);
	}

	/**
	 * Determines whether a reference is made from inside a module mock factory,
	 * the one place a module-scope mock has to be reachable from.
	 *
	 * @param identifier - The referencing identifier.
	 * @returns `true` when the reference sits in a module mock factory.
	 */
	function isInsideModuleMockFactory(identifier: TSESTree.Node): boolean {
		let current = identifier;
		while (current.type !== AST_NODE_TYPES.Program) {
			const { parent } = current;
			// A function that is a direct child of a call is either its callee or
			// one of its arguments, so ruling out the callee leaves the factory.
			if (
				ASTUtils.isFunction(current) &&
				parent.type === AST_NODE_TYPES.CallExpression &&
				parent.callee !== current &&
				isModuleMockCall(parent)
			) {
				return true;
			}

			current = parent;
		}

		return false;
	}

	/**
	 * Determines whether a function is the body of a `describe` block, whose
	 * bindings outlive each of the tests declared inside it.
	 *
	 * @param node - The function to inspect.
	 * @returns `true` when the function is a suite body.
	 */
	function isSuiteCallback(node: TSESTree.Node): boolean {
		const { parent } = node;
		if (parent?.type !== AST_NODE_TYPES.CallExpression || parent.callee === node) {
			return false;
		}

		const root = getRootIdentifier(parent.callee);
		return (
			root !== null &&
			TEST_SUITE_NAMES.has(resolveTestGlobalName(sourceCode, root, sources) ?? "")
		);
	}

	/**
	 * Determines whether a binding is given a fresh mock from inside a narrower
	 * function — the `let mockFn; beforeEach(() => { mockFn = jest.fn(); })` shape
	 * and its initialized variant. The mock is rebuilt per test, so the binding
	 * carries nothing between them.
	 *
	 * @param variable - The binding to inspect.
	 * @param declarations - The identifiers that declare the binding.
	 * @param scope - The function the declaration itself is evaluated in.
	 * @returns `true` when a narrower function reassigns the binding to a mock.
	 */
	function isRebuiltPerTest(
		variable: TSESLint.Scope.Variable,
		declarations: ReadonlySet<TSESTree.Node>,
		scope: null | TSESTree.Node,
	): boolean {
		return variable.references.some(({ identifier, writeExpr }) => {
			return (
				writeExpr !== undefined &&
				writeExpr !== null &&
				!declarations.has(identifier) &&
				getEnclosingFunction(identifier) !== scope &&
				containsMockCreation(writeExpr, isMockCreation)
			);
		});
	}

	/**
	 * Determines whether a binding is read or written from anywhere but a module
	 * mock factory. A binding reachable only from such a factory is plumbing
	 * rather than shared state, and one that is never referenced is left to
	 * `no-unused-vars`.
	 *
	 * @param variable - The binding to inspect.
	 * @param declarations - The identifiers that declare the binding.
	 * @returns `true` when a test can observe the binding.
	 */
	function isObservable(
		variable: TSESLint.Scope.Variable,
		declarations: ReadonlySet<TSESTree.Node>,
	): boolean {
		return variable.references.some(({ identifier }) => {
			return !declarations.has(identifier) && !isInsideModuleMockFactory(identifier);
		});
	}

	/**
	 * Reports a declaration that creates a shared mock. The report goes on the
	 * declarator's binding pattern rather than on each variable it declares, since
	 * a mock nested in an opaque initializer cannot be attributed to one of them.
	 *
	 * @param declarator - The declarator to judge.
	 * @param scope - The function the declaration is evaluated in.
	 */
	function reportWhenShared(
		declarator: TSESTree.VariableDeclarator,
		scope: null | TSESTree.Node,
	): void {
		const variables = sourceCode.getDeclaredVariables(declarator);
		const declarations = new Set<TSESTree.Node>(
			variables.flatMap((variable) => variable.identifiers),
		);
		if (variables.some((variable) => isRebuiltPerTest(variable, declarations, scope))) {
			return;
		}

		if (!variables.some((variable) => isObservable(variable, declarations))) {
			return;
		}

		const { id } = declarator;
		if (id.type === AST_NODE_TYPES.Identifier) {
			context.report({ data: { name: id.name }, messageId: MESSAGE_ID, node: id });
			return;
		}

		context.report({ messageId: PATTERN_MESSAGE_ID, node: id });
	}

	return {
		before(): void {
			({ sourceCode } = context);
			sources = getTestGlobalSources(context.settings);
		},
		VariableDeclaration(node: TSESTree.VariableDeclaration): void {
			const scope = getEnclosingFunction(node);
			if (scope !== null && !isSuiteCallback(scope)) {
				return;
			}

			for (const declarator of node.declarations) {
				if (
					declarator.init === null ||
					!containsMockCreation(declarator.init, isMockCreation)
				) {
					continue;
				}

				reportWhenShared(declarator, scope);
			}
		},
	};
}

export const noSharedMocks = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow mocks created once and shared between tests",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
