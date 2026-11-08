import * as core from "@eslint-react/core";
import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type ts from "typescript";
import { forEachChild, SyntaxKind, TypeFlags } from "typescript";

import { resolveReactPackage } from "../../../utils/react-package";
import { resolveAliasedSymbol, symbolDeclaredIn } from "./symbol";
import type { Context } from "./types";

/**
 * Packages whose declarations count as React. Component types, component base
 * classes, wrappers and named render types must resolve to one of them, so a
 * project type or another library's function with the same name is not
 * mistaken for React's. The `react-x` `importSource` setting adds its package.
 */
const DEFAULT_REACT_MODULES: ReadonlyArray<string> = ["react", "@types/react", "@rbxts/react"];

/**
 * Component types whose first type argument is the props type:
 * `const Panel: React.FC<PanelProps> = ...`.
 */
const COMPONENT_TYPE_NAMES: ReadonlySet<string> = new Set([
	"ComponentClass",
	"ComponentType",
	"ExoticComponent",
	"FC",
	"ForwardRefExoticComponent",
	"FunctionComponent",
	"NamedExoticComponent",
	"VFC",
	"VoidFunctionComponent",
]);

/**
 * Base classes of class components; the first type argument is the props type.
 */
const COMPONENT_CLASS_NAMES: ReadonlySet<string> = new Set(["Component", "PureComponent"]);

/**
 * Component wrappers, mapped to the index of the props type in their explicit
 * type arguments: `memo<Props>(...)`, `forwardRef<Ref, Props>(...)`.
 */
const WRAPPER_PROPS_ARGUMENT_INDEX: ReadonlyMap<string, number> = new Map([
	["forwardRef", 1],
	["memo", 0],
]);

/**
 * Generic types that keep the members of their first type argument as they are
 * (only modifiers change, or members are added), so that argument stays the
 * props type. `Pick` and `Omit` are not here: they select members that another
 * shape owns, and that shape decides how they are spelled.
 */
const PASS_THROUGH_TYPE_NAMES: ReadonlySet<string> = new Set([
	"Partial",
	"PropsWithChildren",
	"PropsWithoutRef",
	"Readonly",
	"Required",
]);

/** React's named types a component may return. */
const RENDER_OUTPUT_NAMES: ReadonlySet<string> = new Set([
	"ReactElement",
	"ReactNode",
	"ReactPortal",
]);

const IGNORED_RENDER_FLAGS = TypeFlags.BooleanLiteral | TypeFlags.Null | TypeFlags.Undefined;

/**
 * Generic aliases and interfaces nest deeper than this only through recursion;
 * the walk stops there instead of following the cycle.
 */
const MAX_GENERIC_DEPTH = 32;

/**
 * Generic bodies are not deduplicated, so a recursive alias with several
 * self-references could branch out before the depth limit stops it. This caps
 * the steps one props type may take.
 */
const MAX_PROPS_TYPE_STEPS = 10_000;

/**
 * Props-type declarations (interfaces and type literals) per program and React
 * module list. The scan reads every source file, so it runs once per program
 * instead of once per name. Keys are programs, which a change replaces, so a
 * stale result is never read.
 */
const propsContainerCache = new WeakMap<ts.Program, Map<string, ReadonlySet<ts.Node>>>();

/**
 * A type node, together with the type arguments its enclosing generic
 * declarations were given. In `type View<P> = React.FC<P>` used as
 * `View<PanelProps>`, the `P` in the alias body is bound to `PanelProps`.
 */
interface BoundNode {
	bindings: Bindings;
	node: ts.Node;
}

/** Type parameter declarations, mapped to the type argument given for each. */
type Bindings = ReadonlyMap<ts.Node, BoundNode>;

const NO_BINDINGS: Bindings = new Map();

interface TypeReferenceParts {
	nameNode: ts.Node;
	typeArguments: ReadonlyArray<ts.TypeNode> | undefined;
}

