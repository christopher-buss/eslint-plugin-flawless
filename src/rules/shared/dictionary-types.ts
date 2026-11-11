import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

import { lookupAlias, lookupTypeDeclaration } from "./type-bindings.ts";

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
	readonly interfaces: ReadonlyMap<string, ReadonlyArray<TSESTree.TSInterfaceDeclaration>>;
}

type TypeAliasEnvironment = ReadonlyMap<string, TSESTree.TypeNode>;

interface ResolvedType {
	readonly substitutions: TypeAliasEnvironment;
	readonly type: TSESTree.TypeNode;
}

/**
 * Collects the file's module-level interfaces. Type aliases and built-in
 * shadowing are resolved lexically at each reference instead.
 *
 * @param program - The linted file.
 * @returns The file's type environment.
 */
export function createTypeEnvironment(program: TSESTree.Program): TypeEnvironment {
	const interfaces = new Map<string, Array<TSESTree.TSInterfaceDeclaration>>();
	for (const statement of program.body) {
		const declaration = declaredStatement(statement);
		if (declaration?.type !== AST_NODE_TYPES.TSInterfaceDeclaration) {
			continue;
		}

		const declarations = interfaces.get(declaration.id.name) ?? [];
		declarations.push(declaration);
		interfaces.set(declaration.id.name, declarations);
	}

	return { interfaces };
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
	const valueTypes = dictionaryValueTypes(type, new Map(), new Set());
	for (const valueType of valueTypes) {
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
 * @returns The widening target, or null when the type preserves evidence.
 */
export function classifyWideningTarget(type: TSESTree.TypeNode): null | WideningTarget {
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

	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, unwrapped)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined ? null : classifyWideningTarget(wrapped);
	}

	if (name === "Record" && isBuiltIn(name, unwrapped)) {
		return hasBroadRecordKey(unwrapped, new Map()) ? { kind: "open dictionary" } : null;
	}

	const alias = lookupAlias(name, unwrapped);
	if (alias === undefined) {
		return null;
	}

	const substitutions = aliasSubstitution(alias, unwrapped, new Map());
	if (substitutions === null) {
		return null;
	}

	const resolving = new Set([name]);
	if ((alias.typeParameters?.params.length ?? 0) > 0) {
		const resolved = classifyAliasBroadTarget(alias.typeAnnotation, substitutions, resolving);
		return resolved?.kind === "open dictionary" ? { kind: "generic container" } : null;
	}

	return classifyAliasBroadTarget(alias.typeAnnotation, substitutions, resolving);
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

function isBuiltIn(name: string, use: TSESTree.Node): boolean {
	return BUILT_INS.has(name) && lookupTypeDeclaration(name, use) === undefined;
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
	initialType: TSESTree.TypeNode,
	base: TypeAliasEnvironment,
	initialSeen: ReadonlySet<string> = new Set(),
): TSESTree.TypeNode {
	let type = initialType;
	let seen = initialSeen;
	for (;;) {
		const unwrapped = unwrapTransparentType(type);
		if (unwrapped.type !== AST_NODE_TYPES.TSTypeReference) {
			return type;
		}

		const name = typeReferenceName(unwrapped);
		if (name === null) {
			return type;
		}

		if (seen.has(name)) {
			return type;
		}

		const substitution = base.get(name);
		if (substitution === undefined) {
			return type;
		}

		const nextSeen = new Set(seen);
		// oxlint-disable-next-line unicorn/no-immediate-mutation -- copies the set, then adds; no extra array
		nextSeen.add(name);
		type = substitution;
		seen = nextSeen;
	}
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
	initialType: TSESTree.TypeNode,
	environment: TypeEnvironment,
	initialSubstitutions: TypeAliasEnvironment,
	initialResolvingAliases: ReadonlySet<string>,
): null | UnsafeDictionary["unsafeValue"] {
	let type = initialType;
	let substitutions = initialSubstitutions;
	let resolvingAliases = initialResolvingAliases;
	for (;;) {
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
			for (const member of unwrapped.types) {
				if (
					unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null
				) {
					return "union";
				}
			}

			return null;
		}

		if (unwrapped.type === AST_NODE_TYPES.TSIntersectionType) {
			const memberSubstitutions = substitutions;
			const memberAliases = resolvingAliases;
			const unsafeMembers = unwrapped.types.map((member) => {
				return unsafeDirectValue(member, environment, memberSubstitutions, memberAliases);
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

		if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, unwrapped)) {
			const wrapped = unwrapped.typeArguments?.params[0];
			if (wrapped === undefined) {
				return null;
			}

			type = wrapped;
			continue;
		}

		const substitution = substitutions.get(name);
		if (substitution !== undefined) {
			if (isUnappliedReferenceTo(substitution, name)) {
				return null;
			}

			type = substitution;
			continue;
		}

		const interfaceDeclarations = environment.interfaces.get(name);
		if (interfaceDeclarations !== undefined) {
			return isEffectivelyEmptyInterface(interfaceDeclarations) ? "empty-object" : null;
		}

		const alias = lookupAlias(name, unwrapped);
		if (alias === undefined || resolvingAliases.has(name)) {
			return null;
		}

		const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
		if (nextSubstitutions === null) {
			return null;
		}

		const nextResolving = new Set(resolvingAliases);
		// oxlint-disable-next-line unicorn/no-immediate-mutation -- copies the set, then adds; no extra array
		nextResolving.add(name);
		type = alias.typeAnnotation;
		substitutions = nextSubstitutions;
		resolvingAliases = nextResolving;
	}
}

function dictionaryValueTypes(
	initialType: TSESTree.TypeNode,
	initialSubstitutions: TypeAliasEnvironment,
	initialResolvingAliases: ReadonlySet<string>,
): ReadonlyArray<ResolvedType> {
	let type = initialType;
	let substitutions = initialSubstitutions;
	let resolvingAliases = initialResolvingAliases;
	for (;;) {
		const unwrapped = unwrapTransparentType(type);

		if (unwrapped.type === AST_NODE_TYPES.TSTypeLiteral) {
			const values: Array<ResolvedType> = [];
			for (const member of unwrapped.members) {
				const valueType =
					member.type === AST_NODE_TYPES.TSIndexSignature
						? member.typeAnnotation?.typeAnnotation
						: undefined;
				if (valueType !== undefined) {
					values.push({ substitutions, type: valueType });
				}
			}

			return values;
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
			if (isUnappliedReferenceTo(substitution, name)) {
				return [];
			}

			type = substitution;
			continue;
		}

		if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, unwrapped)) {
			const wrapped = unwrapped.typeArguments?.params[0];
			if (wrapped === undefined) {
				return [];
			}

			type = wrapped;
			continue;
		}

		if (name === "Record" && isBuiltIn(name, unwrapped)) {
			const value = unwrapped.typeArguments?.params[1];
			return value === undefined ? [] : [{ substitutions, type: value }];
		}

		if ((name === "Pick" || name === "Omit") && isBuiltIn(name, unwrapped)) {
			const source = unwrapped.typeArguments?.params[0];
			if (source === undefined) {
				return [];
			}

			type = source;
			continue;
		}

		const alias = lookupAlias(name, unwrapped);
		if (alias === undefined || resolvingAliases.has(name)) {
			return [];
		}

		const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
		if (nextSubstitutions === null) {
			return [];
		}

		const nextResolving = new Set(resolvingAliases);
		// oxlint-disable-next-line unicorn/no-immediate-mutation -- copies the set, then adds; no extra array
		nextResolving.add(name);
		type = alias.typeAnnotation;
		substitutions = nextSubstitutions;
		resolvingAliases = nextResolving;
	}
}

