import { AST_NODE_TYPES, ASTUtils, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import {
	containsUnknownType,
	parameterAnnotation,
	parameterBinding,
	parameterName,
} from "../shared/function-parameters";

export const RULE_NAME = "no-unknown-parameters";

const CAUSE_NOT_RECORDED = "causeNotRecorded";
const UNKNOWN_PARAMETER = "unknownParameter";

export type MessageIds = typeof CAUSE_NOT_RECORDED | typeof UNKNOWN_PARAMETER;

type Options = [];

type Context = FlawlessRuleContext<MessageIds, Options>;

const CAUSE = "cause";

const messages = {
	[CAUSE_NOT_RECORDED]:
		"Parameter `cause` is `unknown` but this function never records it as an error cause. The name alone exempts nothing: the value itself must reach `new …(message, { cause })`, `super(message, { cause })`, or `error.cause = cause` in this function's body. Otherwise accept a named domain type, or parse the input at its I/O boundary.",
	[UNKNOWN_PARAMETER]:
		"Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function. The one exception is wrapping a caught error: a parameter named `cause` passed on as `new …(message, { cause })` or assigned to `error.cause`.",
};

type ParameterOwner =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression
	| TSESTree.TSCallSignatureDeclaration
	| TSESTree.TSConstructorType
	| TSESTree.TSConstructSignatureDeclaration
	| TSESTree.TSDeclareFunction
	| TSESTree.TSEmptyBodyFunctionExpression
	| TSESTree.TSFunctionType
	| TSESTree.TSMethodSignature;

/** A function whose body can record a cause. */
type Implementation =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

/**
 * Whether a parameter is the subject of its owner's type predicate: `x` in
 * `x is T` or `asserts x is T`, or a `this` parameter under `this is T`. A
 * guard is where narrowing happens, so it must accept the raw value.
 *
 * @param owner - The function or signature that declares the parameter.
 * @param name - The parameter's name.
 * @returns True when the predicate narrows this parameter.
 */
function isTypePredicateSubject(owner: ParameterOwner, name: string): boolean {
	const predicate = owner.returnType?.typeAnnotation;
	if (predicate?.type !== AST_NODE_TYPES.TSTypePredicate) {
		return false;
	}

	const subject = predicate.parameterName;
	if (subject.type === AST_NODE_TYPES.TSThisType) {
		return name === "this";
	}

	return subject.name === name;
}

/**
 * Climbs out of the type-only wrappers around an expression: `as`,
 * `satisfies`, `!`, and `<T>` assertions. They leave the runtime value as is.
 *
 * @param node - The expression to start from.
 * @returns The outermost wrapper, or the node itself when there is none.
 */
function outermostTypeWrapper(node: TSESTree.Node): TSESTree.Node {
	let current = node;
	while (
		(current.parent?.type === AST_NODE_TYPES.TSAsExpression ||
			current.parent?.type === AST_NODE_TYPES.TSNonNullExpression ||
			current.parent?.type === AST_NODE_TYPES.TSSatisfiesExpression ||
			current.parent?.type === AST_NODE_TYPES.TSTypeAssertion) &&
		current.parent.expression === current
	) {
		current = current.parent;
	}

	return current;
}

/**
 * Whether a property is the `cause` of an options object passed straight to a
 * construction: `new …(…, { cause })` or `super(…, { cause })`, the ES2022
 * `ErrorOptions` shape. Any constructor counts; checking for an Error-like
 * callee would need type information for no practical gain.
 *
 * @param property - The object literal property holding the value.
 * @returns True when the property fills a constructor's `cause` slot.
 */
function isCauseArgument(property: TSESTree.Property): boolean {
	const object = property.parent;
	if (object.type !== AST_NODE_TYPES.ObjectExpression) {
		return false;
	}

	const argument = outermostTypeWrapper(object);
	const call = argument.parent;
	if (
		call?.type !== AST_NODE_TYPES.NewExpression &&
		call?.type !== AST_NODE_TYPES.CallExpression
	) {
		return false;
	}

	if (call.type === AST_NODE_TYPES.CallExpression && call.callee.type !== AST_NODE_TYPES.Super) {
		return false;
	}

	return (
		(call.arguments as Array<TSESTree.Node>).includes(argument) &&
		ASTUtils.getPropertyName(property) === CAUSE
	);
}

/**
 * Whether a reference hands the value on unchanged into a cause slot: the
 * `cause` of a construction's options object, or the right side of a plain
 * `=` to a `.cause` member. `??=` and friends may drop the value, so they do
 * not count. Type-only wrappers on the value or the options object do not
 * change the value, so they are looked through.
 *
 * @param reference - One read of the `cause` parameter.
 * @returns True when this read records the value as an error cause.
 */
function isCauseSlot(reference: TSESTree.Identifier | TSESTree.JSXIdentifier): boolean {
	const value = outermostTypeWrapper(reference);
	const { parent } = value;
	if (parent?.type === AST_NODE_TYPES.Property) {
		return parent.value === value && isCauseArgument(parent);
	}

	return (
		parent?.type === AST_NODE_TYPES.AssignmentExpression &&
		parent.operator === "=" &&
		parent.right === value &&
		parent.left.type === AST_NODE_TYPES.MemberExpression &&
		ASTUtils.getPropertyName(parent.left) === CAUSE
	);
}

/**
 * Whether an implementation records the parameter at an index as an error
 * cause. That parameter must be a plain `cause` binding (a default value is
 * fine) whose own variable — so a shadowing `cause` does not count — reaches a
 * cause slot and is never written again, so the recorded value is the one the
 * caller passed. A `cause` parameter property is that same assignment to
 * `this.cause`.
 *
 * @param context - The rule context.
 * @param implementation - The function whose body is searched.
 * @param index - The position of the parameter.
 * @returns True when the parameter is recorded as an error cause.
 */
function recordsCause(context: Context, implementation: Implementation, index: number): boolean {
	const parameter = implementation.params[index];
	if (parameter === undefined || parameter.type === AST_NODE_TYPES.RestElement) {
		return false;
	}

	const binding = parameterBinding(parameter);
	if (binding.type !== AST_NODE_TYPES.Identifier || binding.name !== CAUSE) {
		return false;
	}

	if (parameter.type === AST_NODE_TYPES.TSParameterProperty) {
		return true;
	}

	const variable = context.sourceCode
		.getDeclaredVariables(implementation)
		.find((declared) => declared.identifiers.includes(binding));

	if (variable === undefined) {
		return false;
	}

	// A default value is the parameter's own initializer; any other write
	// replaces the caller's value before it can be recorded.
	const isReassigned = variable.references.some(
		(reference) => reference.isWrite() && reference.init !== true,
	);

	return (
		!isReassigned && variable.references.some((reference) => isCauseSlot(reference.identifier))
	);
}

/**
 * The statements a function declaration sits among, looking through an
 * `export` wrapper: a block, a module or namespace body, a class `static`
 * block, or a `case` clause.
 *
 * @param node - The function declaration or overload signature.
 * @returns The sibling statements, or undefined outside a statement list.
 */
function siblingStatements(
	node: TSESTree.FunctionDeclaration | TSESTree.TSDeclareFunction,
): Array<TSESTree.Node> | undefined {
	const statement =
		node.parent.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
		node.parent.type === AST_NODE_TYPES.ExportNamedDeclaration
			? node.parent
			: node;
	const container = statement.parent;
	if (
		container.type === AST_NODE_TYPES.BlockStatement ||
		container.type === AST_NODE_TYPES.Program ||
		container.type === AST_NODE_TYPES.StaticBlock ||
		container.type === AST_NODE_TYPES.TSModuleBlock
	) {
		return container.body;
	}

	if (container.type === AST_NODE_TYPES.SwitchCase) {
		return container.consequent;
	}

	return undefined;
}

function unwrapExport(statement: TSESTree.Node): TSESTree.Node {
	if (
		(statement.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
			statement.type === AST_NODE_TYPES.ExportNamedDeclaration) &&
		statement.declaration
	) {
		return statement.declaration;
	}

	return statement;
}

/**
 * The implementation that follows a function overload signature: the
 * function declaration with the same name in the same statement list. An
 * ambient `declare function` has none.
 *
 * @param signature - The overload signature.
 * @returns The implementation, or undefined when there is none.
 */
function functionImplementation(
	signature: TSESTree.TSDeclareFunction,
): TSESTree.FunctionDeclaration | undefined {
	if (signature.declare) {
		return undefined;
	}

	const name = signature.id?.name;
	for (const statement of siblingStatements(signature) ?? []) {
		const candidate = unwrapExport(statement);
		if (candidate.type === AST_NODE_TYPES.FunctionDeclaration && candidate.id?.name === name) {
			return candidate;
		}
	}

	return undefined;
}

/**
 * The implementation that follows a method overload signature: the method of
 * the same class with the same static name, kind and placement that has a
 * body. `#wrap` and `wrap` share a property name but are different methods,
 * so the key kind must match too. An abstract method or a `declare class` member has none.
 *
 * @param signature - The body-less method function.
 * @returns The implementation, or undefined when there is none.
 */
function methodImplementation(
	signature: TSESTree.TSEmptyBodyFunctionExpression,
): TSESTree.FunctionExpression | undefined {
	const method = signature.parent;
	if (method.type !== AST_NODE_TYPES.MethodDefinition) {
		return undefined;
	}

	const name = ASTUtils.getPropertyName(method);
	if (name === null) {
		return undefined;
	}

	for (const member of method.parent.body) {
		if (
			member.type === AST_NODE_TYPES.MethodDefinition &&
			member.value.type === AST_NODE_TYPES.FunctionExpression &&
			member.kind === method.kind &&
			member.static === method.static &&
			(member.key.type === AST_NODE_TYPES.PrivateIdentifier) ===
				(method.key.type === AST_NODE_TYPES.PrivateIdentifier) &&
			ASTUtils.getPropertyName(member) === name
		) {
			return member.value;
		}
	}

	return undefined;
}

/**
 * The function body that decides whether a `cause` parameter is recorded. An
 * overload signature defers to its implementation, which receives the value
 * at the same position. Every other body-less signature has nowhere to record
 * a cause.
 *
 * @param owner - The function or signature that declares the parameter.
 * @returns The function to search, or undefined when there is none.
 */
function causeRecorder(owner: ParameterOwner): Implementation | undefined {
	switch (owner.type) {
		case AST_NODE_TYPES.ArrowFunctionExpression:
		case AST_NODE_TYPES.FunctionDeclaration:
		case AST_NODE_TYPES.FunctionExpression: {
			return owner;
		}
		case AST_NODE_TYPES.TSCallSignatureDeclaration:
		case AST_NODE_TYPES.TSConstructorType:
		case AST_NODE_TYPES.TSConstructSignatureDeclaration:
		case AST_NODE_TYPES.TSFunctionType:
		case AST_NODE_TYPES.TSMethodSignature: {
			return undefined;
		}
		case AST_NODE_TYPES.TSDeclareFunction: {
			return functionImplementation(owner);
		}
		case AST_NODE_TYPES.TSEmptyBodyFunctionExpression: {
			return methodImplementation(owner);
		}
	}
}

function isRecordedCause(context: Context, owner: ParameterOwner, index: number): boolean {
	const recorder = causeRecorder(owner);
	return recorder !== undefined && recordsCause(context, recorder, index);
}

function createOnce(context: Context): FlawlessRuleListener {
	function checkParameters(owner: ParameterOwner): void {
		for (const [index, parameter] of owner.params.entries()) {
			const annotation = parameterAnnotation(parameter);
			if (annotation === undefined || !containsUnknownType(annotation.typeAnnotation)) {
				continue;
			}

			const name = parameterName(parameter, context.sourceCode);
			if (isTypePredicateSubject(owner, name)) {
				continue;
			}

			const isPlainCause =
				name === CAUSE &&
				parameter.type !== AST_NODE_TYPES.RestElement &&
				parameterBinding(parameter).type === AST_NODE_TYPES.Identifier;
			if (isPlainCause) {
				if (!isRecordedCause(context, owner, index)) {
					context.report({
						messageId: CAUSE_NOT_RECORDED,
						node: annotation.typeAnnotation,
					});
				}

				continue;
			}

			context.report({
				data: { parameter: name },
				messageId: UNKNOWN_PARAMETER,
				node: annotation.typeAnnotation,
			});
		}
	}

	return {
		ArrowFunctionExpression: checkParameters,
		FunctionDeclaration: checkParameters,
		FunctionExpression: checkParameters,
		TSCallSignatureDeclaration: checkParameters,
		TSConstructorType: checkParameters,
		TSConstructSignatureDeclaration: checkParameters,
		TSDeclareFunction: checkParameters,
		TSEmptyBodyFunctionExpression: checkParameters,
		TSFunctionType: checkParameters,
		TSMethodSignature: checkParameters,
	};
}

export const noUnknownParameters = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Disallow `unknown` function parameters outside type-predicate subjects and recorded error causes",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: undefined,
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