/**
 * Checks whether a name is a member that a component's props type declares.
 *
 * A member qualifies when its interface or type literal is reached from the
 * props type of a component anywhere in the program: through aliases (generic
 * ones included), intersections, unions, `extends` clauses and the generics in
 * `PASS_THROUGH_TYPE_NAMES`. Shapes nested inside a member's type are not
 * props, and neither are members a props type takes from another shape through
 * `Pick` or `Omit`.
 *
 * @param node - The name being validated.
 * @param context - The rule context of the file being linted.
 * @returns True if the name is a member of a component's props type.
 */
export function isComponentPropertyMember(node: TSESTree.Node, context: Context): boolean {
	const container = getMemberContainer(node);
	if (container === undefined) {
		return false;
	}

	const services = getParserServices(context);
	const tsContainer = services.esTreeNodeToTSNodeMap.get(container);
	// the scan never records declaration files, so they need no scan
	if (tsContainer.getSourceFile().isDeclarationFile) {
		return false;
	}

	return getPropsContainers(services.program, getReactModules(context)).has(tsContainer);
}

/**
 * Finds the declaration that owns a member's name: the interface for an
 * interface member, or the type literal itself.
 *
 * @param node - The name being validated.
 * @returns The owning declaration, or undefined when the name is not a member
 *   of an interface or a type literal.
 */
function getMemberContainer(
	node: TSESTree.Node,
): TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeLiteral | undefined {
	const member = node.parent;
	if (
		member?.type !== AST_NODE_TYPES.TSPropertySignature &&
		member?.type !== AST_NODE_TYPES.TSMethodSignature
	) {
		return undefined;
	}

	if (member.key !== node) {
		return undefined;
	}

	const { parent } = member;
	if (parent.type === AST_NODE_TYPES.TSTypeLiteral) {
		return parent;
	}

	return parent.parent;
}

/**
 * Reads the React packages: the defaults, plus the package the `react-x`
 * `importSource` setting names and its `@types` package. Shared settings are not
 * validated, so anything that is not a string is ignored.
 *
 * @param context - The rule context of the file being linted.
 * @returns The module specifiers whose declarations count as React.
 */
function getReactModules(context: Context): ReadonlyArray<string> {
	const settings: unknown = context.settings["react-x"];
	const importSource =
		typeof settings === "object" && settings !== null
			? (settings as { importSource?: unknown }).importSource
			: undefined;
	if (typeof importSource !== "string" || importSource.length === 0) {
		return DEFAULT_REACT_MODULES;
	}

	const reactPackage = resolveReactPackage(importSource);
	return [...new Set([...DEFAULT_REACT_MODULES, `@types/${reactPackage}`, reactPackage])];
}

function getRightmostName(expression: ts.Node): ts.Identifier | undefined {
	if (expression.kind === SyntaxKind.Identifier) {
		return expression as ts.Identifier;
	}

	if (expression.kind === SyntaxKind.PropertyAccessExpression) {
		const { name } = expression as ts.PropertyAccessExpression;
		return name.kind === SyntaxKind.Identifier ? name : undefined;
	}

	return undefined;
}

/**
 * Reads the name and type arguments of a type reference (`Foo<Bar>`,
 * `React.FC<P>`) or of an `extends` clause entry, which parses differently but
 * holds the same parts.
 *
 * @param node - The node to read.
 * @returns The parts, or undefined when the node is neither form.
 */
function asTypeReference(node: ts.Node): TypeReferenceParts | undefined {
	if (node.kind === SyntaxKind.TypeReference) {
		const reference = node as ts.TypeReferenceNode;
		const nameNode =
			reference.typeName.kind === SyntaxKind.QualifiedName
				? reference.typeName.right
				: reference.typeName;

		return { nameNode, typeArguments: reference.typeArguments };
	}

	if (node.kind === SyntaxKind.ExpressionWithTypeArguments) {
		const heritage = node as ts.ExpressionWithTypeArguments;
		const nameNode = getRightmostName(heritage.expression);

		return nameNode === undefined
			? undefined
			: { nameNode, typeArguments: heritage.typeArguments };
	}

	return undefined;
}

