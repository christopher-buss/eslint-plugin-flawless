import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noIncompatibleAssertionTypes, RULE_NAME } from "./rule";

const messageId = "incompatibleTypes";

const DECLARATIONS = unindent`
	declare const count: number;
	declare const label: string;
	declare const flag: boolean;
	declare const big: bigint;
	declare const sym: symbol;
	declare const either: string | number;
	declare const maybe: number | undefined;
	declare const nothing: null;
	declare const obj: { id: number };
	declare function readAny(): any;
	enum Color { Red, Blue }
	enum Name { A = "a" }
`;

const EXPECT_IMPORT = 'import { expect } from "vitest";';

function withExpect(body: string): string {
	return `${EXPECT_IMPORT}\n${DECLARATIONS}\n${body}`;
}

function withImport(importLine: string, body: string): string {
	return `${importLine}\n${DECLARATIONS}\n${body}`;
}

function error(
	actual: string,
	expected: string,
): { data: Record<string, string>; messageId: typeof messageId } {
	return { data: { actual, expected }, messageId };
}

const valid: Array<ValidTestCase> = [
	withExpect("expect(count).toBe(1);"),
	withExpect('expect(either).toBe("1");'),
	// An `undefined` arm makes the operand open.
	withExpect('expect(maybe).toBe("1");'),
	withExpect('expect(nothing).toBe("1");'),
	withExpect('expect(obj).toEqual("1");'),
	withExpect('expect(readAny()).toBe("1");'),
	withExpect("expect(count).toBeCloseTo(1);"),
	withExpect('expect(count, "msg").toBe("1");'),
	withExpect('expect(count).toBe("1", "x");'),
	withExpect('expect(...[count]).toBe("1");'),
	withExpect('expect(count)["toBe"]("1");'),
	withExpect('expect(count).resolves.toBe("1");'),
	withExpect('expect.soft(count).toBe("1");'),
	withExpect("expect(Color.Red).toBe(Color.Blue);"),
	withExpect('expect(Name.A).toBe("a");'),
	withExpect("expect(flag).toBe(true);"),
	withImport('import assert from "node:assert";', 'assert.equal(count, "1");'),
	withImport('import assert from "node:assert";', 'assert.deepEqual(count, "1");'),
	withImport('import assert from "node:assert";', 'assert.notDeepEqual(count, "1");'),
	withImport('import assert from "node:assert";', "assert.ok(count);"),
	withImport('import assert from "node:assert";', "assert.strictEqual(count, 1);"),
	withImport('import { deepEqual } from "node:assert";', 'deepEqual(count, "1");'),
	withImport('import type assert from "node:assert";', 'assert.strictEqual(count, "1");'),
	withImport('import assert from "some-assertion-library";', 'assert.strictEqual(count, "1");'),
	withImport('import { equal } from "node:assert/strict";', 'equal(count, "1");'),
	// A local binding that shadows the import.
	withImport(
		'import assert from "node:assert";',
		unindent`
			function check(assert: { strictEqual(a: unknown, b: unknown): void }) {
				assert.strictEqual(count, "1");
			}
		`,
	),
	// Stability guard: a write of `any` widens the variable.
	withExpect(
		unindent`
			let value: number = 1;
			value = readAny();
			expect(value).toBe("1");
		`,
	),
	withExpect(
		unindent`
			let holder = { id: 1 };
			holder = readAny();
			expect(holder.id).toBe("1");
		`,
	),
	// Monkey-patch guard: the method was replaced before the assertion.
	withExpect(
		unindent`
			const api = { get: (): number => 1 };
			api.get = () => "x" as never;
			expect(api.get()).toBe("1");
		`,
	),
	withExpect(
		unindent`
			const api = { nested: { get: (): number => 1 } };
			api.nested.get = function () { return "x" as never; };
			expect(api.nested.get()).toBe("1");
		`,
	),
	// A type parameter can be anything.
	withExpect(
		unindent`
			function check<T>(input: T) {
				expect(input).toBe("1");
			}
		`,
	),
	withExpect(
		unindent`
			function check<T extends { id: unknown }>(input: T) {
				expect(input["id"]).toBe("1");
			}
		`,
	),
	// A local `expect` is not the test global.
	unindent`
		import { expect } from "vitest";
		declare const count: number;
		function run(expect: (value: unknown) => { toBe(other: unknown): void }) {
			expect(count).toBe("1");
		}
	`,
	unindent`
		import { it } from "vitest";
		declare const count: number;
		function expect(value: unknown) {
			return { toBe(other: unknown) {} };
		}
		it("x", () => expect(count).toBe("1"));
	`,
	withImport(
		'import { strictEqual } from "node:assert";',
		unindent`
			function check(strictEqual: (a: unknown, b: unknown) => void) {
				strictEqual(count, "1");
			}
		`,
	),
	// Stability guard through optional chaining.
	withExpect(
		unindent`
			let holder = { id: 1 };
			holder = readAny();
			expect(holder?.id).toBe("1");
		`,
	),
	// Monkey-patch guard through optional chaining.
	withExpect(
		unindent`
			const api = { get: (): number => 1 };
			api.get = () => "x" as never;
			expect(api?.get()).toBe("1");
		`,
	),
	// `equal` is ignored, also on the `strict` object.
	withImport('import assert from "node:assert";', 'assert.strict.equal(count, "1");'),
	// Out of scope: other assertion libraries.
	unindent`
		import { expect } from "@playwright/test";
		declare const count: number;
		expect(count).toBe("1");
	`,
	// `settings.jest.globalPackage` replaces the default sources.
	{
		code: withExpect('expect(count).toBe("1");'),
		settings: { jest: { globalPackage: "@rbxts/jest-globals" } },
	},
];

