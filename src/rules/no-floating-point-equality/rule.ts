import { AST_NODE_TYPES, TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";
import { scanAssertImports } from "../../utils/assert-imports";
import { getTestGlobalSources, resolveTestGlobalName } from "../../utils/test-globals";

export const RULE_NAME = "no-floating-point-equality";

const MESSAGE_ID = "noExactFloatEquality";

export type MessageIds = typeof MESSAGE_ID;
export type Options = [];

const ASSERT_METHODS = new Set([
	"deepEqual",
	"deepStrictEqual",
	"notDeepEqual",
	"notDeepStrictEqual",
	"notStrictEqual",
	"strictEqual",
]);
const EXPECT_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);
const EXPECT_MODIFIERS = new Set(["rejects", "resolves"]);
const EXPECT_VARIANTS = new Set(["poll", "soft"]);
const EQUALITY_OPERATORS = new Set(["!=", "!==", "==", "==="]);
const CONSTANT_OPERATORS = new Set(["%", "*", "**", "+", "-", "/"]);
const PROPAGATING_OPERATORS = new Set(["%", "*", "**", "+", "-"]);
const INCLUSIVE_OPERATORS = new Set(["<=", ">="]);
const EXCLUSIVE_OPERATORS = new Set(["<", ">"]);
const DECIMAL_PATTERN = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/u;

const messages = {
	[MESSAGE_ID]:
		"Do not check floating point equality or inequality with exact values, use a range instead.",
};

type NumericValue = null | number;
type ConstState = "visiting" | boolean;

interface Orientation {
	readonly expression: TSESTree.Expression;
	readonly isAbove: boolean;
	readonly threshold: TSESTree.Expression;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let first = left;
	let second = right;
	while (second !== 0n) {
		const remainder = first % second;
		first = second;
		second = remainder;
	}

	return first;
}

function isPowerOfTwo(value: bigint): boolean {
	return value > 0n && (value & (value - 1n)) === 0n;
}

/**
 * Checks the exact fraction described by source text, before JavaScript rounds
 * it to a runtime number.
 * @param raw - Normalized decimal literal source text.
 * @returns Whether the decimal fraction has an exact binary representation.
 */
function isExactlyRepresentableDecimal(raw: string): boolean {
	const match = DECIMAL_PATTERN.exec(raw);
	if (match === null) {
		return false;
	}

	const fractionalPart = match[2] ?? "";
	const digits = `${match[1] ?? ""}${fractionalPart}`;
	if (digits.length === 0) {
		return false;
	}

	const exponent = Number(match[3] ?? 0) - fractionalPart.length;
	const numerator = BigInt(digits);
	if (numerator === 0n || exponent >= 0) {
		return true;
	}

	const denominator = 10n ** BigInt(-exponent);
	return isPowerOfTwo(denominator / greatestCommonDivisor(numerator, denominator));
}

function isExactIntegerDivision(left: number, right: number): boolean {
	if (right === 0 || !Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
		return false;
	}

	const numerator = BigInt(Math.abs(left));
	const denominator = BigInt(Math.abs(right));
	return isPowerOfTwo(denominator / greatestCommonDivisor(numerator, denominator));
}

function isNumberLiteral(node: TSESTree.Node): node is TSESTree.NumberLiteral {
	return node.type === AST_NODE_TYPES.Literal && typeof node.value === "number";
}

function numericLiteralValue(node: TSESTree.Node): NumericValue {
	if (isNumberLiteral(node)) {
		return node.value;
	}

	if (
		node.type === AST_NODE_TYPES.UnaryExpression &&
		(node.operator === "+" || node.operator === "-") &&
		isNumberLiteral(node.argument)
	) {
		return node.operator === "-" ? -node.argument.value : node.argument.value;
	}

	return null;
}

function evaluateBinary(operator: string, left: number, right: number): NumericValue {
	switch (operator) {
		case "%": {
			return right === 0 ? null : left % right;
		}
		case "*": {
			return left * right;
		}
		case "**": {
			return left ** right;
		}
		case "+": {
			return left + right;
		}
		case "-": {
			return left - right;
		}
		case "/": {
			return right === 0 ? null : left / right;
		}
		default: {
			return null;
		}
	}
}

function propertyName(node: TSESTree.MemberExpression): null | string {
	if (!node.computed && node.property.type === AST_NODE_TYPES.Identifier) {
		return node.property.name;
	}

	if (
		node.computed &&
		node.property.type === AST_NODE_TYPES.Literal &&
		typeof node.property.value === "string"
	) {
		return node.property.value;
	}

	return null;
}

