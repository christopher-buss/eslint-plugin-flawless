import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import {
	classifyUnsafeDictionary,
	classifyUnsafeDictionaryValue,
	createTypeEnvironment,
	type TypeEnvironment,
	typeReferenceName,
} from "./dictionary-types";

export const RULE_NAME = "no-unsafe-dictionary-type";

const MESSAGE_ID = "unsafeDictionary";

export type MessageIds = typeof MESSAGE_ID;

type Options = [];

const messages = {
	[MESSAGE_ID]:
		"This object dictionary's direct value type is an unsafe {{value}} escape hatch. Replace it with a concrete owner/schema-derived value type and parse external data at its boundary.",
};

const TYPE_NODE_TYPES = {
	[AST_NODE_TYPES.TSAbstractKeyword]: true,
	[AST_NODE_TYPES.TSAnyKeyword]: true,
	[AST_NODE_TYPES.TSArrayType]: true,
	[AST_NODE_TYPES.TSAsyncKeyword]: true,
	[AST_NODE_TYPES.TSBigIntKeyword]: true,
	[AST_NODE_TYPES.TSBooleanKeyword]: true,
	[AST_NODE_TYPES.TSConditionalType]: true,
	[AST_NODE_TYPES.TSConstructorType]: true,
	[AST_NODE_TYPES.TSDeclareKeyword]: true,
	[AST_NODE_TYPES.TSExportKeyword]: true,
	[AST_NODE_TYPES.TSFunctionType]: true,
	[AST_NODE_TYPES.TSImportType]: true,
	[AST_NODE_TYPES.TSIndexedAccessType]: true,
	[AST_NODE_TYPES.TSInferType]: true,
	[AST_NODE_TYPES.TSIntersectionType]: true,
	[AST_NODE_TYPES.TSIntrinsicKeyword]: true,
	[AST_NODE_TYPES.TSLiteralType]: true,
	[AST_NODE_TYPES.TSMappedType]: true,
	[AST_NODE_TYPES.TSNamedTupleMember]: true,
	[AST_NODE_TYPES.TSNeverKeyword]: true,
	[AST_NODE_TYPES.TSNullKeyword]: true,
	[AST_NODE_TYPES.TSNumberKeyword]: true,
	[AST_NODE_TYPES.TSObjectKeyword]: true,
	[AST_NODE_TYPES.TSOptionalType]: true,
	[AST_NODE_TYPES.TSPrivateKeyword]: true,
	[AST_NODE_TYPES.TSProtectedKeyword]: true,
	[AST_NODE_TYPES.TSPublicKeyword]: true,
	[AST_NODE_TYPES.TSQualifiedName]: true,
	[AST_NODE_TYPES.TSReadonlyKeyword]: true,
	[AST_NODE_TYPES.TSRestType]: true,
	[AST_NODE_TYPES.TSStaticKeyword]: true,
	[AST_NODE_TYPES.TSStringKeyword]: true,
	[AST_NODE_TYPES.TSSymbolKeyword]: true,
	[AST_NODE_TYPES.TSTemplateLiteralType]: true,
	[AST_NODE_TYPES.TSThisType]: true,
	[AST_NODE_TYPES.TSTupleType]: true,
	[AST_NODE_TYPES.TSTypeLiteral]: true,
	[AST_NODE_TYPES.TSTypeOperator]: true,
	[AST_NODE_TYPES.TSTypePredicate]: true,
	[AST_NODE_TYPES.TSTypeQuery]: true,
	[AST_NODE_TYPES.TSTypeReference]: true,
	[AST_NODE_TYPES.TSUndefinedKeyword]: true,
	[AST_NODE_TYPES.TSUnionType]: true,
	[AST_NODE_TYPES.TSUnknownKeyword]: true,
	[AST_NODE_TYPES.TSVoidKeyword]: true,
} satisfies Record<TSESTree.TypeNode["type"], true>;

export function isTypeNode(node: TSESTree.Node): node is TSESTree.TypeNode {
	return Object.hasOwn(TYPE_NODE_TYPES, node.type);
}

function isInsideTypeAliasDeclaration(node: TSESTree.Node): boolean {
	let current = node.parent;
	while (current !== undefined && current.type !== AST_NODE_TYPES.Program) {
		if (current.type === AST_NODE_TYPES.TSTypeAliasDeclaration) {
			return true;
		}

		current = current.parent;
	}

	return false;
}

function isPlainAliasConsumerUse(node: TSESTree.TypeNode, environment: TypeEnvironment): boolean {
	if (
		node.type !== AST_NODE_TYPES.TSTypeReference ||
		(node.typeArguments?.params.length ?? 0) > 0
	) {
		return false;
	}

	const name = typeReferenceName(node);
	return name !== null && environment.aliases.has(name) && !isInsideTypeAliasDeclaration(node);
}

function shouldReportType(node: TSESTree.TypeNode, environment: TypeEnvironment): boolean {
	if (isPlainAliasConsumerUse(node, environment)) {
		return false;
	}

	if (classifyUnsafeDictionary(node, environment) === null) {
		return false;
	}

	let current = node.parent;
	while (current.type !== AST_NODE_TYPES.Program) {
		if (isTypeNode(current) && classifyUnsafeDictionary(current, environment) !== null) {
			return false;
		}

		current = current.parent;
	}

	return true;
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let environment: null | TypeEnvironment = null;
	function reportIfUnsafe(node: TSESTree.TypeNode): void {
		if (environment === null || !shouldReportType(node, environment)) {
			return;
		}

		const unsafe = classifyUnsafeDictionary(node, environment);
		if (unsafe !== null) {
			context.report({
				data: { value: unsafe.unsafeValue },
				messageId: MESSAGE_ID,
				node,
			});
		}
	}

	return {
		Program(node: TSESTree.Program): void {
			environment = createTypeEnvironment(node);
		},
		TSIndexSignature(node: TSESTree.TSIndexSignature): void {
			const valueType = node.typeAnnotation?.typeAnnotation;
			if (
				environment === null ||
				valueType === undefined ||
				node.parent.type === AST_NODE_TYPES.TSTypeLiteral
			) {
				return;
			}

			const unsafe = classifyUnsafeDictionaryValue(valueType, environment);
			if (unsafe !== null) {
				context.report({
					data: { value: unsafe.unsafeValue },
					messageId: MESSAGE_ID,
					node,
				});
			}
		},
		TSMappedType: reportIfUnsafe,
		TSTypeLiteral: reportIfUnsafe,
		TSTypeReference: reportIfUnsafe,
	};
}

export const noUnsafeDictionaryType = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow unsafe object dictionary value types",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: undefined,
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
