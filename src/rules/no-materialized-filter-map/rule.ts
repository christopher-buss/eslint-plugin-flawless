import type {
	JSONSchema,
	ParserServices,
	ParserServicesWithTypeInformation,
	TSESLint,
	TSESTree,
} from "@typescript-eslint/utils";
import { AST_NODE_TYPES, AST_TOKEN_TYPES } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { Program, Type, TypeChecker } from "typescript";
import { TypeFlags } from "typescript";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-materialized-filter-map";

const MESSAGE_ID = "materialized";
const MESSAGE_ID_NO_HELPERS = "materializedNoHelpers";
const MESSAGE_ID_SUGGEST = "chainOnIterator";

export type MessageIds =
	| typeof MESSAGE_ID
	| typeof MESSAGE_ID_NO_HELPERS
	| typeof MESSAGE_ID_SUGGEST;

export interface NoMaterializedFilterMapOptions {
	/**
	 * Whether the target runtime has iterator helpers (`Iterator.prototype.map`
	 * and friends). Set to `false` for targets without them, such as roblox-ts:
	 * the rule still reports, but names a single `for...of` loop as the fix and
	 * offers no autofix or suggestion.
	 */
	readonly iteratorHelpers?: boolean;
}

export type Options = [NoMaterializedFilterMapOptions?];

const DEFAULT_ITERATOR_HELPERS = true;

const DEFAULTS: Required<NoMaterializedFilterMapOptions> = {
	iteratorHelpers: DEFAULT_ITERATOR_HELPERS,
};

const messages = {
	[MESSAGE_ID]:
		"`{{copy}}` copies the iterable into an array only for `{{chain}}` to copy it again. Chain the iterator helpers on the iterable, and call `.toArray()` only where an array is needed.",
	[MESSAGE_ID_NO_HELPERS]:
		"`{{copy}}` copies the iterable into an array only for `{{chain}}` to copy it again. Build the result in one `for...of` loop over the iterable.",
	[MESSAGE_ID_SUGGEST]:
		"Chain on the iterator. Check first that nothing depends on the callbacks running eagerly.",
};

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			iteratorHelpers: {
				description:
					"Whether the target runtime has iterator helpers. Set to false for targets without them, such as roblox-ts.",
				type: "boolean",
			},
		},
		type: "object",
	},
];

/** The array methods whose chain this rule follows. */
const CHAIN_METHODS = new Set(["filter", "map"]);

/** Built-in iterators whose iteration runs no user code. */
const BUILTIN_ITERATOR_NAMES = new Set(["ArrayIterator", "MapIterator", "SetIterator"]);

/** Built-in collections, and the method that yields what a spread of them yields. */
const COLLECTION_METHODS = new Map([
	["Map", "entries"],
	["ReadonlyMap", "entries"],
	["ReadonlySet", "values"],
	["Set", "values"],
]);

/** Constructors that consume an iterable argument at once. */
const ITERABLE_CONSTRUCTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

/** The members a type must declare for iterator helpers to exist on it. */
const HELPER_MEMBERS = ["filter", "map", "next", "toArray"];

/**
 * Node types that can run code with an effect another callback could observe.
 * Member reads and implicit conversions can reach a getter or `valueOf` too;
 * those are accepted, as every syntactic purity check must.
 */
const EFFECT_NODE_TYPES = new Set<string>([
	AST_NODE_TYPES.AssignmentExpression,
	AST_NODE_TYPES.AwaitExpression,
	AST_NODE_TYPES.CallExpression,
	AST_NODE_TYPES.ClassDeclaration,
	AST_NODE_TYPES.ClassExpression,
	AST_NODE_TYPES.ForOfStatement,
	AST_NODE_TYPES.ImportExpression,
	AST_NODE_TYPES.NewExpression,
	AST_NODE_TYPES.SpreadElement,
	AST_NODE_TYPES.TaggedTemplateExpression,
	AST_NODE_TYPES.ThrowStatement,
	AST_NODE_TYPES.UpdateExpression,
	AST_NODE_TYPES.YieldExpression,
]);

