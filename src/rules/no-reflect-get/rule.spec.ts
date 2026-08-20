import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noReflectGet, RULE_NAME } from "./rule";

const messageId = "reflectGet";

const valid: Array<ValidTestCase> = [
	unindent`
		export const tag = value.tag;
	`,
	// The receiver rebinds `this` for a getter, so a Proxy trap has no
	// property-access equivalent to move to.
	unindent`
		export const handler = {
			get(target, key, receiver) {
				return Reflect.get(target, key, receiver);
			},
		};
	`,
	unindent`
		const Reflect = { get: (a, b) => b };
		export const value = Reflect.get(a, b);
	`,
	unindent`
		function read(Reflect) {
			return Reflect.get(a, b);
		}
	`,
	unindent`
		export const present = Reflect.has(o, k);
	`,
	unindent`
		export const keys = Reflect.ownKeys(o);
	`,
	unindent`
		export const value = Reflect.get(...args);
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			export function isBlock(value: unknown): boolean {
				return Reflect.get(value, "tag") === "block";
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			export function readField(err: unknown, key: string): string | undefined {
				const value = Reflect.get(err, key);
				return typeof value === "string" ? value : undefined;
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			declare const raw: Record<string, unknown>;

			export const name = Reflect.get(raw, "name");
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			export const value = Reflect["get"](o, k);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			export const values = [Reflect.get(o, "a"), Reflect.get(o, "b")];
		`,
		errors: [{ messageId }, { messageId }],
		output: null,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noReflectGet,
	valid,
});
