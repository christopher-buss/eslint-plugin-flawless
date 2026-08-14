import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

const BUILT_INS = new Set([
	"NonNullable",
	"Omit",
	"Partial",
	"Pick",
	"Readonly",
	"Record",
	"Required",
]);
const TRANSPARENT_WRAPPERS = new Set(["NonNullable", "Partial", "Readonly", "Required"]);

export interface UnsafeDictionary {
	readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
}

/**
 * How an explicit target type discards the evidence a known value carries.
 *
 * - `unknown` / `object`: the value's shape is thrown away outright.
 * - `open dictionary`: an index signature, mapped type, or `Record`, which
 *   states that any key may be present and none is guaranteed.
 * - `anonymous object`: an inline type literal with named properties, which
 *   restates a shape the initializer already establishes.
 * - `generic container`: a generic alias that resolves to a dictionary once its
 *   arguments are applied.
 */
export type WideningTargetKind =
	| "anonymous object"
	| "generic container"
	| "object"
	| "open dictionary"
	| "unknown";

export interface WideningTarget {
	readonly kind: WideningTargetKind;
}

export interface TypeEnvironment {
	readonly aliases: ReadonlyMap<string, TSESTree.TSTypeAliasDeclaration>;
	readonly interfaces: ReadonlyMap<string, ReadonlyArray<TSESTree.TSInterfaceDeclaration>>;
	readonly shadowedBuiltIns: ReadonlySet<string>;
}

type TypeAliasEnvironment = ReadonlyMap<string, TSESTree.TypeNode>;

interface ResolvedType {
	readonly substitutions: TypeAliasEnvironment;
	readonly type: TSESTree.TypeNode;
}

export function createTypeEnvironment(program: TSESTree.Program): TypeEnvironment {
	const aliases = new Map<string, TSESTree.TSTypeAliasDeclaration>();
	const interfaces = new Map<string, Array<TSESTree.TSInterfaceDeclaration>>();
	const shadowedBuiltIns = new Set<string>();

	for (const statement of program.body) {
		const declaration = declaredStatement(statement);
		if (declaration?.type === AST_NODE_TYPES.ImportDeclaration) {
			for (const specifier of declaration.specifiers) {
				if (BUILT_INS.has(specifier.local.name)) {
					shadowedBuiltIns.add(specifier.local.name);
				}
			}

			continue;
		}

		if (declaration?.type === AST_NODE_TYPES.TSTypeAliasDeclaration) {
			if (aliases.has(declaration.id.name)) {
				shadowedBuiltIns.add(declaration.id.name);
			} else {
				aliases.set(declaration.id.name, declaration);
			}

			if (BUILT_INS.has(declaration.id.name)) {
				shadowedBuiltIns.add(declaration.id.name);
			}

			continue;
		}

		if (declaration?.type === AST_NODE_TYPES.TSInterfaceDeclaration) {
			const declarations = interfaces.get(declaration.id.name) ?? [];
			declarations.push(declaration);
			interfaces.set(declaration.id.name, declarations);
			if (BUILT_INS.has(declaration.id.name)) {
				shadowedBuiltIns.add(declaration.id.name);
			}

			continue;
		}

		if (
			(declaration?.type === AST_NODE_TYPES.TSEnumDeclaration ||
				declaration?.type === AST_NODE_TYPES.ClassDeclaration ||
				declaration?.type === AST_NODE_TYPES.FunctionDeclaration) &&
			declaration.id !== null &&
			BUILT_INS.has(declaration.id.name)
		) {
			shadowedBuiltIns.add(declaration.id.name);
		}
	}

	return { aliases, interfaces, shadowedBuiltIns };
}

export function typeReferenceName(type: TSESTree.TSTypeReference): null | string {
	return type.typeName.type === AST_NODE_TYPES.Identifier ? type.typeName.name : null;
}

export function classifyUnsafeDictionaryValue(
	valueType: TSESTree.TypeNode,
	environment: TypeEnvironment,
): null | UnsafeDictionary {
	const unsafeValue = unsafeDirectValue(valueType, environment, new Map(), new Set());
	return unsafeValue === null ? null : { unsafeValue };
}