/** Expressions that take a member access without parentheses. */
const MEMBER_SAFE_TYPES = new Set<string>([
	AST_NODE_TYPES.ArrayExpression,
	AST_NODE_TYPES.CallExpression,
	AST_NODE_TYPES.Identifier,
	AST_NODE_TYPES.MemberExpression,
	AST_NODE_TYPES.ThisExpression,
]);

/** Token types that end an expression, so a `(` or `[` after them continues it. */
const EXPRESSION_END_TOKENS = new Set<string>([
	AST_TOKEN_TYPES.Boolean,
	AST_TOKEN_TYPES.Identifier,
	AST_TOKEN_TYPES.Null,
	AST_TOKEN_TYPES.Numeric,
	AST_TOKEN_TYPES.PrivateIdentifier,
	AST_TOKEN_TYPES.RegularExpression,
	AST_TOKEN_TYPES.String,
	AST_TOKEN_TYPES.Template,
]);

// `!` covers a TypeScript non-null assertion and `>` the end of a JSX element.
// Both also appear as operators, where bailing out only costs a fix.
/**
 * First tokens that start a declaration, a block, or a type assertion when an
 * expression begins a statement, so a receiver starting with one needs
 * parentheses.
 */
const STATEMENT_START_TOKENS = new Set(["<", "async", "class", "function", "let", "{"]);

/** A character that joins an adjacent word, such as `return` and `set`. */
const WORD_CHARACTER = /[\w$]/u;

const EXPRESSION_END_PUNCTUATORS = new Set(["!", ")", "++", "--", ">", "]", "}"]);

type SourceCode = Readonly<TSESLint.SourceCode>;

/**
 * How the fix reaches an iterator from the materialized iterable.
 *
 * - `iterator`: the iterable is already an iterator with helpers; drop the copy.
 * - `method`: a built-in `Map` or `Set`; call the method a spread uses.
 * - `from`: anything else; wrap it in `Iterator.from`, which reads the same
 *   `[Symbol.iterator]` a spread reads.
 *
 * `builtin` is true when iterating runs no user code, so lazy iteration cannot
 * reorder anything the callbacks observe.
 */
interface Source {
	readonly builtin: boolean;
	readonly kind: "from" | "iterator" | "method";
	readonly method?: string;
}

interface Step {
	readonly name: string;
	readonly call: TSESTree.CallExpression;
}

/**
 * How safe one callback is to move from an eager array method to a lazy
 * iterator helper.
 *
 * - `safe`: an inline function with no visible effects.
 * - `unsafe`: the change could be observed; offer it as a suggestion.
 * - `blocked`: the change breaks the call; offer nothing.
 */
type Verdict = "blocked" | "safe" | "unsafe";

/**
 * Where the chain's result goes, which decides whether the fix must turn the
 * iterator back into an array.
 *
 * - `iterable`: consumed at once by something that takes any iterable.
 * - `loop`: a `for...of` head, whose body would run between the callbacks.
 * - `array`: anywhere else; the fix appends `.toArray()`.
 */
type Sink = "array" | "iterable" | "loop";

function hasTypeInformation(
	services: Partial<ParserServices> | undefined,
): services is ParserServicesWithTypeInformation {
	return services?.program !== undefined && services.program !== null;
}

/**
 * Whether a name resolves to the global binding rather than a local that
 * shadows it. A resolved variable with no declaration is a configured global.
 *
 * @param sourceCode - The source code of the linted file.
 * @param node - A node in the scope to resolve from.
 * @param name - The name to resolve, such as `Iterator`.
 * @returns True when `name` is the global at `node`.
 */
function isGlobalName(sourceCode: SourceCode, node: TSESTree.Node, name: string): boolean {
	const variable = findVariable(sourceCode.getScope(node), name);
	return variable === null || variable.defs.length === 0;
}

function isGlobalMember(
	sourceCode: SourceCode,
	callee: TSESTree.Node,
	objectName: string,
	propertyName: string,
): boolean {
	return (
		callee.type === AST_NODE_TYPES.MemberExpression &&
		!callee.computed &&
		!callee.optional &&
		callee.object.type === AST_NODE_TYPES.Identifier &&
		callee.object.name === objectName &&
		callee.property.type === AST_NODE_TYPES.Identifier &&
		callee.property.name === propertyName &&
		isGlobalName(sourceCode, callee.object, objectName)
	);
}