/**
 * Resolves a type name to the declarations the project owns. Declarations in
 * `.d.ts` files and libraries are left out: no one lints their names, and
 * library generics such as `Pick` must not lead into their arguments.
 *
 * @param symbol - The resolved symbol of the type name.
 * @returns The project's declarations of the named type.
 */
function getProjectDeclarations(symbol: ts.Symbol | undefined): Array<ts.Node> {
	return (
		symbol?.declarations?.filter((declaration) => {
			return !declaration.getSourceFile().isDeclarationFile;
		}) ?? []
	);
}

/**
 * Binds a generic declaration's type parameters to the type arguments of a
 * reference to it. A parameter without an argument falls back to its default,
 * which is read with no bindings.
 *
 * @param declaration - The referenced type alias or interface.
 * @param typeArguments - The reference's type arguments.
 * @param outer - The bindings the type arguments are read with.
 * @returns The bindings for the declaration's body.
 */
function bindTypeParameters(
	declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
	typeArguments: ReadonlyArray<ts.TypeNode> | undefined,
	outer: Bindings,
): Bindings {
	const parameters = declaration.typeParameters;
	if (parameters === undefined || parameters.length === 0) {
		return NO_BINDINGS;
	}

	const bindings = new Map<ts.Node, BoundNode>();
	for (const [index, parameter] of parameters.entries()) {
		const argument = typeArguments?.[index];
		if (argument !== undefined) {
			bindings.set(parameter, { bindings: outer, node: argument });
		} else if (parameter.default !== undefined) {
			bindings.set(parameter, { bindings: NO_BINDINGS, node: parameter.default });
		}
	}

	return bindings;
}

/**
 * Resolves a type reference to the nodes it stands for in the project: the
 * body of a type alias, an interface, or the type argument bound to a type
 * parameter.
 *
 * @param reference - The reference to resolve.
 * @param symbol - The resolved symbol of the reference's name.
 * @param bindings - The bindings the reference is read with.
 * @returns The nodes the reference stands for, with their bindings.
 */
function resolveReference(
	reference: TypeReferenceParts,
	symbol: ts.Symbol | undefined,
	bindings: Bindings,
): Array<BoundNode> {
	const resolved: Array<BoundNode> = [];
	for (const declaration of getProjectDeclarations(symbol)) {
		if (declaration.kind === SyntaxKind.TypeParameter) {
			const bound = bindings.get(declaration);
			if (bound !== undefined) {
				resolved.push(bound);
			}

			continue;
		}

		if (
			declaration.kind === SyntaxKind.InterfaceDeclaration ||
			declaration.kind === SyntaxKind.TypeAliasDeclaration
		) {
			const generic = declaration as ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
			resolved.push({
				bindings: bindTypeParameters(generic, reference.typeArguments, bindings),
				node: declaration,
			});
		}
	}

	return resolved;
}

/**
 * Takes one step through a props type. Type literals and interfaces are
 * recorded as props containers; the nodes they lead to are returned for the
 * caller to visit.
 *
 * @param current - A type node or declaration reached from a props type, with
 *   its bindings.
 * @param checker - The program's type checker.
 * @param containers - Receives each props container found.
 * @returns The nodes to visit next.
 */
function expandPropsType(
	{ bindings, node }: BoundNode,
	checker: ts.TypeChecker,
	containers: Set<ts.Node>,
): Array<BoundNode> {
	function withBindings(next: ts.Node): BoundNode {
		return { bindings, node: next };
	}

	// eslint-disable-next-line ts/switch-exhaustiveness-check -- We have a default case
	switch (node.kind) {
		case SyntaxKind.ExpressionWithTypeArguments:
		case SyntaxKind.TypeReference: {
			const reference = asTypeReference(node);
			if (reference === undefined) {
				return [];
			}

			const symbol = resolveAliasedSymbol(
				checker.getSymbolAtLocation(reference.nameNode),
				checker,
			);
			if (symbol !== undefined && PASS_THROUGH_TYPE_NAMES.has(symbol.name)) {
				return reference.typeArguments?.slice(0, 1).map(withBindings) ?? [];
			}

			return resolveReference(reference, symbol, bindings);
		}
		case SyntaxKind.InterfaceDeclaration: {
			containers.add(node);
			return (
				(node as ts.InterfaceDeclaration).heritageClauses?.flatMap((clause) => {
					return clause.types.map(withBindings);
				}) ?? []
			);
		}
		case SyntaxKind.IntersectionType:
		case SyntaxKind.UnionType: {
			return (node as ts.UnionOrIntersectionTypeNode).types.map(withBindings);
		}
		case SyntaxKind.ParenthesizedType: {
			return [withBindings((node as ts.ParenthesizedTypeNode).type)];
		}
		case SyntaxKind.TypeAliasDeclaration: {
			return [withBindings((node as ts.TypeAliasDeclaration).type)];
		}
		case SyntaxKind.TypeLiteral: {
			containers.add(node);
			return [];
		}
		default: {
			return [];
		}
	}
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
	return node.kind === SyntaxKind.ArrowFunction || node.kind === SyntaxKind.FunctionExpression;
}

