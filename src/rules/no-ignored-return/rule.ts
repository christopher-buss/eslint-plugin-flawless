import type {
	JSONSchema,
	ParserServices,
	ParserServicesWithTypeInformation,
	TSESLint,
	TSESTree,
} from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type {
	Declaration,
	Program,
	SourceFile,
	Symbol as TsSymbol,
	Type,
	TypeChecker,
} from "typescript";
import { isExternalModule, isFunctionLike, isInterfaceDeclaration, TypeFlags } from "typescript";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-ignored-return";

const IGNORED_MESSAGE_ID = "ignoredReturn";
const MAP_MESSAGE_ID = "ignoredMap";

export type MessageIds = typeof IGNORED_MESSAGE_ID | typeof MAP_MESSAGE_ID;

export interface NoIgnoredReturnOptions {
	/**
	 * Extra library functions to treat as pure. A bare name (`math`) covers a
	 * global function of that name and every member of a global namespace of
	 * that name. A dotted path (`table.clone`) covers one member.
	 */
	readonly pureFunctions?: ReadonlyArray<string>;
}

export type Options = [NoIgnoredReturnOptions?];

const DEFAULTS: Required<NoIgnoredReturnOptions> = {
	pureFunctions: [],
};

const messages = {
	[IGNORED_MESSAGE_ID]:
		"`{{methodName}}` has no side effects, so this call does nothing. Use its result or remove the call.",
	[MAP_MESSAGE_ID]:
		"The array that `map` returns is discarded. Use `forEach` to iterate for side effects.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			pureFunctions: {
				description:
					"Extra library functions to treat as pure: a global function or namespace name (`math`), or a namespace member (`table.clone`).",
				items: {
					pattern: "^[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)?$",
					type: "string",
				},
				type: "array",
				uniqueItems: true,
			},
		},
		type: "object",
	},
];

type Kind = "array" | "date" | "map" | "number" | "regexp" | "set" | "string";

/**
 * The library interfaces whose methods are pure. A readonly interface leaves
 * out every method that mutates its receiver, and a primitive cannot change,
 * so each method that returns a value only computes it.
 */
const DERIVED_SOURCES: ReadonlyMap<string, Kind> = new Map([
	["Number", "number"],
	["ReadonlyArray", "array"],
	["ReadonlyMap", "map"],
	["ReadonlySet", "set"],
	["String", "string"],
]);

const DATE_GETTERS = [
	"Date",
	"Day",
	"FullYear",
	"Hours",
	"Milliseconds",
	"Minutes",
	"Month",
	"Seconds",
].flatMap((part) => [`get${part}`, `getUTC${part}`]);

/**
 * `Date` and `RegExp` have no readonly interface: `setTime` returns a value
 * and mutates, and a global `test` moves `lastIndex`. Their pure methods are
 * listed here.
 */
const FIXED_TABLES: ReadonlyMap<Kind, ReadonlySet<string>> = new Map<Kind, ReadonlySet<string>>([
	[
		"date",
		new Set([
			...DATE_GETTERS,
			"getTime",
			"getTimezoneOffset",
			"getYear",
			"toDateString",
			"toGMTString",
			"toISOString",
			"toJSON",
			"toLocaleDateString",
			"toLocaleString",
			"toLocaleTimeString",
			"toString",
			"toTimeString",
			"toUTCString",
		]),
	],
	["regexp", new Set(["test", "toString"])],
]);

/** Library object types whose methods a table covers, by type name. */
const OBJECT_KINDS: ReadonlyMap<string, Kind> = new Map([
	["Date", "date"],
	["Map", "map"],
	["ReadonlyMap", "map"],
	["ReadonlySet", "set"],
	["RegExp", "regexp"],
	["Set", "set"],
]);

/** The global namespaces the rule always treats as pure. */
const BUILTIN_NAMESPACES: ReadonlyArray<string> = ["Math"];

const VOID_FLAGS = TypeFlags.Void | TypeFlags.Undefined | TypeFlags.Never;