const invalid: Array<InvalidTestCase> = [
	{
		code: withExpect('expect(count).toBe("1");'),
		errors: [{ ...error("number", "string"), column: 15, endColumn: 19, line: 14 }],
	},
	{ code: withExpect("expect(count).toEqual(true);"), errors: [error("number", "boolean")] },
	{ code: withExpect("expect(label).toStrictEqual(1);"), errors: [error("string", "number")] },
	{ code: withExpect('expect(count).not.toBe("1");'), errors: [error("number", "string")] },
	{ code: withExpect("expect(big).toBe(1);"), errors: [error("bigint", "number")] },
	{ code: withExpect('expect(sym).toBe("s");'), errors: [error("symbol", "string")] },
	{ code: withExpect('expect(Color.Red).toBe("red");'), errors: [error("Color", "string")] },
	{ code: withExpect("expect(Name.A).toBe(1);"), errors: [error("Name", "number")] },
	{
		// eslint-disable-next-line no-template-curly-in-string -- fixture source
		code: withExpect("expect(`id-${count}`).toBe(1);"),
		errors: [error("string", "number")],
	},
	{ code: withExpect('expect(obj.id).toBe("1");'), errors: [error("number", "string")] },
	{
		code: withExpect("expect(either).toBe(true);"),
		errors: [error("string | number", "boolean")],
	},
	{
		code: withImport('import assert from "node:assert";', 'assert.strictEqual(count, "1");'),
		errors: [{ ...error("number", "string"), column: 1, endColumn: 19, line: 14 }],
	},
	{
		code: withImport('import assert from "node:assert";', "assert.deepStrictEqual(flag, 0);"),
		errors: [error("boolean", "number")],
	},
	{
		code: withImport('import assert from "node:assert";', 'assert.notStrictEqual(count, "1");'),
		errors: [error("number", "string")],
	},
	{
		code: withImport(
			'import * as assert from "node:assert";',
			'assert.strictEqual(count, "1");',
		),
		errors: [error("number", "string")],
	},
	{
		code: withImport('import { strictEqual } from "node:assert";', 'strictEqual(count, "1");'),
		errors: [error("number", "string")],
	},
	{
		code: withImport(
			'import { notDeepStrictEqual as differs } from "assert";',
			'differs(count, "1", "message");',
		),
		errors: [error("number", "string")],
	},
	{
		code: withImport(
			'import assert from "node:assert/strict";',
			'assert.deepEqual(count, "1");',
		),
		errors: [error("number", "string")],
	},
	{
		code: withImport('import assert from "assert/strict";', 'assert.notDeepEqual(count, "1");'),
		errors: [error("number", "string")],
	},
	{
		code: withImport(
			'import { deepEqual } from "node:assert/strict";',
			'deepEqual(count, "1");',
		),
		errors: [error("number", "string")],
	},
	// Stability guard: every write keeps a known type.
	{
		code: withExpect(
			unindent`
				let narrowed: number | string = Math.random() > 0.5 ? 1 : "a";
				if (typeof narrowed === "number") expect(narrowed).toBe("1");
			`,
		),
		errors: [error("number", "string")],
	},
	// Monkey-patch guard: a patch after the assertion does not count.
	{
		code: withExpect(
			unindent`
				const late = { get: (): number => 1 };
				expect(late.get()).toBe("1");
				late.get = () => "x" as never;
			`,
		),
		errors: [error("number", "string")],
	},
	// Differences from other implementations: the global `expect`, an aliased
	// import, and a re-export named by `settings.jest.globalPackage`.
	{
		code: unindent`
			declare const count: number;
			expect(count).toBe("1");
		`,
		errors: [error("number", "string")],
	},
	{
		code: unindent`
			import { expect as check } from "vitest";
			declare const count: number;
			check(count).toBe("1");
		`,
		errors: [error("number", "string")],
	},
	{
		code: unindent`
			import { expect } from "@jest/globals";
			declare const count: number;
			expect(count).toBe("1");
		`,
		errors: [error("number", "string")],
	},
	{
		code: unindent`
			import { expect } from "bun:test";
			declare const count: number;
			expect(count).toBe("1");
		`,
		errors: [error("number", "string")],
	},
	{
		code: unindent`
			import { expect } from "@rbxts/jest-globals";
			declare const count: number;
			expect(count).toBe("1");
		`,
		errors: [error("number", "string")],
		settings: { jest: { globalPackage: "@rbxts/jest-globals" } },
	},
	{
		code: withImport(
			'import { strict as assert } from "node:assert";',
			'assert.strictEqual(count, "1");',
		),
		errors: [error("number", "string")],
	},
	{
		code: withImport(
			'import { strict as assert } from "node:assert";',
			'assert.deepEqual(count, "1");',
		),
		errors: [error("number", "string")],
	},
	{
		code: withImport(
			'import assert from "node:assert";',
			'assert.strict.deepEqual(count, "1");',
		),
		errors: [error("number", "string")],
	},
	{
		code: withImport(
			'import * as assert from "assert";',
			'assert.strict.strictEqual(count, "1");',
		),
		errors: [error("number", "string")],
	},
	// Only a plain `=` replaces a method.
	{
		code: withExpect(
			unindent`
				const api: { get?: () => number } = {};
				api.get ??= () => 1;
				expect(api.get!()).toBe("1");
			`,
		),
		errors: [error("number", "string")],
	},
	// A patch of a different variable with the same name does not count.
	{
		code: withExpect(
			unindent`
				function patch() {
					const api = { get: (): number => 1 };
					api.get = () => 2;
				}
				const api = { get: (): number => 1 };
				expect(api.get()).toBe("1");
			`,
		),
		errors: [error("number", "string")],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noIncompatibleAssertionTypes,
	valid,
});
