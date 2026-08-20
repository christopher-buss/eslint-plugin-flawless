import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type {
	Expression,
	Signature,
	Node as TSNode,
	Type,
	TypeReference,
	UnionOrIntersectionType,
} from "typescript";
import {
	isIdentifier,
	isParameter,
	isTypeReferenceNode,
	ObjectFlags,
	SignatureKind,
	SymbolFlags,
	TypeFlags,
	TypeFormatFlags,
} from "typescript";

import { createEslintRule } from "../../util";

export const RULE_NAME = "no-redundant-type-annotation";

const MESSAGE_ID = "redundant";
const PARAMETER_MESSAGE_ID = "redundantParameter";

export type MessageIds = typeof MESSAGE_ID | typeof PARAMETER_MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"The `{{typeName}}` annotation restates the type the initializer already has. Remove it and let inference carry the type.",
	[PARAMETER_MESSAGE_ID]:
		"The `{{typeName}}` annotation restates the type this parameter already gets from its context. Remove it and let inference carry the type.",
};

/**
 * Reports whether a parameter carries no type annotation of its own.
 *
 * An untyped parameter takes its type from the surrounding contextual type,
 * which the variable's annotation supplies. Removing the annotation would
 * silently turn the parameter into `any`.
 *
 * @param parameter - The parameter to inspect.
 * @returns True when the parameter has no annotation.
 */
function isUntypedParameter(parameter: TSESTree.Parameter): boolean {
	if (parameter.type === AST_NODE_TYPES.TSParameterProperty) {
		return isUntypedParameter(parameter.parameter);
	}

	// A default value nests the binding, and the annotation may sit on either
	// half depending on how the parameter was written.
	if (parameter.type === AST_NODE_TYPES.AssignmentPattern) {
		return parameter.typeAnnotation === undefined && isUntypedParameter(parameter.left);
	}

	return parameter.typeAnnotation === undefined;
}

/**
 * Reports whether any identifier under `node` matches one of `names`.
 *
 * Used to ask whether a signature's declared return type mentions one of that
 * signature's own type parameters. The match is by name, scoped to the single
 * declaration that introduced those names, so shadowing elsewhere cannot leak
 * in.
 *
 * @param node - The TypeScript AST node to walk.
 * @param names - The type parameter names to look for.
 * @returns True when the subtree references one of the names.
 */
function referencesName(node: TSNode, names: ReadonlySet<string>): boolean {
	if (isIdentifier(node) && names.has(node.text)) {
		return true;
	}

	return node.forEachChild((child) => referencesName(child, names) || undefined) === true;
}

/**
 * Finds the annotation written on a parameter, looking through the binding a
 * default value introduces.
 *
 * @param parameter - The parameter to read.
 * @returns The annotation, or undefined when the parameter has none.
 */
function getParameterAnnotation(
	parameter: TSESTree.Parameter,
): TSESTree.TSTypeAnnotation | undefined {
	if (parameter.type === AST_NODE_TYPES.TSParameterProperty) {
		return getParameterAnnotation(parameter.parameter);
	}

	if (parameter.type === AST_NODE_TYPES.AssignmentPattern) {
		return parameter.typeAnnotation ?? getParameterAnnotation(parameter.left);
	}

	return parameter.typeAnnotation;
}

/**
 * Reports whether a signature's parameter at an index collects rest
 * arguments.
 *
 * A rest parameter breaks the positional pairing this check relies on: the
 * signature's `...args: Array<string>` lines up against a plain `string`, not
 * against a written `Array<string>`, so comparing them directly would delete
 * an annotation that is holding a different type.
 *
 * @param signature - The contextual call signature.
 * @param index - The parameter position.
 * @returns True when that position is a rest parameter.
 */
function isRestParameter(signature: Signature, index: number): boolean {
	const declaration = signature.parameters[index]?.valueDeclaration;
	return (
		declaration !== undefined &&
		isParameter(declaration) &&
		declaration.dotDotDotToken !== undefined
	);
}

/**
 * Reports whether the initializer is a function whose parameters take their
 * types from the variable's own annotation.
 *
 * Both annotations say the same thing, so both look redundant, but only one
 * of them can go: deleting the variable annotation and the parameter
 * annotations in the same pass would leave the parameters implicitly `any`.
 * The parameter check owns this case, so the variable check steps back.
 *
 * @param node - The initializer to inspect.
 * @returns True when the annotation is a function's parameter context.
 */
