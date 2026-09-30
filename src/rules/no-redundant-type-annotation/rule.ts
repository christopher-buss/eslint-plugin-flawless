import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type {
	Expression,
	Signature,
	Type,
	TypeReference,
	UnionOrIntersectionType,
} from "typescript";
import {
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

/** A node that passes its operands to a signature's parameters. */
type CallLike =
	| TSESTree.CallExpression
	| TSESTree.JSXOpeningElement
	| TSESTree.NewExpression
	| TSESTree.TaggedTemplateExpression;

/** A function whose parameters can take their types from a context. */
type FunctionExpressionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

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
 * Counts the parameters a caller must pass, up to the first optional, default,
 * or rest parameter.
 *
 * @param parameters - The parameters, after any `this` parameter.
 * @returns How many leading parameters are required.
 */
function countLeadingRequired(parameters: ReadonlyArray<TSESTree.Parameter>): number {
	const index = parameters.findIndex((parameter) => {
		return (
			parameter.type === AST_NODE_TYPES.AssignmentPattern ||
			parameter.type === AST_NODE_TYPES.RestElement ||
			parameter.type === AST_NODE_TYPES.TSParameterProperty ||
			parameter.optional
		);
	});
	return index === -1 ? parameters.length : index;
}

/**
 * Reports whether a signature declares type parameters of its own.
 *
 * A constructor declares none itself: they sit on the class, and the
 * signature built from it carries them.
 *
 * @param signature - The signature to inspect.
 * @returns True when a call to it infers type arguments.
 */
function isGeneric(signature: Signature): boolean {
	return (signature.getTypeParameters()?.length ?? 0) > 0;
}

/**
 * Reports whether the node is an `as const` or `<const>` assertion.
 *
 * @param node - The node to inspect.
 * @returns True when the node asserts `const`.
 */
function isConstAssertion(
	node: TSESTree.Node,
): node is TSESTree.TSAsExpression | TSESTree.TSTypeAssertion {
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
 * Reports whether a type, or a member of its union, has any of `flags`.
 *
 * @param type - The type to inspect.
 * @param flags - The type flags to look for.
 * @returns True when the type or a union member matches.
 */
function someMember(type: Type, flags: TypeFlags): boolean {
	const members =
		(type.flags & TypeFlags.Union) !== 0 ? (type as UnionOrIntersectionType).types : [type];
	return members.some((member) => (member.flags & flags) !== 0);
}

/**
 * Reports whether a type, or a member of it, is a template literal or
 * string mapping type.
 *
 * A template expression is typed as one of these only under a context that
 * asks for it; without one it is `string`.
 *
 * @param type - The type to inspect.
 * @returns True when the type holds a template type.
 */
function hasTemplateType(type: Type): boolean {
	return someMember(type, TypeFlags.TemplateLiteral | TypeFlags.StringMapping);
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
function isFunctionNode(
	node: TSESTree.Node,
): node is
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression {
	return (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionDeclaration
	);
}

/**
 * Reports whether a node is a function expression, the only kind of function
 * whose parameters can take their types from a context.
 *
 * @param node - The node to inspect.
 * @returns True for an arrow or function expression.
 */
function isFunctionExpressionNode(node: TSESTree.Node): node is FunctionExpressionNode {
	return (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionExpression
	);
}

/**
 * Reports whether a parent hands its own contextual type down to a child
 * unchanged, so the child's context is decided further up.
 *
 * This is the closed set of forwarders the anchor search climbs through: an
 * array element, an object property value or method, a spread, a
 * conditional's branch, a logical operand, a sequence's last expression, a
 * non-null assertion, and a const assertion. Any other assertion supplies a
 * type of its own, so it is an anchor rather than a forwarder.
 *
 * @param parent - The parent to inspect.
 * @param child - The child the search climbed from.
 * @returns True when the child shares the parent's context.
 */
function forwardsContext(parent: TSESTree.Node, child: TSESTree.Node): boolean {
	if (
		parent.type === AST_NODE_TYPES.ArrayExpression ||
		parent.type === AST_NODE_TYPES.LogicalExpression ||
		parent.type === AST_NODE_TYPES.ObjectExpression ||
		parent.type === AST_NODE_TYPES.SpreadElement ||
		parent.type === AST_NODE_TYPES.TSNonNullExpression ||
		isConstAssertion(parent)
	) {
		return true;
	}

	if (parent.type === AST_NODE_TYPES.ConditionalExpression) {
		return parent.test !== child;
	}

	if (parent.type === AST_NODE_TYPES.Property) {
		return (
			parent.parent.type === AST_NODE_TYPES.ObjectExpression &&
			parent.kind === "init" &&
			parent.value === child
		);
	}

	return parent.type === AST_NODE_TYPES.SequenceExpression && parent.expressions.at(-1) === child;
}

/**
 * Finds the function that returns a child as its value.
 *
 * A concise arrow body, a `return` argument, and a `yield` operand are all
 * return values: a generator's context types what it yields. The nearest
 * enclosing function owns a `return` or `yield`. A delegating `yield*` passes
 * its operand an iterable of the context instead, so it is not followed.
 *
 * @param parent - The parent to inspect.
 * @param child - The child the search climbed from.
 * @returns The returning function, or undefined when the child is not a
 *   return value.
 */
function getReturningFunction(
	parent: TSESTree.Node,
	child: TSESTree.Node,
):
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression
	| undefined {
	if (parent.type === AST_NODE_TYPES.ArrowFunctionExpression && parent.body === child) {
		return parent;
	}

	const isReturned =
		(parent.type === AST_NODE_TYPES.ReturnStatement && parent.argument === child) ||
		(parent.type === AST_NODE_TYPES.YieldExpression &&
			!parent.delegate &&
			parent.argument === child);
	if (!isReturned) {
		return undefined;
	}

	// ESLint gives the program a null parent, so the walk stops there.
	let ancestor: TSESTree.Node = parent;
	while (!isFunctionNode(ancestor)) {
		if (ancestor.type === AST_NODE_TYPES.Program) {
			return undefined;
		}

		ancestor = ancestor.parent;
	}

	return ancestor;
}

/**
 * Reports whether an assignment pattern is a parameter's default value, as
 * opposed to a default inside a destructuring pattern.
 *
 * @param pattern - The pattern to inspect.
 * @returns True when the pattern is a whole parameter.
 */
function isParameterDefault(pattern: TSESTree.AssignmentPattern): boolean {
	const owner = pattern.parent;
	if (owner.type === AST_NODE_TYPES.TSParameterProperty) {
		return true;
	}

	return isFunctionNode(owner) && owner.params.includes(pattern);
}

/**
 * Reports whether a parent gives a child a contextual type written in the
 * source, one no annotation this rule removes can change.
 *
 * These are the anchors that need no type information: a variable's or class
 * property's annotation, a `satisfies`, a type assertion, and an annotated
 * parameter's default value. A variable's or outer parameter's annotation can
 * itself be reported, so the check that owns it asks whether it anchors
 * anything before reporting it.
 *
 * @param parent - The parent to inspect.
 * @param child - The child the search climbed from.
 * @returns True when the parent is the child's anchor.
 */
function isWrittenAnchor(parent: TSESTree.Node, child: TSESTree.Node): boolean {
	if (
		parent.type === AST_NODE_TYPES.AccessorProperty ||
		parent.type === AST_NODE_TYPES.PropertyDefinition
	) {
		return parent.value === child && parent.typeAnnotation !== undefined;
	}

	if (parent.type === AST_NODE_TYPES.AssignmentPattern) {
		return (
			parent.right === child &&
			isParameterDefault(parent) &&
			getParameterAnnotation(parent) !== undefined
		);
	}

	if (parent.type === AST_NODE_TYPES.VariableDeclarator) {
		return parent.init === child && parent.id.typeAnnotation !== undefined;
	}

	if (
		parent.type === AST_NODE_TYPES.TSAsExpression ||
		parent.type === AST_NODE_TYPES.TSTypeAssertion
	) {
		return !isConstAssertion(parent);
	}

	return parent.type === AST_NODE_TYPES.TSSatisfiesExpression;
}

/**
 * Finds the call that passes a child to one of its parameters.
 *
 * Besides call and `new` arguments, a tagged template passes each hole after
 * the strings array, and a JSX element passes its attributes and children
 * together as the component's props.
 *
 * @param parent - The parent to inspect.
 * @param child - The child the search climbed from.
 * @returns The call, or undefined when the child is not an argument.
 */
function getReceivingCall(parent: TSESTree.Node, child: TSESTree.Node): CallLike | undefined {
	if (
		parent.type === AST_NODE_TYPES.CallExpression ||
		parent.type === AST_NODE_TYPES.NewExpression
	) {
		return parent.arguments.includes(child as TSESTree.CallExpressionArgument)
			? parent
			: undefined;
	}

	if (parent.type === AST_NODE_TYPES.TemplateLiteral) {
		return parent.parent.type === AST_NODE_TYPES.TaggedTemplateExpression &&
			parent.parent.quasi === parent
			? parent.parent
			: undefined;
	}

	if (parent.type === AST_NODE_TYPES.JSXSpreadAttribute) {
		return parent.parent;
	}

	if (parent.type !== AST_NODE_TYPES.JSXExpressionContainer) {
		return undefined;
	}

	const holder = parent.parent;
	if (holder.type === AST_NODE_TYPES.JSXAttribute) {
		return holder.parent;
	}

	return holder.type === AST_NODE_TYPES.JSXElement ? holder.openingElement : undefined;
}

/**
 * Reports whether a JSX tag names an intrinsic element rather than a
 * component.
 *
 * An intrinsic element's props come from a fixed entry of
 * `JSX.IntrinsicElements`, so there is no signature to infer through.
 *
 * @param name - The tag name.
 * @returns True for a lowercase, dashed, or namespaced tag.
 */
function isIntrinsicElement(name: TSESTree.JSXTagNameExpression): boolean {
	if (name.type === AST_NODE_TYPES.JSXNamespacedName) {
		return true;
	}

	return (
		name.type === AST_NODE_TYPES.JSXIdentifier &&
		(/^[a-z]/u.test(name.name) || name.name.includes("-"))
	);
}

/**
 * Finds the expression that names what a call invokes.
 *
 * @param call - The call to read.
 * @returns The callee, tag, or component name.
 */
function getCallee(call: CallLike): TSESTree.Node {
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
 * A `super` call runs the base class's constructor, and a JSX component may
 * be a function or a class.
 *
 * @param call - The call to read.
 * @returns The signature kinds to look up on the callee.
 */
function getSignatureKinds(call: CallLike): Array<SignatureKind> {
	if (
		call.type === AST_NODE_TYPES.NewExpression ||
		(call.type === AST_NODE_TYPES.CallExpression && call.callee.type === AST_NODE_TYPES.Super)
	) {
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
function hasThisParameter(node: FunctionExpressionNode): boolean {
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
function usesContextualThis(node: FunctionExpressionNode): boolean {
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
	const anchors = new Map<FunctionExpressionNode, TSESTree.Node | undefined>();

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
	 * Lists the signatures a call's callee offers, before any inference.
	 *
	 * An optional call only goes ahead when the callee is there, so its
	 * nullish half is dropped first.
	 *
	 * @param call - The call to read.
	 * @returns The callee's call or construct signatures.
	 */
	function getCalleeSignatures(call: CallLike): ReadonlyArray<Signature> {
		const calleeType = checker.getNonNullableType(services.getTypeAtLocation(getCallee(call)));
		return getSignatureKinds(call).flatMap((kind) =>
			checker.getSignaturesOfType(calleeType, kind),
		);
	}

	/**
	 * Reports whether a call, `new` expression, or tagged template could have
	 * its result shaped by the annotation itself.
	 *
	 * When a generic signature's return type involves its own type parameters,
	 * and the call site supplies no explicit type arguments, the contextual type
	 * flows into inference. `declare function foo<T = number>(): T; const x:
	 * string = foo();` types the call as `string` only because the annotation
	 * is there; removing it leaves `number`.
	 *
	 * Whether the return type involves a type parameter is asked of the types,
	 * not the written names, which `typeof` or an inferred return type can hide:
	 * instantiating a type that mentions none of the parameters hands back the
	 * very same type, so any other result counts as sensitive.
	 *
	 * @param node - The call, `new` expression, or tagged template to inspect.
	 * @returns True when the annotation may be feeding inference.
	 */
	function isInferenceSensitiveCall(
		node: TSESTree.CallExpression | TSESTree.NewExpression | TSESTree.TaggedTemplateExpression,
	): boolean {
		if (node.typeArguments !== undefined) {
			return false;
		}

		const signature = checker.getResolvedSignature(services.esTreeNodeToTSNodeMap.get(node));
		if (signature === undefined) {
			return false;
		}

		// `getDeclaration` is typed as total, but synthesized signatures, such
		// as a class's implicit constructor, have no declaration at runtime.
		// Without one there is no declared form to compare against.
		const declaration = signature.getDeclaration() as
			| ReturnType<Signature["getDeclaration"]>
			| undefined;
		if (declaration === undefined) {
			return getCalleeSignatures(node).some(isGeneric);
		}

		const declared = checker.getSignatureFromDeclaration(declaration);
		if (declared === undefined || !isGeneric(declared)) {
			return false;
		}

		return (
			checker.getReturnTypeOfSignature(signature) !==
			checker.getReturnTypeOfSignature(declared)
		);
	}

	/**
	 * Reports whether a call passes its arguments to one signature whose
	 * parameter types are settled before the arguments are looked at.
	 *
	 * That takes exactly one signature, so no argument can pick an overload,
	 * and no type parameters left to infer, so no argument can change what
	 * they resolve to. Explicit type arguments settle a generic signature.
	 * Both are asked of the callee's type, not of how it is written.
	 *
	 * @param call - The call to inspect.
	 * @returns True when the call's parameter types are fixed.
	 */
	function hasFixedSignature(call: CallLike): boolean {
		if (call.type === AST_NODE_TYPES.JSXOpeningElement && isIntrinsicElement(call.name)) {
			return true;
		}

		// An immediately invoked function types an untyped parameter from its
		// argument, so the argument's context would come from itself.
		if (
			call.type === AST_NODE_TYPES.CallExpression &&
			isFunctionExpressionNode(call.callee) &&
			call.callee.params.some(isUntypedParameter)
		) {
			return false;
		}

		const signatures = getCalleeSignatures(call);
		const signature = signatures.length === 1 ? signatures.at(0) : undefined;
		if (signature === undefined) {
			return false;
		}

		return call.typeArguments !== undefined || !isGeneric(signature);
	}

	/**
	 * Finds the node that fixes a function expression's contextual type,
	 * independent of any annotation this rule could remove.
	 *
	 * A parameter annotation is only a restatement when its context would
	 * survive the fix: when it depends on the annotation itself, as it does
	 * through a generic call's inference or an overload pick, or on another
	 * annotation removed in the same pass, removing it changes the parameter's
	 * type. So the search climbs only through the closed set of forwarders in
	 * `forwardsContext`, follows a returned value out to its function when that
	 * function has no return type of its own, and stops at the first other
	 * parent. That parent must be a recognized anchor: a written type (see
	 * `isWrittenAnchor`), a function's return type, or a call whose signature
	 * is fixed (see `hasFixedSignature`). Anything else, including a shape this
	 * search does not know, finds no anchor, so an unknown context costs a
	 * report rather than a wrong fix.
	 *
	 * @param node - The function expression to locate.
	 * @returns The anchor, or undefined when the context is not proven stable.
	 */
	function resolveContextAnchor(node: FunctionExpressionNode): TSESTree.Node | undefined {
		if (anchors.has(node)) {
			return anchors.get(node);
		}

		let current: TSESTree.Node = node;
		let anchor: TSESTree.Node | undefined;
		while (current.type !== AST_NODE_TYPES.Program) {
			const parent: TSESTree.Node = current.parent;
			if (forwardsContext(parent, current)) {
				current = parent;
				continue;
			}

			const returning = getReturningFunction(parent, current);
			if (returning !== undefined) {
				// A written return type is the returned value's context. Without
				// one, a declaration has no context to pass on, and an expression
				// passes on its own.
				if (returning.returnType !== undefined) {
					anchor = returning;
				} else if (returning.type !== AST_NODE_TYPES.FunctionDeclaration) {
					current = returning;
					continue;
				}

				break;
			}

			if (isWrittenAnchor(parent, current)) {
				anchor = parent;
				break;
			}

			const call = getReceivingCall(parent, current);
			if (call !== undefined && hasFixedSignature(call)) {
				anchor = call;
			}

			break;
		}

		anchors.set(node, anchor);
		return anchor;
	}

	/**
	 * Reports whether an annotated parameter in `root` takes its context from
	 * `anchor`.
	 *
	 * When the anchor is itself an annotation this rule can report, both it and
	 * the parameter's annotation look redundant, but only one of them can go:
	 * ESLint applies every fix of a pass together, and removing both leaves the
	 * parameter implicitly `any`. The parameter check owns the case, so the
	 * check that owns the anchor steps back when this answers true.
	 *
	 * @param anchor - The variable declarator or parameter default to match.
	 * @param root - The expression to search, the anchor's value.
	 * @returns True when some annotated parameter anchors to it.
	 */
	function anchorsAnnotatedParameter(anchor: TSESTree.Node, root: TSESTree.Node): boolean {
		function test(child: TSESTree.Node): boolean {
			return (
				isFunctionExpressionNode(child) &&
				!child.params.every(isUntypedParameter) &&
				resolveContextAnchor(child) === anchor
			);
		}

		return test(root) || someDescendant(root, () => false, test);
	}

	/**
	 * Reports whether the declaration emitter reads a node's type from the
	 * expression around it.
	 *
	 * Under `isolatedDeclarations` the emitter types an exported variable
	 * without an annotation, or a default export, from its syntax alone, so a
	 * function's parameters there must be annotated: `satisfies` does not
	 * change that. A written type on the declaration, a type assertion, a
	 * function's return type, or a block ends the search, since the emitter
	 * reads the written type or nothing. A class property without an annotation is treated as emitted
	 * whether or not its class is exported.
	 *
	 * @param node - The function expression to locate.
	 * @returns True when the emitter would need the parameter annotations.
	 */
	function feedsEmittedType(node: FunctionExpressionNode): boolean {
		let current: TSESTree.Node = node;
		while (current.type !== AST_NODE_TYPES.Program) {
			const parent: TSESTree.Node = current.parent;
			if (
				parent.type === AST_NODE_TYPES.BlockStatement ||
				parent.type === AST_NODE_TYPES.StaticBlock
			) {
				return false;
			}

			// A written return type is what the emitter reads for the body.
			if (
				isFunctionNode(parent) &&
				parent.body === current &&
				parent.returnType !== undefined
			) {
				return false;
			}

			if (
				parent.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
				parent.type === AST_NODE_TYPES.TSExportAssignment
			) {
				return true;
			}

			if (
				parent.type === AST_NODE_TYPES.AccessorProperty ||
				parent.type === AST_NODE_TYPES.PropertyDefinition
			) {
				return parent.value === current && parent.typeAnnotation === undefined;
			}

			if (parent.type === AST_NODE_TYPES.VariableDeclarator) {
				return (
					parent.init === current &&
					parent.id.typeAnnotation === undefined &&
					isExported(parent)
				);
			}

			if (
				(parent.type === AST_NODE_TYPES.TSAsExpression ||
					parent.type === AST_NODE_TYPES.TSTypeAssertion) &&
				!isConstAssertion(parent)
			) {
				return false;
			}

			current = parent;
		}

		return false;
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

		// A template expression is a template type only because the context
		// asks for one.
		if (node.type === AST_NODE_TYPES.TemplateLiteral) {
			return hasTemplateType(services.getTypeAtLocation(node));
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

		if (node.type === AST_NODE_TYPES.TSNonNullExpression || isConstAssertion(node)) {
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
	 * logical expression, through `await`, `!`, `as const`, and an optional
	 * chain, and into call arguments.
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

		// A tagged template calls its tag, so a generic tag infers the same way.
		if (node.type === AST_NODE_TYPES.TaggedTemplateExpression) {
			return isInferenceSensitiveCall(node);
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

		// An optional chain wraps the call it makes.
		if (
			node.type === AST_NODE_TYPES.ChainExpression ||
			node.type === AST_NODE_TYPES.TSNonNullExpression ||
			isConstAssertion(node)
		) {
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
	 * @returns True when the module exports that variable.
	 */
	function isExported(node: TSESTree.VariableDeclarator): boolean {
		const statement = node.parent.parent;
		if (statement.type === AST_NODE_TYPES.ExportNamedDeclaration) {
			return true;
		}

		// An export list can only reach a binding at the top of the module. The
		// names a destructuring pattern binds are not followed into it, so the
		// pattern counts as exported.
		return (
			statement.type === AST_NODE_TYPES.Program &&
			(node.id.type !== AST_NODE_TYPES.Identifier || getExportedNames().has(node.id.name))
		);
	}

	/**
	 * Reports whether an initializer is a literal written in place, whose type
	 * `let` widens.
	 *
	 * An enum member read straight off its enum counts too: `let x = E.A` is
	 * `E`.
	 *
	 * @param node - The initializer to inspect.
	 * @returns True for a fresh literal.
	 */
	function isFreshLiteral(node: TSESTree.Expression): boolean {
		if (node.type === AST_NODE_TYPES.Literal) {
			return node.value !== null && !(node.value instanceof RegExp);
		}

		if (node.type === AST_NODE_TYPES.TemplateLiteral) {
			return node.expressions.length === 0;
		}

		if (node.type === AST_NODE_TYPES.UnaryExpression) {
			return (
				(node.operator === "-" || node.operator === "+") &&
				node.argument.type === AST_NODE_TYPES.Literal &&
				(typeof node.argument.value === "number" || typeof node.argument.value === "bigint")
			);
		}

		if (node.type !== AST_NODE_TYPES.MemberExpression) {
			return false;
		}

		const symbol = checker.getSymbolAtLocation(services.esTreeNodeToTSNodeMap.get(node));
		return symbol !== undefined && (symbol.flags & SymbolFlags.EnumMember) !== 0;
	}

	/**
	 * Reports whether an initializer depends on the type of an annotated
	 * variable in a way that can loop back.
	 *
	 * Without its annotation a variable takes its type from its initializer,
	 * so an initializer that reads the variable itself, or that reads another
	 * annotated variable from inside a nested function, may form a cycle once
	 * both annotations go: the variable becomes implicitly `any`. A cycle made
	 * only of direct reads is already a use before declaration, so every cycle
	 * has a read from a nested function, and the variable holding it keeps
	 * its annotation.
	 *
	 * @param node - The declarator to inspect.
	 * @param init - Its initializer.
	 * @returns True when the annotation may be what breaks a cycle.
	 */
	function referencesAnnotatedVariable(
		node: TSESTree.VariableDeclarator,
		init: TSESTree.Expression,
	): boolean {
		const [start, end] = init.range;
		function isInside(child: TSESTree.Node): boolean {
			return child.range[0] >= start && child.range[1] <= end;
		}

		const readsItself = context.sourceCode
			.getDeclaredVariables(node)
			.some((variable) => variable.references.some(({ identifier }) => isInside(identifier)));
		if (readsItself) {
			return true;
		}

		const scopes = context.sourceCode.scopeManager?.scopes ?? [];
		return scopes.some((scope) => {
			return (
				isInside(scope.block) &&
				scope.references.some(({ resolved }) => {
					return (resolved?.defs ?? []).some(({ node: definition }) => {
						return (
							definition.type === AST_NODE_TYPES.VariableDeclarator &&
							definition.id.typeAnnotation !== undefined &&
							definition.init !== null
						);
					});
				})
			);
		});
	}

	/**
	 * Reports whether the declaration emitter reads a variable that the module
	 * does not export.
	 *
	 * An exported declaration can still mention it, through `typeof`, a
	 * computed key, or `export default`. Only a read inside a function body is
	 * out of the emitter's sight, so any other read counts.
	 *
	 * @param node - The declarator to inspect.
	 * @returns True when the emitter may need the variable's type.
	 */
	function isReadByEmitter(node: TSESTree.VariableDeclarator): boolean {
		return context.sourceCode.getDeclaredVariables(node).some((variable) => {
			return variable.references.some(({ identifier }) => {
				if (identifier === node.id) {
					return false;
				}

				let current: TSESTree.Node = identifier;
				while (current.type !== AST_NODE_TYPES.Program) {
					const parent: TSESTree.Node = current.parent;
					if (
						current.type === AST_NODE_TYPES.BlockStatement &&
						isFunctionNode(parent) &&
						parent.body === current
					) {
						return false;
					}

					current = parent;
				}

				return true;
			});
		});
	}

	function checkFunctionParameters(node: FunctionExpressionNode): void {
		if (node.params.every((parameter) => isUntypedParameter(parameter))) {
			return;
		}

		if (resolveContextAnchor(node) === undefined) {
			return;
		}

		// The emitter reads these annotations, so they are not restatements.
		if (declarationsAreIsolated && feedsEmittedType(node)) {
			return;
		}

		const contextualType = checker.getContextualType(
			services.esTreeNodeToTSNodeMap.get(node) as Expression,
		);
		// TypeScript takes a contextual signature from a union only when every
		// member offers the same one, which the union's own signatures do not
		// show, so a union is left alone.
		if (contextualType === undefined || contextualType.isUnion()) {
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

		// A function that needs more arguments than the signature passes gets no
		// contextual signature at all.
		if (
			!isRestParameter(signature, signature.parameters.length - 1) &&
			signature.parameters.length < countLeadingRequired(parameters)
		) {
			return;
		}

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

			// A default value can take its context from this annotation, which
			// then has to stay for that parameter's report to hold.
			if (
				parameter.type === AST_NODE_TYPES.AssignmentPattern &&
				anchorsAnnotatedParameter(parameter, parameter.right)
			) {
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

			if (declarationsAreIsolated && (isExported(node) || isReadByEmitter(node))) {
				return;
			}

			if (receivesAnnotationContext(node.init)) {
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

			// `let` widens a literal type on inference, but only one the
			// initializer creates fresh: `let x = "a"` is `string`, while a
			// variable of type `"a"` stays `"a"`. The checker does not say which,
			// so only a literal written right there is widened, and any other
			// initializer whose type widening would change is left alone.
			if (kind === "let") {
				const widenedType = checker.getBaseTypeOfLiteralType(inferredType);
				if (widenedType !== inferredType && !isFreshLiteral(node.init)) {
					return;
				}

				inferredType = widenedType;
			}

			// A `unique symbol` survives only on a declaration initialized by
			// `Symbol()`; anywhere else it widens to `symbol`.
			if (someMember(inferredType, TypeFlags.UniqueESSymbol)) {
				return;
			}

			if (containsAny(inferredType)) {
				return;
			}

			if (!typesAreIdentical(annotationType, inferredType)) {
				return;
			}

			// Last, as these walk the whole initializer. The parameter check owns
			// an annotation that anchors a parameter's context, and an
			// initializer that refers back to the variable needs its annotation
			// to break the cycle.
			if (
				anchorsAnnotatedParameter(node, node.init) ||
				referencesAnnotatedVariable(node, node.init)
			) {
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