/**
 * The iterable a node copies into an array: `x` in `[...x]` or in
 * `Array.from(x)`. A second `Array.from` argument maps while copying, which is
 * out of scope.
 *
 * @param sourceCode - The source code of the linted file.
 * @param node - A candidate array literal or call.
 * @returns The copied iterable, or undefined when the node copies nothing.
 */
function getMaterializedIterable(
	sourceCode: SourceCode,
	node: TSESTree.ArrayExpression | TSESTree.CallExpression,
): TSESTree.Expression | undefined {
	if (node.type === AST_NODE_TYPES.ArrayExpression) {
		const [element] = node.elements;
		return node.elements.length === 1 && element?.type === AST_NODE_TYPES.SpreadElement
			? element.argument
			: undefined;
	}

	const [argument] = node.arguments;
	if (
		node.optional ||
		node.arguments.length !== 1 ||
		argument === undefined ||
		argument.type === AST_NODE_TYPES.SpreadElement
	) {
		return undefined;
	}

	return isGlobalMember(sourceCode, node.callee, "Array", "from") ? argument : undefined;
}

/**
 * The `filter`/`map` calls chained directly on a node, in call order.
 *
 * @param node - The materializing expression.
 * @returns The chained calls, and whether any link is optional.
 */
function collectSteps(node: TSESTree.Node): { optional: boolean; steps: Array<Step> } {
	const steps: Array<Step> = [];
	let optional = false;
	let receiver = node;
	for (;;) {
		const member = receiver.parent;
		if (
			member?.type !== AST_NODE_TYPES.MemberExpression ||
			member.object !== receiver ||
			member.computed ||
			member.property.type !== AST_NODE_TYPES.Identifier ||
			!CHAIN_METHODS.has(member.property.name)
		) {
			break;
		}

		const call = member.parent;
		if (call.type !== AST_NODE_TYPES.CallExpression || call.callee !== member) {
			break;
		}

		optional ||= member.optional || call.optional;
		steps.push({ name: member.property.name, call });
		receiver = call;
	}

	return { optional, steps };
}

function getTypeName(type: Type, program: Program): string | undefined {
	const symbol = type.getSymbol() ?? type.aliasSymbol;
	const declarations = symbol?.getDeclarations();
	if (symbol === undefined || declarations === undefined || declarations.length === 0) {
		return undefined;
	}

	// A declaration outside the default library means a user type, or a global
	// augmentation that may change how the type iterates.
	return declarations.every((declaration) => {
		return program.isSourceFileDefaultLibrary(declaration.getSourceFile());
	})
		? symbol.getName()
		: undefined;
}

function isIterable(type: Type, checker: TypeChecker): boolean {
	// Well-known symbol members are keyed `__@iterator@<id>`.
	return checker
		.getPropertiesOfType(checker.getApparentType(type))
		.some((property) => String(property.escapedName).startsWith("__@iterator@"));
}

function hasIteratorHelpers(type: Type, checker: TypeChecker): boolean {
	const apparent = checker.getApparentType(type);
	return HELPER_MEMBERS.every((name) => checker.getPropertyOfType(apparent, name) !== undefined);
}

const NON_ITERABLE_FLAGS =
	TypeFlags.Any |
	TypeFlags.Unknown |
	TypeFlags.Never |
	TypeFlags.Null |
	TypeFlags.Undefined |
	TypeFlags.Void |
	TypeFlags.StringLike |
	TypeFlags.TypeParameter;

/**
 * Classifies the type of the copied iterable, or rejects it.
 *
 * Every union member must be iterable, and at least one must not be an array:
 * copying an array only drops a copy, which is not what this rule is about.
 * Arrays may still appear in a union, so `[...(map ?? [])]` reports. Strings are
 * rejected: spreading one into characters is its own idiom.
 *
 * @param type - The type of the copied iterable.
 * @param checker - The checker that resolves the contextual type.
 * @param program - The program, to tell library types from user types.
 * @returns How to reach an iterator, or undefined when the rule does not apply.
 */