function suppliesParameterContext(node: TSESTree.Node): boolean {
	if (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionExpression
	) {
		return node.params.some((parameter) => getParameterAnnotation(parameter) !== undefined);
	}

	if (node.type === AST_NODE_TYPES.ConditionalExpression) {
		return (
			suppliesParameterContext(node.consequent) || suppliesParameterContext(node.alternate)
		);
	}

	if (node.type === AST_NODE_TYPES.LogicalExpression) {
		return suppliesParameterContext(node.left) || suppliesParameterContext(node.right);
	}

	return false;
}

function create(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const services = getParserServices(context);
	const checker = services.program.getTypeChecker();

	/**
	 * Renders a type the way TypeScript would print it, without truncation.
	 *
	 * @param type - The type to render.
	 * @returns The printed form of the type.
	 */
	function display(type: Type): string {
		return checker.typeToString(type, undefined, TypeFormatFlags.NoTruncation);
	}

	/**
	 * Reports whether `any` appears anywhere in a type, including inside type
	 * arguments and union or intersection members.
	 *
	 * An annotation over an `any`-tainted initializer is doing real work — it
	 * narrows the escape hatch away — so it is never redundant, even when the
	 * two types compare as identical (`any` is assignable in both directions).
	 *
	 * @param type - The type to inspect.
	 * @param seen - Types already visited, guarding recursive type references.
	 * @returns True when the type contains `any`.
	 */
	function containsAny(type: Type, seen = new Set<Type>()): boolean {
		if ((type.flags & TypeFlags.Any) !== 0) {
			return true;
		}

		if (seen.has(type)) {
			return false;
		}

		seen.add(type);

		if ((type.flags & TypeFlags.UnionOrIntersection) !== 0) {
			return (type as UnionOrIntersectionType).types.some((member) =>
				containsAny(member, seen),
			);
		}

		const objectFlags = (type as { objectFlags?: number }).objectFlags ?? 0;
		if ((type.flags & TypeFlags.Object) !== 0 && (objectFlags & ObjectFlags.Reference) !== 0) {
			return checker
				.getTypeArguments(type as TypeReference)
				.some((argument) => containsAny(argument, seen));
		}

		return false;
	}

	/**
	 * Reports whether a call or `new` expression could have its result shaped by
	 * the annotation itself.
	 *
	 * When a generic signature mentions its own type parameters in its declared
	 * return type, and the call site supplies no explicit type arguments, the
	 * contextual type flows into inference. `declare function foo<T = number>():
	 * T; const x: string = foo();` types the call as `string` only because the
	 * annotation is there; removing it leaves `number`.
	 *
	 * @param node - The call or `new` expression to inspect.
	 * @returns True when the annotation may be feeding inference.
	 */
	function isInferenceSensitiveCall(
		node: TSESTree.CallExpression | TSESTree.NewExpression,
	): boolean {
		if (node.typeArguments !== undefined) {
			return false;
		}

		const signature = checker.getResolvedSignature(services.esTreeNodeToTSNodeMap.get(node));
		// `getDeclaration` is typed as total, but synthesized signatures have no
		// declaration at runtime.
		const declaration = signature?.getDeclaration();
		const typeParameters = declaration?.typeParameters;
		if (typeParameters === undefined || typeParameters.length === 0) {
			return false;
		}

		// An inferred return type could resolve to anything; treat it as
		// sensitive.
		if (declaration?.type === undefined) {
			return true;
		}

		const names = new Set(typeParameters.map((parameter) => parameter.name.text));
		return referencesName(declaration.type, names);
	}

	/**
	 * Reports whether removing the annotation could change what the initializer
	 * means, because some part of it is typed by its context rather than by
	 * itself.
	 *
	 * The walk follows only the positions the annotation's contextual type
	 * actually reaches: the initializer, both branches of a conditional or
	 * logical expression, through `await` and `!`, and into call arguments.
	 *
	 * @param node - The expression to inspect.
	 * @returns True when the expression depends on its context.
	 */
	function isContextDependent(node: TSESTree.Node): boolean {
		if (
			node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
			node.type === AST_NODE_TYPES.FunctionExpression
		) {
			return node.params.some(isUntypedParameter);
		}

		if (
			node.type === AST_NODE_TYPES.CallExpression ||
			node.type === AST_NODE_TYPES.NewExpression
		) {
			return isInferenceSensitiveCall(node) || node.arguments.some(isContextDependent);
		}

		if (node.type === AST_NODE_TYPES.ConditionalExpression) {
			return isContextDependent(node.consequent) || isContextDependent(node.alternate);
		}

		if (node.type === AST_NODE_TYPES.LogicalExpression) {
			return isContextDependent(node.left) || isContextDependent(node.right);
		}

		if (node.type === AST_NODE_TYPES.AwaitExpression) {
			return isContextDependent(node.argument);
		}

		if (node.type === AST_NODE_TYPES.TSNonNullExpression) {
			return isContextDependent(node.expression);
		}

		return false;
	}

	/**
	 * Reports whether the annotation names a type alias that TypeScript erases.
	 *
	 * An alias to an object, function, union, or array keeps its name in the type
	 * system, so comparing printed forms already tells the truth about it. An
	 * alias to a primitive does not: `type UserId = string` leaves no trace, and
	 * `const id: UserId = getString()` looks identical to `const id: string`.
	 * Deleting the annotation there would erase the only mention of the name, so
	 * the rule leaves it alone.
	 *
	 * @param typeNode - The written annotation.
	 * @param type - The type that annotation resolves to.
	 * @returns True when the annotation names an alias the type system drops.
	 */
	function namesAnErasedAlias(typeNode: TSESTree.TypeNode, type: Type): boolean {
		if (typeNode.type !== AST_NODE_TYPES.TSTypeReference) {
			return false;
		}

		const tsTypeNode = services.esTreeNodeToTSNodeMap.get(typeNode);
		if (!isTypeReferenceNode(tsTypeNode)) {
			return false;
		}

		const symbol = checker.getSymbolAtLocation(tsTypeNode.typeName);
		if (symbol === undefined || (symbol.flags & SymbolFlags.TypeAlias) === 0) {
			return false;
		}

		return symbol.name !== display(type);
	}

	/**
	 * Reports whether two types are the same type, not merely interchangeable
	 * ones.
	 *
	 * Mutual assignability alone is too loose: it equates `any` with everything,
	 * and it equates a named alias with the shape behind it. Requiring the
	 * printed forms to match as well keeps `type UserId = string` distinct from
	 * `string`, so the rule never deletes a name that carries intent.
	 *
	 * @param left - The first type.
	 * @param right - The second type.
	 * @returns True when the two types are identical.
	 */
	function typesAreIdentical(left: Type, right: Type): boolean {
		return (
			checker.isTypeAssignableTo(left, right) &&
			checker.isTypeAssignableTo(right, left) &&
			display(left) === display(right)
		);
	}

	/**
	 * Reports whether a function expression sits in an argument position of a
	 * call that is still inferring its type arguments.
	 *
	 * There the parameter annotations are inference sources, not restatements:
	 * `wrap((value: number) => value)` against `wrap<T>(fn: (a: T) => T)` types
	 * the parameter as `number` only because the annotation says so. Removing it
	 * leaves `T` as `unknown`. An overloaded callee is treated the same way,
	 * since the parameter types can be what picks the overload.
	 *
	 * @param node - The function expression to locate.
	 * @returns True when an enclosing call still depends on the annotations.
	 */
	function isArgumentOfInferringCall(node: TSESTree.Node): boolean {
		let current = node;
		let parent: TSESTree.Node | undefined = node.parent;
		// Walk out through the expression forms that keep an argument's
		// contextual typing intact.
		while (
			parent !== undefined &&
			(parent.type === AST_NODE_TYPES.ArrayExpression ||
				parent.type === AST_NODE_TYPES.ConditionalExpression ||
				parent.type === AST_NODE_TYPES.LogicalExpression ||
				parent.type === AST_NODE_TYPES.Property ||
				parent.type === AST_NODE_TYPES.ObjectExpression)
		) {
			current = parent;
			({ parent } = parent);
		}

		if (
			parent === undefined ||
			(parent.type !== AST_NODE_TYPES.CallExpression &&
				parent.type !== AST_NODE_TYPES.NewExpression)
		) {
			return false;
		}

		if (!parent.arguments.includes(current as TSESTree.CallExpressionArgument)) {
			return false;
		}

		if (parent.typeArguments !== undefined) {
			return false;
		}

		const calleeType = services.getTypeAtLocation(parent.callee);
		if (checker.getSignaturesOfType(calleeType, SignatureKind.Call).length > 1) {
			return true;
		}

		const signature = checker.getResolvedSignature(services.esTreeNodeToTSNodeMap.get(parent));
		const declaration = signature?.getDeclaration();
		const typeParameters = declaration?.typeParameters;
		return typeParameters !== undefined && typeParameters.length > 0;
	}

	function checkFunctionParameters(
		node: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
	): void {
		if (node.params.every((parameter) => isUntypedParameter(parameter))) {
			return;
		}

		if (isArgumentOfInferringCall(node)) {
			return;
		}

		const contextualType = checker.getContextualType(
			services.esTreeNodeToTSNodeMap.get(node) as Expression,
		);
		if (contextualType === undefined) {
			return;
		}

		// More than one signature means the parameter list has no single
		// contextual counterpart to compare against.
		const signatures = checker.getSignaturesOfType(contextualType, SignatureKind.Call);
		const signature = signatures.length === 1 ? signatures.at(0) : undefined;
		if (signature === undefined) {
			return;
		}

		for (const [index, parameter] of node.params.entries()) {
			const annotation = getParameterAnnotation(parameter);
			if (annotation === undefined) {
				continue;
			}

			// A `this` parameter has no counterpart in the contextual signature's
			// positional list.
			if (parameter.type === AST_NODE_TYPES.Identifier && parameter.name === "this") {
				continue;
			}

			const isRest = parameter.type === AST_NODE_TYPES.RestElement;
			if (isRest !== isRestParameter(signature, index)) {
				continue;
			}

			const target = signature.parameters[index];
			if (target === undefined) {
				continue;
			}

			const annotationType = services.getTypeFromTypeNode(annotation.typeAnnotation);
			if ((annotationType.flags & TypeFlags.Any) !== 0) {
				continue;
			}

			if (namesAnErasedAlias(annotation.typeAnnotation, annotationType)) {
				continue;
			}

			const contextualParameterType = checker.getTypeOfSymbolAtLocation(
				target,
				services.esTreeNodeToTSNodeMap.get(node),
			);
			if (containsAny(contextualParameterType)) {
				continue;
			}

			if (!typesAreIdentical(annotationType, contextualParameterType)) {
				continue;
			}

			context.report({
				data: { typeName: display(annotationType) },
				fix: (fixer) => fixer.remove(annotation),
				messageId: PARAMETER_MESSAGE_ID,
				node: annotation,
			});
		}
	}

	return {
		ArrowFunctionExpression: checkFunctionParameters,
		FunctionExpression: checkFunctionParameters,
		VariableDeclarator(node: TSESTree.VariableDeclarator): void {
			const { kind } = node.parent;
			if (kind !== "const" && kind !== "let") {
				return;
			}

			if (node.id.type !== AST_NODE_TYPES.Identifier) {
				return;
			}

			const annotation = node.id.typeAnnotation;
			if (annotation === undefined || node.init === null) {
				return;
			}

			// Object and array literals are `no-known-value-widening`'s subject:
			// there the annotation governs excess property checking and literal
			// widening, which is a different question from restating a type.
			if (
				node.init.type === AST_NODE_TYPES.ObjectExpression ||
				node.init.type === AST_NODE_TYPES.ArrayExpression
			) {
				return;
			}

			if (isContextDependent(node.init) || suppliesParameterContext(node.init)) {
				return;
			}

			const annotationType = services.getTypeFromTypeNode(annotation.typeAnnotation);
			// `any` is the one annotation that can never be redundant: it is
			// mutually assignable with every type, so identity says nothing.
			if ((annotationType.flags & TypeFlags.Any) !== 0) {
				return;
			}

			if (namesAnErasedAlias(annotation.typeAnnotation, annotationType)) {
				return;
			}

			let inferredType = services.getTypeAtLocation(node.init);
			// A type parameter is deliberately being widened to a concrete type.
			if ((inferredType.flags & TypeFlags.TypeParameter) !== 0) {
				return;
			}

			// `let` widens a single literal type on inference, so compare against
			// the widened form. A union is left alone: collapsing `"a" | "b"` to
			// `string` is a real change, not widening TypeScript would do here.
			if (kind === "let" && (inferredType.flags & TypeFlags.Union) === 0) {
				inferredType = checker.getBaseTypeOfLiteralType(inferredType);
			}

			if (containsAny(inferredType)) {
				return;
			}

			if (!typesAreIdentical(annotationType, inferredType)) {
				return;
			}

			context.report({
				data: { typeName: display(annotationType) },
				fix: (fixer) => fixer.remove(annotation),
				messageId: MESSAGE_ID,
				node: annotation,
			});
		},
	};
}

export const noRedundantTypeAnnotation = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow type annotations that restate the initializer's own type",
			recommended: false,
			requiresTypeChecking: true,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
