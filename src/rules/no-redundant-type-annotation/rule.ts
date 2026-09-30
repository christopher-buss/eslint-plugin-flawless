import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type {
	Expression,
	Signature,
	SignatureDeclaration,
	Node as TSNode,
	Type,
	TypeReference,
	UnionOrIntersectionType,
} from "typescript";
import {
	isFunctionTypeNode,
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
import { pushChildNodes } from "../../utils/nested-expressions";

export const RULE_NAME = "no-redundant-type-annotation";

const CATCH_MESSAGE_ID = "redundantCatch";
const MESSAGE_ID = "redundant";
const PARAMETER_MESSAGE_ID = "redundantParameter";

export type MessageIds = typeof CATCH_MESSAGE_ID | typeof MESSAGE_ID | typeof PARAMETER_MESSAGE_ID;

type Options = [];

/** A call that passes a node to a parameter, and that parameter's position. */
interface CallSite {
	readonly call:
		| TSESTree.CallExpression
		| TSESTree.JSXOpeningElement
		| TSESTree.NewExpression
		| TSESTree.TaggedTemplateExpression;
	readonly index: number;
}

const messages = {
	[CATCH_MESSAGE_ID]:
		"The `{{typeName}}` annotation restates the type a catch variable already has under `useUnknownInCatchVariables`. Remove it and let the compiler option carry the type.",
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
 * Reports whether the node is an `as const` or `<const>` assertion.
 *
 * @param node - The node to inspect.
 * @returns True when the node asserts `const`.
 */
function isConstAssertion(node: TSESTree.Node): boolean {
	return (
		(node.type === AST_NODE_TYPES.TSAsExpression ||
			node.type === AST_NODE_TYPES.TSTypeAssertion) &&
		node.typeAnnotation.type === AST_NODE_TYPES.TSTypeReference &&
		node.typeAnnotation.typeName.type === AST_NODE_TYPES.Identifier &&
		node.typeAnnotation.typeName.name === "const"
	);
}

/**
 * Reports whether a type is one literal that function return inference
 * widens when nothing gives it a context.
 *
 * A union of literals is not widened, so it does not count.
 *
 * @param type - The return type to inspect.
 * @returns True when the type is a single widening literal.
 */
function isWideningUnit(type: Type): boolean {
	if ((type.flags & TypeFlags.Union) !== 0) {
		return false;
	}

	return (
		(type.flags &
			(TypeFlags.StringLiteral |
				TypeFlags.NumberLiteral |
				TypeFlags.BigIntLiteral |
				TypeFlags.BooleanLiteral |
				TypeFlags.EnumLiteral |
				TypeFlags.UniqueESSymbol)) !==
		0
	);
}

/**
 * Reports whether a type, or a member of it, is a template literal or
 * string mapping type.
 *
 * A template expression is typed as one of these only under a context that
 * asks for it; without one it is `string`.
 *
 * @param type - The return type to inspect.
 * @returns True when the type holds a template type.
 */
function hasTemplateType(type: Type): boolean {
	const members =
		(type.flags & TypeFlags.Union) !== 0 ? (type as UnionOrIntersectionType).types : [type];
	return members.some(
		(member) => (member.flags & (TypeFlags.TemplateLiteral | TypeFlags.StringMapping)) !== 0,
	);
}

/**
 * Reports whether any node below `node` passes `test`, without descending into
 * nodes `isBoundary` accepts.
 *
 * A boundary node is still offered to `test`; only its own children are
 * skipped.
 *
 * @param node - The node to walk below.
 * @param isBoundary - Picks the nodes whose children the walk skips.
 * @param test - The condition to look for.
 * @returns True when some descendant passes `test`.
 */
function someDescendant(
	node: TSESTree.Node,
	isBoundary: (child: TSESTree.Node) => boolean,
	test: (child: TSESTree.Node) => boolean,
): boolean {
	const stack: Array<TSESTree.Node> = [];
	pushChildNodes(node, stack);
	let current = stack.pop();
	while (current !== undefined) {
		if (test(current)) {
			return true;
		}

		if (!isBoundary(current)) {
			pushChildNodes(current, stack);
		}

		current = stack.pop();
	}

	return false;
}

/**
 * Reports whether a node starts a function of its own.
 *
 * @param node - The node to inspect.
 * @returns True for any function node.
 */
function isFunctionNode(node: TSESTree.Node): boolean {
	return (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionDeclaration
	);
}

/**
 * Climbs from a node through the expressions that pass an outer contextual
 * type down to it unchanged.
 *
 * A const assertion forwards the outer context, but any other assertion
 * supplies its own type. A sequence forwards it only to its last expression.
 *
 * @param node - The node to start from.
 * @returns The outermost node that still shares the node's context.
 */
function climbContextForwarders(node: TSESTree.Node): TSESTree.Node {
	let current = node;
	let { parent } = node;
	while (
		parent !== undefined &&
		(parent.type === AST_NODE_TYPES.ArrayExpression ||
			parent.type === AST_NODE_TYPES.ConditionalExpression ||
			parent.type === AST_NODE_TYPES.LogicalExpression ||
			parent.type === AST_NODE_TYPES.Property ||
			parent.type === AST_NODE_TYPES.ObjectExpression ||
			parent.type === AST_NODE_TYPES.SpreadElement ||
			parent.type === AST_NODE_TYPES.TSNonNullExpression ||
			(parent.type === AST_NODE_TYPES.SequenceExpression &&
				parent.expressions.at(-1) === current) ||
			isConstAssertion(parent))
	) {
		current = parent;
		({ parent } = parent);
	}

	return current;
}

/**
 * Finds the function that returns a node as its value.
 *
 * A concise arrow body, a `return` argument, and a `yield` operand are all
 * return values: a generator's context types what it yields. The nearest
 * enclosing function owns a `return` or `yield`; a declaration has no
 * contextual type to pass on, so it ends the search.
 *
 * @param node - The expression to locate.
 * @returns The returning function, or undefined when the node is not a
 *   return value.
 */
function getReturningFunction(
	node: TSESTree.Node,
): TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | undefined {
	const { parent } = node;
	if (parent?.type === AST_NODE_TYPES.ArrowFunctionExpression && parent.body === node) {
		return parent;
	}

	if (
		parent?.type !== AST_NODE_TYPES.ReturnStatement &&
		parent?.type !== AST_NODE_TYPES.YieldExpression
	) {
		return undefined;
	}

	let ancestor: TSESTree.Node | undefined = parent.parent;
	while (ancestor !== undefined && !isFunctionNode(ancestor)) {
		ancestor = ancestor.parent;
	}

	return ancestor?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		ancestor?.type === AST_NODE_TYPES.FunctionExpression
		? ancestor
		: undefined;
}

/**
 * Finds the call a node is passed to, and the parameter that receives it.
 *
 * Besides call and `new` arguments, a tagged template passes each hole after
 * the strings array, and a JSX element passes its attributes and children
 * together as the component's first parameter.
 *
 * @param node - The expression to locate.
 * @returns The call and the parameter index, or undefined when the node is
 *   not an argument.
 */
function getCallSite(node: TSESTree.Node): CallSite | undefined {
	const { parent } = node;
	if (
		(parent?.type === AST_NODE_TYPES.CallExpression ||
			parent?.type === AST_NODE_TYPES.NewExpression) &&
		parent.arguments.includes(node as TSESTree.CallExpressionArgument)
	) {
		return {
			call: parent,
			index: parent.arguments.indexOf(node as TSESTree.CallExpressionArgument),
		};
	}

	if (
		parent?.type === AST_NODE_TYPES.TemplateLiteral &&
		parent.parent.type === AST_NODE_TYPES.TaggedTemplateExpression &&
		parent.parent.quasi === parent
	) {
		return {
			call: parent.parent,
			index: parent.expressions.indexOf(node as TSESTree.Expression) + 1,
		};
	}

	if (parent?.type === AST_NODE_TYPES.JSXSpreadAttribute) {
		return { call: parent.parent, index: 0 };
	}

	if (parent?.type !== AST_NODE_TYPES.JSXExpressionContainer) {
		return undefined;
	}

	const holder = parent.parent;
	if (holder.type === AST_NODE_TYPES.JSXAttribute) {
		return { call: holder.parent, index: 0 };
	}

	return holder.type === AST_NODE_TYPES.JSXElement
		? { call: holder.openingElement, index: 0 }
		: undefined;
}

/**
 * Finds the expression that names what a call invokes.
 *
 * @param call - The call to read.
 * @returns The callee, tag, or component name.
 */
function getCallee(call: CallSite["call"]): TSESTree.Node {
	switch (call.type) {
		case AST_NODE_TYPES.CallExpression:
		case AST_NODE_TYPES.NewExpression: {
			return call.callee;
		}
		case AST_NODE_TYPES.JSXOpeningElement: {
			return call.name;
		}
		case AST_NODE_TYPES.TaggedTemplateExpression: {
			return call.tag;
		}
	}
}

/**
 * Lists the kinds of signature a call can resolve to.
 *
 * A JSX component may be a function or a class.
 *
 * @param call - The call to read.
 * @returns The signature kinds to look up on the callee.
 */
function getSignatureKinds(call: CallSite["call"]): Array<SignatureKind> {
	if (call.type === AST_NODE_TYPES.NewExpression) {
		return [SignatureKind.Construct];
	}

	if (call.type === AST_NODE_TYPES.JSXOpeningElement) {
		return [SignatureKind.Call, SignatureKind.Construct];
	}

	return [SignatureKind.Call];
}

/**
 * Reports whether a function declares a `this` parameter.
 *
 * @param node - The function to inspect.
 * @returns True when the first parameter is `this`.
 */
function hasThisParameter(
	node: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): boolean {
	const [first] = node.params;
	return first?.type === AST_NODE_TYPES.Identifier && first.name === "this";
}

/**
 * Reports whether a function expression reads a `this` that only its
 * contextual type gives a type.
 *
 * An arrow shares the enclosing `this`, so the walk goes through arrows and
 * stops at the next function that binds its own.
 *
 * @param node - The function to inspect.
 * @returns True when the body reads an untyped `this`.
 */
function usesContextualThis(
	node: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): boolean {
	if (node.type !== AST_NODE_TYPES.FunctionExpression || hasThisParameter(node)) {
		return false;
	}

	return someDescendant(
		node.body,
		(child) => {
			return (
				child.type === AST_NODE_TYPES.FunctionExpression ||
				child.type === AST_NODE_TYPES.FunctionDeclaration
			);
		},
		(child) => {
			return child.type === AST_NODE_TYPES.ThisExpression;
		},
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

	// A catch variable takes its type from this option rather than from
	// anything written at the site. With the option off the variable is `any`,
	// so an `unknown` annotation there is narrowing rather than restating.
	const compilerOptions = services.program.getCompilerOptions();
	const catchVariablesAreUnknown =
		compilerOptions.useUnknownInCatchVariables ?? compilerOptions.strict ?? false;

	// With this option the declaration emitter works from syntax alone, so an
	// exported variable must say its type in the source. There the annotation is
	// not a restatement of the initializer; it is the only copy the emitter can
	// read, and removing it turns the report into error TS9010.
	const declarationsAreIsolated = compilerOptions.isolatedDeclarations ?? false;
	let exportedNames: Set<string> | undefined;

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
		if (declaration === undefined) {
			return false;
		}

		const names = getTypeParameterNames(declaration);
		if (names.size === 0) {
			return false;
		}

		// An inferred return type could resolve to anything, and a constructor
		// returns its generic class; treat both as sensitive.
		if (declaration.type === undefined) {
			return true;
		}

		return referencesName(declaration.type, names);
	}

	/**
	 * Collects the names of the type parameters a call to a declaration
	 * infers.
	 *
	 * A constructor declares none of its own: they sit on the class, where
	 * only the signature built from the declaration finds them.
	 *
	 * @param declaration - The called signature's declaration.
	 * @returns The type parameter names, empty when the call is not generic.
	 */
	function getTypeParameterNames(declaration: SignatureDeclaration): ReadonlySet<string> {
		const typeParameters = checker
			.getSignatureFromDeclaration(declaration)
			?.getTypeParameters();
		return new Set(typeParameters?.map((parameter) => parameter.symbol.name));
	}

	/**
	 * Reports whether a function's return value takes its type from the
	 * function's contextual type.
	 *
	 * With a context, a returned literal keeps its literal type, and a returned
	 * object, array, or function is typed against the context's return type.
	 * Without one the literal widens and the rest lose their context. A
	 * written return type stops the context, so it answers false.
	 *
	 * @param node - The function to inspect.
	 * @returns True when a return value depends on the context.
	 */
	function returnsContextTypedValue(
		node: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
	): boolean {
		if (node.returnType !== undefined) {
			return false;
		}

		// `yield` is contextually typed too, and the rule does not follow it.
		if (node.generator) {
			return true;
		}

		const returnsDependent =
			node.body.type === AST_NODE_TYPES.BlockStatement
				? someDescendant(node.body, isFunctionNode, (child) => {
						return (
							child.type === AST_NODE_TYPES.ReturnStatement &&
							child.argument !== null &&
							receivesAnnotationContext(child.argument)
						);
					})
				: receivesAnnotationContext(node.body);
		if (returnsDependent) {
			return true;
		}

		const signatures = checker.getSignaturesOfType(
			services.getTypeAtLocation(node),
			SignatureKind.Call,
		);
		const signature = signatures.length === 1 ? signatures.at(0) : undefined;
		if (signature === undefined) {
			return true;
		}

		let returnType = checker.getReturnTypeOfSignature(signature);
		if (node.async) {
			returnType = checker.getAwaitedType(returnType) ?? returnType;
		}

		return isWideningUnit(returnType) || hasTemplateType(returnType);
	}

	/**
	 * Reports whether the annotation's contextual type reaches an expression
	 * and shapes its type.
	 *
	 * The expression is the initializer or a value a function initializer
	 * returns. There an object or array literal is typed against the
	 * annotation, which governs excess property checking and literal widening:
	 * `no-known-value-widening`'s subject, not a restatement. A function there
	 * takes its `this` and return values from the annotation too. This is kept
	 * apart from `isContextDependent` because that also runs on call arguments,
	 * where a literal or a callback takes its context from the callee instead.
	 *
	 * @param node - The expression to inspect.
	 * @returns True when the annotation shapes the expression's type.
	 */
	function receivesAnnotationContext(node: TSESTree.Node): boolean {
		if (
			node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
			node.type === AST_NODE_TYPES.FunctionExpression
		) {
			return (
				node.params.some(isUntypedParameter) ||
				usesContextualThis(node) ||
				returnsContextTypedValue(node)
			);
		}

		if (
			node.type === AST_NODE_TYPES.ObjectExpression ||
			node.type === AST_NODE_TYPES.ArrayExpression
		) {
			return true;
		}

		if (node.type === AST_NODE_TYPES.ConditionalExpression) {
			return (
				receivesAnnotationContext(node.consequent) ||
				receivesAnnotationContext(node.alternate)
			);
		}

		if (node.type === AST_NODE_TYPES.LogicalExpression) {
			return receivesAnnotationContext(node.left) || receivesAnnotationContext(node.right);
		}

		if (node.type === AST_NODE_TYPES.AwaitExpression) {
			return receivesAnnotationContext(node.argument);
		}

		if (node.type === AST_NODE_TYPES.TSNonNullExpression) {
			return receivesAnnotationContext(node.expression);
		}

		if (node.type === AST_NODE_TYPES.SequenceExpression) {
			const last = node.expressions.at(-1);
			return last !== undefined && receivesAnnotationContext(last);
		}

		return isContextDependent(node);
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
	 * A function that a callback returns is followed out to the callback's
	 * call: `map(items, () => (s: string) => s.length)` against
	 * `map<T, R>(items: Array<T>, fn: (item: T) => R)` infers `R` from the
	 * returned function, so its context exists only because of the
	 * annotation. A generator's `yield` is followed the same way.
	 *
	 * The call may also be a generic class's `new`, a tagged template, or a
	 * generic JSX component.
	 *
	 * @param node - The function expression to locate.
	 * @returns True when an enclosing call still depends on the annotations.
	 */
	function isArgumentOfInferringCall(node: TSESTree.Node): boolean {
		let current = climbContextForwarders(node);
		let isReturned = false;
		let returning = getReturningFunction(current);
		while (returning !== undefined) {
			isReturned = true;
			current = climbContextForwarders(returning);
			returning = getReturningFunction(current);
		}

		const site = getCallSite(current);
		if (site === undefined) {
			return false;
		}

		const { call, index } = site;
		if (call.typeArguments !== undefined) {
			return false;
		}

		const calleeType = services.getTypeAtLocation(getCallee(call));
		if (
			getSignatureKinds(call).some(
				(kind) => checker.getSignaturesOfType(calleeType, kind).length > 1,
			)
		) {
			return true;
		}

		const signature = checker.getResolvedSignature(services.esTreeNodeToTSNodeMap.get(call));
		const declaration = signature?.getDeclaration();
		if (declaration === undefined) {
			return false;
		}

		const names = getTypeParameterNames(declaration);
		if (names.size === 0) {
			return false;
		}

		if (!isReturned) {
			return true;
		}

		// A returned value only feeds inference through a type parameter in
		// the declared parameter type. With a callback argument, only its
		// return type can take the returned value.
		const { parameters } = declaration;
		const typeNode = parameters[Math.min(index, parameters.length - 1)]?.type;
		if (typeNode === undefined) {
			return true;
		}

		const target =
			isFunctionNode(current) && isFunctionTypeNode(typeNode) ? typeNode.type : typeNode;
		return referencesName(target, names);
	}

	/**
	 * Collects the names an `export { ... }` list sends out of this module.
	 *
	 * A declaration can be exported away from its own statement, so the
	 * `export const` form is not the whole picture.
	 *
	 * @returns The locally declared names named by an export list.
	 */
	function getExportedNames(): ReadonlySet<string> {
		if (exportedNames === undefined) {
			exportedNames = new Set();
			for (const statement of context.sourceCode.ast.body) {
				// A `source` means the names come from elsewhere, so no local
				// declaration is involved.
				if (
					statement.type !== AST_NODE_TYPES.ExportNamedDeclaration ||
					statement.source !== null
				) {
					continue;
				}

				for (const specifier of statement.specifiers) {
					exportedNames.add(specifier.local.name);
				}
			}
		}

		return exportedNames;
	}

	/**
	 * Reports whether a variable leaves the module.
	 *
	 * Only exported declarations are subject to `isolatedDeclarations`, so the
	 * question decides whether the annotation is load-bearing.
	 *
	 * @param node - The declarator to inspect.
	 * @param name - The name it binds.
	 * @returns True when the module exports that variable.
	 */
	function isExported(node: TSESTree.VariableDeclarator, name: string): boolean {
		const statement = node.parent.parent;
		if (statement.type === AST_NODE_TYPES.ExportNamedDeclaration) {
			return true;
		}

		// An export list can only reach a binding at the top of the module.
		return statement.type === AST_NODE_TYPES.Program && getExportedNames().has(name);
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

		// A `this` parameter has no counterpart in the contextual signature's
		// positional list, so the positions start after it.
		const parameters = hasThisParameter(node) ? node.params.slice(1) : node.params;
		for (const [index, parameter] of parameters.entries()) {
			const annotation = getParameterAnnotation(parameter);
			if (annotation === undefined) {
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
		CatchClause({ param }: TSESTree.CatchClause): void {
			if (!catchVariablesAreUnknown) {
				return;
			}

			if (param?.type !== AST_NODE_TYPES.Identifier) {
				return;
			}

			const annotation = param.typeAnnotation;
			if (annotation === undefined) {
				return;
			}

			const annotationType = services.getTypeFromTypeNode(annotation.typeAnnotation);
			// `any` is the only other annotation a catch variable may carry, and
			// it does real work: it opts the variable back out of `unknown`.
			if ((annotationType.flags & TypeFlags.Unknown) === 0) {
				return;
			}

			if (namesAnErasedAlias(annotation.typeAnnotation, annotationType)) {
				return;
			}

			context.report({
				data: { typeName: display(annotationType) },
				fix: (fixer) => fixer.remove(annotation),
				messageId: CATCH_MESSAGE_ID,
				node: annotation,
			});
		},
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

			if (declarationsAreIsolated && isExported(node, node.id.name)) {
				return;
			}

			if (receivesAnnotationContext(node.init) || suppliesParameterContext(node.init)) {
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