/**
 * Checks whether a node's subtree can hold a component: a call, a class, a
 * function, or a variable. Type nodes, type declarations and imports cannot,
 * so the scan does not walk into them.
 *
 * @param node - The node to check.
 * @returns True if the scan must walk into the node.
 */
function mayContainComponents(node: ts.Node): boolean {
	if (node.kind >= SyntaxKind.FirstTypeNode && node.kind <= SyntaxKind.LastTypeNode) {
		return false;
	}

	return (
		node.kind !== SyntaxKind.InterfaceDeclaration &&
		node.kind !== SyntaxKind.TypeAliasDeclaration &&
		node.kind !== SyntaxKind.ImportDeclaration
	);
}

function unwrapExpression(node: ts.Expression | undefined): ts.Expression | undefined {
	let current = node;
	while (
		current !== undefined &&
		(current.kind === SyntaxKind.ParenthesizedExpression ||
			current.kind === SyntaxKind.AsExpression ||
			current.kind === SyntaxKind.SatisfiesExpression)
	) {
		current = (current as ts.AsExpression | ts.ParenthesizedExpression | ts.SatisfiesExpression)
			.expression;
	}

	return current;
}

/**
 * Checks whether a symbol is the `Element` interface of a `JSX` namespace.
 * `Element` alone also names the DOM element, which is not render output.
 *
 * @param symbol - The symbol of a return type part.
 * @returns True if the symbol is `JSX.Element`.
 */
function isJsxElementSymbol(symbol: ts.Symbol): boolean {
	return (
		symbol.name === "Element" &&
		symbol.declarations?.some((declaration) => {
			const namespace = declaration.parent.parent;
			return (
				namespace.kind === SyntaxKind.ModuleDeclaration &&
				(namespace as ts.ModuleDeclaration).name.text === "JSX"
			);
		}) === true
	);
}