function classifySource(type: Type, checker: TypeChecker, program: Program): Source | undefined {
	const members = type.isUnion() ? type.types : [type];
	let hasNonArray = false;
	let builtin = true;
	for (const member of members) {
		if ((member.flags & NON_ITERABLE_FLAGS) !== 0) {
			return undefined;
		}

		if (checker.isArrayType(member) || checker.isTupleType(member)) {
			continue;
		}

		if (!isIterable(member, checker)) {
			return undefined;
		}

		hasNonArray = true;
		const name = getTypeName(member, program);
		builtin &&=
			name !== undefined &&
			(COLLECTION_METHODS.has(name) || BUILTIN_ITERATOR_NAMES.has(name));
	}

	if (!hasNonArray) {
		return undefined;
	}

	// A union of helper-bearing iterators has one overloaded `filter` per member,
	// which TypeScript cannot call, so unions go through `Iterator.from`.
	if (members.length === 1) {
		const name = getTypeName(type, program);
		const method = name === undefined ? undefined : COLLECTION_METHODS.get(name);
		if (method !== undefined) {
			return { builtin, kind: "method", method };
		}

		if (hasIteratorHelpers(type, checker)) {
			return { builtin, kind: "iterator" };
		}
	}

	return { builtin, kind: "from" };
}

/**
 * Whether a function reads its own `arguments`, whose length and third entry
 * differ between an array callback and an iterator helper callback.
 *
 * @param sourceCode - The source code of the linted file.
 * @param callback - The function expression.
 * @returns True when the function body references `arguments`.
 */
function readsArguments(sourceCode: SourceCode, callback: TSESTree.FunctionExpression): boolean {
	const variable = sourceCode.getScope(callback).set.get("arguments");
	return variable !== undefined && variable.references.length > 0;
}

function hasVisibleEffects(sourceCode: SourceCode, root: TSESTree.Node): boolean {
	const pending: Array<TSESTree.Node> = [root];
	for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
		if (EFFECT_NODE_TYPES.has(node.type)) {
			return true;
		}

		if (node.type === AST_NODE_TYPES.UnaryExpression && node.operator === "delete") {
			return true;
		}

		for (const key of sourceCode.visitorKeys[node.type] ?? []) {
			const child: unknown = node[key as keyof typeof node];
			const children: Array<unknown> = Array.isArray(child) ? child : [child];
			for (const entry of children) {
				if (typeof entry === "object" && entry !== null && "type" in entry) {
					pending.push(entry as TSESTree.Node);
				}
			}
		}
	}

	return false;
}

/**
 * Judges one `filter`/`map` call.
 *
 * An iterator helper takes one argument and passes its callback
 * `(value, counter)`. A `thisArg`, a third parameter (the array), a rest
 * parameter, or a read of `arguments` has no equivalent, so the change is
 * blocked. A function reference may read a third argument this rule cannot see,
 * so it is only suggested.
 *
 * @param sourceCode - The source code of the linted file.
 * @param call - The `filter` or `map` call.
 * @returns The verdict for this call.
 */
function judgeStep(sourceCode: SourceCode, call: TSESTree.CallExpression): Verdict {
	const [callback] = call.arguments;
	if (
		call.arguments.length !== 1 ||
		callback === undefined ||
		callback.type === AST_NODE_TYPES.SpreadElement
	) {
		return "blocked";
	}

	if (
		callback.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
		callback.type !== AST_NODE_TYPES.FunctionExpression
	) {
		return "unsafe";
	}

	if (
		callback.params.length > 2 ||
		callback.params.some((parameter) => parameter.type === AST_NODE_TYPES.RestElement)
	) {
		return "blocked";
	}

	if (
		callback.type === AST_NODE_TYPES.FunctionExpression &&
		readsArguments(sourceCode, callback)
	) {
		return "blocked";
	}

	// A parameter default runs on every call, like the body.
	const hasEffects = [...callback.params, callback.body].some((node) => {
		return hasVisibleEffects(sourceCode, node);
	});
	return hasEffects ? "unsafe" : "safe";
}

function isGlobalIdentifierIn(
	sourceCode: SourceCode,
	node: TSESTree.Node,
	names: ReadonlySet<string>,
): boolean {
	return (
		node.type === AST_NODE_TYPES.Identifier &&
		names.has(node.name) &&
		isGlobalName(sourceCode, node, node.name)
	);
}

