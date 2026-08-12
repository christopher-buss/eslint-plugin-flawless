import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noUnsafeDictionaryType, RULE_NAME } from "./rule";

const messageId = "unsafeDictionary";

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