/**
 * Whether a mapped type's key constrains nothing: `string`, `number`, `symbol`,
 * `PropertyKey`, a non-generic alias to one of those, or a union with any such
 * member. A key drawn from a union of literals states exactly which properties
 * exist, so it is not broad.
 *
 * @param initialType - The mapped type's constraint.
 * @param substitutions - Type arguments bound so far.
 * @param initialVisitedAliases - Key aliases already followed, guarding cycles.
 * @returns True when the key admits any property name.
 */
function isBroadMappedKey(
	initialType: TSESTree.TypeNode,
	substitutions: TypeAliasEnvironment,
	initialVisitedAliases: ReadonlySet<string> = new Set(),
): boolean {
	let type = initialType;
	let visitedAliases = initialVisitedAliases;
	for (;;) {
		const unwrapped = unwrapTransparentType(type);
		if (
			unwrapped.type === AST_NODE_TYPES.TSNumberKeyword ||
			unwrapped.type === AST_NODE_TYPES.TSStringKeyword ||
			unwrapped.type === AST_NODE_TYPES.TSSymbolKeyword
		) {
			return true;
		}

		if (unwrapped.type === AST_NODE_TYPES.TSUnionType) {
			for (const member of unwrapped.types) {
				if (isBroadMappedKey(member, substitutions, visitedAliases)) {
					return true;
				}
			}

			return false;
		}

		if (unwrapped.type !== AST_NODE_TYPES.TSTypeReference) {
			return false;
		}

		const name = typeReferenceName(unwrapped);
		if (name === null) {
			return false;
		}

		const substitution = substitutions.get(name);
		if (substitution !== undefined && !isUnappliedReferenceTo(substitution, name)) {
			type = substitution;
			continue;
		}

		if (name === "PropertyKey" && isBuiltIn(name, unwrapped)) {
			return true;
		}

		const alias = lookupAlias(name, unwrapped);
		if (
			alias === undefined ||
			(alias.typeParameters?.params.length ?? 0) > 0 ||
			visitedAliases.has(name)
		) {
			return false;
		}

		const nextVisited = new Set(visitedAliases);
		// oxlint-disable-next-line unicorn/no-immediate-mutation -- copies the set, then adds; no extra array
		nextVisited.add(name);
		type = alias.typeAnnotation;
		visitedAliases = nextVisited;
	}
}

