import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES, TSESLint } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import type { TypeEnvironment, WideningTarget } from "../shared/dictionary-types";
import {
	classifyUnsafeDictionaryValue,
	classifyWideningTarget,
	createTypeEnvironment,
	isKnownEvidenceExpression,
	unwrapAssertedExpression,
} from "../shared/dictionary-types";
import {
	containsUnknownType,
	parameterAnnotation,
	parameterBinding,
	parameterName,
} from "../shared/function-parameters";

export const RULE_NAME = "no-known-value-widening";

const MESSAGE_ID = "widening";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"The known initializer supplying {{subject}} carries established type evidence, but the explicit {{target}} target type discards it. Preserve inference, use `satisfies`, or introduce/use a named owner contract; parse genuinely external data once at its boundary.",
};

/** Where a value flows, and the declarations needed to judge the target. */
interface FlowTarget {
	readonly destination: WideningTarget;
	readonly environment: TypeEnvironment;
}

type FunctionNode =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression
	| TSESTree.TSDeclareFunction;

/**
 * Resolves an identifier to the variable it references, walking outwards from
 * the identifier's own scope so the nearest binding wins.
 *
 * @param sourceCode - The source code of the linted file.
 * @param identifier - The referencing identifier.
 * @returns The resolved variable, or null when the name is not bound.
 */
function resolveVariable(
	sourceCode: Readonly<TSESLint.SourceCode>,
	identifier: TSESTree.Identifier,
): null | TSESLint.Scope.Variable {
	let scope: null | TSESLint.Scope.Scope = sourceCode.getScope(identifier);
	while (scope !== null) {
		const variable = scope.set.get(identifier.name);
		if (variable !== undefined) {
			return variable;
		}

		scope = scope.upper;
	}

	return null;
}

/**
 * The single declarator a variable comes from. A name declared more than once
 * has no one initializer to reason about, so it is rejected.
 *
 * @param variable - The variable to inspect.
 * @returns The declarator, or null when the variable is not a plain binding.
 */
function variableDeclarator(variable: TSESLint.Scope.Variable): null | TSESTree.VariableDeclarator {
	if (variable.defs.length !== 1) {
		return null;
	}

	const [definition] = variable.defs;
	return definition?.type === TSESLint.Scope.DefinitionType.Variable ? definition.node : null;
}

/**
 * Whether a binding still holds its initializer everywhere it is read: declared
 * `const`, and written only by that initializer.
 *
 * @param variable - The variable to inspect.
 * @param declarator - Where the variable is declared.
 * @returns True when the initializer's evidence survives to every reference.
 */
function isStableConstVariable(
	variable: TSESLint.Scope.Variable,
	declarator: TSESTree.VariableDeclarator,
): boolean {
	return (
		declarator.parent.kind === "const" &&
		variable.references.every((reference) => reference.init === true || !reference.isWrite())
	);
}

function isFunctionNode(node: TSESTree.Node): node is FunctionNode {
	return (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionDeclaration ||
		node.type === AST_NODE_TYPES.FunctionExpression ||
		node.type === AST_NODE_TYPES.TSDeclareFunction
	);
}

/**
 * The function a call invokes, when it is declared in this file under a single
 * binding: an inline function, a function declaration, or a variable
 * initialized with a function.
 *
 * @param sourceCode - The source code of the linted file.
 * @param callee - The expression being invoked.
 * @returns The called function, or null when it is not locally known.
 */
function localFunctionForCall(
	sourceCode: Readonly<TSESLint.SourceCode>,
	callee: TSESTree.Expression,
): FunctionNode | null {
	const unwrapped = unwrapAssertedExpression(callee);
	if (isFunctionNode(unwrapped)) {
		return unwrapped;
	}

	if (unwrapped.type !== AST_NODE_TYPES.Identifier) {
		return null;
	}

	const variable = resolveVariable(sourceCode, unwrapped);
	if (variable?.defs.length !== 1) {
		return null;
	}

	const [definition] = variable.defs;
	if (definition?.type === TSESLint.Scope.DefinitionType.FunctionName) {
		return isFunctionNode(definition.node) ? definition.node : null;
	}

	if (
		definition?.type !== TSESLint.Scope.DefinitionType.Variable ||
		definition.node.init === null
	) {
		return null;
	}

	const initializer = unwrapAssertedExpression(definition.node.init);
	return isFunctionNode(initializer) ? initializer : null;
}

/**
 * The annotation a variable or parameter is declared with, which fixes its type
 * independently of whatever value it is later given.
 *
 * @param variable - The variable to inspect.
 * @returns The binding's annotation, or null when it has none.
 */