function collectPropsContainers(
	program: ts.Program,
	reactModules: ReadonlyArray<string>,
): Set<ts.Node> {
	const checker = program.getTypeChecker();
	const containers = new Set<ts.Node>();
	// only nodes read without bindings are deduplicated: a generic body means
	// something different for each set of type arguments
	const visited = new Set<ts.Node>();

	function isReactSymbol(symbol: ts.Symbol): boolean {
		return reactModules.some((module) => symbolDeclaredIn(symbol, module));
	}

	function resolveReactSymbol(
		nameNode: ts.Node,
		names: ReadonlyMap<string, unknown> | ReadonlySet<string>,
	): ts.Symbol | undefined {
		const symbol = resolveAliasedSymbol(checker.getSymbolAtLocation(nameNode), checker);
		return symbol !== undefined && names.has(symbol.name) && isReactSymbol(symbol)
			? symbol
			: undefined;
	}

	/**
	 * Checks whether a function's return type is what a component renders: a
	 * React element or node, optionally with `null`, `undefined`, or a boolean.
	 *
	 * @param type - The function's return type.
	 * @returns True if the type is render output.
	 */
	function isRenderOutput(type: ts.Type): boolean {
		if (isReactRenderSymbol(type.aliasSymbol)) {
			return true;
		}

		const parts = type.isUnion() ? type.types : [type];
		let hasElement = false;
		for (const part of parts) {
			if ((part.flags & IGNORED_RENDER_FLAGS) !== 0) {
				continue;
			}

			const symbol = part.getSymbol();
			if (
				symbol === undefined ||
				(!isReactRenderSymbol(symbol) && !isJsxElementSymbol(symbol))
			) {
				return false;
			}

			hasElement = true;
		}

		return hasElement;
	}

	function isReactRenderSymbol(symbol: ts.Symbol | undefined): boolean {
		return (
			symbol !== undefined && RENDER_OUTPUT_NAMES.has(symbol.name) && isReactSymbol(symbol)
		);
	}

	/**
	 * Walks a props type and records the containers it reaches.
	 *
	 * @param typeNode - Where the walk starts, such as a parameter annotation.
	 * @param bindings - The bindings the node is read with.
	 * @param target - Receives the containers found.
	 * @param seen - Nodes already walked without bindings.
	 */
	function walkPropsType(
		typeNode: ts.Node | undefined,
		bindings: Bindings,
		target: Set<ts.Node>,
		seen: Set<ts.Node>,
	): void {
		if (typeNode === undefined) {
			return;
		}

		const stack: Array<BoundNode & { depth: number }> = [
			{ bindings, depth: 0, node: typeNode },
		];

		let steps = 0;
		while (stack.length > 0 && steps < MAX_PROPS_TYPE_STEPS) {
			const current = stack.pop();
			if (current === undefined || current.depth > MAX_GENERIC_DEPTH) {
				continue;
			}

			if (current.bindings.size === 0) {
				if (seen.has(current.node)) {
					continue;
				}

				seen.add(current.node);
			}

			steps += 1;
			for (const next of expandPropsType(current, checker, target)) {
				stack.push({ ...next, depth: current.depth + 1 });
			}
		}
	}

	function addPropsType(typeNode: ts.Node | undefined, bindings: Bindings): void {
		walkPropsType(typeNode, bindings, containers, visited);
	}

	function addComponentTypeAnnotation(
		typeNode: ts.Node,
		bindings: Bindings,
		depth: number,
	): boolean {
		if (depth > MAX_GENERIC_DEPTH) {
			return false;
		}

		const reference = asTypeReference(typeNode);
		if (reference === undefined) {
			return false;
		}

		if (resolveReactSymbol(reference.nameNode, COMPONENT_TYPE_NAMES) !== undefined) {
			addPropsType(reference.typeArguments?.[0], bindings);
			return true;
		}

		// a project alias of a component type, generic or not: `type View<P> =
		// React.FC<P>`
		const symbol = resolveAliasedSymbol(
			checker.getSymbolAtLocation(reference.nameNode),
			checker,
		);
		return resolveReference(reference, symbol, bindings).some((resolved) => {
			const target =
				resolved.node.kind === SyntaxKind.TypeAliasDeclaration
					? (resolved.node as ts.TypeAliasDeclaration).type
					: resolved.node;

			return (
				resolved.node.kind !== SyntaxKind.InterfaceDeclaration &&
				addComponentTypeAnnotation(target, resolved.bindings, depth + 1)
			);
		});
	}

	function addFunctionComponent(func: ts.SignatureDeclaration): void {
		const [props] = func.parameters;
		if (props?.type === undefined) {
			return;
		}

		// the props type is cheap to walk, while the return type may need the
		// whole body checked: only check it when the walk finds new containers
		const found = new Set<ts.Node>();
		walkPropsType(props.type, NO_BINDINGS, found, new Set());
		if (![...found].some((container) => !containers.has(container))) {
			return;
		}

		const signature = checker.getSignatureFromDeclaration(func);
		if (
			signature === undefined ||
			!isRenderOutput(checker.getReturnTypeOfSignature(signature))
		) {
			return;
		}

		for (const container of found) {
			containers.add(container);
		}
	}

	function addWrapperCall(call: ts.CallExpression): void {
		const { expression: callee } = call;
		const nameNode = getRightmostName(callee);
		if (nameNode === undefined) {
			return;
		}

		// resolving a property name type-checks its receiver, so only a property
		// already named like a wrapper is resolved. A renamed import is always a
		// plain identifier, which resolves cheaply.
		if (
			callee.kind === SyntaxKind.PropertyAccessExpression &&
			!WRAPPER_PROPS_ARGUMENT_INDEX.has(nameNode.text)
		) {
			return;
		}

		const wrapper = resolveReactSymbol(nameNode, WRAPPER_PROPS_ARGUMENT_INDEX);
		const index =
			wrapper === undefined ? undefined : WRAPPER_PROPS_ARGUMENT_INDEX.get(wrapper.name);
		if (index === undefined) {
			return;
		}

		const { typeArguments } = call;
		addPropsType(typeArguments?.[index], NO_BINDINGS);

		// the wrapper marks its argument as a component, so the return type
		// needs no check here
		const [argument] = call.arguments;
		const inner = unwrapExpression(argument);
		if (inner !== undefined && isFunctionLike(inner)) {
			addPropsType(inner.parameters[0]?.type, NO_BINDINGS);
		}
	}

	function addClassComponent(node: ts.ClassLikeDeclaration): void {
		for (const clause of node.heritageClauses ?? []) {
			if (clause.token !== SyntaxKind.ExtendsKeyword) {
				continue;
			}

			for (const heritage of clause.types) {
				const name = getRightmostName(heritage.expression);
				if (name !== undefined && resolveReactSymbol(name, COMPONENT_CLASS_NAMES)) {
					addPropsType(heritage.typeArguments?.[0], NO_BINDINGS);
				}
			}
		}
	}

	function inspectVariable(declaration: ts.VariableDeclaration): void {
		if (
			declaration.name.kind !== SyntaxKind.Identifier ||
			!core.isFunctionComponentName(declaration.name.text)
		) {
			return;
		}

		if (
			declaration.type !== undefined &&
			addComponentTypeAnnotation(declaration.type, NO_BINDINGS, 0)
		) {
			return;
		}

		const initializer = unwrapExpression(declaration.initializer);
		if (initializer !== undefined && isFunctionLike(initializer)) {
			addFunctionComponent(initializer);
		}
	}

	function inspect(node: ts.Node): void {
		// eslint-disable-next-line ts/switch-exhaustiveness-check -- We have a default case
		switch (node.kind) {
			case SyntaxKind.CallExpression: {
				addWrapperCall(node as ts.CallExpression);
				break;
			}
			case SyntaxKind.ClassDeclaration:
			case SyntaxKind.ClassExpression: {
				addClassComponent(node as ts.ClassLikeDeclaration);
				break;
			}
			case SyntaxKind.FunctionDeclaration: {
				// React treats a lowercase JSX tag as a host element, so render
				// callbacks (`renderItem`) are not components
				const func = node as ts.FunctionDeclaration;
				if (func.name !== undefined && core.isFunctionComponentName(func.name.text)) {
					addFunctionComponent(func);
				}

				break;
			}
			case SyntaxKind.VariableDeclaration: {
				inspectVariable(node as ts.VariableDeclaration);
				break;
			}
			default: {
				break;
			}
		}
	}

	const stack: Array<ts.Node> = [];
	function pushChild(child: ts.Node): void {
		if (mayContainComponents(child)) {
			stack.push(child);
		}
	}

	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile)) {
			continue;
		}

		stack.push(sourceFile);
		while (stack.length > 0) {
			const node = stack.pop();
			if (node === undefined) {
				continue;
			}

			inspect(node);
			forEachChild(node, pushChild);
		}
	}

	return containers;
}

function getPropsContainers(
	program: ts.Program,
	reactModules: ReadonlyArray<string>,
): ReadonlySet<ts.Node> {
	let byModules = propsContainerCache.get(program);
	if (byModules === undefined) {
		byModules = new Map();
		propsContainerCache.set(program, byModules);
	}

	const key = reactModules.join("\n");
	let containers = byModules.get(key);
	if (containers === undefined) {
		containers = collectPropsContainers(program, reactModules);
		byModules.set(key, containers);
	}

	return containers;
}