export function classifyUnsafeDictionary(
	type: TSESTree.TypeNode,
	environment: TypeEnvironment,
): null | UnsafeDictionary {
	for (const valueType of dictionaryValueTypes(type, environment, new Map(), new Set())) {
		const unsafeValue = unsafeDirectValue(
			valueType.type,
			environment,
			valueType.substitutions,
			new Set(),
		);
		if (unsafeValue !== null) {
			return { unsafeValue };
		}
	}

	return null;
}

/**
 * Classifies an explicit target type by how much of a value's evidence it
 * discards. Named contracts (interfaces, and non-generic aliases that do not
 * resolve to `unknown`/`object`) are deliberately not widening targets: they
 * are the owner type the value is meant to satisfy.
 *
 * @param type - The annotated or asserted target type.
 * @param environment - The file's type declarations.
 * @returns The widening target, or null when the type preserves evidence.
 */
export function classifyWideningTarget(
	type: TSESTree.TypeNode,
	environment: TypeEnvironment,
): null | WideningTarget {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === AST_NODE_TYPES.TSUnknownKeyword) {
		return { kind: "unknown" };
	}

	if (unwrapped.type === AST_NODE_TYPES.TSObjectKeyword) {
		return { kind: "object" };
	}

	if (unwrapped.type === AST_NODE_TYPES.TSTypeLiteral) {
		if (unwrapped.members.some((member) => member.type === AST_NODE_TYPES.TSIndexSignature)) {
			return { kind: "open dictionary" };
		}

		return unwrapped.members.length > 0 ? { kind: "anonymous object" } : null;
	}

	if (unwrapped.type === AST_NODE_TYPES.TSMappedType) {
		return { kind: "open dictionary" };
	}

	if (unwrapped.type !== AST_NODE_TYPES.TSTypeReference) {
		return null;
	}

	const name = typeReferenceName(unwrapped);
	if (name === null) {
		return null;
	}

	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined ? null : classifyWideningTarget(wrapped, environment);
	}

	if (name === "Record" && isBuiltIn(name, environment)) {
		return { kind: "open dictionary" };
	}

	const alias = environment.aliases.get(name);
	if (alias === undefined) {
		return null;
	}

	const substitutions = aliasSubstitution(alias, unwrapped, new Map());
	if (substitutions === null) {
		return null;
	}

	const resolving = new Set([name]);
	if ((alias.typeParameters?.params.length ?? 0) > 0) {
		return resolvesToDictionary(alias.typeAnnotation, environment, substitutions, resolving)
			? { kind: "generic container" }
			: null;
	}

	return classifyAliasBroadTarget(alias.typeAnnotation, environment, substitutions, resolving);
}

/**
 * Strips the wrappers that do not change which expression supplies a value, so
 * `({ id } satisfies Owner)!` still reads as an object expression.
 *
 * @param expression - The expression to unwrap.
 * @returns The innermost wrapped expression.
 */
export function unwrapAssertedExpression(expression: TSESTree.Expression): TSESTree.Expression {
	let current = expression;
	while (
		current.type === AST_NODE_TYPES.TSAsExpression ||
		current.type === AST_NODE_TYPES.TSNonNullExpression ||
		current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
		current.type === AST_NODE_TYPES.TSTypeAssertion
	) {
		current = current.expression;
	}

	return current;
}

/**
 * Whether an expression establishes its own type syntactically, with no call or
 * lookup needed to know its shape.
 *
 * @param expression - The expression supplying a value.
 * @returns True when the expression carries type evidence of its own.
 */
export function isKnownEvidenceExpression(expression: TSESTree.Expression): boolean {
	const current = unwrapAssertedExpression(expression);
	return (
		current.type === AST_NODE_TYPES.ArrayExpression ||
		current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		current.type === AST_NODE_TYPES.ClassExpression ||
		current.type === AST_NODE_TYPES.FunctionExpression ||
		current.type === AST_NODE_TYPES.Literal ||
		current.type === AST_NODE_TYPES.NewExpression ||
		current.type === AST_NODE_TYPES.ObjectExpression ||
		current.type === AST_NODE_TYPES.TemplateLiteral ||
		current.type === AST_NODE_TYPES.UnaryExpression
	);
}

function declaredStatement(statement: TSESTree.ProgramStatement): null | TSESTree.Node {
	return statement.type === AST_NODE_TYPES.ExportNamedDeclaration ||
		statement.type === AST_NODE_TYPES.ExportDefaultDeclaration
		? (statement.declaration ?? null)
		: statement;
}

