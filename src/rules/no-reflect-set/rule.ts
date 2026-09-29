import type {
	ParserServices,
	ParserServicesWithTypeInformation,
	TSESTree,
} from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type { Type } from "typescript";
import { TypeFlags } from "typescript";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import { isGlobalReflectMethodCall } from "../shared/reflect-method";

export const RULE_NAME = "no-reflect-set";

const MESSAGE_ID = "reflectSet";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Replace `Reflect.set` with a plain assignment. Declare the field on the target type, or use a test helper such as shoehorn's `fromAny` when the value deliberately violates it.",
};

/**
 * Whether an argument spells its key out in the source, so a plain assignment
 * can spell the same key.
 *
 * A template literal only qualifies while it holds no expressions; with one it
 * is as dynamic as an identifier.
 *
 * @param argument - The key argument of the call, or undefined when absent.
 * @returns True when the key is a string, number, or expressionless template.
 */
function isLiteralKey(argument: TSESTree.CallExpressionArgument | undefined): boolean {
	if (argument === undefined) {
		return false;
	}

	if (argument.type === AST_NODE_TYPES.TemplateLiteral) {
		return argument.expressions.length === 0;
	}

	if (argument.type !== AST_NODE_TYPES.Literal) {
		return false;
	}

	return typeof argument.value === "number" || typeof argument.value === "string";
}

const FIXED_KEY_FLAGS =
	TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.UniqueESSymbol;

/**
 * Whether a key type pins the key down at compile time.
 *
 * A union qualifies only when every member does: `"a" | "b"` names two
 * declarable fields, while `string` or `PropertyKey` names none. A template
 * literal type with holes carries `TemplateLiteral`, not `StringLiteral`, so it
 * stays clean; one with no holes is already a string literal type.
 *
 * @param type - The checker type of the key argument.
 * @returns True when the key is a literal or `unique symbol` type.
 */
function isFixedKeyType(type: Type): boolean {
	if (type.isUnion()) {
		return type.types.every(isFixedKeyType);
	}

	return (type.flags & FIXED_KEY_FLAGS) !== 0;
}

function hasTypeInformation(
	services: Partial<ParserServices> | undefined,
): services is ParserServicesWithTypeInformation {
	return services?.program !== undefined && services.program !== null;
}

/**
 * Whether the key's type is fixed at compile time. Without type information
 * (oxlint, or a file outside the program) nothing is known, so it is false.
 *
 * @param context - The rule context.
 * @param key - The key argument.
 * @returns True when the checker proves the key fixed.
 */
function hasFixedKeyType(
	context: FlawlessRuleContext<MessageIds, Options>,
	key: TSESTree.CallExpressionArgument,
): boolean {
	const { parserServices } = context.sourceCode;
	if (!hasTypeInformation(parserServices)) {
		return false;
	}

	return isFixedKeyType(parserServices.getTypeAtLocation(key));
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		CallExpression(node: TSESTree.CallExpression): void {
			// The four-argument form takes a receiver, which a plain assignment
			// cannot rebind.
			if (node.arguments.length !== 3) {
				return;
			}

			const [, key] = node.arguments;
			if (key === undefined) {
				return;
			}

			if (!isGlobalReflectMethodCall(context.sourceCode, node.callee, "set")) {
				return;
			}

			// The type lookup runs last: it is the only costly check.
			if (!isLiteralKey(key) && !hasFixedKeyType(context, key)) {
				return;
			}

			context.report({ messageId: MESSAGE_ID, node });
		},
	};
}

export const noReflectSet = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Disallow `Reflect.set` with a compile-time-fixed key in favour of a plain assignment",
			recommended: false,
			requiresTypeChecking: true,
		},
		fixable: undefined,
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
