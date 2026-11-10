import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES, AST_TOKEN_TYPES, TSESLint } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type {
	Expression,
	Signature,
	Type,
	TypeReference,
	UnionOrIntersectionType,
} from "typescript";
import ts from "typescript";

import type { EslintRuleModule } from "../../util";
import { createEslintRule } from "../../util";
import { pushChildNodes } from "../../utils/nested-expressions";
import { type Candidate, verifyAnnotations } from "./verify";

const {
	isArrowFunction,
	isFunctionDeclaration,
	isFunctionExpression,
	isMethodDeclaration,
	isParameter,
	isTypeReferenceNode,
	isVariableDeclaration,
	ObjectFlags,
	SignatureKind,
	SymbolFlags,
	TypeFlags,
	TypeFormatFlags,
} = ts;

export const RULE_NAME = "no-redundant-type-annotation";

const CATCH_MESSAGE_ID = "redundantCatch";
const MESSAGE_ID = "redundant";
const PARAMETER_MESSAGE_ID = "redundantParameter";
const RETURN_MESSAGE_ID = "redundantReturn";

export type MessageIds =
	| typeof CATCH_MESSAGE_ID
	| typeof MESSAGE_ID
	| typeof PARAMETER_MESSAGE_ID
	| typeof RETURN_MESSAGE_ID;

export interface NoRedundantTypeAnnotationOptions {
	/**
	 * Check the return types of function expressions that
	 * `explicit-function-return-type` with `allowExpressions` lets omit.
	 */
	readonly allowExpressions?: boolean;
	/** Check the return type of every function. */
	readonly checkReturnTypes?: boolean;
}

export type Options = [NoRedundantTypeAnnotationOptions?];

const DEFAULT_OPTIONS = { allowExpressions: false, checkReturnTypes: false };

/**
 * The parents that make a function expression a declaration to
 * `explicit-function-return-type`, which then requires its return type even
 * with `allowExpressions`. This copies that rule's list.
 */
const DECLARING_PARENTS: ReadonlySet<AST_NODE_TYPES> = new Set([
	AST_NODE_TYPES.ExportDefaultDeclaration,
	AST_NODE_TYPES.MethodDefinition,
	AST_NODE_TYPES.PropertyDefinition,
	AST_NODE_TYPES.VariableDeclarator,
]);

/** A node that passes its operands to a signature's parameters. */
type CallLike =
	| TSESTree.CallExpression
	| TSESTree.JSXOpeningElement
	| TSESTree.NewExpression
	| TSESTree.TaggedTemplateExpression;

/** A call that passes values to the parameters of a signature. */
type ArgumentCall =
	| TSESTree.CallExpression
	| TSESTree.NewExpression
	| TSESTree.TaggedTemplateExpression;

/** A function that can carry a return type annotation and has a body. */
type ReturnTypedFunction =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

/** An arrow or function expression, also one that is a class method. */
type FunctionExpressionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

/** A redundant annotation, with what its report shows. */
interface Removal {
	/** The annotation to remove. */
	readonly annotation: TSESTree.TSTypeAnnotation;
	/** The report's message identifier. */
	readonly messageId: MessageIds;
	/** Report only when the verifier accepts the removal. */
	readonly requiresProof?: boolean;
	/** The annotated type to show in the report. */
	readonly type: Type;
}

/**
 * A parameter of a function outside a class body. Only a constructor can
 * declare a parameter property, and the parser rejects one anywhere else.
 */
type ContextualParameter = Exclude<TSESTree.Parameter, TSESTree.TSParameterProperty>;

/** A function whose parameters can take their types from a context. */
type ContextualFunction = FunctionExpressionNode & { params: Array<ContextualParameter> };

const messages = {
	[CATCH_MESSAGE_ID]:
		"The `{{typeName}}` annotation restates the type a catch variable already has under `useUnknownInCatchVariables`. Remove it and let the compiler option carry the type.",
	[MESSAGE_ID]:
		"The `{{typeName}}` annotation restates the type the initializer already has. Remove it and let inference carry the type.",
	[PARAMETER_MESSAGE_ID]:
		"The `{{typeName}}` annotation restates the type this parameter already gets from its context. Remove it and let inference carry the type.",
	[RETURN_MESSAGE_ID]:
		"The `{{typeName}}` return type restates the type the function already returns. Remove it and let inference carry the type.",
};

/**
 * How an expression depends on the annotation's context: not at all, surely,
 * or through a callback that takes context from a call, which only the
 * verifier can clear.
 */