function variableTypeAnnotation(
	variable: TSESLint.Scope.Variable,
): null | TSESTree.TSTypeAnnotation {
	if (variable.defs.length !== 1) {
		return null;
	}

	const [definition] = variable.defs;
	if (
		definition?.type !== TSESLint.Scope.DefinitionType.Variable &&
		definition?.type !== TSESLint.Scope.DefinitionType.Parameter
	) {
		return null;
	}

	return definition.name.typeAnnotation ?? null;
}

function hasInformativeType(type: TSESTree.TypeNode, environment: TypeEnvironment): boolean {
	return classifyUnsafeDictionaryValue(type, environment) === null;
}

/**
 * Whether a call argument carries type evidence of its own. Beyond literal
 * evidence, an annotated binding, an assertion, or a local call contributes its
 * declared type, provided that type is not itself an escape hatch.
 *
 * @param sourceCode - The source code of the linted file.
 * @param expression - The value passed to the predicate.
 * @param environment - The file's type declarations.
 * @param visitedVariables - Bindings already followed, guarding against cycles.
 * @returns True when the argument's type is already established.
 */
function hasKnownCallArgumentEvidence(
	sourceCode: Readonly<TSESLint.SourceCode>,
	expression: TSESTree.Expression,
	environment: TypeEnvironment,
	visitedVariables = new Set<TSESLint.Scope.Variable>(),
): boolean {
	if (
		expression.type === AST_NODE_TYPES.TSNonNullExpression ||
		expression.type === AST_NODE_TYPES.TSSatisfiesExpression
	) {
		return hasKnownCallArgumentEvidence(
			sourceCode,
			expression.expression,
			environment,
			visitedVariables,
		);
	}

	if (
		expression.type === AST_NODE_TYPES.TSAsExpression ||
		expression.type === AST_NODE_TYPES.TSTypeAssertion
	) {
		return hasInformativeType(expression.typeAnnotation, environment);
	}

	if (expression.type === AST_NODE_TYPES.CallExpression) {
		const returnType = localFunctionForCall(sourceCode, expression.callee)?.returnType;
		return (
			returnType !== undefined && hasInformativeType(returnType.typeAnnotation, environment)
		);
	}

	if (expression.type !== AST_NODE_TYPES.Identifier) {
		return isKnownEvidenceExpression(expression);
	}

	const variable = resolveVariable(sourceCode, expression);
	if (variable === null || visitedVariables.has(variable)) {
		return false;
	}

	const annotation = variableTypeAnnotation(variable);
	if (annotation !== null) {
		return hasInformativeType(annotation.typeAnnotation, environment);
	}

	const declarator = variableDeclarator(variable);
	if (declarator === null || !isStableConstVariable(variable, declarator)) {
		return false;
	}

	if (declarator.init === null) {
		return false;
	}

	visitedVariables.add(variable);
	return hasKnownCallArgumentEvidence(sourceCode, declarator.init, environment, visitedVariables);
}

function isEmptyObjectExpression(expression: TSESTree.Expression): boolean {
	const unwrapped = unwrapAssertedExpression(expression);
	return unwrapped.type === AST_NODE_TYPES.ObjectExpression && unwrapped.properties.length === 0;
}

function isDictionaryAccumulatorTarget(destination: WideningTarget): boolean {
	return destination.kind === "generic container" || destination.kind === "open dictionary";
}

/**
 * Whether a target discards every declared type outright. A declared type
 * flowing into a dictionary or anonymous object is a type-to-type conversion
 * that cannot be judged syntactically, so only these targets discard it.
 *
 * @param destination - The explicit target type.
 * @returns True for the `unknown` and `object` escape hatches.
 */
function discardsDeclaredType(destination: WideningTarget): boolean {
	return destination.kind === "object" || destination.kind === "unknown";
}

/**
 * Whether a value flowing into a target carries type evidence the target
 * discards. Stable `const` bindings are followed back to the literal that
 * seeded them, but an annotated binding stops the walk: its annotation already
 * fixed the type, so its evidence is the annotation, not the initializer. The
 * declarator is judged on its own.
 *
 * @param sourceCode - The source code of the linted file.
 * @param expression - The expression supplying the value.
 * @param flow - The explicit target type and the file's type declarations.
 * @param visitedVariables - Bindings already followed, guarding against cycles.
 * @returns True when the target discards evidence the value carries.
 */
