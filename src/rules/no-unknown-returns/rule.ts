import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { getParserServices } from "@typescript-eslint/utils/eslint-utils";

import type { Type, TypeNode } from "typescript";
import { TypeFlags } from "typescript";

import { createEslintRule } from "../../util";

export const RULE_NAME = "no-unknown-returns";

type MessageIds = "unknownCallbackReturn" | "unknownReturn";
type Options = [];

const messages = {
	unknownCallbackReturn:
		"This callback returns `unknown` to the code that calls it. Narrow the return to the domain type this code needs, or `void` if the result is unused.",
	unknownReturn:
		"This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
};

/** Every construct that can carry an explicit return type annotation. */
type FunctionWithReturnType =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression
	| TSESTree.TSCallSignatureDeclaration
	| TSESTree.TSConstructorType
	| TSESTree.TSConstructSignatureDeclaration
	| TSESTree.TSDeclareFunction
	| TSESTree.TSEmptyBodyFunctionExpression
	| TSESTree.TSFunctionType
	| TSESTree.TSMethodSignature;

/**
 * Which way the `unknown` travels, which decides the wording of the report.
 *
 * A `TSFunctionType` is the only form that types a function *value* supplied by
 * someone else — as a parameter, a property, an alias, or a type argument. Its
 * return flows back into the code holding the type, so that code is told to
 * narrow what it asks for. Every other form declares a contract this code (or
 * its implementer) fulfils, handing the value out to a caller instead.
 *
 * @param node - The function whose return annotation reported.
 * @returns The message id matching the direction of the value.
 */
function messageIdFor(node: FunctionWithReturnType): MessageIds {
	return node.type === AST_NODE_TYPES.TSFunctionType ? "unknownCallbackReturn" : "unknownReturn";
}

function create(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const services = getParserServices(context, true);
	if (!services.program) {
		return {};
	}

	const checker = services.program.getTypeChecker();

	/**
	 * Resolves an annotation to the type a caller actually receives: aliases
	 * (including generic ones and ones imported from another file) collapsed by
	 * the checker, then the promise wrapper stripped.
	 *
	 * `getAwaitedType` unwraps nested promises and is a no-op on everything
	 * else, so it needs no guard of its own. It returns `undefined` for a type
	 * with no awaited form, in which case the declared type stands.
	 *
	 * @param annotation - The explicit return type annotation.
	 * @returns The awaited type behind the annotation.
	 */
	function resolveReturnType(annotation: TSESTree.TSTypeAnnotation): Type {
		// The map's declared result for a `TypeNode` widens to plain `Identifier`
		// for the reference case, so the cast restates what it returns at
		// runtime: the TypeScript node behind this type annotation.
		const typeNode = services.esTreeNodeToTSNodeMap.get(annotation.typeAnnotation) as TypeNode;
		const declared = checker.getTypeFromTypeNode(typeNode);
		return checker.getAwaitedType(declared) ?? declared;
	}

	function checkReturnType(node: FunctionWithReturnType): void {
		// An inferred return is out of scope: the rule is about a declared
		// contract. Reading the signature's return type instead would catch
		// inferred `unknown` too, which is noisier and harder to act on.
		const annotation = node.returnType;
		if (annotation === undefined) {
			return;
		}

		// `any` is a separate problem with a different fix, so the flag is
		// tested rather than the type's assignability.
		if ((resolveReturnType(annotation).flags & TypeFlags.Unknown) === 0) {
			return;
		}

		context.report({
			messageId: messageIdFor(node),
			node: annotation.typeAnnotation,
		});
	}

	return {
		ArrowFunctionExpression: checkReturnType,
		FunctionDeclaration: checkReturnType,
		FunctionExpression: checkReturnType,
		TSCallSignatureDeclaration: checkReturnType,
		TSConstructorType: checkReturnType,
		TSConstructSignatureDeclaration: checkReturnType,
		TSDeclareFunction: checkReturnType,
		TSEmptyBodyFunctionExpression: checkReturnType,
		TSFunctionType: checkReturnType,
		TSMethodSignature: checkReturnType,
	};
}

export const noUnknownReturns = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow explicit return type annotations that resolve to `unknown`",
			recommended: false,
			requiresTypeChecking: true,
		},
		fixable: undefined,
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
