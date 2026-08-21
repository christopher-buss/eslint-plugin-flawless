import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noObjectParameters, RULE_NAME } from "./rule";

const messageId = "objectParameter";

const valid: Array<ValidTestCase> = [
	unindent`
		interface User { id: string }
		function greet(user: User): string {
			return user.id;
		}
	`,
	unindent`
		function count(values: Record<string, string>): number {
			return Object.keys(values).length;
		}
	`,
	unindent`
		function decode(payload: unknown): void {}
	`,
	unindent`
		function shape(value: { retries: number }): void {}
	`,
	unindent`
		function mixed(value: { id: string; [key: string]: unknown }): void {}
	`,
	unindent`
		function lookup(values: { [key: string]: string }): void {}
	`,
	unindent`
		function untyped(value): void {}
	`,
	// Every un-annotated parameter shape: an absent annotation is spelled
	// `null` by oxlint and `undefined` by typescript-eslint.
	unindent`
		function untyped({ id }, [first], ...rest): void {}
	`,
	unindent`
		function untyped(value = {}): void {}
	`,
	unindent`
		class Handler {
			constructor(private readonly payload) {}
		}
	`,
	unindent`
		function collect(...values: Array<object>): void {}
	`,
	unindent`
		type Options = { retries: number };
		function retry(options: Options): void {}
	`,
	unindent`
		type Wrapper<Value> = object;
		function wrap(value: Wrapper<string>): void {}
	`,
	unindent`
		type First = Second;
		type Second = First;
		function cycle(value: First): void {}
	`,
	// A nearer alias shadows the outer one.
	unindent`
		type Payload = object;
		function outer(): void {
			type Payload = { id: string };
			const inner = (payload: Payload): void => {};
		}
	`,
	// So does a nearer declaration that is not an alias at all.
	unindent`
		type Payload = object;
		function outer(): void {
			interface Payload { id: string }
			const inner = (payload: Payload): void => {};
		}
	`,
	unindent`
		type Payload = object;
		function outer(): void {
			class Payload { public id = ""; }
			const inner = (payload: Payload): void => {};
		}
	`,
	// An imported type cannot be resolved syntactically, so it is left alone.
	unindent`
		import type { Payload } from "./payload";
		function handle(payload: Payload): void {}
	`,
	// A local alias of \`Record\` is resolved instead of the built-in.
	unindent`
		type Record<Key, Value> = Map<Key, Value>;
		function collect(values: Record<string, unknown>): void {}
	`,
	unindent`
		const settings: object = {};
	`,
	unindent`
		function build(): object {
			return {};
		}
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: "function handle(payload: object): void {}",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "const handle = (payload: object): void => {};",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "const handle = function (payload: object): void {};",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "function handle(payload: object = {}): void {}",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "function handle(payload: object | string): void {}",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "function handle({ retries }: object): void {}",
		errors: [{ data: { parameter: "{ retries }", type: "object" }, messageId }],
	},
	{
		code: "function handle(first: object, second: object): void {}",
		errors: [
			{ data: { parameter: "first", type: "object" }, messageId },
			{ data: { parameter: "second", type: "object" }, messageId },
		],
	},
	{
		code: "function handle(payload: {}): void {}",
		errors: [{ data: { parameter: "payload", type: "{}" }, messageId }],
	},
	{
		code: "function handle(values: Record<string, unknown>): void {}",
		errors: [{ data: { parameter: "values", type: "Record<string, unknown>" }, messageId }],
	},
	{
		code: "function handle(values: Record<string, any>): void {}",
		errors: [{ data: { parameter: "values", type: "Record<string, any>" }, messageId }],
	},
	{
		code: "function handle(values: { [key: string]: unknown }): void {}",
		errors: [
			{
				data: { parameter: "values", type: "{ [key: string]: unknown }" },
				messageId,
			},
		],
	},
	{
		code: "declare function handle(payload: object): void;",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "type Handler = (payload: object) => void;",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "type Factory = new (payload: object) => unknown;",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "interface Handler { handle(payload: object): void }",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "interface Handler { (payload: object): void }",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: "interface Factory { new (payload: object): Factory }",
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			class Handler {
				public handle(payload: object): void {}
			}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			abstract class Handler {
				public abstract handle(payload: object): void;
			}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			class Handler {
				constructor(private readonly payload: object) {}
			}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			type Payload = object;
			function handle(payload: Payload): void {}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			type Payload = object;
			type Alias = Payload;
			function handle(payload: Alias): void {}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			export type Payload = object;
			export function handle(payload: Payload): void {}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			type Payload = string | object;
			function handle(payload: Payload): void {}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			type Payload = Record<string, unknown>;
			function handle(payload: Payload): void {}
		`,
		errors: [{ data: { parameter: "payload", type: "Record<string, unknown>" }, messageId }],
	},
	// Aliases are resolved in the scope that declares them.
	{
		code: unindent`
			function outer(): void {
				type Local = object;
				const inner = (payload: Local): void => {};
			}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	// Type aliases hoist, so a later declaration still resolves.
	{
		code: unindent`
			function outer(): void {
				const inner = (payload: Local): void => {};
				type Local = object;
			}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	{
		code: unindent`
			namespace Api {
				type Payload = object;
				export function handle(payload: Payload): void {}
			}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
	// The outer alias is used when the inner scope declares nothing.
	{
		code: unindent`
			type Payload = object;
			function outer(): void {
				const inner = (payload: Payload): void => {};
			}
		`,
		errors: [{ data: { parameter: "payload", type: "object" }, messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noObjectParameters,
	valid,
});
