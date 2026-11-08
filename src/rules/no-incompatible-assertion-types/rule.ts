import type {
	ParserServices,
	ParserServicesWithTypeInformation,
	TSESLint,
	TSESTree,
} from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { Type, TypeChecker } from "typescript";
import { TypeFlags } from "typescript";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";
import { type AssertImports, scanAssertImports } from "../../utils/assert-imports";
import { getTestGlobalSources, resolveTestGlobalName } from "../../utils/test-globals";

export const RULE_NAME = "no-incompatible-assertion-types";

const MESSAGE_ID = "incompatibleTypes";

export type MessageIds = typeof MESSAGE_ID;
export type Options = [];

const messages = {
	[MESSAGE_ID]:
		"This assertion compares `{{actual}}` with `{{expected}}`. Values of these types can never be equal, so the result is fixed.",
};

const EXPECT_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);

/**
 * How a Node `assert` method compares. `loose` methods coerce, so a `number`
 * can equal a `string`; only `strict` and `deep` comparisons are checked.
 * `deepEqual` is loose unless it comes from a `strict` module.
 */
type AssertKind = "loose" | "strict";

const ASSERT_METHODS: ReadonlyMap<string, AssertKind> = new Map([
	["deepEqual", "loose"],
	["deepStrictEqual", "strict"],
	["notDeepEqual", "loose"],
	["notDeepStrictEqual", "strict"],
	["notStrictEqual", "strict"],
	["strictEqual", "strict"],
]);
const ASSERT_METHOD_NAMES: ReadonlySet<string> = new Set(ASSERT_METHODS.keys());

/** Primitive families, as bits. `Unknown` stops the check. */
const Family = {
	BigInt: 1 << 0,
	Boolean: 1 << 1,
	Null: 1 << 2,
	Number: 1 << 3,
	Object: 1 << 4,
	String: 1 << 5,
	Symbol: 1 << 6,
	Undefined: 1 << 7,
	Unknown: 1 << 8,
} as const;

/** Families that can hold a value of another family, so they never report. */
const OPEN_FAMILIES = Family.Null | Family.Object | Family.Undefined | Family.Unknown;

const UNKNOWN_FLAGS =
	TypeFlags.Any | TypeFlags.Unknown | TypeFlags.TypeParameter | TypeFlags.IndexedAccess;

interface Assertion {
	readonly actual: TSESTree.Expression;
	readonly expected: TSESTree.Expression;
	readonly reportNode: TSESTree.Node;
}

function assertKind(method: string, strict: boolean): AssertKind | undefined {
	const kind = ASSERT_METHODS.get(method);
	return kind === "loose" && strict ? "strict" : kind;
}

function familyOf({ flags }: Type): number {
	if ((flags & UNKNOWN_FLAGS) !== 0) {
		return Family.Unknown;
	}

	if ((flags & TypeFlags.StringLike) !== 0) {
		return Family.String;
	}

	if ((flags & TypeFlags.NumberLike) !== 0) {
		return Family.Number;
	}

	if ((flags & TypeFlags.BooleanLike) !== 0) {
		return Family.Boolean;
	}

	if ((flags & TypeFlags.BigIntLike) !== 0) {
		return Family.BigInt;
	}

	if ((flags & TypeFlags.ESSymbolLike) !== 0) {
		return Family.Symbol;
	}

	if ((flags & TypeFlags.Null) !== 0) {
		return Family.Null;
	}

	if ((flags & (TypeFlags.Undefined | TypeFlags.Void)) !== 0) {
		return Family.Undefined;
	}

	if ((flags & TypeFlags.Object) !== 0) {
		return Family.Object;
	}

	return Family.Unknown;
}

/**
 * Maps each arm of a type to its family.
 *
 * @param type - The base type of an operand.
 * @returns A bit set of {@link Family} values.
 */
function familiesOf(type: Type): number {
	if (!type.isUnion()) {
		return familyOf(type);
	}

	let families = 0;
	for (const arm of type.types) {
		families |= familyOf(arm);
		if ((families & Family.Unknown) !== 0) {
			break;
		}
	}

	return families;
}

function hasTypeInformation(
	services: Partial<ParserServices> | undefined,
): services is ParserServicesWithTypeInformation {
	return services?.program !== undefined && services.program !== null;
}

function isSingleArgument(
	callArguments: ReadonlyArray<TSESTree.CallExpressionArgument>,
): callArguments is [TSESTree.Expression] {
	return callArguments.length === 1 && callArguments[0]?.type !== AST_NODE_TYPES.SpreadElement;
}

/**
 * Walks a member chain (`a.b.c` or `a?.b.c`) to the identifier it starts at.
 *
 * @param node - The expression to walk.
 * @returns The root identifier, or `null` when the chain starts elsewhere.
 */