interface Tables {
	/** Every method name in any table: the check before any type work. */
	readonly names: ReadonlySet<string>;
	readonly tables: ReadonlyMap<Kind, ReadonlySet<string>>;
}

/**
 * Pure functions from the options: `all` for a bare name, or the listed
 * members of a namespace.
 */
type PureEntries = ReadonlyMap<string, "all" | ReadonlySet<string>>;

const tablesByProgram = new WeakMap<Program, Tables>();
const pureMemberCache = new WeakMap<TsSymbol, boolean>();

/**
 * Finds work in a callback that leaves the callback: an assignment or update
 * to state from outside it, or a statement such as `save(item);`. A write to a
 * parameter or a local, such as the accumulator of `reduce`, stays inside.
 */
class EffectFinder {
	private readonly callback: TSESTree.Node;
	private readonly sourceCode: Readonly<TSESLint.SourceCode>;

	constructor(sourceCode: Readonly<TSESLint.SourceCode>, callback: TSESTree.Node) {
		this.sourceCode = sourceCode;
		this.callback = callback;
	}

	/**
	 * Whether a subtree has work that leaves the callback. Work inside a nested
	 * function runs later, if at all, so it does not count. The check is on the
	 * node itself, so a callback that returns a function stops here too.
	 *
	 * @param node - The subtree root.
	 * @returns True when such work is found.
	 */
	public hasEffect(node: TSESTree.Node): boolean {
		if (isFunctionNode(node)) {
			return false;
		}

		if (node.type === AST_NODE_TYPES.AssignmentExpression) {
			return this.isOuterTarget(node.left) || this.hasEffect(node.right);
		}

		if (node.type === AST_NODE_TYPES.UpdateExpression) {
			return this.isOuterTarget(node.argument);
		}

		if (
			node.type === AST_NODE_TYPES.ExpressionStatement &&
			node.expression.type !== AST_NODE_TYPES.AssignmentExpression &&
			node.expression.type !== AST_NODE_TYPES.UpdateExpression
		) {
			return true;
		}

		const keys = this.sourceCode.visitorKeys[node.type] ?? [];
		for (const key of keys) {
			const value: unknown = Reflect.get(node, key);
			const children = Array.isArray(value) ? value : [value];
			for (const child of children) {
				if (isNode(child) && this.hasEffect(child)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Whether an assignment target is state from outside the callback. A
	 * destructuring target or `this` counts as outside.
	 *
	 * @param target - The left side of an assignment, or an update argument.
	 * @returns False only for a parameter or a local of the callback.
	 */
	private isOuterTarget(target: TSESTree.Node): boolean {
		const root = getAssignedRoot(target);
		if (root.type !== AST_NODE_TYPES.Identifier) {
			return true;
		}

		const variable = findVariable(this.sourceCode.getScope(root), root);
		const definition = variable?.defs[0];
		if (definition === undefined) {
			return true;
		}

		const [start, end] = definition.name.range;
		return start < this.callback.range[0] || end > this.callback.range[1];
	}
}

function isFunctionNode(node: TSESTree.Node): boolean {
	return (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node.type === AST_NODE_TYPES.FunctionDeclaration ||
		node.type === AST_NODE_TYPES.FunctionExpression
	);
}

function isNode(value: unknown): value is TSESTree.Node {
	return typeof value === "object" && value !== null && "type" in value;
}

function getAssignedRoot(target: TSESTree.Node): TSESTree.Node {
	let current = target;
	while (
		current.type === AST_NODE_TYPES.MemberExpression ||
		current.type === AST_NODE_TYPES.TSNonNullExpression
	) {
		current =
			current.type === AST_NODE_TYPES.MemberExpression ? current.object : current.expression;
	}

	return current;
}

function hasTypeInformation(
	services: Partial<ParserServices> | undefined,
): services is ParserServicesWithTypeInformation {
	return services?.program !== undefined && services.program !== null;
}

/**
 * Whether a file holds global library code: a TypeScript lib file, or a global
 * declaration file from an installed package. A replacement library such as
 * the roblox-ts types is the second kind. TypeScript 6 ignores
 * `no-default-lib`, so the default library check alone does not find it. A
 * package module is not global: its `Map` class or local `interface String` is
 * not the built-in, and neither is its `declare global` augmentation.
 *
 * @param program - The program that owns the checked files.
 * @param file - The file that holds a declaration.
 * @returns True for global library code, false for the user's own files and
 *   for package modules.
 */
function isLibraryFile(program: Program, file: SourceFile): boolean {
	if (program.isSourceFileDefaultLibrary(file)) {
		return true;
	}

	return (
		file.isDeclarationFile &&
		!isExternalModule(file) &&
		program.isSourceFileFromExternalLibrary(file)
	);
}

function isLibraryDeclaration(program: Program, declaration: Declaration): boolean {
	return isLibraryFile(program, declaration.getSourceFile());
}

/**
 * Whether every declaration of a symbol is library code. A member that an
 * augmentation adds or overloads is not.
 *
 * @param program - The program that owns the checked files.
 * @param symbol - The symbol to test.
 * @returns True when the symbol comes only from a library.
 */
function isLibrarySymbol(program: Program, symbol: TsSymbol | undefined): boolean {
	const declarations = symbol?.getDeclarations();
	return (
		declarations !== undefined &&
		declarations.length > 0 &&
		declarations.every((declaration) => isLibraryDeclaration(program, declaration))
	);
}

/**
 * Whether every call signature of a type returns a value.
 *
 * @param checker - The type checker.
 * @param type - The function type.
 * @returns False for a type with no call signature, or one that can return
 *   `void`, `undefined` or `never`.
 */
function returnsValue(checker: TypeChecker, type: Type): boolean {
	const signatures = type.getCallSignatures();
	return (
		signatures.length > 0 &&
		signatures.every((signature) => {
			return (checker.getReturnTypeOfSignature(signature).flags & VOID_FLAGS) === 0;
		})
	);
}

function isMutableArrayType(checker: TypeChecker, type: Type): boolean {
	const members = type.isUnion() ? type.types : [type];
	return members.some((member) => {
		return checker.isArrayType(member) && member.getSymbol()?.getName() === "Array";
	});
}

/**
 * Whether a method declaration takes a mutable array that it can write into,
 * such as `move(f, e, t, a2: Array<T>)`. The parameter type is resolved, so an
 * alias of `Array<T>` counts. A rest parameter only gathers the arguments, so
 * it does not count.
 *
 * @param checker - The type checker.
 * @param declaration - The method declaration.
 * @returns True when a parameter, `this` included, is a mutable array.
 */
function hasMutableArrayParameter(checker: TypeChecker, declaration: Declaration): boolean {
	return (
		isFunctionLike(declaration) &&
		declaration.parameters.some((parameter) => {
			return (
				parameter.dotDotDotToken === undefined &&
				parameter.type !== undefined &&
				isMutableArrayType(checker, checker.getTypeFromTypeNode(parameter.type))
			);
		})
	);
}

/**
 * Adds the {@link DERIVED_SOURCES} interfaces declared at the top level of one
 * library file, keeping the first symbol found for each kind.
 *
 * @param checker - The type checker.
 * @param file - The library file to read.
 * @param found - The interfaces found so far, updated in place.
 */
function addSourceInterfaces(
	checker: TypeChecker,
	file: SourceFile,
	found: Map<Kind, TsSymbol>,
): void {
	// Only a global script declares the global interfaces.
	for (const statement of file.statements) {
		if (!isInterfaceDeclaration(statement)) {
			continue;
		}

		const kind = DERIVED_SOURCES.get(statement.name.text);
		if (kind === undefined || found.has(kind)) {
			continue;
		}

		const symbol = checker.getSymbolAtLocation(statement.name);
		if (symbol !== undefined) {
			found.set(kind, symbol);
		}
	}
}

/**
 * The global library interfaces named in {@link DERIVED_SOURCES}, read from the
 * top level of each library file.
 *
 * @param program - The program that owns the checked files.
 * @param checker - The type checker.
 * @returns The merged global symbol of each interface found.
 */
function findSourceInterfaces(program: Program, checker: TypeChecker): Map<Kind, TsSymbol> {
	const found = new Map<Kind, TsSymbol>();
	for (const file of program.getSourceFiles()) {
		if (!isLibraryFile(program, file)) {
			continue;
		}

		addSourceInterfaces(checker, file, found);
	}

	return found;
}

/**
 * The methods of a library interface that return a value, have only library
 * declarations and take no mutable array.
 *
 * @param program - The program that owns the checked files.
 * @param checker - The type checker.
 * @param symbol - The interface symbol.
 * @returns The method names.
 */
function derivePureMethods(program: Program, checker: TypeChecker, symbol: TsSymbol): Set<string> {
	const methods = new Set<string>();
	const properties = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol));
	for (const property of properties) {
		const { name } = property;
		// Well-known symbol members are keyed `__@iterator@<id>`.
		if (name.startsWith("__@") || !isLibrarySymbol(program, property)) {
			continue;
		}

		const declarations = property.getDeclarations() ?? [];
		if (declarations.some((declaration) => hasMutableArrayParameter(checker, declaration))) {
			continue;
		}

		if (returnsValue(checker, checker.getTypeOfSymbol(property))) {
			methods.add(name);
		}
	}

	return methods;
}

/**
 * The method tables of a program, made once and kept for later files.
 *
 * @param program - The program that owns the checked files.
 * @returns The tables by receiver kind.
 */
function getTables(program: Program): Tables {
	const cached = tablesByProgram.get(program);
	if (cached !== undefined) {
		return cached;
	}

	const checker = program.getTypeChecker();
	const tables = new Map(FIXED_TABLES);
	for (const [kind, symbol] of findSourceInterfaces(program, checker)) {
		tables.set(kind, derivePureMethods(program, checker, symbol));
	}

	const names = new Set([...tables.values()].flatMap((methods) => [...methods]));
	const result = { names, tables };
	tablesByProgram.set(program, result);
	return result;
}

function parsePureFunctions(entries: ReadonlyArray<string>): PureEntries {
	const parsed = new Map<string, "all" | Set<string>>(
		BUILTIN_NAMESPACES.map((name) => [name, "all"]),
	);
	for (const entry of entries) {
		const [owner = entry, member] = entry.split(".", 2);
		const current = parsed.get(owner);
		if (member === undefined) {
			parsed.set(owner, "all");
		} else if (current === undefined) {
			parsed.set(owner, new Set([member]));
		} else if (current !== "all") {
			current.add(member);
		}
	}

	return parsed;
}

/**
 * The method name a member call spells statically: `a.name`, `a["name"]` and
 * `` a[`name`] ``. A computed key that is not a literal has no static name.
 *
 * @param callee - The member expression the call invokes.
 * @returns The method name, or undefined when it is not known statically.
 */
function getMethodName({ computed, property }: TSESTree.MemberExpression): string | undefined {
	if (!computed) {
		return property.type === AST_NODE_TYPES.Identifier ? property.name : undefined;
	}

	if (property.type === AST_NODE_TYPES.Literal) {
		return typeof property.value === "string" ? property.value : undefined;
	}

	if (property.type === AST_NODE_TYPES.TemplateLiteral && property.expressions.length === 0) {
		return property.quasis[0]?.value.cooked ?? undefined;
	}

	return undefined;
}

/**
 * The receiver kind whose table applies. The flag test equals a printed type of
 * `"string"` or `"number"`: only the intrinsic types carry these flags, and
 * the base of a literal, a literal union or a template literal is intrinsic.
 * Unions, intersections, enums and `any` match no kind.
 *
 * @param program - The program that owns the checked files.
 * @param checker - The type checker.
 * @param type - The type of the receiver.
 * @returns The receiver kind, or undefined when no table applies.
 */
function getKind(program: Program, checker: TypeChecker, type: Type): Kind | undefined {
	const base = checker.getBaseTypeOfLiteralType(type);
	if ((base.flags & TypeFlags.String) !== 0) {
		return "string";
	}

	if ((base.flags & TypeFlags.Number) !== 0) {
		return "number";
	}

	if (checker.isArrayType(type) || checker.isTupleType(type)) {
		return "array";
	}

	// One library declaration is enough: a user augmentation of `Date` adds
	// members, and the tables already leave those out.
	const symbol = type.getSymbol();
	const kind = symbol === undefined ? undefined : OBJECT_KINDS.get(symbol.getName());
	const isLibraryType =
		symbol?.getDeclarations()?.some((declaration) => {
			return isLibraryDeclaration(program, declaration);
		}) === true;
	return kind !== undefined && isLibraryType ? kind : undefined;
}

/**
 * Whether an argument is a function, such as a `replace` replacer. A callback
 * can do work, so the call is not pure.
 *
 * @param services - The parser services.
 * @param node - The call.
 * @returns True when any argument has a call signature.
 */
function hasFunctionArgument(
	services: ParserServicesWithTypeInformation,
	node: TSESTree.CallExpression,
): boolean {
	return node.arguments.some((argument) => {
		return services.getTypeAtLocation(argument).getCallSignatures().length > 0;
	});
}

/**
 * Whether an inline callback does work that leaves it, as a loop with an early
 * exit such as `find` or `some`.
 *
 * @param sourceCode - The source code, for scopes and child keys.
 * @param node - The call expression to check.
 * @returns True when an inline callback body has such work.
 */
function hasCallbackWithEffect(
	sourceCode: Readonly<TSESLint.SourceCode>,
	node: TSESTree.CallExpression,
): boolean {
	return node.arguments.some((argument) => {
		if (
			argument.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
			argument.type !== AST_NODE_TYPES.FunctionExpression
		) {
			return false;
		}

		const finder = new EffectFinder(sourceCode, argument);
		return finder.hasEffect(argument.body);
	});
}

/**
 * Whether a library function that a pure entry covers returns a value.
 *
 * @param program - The program that owns the checked files.
 * @param symbol - The symbol of the called function.
 * @returns True when the function is pure and returns a value.
 */
function isPureLibraryFunction(program: Program, symbol: TsSymbol | undefined): boolean {
	if (symbol === undefined) {
		return false;
	}

	let pure = pureMemberCache.get(symbol);
	if (pure === undefined) {
		const checker = program.getTypeChecker();
		pure =
			isLibrarySymbol(program, symbol) &&
			returnsValue(checker, checker.getTypeOfSymbol(symbol));
		pureMemberCache.set(symbol, pure);
	}

	return pure;
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let pureEntries = parsePureFunctions([]);
	let services: ParserServicesWithTypeInformation | undefined;

	function report(node: TSESTree.CallExpression, methodName: string): void {
		context.report({
			data: { methodName },
			messageId: methodName === "map" ? MAP_MESSAGE_ID : IGNORED_MESSAGE_ID,
			node,
		});
	}

	/**
	 * Checks `name()`, a call to a global function that an entry covers.
	 *
	 * @param node - The call expression to check.
	 * @param callee - The called name.
	 */
	function checkGlobalCall(node: TSESTree.CallExpression, callee: TSESTree.Identifier): void {
		if (services === undefined || pureEntries.get(callee.name) !== "all") {
			return;
		}

		const { esTreeNodeToTSNodeMap, program } = services;
		const tsNode = esTreeNodeToTSNodeMap.get(callee);
		const symbol = program.getTypeChecker().getSymbolAtLocation(tsNode);
		if (isPureLibraryFunction(program, symbol) && !hasFunctionArgument(services, node)) {
			report(node, callee.name);
		}
	}

	/**
	 * Checks `namespace.name()` for a namespace that an entry covers.
	 *
	 * @param node - The call expression to check.
	 * @param object - The namespace name.
	 * @param methodName - The member name.
	 * @returns True when the namespace is a library global, so no other check
	 *   applies.
	 */
	function checkNamespaceCall(
		node: TSESTree.CallExpression,
		object: TSESTree.Identifier,
		methodName: string,
	): boolean {
		const entry = pureEntries.get(object.name);
		if (services === undefined || entry === undefined) {
			return false;
		}

		const { esTreeNodeToTSNodeMap, program } = services;
		const checker = program.getTypeChecker();
		const tsObject = esTreeNodeToTSNodeMap.get(object);
		// A local of the same name shadows the global.
		if (!isLibrarySymbol(program, checker.getSymbolAtLocation(tsObject))) {
			return false;
		}

		if (entry !== "all" && !entry.has(methodName)) {
			return true;
		}

		const member = checker.getPropertyOfType(checker.getTypeAtLocation(tsObject), methodName);
		if (isPureLibraryFunction(program, member) && !hasFunctionArgument(services, node)) {
			report(node, methodName);
		}

		return true;
	}

	/**
	 * Checks `receiver.name()` against the method table of the receiver kind.
	 *
	 * @param node - The call expression to check.
	 * @param object - The receiver.
	 * @param methodName - The called member, as spelled in the source.
	 */
	function checkMethodCall(
		node: TSESTree.CallExpression,
		object: TSESTree.Expression,
		methodName: string,
	): void {
		if (services === undefined) {
			return;
		}

		// The name check runs before any type work: most calls in real code
		// name no table method, and the type lookup is the costly part.
		const { program } = services;
		const { names, tables } = getTables(program);
		if (!names.has(methodName)) {
			return;
		}

		const checker = program.getTypeChecker();
		const kind = getKind(program, checker, services.getTypeAtLocation(object));
		if (kind === undefined || tables.get(kind)?.has(methodName) !== true) {
			return;
		}

		if (kind === "string" && hasFunctionArgument(services, node)) {
			return;
		}

		// A callback that does work makes `find` or `some` a loop with an early
		// exit. A call that returns an array, such as `map`, is still reported:
		// `forEach` is the loop to use.
		if (
			hasCallbackWithEffect(context.sourceCode, node) &&
			!checker.isArrayType(services.getTypeAtLocation(node))
		) {
			return;
		}

		report(node, methodName);
	}

	return {
		before(): boolean {
			const { options, sourceCode } = context;
			const { parserServices } = sourceCode;
			if (!hasTypeInformation(parserServices)) {
				return false;
			}

			services = parserServices;
			pureEntries = parsePureFunctions(options[0]?.pureFunctions ?? DEFAULTS.pureFunctions);
			return true;
		},
		CallExpression(node): void {
			if (node.parent.type !== AST_NODE_TYPES.ExpressionStatement) {
				return;
			}

			const { callee } = node;
			if (callee.type === AST_NODE_TYPES.Identifier) {
				checkGlobalCall(node, callee);
				return;
			}

			if (callee.type !== AST_NODE_TYPES.MemberExpression) {
				return;
			}

			const methodName = getMethodName(callee);
			if (methodName === undefined) {
				return;
			}

			const { object } = callee;
			if (
				object.type === AST_NODE_TYPES.Identifier &&
				checkNamespaceCall(node, object, methodName)
			) {
				return;
			}

			checkMethodCall(node, object, methodName);
		},
	};
}

export const noIgnoredReturn: FlawlessRuleModule<Options, MessageIds> = createFlawlessRule<
	Options,
	MessageIds
>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [DEFAULTS],
	meta: {
		defaultOptions: [DEFAULTS],
		docs: {
			description:
				"Disallow ignoring the result of a built-in method that has no side effects",
			recommended: false,
			requiresTypeChecking: true,
		},
		hasSuggestions: false,
		messages,
		schema,
		type: "problem",
	},
});