function isBuiltIn(name: string, environment: TypeEnvironment): boolean {
	return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

function unwrapTransparentType(type: TSESTree.TypeNode): TSESTree.TypeNode {
	let current = type;
	while (
		current.type === AST_NODE_TYPES.TSTypeOperator &&
		current.operator === "readonly" &&
		current.typeAnnotation !== undefined
	) {
		current = current.typeAnnotation;
	}

	return current;
}

function isUnappliedReferenceTo(type: TSESTree.TypeNode, name: string): boolean {
	const unwrapped = unwrapTransparentType(type);
	return (
		unwrapped.type === AST_NODE_TYPES.TSTypeReference &&
		typeReferenceName(unwrapped) === name &&
		(unwrapped.typeArguments?.params.length ?? 0) === 0
	);
}

function isNeverType(type: TSESTree.TypeNode): boolean {
	return unwrapTransparentType(type).type === AST_NODE_TYPES.TSNeverKeyword;
}

function isEffectivelyEmptyMember(member: TSESTree.TypeElement): boolean {
	if (member.type !== AST_NODE_TYPES.TSPropertySignature) {
		return false;
	}

	const memberType = member.typeAnnotation?.typeAnnotation;
	return member.optional && memberType !== undefined && isNeverType(memberType);
}

function isEffectivelyEmptyTypeLiteral(type: TSESTree.TSTypeLiteral): boolean {
	return type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
}

function isEffectivelyEmptyInterface(
	declarations: ReadonlyArray<TSESTree.TSInterfaceDeclaration>,
): boolean {
	if (declarations.length !== 1) {
		return false;
	}

	const [type] = declarations;
	return (
		type?.extends.length === 0 &&
		(type.body.body.length === 0 || type.body.body.every(isEffectivelyEmptyMember))
	);
}

function resolvedSubstitutionArgument(
	type: TSESTree.TypeNode,
	base: TypeAliasEnvironment,
): TSESTree.TypeNode {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type !== AST_NODE_TYPES.TSTypeReference) {
		return type;
	}

	const name = typeReferenceName(unwrapped);
	if (name === null) {
		return type;
	}

	const substitution = base.get(name);
	return substitution === undefined ? type : resolvedSubstitutionArgument(substitution, base);
}

function aliasSubstitution(
	alias: TSESTree.TSTypeAliasDeclaration,
	type: TSESTree.TSTypeReference,
	base: TypeAliasEnvironment,
): null | TypeAliasEnvironment {
	const parameters = alias.typeParameters?.params ?? [];
	const arguments_ = type.typeArguments?.params ?? [];
	const next = new Map(base);
	for (const [index, parameter] of parameters.entries()) {
		const argument = arguments_[index] ?? parameter.default ?? undefined;
		if (argument === undefined) {
			return null;
		}

		next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
	}

	return next;
}

function unsafeDirectValue(
	type: TSESTree.TypeNode,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): null | UnsafeDictionary["unsafeValue"] {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === AST_NODE_TYPES.TSUnknownKeyword) {
		return "unknown";
	}

	if (unwrapped.type === AST_NODE_TYPES.TSAnyKeyword) {
		return "any";
	}

	if (unwrapped.type === AST_NODE_TYPES.TSObjectKeyword) {
		return "object";
	}

	if (
		unwrapped.type === AST_NODE_TYPES.TSTypeLiteral &&
		isEffectivelyEmptyTypeLiteral(unwrapped)
	) {
		return "empty-object";
	}

	if (unwrapped.type === AST_NODE_TYPES.TSUnionType) {
		return unwrapped.types.some(
			(member) =>
				unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null,
		)
			? "union"
			: null;
	}

	if (unwrapped.type === AST_NODE_TYPES.TSIntersectionType) {
		const unsafeMembers = unwrapped.types.map((member) => {
			return unsafeDirectValue(member, environment, substitutions, resolvingAliases);
		});
		if (unsafeMembers.includes("any")) {
			return "any";
		}

		return unsafeMembers.length > 0 && unsafeMembers.every((member) => member !== null)
			? (unsafeMembers[0] ?? null)
			: null;
	}

	if (unwrapped.type !== AST_NODE_TYPES.TSTypeReference) {
		return null;
	}

	const name = typeReferenceName(unwrapped);
	if (name === null) {
		return null;
	}

	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined
			? null
			: unsafeDirectValue(wrapped, environment, substitutions, resolvingAliases);
	}

	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		return isUnappliedReferenceTo(substitution, name)
			? null
			: unsafeDirectValue(substitution, environment, substitutions, resolvingAliases);
	}

	const interfaceDeclarations = environment.interfaces.get(name);
	if (interfaceDeclarations !== undefined) {
		return isEffectivelyEmptyInterface(interfaceDeclarations) ? "empty-object" : null;
	}

	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) {
		return null;
	}

	const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
	if (nextSubstitutions === null) {
		return null;
	}

	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return unsafeDirectValue(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}

