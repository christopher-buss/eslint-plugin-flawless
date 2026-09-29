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
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect }) => {
				expect(1).toBe(1);
			});
		`,
	},
	{
		code: unindent`
			import { beforeEach, expect, it } from "vitest";
			beforeEach(() => expect.hasAssertions());
			it.concurrent("works", { retry: 1 }, () => expect(1).toBe(1));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { beforeEach, expect, it } from "vitest";
			beforeEach(() => expect.hasAssertions());
			it.concurrent("works", { retry: 1 }, ({ expect }) => expect(1).toBe(1));
		`,
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult() {
				expect(1).toBe(1);
			}
			it("works", () => assertResult());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		filename: "file.js",
		languageOptions: { parserOptions: { project: false } },
		output: unindent`
			import { it } from "vitest";
			function assertResult(context) {
				context.expect(1).toBe(1);
			}
			it("works", (context) => assertResult(context));
		`,
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
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "onTestFailed" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
		output: unindent`
			import { it } from "vitest";
			it("works", ({ expect, onTestFailed, onTestFinished }) => {
				onTestFinished(() => cleanup());
				onTestFailed(() => logFailure());
				expect(1).toBe(1);
			});
		`,
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", ({ database }) => {
				expect(database.value).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it } from "vitest";
			it("works", ({ database, expect }) => {
				expect(database.value).toBe(1);
			});
		`,
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			it("works", (context) => {
				expect(1).toBe(1);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it } from "vitest";
			it("works", (context) => {
				context.expect(1).toBe(1);
			});
		`,
	},
	{
		code: unindent`
			import { expect, test } from "vitest";
			test.for([[1, 1]])("works", ([value, expected]) => {
				expect(value).toBe(expected);
			});
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { test } from "vitest";
			test.for([[1, 1]])("works", ([value, expected], { expect }) => {
				expect(value).toBe(expected);
			});
		`,
	},
	{
		code: unindent`
			import { expect, test } from "vitest";
			test.for([[1]])("works", () => expect(1).toBe(1));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { test } from "vitest";
			test.for([[1]])("works", (_value, { expect }) => expect(1).toBe(1));
		`,
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
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { test } from "vitest";
			const fixtureTest = test.extend<{ database: { value: number } }>({
				database: { value: 1 },
			});
			fixtureTest("works", ({ database, expect }) => {
				expect(database.value).toBe(1);
			});
		`,
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
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
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
		errors: [
			{ data: { name: "onTestFinished" }, messageId },
			{ data: { name: "expect" }, messageId },
		],
		output: unindent`
			import { it, type TestContext } from "vitest";
			function someFactory(context: TestContext) {
				context.onTestFinished(() => cleanup());
				context.expect(1).toBe(1);
			}
			it("works", (context) => {
				someFactory(context);
			});
		`,
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
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				context.expect(1).toBe(1);
			}
			it("works", (context) => {
				const { database } = context;
				use(database);
				assertResult(context);
			});
		`,
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			const assertResult = () => expect(1).toBe(1);
			const runFactory = () => assertResult();
			it("works", () => runFactory());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it, type TestContext } from "vitest";
			const assertResult = (context: TestContext) => context.expect(1).toBe(1);
			const runFactory = (context: TestContext) => assertResult(context);
			it("works", (context) => runFactory(context));
		`,
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult(value = 1) {
				expect(value).toBe(1);
			}
			it("works", () => assertResult());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(value = 1, context: TestContext) {
				context.expect(value).toBe(1);
			}
			it("works", (context) => assertResult(undefined, context));
		`,
	},
	{
		code: unindent`
			import { expect, it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				expect(1).toBe(1);
			}
			it("works", (context) => assertResult(context));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				context.expect(1).toBe(1);
			}
			it("works", (context) => assertResult(context));
		`,
	},
	{
		code: unindent`
			import { expect, it, type TestContext as Context } from "vitest";
			function assertResult() {
				expect(1).toBe(1);
			}
			it("works", () => assertResult());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it, type TestContext as Context } from "vitest";
			function assertResult(context: Context) {
				context.expect(1).toBe(1);
			}
			it("works", (context) => assertResult(context));
		`,
	},
	{
		code: unindent`
			import { expect, it, type TestContext as Context } from "vitest";
			function assertResult(context: Context) {
				expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it, type TestContext as Context } from "vitest";
			function assertResult(context: Context) {
				context.expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
	},
	{
		code: unindent`
			import vitest, { expect, it } from "vitest";
			it("works", () => expect(vitest).toBeDefined());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import vitest, { it } from "vitest";
			it("works", ({ expect }) => expect(vitest).toBeDefined());
		`,
	},
	{
		code: unindent`
			import { expect as check, it } from "vitest";
			it("works", (context) => consume({ check }));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it } from "vitest";
			it("works", (context) => consume({ check: context.expect }));
		`,
	},
	{
		code: unindent`
			import { expect, it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: unindent`
			import { it, type TestContext } from "vitest";
			function assertResult(context: TestContext) {
				context.expect(1).toBe(1);
			}
			it("works", () => assertResult(getContext()));
		`,
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			export function assertResult() {
				expect(1).toBe(1);
			}
			it("works", () => assertResult());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: null,
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
		errors: [{ data: { name: "expect" }, messageId }],
		output: null,
	},
	{
		code: unindent`
			import { expect, it } from "vitest";
			function assertResult(value?: number) {
				expect(value).toBeUndefined();
			}
			it("works", () => assertResult());
		`,
		errors: [{ data: { name: "expect" }, messageId }],
		output: null,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferVitestLocalContext,
	valid,
});
