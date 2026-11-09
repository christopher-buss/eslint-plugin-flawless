import type {
	ParserServices,
	ParserServicesWithTypeInformation,
	TSESLint,
	TSESTree,
} from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type { Type, TypeChecker } from "typescript";
import { SyntaxKind, TypeFlags } from "typescript";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-ignored-return";

const IGNORED_MESSAGE_ID = "ignoredReturn";
const MAP_MESSAGE_ID = "ignoredMap";

export type MessageIds = typeof IGNORED_MESSAGE_ID | typeof MAP_MESSAGE_ID;

type Options = [];

const messages = {
	[IGNORED_MESSAGE_ID]:
		"`{{methodName}}` has no side effects, so this call does nothing. Use its result or remove the call.",
	[MAP_MESSAGE_ID]:
		"The array that `map` returns is discarded. Use `forEach` to iterate for side effects.",
};

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

/** Built-in methods that return a value and change nothing, by receiver kind. */
const PURE_METHODS = {
	array: new Set([
		"concat",
		"entries",
		"filter",
		"find",
		"findIndex",
		"findLast",
		"findLastIndex",
		"includes",
		"indexOf",
		"join",
		"keys",
		"lastIndexOf",
		"map",
		"reduce",
		"reduceRight",
		"slice",
		"toLocaleString",
		"toString",
		"values",
	]),
	date: new Set([
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
	math: new Set([
		"abs",
		"acos",
		"acosh",
		"asin",
		"asinh",
		"atan",
		"atan2",
		"atanh",
		"cbrt",
		"ceil",
		"clz32",
		"cos",
		"cosh",
		"exp",
		"expm1",
		"f16round",
		"floor",
		"fround",
		"hypot",
		"imul",
		"log",
		"log1p",
		"log2",
		"log10",
		"max",
		"min",
		"pow",
		"random",
		"round",
		"sign",
		"sin",
		"sinh",
		"sqrt",
		"tan",
		"tanh",
		"trunc",
	]),
	number: new Set(["toExponential", "toFixed", "toLocaleString", "toPrecision", "toString"]),
	regexp: new Set(["test", "toString"]),
	string: new Set([
		"anchor",
		"big",
		"blink",
		"bold",
		"charAt",
		"charCodeAt",
		"codePointAt",
		"concat",
		"endsWith",
		"fixed",
		"fontcolor",
		"fontsize",
		"includes",
		"indexOf",
		"italics",
		"lastIndexOf",
		"link",
		"localeCompare",
		"match",
		"normalize",
		"padEnd",
		"padStart",
		"repeat",
		"replace",
		"search",
		"slice",
		"small",
		"split",
		"startsWith",
		"strike",
		"sub",
		"substr",
		"substring",
		"sup",
		"toLocaleLowerCase",
		"toLocaleUpperCase",
		"toLowerCase",
		"toString",
		"toUpperCase",
		"trim",
		"valueOf",
	]),
} as const;

type Category = keyof typeof PURE_METHODS;

const ANY_PURE_METHOD: ReadonlySet<string> = new Set(
	Object.values(PURE_METHODS).flatMap((methods) => [...methods]),
);

const FIND_METHODS = new Set(["find", "findIndex", "findLast", "findLastIndex"]);

const SYMBOL_CATEGORIES: ReadonlyMap<string, Category> = new Map([
	["Array", "array"],
	["Date", "date"],
	["Math", "math"],
	["RegExp", "regexp"],
]);

function hasTypeInformation(
	services: Partial<ParserServices> | undefined,
): services is ParserServicesWithTypeInformation {
	return services?.program !== undefined && services.program !== null;
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
 * @param checker - The type checker.
 * @param type - The type of the receiver.
 * @returns The receiver kind, or undefined when no table applies.
 */
function getCategory(checker: TypeChecker, type: Type): Category | undefined {
	const base = checker.getBaseTypeOfLiteralType(type);
	if ((base.flags & TypeFlags.String) !== 0) {
		return "string";
	}

	if ((base.flags & TypeFlags.Number) !== 0) {
		return "number";
	}

	const name = type.getSymbol()?.getName();
	return name === undefined ? undefined : SYMBOL_CATEGORIES.get(name);
}

/**
 * Whether `replace` gets a replacer function. A callback can do work, so the
 * call is not pure. Only a type that prints as one function type counts.
 *
 * @param services - The parser services.
 * @param node - The `replace` call.
 * @returns True when the second argument is a function.
 */
function isReplaceWithCallback(
	services: ParserServicesWithTypeInformation,
	node: TSESTree.CallExpression,
): boolean {
	const replacer = node.arguments[1];
	if (replacer === undefined) {
		return false;
	}

	const type = services.getTypeAtLocation(replacer);
	const typeNode = services.program.getTypeChecker().typeToTypeNode(type, undefined, undefined);
	return typeNode?.kind === SyntaxKind.FunctionType;
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

/**
 * Whether a subtree has an assignment outside of nested functions.
 *
 * @param node - The subtree root.
 * @param visitorKeys - The child keys for each node type.
 * @returns True when an assignment is found.
 */
function hasAssignment(node: TSESTree.Node, visitorKeys: TSESLint.SourceCode.VisitorKeys): boolean {
	// A nested function runs later, if at all, so its writes do not count. The
	// check is on the node itself, so a callback that returns a function stops
	// here too.
	if (isFunctionNode(node)) {
		return false;
	}

	if (node.type === AST_NODE_TYPES.AssignmentExpression) {
		return true;
	}

	for (const key of visitorKeys[node.type] ?? []) {
		const value: unknown = node[key as keyof typeof node];
		const children = Array.isArray(value) ? value : [value];
		for (const child of children) {
			if (isNode(child) && hasAssignment(child, visitorKeys)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Whether a `find`-style call uses its callback to write state, as a loop with
 * an early exit. The callback must be inline.
 *
 * @param node - The call.
 * @param visitorKeys - The child keys for each node type.
 * @returns True when the inline callback body assigns.
 */
function isFindWithAssignment(
	node: TSESTree.CallExpression,
	visitorKeys: TSESLint.SourceCode.VisitorKeys,
): boolean {
	const [callback] = node.arguments;
	if (
		callback?.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
		callback?.type !== AST_NODE_TYPES.FunctionExpression
	) {
		return false;
	}

	return hasAssignment(callback.body, visitorKeys);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		CallExpression(node: TSESTree.CallExpression): void {
			if (node.parent.type !== AST_NODE_TYPES.ExpressionStatement) {
				return;
			}

			const { callee } = node;
			if (callee.type !== AST_NODE_TYPES.MemberExpression) {
				return;
			}

			// The name check runs before any type work: most calls in real code
			// name no table method, and the type lookup is the costly part.
			const { object } = callee;
			const methodName = getMethodName(callee);
			if (methodName === undefined || !ANY_PURE_METHOD.has(methodName)) {
				return;
			}

			const { parserServices, visitorKeys } = context.sourceCode;
			if (!hasTypeInformation(parserServices)) {
				return;
			}

			const checker = parserServices.program.getTypeChecker();
			const category = getCategory(checker, parserServices.getTypeAtLocation(object));
			if (category === undefined || !PURE_METHODS[category].has(methodName)) {
				return;
			}

			if (methodName === "replace" && isReplaceWithCallback(parserServices, node)) {
				return;
			}

			if (FIND_METHODS.has(methodName) && isFindWithAssignment(node, visitorKeys)) {
				return;
			}

			context.report({
				data: { methodName },
				messageId: methodName === "map" ? MAP_MESSAGE_ID : IGNORED_MESSAGE_ID,
				node,
			});
		},
	};
}

export const noIgnoredReturn: FlawlessRuleModule<Options, MessageIds> = createFlawlessRule<
	Options,
	MessageIds
>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Disallow ignoring the result of a built-in method that has no side effects",
			recommended: false,
			requiresTypeChecking: true,
		},
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
