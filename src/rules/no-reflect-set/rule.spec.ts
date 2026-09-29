import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noReflectSet, RULE_NAME } from "./rule";

const messageId = "reflectSet";

const valid: Array<ValidTestCase> = [
	unindent`
		target.timing = true;
	`,
	// A filtered key-copy loop is the honest dynamic case: no literal key to
	// declare, and no disable comment needed.
	unindent`
		export function copyAllowed(source, destination, allowed) {
			for (const [key, value] of Object.entries(source)) {
				if (allowed.has(key)) {
					Reflect.set(destination, key, value);
				}
			}
		}
	`,
	unindent`
		export const written = Reflect.set(target, key, value);
	`,
	unindent`
		export const written = Reflect.set(target, computeKey(), value);
	`,
	unindent`
		export const written = Reflect.set(target, key, value, receiver);
	`,
	unindent`
		export const written = Reflect.set(target, \`prefix\${suffix}\`, value);
	`,
	unindent`
		const Reflect = { set: (a, b, c) => true };
		export const written = Reflect.set(target, "key", value);
	`,
	unindent`
		export const present = Reflect.has(target, "key");
	`,
	unindent`
		export function write(target: object, key: string, value: unknown): boolean {
			return Reflect.set(target, key, value);
		}
	`,
	unindent`
		export function write(target: object, key: symbol, value: unknown): boolean {
			return Reflect.set(target, key, value);
		}
	`,
	unindent`
		export function copyAllowed(
			source: Record<string, unknown>,
			destination: object,
			allowed: ReadonlySet<string>,
		): void {
			for (const [key, value] of Object.entries(source)) {
				if (allowed.has(key)) {
					Reflect.set(destination, key, value);
				}
			}
		}
	`,
	unindent`
		export function write(target: object, key: PropertyKey, value: unknown): boolean {
			return Reflect.set(target, key, value);
		}
	`,
	unindent`
		export function write(target: object, key: "a" | string, value: unknown): boolean {
			return Reflect.set(target, key, value);
		}
	`,
	unindent`
		export function write(target: object, suffix: string, value: unknown): boolean {
			const key = \`prefix\${suffix}\` as const;
			return Reflect.set(target, key, value);
		}
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			export function stamp(argv: object): void {
				Reflect.set(argv, "_timing", true);
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			it("reads a project list", () => {
				Reflect.set(config, "projects", value);
			});
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			export const written = Reflect.set(o, 0, v);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			export const written = Reflect.set(o, \`_coverage\`, v);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			export const written = Reflect["set"](o, "key", v);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const key = "_coverage";
			export const written = Reflect.set(payload, key, report);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const BRAND = Symbol();
			export const written = Reflect.set(o, BRAND, true);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const BRAND = Symbol.for("pkg/brand");
			export const written = Reflect.set(o, BRAND, true);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const BRAND = Symbol.for("pkg/brand");
			export class Conflict extends Error {
				constructor() {
					super();
					Reflect.set(this, BRAND, true);
				}
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const key: \`_coverage\` = \`_coverage\`;
			export const written = Reflect.set(o, key, v);
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			export function write(target: object, key: "a" | "b", value: unknown): boolean {
				return Reflect.set(target, key, value);
			}
		`,
		errors: [{ messageId }],
		output: null,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noReflectSet,
	valid,
});
