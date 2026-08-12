import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

const BUILT_INS = new Set([
	"NonNullable",
	"Omit",
	"Partial",
	"Pick",
	"PropertyKey",
	"Readonly",
	"Record",
	"Required",
]);
const TRANSPARENT_WRAPPERS = new Set(["NonNullable", "Partial", "Readonly", "Required"]);

export interface UnsafeDictionary {
	readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
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

function declaredStatement(statement: TSESTree.ProgramStatement): null | TSESTree.Node {
	return statement.type === AST_NODE_TYPES.ExportNamedDeclaration ||
		statement.type === AST_NODE_TYPES.ExportDefaultDeclaration
		? (statement.declaration ?? null)
		: statement;
}

function typeReferenceName(type: TSESTree.TSTypeReference): null | string {
	return type.typeName.type === AST_NODE_TYPES.Identifier ? type.typeName.name : null;
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
		(unwrapped.typeArguments === undefined || unwrapped.typeArguments.params.length === 0)
	);
}

function isNeverType(type: TSESTree.TypeNode): boolean {
	return unwrapTransparentType(type).type === AST_NODE_TYPES.TSNeverKeyword;
}

function isEffectivelyEmptyMember(member: TSESTree.TypeElement): boolean {
	return (
		member.type === AST_NODE_TYPES.TSPropertySignature &&
		member.optional &&
		member.typeAnnotation !== undefined &&
		isNeverType(member.typeAnnotation.typeAnnotation)
	);
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
		const argument = arguments_[index] ?? parameter.default;
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
			return member.type === AST_NODE_TYPES.TSIndexSignature &&
				member.typeAnnotation !== undefined
				? [{ substitutions, type: member.typeAnnotation.typeAnnotation }]
				: [];
		});
	}

	if (unwrapped.type === AST_NODE_TYPES.TSMappedType) {
		return unwrapped.typeAnnotation === undefined
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