function classifySink(sourceCode: SourceCode, last: TSESTree.CallExpression): Sink {
	const { parent } = last;
	if (parent.type === AST_NODE_TYPES.ForOfStatement) {
		return parent.right === last && !parent.await ? "loop" : "array";
	}

	if (parent.type === AST_NODE_TYPES.SpreadElement) {
		// An object spread copies own keys: an array has them, an iterator does
		// not.
		return parent.parent.type === AST_NODE_TYPES.ObjectExpression ? "array" : "iterable";
	}

	if (
		parent.type !== AST_NODE_TYPES.CallExpression &&
		parent.type !== AST_NODE_TYPES.NewExpression
	) {
		return "array";
	}

	if (parent.arguments.length !== 1 || parent.arguments[0] !== last) {
		return "array";
	}

	const takesIterable =
		parent.type === AST_NODE_TYPES.CallExpression
			? isGlobalMember(sourceCode, parent.callee, "Array", "from")
			: isGlobalIdentifierIn(sourceCode, parent.callee, ITERABLE_CONSTRUCTORS);
	return takesIterable ? "iterable" : "array";
}

function isExpressionEnd(token: TSESTree.Token): boolean {
	if (token.type === AST_TOKEN_TYPES.Punctuator) {
		return EXPRESSION_END_PUNCTUATORS.has(token.value);
	}

	if (token.type === AST_TOKEN_TYPES.Keyword) {
		return token.value === "this" || token.value === "super";
	}

	return EXPRESSION_END_TOKENS.has(token.type);
}

/**
 * The text that replaces the materializing expression, or undefined when no
 * replacement is safe to write.
 *
 * No replacement is written when a comment sits in the removed text, when
 * `Array.from` has type arguments the fix would drop, when `Iterator` is
 * shadowed, or when the new text would start with a `(` or `[` that could join
 * the previous line under automatic semicolon insertion. A space is added when
 * a keyword such as `return` touches the copy.
 *
 * @param sourceCode - The source code of the linted file.
 * @param copy - The `[...x]` or `Array.from(x)` expression.
 * @param iterable - The copied iterable `x`.
 * @param source - How to reach an iterator from `x`.
 * @returns The replacement text.
 */
function getReplacement(
	sourceCode: SourceCode,
	copy: TSESTree.Node,
	iterable: TSESTree.Expression,
	source: Source,
): string | undefined {
	const hasDroppedComment = sourceCode
		.getCommentsInside(copy)
		.some(
			(comment) =>
				comment.range[0] < iterable.range[0] || comment.range[1] > iterable.range[1],
		);
	if (hasDroppedComment) {
		return undefined;
	}

	if (copy.type === AST_NODE_TYPES.CallExpression && copy.typeArguments !== undefined) {
		return undefined;
	}

	const text = sourceCode.getText(iterable);
	let replacement: string;
	if (source.kind === "from") {
		if (!isGlobalName(sourceCode, copy, "Iterator")) {
			return undefined;
		}

		const argument = iterable.type === AST_NODE_TYPES.SequenceExpression ? `(${text})` : text;
		replacement = `Iterator.from(${argument})`;
	} else {
		const firstToken = sourceCode.getFirstToken(iterable);
		const isMemberSafe =
			MEMBER_SAFE_TYPES.has(iterable.type) &&
			(firstToken === null || !STATEMENT_START_TOKENS.has(firstToken.value));
		const receiver = isMemberSafe ? text : `(${text})`;
		replacement = source.kind === "method" ? `${receiver}.${source.method}()` : receiver;
	}

	const first = replacement.charAt(0);
	const previous = sourceCode.getTokenBefore(copy);
	if (previous === null) {
		return replacement;
	}

	if (
		(first === "(" || first === "[") &&
		first !== sourceCode.getText(copy).charAt(0) &&
		isExpressionEnd(previous)
	) {
		return undefined;
	}

	const touchesWord =
		previous.range[1] === copy.range[0] &&
		WORD_CHARACTER.test(previous.value.at(-1) ?? "") &&
		WORD_CHARACTER.test(first);
	return touchesWord ? ` ${replacement}` : replacement;
}