function hasKnownEvidence(
	sourceCode: Readonly<TSESLint.SourceCode>,
	expression: TSESTree.Expression,
	flow: FlowTarget,
	visitedVariables = new Set<TSESLint.Scope.Variable>(),
): boolean {
	if (isKnownEvidenceExpression(expression)) {
		// `{}` seeding a dictionary is the one case where the annotation earns
		// its keep: without it the empty literal infers `{}`, and no key could
		// ever be written. This holds wherever the seed appears, including at
		// the end of an unannotated `const` chain.
		return (
			!isDictionaryAccumulatorTarget(flow.destination) || !isEmptyObjectExpression(expression)
		);
	}

	const unwrapped = unwrapAssertedExpression(expression);
	if (unwrapped.type !== AST_NODE_TYPES.Identifier) {
		return false;
	}

	const variable = resolveVariable(sourceCode, unwrapped);
	if (variable === null || visitedVariables.has(variable)) {
		return false;
	}

	const declarator = variableDeclarator(variable);
	if (declarator === null || !isStableConstVariable(variable, declarator)) {
		return false;
	}

	const annotation = variableTypeAnnotation(variable);
	if (annotation !== null) {
		return (
			discardsDeclaredType(flow.destination) &&
			hasInformativeType(annotation.typeAnnotation, flow.environment)
		);
	}

	if (declarator.init === null) {
		return false;
	}

	visitedVariables.add(variable);
	return hasKnownEvidence(sourceCode, declarator.init, flow, visitedVariables);
}

/**
 * The index of the parameter a type predicate narrows, as in `value is User`.
 *
 * @param owner - The candidate predicate function.
 * @returns The subject parameter's index, or null when the function is not a
 *   parameter type predicate.
 */
function typePredicateSubjectIndex(owner: FunctionNode): null | number {
	const predicate = owner.returnType?.typeAnnotation;
	if (
		predicate?.type !== AST_NODE_TYPES.TSTypePredicate ||
		predicate.parameterName.type !== AST_NODE_TYPES.Identifier
	) {
		return null;
	}

	const subjectName = predicate.parameterName.name;
	const index = owner.params.findIndex((parameter) => {
		const binding = parameterBinding(parameter);
		return binding.type === AST_NODE_TYPES.Identifier && binding.name === subjectName;
	});
	return index === -1 ? null : index;
}

/**
 * The nearest function a node sits inside, so a `return` can be attributed to
 * the signature whose return type it must satisfy.
 *
 * @param node - The node to walk out from.
 * @returns The enclosing function, or null at the program root.
 */
function enclosingFunction(node: TSESTree.Node): FunctionNode | null {
	let current = node;
	while (current.type !== AST_NODE_TYPES.Program) {
		if (
			current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
			current.type === AST_NODE_TYPES.FunctionDeclaration ||
			current.type === AST_NODE_TYPES.FunctionExpression
		) {
			return current;
		}

		current = current.parent;
	}

	return null;
}

function sourceKeyName(sourceCode: Readonly<TSESLint.SourceCode>, key: TSESTree.Node): string {
	if (key.type === AST_NODE_TYPES.Identifier || key.type === AST_NODE_TYPES.PrivateIdentifier) {
		return key.name;
	}

	return key.type === AST_NODE_TYPES.Literal ? String(key.value) : sourceCode.getText(key);
}

/**
 * Names a function for the report message, falling back to the binding or
 * method it is assigned to when the function itself is anonymous.
 *
 * @param sourceCode - The source code of the linted file.
 * @param owner - The function to name.
 * @returns A human-readable name for the function.
 */
function functionName(
	sourceCode: Readonly<TSESLint.SourceCode>,
	owner: FunctionNode | null,
): string {
	if (owner === null) {
		return "anonymous function";
	}

	if (owner.type !== AST_NODE_TYPES.ArrowFunctionExpression && owner.id !== null) {
		return owner.id.name;
	}

	const { parent } = owner;
	if (parent.type === AST_NODE_TYPES.VariableDeclarator) {
		return parent.id.type === AST_NODE_TYPES.Identifier ? parent.id.name : "anonymous function";
	}

	return parent.type === AST_NODE_TYPES.MethodDefinition
		? sourceKeyName(sourceCode, parent.key)
		: "anonymous function";
}

/**
 * Whether an assertion is itself asserted again. Only the outermost assertion
 * of a chain decides the final type, so the inner ones are not reported.
 *
 * @param node - The assertion to inspect.
 * @returns True when an enclosing assertion supersedes this one.
 */
