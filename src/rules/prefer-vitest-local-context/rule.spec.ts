import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { preferVitestLocalContext, RULE_NAME } from "./rule";

const messageId = "preferLocalContext";

const valid: Array<ValidTestCase> = [
	unindent`
		import { it } from "vitest";
		it("works", ({ expect }) => {
			expect(1).toBe(1);
		});
	`,
	unindent`
		import { it } from "vitest";
		it("works", (context) => {
			context.expect(1).toBe(1);
		});
	`,
	unindent`
		import { expect, test } from "vitest";
		test.each([1, 2])("works", (value) => {
			expect(value).toBeGreaterThan(0);
		});
	`,
	unindent`
		import { expect } from "vitest";
		expect.extend({ matcher() {} });
	`,
	unindent`
		import { expect, it } from "another-test-runner";
		it("works", () => expect(1).toBe(1));
	`,
	unindent`
		const it = createTest();
		import { expect } from "vitest";
		it("works", () => expect(1).toBe(1));
	`,
	unindent`
		import { expect, it } from "vitest";
		function unusedHelper() {
			expect(1).toBe(1);
		}
		it("works", ({ expect }) => expect(unusedHelper).toBeDefined());
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", () => {
				expect(1).toBe(1);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect }) => {
				expect(1).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { beforeEach, expect, it } from "vitest";
			beforeEach(() => expect.hasAssertions());
			it.concurrent("works", { retry: 1 }, () => expect(1).toBe(1));
		`,
		output: unindent`
			import { beforeEach, expect, it } from "vitest";
			beforeEach(() => expect.hasAssertions());
			it.concurrent("works", { retry: 1 }, ({ expect }) => expect(1).toBe(1));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		filename: "file.js",
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult() {
				expect(1).toBe(1);
			}
			it("works", () => assertResult());
		`,
		output: unindent`
			import { it } from "vitest";
			function assertResult(expect) {
				expect(1).toBe(1);
			}
			it("works", ({ expect }) => assertResult(expect));
		`,
		languageOptions: { parserOptions: { project: false } },
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect as check, it, onTestFailed, onTestFinished } from "vitest";
			it("works", () => {
				onTestFinished(() => cleanup());
				onTestFailed(() => logFailure());
				check(1).toBe(1);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect, onTestFailed, onTestFinished }) => {
				onTestFinished(() => cleanup());
				onTestFailed(() => logFailure());
				expect(1).toBe(1);
			});
		`,
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "onTestFailed" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", ({ database }) => {
				expect(database.value).toBe(1);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ database, expect }) => {
				expect(database.value).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", (context) => {
				expect(1).toBe(1);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect }) => {
				expect(1).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, test } from "vitest";
			test.for([[1, 1]])("works", ([value, expected]) => {
				expect(value).toBe(expected);
			});
		`,
		output: unindent`
			import { test } from "vitest";
			test.for([[1, 1]])("works", ([value, expected], { expect }) => {
				expect(value).toBe(expected);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, test } from "vitest";
			test.for([[1]])("works", () => expect(1).toBe(1));
		`,
		output: unindent`
			import { test } from "vitest";
			test.for([[1]])("works", (_value, { expect }) => expect(1).toBe(1));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, test } from "vitest";
			const fixtureTest = test.extend<{ database: { value: number } }>({
				database: { value: 1 },
			});
			fixtureTest("works", ({ database }) => {
				expect(database.value).toBe(1);
			});
		`,
		output: unindent`
			import { test } from "vitest";
			const fixtureTest = test.extend<{ database: { value: number } }>({
				database: { value: 1 },
			});
			fixtureTest("works", ({ database, expect }) => {
				expect(database.value).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it, onTestFinished } from "vitest";
			function someFactory(onFinished: (callback: () => void) => void) {
				onFinished(() => cleanup());
			}
			it("works", () => {
				someFactory(onTestFinished);
				expect(1).toBe(1);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			function someFactory(onFinished: (callback: () => void) => void) {
				onFinished(() => cleanup());
			}
			it("works", ({ expect, onTestFinished }) => {
				someFactory(onTestFinished);
				expect(1).toBe(1);
			});
		`,
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
	},
	{
		code: unindent`
			import { expect, it, onTestFinished } from "vitest";
			function someFactory() {
				onTestFinished(() => cleanup());
				expect(1).toBe(1);
			}
			it("works", () => {
				someFactory();
			});
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function someFactory(expect: TestContext["expect"], onTestFinished: TestContext["onTestFinished"]) {
				onTestFinished(() => cleanup());
				expect(1).toBe(1);
			}
			it("works", ({ expect, onTestFinished }) => {
				someFactory(expect, onTestFinished);
			});
		`,
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult() {
				expect(1).toBe(1);
			}
			it("works", ({ database }) => {
				use(database);
				assertResult();
			});
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(expect: TestContext["expect"]) {
				expect(1).toBe(1);
			}
			it("works", ({ database, expect }) => {
				use(database);
				assertResult(expect);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			const assertResult = () => expect(1).toBe(1);
			const runFactory = () => assertResult();
			it("works", () => runFactory());
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			const assertResult = (expect: TestContext["expect"]) => expect(1).toBe(1);
			const runFactory = (expect: TestContext["expect"]) => assertResult(expect);
			it("works", ({ expect }) => runFactory(expect));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult(value = 1) {
				expect(value).toBe(1);
			}
			it("works", () => assertResult());
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(value = 1, expect: TestContext["expect"]) {
				expect(value).toBe(1);
			}
			it("works", ({ expect }) => assertResult(undefined, expect));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				expect(1).toBe(1);
			}
			it("works", (context) => assertResult(context));
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				context.expect(1).toBe(1);
			}
			it("works", (context) => assertResult(context));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it, type TestContext as Context } from "vitest";
			function assertResult() {
				expect(1).toBe(1);
			}
			it("works", () => assertResult());
		`,
		output: unindent`
			import { it, type TestContext as Context } from "vitest";
			function assertResult(expect: Context["expect"]) {
				expect(1).toBe(1);
			}
			it("works", ({ expect }) => assertResult(expect));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it, type TestContext as Context } from "vitest";
			function assertResult(context: Context) {
				expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
		output: unindent`
			import { it, type TestContext as Context } from "vitest";
			function assertResult(context: Context) {
				context.expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import vitest, { expect, it } from "vitest";
			it("works", () => expect(vitest).toBeDefined());
		`,
		output: unindent`
			import vitest, { it } from "vitest";
			it("works", ({ expect }) => expect(vitest).toBeDefined());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect as check, it } from "vitest";
			it("works", (context) => consume({ check }));
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect }) => consume({ check: expect }));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				context.expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			export function assertResult() {
				expect(1).toBe(1);
			}
			it("works", () => assertResult());
		`,
		output: null,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult() {
				expect(1).toBe(1);
			}
			assertResult();
			it("works", () => assertResult());
		`,
		output: null,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult(value?: number) {
				expect(value).toBeUndefined();
			}
			it("works", () => assertResult());
		`,
		output: null,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	// A timeout after the callback does not hide the callback.
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", () => {
				expect.assertions(1);
				expect(1).toBe(1);
			}, 10_000);
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect }) => {
				expect.assertions(1);
				expect(1).toBe(1);
			}, 10_000);
		`,
		errors: [
			{ data: { name: "expect" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
	},
	// Helpers receive only the fixtures they use, so tests can destructure and
	// keep `expect.assertions` as their first statement.
	{
		code: unindent`
			import { expect, it, onTestFinished } from "vitest";
			function makeDirectory(): string {
				onTestFinished(() => cleanup());
				return "dir";
			}
			it("works", () => {
				expect.assertions(1);
				expect(makeDirectory()).toBe("dir");
			});
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function makeDirectory(onTestFinished: TestContext["onTestFinished"]): string {
				onTestFinished(() => cleanup());
				return "dir";
			}
			it("works", ({ expect, onTestFinished }) => {
				expect.assertions(1);
				expect(makeDirectory(onTestFinished)).toBe("dir");
			});
		`,
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "expect" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
	},
	// An existing context parameter read only through properties is
	// destructured.
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", (context) => {
				context.onTestFinished(() => cleanup());
				expect(context.task.name).toBe("works");
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect, onTestFinished, task }) => {
				onTestFinished(() => cleanup());
				expect(task.name).toBe("works");
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", context => expect(context.task).toBeDefined());
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect, task }) => expect(task).toBeDefined());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	// A context that escapes as a whole value keeps member access.
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", (context) => {
				use(context);
				expect(1).toBe(1);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", (context) => {
				use(context);
				context.expect(1).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	// Destructuring `task` would shadow the module-level `task`.
	{
		code: unindent`
			import { expect, it } from "vitest";
			const task = 1;
			it("works", (context) => {
				expect(context.task).not.toBe(task);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			const task = 1;
			it("works", (context) => {
				context.expect(context.task).not.toBe(task);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", () => {
				expect(1).toBe(1);
				const identity = (expect: number) => expect;
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect: expect2 }) => {
				expect2(1).toBe(1);
				const identity = (expect: number) => expect;
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", ({ ...fixtures }) => {
				expect(fixtures).toBeDefined();
			});
		`,
		output: null,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	// Past `maxParams`, the fixtures travel in one object parameter. Each
	// helper picks its own shape.
	{
		code: unindent`
			import { expect, it, onTestFinished } from "vitest";
			function check(left: number, right: number) {
				onTestFinished(() => cleanup());
				expect(left).toBe(right);
			}
			function run(value: number) {
				check(value, value);
			}
			it("works", () => run(1));
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function check(left: number, right: number, { expect, onTestFinished }: Pick<TestContext, "expect" | "onTestFinished">) {
				onTestFinished(() => cleanup());
				expect(left).toBe(right);
			}
			function run(value: number, expect: TestContext["expect"], onTestFinished: TestContext["onTestFinished"]) {
				check(value, value, { expect, onTestFinished });
			}
			it("works", ({ expect, onTestFinished }) => run(1, expect, onTestFinished));
		`,
		options: [{ maxParams: 3 }],
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
	},
	// Reads in a closure inside a helper use the helper's new parameter.
	{
		code: unindent`
			import { expect, it } from "vitest";
			function check(values: Array<number>) {
				values.forEach((value) => expect(value).toBe(1));
			}
			it("works", () => check([1]));
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function check(values: Array<number>, expect: TestContext["expect"]) {
				values.forEach((value) => expect(value).toBe(1));
			}
			it("works", ({ expect }) => check([1], expect));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	// A reserved word cannot become a shorthand binding.
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", (context) => {
				expect(context.default).toBe(1);
			});
		`,
		output: unindent`
			import { it } from "vitest";
			it("works", (context) => {
				context.expect(context.default).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	// Trailing commas in parameter and argument lists are kept valid.
	{
		code: unindent`
			import { expect, it } from "vitest";
			function check(
				value: number,
			) {
				expect(value).toBe(1);
			}
			it("works", () => check(
				1,
			));
		`,
		output: unindent`
			import { it, type TestContext } from "vitest";
			function check(
				value: number, expect: TestContext["expect"],
			) {
				expect(value).toBe(1);
			}
			it("works", ({ expect }) => check(
				1, expect,
			));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
	},
	// Not even one more parameter fits: report without a fix.
	{
		code: unindent`
			import { expect, it } from "vitest";
			function check(left: number, right: number) {
				expect(left).toBe(right);
			}
			it("works", () => check(1, 1));
		`,
		output: null,
		options: [{ maxParams: 2 }],
		errors: [{ data: { name: "expect" }, messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferVitestLocalContext,
	valid,
});