/**
 * Whether the checker infers the result of the last call from where it goes,
 * such as an annotated variable, a return, or a parameter.
 *
 * An eager `map` takes that contextual type into its generic result, so a
 * callback returning `[key, value]` infers a tuple. After `.toArray()` is
 * appended the context no longer reaches the helper `map`, which then infers an
 * array, and the fixed code can fail to type-check.
 *
 * @param services - The parser services with type information.
 * @param checker - The checker that resolves the contextual type.
 * @param end - The last call of the chain.
 * @returns True when the call has a contextual type other than `any` or `unknown`.
 */
function hasContextualType(
	services: ParserServicesWithTypeInformation,
	checker: TypeChecker,
	end: TSESTree.CallExpression,
): boolean {
	const contextual = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(end));
	return (
		contextual !== undefined && (contextual.flags & (TypeFlags.Any | TypeFlags.Unknown)) === 0
	);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let iteratorHelpers = DEFAULT_ITERATOR_HELPERS;
	let checker: TypeChecker | undefined;
	let program: Program | undefined;
	let services: ParserServicesWithTypeInformation | undefined;

	function check(node: TSESTree.ArrayExpression | TSESTree.CallExpression): void {
		if (checker === undefined || program === undefined || services === undefined) {
			return;
		}

		const { sourceCode } = context;
		const { optional, steps } = collectSteps(node);
		const last = steps.at(-1);
		if (last === undefined) {
			return;
		}

		const iterable = getMaterializedIterable(sourceCode, node);
		if (iterable === undefined) {
			return;
		}

		// The type lookup runs last: it is the only costly check.
		const source = classifySource(services.getTypeAtLocation(iterable), checker, program);
		if (source === undefined) {
			return;
		}

		const data = {
			chain: steps.map((step) => `.${step.name}()`).join(""),
			copy: node.type === AST_NODE_TYPES.ArrayExpression ? "[...]" : "Array.from()",
		};

		if (!iteratorHelpers) {
			context.report({ data, messageId: MESSAGE_ID_NO_HELPERS, node });
			return;
		}

		const verdicts = steps.map((step) => judgeStep(sourceCode, step.call));
		const replacement = optional
			? undefined
			: getReplacement(sourceCode, node, iterable, source);
		if (replacement === undefined || verdicts.includes("blocked")) {
			context.report({ data, messageId: MESSAGE_ID, node });
			return;
		}

		const text = replacement;
		const end = last.call;
		const sink = classifySink(sourceCode, end);
		function fix(fixer: TSESLint.RuleFixer): Array<TSESLint.RuleFix> {
			const fixes = [fixer.replaceText(node, text)];
			if (sink === "array") {
				fixes.push(fixer.insertTextAfter(end, ".toArray()"));
			}

			return fixes;
		}

		const isSafe =
			source.builtin &&
			sink !== "loop" &&
			verdicts.every((verdict) => verdict === "safe") &&
			(sink !== "array" || last.name !== "map" || !hasContextualType(services, checker, end));
		context.report({
			data,
			messageId: MESSAGE_ID,
			node,
			...(isSafe ? { fix } : { suggest: [{ fix, messageId: MESSAGE_ID_SUGGEST }] }),
		});
	}

	return {
		ArrayExpression: check,
		before(): boolean {
			const { options, sourceCode } = context;
			const { parserServices } = sourceCode;
			if (!hasTypeInformation(parserServices)) {
				return false;
			}

			services = parserServices;
			({ program } = parserServices);
			checker = program.getTypeChecker();
			iteratorHelpers = options[0]?.iteratorHelpers ?? DEFAULT_ITERATOR_HELPERS;
			return true;
		},
		CallExpression: check,
	};
}

export const noMaterializedFilterMap = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [DEFAULTS],
	meta: {
		defaultOptions: [DEFAULTS],
		docs: {
			description: "Disallow copying an iterable into an array only to `filter` or `map` it",
			recommended: false,
			requiresTypeChecking: true,
		},
		fixable: "code",
		hasSuggestions: true,
		messages,
		schema,
		type: "suggestion",
	},
});