function hasParentAssertion(node: TSESTree.TSAsExpression | TSESTree.TSTypeAssertion): boolean {
	return (
		node.parent.type === AST_NODE_TYPES.TSAsExpression ||
		node.parent.type === AST_NODE_TYPES.TSTypeAssertion
	);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let environment: null | TypeEnvironment = null;

	function reportFlow(
		expression: TSESTree.Expression,
		destination: null | WideningTarget,
		subject: string,
	): void {
		if (destination === null) {
			return;
		}

		if (
			environment === null ||
			!hasKnownEvidence(context.sourceCode, expression, { destination, environment })
		) {
			return;
		}

		context.report({
			data: { subject, target: destination.kind },
			messageId: MESSAGE_ID,
			node: expression,
		});
	}

	/**
	 * Classifies an annotation, if there is one. Oxlint spells an absent
	 * annotation `null` where ESLint spells it `undefined`, so both count as
	 * "no target"..
	 *
	 * @param annotation - The annotation carried by the node under inspection.
	 * @returns The widening target, or null when nothing is being widened.
	 */
	function targetFromAnnotation(
		annotation: null | TSESTree.TSTypeAnnotation | undefined,
	): null | WideningTarget {
		return environment === null || annotation === null || annotation === undefined
			? null
			: classifyWideningTarget(annotation.typeAnnotation, environment);
	}

	function reportProperty(node: TSESTree.AccessorProperty | TSESTree.PropertyDefinition): void {
		if (node.value === null) {
			return;
		}

		reportFlow(
			node.value,
			targetFromAnnotation(node.typeAnnotation),
			`property \`${sourceKeyName(context.sourceCode, node.key)}\``,
		);
	}

	function reportAssertion(node: TSESTree.TSAsExpression | TSESTree.TSTypeAssertion): void {
		if (environment === null || hasParentAssertion(node)) {
			return;
		}

		reportFlow(
			node.expression,
			classifyWideningTarget(node.typeAnnotation, environment),
			"assertion",
		);
	}

	return {
		AccessorProperty: reportProperty,
		ArrowFunctionExpression(node: TSESTree.ArrowFunctionExpression): void {
			if (node.body.type === AST_NODE_TYPES.BlockStatement) {
				return;
			}

			reportFlow(
				node.body,
				targetFromAnnotation(node.returnType),
				`return value of \`${functionName(context.sourceCode, node)}\``,
			);
		},
		AssignmentExpression(node: TSESTree.AssignmentExpression): void {
			if (node.operator !== "=" || node.left.type !== AST_NODE_TYPES.Identifier) {
				return;
			}

			const variable = resolveVariable(context.sourceCode, node.left);
			if (variable === null) {
				return;
			}

			const declarator = variableDeclarator(variable);
			if (declarator?.id.type !== AST_NODE_TYPES.Identifier) {
				return;
			}

			reportFlow(
				node.right,
				targetFromAnnotation(declarator.id.typeAnnotation),
				`binding \`${declarator.id.name}\``,
			);
		},
		CallExpression(node: TSESTree.CallExpression): void {
			if (environment === null) {
				return;
			}

			const owner = localFunctionForCall(context.sourceCode, node.callee);
			const subjectIndex = owner === null ? null : typePredicateSubjectIndex(owner);
			if (owner === null || subjectIndex === null) {
				return;
			}

			const parameter = owner.params[subjectIndex];
			const argument = node.arguments[subjectIndex];
			if (
				parameter === undefined ||
				argument === undefined ||
				argument.type === AST_NODE_TYPES.SpreadElement
			) {
				return;
			}

			const annotation = parameterAnnotation(parameter);
			if (
				annotation === undefined ||
				!containsUnknownType(annotation.typeAnnotation) ||
				!hasKnownCallArgumentEvidence(context.sourceCode, argument, environment)
			) {
				return;
			}

			const parameterLabel = parameterName(parameter, context.sourceCode);
			const ownerLabel = functionName(context.sourceCode, owner);
			context.report({
				data: {
					subject: `argument for parameter \`${parameterLabel}\` of \`${ownerLabel}\``,
					target: "unknown",
				},
				messageId: MESSAGE_ID,
				node: argument,
			});
		},
		Program(node: TSESTree.Program): void {
			environment = createTypeEnvironment(node);
		},
		PropertyDefinition: reportProperty,
		ReturnStatement(node: TSESTree.ReturnStatement): void {
			if (node.argument === null) {
				return;
			}

			const owner = enclosingFunction(node);
			reportFlow(
				node.argument,
				targetFromAnnotation(owner?.returnType),
				`return value of \`${functionName(context.sourceCode, owner)}\``,
			);
		},
		TSAsExpression: reportAssertion,
		TSTypeAssertion: reportAssertion,
		VariableDeclarator(node: TSESTree.VariableDeclarator): void {
			if (node.init === null || node.id.type !== AST_NODE_TYPES.Identifier) {
				return;
			}

			reportFlow(
				node.init,
				targetFromAnnotation(node.id.typeAnnotation),
				`binding \`${node.id.name}\``,
			);
		},
	};
}

export const noKnownValueWidening = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence",
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