function orientations(node: TSESTree.BinaryExpression): Array<Orientation> {
	if (node.operator === "<" || node.operator === "<=") {
		return [
			{ expression: node.left, isAbove: false, threshold: node.right },
			{ expression: node.right, isAbove: true, threshold: node.left },
		];
	}

	if (node.operator === ">" || node.operator === ">=") {
		return [
			{ expression: node.left, isAbove: true, threshold: node.right },
			{ expression: node.right, isAbove: false, threshold: node.left },
		];
	}

	return [];
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let sourceCode: Readonly<TSESLint.SourceCode>;
	let assertObjectVariables: ReadonlyMap<TSESLint.Scope.Variable, unknown>;
	let assertFunctionVariables: ReadonlyMap<TSESLint.Scope.Variable, unknown>;
	let resolvedVariables: WeakMap<TSESTree.Identifier, null | TSESLint.Scope.Variable>;
	let numericValues: WeakMap<TSESTree.Node, NumericValue>;
	let sensitiveExpressions: WeakMap<TSESTree.Node, boolean>;
	let literalSensitivity: Map<string, boolean>;
	let constStates: Map<TSESLint.Scope.Variable, ConstState>;
	let tokenSequences: WeakMap<TSESTree.Node, ReadonlyArray<string>>;
	let expectSources: ReadonlySet<string>;

	function resolveVariable(identifier: TSESTree.Identifier): null | TSESLint.Scope.Variable {
		const cached = resolvedVariables.get(identifier);
		if (cached !== undefined) {
			return cached;
		}

		let scope: null | TSESLint.Scope.Scope = sourceCode.getScope(identifier);
		while (scope !== null) {
			const variable = scope.set.get(identifier.name);
			if (
				variable !== undefined &&
				(variable as { isValueVariable?: boolean }).isValueVariable !== false
			) {
				resolvedVariables.set(identifier, variable);
				return variable;
			}

			scope = scope.upper;
		}

		resolvedVariables.set(identifier, null);
		return null;
	}

	function isImportedBinding(
		identifier: TSESTree.Identifier,
		variables: ReadonlyMap<TSESLint.Scope.Variable, unknown>,
	): boolean {
		const variable = resolveVariable(identifier);
		return variable !== null && variables.has(variable);
	}

	function indexReferences(variable: TSESLint.Scope.Variable): void {
		for (const reference of variable.references) {
			if (reference.identifier.type === AST_NODE_TYPES.Identifier) {
				resolvedVariables.set(reference.identifier, variable);
			}
		}
	}

	function numericExpressionValue(node: TSESTree.Node): NumericValue {
		const cached = numericValues.get(node);
		if (cached !== undefined) {
			return cached;
		}

		let value = numericLiteralValue(node);
		if (
			value === null &&
			node.type === AST_NODE_TYPES.BinaryExpression &&
			CONSTANT_OPERATORS.has(node.operator)
		) {
			const left = numericExpressionValue(node.left);
			const right = numericExpressionValue(node.right);
			if (left !== null && right !== null) {
				value = evaluateBinary(node.operator, left, right);
			}
		}

		numericValues.set(node, value);
		return value;
	}

	function isFloatingPointLiteral(node: TSESTree.NumberLiteral): boolean {
		const raw = node.raw.replaceAll("_", "").toLowerCase();
		const cached = literalSensitivity.get(raw);
		if (cached !== undefined) {
			return cached;
		}

		const sensitive =
			(raw.includes(".") || raw.includes("e")) &&
			DECIMAL_PATTERN.test(raw) &&
			!isExactlyRepresentableDecimal(raw);
		literalSensitivity.set(raw, sensitive);
		return sensitive;
	}

	function isFractionProducingDivision(node: TSESTree.BinaryExpression): boolean {
		const left = numericLiteralValue(node.left);
		const right = numericLiteralValue(node.right);
		if (left === null || right === null || right === 0) {
			return false;
		}

		return (
			Number.isInteger(left) &&
			!Number.isInteger(left / right) &&
			!isExactIntegerDivision(left, right)
		);
	}

	function isFloatingPointConst(identifier: TSESTree.Identifier): boolean {
		const variable = resolveVariable(identifier);
		if (variable === null) {
			return false;
		}

		const cached = constStates.get(variable);
		if (cached !== undefined) {
			return cached === "visiting" ? false : cached;
		}

		const definition = variable.defs[0];
		if (
			variable.defs.length !== 1 ||
			definition?.type !== TSESLint.Scope.DefinitionType.Variable ||
			definition.node.id.type !== AST_NODE_TYPES.Identifier ||
			definition.node.init === null ||
			definition.parent.kind !== "const"
		) {
			constStates.set(variable, false);
			return false;
		}

		constStates.set(variable, "visiting");
		const sensitive = isFloatingPointSensitive(definition.node.init);
		constStates.set(variable, sensitive);
		return sensitive;
	}

	function isFloatingPointSensitive(node: TSESTree.Node): boolean {
		const cached = sensitiveExpressions.get(node);
		if (cached !== undefined) {
			return cached;
		}

		let sensitive = false;
		if (isNumberLiteral(node)) {
			sensitive = isFloatingPointLiteral(node);
		} else if (
			node.type === AST_NODE_TYPES.UnaryExpression &&
			(node.operator === "+" || node.operator === "-")
		) {
			sensitive = isFloatingPointSensitive(node.argument);
		} else if (node.type === AST_NODE_TYPES.BinaryExpression) {
			const numericValue = numericExpressionValue(node);
			if (!Number.isSafeInteger(numericValue)) {
				sensitive =
					node.operator === "/"
						? isFloatingPointSensitive(node.left) ||
							isFloatingPointSensitive(node.right) ||
							isFractionProducingDivision(node)
						: PROPAGATING_OPERATORS.has(node.operator) &&
							(isFloatingPointSensitive(node.left) ||
								isFloatingPointSensitive(node.right));
			}
		} else if (node.type === AST_NODE_TYPES.Identifier) {
			sensitive = isFloatingPointConst(node);
		}

		sensitiveExpressions.set(node, sensitive);
		return sensitive;
	}

	function tokenSequence(node: TSESTree.Node): ReadonlyArray<string> {
		const cached = tokenSequences.get(node);
		if (cached !== undefined) {
			return cached;
		}

		const sequence = sourceCode.getTokens(node).map((token) => token.value);
		tokenSequences.set(node, sequence);
		return sequence;
	}

	function isEquivalent(left: TSESTree.Node, right: TSESTree.Node): boolean {
		if (left.type !== right.type) {
			return false;
		}

		const leftTokens = tokenSequence(left);
		const rightTokens = tokenSequence(right);
		return (
			leftTokens.length === rightTokens.length &&
			leftTokens.every((value, index) => value === rightTokens[index])
		);
	}

	function isIndirectExactComparison(node: TSESTree.LogicalExpression): boolean {
		let accepted: null | ReadonlySet<string> = null;
		if (node.operator === "&&") {
			accepted = INCLUSIVE_OPERATORS;
		} else if (node.operator === "||") {
			accepted = EXCLUSIVE_OPERATORS;
		}

		if (
			accepted === null ||
			node.left.type !== AST_NODE_TYPES.BinaryExpression ||
			node.right.type !== AST_NODE_TYPES.BinaryExpression ||
			!accepted.has(node.left.operator) ||
			!accepted.has(node.right.operator)
		) {
			return false;
		}

		for (const left of orientations(node.left)) {
			for (const right of orientations(node.right)) {
				if (
					left.isAbove !== right.isAbove &&
					isEquivalent(left.expression, right.expression) &&
					isEquivalent(left.threshold, right.threshold) &&
					(isFloatingPointSensitive(left.expression) ||
						isFloatingPointSensitive(left.threshold))
				) {
					return true;
				}
			}
		}

		return false;
	}

	function isAsymmetricMatcher(node: TSESTree.Expression): boolean {
		return (
			node.type === AST_NODE_TYPES.CallExpression &&
			node.callee.type === AST_NODE_TYPES.MemberExpression &&
			node.callee.object.type === AST_NODE_TYPES.Identifier &&
			resolveTestGlobalName(sourceCode, node.callee.object, expectSources) === "expect"
		);
	}

	function isExpectCallee(callee: TSESTree.Expression): boolean {
		if (callee.type === AST_NODE_TYPES.Identifier) {
			return resolveTestGlobalName(sourceCode, callee, expectSources) === "expect";
		}

		return (
			callee.type === AST_NODE_TYPES.MemberExpression &&
			callee.object.type === AST_NODE_TYPES.Identifier &&
			EXPECT_VARIANTS.has(propertyName(callee) ?? "") &&
			resolveTestGlobalName(sourceCode, callee.object, expectSources) === "expect"
		);
	}

	function expectArguments(node: TSESTree.CallExpression): null | ReadonlyArray<TSESTree.Node> {
		const member = node.callee;
		if (
			member.type !== AST_NODE_TYPES.MemberExpression ||
			!EXPECT_MATCHERS.has(propertyName(member) ?? "") ||
			node.arguments.length === 0
		) {
			return null;
		}

		let received = member.object;
		let hasNot = false;
		let hasModifier = false;
		while (received.type === AST_NODE_TYPES.MemberExpression) {
			const name = propertyName(received) ?? "";
			if (name === "not" && !hasNot) {
				hasNot = true;
			} else if (!hasModifier && EXPECT_MODIFIERS.has(name)) {
				hasModifier = true;
			} else {
				return null;
			}

			received = received.object;
		}

		if (
			received.type !== AST_NODE_TYPES.CallExpression ||
			received.arguments.length === 0 ||
			!isExpectCallee(received.callee)
		) {
			return null;
		}

		const actual = received.arguments[0];
		const expected = node.arguments[0];
		if (
			actual === undefined ||
			expected === undefined ||
			actual.type === AST_NODE_TYPES.SpreadElement ||
			expected.type === AST_NODE_TYPES.SpreadElement ||
			isAsymmetricMatcher(expected)
		) {
			return null;
		}

		return [actual, expected];
	}

	function assertArguments(node: TSESTree.CallExpression): null | ReadonlyArray<TSESTree.Node> {
		if (node.arguments.length < 2) {
			return null;
		}

		let recognized = false;
		if (node.callee.type === AST_NODE_TYPES.Identifier) {
			if (assertFunctionVariables.size === 0) {
				return null;
			}

			recognized = isImportedBinding(node.callee, assertFunctionVariables);
		} else if (
			node.callee.type === AST_NODE_TYPES.MemberExpression &&
			ASSERT_METHODS.has(propertyName(node.callee) ?? "") &&
			node.callee.object.type === AST_NODE_TYPES.Identifier
		) {
			if (assertObjectVariables.size === 0) {
				return null;
			}

			recognized = isImportedBinding(node.callee.object, assertObjectVariables);
		}

		const [actual, expected] = node.arguments;
		if (
			!recognized ||
			actual === undefined ||
			expected === undefined ||
			actual.type === AST_NODE_TYPES.SpreadElement ||
			expected.type === AST_NODE_TYPES.SpreadElement
		) {
			return null;
		}

		return [actual, expected];
	}

	function report(node: TSESTree.Node): void {
		context.report({ messageId: MESSAGE_ID, node });
	}

	return {
		before(): void {
			({ sourceCode } = context);
			resolvedVariables = new WeakMap();
			numericValues = new WeakMap();
			sensitiveExpressions = new WeakMap();
			literalSensitivity = new Map();
			constStates = new Map();
			tokenSequences = new WeakMap();
			expectSources = getTestGlobalSources(context.settings);
			const assertImports = scanAssertImports(sourceCode, ASSERT_METHODS);
			assertObjectVariables = assertImports.objects;
			assertFunctionVariables = assertImports.functions;
			for (const variable of assertObjectVariables.keys()) {
				indexReferences(variable);
			}

			for (const variable of assertFunctionVariables.keys()) {
				indexReferences(variable);
			}
		},
		BinaryExpression(node): void {
			if (
				EQUALITY_OPERATORS.has(node.operator) &&
				(isFloatingPointSensitive(node.left) || isFloatingPointSensitive(node.right))
			) {
				report(node);
			}
		},
		CallExpression(node): void {
			const argumentsToCheck = expectArguments(node) ?? assertArguments(node);
			if (argumentsToCheck?.some(isFloatingPointSensitive) === true) {
				report(node);
			}
		},
		LogicalExpression(node): void {
			if (isIndirectExactComparison(node)) {
				report(node);
			}
		},
		SwitchCase(node): void {
			if (node.test !== null && isFloatingPointSensitive(node.test)) {
				report(node.test);
			}
		},
	};
}

export const noFloatingPointEquality: FlawlessRuleModule<Options, MessageIds> = createFlawlessRule<
	Options,
	MessageIds
>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow exact equality checks involving floating-point-sensitive values",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