type ContextDependence = "dependent" | "independent" | "unproven";

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
function isUntypedParameter(parameter: ContextualParameter): boolean {
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
	parameter: ContextualParameter,
): TSESTree.TSTypeAnnotation | undefined {
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
function countLeadingRequired(parameters: ReadonlyArray<ContextualParameter>): number {
	const index = parameters.findIndex((parameter) => {
		return (
			parameter.type === AST_NODE_TYPES.AssignmentPattern ||
			parameter.type === AST_NODE_TYPES.RestElement ||
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
function someMember(type: Type, flags: ts.TypeFlags): boolean {
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
 * Lists the members of a union, or the type itself.
 *
 * @param type - The type to split.
 * @returns The union's members, or the type alone.
 */
function unionMembers(type: Type): ReadonlyArray<Type> {
	return type.isUnion() ? type.types : [type];
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
 * Reports whether a node is a function body or a static block, which the
 * declaration emitter never prints.
 *
 * @param node - The node to inspect, below the program.
 * @returns True when the node hides its contents from the emitter.
 */
function isEmitterBoundary(node: Exclude<TSESTree.Node, TSESTree.Program>): boolean {
	return (
		node.type === AST_NODE_TYPES.StaticBlock ||
		(isFunctionNode(node.parent) && node.parent.body === node)
	);
}

/**
 * Reports whether a node is inside a function body or a static block, which
 * the declaration emitter never prints.
 *
 * @param node - The node to inspect.
 * @returns True when an enclosing body hides the node from the emitter.
 */
function isHiddenFromEmitter(node: TSESTree.Node): boolean {
	for (let current = node; current.type !== AST_NODE_TYPES.Program; current = current.parent) {
		if (isEmitterBoundary(current)) {
			return true;
		}
	}

	return false;
}

/**
 * Reports whether a reference sits where the declaration emitter prints it.
 *
 * The emitter copies a `typeof` query, a computed key of a type member, an
 * `export default` or `export =` of a name, an export list, a class
 * `extends` clause, and an enum member initializer. It prints no other read,
 * and nothing inside a function body or static block.
 *
 * @param identifier - The reference to inspect.
 * @returns True when the emitter reads the referenced declaration there.
 */
function isEmitterRead(identifier: TSESTree.Identifier | TSESTree.JSXIdentifier): boolean {
	// One walk to the root finds both a hiding body and an enum member
	// initializer, which is copied whole at any depth.
	let inEnumInitializer = false;
	for (let node: TSESTree.Node = identifier; node.type !== AST_NODE_TYPES.Program; ) {
		const parent: TSESTree.Node = node.parent;
		if (isEmitterBoundary(node)) {
			return false;
		}

		if (parent.type === AST_NODE_TYPES.TSEnumMember && parent.initializer === node) {
			inEnumInitializer = true;
		}

		node = parent;
	}

	if (inEnumInitializer) {
		return true;
	}

	// Climb an entity name: `c.a`, `N.c`, `typeof N.c`.
	let current: TSESTree.Node = identifier;
	while (
		(current.parent.type === AST_NODE_TYPES.MemberExpression &&
			current.parent.object === current &&
			!current.parent.computed) ||
		(current.parent.type === AST_NODE_TYPES.TSQualifiedName && current.parent.left === current)
	) {
		current = current.parent;
	}

	const { parent } = current;
	if (parent.type === AST_NODE_TYPES.TSTypeQuery) {
		return true;
	}

	if (
		parent.type === AST_NODE_TYPES.ClassDeclaration ||
		parent.type === AST_NODE_TYPES.ClassExpression
	) {
		return parent.superClass === current;
	}

	if (parent.type === AST_NODE_TYPES.ExportDefaultDeclaration) {
		return parent.declaration === current;
	}

	if (parent.type === AST_NODE_TYPES.TSExportAssignment) {
		return parent.expression === current;
	}

	if (parent.type === AST_NODE_TYPES.ExportSpecifier) {
		return parent.local === current;
	}

	// A computed key of a class member is an error with or without the
	// annotation on TypeScript 6, but it is kept for older versions.
	if (
		parent.type === AST_NODE_TYPES.AccessorProperty ||
		parent.type === AST_NODE_TYPES.MethodDefinition ||
		parent.type === AST_NODE_TYPES.PropertyDefinition ||
		parent.type === AST_NODE_TYPES.TSAbstractAccessorProperty ||
		parent.type === AST_NODE_TYPES.TSAbstractMethodDefinition ||
		parent.type === AST_NODE_TYPES.TSAbstractPropertyDefinition ||
		parent.type === AST_NODE_TYPES.TSMethodSignature ||
		parent.type === AST_NODE_TYPES.TSPropertySignature
	) {
		return parent.computed && parent.key === current;
	}

	return false;
}

/**
 * Reports whether a node is a function whose parameters can take their types
 * from a context: an arrow or function expression outside a class body.
 *
 * A class member never takes its parameter types from a context, not even
 * from an interface the class implements. A constructor is a class member, so
 * no parameter property gets through.
 *
 * @param node - The node to inspect.
 * @returns True for an arrow, or a function expression that is not a class
 *   member.
 */
function isContextualFunction(node: TSESTree.Node): node is ContextualFunction {
	return (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		(node.type === AST_NODE_TYPES.FunctionExpression &&
			node.parent.type !== AST_NODE_TYPES.MethodDefinition)
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
function getSignatureKinds(call: CallLike): Array<ts.SignatureKind> {
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
 * Finds the operands that an expression hands its own contextual type to.
 *
 * These are both branches of a conditional, both operands of a logical
 * expression, the last expression of a sequence, and the operand of `await`,
 * `!`, `as const`, and an optional chain.
 *
 * @param node - The expression to inspect.
 * @returns The operands, or undefined when the expression forwards no
 *   context.
 */
function contextForwardedOperands(node: TSESTree.Node): ReadonlyArray<TSESTree.Node> | undefined {
	if (node.type === AST_NODE_TYPES.ConditionalExpression) {
		return [node.consequent, node.alternate];
	}

	if (node.type === AST_NODE_TYPES.LogicalExpression) {
		return [node.left, node.right];
	}

	if (node.type === AST_NODE_TYPES.SequenceExpression) {
		return node.expressions.slice(-1);
	}

	if (node.type === AST_NODE_TYPES.AwaitExpression) {
		return [node.argument];
	}

	// An optional chain wraps the call it makes.
	if (
		node.type === AST_NODE_TYPES.ChainExpression ||
		node.type === AST_NODE_TYPES.TSNonNullExpression ||
		isConstAssertion(node)
	) {
		return [node.expression];
	}

	return undefined;
}

/**
 * Combines the dependence of several expressions. A sure dependence wins and
 * stops the walk, then an unproven one.
 *
 * @template T - The type of the expressions.
 * @param items - The expressions to inspect.
 * @param dependence - Finds the dependence of one expression.
 * @returns The strongest dependence of the expressions.
 */
function strongestDependence<T>(
	items: ReadonlyArray<T>,
	dependence: (item: T, index: number) => ContextDependence,
): ContextDependence {
	let result: ContextDependence = "independent";
	for (const [index, item] of items.entries()) {
		const next = dependence(item, index);
		if (next === "dependent") {
			return next;
		}

		if (next === "unproven") {
			result = next;
		}
	}

	return result;
}

/**
 * Finds the values a call passes, by parameter position. A tagged template
 * passes its strings first, which have no node.
 *
 * @param call - The call to inspect.
 * @returns The value at each parameter position.
 */
function getPassedValues(call: ArgumentCall): ReadonlyArray<TSESTree.Node | undefined> {
	return call.type === AST_NODE_TYPES.TaggedTemplateExpression
		? [undefined, ...call.quasi.expressions]
		: call.arguments;
}

/**
 * Reports whether a function declares a `this` parameter.
 *
 * @param node - The function to inspect.
 * @returns True when the first parameter is `this`.
 */
function hasThisParameter(node: { readonly params: ReadonlyArray<TSESTree.Parameter> }): boolean {
	const [first] = node.params;
	return first?.type === AST_NODE_TYPES.Identifier && first.name === "this";
}

/**
 * Finds the parameters that match the positions of a signature. A `this`
 * parameter has no position there.
 *
 * @param node - The function to inspect.
 * @returns The parameters after a `this` parameter.
 */
function getPositionalParameters(node: {
	readonly params: ReadonlyArray<ContextualParameter>;
}): ReadonlyArray<ContextualParameter> {
	return hasThisParameter(node) ? node.params.slice(1) : node.params;
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
	const options = context.options[0] ?? {};
	const checkReturnTypes = options.checkReturnTypes ?? DEFAULT_OPTIONS.checkReturnTypes;
	const allowExpressions = options.allowExpressions ?? DEFAULT_OPTIONS.allowExpressions;
	let exportedNames: Set<string> | undefined;
	let isScriptFile: boolean | undefined;
	const anchors = new Map<FunctionExpressionNode, TSESTree.Node | undefined>();
	const candidates: Array<Candidate & Removal> = [];

	/**
	 * Save a potential removal for verification after visiting the file.
	 * @param removal - The removal to verify.
	 */
	function collect(removal: Removal): void {
		const { annotation, requiresProof } = removal;
		const owner = services.esTreeNodeToTSNodeMap.get(annotation.typeAnnotation).parent;
		if (
			isVariableDeclaration(owner) ||
			isParameter(owner) ||
			isFunctionDeclaration(owner) ||
			isFunctionExpression(owner) ||
			isArrowFunction(owner) ||
			isMethodDeclaration(owner)
		) {
			candidates.push({ ...removal, owner, range: annotation.range });
			return;
		}

		// The verifier cannot model this owner. Report without a fix rather
		// than dropping the report, unless only a proof can justify it.
		if (requiresProof !== true) {
			report(removal, false);
		}
	}

	/**
	 * Reports a redundant annotation.
	 * @param removal - The removal to report.
	 * @param fixable - Whether the removal was verified and may be autofixed.
	 */
	function report({ annotation, messageId, type }: Removal, fixable: boolean): void {
		context.report({
			data: { typeName: display(type) },
			fix: fixable ? (fixer) => removeAnnotation(fixer, annotation) : null,
			messageId,
			node: annotation,
		});
	}

	/**
	 * Removes an annotation but keeps the comments inside it.
	 *
	 * @param fixer - The fixer of the report.
	 * @param annotation - The annotation to remove.
	 * @returns The fix.
	 */
	function removeAnnotation(
		fixer: TSESLint.RuleFixer,
		annotation: TSESTree.TSTypeAnnotation,
	): Array<TSESLint.RuleFix> | TSESLint.RuleFix {
		const { sourceCode } = context;
		const comments = sourceCode.getCommentsInside(annotation);
		if (comments.length === 0) {
			return fixer.remove(annotation);
		}

		// A line comment ends at the line break, so the code after it must
		// start on a new line. Use the line break of the source.
		const kept = comments
			.map((comment) => {
				const text = sourceCode.getText(comment);
				if (comment.type !== AST_TOKEN_TYPES.Line) {
					return text;
				}

				const lineBreak = /^\r?\n|^\r/.exec(sourceCode.text.slice(comment.range[1]));
				return `${text}${lineBreak?.[0] ?? "\n"}`;
			})
			.join(" ");

		// A line break between `)` and `=>` is a syntax error, so comments
		// that span a line break move after the arrow.
		const arrow = annotation.parent;
		if (
			arrow.type === AST_NODE_TYPES.ArrowFunctionExpression &&
			arrow.returnType === annotation &&
			comments.some((comment) => {
				return (
					comment.loc.start.line !== comment.loc.end.line ||
					comment.type === AST_TOKEN_TYPES.Line
				);
			})
		) {
			const arrowToken = sourceCode.getTokenAfter(annotation);
			if (arrowToken !== null) {
				return [fixer.remove(annotation), fixer.insertTextAfter(arrowToken, ` ${kept}`)];
			}
		}

		return fixer.replaceText(annotation, ` ${kept}`);
	}

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

		if (
			checker.getReturnTypeOfSignature(signature) ===
			checker.getReturnTypeOfSignature(declared)
		) {
			return false;
		}

		// A type parameter that some parameter mentions is inferred from the
		// arguments first, and the context only fills in what they leave open.
		// This is a cost filter, not a proof: the verifier decides.
		// An object or array literal can leave out what would infer a type
		// parameter, as `Array.from({ length })` does, so its parameter does
		// not count. Nor does a parameter that receives no argument.
		const parameterTypes = declared.parameters
			.map((parameter, index) => {
				return receivesInferringArgument(node, declared, index)
					? checker.getTypeOfSymbol(parameter)
					: undefined;
			})
			.filter((type) => type !== undefined);
		return (declared.getTypeParameters() ?? []).some((typeParameter) => {
			return !parameterTypes.some((type) => mentionsType(type, typeParameter));
		});
	}

	/**
	 * Reports whether a parameter receives an argument that can infer a type
	 * parameter: one that is not an object or array literal.
	 *
	 * A tagged template passes its holes, so every parameter counts there.
	 *
	 * @param call - The call to inspect.
	 * @param signature - The callee's declared signature.
	 * @param index - The parameter position.
	 * @returns True when some argument at that position can infer.
	 */
	function receivesInferringArgument(
		call: TSESTree.CallExpression | TSESTree.NewExpression | TSESTree.TaggedTemplateExpression,
		signature: Signature,
		index: number,
	): boolean {
		if (call.type === AST_NODE_TYPES.TaggedTemplateExpression) {
			return true;
		}

		const received = isRestParameter(signature, index)
			? call.arguments.slice(index)
			: call.arguments.slice(index, index + 1);
		return received.some((argument) => {
			return (
				argument.type !== AST_NODE_TYPES.ObjectExpression &&
				argument.type !== AST_NODE_TYPES.ArrayExpression
			);
		});
	}

	/**
	 * Reports whether a type mentions another directly, in a union or
	 * intersection member, a type argument, or a call signature.
	 *
	 * Aliases, mapped types, and conditional types are not opened, so a
	 * mention behind them is not seen.
	 *
	 * @param type - The type to search.
	 * @param target - The type to find.
	 * @param depth - How many more levels to open.
	 * @returns True when the target is found.
	 */
	function mentionsType(type: Type, target: Type, depth = 4): boolean {
		if (type === target) {
			return true;
		}

		if (depth === 0) {
			return false;
		}

		function next(member: Type): boolean {
			return mentionsType(member, target, depth - 1);
		}

		if (type.isUnionOrIntersection()) {
			return type.types.some(next);
		}

		const objectFlags = (type as { objectFlags?: number }).objectFlags ?? 0;
		if ((type.flags & TypeFlags.Object) === 0 || type.aliasSymbol !== undefined) {
			return false;
		}

		if ((objectFlags & ObjectFlags.Reference) !== 0) {
			return checker.getTypeArguments(type as TypeReference).some(next);
		}

		if ((objectFlags & ObjectFlags.Anonymous) === 0) {
			return false;
		}

		return checker.getSignaturesOfType(type, SignatureKind.Call).some((callSignature) => {
			return (
				callSignature.parameters.some((parameter) =>
					next(checker.getTypeOfSymbol(parameter)),
				) || next(checker.getReturnTypeOfSignature(callSignature))
			);
		});
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
			isContextualFunction(call.callee) &&
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
	 * Finds the one call signature of a parameter's type, without its nullish
	 * members.
	 *
	 * @param parameter - The parameter symbol.
	 * @returns The signature, or undefined when there is not exactly one.
	 */
	function getCallbackSignature(parameter: ts.Symbol | undefined): Signature | undefined {
		if (parameter === undefined) {
			return undefined;
		}

		const type = checker.getNonNullableType(checker.getTypeOfSymbol(parameter));
		if (type.isUnion()) {
			return undefined;
		}

		const signatures = checker.getSignaturesOfType(type, SignatureKind.Call);
		return signatures.length === 1 ? signatures.at(0) : undefined;
	}

	/**
	 * Reports whether two signatures give `this` the same type.
	 *
	 * @param before - The signature before inference.
	 * @param after - The signature after inference.
	 * @returns True when both lack a `this` or both type it the same.
	 */
	function hasSameThisType(before: Signature, after: Signature): boolean {
		const thisBefore = before.thisParameter;
		const thisAfter = after.thisParameter;
		if (thisBefore === undefined || thisAfter === undefined) {
			return thisBefore === thisAfter;
		}

		return checker.getTypeOfSymbol(thisBefore) === checker.getTypeOfSymbol(thisAfter);
	}

	/**
	 * Reports whether a generic call types a callback argument's parameters
	 * without inference.
	 *
	 * This is a cost filter, not a proof: the verifier decides. With one
	 * signature, a callback parameter whose type is the same type object
	 * before and after the call's type arguments are inferred names none of
	 * them, as `reason` in `promise.catch((reason: unknown) => reason)` does.
	 *
	 * @param call - The call that receives the callback.
	 * @param callback - The callback, a direct argument of the call.
	 * @returns True when every callback parameter's type is settled.
	 */
	function hasSettledCallbackParameters(
		call: CallLike,
		callback: FunctionExpressionNode,
	): boolean {
		if (
			call.type !== AST_NODE_TYPES.CallExpression &&
			call.type !== AST_NODE_TYPES.NewExpression
		) {
			return false;
		}

		const index = call.arguments.indexOf(callback);
		const signatures = getCalleeSignatures(call);
		const declared = signatures.length === 1 ? signatures.at(0) : undefined;
		if (declared === undefined || index === -1 || isRestParameter(declared, index)) {
			return false;
		}

		const resolved = checker.getResolvedSignature(services.esTreeNodeToTSNodeMap.get(call));
		const before = getCallbackSignature(declared.parameters[index]);
		const after = getCallbackSignature(resolved?.parameters[index]);
		if (before === undefined || before.parameters.length !== after?.parameters.length) {
			return false;
		}

		// A `this` typed by a type parameter, as in an array method with a
		// `thisArg`, is inferred too. An arrow cannot bind `this`, so it ignores
		// that type.
		if (
			callback.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
			!hasSameThisType(before, after)
		) {
			return false;
		}

		return before.parameters.every((parameter, position) => {
			const target = after.parameters[position];
			return (
				target !== undefined &&
				checker.getTypeOfSymbol(parameter) === checker.getTypeOfSymbol(target)
			);
		});
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
			if (
				call !== undefined &&
				(hasFixedSignature(call) ||
					(current === node && hasSettledCallbackParameters(call, node)))
			) {
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
				isContextualFunction(child) &&
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
	 * Reports whether a function takes something from its contextual type:
	 * the type of an untyped parameter, an untyped `this`, or the type of a
	 * returned value, such as a literal.
	 *
	 * @param node - The function to inspect.
	 * @returns True when the function depends on its context.
	 */
	function takesContext(node: ContextualFunction): boolean {
		return (
			node.params.some(isUntypedParameter) ||
			usesContextualThis(node) ||
			returnsContextTypedValue(node)
		);
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
	 * apart from `contextDependence` because that also runs on call arguments,
	 * where a literal or a callback takes its context from the callee instead.
	 *
	 * @param node - The expression to inspect.
	 * @returns `"unproven"` when only the verifier can tell whether it does.
	 */
	function annotationContextDependence(node: TSESTree.Node): ContextDependence {
		if (isContextualFunction(node)) {
			return takesContext(node) ? "dependent" : "independent";
		}

		// A template expression is a template type only because the context
		// asks for one.
		if (node.type === AST_NODE_TYPES.TemplateLiteral) {
			return hasTemplateType(services.getTypeAtLocation(node)) ? "dependent" : "independent";
		}

		if (
			node.type === AST_NODE_TYPES.ObjectExpression ||
			node.type === AST_NODE_TYPES.ArrayExpression
		) {
			return "dependent";
		}

		const operands = contextForwardedOperands(node);
		if (operands !== undefined) {
			return strongestDependence(operands, annotationContextDependence);
		}

		return contextDependence(node);
	}

	/**
	 * Reports whether the annotation's contextual type may reach an expression
	 * and shape its type. A dependence that only the verifier can rule out
	 * counts.
	 *
	 * @param node - The expression to inspect.
	 * @returns True unless the expression is independent of the annotation.
	 */
	function receivesAnnotationContext(node: TSESTree.Node): boolean {
		return annotationContextDependence(node) !== "independent";
	}

	/**
	 * Reports whether a callback argument gets the same context from its call
	 * with or without the variable's annotation.
	 *
	 * The context is fixed when the call has explicit type arguments, or no
	 * callee signature is generic: then overload choice and the callback's
	 * parameter type do not use the contextual type. With one generic
	 * signature, the context is fixed when each type the callback takes from
	 * it is the same type object before and after inference. Instantiation
	 * gives back the same object for a type that names no inferred type
	 * parameter, so a false answer only means "not proven".
	 *
	 * @param call - The call that receives the callback.
	 * @param index - The callback's argument position.
	 * @param callback - The function passed at that position.
	 * @returns True when the annotation cannot change the callback's context.
	 */
	function isCallbackContextFixed(
		call: ArgumentCall,
		index: number,
		callback: ContextualFunction,
	): boolean {
		if (call.typeArguments !== undefined) {
			return true;
		}

		const signatures = getCalleeSignatures(call);
		if (!signatures.some(isGeneric)) {
			return true;
		}

		const declared = signatures.length === 1 ? signatures.at(0) : undefined;
		const spread = getPassedValues(call)
			.slice(0, index + 1)
			.some((value) => value?.type === AST_NODE_TYPES.SpreadElement);
		if (
			declared === undefined ||
			spread ||
			index >= declared.parameters.length ||
			isRestParameter(declared, index)
		) {
			return false;
		}

		const location = services.esTreeNodeToTSNodeMap.get(call);
		const resolved = checker.getResolvedSignature(location);
		const parameter = declared.parameters[index];
		const target = resolved?.parameters[index];
		if (parameter === undefined || target === undefined) {
			return false;
		}

		const parameterType = checker.getNonNullableType(
			checker.getTypeOfSymbolAtLocation(parameter, location),
		);
		const targetType = checker.getNonNullableType(
			checker.getTypeOfSymbolAtLocation(target, location),
		);
		if (parameterType === targetType) {
			return true;
		}

		const before = getCallbackSignature(parameter);
		const after = getCallbackSignature(target);
		if (before === undefined || after === undefined) {
			return false;
		}

		const parameters = getPositionalParameters(callback);
		// A rest parameter is last, and it types every position from its own.
		const last = before.parameters.length - 1;
		const restStart = isRestParameter(before, last) ? last : Number.POSITIVE_INFINITY;
		const parametersFixed = parameters.every((node, position) => {
			if (!isUntypedParameter(node)) {
				return true;
			}

			if (node.type === AST_NODE_TYPES.RestElement || position >= restStart) {
				return false;
			}

			const from = before.parameters[position];
			const to = after.parameters[position];
			if (from === undefined || to === undefined) {
				return from === to;
			}

			return (
				checker.getTypeOfSymbolAtLocation(from, location) ===
				checker.getTypeOfSymbolAtLocation(to, location)
			);
		});

		return (
			parametersFixed &&
			(!usesContextualThis(callback) || hasSameThisType(before, after)) &&
			(!returnsContextTypedValue(callback) ||
				checker.getReturnTypeOfSignature(before) ===
					checker.getReturnTypeOfSignature(after))
		);
	}

	/**
	 * Finds the dependence of a call argument, or of an operand that the
	 * argument hands its context to. A callback there gets its context from
	 * the parameter at the argument's position, so the verifier can compare
	 * that context before and after inference.
	 *
	 * @param call - The call that receives the argument.
	 * @param index - The argument's position.
	 * @param node - The argument, or an operand that it forwards to.
	 * @returns The dependence of the expression.
	 */
	function argumentDependence(
		call: ArgumentCall,
		index: number,
		node: TSESTree.Node,
	): ContextDependence {
		if (isContextualFunction(node)) {
			return !takesContext(node) || isCallbackContextFixed(call, index, node)
				? "independent"
				: "unproven";
		}

		const operands = contextForwardedOperands(node);
		if (operands === undefined) {
			return contextDependence(node);
		}

		return strongestDependence(operands, (operand) => argumentDependence(call, index, operand));
	}

	/**
	 * Reports whether removing the annotation could change what the initializer
	 * means, because some part of it is typed by its context rather than by
	 * itself.
	 *
	 * The walk follows only the positions the annotation's contextual type
	 * actually reaches: the initializer, the operands that
	 * `contextForwardedOperands` finds, and call arguments.
	 *
	 * @param node - The expression to inspect.
	 * @returns `"unproven"` when only a callback that takes context from a
	 *   call, whose context the call may take from the annotation, makes the
	 *   expression depend on its context.
	 */
	function contextDependence(node: TSESTree.Node): ContextDependence {
		// A function here is not a call argument, so its context cannot be
		// compared before and after inference.
		if (isContextualFunction(node)) {
			return takesContext(node) ? "dependent" : "independent";
		}

		// A tagged template calls its tag, so a generic tag infers the same way.
		if (
			node.type === AST_NODE_TYPES.CallExpression ||
			node.type === AST_NODE_TYPES.NewExpression ||
			node.type === AST_NODE_TYPES.TaggedTemplateExpression
		) {
			if (isInferenceSensitiveCall(node)) {
				return "dependent";
			}

			const call = node;
			function dependenceOf(
				value: TSESTree.Node | undefined,
				index: number,
			): ContextDependence {
				return value === undefined ? "independent" : argumentDependence(call, index, value);
			}

			return strongestDependence(getPassedValues(node), dependenceOf);
		}

		const operands = contextForwardedOperands(node);
		return operands === undefined
			? "independent"
			: strongestDependence(operands, contextDependence);
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

		let symbol = checker.getSymbolAtLocation(tsTypeNode.typeName);
		if (symbol !== undefined && (symbol.flags & SymbolFlags.Alias) !== 0) {
			symbol = checker.getAliasedSymbol(symbol);
		}

		if (symbol === undefined || (symbol.flags & SymbolFlags.TypeAlias) === 0) {
			return false;
		}

		return type.aliasSymbol !== symbol;
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
	 * Reports whether the file is a script rather than a module.
	 *
	 * The declarations at the top of a script are global, so the emitter
	 * prints all of them. TypeScript decides this, so `moduleDetection` is
	 * obeyed.
	 *
	 * @returns True when TypeScript treats the file as a script.
	 */
	function isScript(): boolean {
		isScriptFile ??= !ts.isExternalModule(
			services.esTreeNodeToTSNodeMap.get(context.sourceCode.ast),
		);
		return isScriptFile;
	}

	/**
	 * Reports whether a variable leaves the module.
	 *
	 * Only exported declarations are subject to `isolatedDeclarations`, so the
	 * question decides whether the annotation is load-bearing. A variable at
	 * the top of a script is global, so it counts as exported.
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
			(isScript() ||
				node.id.type !== AST_NODE_TYPES.Identifier ||
				getExportedNames().has(node.id.name))
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
	 * Reports whether the declaration emitter reads a declaration that the
	 * module does not export.
	 *
	 * An exported declaration can still mention it: through `typeof`, a
	 * computed key of a type member, `export default`, `export =`, an export
	 * list, an enum member initializer, or a class `extends` clause. Any type
	 * that names a class counts too. The emitter prints none of the other
	 * reads, such as a top-level call, and nothing inside a function body or
	 * static block.
	 *
	 * @param node - The declaration to inspect.
	 * @returns True when the emitter may need the declaration's type.
	 */
	function isReadByEmitter(
		node:
			| TSESTree.ClassDeclaration
			| TSESTree.FunctionDeclaration
			| TSESTree.VariableDeclarator,
	): boolean {
		const [start, end] = node.range;
		return context.sourceCode.getDeclaredVariables(node).some((variable) => {
			return variable.references.some(({ identifier, isTypeReference }) => {
				// A read inside the declaration itself, such as a parameter's
				// `typeof`, does not make it emitted. The declared variables of
				// a function include its parameters.
				if (identifier.range[0] >= start && identifier.range[1] <= end) {
					return false;
				}

				// The emitter prints every type that names a class, outside a
				// function body or static block.
				if (node.type === AST_NODE_TYPES.ClassDeclaration && isTypeReference) {
					return !isHiddenFromEmitter(identifier);
				}

				return isEmitterRead(identifier);
			});
		});
	}

	/**
	 * Finds a function expression's contextual type, without its nullish
	 * members.
	 *
	 * The checker answers nothing for an object literal method, so its context
	 * is read from the property of the same name in the object's context.
	 *
	 * @param node - The function expression to inspect.
	 * @returns The contextual type, or undefined when there is none.
	 */
	function getFunctionContextualType(node: FunctionExpressionNode): Type | undefined {
		const { parent } = node;
		if (parent.type !== AST_NODE_TYPES.Property || !parent.method) {
			const contextualType = checker.getContextualType(
				services.esTreeNodeToTSNodeMap.get(node) as Expression,
			);
			return contextualType && checker.getNonNullableType(contextualType);
		}

		if (parent.computed || parent.parent.type !== AST_NODE_TYPES.ObjectExpression) {
			return undefined;
		}

		const { key } = parent;
		let name: string | undefined;
		if (key.type === AST_NODE_TYPES.Identifier) {
			({ name } = key);
		} else if (typeof key.value === "string") {
			name = key.value;
		}

		const object = services.esTreeNodeToTSNodeMap.get(parent.parent);
		const objectType = checker.getContextualType(object);
		if (name === undefined || objectType === undefined) {
			return undefined;
		}

		// A union of object types picks the property from each member, which
		// one property lookup does not show.
		const apparentType = checker.getNonNullableType(objectType);
		if (apparentType.isUnion()) {
			return undefined;
		}

		const property = apparentType.getProperty(name);
		return (
			property &&
			checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, object))
		);
	}

	/**
	 * Reports whether the options ask for this function's return type.
	 *
	 * @param node - The function to inspect.
	 * @returns True when its return type is checked.
	 */
	function checksReturnTypeOf(node: ReturnTypedFunction): boolean {
		if (checkReturnTypes) {
			return true;
		}

		return (
			allowExpressions &&
			node.type !== AST_NODE_TYPES.FunctionDeclaration &&
			!DECLARING_PARENTS.has(node.parent.type)
		);
	}

	/**
	 * Reports whether a function's return type is one the rule never removes.
	 *
	 * Overloads, generators, and accessors keep their return types: there the
	 * annotation is a contract the body cannot restate, or inference does not
	 * follow it.
	 *
	 * @param node - The function to inspect.
	 * @returns True when the return type is out of scope.
	 */
	function hasFixedReturnType(node: ReturnTypedFunction): boolean {
		if (node.generator) {
			return true;
		}

		const { parent } = node;
		if (
			(parent.type === AST_NODE_TYPES.MethodDefinition ||
				parent.type === AST_NODE_TYPES.Property) &&
			(parent.kind === "get" || parent.kind === "set")
		) {
			return true;
		}

		// An implementation with overloads, or a function merged with other
		// declarations, has more than one signature to keep in step.
		const tsNode = services.esTreeNodeToTSNodeMap.get(node);
		const name = "name" in tsNode ? tsNode.name : undefined;
		if (name !== undefined && ts.isIdentifier(name)) {
			const declarations = checker.getSymbolAtLocation(name)?.declarations ?? [];
			if (declarations.length > 1) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Reports whether the declaration emitter reads a function's return type.
	 * Under `isolatedDeclarations` it reads the written type only, so there
	 * the annotation is required.
	 *
	 * @param node - The function to inspect.
	 * @returns True when the emitter may need the return type.
	 */
	function feedsDeclarationEmit(node: ReturnTypedFunction): boolean {
		if (isHiddenFromEmitter(node)) {
			return false;
		}

		const { parent } = node;
		if (node.type === AST_NODE_TYPES.FunctionDeclaration) {
			return isEmittedDeclaration(node);
		}

		// A method is emitted with its class. A class expression is not
		// followed to where it goes.
		if (parent.type === AST_NODE_TYPES.MethodDefinition) {
			const owner = parent.parent.parent;
			return owner.type !== AST_NODE_TYPES.ClassDeclaration || isEmittedDeclaration(owner);
		}

		return (
			feedsEmittedType(node) ||
			(parent.type === AST_NODE_TYPES.VariableDeclarator &&
				parent.init === node &&
				isReadByEmitter(parent))
		);
	}

	/**
	 * Reports whether a function or class declaration leaves the module, or
	 * an emitted declaration reads it.
	 *
	 * @param node - The declaration to inspect.
	 * @returns True when the emitter prints it.
	 */
	function isEmittedDeclaration(
		node: TSESTree.ClassDeclaration | TSESTree.FunctionDeclaration,
	): boolean {
		const { id, parent } = node;
		return (
			parent.type === AST_NODE_TYPES.ExportNamedDeclaration ||
			parent.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
			(parent.type === AST_NODE_TYPES.Program && isScript()) ||
			(id !== null && getExportedNames().has(id.name)) ||
			isReadByEmitter(node)
		);
	}

	/**
	 * Reports whether a function refers to itself. Without its return type
	 * such a function has no type to start from, and becomes implicitly `any`.
	 *
	 * @param node - The function to inspect.
	 * @returns True when the body refers to the function.
	 */
	function isSelfReferencing(node: ReturnTypedFunction): boolean {
		const { body, parent, range } = node;
		const [start, end] = range;
		const bindings = [
			...context.sourceCode.getDeclaredVariables(node),
			...(parent.type === AST_NODE_TYPES.VariableDeclarator && parent.init === node
				? context.sourceCode.getDeclaredVariables(parent)
				: []),
		];
		const readsBinding = bindings.some((variable) => {
			return (
				variable.defs.some(({ type }) => {
					return (
						type === TSESLint.Scope.DefinitionType.FunctionName ||
						type === TSESLint.Scope.DefinitionType.Variable
					);
				}) &&
				variable.references.some(({ identifier }) => {
					return identifier.range[0] >= start && identifier.range[1] <= end;
				})
			);
		});
		if (readsBinding) {
			return true;
		}

		// A method reaches itself through `this` or its object.
		if (
			(parent.type === AST_NODE_TYPES.MethodDefinition ||
				parent.type === AST_NODE_TYPES.Property ||
				parent.type === AST_NODE_TYPES.PropertyDefinition) &&
			!parent.computed &&
			parent.key.type === AST_NODE_TYPES.Identifier
		) {
			const { name } = parent.key;
			return someDescendant(
				body,
				() => {
					return false;
				},
				(child) => {
					return (
						child.type === AST_NODE_TYPES.MemberExpression &&
						!child.computed &&
						child.property.type === AST_NODE_TYPES.Identifier &&
						child.property.name === name
					);
				},
			);
		}

		return false;
	}

	/**
	 * Lists the values a function returns, without entering nested functions.
	 *
	 * @param node - The function to inspect.
	 * @returns The returned expressions, whether a bare `return` appears, and
	 *   whether the end of the body may be reached.
	 */
	function getReturnedValues(node: ReturnTypedFunction): {
		readonly bareReturn: boolean;
		readonly fallsThrough: boolean;
		readonly values: ReadonlyArray<TSESTree.Expression>;
	} {
		if (node.body.type !== AST_NODE_TYPES.BlockStatement) {
			return { bareReturn: false, fallsThrough: false, values: [node.body] };
		}

		const values: Array<TSESTree.Expression> = [];
		let bareReturn = false;
		someDescendant(node.body, isFunctionNode, (child) => {
			if (child.type === AST_NODE_TYPES.ReturnStatement) {
				if (child.argument === null) {
					bareReturn = true;
				} else {
					values.push(child.argument);
				}
			}

			return false;
		});

		// Whether the end is reachable is control flow the rule does not
		// model, so only a body that ends in `return` or `throw` counts as
		// closed.
		const last = node.body.body.at(-1);
		const fallsThrough =
			last === undefined ||
			(last.type !== AST_NODE_TYPES.ReturnStatement &&
				last.type !== AST_NODE_TYPES.ThrowStatement);
		return { bareReturn, fallsThrough, values };
	}

	/**
	 * Predicts whether the returned types, as inference would combine them,
	 * are the annotated type.
	 *
	 * Every returned member must be identical to an annotated member, and
	 * every annotated member must be returned. A returned subtype counts as a
	 * mismatch, although inference may reduce it away; this is a cost filter,
	 * and the verifier decides.
	 *
	 * @param returned - The returned types.
	 * @param annotated - The annotated type.
	 * @returns True when the two have the same members.
	 */
	function coversSameMembers(returned: ReadonlyArray<Type>, annotated: Type): boolean {
		const wanted = unionMembers(annotated);
		const covered = new Set<Type>();
		for (const type of returned) {
			for (const member of unionMembers(type)) {
				const match = wanted.find((candidate) => typesAreIdentical(candidate, member));
				if (match === undefined) {
					return false;
				}

				covered.add(match);
			}
		}

		return covered.size === wanted.length;
	}

	/**
	 * Unwraps `Promise<T>` to `T` when a type is a promise reference.
	 *
	 * @param type - The annotated return type of an `async` function.
	 * @returns The promised type, or undefined for any other type.
	 */
	function getPromisedType(type: Type): Type | undefined {
		const objectFlags = (type as { objectFlags?: number }).objectFlags ?? 0;
		if (
			type.getSymbol()?.getName() !== "Promise" ||
			(objectFlags & ObjectFlags.Reference) === 0
		) {
			return undefined;
		}

		const [promised, ...rest] = checker.getTypeArguments(type as TypeReference);
		return rest.length === 0 ? promised : undefined;
	}

	/**
	 * Predicts whether the body alone infers the expected return type.
	 *
	 * @param node - The function to inspect.
	 * @param expectedType - The annotated type, unwrapped from `Promise` for an
	 *   `async` function.
	 * @returns True when inference likely gives the same type.
	 */
	/**
	 * Reports whether a block body cannot reach its end: it ends in `throw`,
	 * or in a call that returns `never`.
	 *
	 * @param node - The function to inspect.
	 * @returns True when the last statement never completes.
	 */
	function endsInNever({ body }: ReturnTypedFunction): boolean {
		if (body.type !== AST_NODE_TYPES.BlockStatement) {
			return false;
		}

		const last = body.body.at(-1);
		if (last?.type === AST_NODE_TYPES.ThrowStatement) {
			return true;
		}

		return (
			last?.type === AST_NODE_TYPES.ExpressionStatement &&
			(services.getTypeAtLocation(last.expression).flags & TypeFlags.Never) !== 0
		);
	}

	function predictsReturnType(node: ReturnTypedFunction, expectedType: Type): boolean {
		const { bareReturn, fallsThrough, values } = getReturnedValues(node);

		// A body that returns no value infers `void`, never `undefined`. A
		// function expression whose end cannot be reached infers `never`.
		if (values.length === 0) {
			return (
				(expectedType.flags & TypeFlags.Void) !== 0 &&
				(node.type === AST_NODE_TYPES.FunctionDeclaration || !endsInNever(node))
			);
		}

		// From TypeScript 5.5 a single `boolean` return that narrows a
		// parameter infers a type predicate.
		if (
			values.length === 1 &&
			node.params.length > 0 &&
			(expectedType.flags & TypeFlags.Boolean) !== 0
		) {
			return false;
		}

		if (fallsThrough || values.some((value) => receivesAnnotationContext(value))) {
			return false;
		}

		const returned = values.map((value) => {
			const type = services.getTypeAtLocation(value);
			return node.async ? (checker.getAwaitedType(type) ?? type) : type;
		});
		if (returned.some((type) => containsAny(type) || hasTemplateType(type))) {
			return false;
		}

		if (bareReturn) {
			returned.push(checker.getUndefinedType());
		}

		// Inference builds a new union, which does not carry the alias name
		// unless a returned value already has the aliased type.
		if (
			expectedType.aliasSymbol !== undefined &&
			!returned.some((type) => typesAreIdentical(type, expectedType))
		) {
			return false;
		}

		const [only] = returned;
		if (returned.length > 1 || only === undefined || !isWideningUnit(only)) {
			return coversSameMembers(returned, expectedType);
		}

		// One literal widens to its base type, but only a literal written in
		// place, and only where no context asks for literals.
		const [value] = values;
		if (
			value === undefined ||
			!isFreshLiteral(value) ||
			(node.type !== AST_NODE_TYPES.FunctionDeclaration &&
				getFunctionContextualType(node) !== undefined)
		) {
			return false;
		}

		return coversSameMembers([checker.getBaseTypeOfLiteralType(only)], expectedType);
	}

	function checkReturnType(node: ReturnTypedFunction): void {
		const { async, returnType } = node;
		if (returnType === undefined || !checksReturnTypeOf(node)) {
			return;
		}

		// A type predicate or `asserts` is a claim the body cannot state.
		if (returnType.typeAnnotation.type === AST_NODE_TYPES.TSTypePredicate) {
			return;
		}

		if (hasFixedReturnType(node)) {
			return;
		}

		if (declarationsAreIsolated && feedsDeclarationEmit(node)) {
			return;
		}

		const annotationType = services.getTypeFromTypeNode(returnType.typeAnnotation);
		if (containsAny(annotationType) || (annotationType.flags & TypeFlags.Never) !== 0) {
			return;
		}

		if (namesAnErasedAlias(returnType.typeAnnotation, annotationType)) {
			return;
		}

		const expectedType = async ? getPromisedType(annotationType) : annotationType;
		if (expectedType === undefined || !predictsReturnType(node, expectedType)) {
			return;
		}

		// Last, as it reads every reference to the function.
		if (isSelfReferencing(node)) {
			return;
		}

		collect({ annotation: returnType, messageId: RETURN_MESSAGE_ID, type: annotationType });
	}

	function checkFunctionParameters(node: FunctionExpressionNode): void {
		if (!isContextualFunction(node) || node.params.every(isUntypedParameter)) {
			return;
		}

		if (resolveContextAnchor(node) === undefined) {
			return;
		}

		// The emitter reads these annotations, so they are not restatements.
		if (declarationsAreIsolated && feedsEmittedType(node)) {
			return;
		}

		const contextualType = getFunctionContextualType(node);
		// TypeScript takes a contextual signature from a union only when every
		// member offers the same one, which the union's own signatures do not
		// show, so a union is left alone. Nullish members offer no signature
		// and are skipped, so they are dropped first.
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
		const parameters = getPositionalParameters(node);

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
			if ((annotationType.flags & (TypeFlags.Any | TypeFlags.Never)) !== 0) {
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

			collect({ annotation, messageId: PARAMETER_MESSAGE_ID, type: annotationType });
		}
	}

	return {
		"ArrowFunctionExpression": function (node: TSESTree.ArrowFunctionExpression): void {
			checkFunctionParameters(node);
			checkReturnType(node);
		},
		"CatchClause": function ({ param }: TSESTree.CatchClause): void {
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
				fix: (fixer) => removeAnnotation(fixer, annotation),
				messageId: CATCH_MESSAGE_ID,
				node: annotation,
			});
		},
		"FunctionDeclaration": checkReturnType,
		"FunctionExpression": function (node: TSESTree.FunctionExpression): void {
			checkFunctionParameters(node);
			checkReturnType(node);
		},
		"Program:exit": function (node: TSESTree.Program): void {
			const source = services.esTreeNodeToTSNodeMap.get(node);
			const { accepted, acceptedAlone, unverified } = verifyAnnotations(
				services.program,
				source,
				candidates,
			);
			for (const candidate of accepted) {
				report(candidate, true);
			}

			// A user or an editor can apply this fix alone, but the combined
			// fix of `eslint --fix` is not verified.
			for (const candidate of acceptedAlone) {
				report(candidate, false);
			}

			// Unverified is not proven unsafe. Keep the report visible, but
			// never autofix it. A candidate that needs proof stays silent: a
			// later fix pass can verify it.
			for (const { candidate } of unverified) {
				if (candidate.requiresProof === true) {
					continue;
				}

				report(candidate, false);
			}
		},
		"VariableDeclarator": function (node: TSESTree.VariableDeclarator): void {
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

			// Other rules read this annotation as the function's signature:
			// `func-style` allows a function expression only on a typed
			// variable, and `explicit-function-return-type` counts it as the
			// return type. Removing it makes them report.
			if (
				node.init.type === AST_NODE_TYPES.ArrowFunctionExpression ||
				node.init.type === AST_NODE_TYPES.FunctionExpression
			) {
				return;
			}

			if (declarationsAreIsolated && (isExported(node) || isReadByEmitter(node))) {
				return;
			}

			// A callback whose context is not proven fixed does not skip the
			// variable. It makes only a verified removal reportable.
			const dependence = annotationContextDependence(node.init);
			if (dependence === "dependent") {
				return;
			}

			const annotationType = services.getTypeFromTypeNode(annotation.typeAnnotation);
			// `any` is the one annotation that can never be redundant: it is
			// mutually assignable with every type, so identity says nothing.
			if ((annotationType.flags & TypeFlags.Any) !== 0) {
				return;
			}

			// `never` is an exhaustiveness check. It always holds when written;
			// it exists to fail when a new case is added later.
			if ((annotationType.flags & TypeFlags.Never) !== 0) {
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

			collect({
				annotation,
				messageId: MESSAGE_ID,
				requiresProof: dependence === "unproven",
				type: annotationType,
			});
		},
	};
}

export const noRedundantTypeAnnotation: EslintRuleModule<Options, MessageIds> = createEslintRule<
	Options,
	MessageIds
>({
	name: RULE_NAME,
	create,
	defaultOptions: [DEFAULT_OPTIONS],
	meta: {
		defaultOptions: [DEFAULT_OPTIONS],
		docs: {
			description: "Disallow type annotations that restate the initializer's own type",
			recommended: false,
			requiresTypeChecking: true,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [
			{
				additionalProperties: false,
				properties: {
					allowExpressions: {
						description:
							"Check the return types of function expressions that `explicit-function-return-type` with `allowExpressions` lets omit.",
						type: "boolean",
					},
					checkReturnTypes: {
						description: "Check the return type of every function.",
						type: "boolean",
					},
				},
				type: "object",
			},
		],
		type: "suggestion",
	},
});