function dictionaryValueTypes(
	type: TSESTree.TypeNode,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): ReadonlyArray<ResolvedType> {
	const unwrapped = unwrapTransparentType(type);

	if (unwrapped.type === AST_NODE_TYPES.TSTypeLiteral) {
		return unwrapped.members.flatMap((member): ReadonlyArray<ResolvedType> => {
			if (member.type !== AST_NODE_TYPES.TSIndexSignature) {
				return [];
			}

			const valueType = member.typeAnnotation?.typeAnnotation;
			return valueType === undefined ? [] : [{ substitutions, type: valueType }];
		});
	}

	if (unwrapped.type === AST_NODE_TYPES.TSMappedType) {
		return unwrapped.typeAnnotation?.type === undefined
			? []
			: [{ substitutions, type: unwrapped.typeAnnotation }];
	}

	if (unwrapped.type !== AST_NODE_TYPES.TSTypeReference) {
		return [];
	}

	const name = typeReferenceName(unwrapped);
	if (name === null) {
		return [];
	}

	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		return isUnappliedReferenceTo(substitution, name)
			? []
			: dictionaryValueTypes(substitution, environment, substitutions, resolvingAliases);
	}

	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined
			? []
			: dictionaryValueTypes(wrapped, environment, substitutions, resolvingAliases);
	}

	if (name === "Record" && isBuiltIn(name, environment)) {
		const value = unwrapped.typeArguments?.params[1];
		return value === undefined ? [] : [{ substitutions, type: value }];
	}

	if ((name === "Pick" || name === "Omit") && isBuiltIn(name, environment)) {
		const source = unwrapped.typeArguments?.params[0];
		return source === undefined
			? []
			: dictionaryValueTypes(source, environment, substitutions, resolvingAliases);
	}

	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) {
		return [];
	}

	const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
	if (nextSubstitutions === null) {
		return [];
	}

	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return dictionaryValueTypes(
		alias.typeAnnotation,
		environment,
		nextSubstitutions,
		nextResolving,
	);
}

/**
 * Follows a non-generic alias chain looking only for the bare escape hatches.
 * A chain ending at anything else is a named contract, not a widening target.
 *
 * @param type - The aliased type to resolve.
 * @param environment - The file's type declarations.
 * @param substitutions - Type arguments bound so far.
 * @param resolvingAliases - Aliases already being resolved, guarding cycles.
 * @returns The widening target, or null when the alias names a real shape.
 */
function classifyAliasBroadTarget(
	type: TSESTree.TypeNode,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): null | WideningTarget {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === AST_NODE_TYPES.TSUnknownKeyword) {
		return { kind: "unknown" };
	}

	if (unwrapped.type === AST_NODE_TYPES.TSObjectKeyword) {
		return { kind: "object" };
	}

	if (unwrapped.type !== AST_NODE_TYPES.TSTypeReference) {
		return null;
	}

	const name = typeReferenceName(unwrapped);
	if (name === null) {
		return null;
	}

	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		return isUnappliedReferenceTo(substitution, name)
			? null
			: classifyAliasBroadTarget(substitution, environment, substitutions, resolvingAliases);
	}

	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) {
		return null;
	}

	const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
	if (nextSubstitutions === null) {
		return null;
	}

	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return classifyAliasBroadTarget(
		alias.typeAnnotation,
		environment,
		nextSubstitutions,
		nextResolving,
	);
}

function resolvesToDictionary(
	type: TSESTree.TypeNode,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): boolean {
	return dictionaryValueTypes(type, environment, substitutions, resolvingAliases).length > 0;
}