/**
 * Whether a `Record`'s key admits any property name. An omitted key is treated
 * as broad, since nothing narrows it.
 *
 * @param type - The `Record` reference.
 * @param substitutions - Type arguments bound so far.
 * @returns True when the key admits any property name.
 */
function hasBroadRecordKey(
	type: TSESTree.TSTypeReference,
	substitutions: TypeAliasEnvironment,
): boolean {
	const key = type.typeArguments?.params[0];
	return key === undefined || isBroadMappedKey(key, substitutions);
}

/**
 * Follows a non-generic alias chain looking for the shapes that constrain
 * nothing: the bare escape hatches, and dictionaries whose key set is open. A
 * chain ending at anything else is a named contract, not a widening target —
 * which is why a type literal or mapped type is treated more leniently here
 * than when it is written inline at the annotation.
 *
 * @param initialType - The aliased type to resolve.
 * @param initialSubstitutions - Type arguments bound so far.
 * @param initialResolvingAliases - Aliases already being resolved, guarding cycles.
 * @returns The widening target, or null when the alias names a real shape.
 */
function classifyAliasBroadTarget(
	initialType: TSESTree.TypeNode,
	initialSubstitutions: TypeAliasEnvironment,
	initialResolvingAliases: ReadonlySet<string>,
): null | WideningTarget {
	let type = initialType;
	let substitutions = initialSubstitutions;
	let resolvingAliases = initialResolvingAliases;
	for (;;) {
		const unwrapped = unwrapTransparentType(type);
		if (unwrapped.type === AST_NODE_TYPES.TSUnknownKeyword) {
			return { kind: "unknown" };
		}

		if (unwrapped.type === AST_NODE_TYPES.TSObjectKeyword) {
			return { kind: "object" };
		}

		if (unwrapped.type === AST_NODE_TYPES.TSTypeLiteral) {
			return unwrapped.members.some(
				(member) => member.type === AST_NODE_TYPES.TSIndexSignature,
			)
				? { kind: "open dictionary" }
				: null;
		}

		if (unwrapped.type === AST_NODE_TYPES.TSMappedType) {
			return isBroadMappedKey(unwrapped.constraint, substitutions)
				? { kind: "open dictionary" }
				: null;
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
			if (isUnappliedReferenceTo(substitution, name)) {
				return null;
			}

			type = substitution;
			continue;
		}

		if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, unwrapped)) {
			const wrapped = unwrapped.typeArguments?.params[0];
			if (wrapped === undefined) {
				return null;
			}

			type = wrapped;
			continue;
		}

		if (name === "Record" && isBuiltIn(name, unwrapped)) {
			return hasBroadRecordKey(unwrapped, substitutions) ? { kind: "open dictionary" } : null;
		}

		const alias = lookupAlias(name, unwrapped);
		if (alias === undefined || resolvingAliases.has(name)) {
			return null;
		}

		const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
		if (nextSubstitutions === null) {
			return null;
		}

		const nextResolving = new Set(resolvingAliases);
		// oxlint-disable-next-line unicorn/no-immediate-mutation -- copies the set, then adds; no extra array
		nextResolving.add(name);
		type = alias.typeAnnotation;
		substitutions = nextSubstitutions;
		resolvingAliases = nextResolving;
	}
}