function memberRoot(node: TSESTree.Node): null | TSESTree.Identifier {
	let current = node;
	for (;;) {
		if (current.type === AST_NODE_TYPES.ChainExpression) {
			current = current.expression;
		} else if (current.type === AST_NODE_TYPES.MemberExpression) {
			current = current.object;
		} else {
			return current.type === AST_NODE_TYPES.Identifier ? current : null;
		}
	}
}

function isPropertyNamed(node: TSESTree.Node, name: string): node is TSESTree.MemberExpression {
	return (
		node.type === AST_NODE_TYPES.MemberExpression &&
		!node.computed &&
		node.property.type === AST_NODE_TYPES.Identifier &&
		node.property.name === name
	);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let sourceCode: Readonly<TSESLint.SourceCode>;
	let services: ParserServicesWithTypeInformation;
	let checker: TypeChecker;
	let expectSources: ReadonlySet<string>;
	let assertImports: AssertImports;
	let patches: Map<string, Array<TSESTree.Identifier>>;
	let stableVariables: Map<TSESLint.Scope.Variable, boolean>;

	function resolve(identifier: TSESTree.Identifier): null | TSESLint.Scope.Variable {
		// Pass the name: with a node, `findVariable` searches the child scopes
		// again, and that costs more for each function in the scope.
		return findVariable(sourceCode.getScope(identifier), identifier.name);
	}

	/**
	 * Reads `expect(actual)[.not].matcher(expected)`. The shape is checked
	 * first, so the `expect` binding is only resolved for a matching call.
	 *
	 * @param node - The call to read.
	 * @returns The assertion, or `null` when the call is not one.
	 */
	function readExpectAssertion(node: TSESTree.CallExpression): Assertion | null {
		const { callee } = node;
		if (
			callee.type !== AST_NODE_TYPES.MemberExpression ||
			callee.computed ||
			callee.property.type !== AST_NODE_TYPES.Identifier ||
			!EXPECT_MATCHERS.has(callee.property.name) ||
			!isSingleArgument(node.arguments)
		) {
			return null;
		}

		let received = callee.object;
		if (isPropertyNamed(received, "not")) {
			received = received.object;
		}

		if (
			received.type !== AST_NODE_TYPES.CallExpression ||
			received.callee.type !== AST_NODE_TYPES.Identifier ||
			!isSingleArgument(received.arguments) ||
			resolveTestGlobalName(sourceCode, received.callee, expectSources) !== "expect"
		) {
			return null;
		}

		return {
			actual: received.arguments[0],
			expected: node.arguments[0],
			reportNode: callee.property,
		};
	}

	/**
	 * Reads a strict or deep Node `assert` call. The callee name is checked
	 * against the imported names first, so the binding is only resolved for a
	 * matching call.
	 *
	 * @param node - The call to read.
	 * @returns The assertion, or `null` when the call is not one.
	 */
	function readAssertAssertion(node: TSESTree.CallExpression): Assertion | null {
		const { callee } = node;
		let kind: AssertKind | undefined;
		if (callee.type === AST_NODE_TYPES.Identifier) {
			if (!assertImports.functionNames.has(callee.name)) {
				return null;
			}

			const variable = resolve(callee);
			const imported = variable === null ? undefined : assertImports.functions.get(variable);
			kind =
				imported === undefined ? undefined : assertKind(imported.method, imported.strict);
		} else if (
			callee.type === AST_NODE_TYPES.MemberExpression &&
			!callee.computed &&
			callee.property.type === AST_NODE_TYPES.Identifier &&
			ASSERT_METHODS.has(callee.property.name)
		) {
			// `assert.strict.deepEqual` is the strict variant of `deepEqual`.
			const strictMember = isPropertyNamed(callee.object, "strict") ? callee.object : null;
			const object = strictMember === null ? callee.object : strictMember.object;
			if (
				object.type !== AST_NODE_TYPES.Identifier ||
				!assertImports.objectNames.has(object.name)
			) {
				return null;
			}

			const variable = resolve(object);
			const strict = variable === null ? undefined : assertImports.objects.get(variable);
			kind =
				strict === undefined
					? undefined
					: assertKind(callee.property.name, strict || strictMember !== null);
		}

		if (kind !== "strict") {
			return null;
		}

		const [actual, expected] = node.arguments;
		if (
			actual === undefined ||
			expected === undefined ||
			actual.type === AST_NODE_TYPES.SpreadElement ||
			expected.type === AST_NODE_TYPES.SpreadElement
		) {
			return null;
		}

		return { actual, expected, reportNode: callee };
	}

	function baseType(node: TSESTree.Node): Type {
		return checker.getBaseTypeOfLiteralType(services.getTypeAtLocation(node));
	}

	/**
	 * Whether every write to a variable has a type with known families. A write
	 * of `any` (or of a type parameter) may store a value of any type, so the
	 * declared type of the variable proves nothing.
	 *
	 * @param variable - The variable to inspect.
	 * @returns True when no write can widen the variable.
	 */
	function isStable(variable: TSESLint.Scope.Variable): boolean {
		const cached = stableVariables.get(variable);
		if (cached !== undefined) {
			return cached;
		}

		let stable = true;
		for (const reference of variable.references) {
			if (!reference.isWrite()) {
				continue;
			}

			const { writeExpr } = reference;
			if (
				writeExpr === null ||
				writeExpr === undefined ||
				(familiesOf(baseType(writeExpr)) & Family.Unknown) !== 0
			) {
				stable = false;
				break;
			}
		}

		stableVariables.set(variable, stable);
		return stable;
	}

	/**
	 * Whether an operand can be trusted to have its checker type: an operand
	 * that reads a variable must not read one that a write widens, and a method
	 * call must not go through an object whose method was replaced earlier in
	 * the file.
	 *
	 * @param operand - The operand to inspect.
	 * @returns True when the checker type of the operand can be trusted.
	 */
	function isTrusted(operand: TSESTree.Expression): boolean {
		const call = operand.type === AST_NODE_TYPES.ChainExpression ? operand.expression : operand;
		if (
			patches.size > 0 &&
			call.type === AST_NODE_TYPES.CallExpression &&
			call.callee.type === AST_NODE_TYPES.MemberExpression
		) {
			const root = memberRoot(call.callee.object);
			const patchRoots = root === null ? undefined : patches.get(root.name);
			if (root !== null && patchRoots !== undefined) {
				const variable = resolve(root);
				if (variable !== null && patchRoots.some((patch) => resolve(patch) === variable)) {
					return false;
				}
			}
		}

		const root = memberRoot(operand);
		if (root === null) {
			return true;
		}

		const variable = resolve(root);
		return variable === null || isStable(variable);
	}

	function check({ actual, expected, reportNode }: Assertion): void {
		const actualType = baseType(actual);
		const actualFamilies = familiesOf(actualType);
		if ((actualFamilies & OPEN_FAMILIES) !== 0) {
			return;
		}

		const expectedType = baseType(expected);
		const expectedFamilies = familiesOf(expectedType);
		if (
			(expectedFamilies & OPEN_FAMILIES) !== 0 ||
			(actualFamilies & expectedFamilies) !== 0 ||
			!isTrusted(actual) ||
			!isTrusted(expected)
		) {
			return;
		}

		context.report({
			data: {
				actual: checker.typeToString(actualType),
				expected: checker.typeToString(expectedType),
			},
			messageId: MESSAGE_ID,
			node: reportNode,
		});
	}

	return {
		AssignmentExpression(node: TSESTree.AssignmentExpression): void {
			if (
				node.operator !== "=" ||
				node.left.type !== AST_NODE_TYPES.MemberExpression ||
				(node.right.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
					node.right.type !== AST_NODE_TYPES.FunctionExpression)
			) {
				return;
			}

			// Record the root by name only. The binding is resolved later, and
			// only for an assertion operand that calls a method on that name.
			const root = memberRoot(node.left.object);
			if (root !== null) {
				const roots = patches.get(root.name);
				if (roots === undefined) {
					patches.set(root.name, [root]);
				} else {
					roots.push(root);
				}
			}
		},
		before(): boolean {
			({ sourceCode } = context);
			const { parserServices } = sourceCode;
			if (!hasTypeInformation(parserServices)) {
				return false;
			}

			services = parserServices;
			checker = parserServices.program.getTypeChecker();
			expectSources = getTestGlobalSources(context.settings);
			assertImports = scanAssertImports(sourceCode, ASSERT_METHOD_NAMES);
			patches = new Map();
			stableVariables = new Map();
			return true;
		},
		CallExpression(node: TSESTree.CallExpression): void {
			const assertion = readExpectAssertion(node) ?? readAssertAssertion(node);
			if (assertion !== null) {
				check(assertion);
			}
		},
	};
}

export const noIncompatibleAssertionTypes: FlawlessRuleModule<Options, MessageIds> =
	createFlawlessRule<Options, MessageIds>({
		name: RULE_NAME,
		createOnce,
		defaultOptions: [],
		meta: {
			docs: {
				description:
					"Disallow equality assertions whose operands have types that can never be equal",
				recommended: false,
				requiresTypeChecking: true,
			},
			hasSuggestions: false,
			messages,
			schema: [],
			type: "problem",
		},
	});
