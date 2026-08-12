import { parse } from "@typescript-eslint/parser";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import { expect, it } from "vitest";

import { run } from "../test";
import { isTypeNode, noUnsafeDictionaryType, RULE_NAME } from "./rule";

const messageId = "unsafeDictionary";

it("recognizes only actual TypeScript type nodes", () => {
	const program = parse(
		"type Values = { [key: string]: unknown }; interface Owner { value: unknown }",
	);
	const [aliasDeclaration, interfaceDeclaration] = program.body;
	if (
		aliasDeclaration?.type !== AST_NODE_TYPES.TSTypeAliasDeclaration ||
		aliasDeclaration.typeAnnotation.type !== AST_NODE_TYPES.TSTypeLiteral ||
		interfaceDeclaration?.type !== AST_NODE_TYPES.TSInterfaceDeclaration
	) {
		throw new Error("The regression fixture did not produce the expected TypeScript AST");
	}

	const [indexSignature] = aliasDeclaration.typeAnnotation.members;
	const [propertySignature] = interfaceDeclaration.body.body;
	if (
		indexSignature?.type !== AST_NODE_TYPES.TSIndexSignature ||
		indexSignature.typeAnnotation === undefined ||
		propertySignature?.type !== AST_NODE_TYPES.TSPropertySignature
	) {
		throw new Error("The regression fixture did not produce the expected type members");
	}

	expect(
		[aliasDeclaration, indexSignature, interfaceDeclaration.body, propertySignature].map(
			isTypeNode,
		),
	).toEqual([false, false, false, false]);
	expect(isTypeNode(indexSignature.typeAnnotation.typeAnnotation)).toBe(true);
});

const valid: Array<ValidTestCase> = [
	unindent`
		type Names = Record<string, string>;
	`,
	unindent`
		type Counts = { [name: string]: number };
	`,
	unindent`
		type Flags<Key extends string> = { [Property in Key]: boolean };
	`,
	unindent`
		interface Value { id: string }
		type Values = Readonly<Record<string, Value>>;
	`,
	unindent`
		type Marker = { optional? };
		type Values = Record<string, Marker>;
	`,
	unindent`
		type Source = Record<string, string>;
		type Selected = Pick<Source, "name">;
		type Remaining = Omit<Source, "name">;
	`,
	unindent`
		type Result = unknown;
		type Metadata = object;
	`,
	unindent`
		interface Empty {}
		interface Empty { optional?: never }
		type Values = Record<string, Empty>;
	`,
	unindent`
		type Record<Key, Value> = Map<Key, Value>;
		type Values = Record<string, unknown>;
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: "type Values = Record<string, unknown>;",
		errors: [{ messageId }],
	},
	{
		code: "type Values = Record<string, any>;",
		errors: [{ messageId }],
	},
	{
		code: "type Values = Record<string, object>;",
		errors: [{ messageId }],
	},
	{
		code: "type Values = Record<string, {}>;",
		errors: [{ messageId }],
	},
	{
		code: "type Values = Record<string, string | unknown>;",
		errors: [{ messageId }],
	},
	{
		code: "type Values = { [key: string]: unknown };",
		errors: [{ messageId }],
	},
	{
		code: "interface Values { [key: string]: object }",
		errors: [{ messageId }],
	},
	{
		code: "type Values<Key extends string> = { [Property in Key]: any };",
		errors: [{ messageId }],
	},
	{
		code: unindent`
			type Dictionary<Value> = Record<string, Value>;
			type Values = Dictionary<unknown>;
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			type Unsafe = unknown;
			type Values = Partial<Record<string, Unsafe>>;
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			export type Unsafe = Record<string, unknown>;
			declare const values: Unsafe;
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			interface Empty { optional?: never }
			type Values = Record<string, Empty>;
		`,
		errors: [{ messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noUnsafeDictionaryType,
	valid,
});
