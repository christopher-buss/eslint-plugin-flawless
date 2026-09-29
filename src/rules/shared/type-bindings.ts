import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

type TypeParameterOwner = Extract<
	TSESTree.Node,
	{ typeParameters?: TSESTree.TSTypeParameterDeclaration }
>;

/**
 * Resolves a type name to the nearest declaration that binds it, walking
 * outwards from the reference so lexical shadowing is respected.
 *
 * @param name - The referenced type name.
 * @param from - The node the reference appears in.
 * @returns The binding declaration, or undefined when the name is unbound
 *   (a global or built-in type).
 */
export function lookupTypeDeclaration(
	name: string,
	from: TSESTree.Node,
): TSESTree.Node | undefined {
	let descendant = from;
	let current: TSESTree.Node | undefined = from;
	while (current !== undefined) {
		if (current !== from && boundTypeParameterNames(current, descendant).has(name)) {
			return current;
		}

		for (const statement of scopeStatements(current) ?? []) {
			const declaration = declaredStatement(statement);
			if (declaration !== undefined && declaredTypeNames(declaration).includes(name)) {
				return declaration;
			}
		}

		descendant = current;
		current = current.type === AST_NODE_TYPES.Program ? undefined : current.parent;
	}

	return undefined;
}

/**
 * Resolves a type name to its alias declaration. A nearer declaration that is
 * not an alias (an interface, class, enum, import, or type parameter) shadows
 * the alias and ends the search.
 *
 * @param name - The referenced type name.
 * @param from - The node the reference appears in.
 * @returns The nearest matching alias declaration, if any.
 */
export function lookupAlias(
	name: string,
	from: TSESTree.Node,
): TSESTree.TSTypeAliasDeclaration | undefined {
	const declaration = lookupTypeDeclaration(name, from);
	if (declaration?.type !== AST_NODE_TYPES.TSTypeAliasDeclaration) {
		return undefined;
	}

	// The alias may be the owner of a type parameter that binds the name, not
	// the name's declaration itself.
	return isBoundByOwnTypeParameter(declaration, name, from) ? undefined : declaration;
}

/**
 * The statements a node introduces as a type scope, if it is one. Type
 * declarations are block scoped and hoisted, so every statement of the
 * enclosing block is a candidate regardless of where the reference sits.
 *
 * @param node - The node to inspect.
 * @returns The scope's statements, or undefined when the node is not a scope.
 */
function scopeStatements(node: TSESTree.Node): ReadonlyArray<TSESTree.Node> | undefined {
	if (
		node.type === AST_NODE_TYPES.BlockStatement ||
		node.type === AST_NODE_TYPES.Program ||
		node.type === AST_NODE_TYPES.StaticBlock ||
		node.type === AST_NODE_TYPES.TSModuleBlock
	) {
		return node.body;
	}

	return node.type === AST_NODE_TYPES.SwitchCase ? node.consequent : undefined;
}

function declaredStatement(statement: TSESTree.Node): TSESTree.Node | undefined {
	return statement.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
		statement.type === AST_NODE_TYPES.ExportNamedDeclaration
		? (statement.declaration ?? undefined)
		: statement;
}

/**
 * The names a statement adds to the type namespace of its scope.
 *
 * @param declaration - The statement to inspect.
 * @returns The declared type names, empty when the statement declares no type.
 */
function declaredTypeNames(declaration: TSESTree.Node): ReadonlyArray<string> {
	if (declaration.type === AST_NODE_TYPES.ImportDeclaration) {
		return declaration.specifiers.map((specifier) => specifier.local.name);
	}

	if (
		declaration.type === AST_NODE_TYPES.ClassDeclaration ||
		declaration.type === AST_NODE_TYPES.TSEnumDeclaration ||
		declaration.type === AST_NODE_TYPES.TSInterfaceDeclaration ||
		declaration.type === AST_NODE_TYPES.TSTypeAliasDeclaration
	) {
		return declaration.id === null ? [] : [declaration.id.name];
	}

	return [];
}

function isBoundByOwnTypeParameter(
	alias: TSESTree.TSTypeAliasDeclaration,
	name: string,
	from: TSESTree.Node,
): boolean {
	if (alias.typeParameters?.params.some((parameter) => parameter.name.name === name) !== true) {
		return false;
	}

	let current: TSESTree.Node | undefined = from;
	while (current !== undefined) {
		if (current === alias) {
			return true;
		}

		current = current.parent;
	}

	return false;
}

function isChildNode(value: unknown, parent: TSESTree.Node): value is TSESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		"parent" in value &&
		value.parent === parent
	);
}

function collectInferNames(node: TSESTree.Node, names: Set<string>): void {
	if (node.type === AST_NODE_TYPES.TSInferType) {
		names.add(node.typeParameter.name.name);
	}

	for (const value of Object.values(node)) {
		const children: ReadonlyArray<unknown> = Array.isArray(value) ? value : [value];
		for (const child of children) {
			if (isChildNode(child, node)) {
				collectInferNames(child, names);
			}
		}
	}
}

const TYPE_PARAMETER_OWNERS: ReadonlySet<AST_NODE_TYPES> = new Set([
	AST_NODE_TYPES.ArrowFunctionExpression,
	AST_NODE_TYPES.ClassDeclaration,
	AST_NODE_TYPES.ClassExpression,
	AST_NODE_TYPES.FunctionDeclaration,
	AST_NODE_TYPES.FunctionExpression,
	AST_NODE_TYPES.TSCallSignatureDeclaration,
	AST_NODE_TYPES.TSConstructorType,
	AST_NODE_TYPES.TSConstructSignatureDeclaration,
	AST_NODE_TYPES.TSDeclareFunction,
	AST_NODE_TYPES.TSEmptyBodyFunctionExpression,
	AST_NODE_TYPES.TSFunctionType,
	AST_NODE_TYPES.TSInterfaceDeclaration,
	AST_NODE_TYPES.TSMethodSignature,
	AST_NODE_TYPES.TSTypeAliasDeclaration,
]);

function isTypeParameterOwner(node: TSESTree.Node): node is TypeParameterOwner {
	return TYPE_PARAMETER_OWNERS.has(node.type);
}

/**
 * The type parameters a node binds for one of its descendants: generic
 * parameters, a mapped type's key inside its body, and `infer` names inside a
 * conditional type's true branch.
 *
 * @param node - The candidate binder.
 * @param descendant - The child of `node` the reference sits under.
 * @returns The names bound for that descendant.
 */
function boundTypeParameterNames(
	node: TSESTree.Node,
	descendant: TSESTree.Node,
): ReadonlySet<string> {
	const names = new Set<string>();
	for (const parameter of (isTypeParameterOwner(node)
		? node.typeParameters?.params
		: undefined) ?? []) {
		names.add(parameter.name.name);
	}

	if (
		node.type === AST_NODE_TYPES.TSMappedType &&
		(descendant === node.nameType || descendant === node.typeAnnotation)
	) {
		names.add(node.key.name);
	}

	if (node.type === AST_NODE_TYPES.TSConditionalType && descendant === node.trueType) {
		collectInferNames(node.extendsType, names);
	}

	return names;
}
