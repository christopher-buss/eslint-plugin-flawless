import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noSharedMocks, RULE_NAME } from "./rule";

const messageId = "sharedMock";
const patternMessageId = "sharedMockPattern";

const valid: Array<ValidTestCase> = [
	// A module mock factory holding no per-test state binds nothing.
	unindent`
		jest.mock("@rbxts/services", () => {
			return createServicesMock({ RunService: fromPartial({ IsStudio: () => true }) });
		});
	`,
	// A mock reachable only from the module mock factory is plumbing: the
	// factory is hoisted, so it cannot close over anything narrower.
	unindent`
		const mockHookFunction = jest.fn();
		jest.mock("./replicator", () => ({ hook: mockHookFunction }));
	`,
	// Creating the mock inside a factory is the shape this rule pushes towards.
	unindent`
		const createHookMock = () => jest.fn();
		it("works", () => {
			const mockHook = createHookMock();
			expect(mockHook).toHaveBeenCalled();
		});
	`,
	// A binding rebuilt in a hook is not shared state; only the name is reused.
	unindent`
		let mockFn;
		beforeEach(() => {
			mockFn = jest.fn();
		});
		it("works", () => {
			expect(mockFn).toHaveBeenCalled();
		});
	`,
	// The same shape, initialized so the binding has a type to infer from.
	unindent`
		let mockFn = jest.fn();
		beforeEach(() => {
			mockFn = jest.fn();
		});
		it("works", () => {
			expect(mockFn).toHaveBeenCalled();
		});
	`,
	// Rebuilding inside a `describe` covers a suite-scoped binding too.
	unindent`
		describe("group", () => {
			let mockFn = jest.fn();
			beforeEach(() => {
				mockFn = jest.fn();
			});
			it("works", () => {
				expect(mockFn).toHaveBeenCalled();
			});
		});
	`,
	// A mock built inside the test it belongs to is the whole point.
	unindent`
		it("works", () => {
			const mockFn = jest.fn();
			expect(mockFn).toHaveBeenCalled();
		});
	`,
	// A hook body runs per test, so its bindings are not shared either.
	unindent`
		beforeEach(() => {
			const mockFn = jest.fn();
			register(mockFn);
		});
	`,
	// A factory declared inside a `describe` is still a factory.
	unindent`
		describe("group", () => {
			const createMock = () => jest.fn();
			it("works", () => {
				expect(createMock()).toHaveBeenCalled();
			});
		});
	`,
	// A static module-scope value holds nothing a test can leak.
	unindent`
		const mockEntity = { id: 1 };
		it("works", () => {
			expect(resolve(mockEntity)).toBe(1);
		});
	`,
	// Nothing observes an unreferenced binding; no-unused-vars owns that case.
	"const mockFn = jest.fn();",
	// A locally shadowed `jest` is not the test global, so it is ignored.
	unindent`
		const jest = { fn: () => noop };
		const mockFn = jest.fn();
		it("works", () => {
			expect(mockFn).toHaveBeenCalled();
		});
	`,
	// Bun's `mock.module` factory earns the same exemption as `jest.mock`.
	unindent`
		import { mock } from "bun:test";
		const mockRun = mock(() => {});
		mock.module("./thing", () => ({ run: mockRun }));
	`,
	// `settings.jest.globalPackage` replaces the default sources, so the
	// built-in ones stop being recognized once it is set.
	{
		code: unindent`
			import { vi } from "vitest";
			const mockFn = vi.fn();
			it("works", () => {
				expect(mockFn).toHaveBeenCalled();
			});
		`,
		settings: { jest: { globalPackage: "@rbxts/jest-globals" } },
	},
];

const invalid: Array<InvalidTestCase> = [
	// The plain case: one mock, asserted on from a test.
	{
		code: unindent`
			const mockFn = jest.fn();
			it("works", () => {
				expect(mockFn).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
	// The tuple form: reported once on the pattern, since a mock reached through
	// the initializer cannot be attributed to one half of the destructure.
	{
		code: unindent`
			const [mockHook, mockHookFunction] = jest.fn();
			jest.mock("./replicator", () => ({ hook: mockHookFunction }));
			it("works", () => {
				expect(mockHook).toHaveBeenCalled();
			});
		`,
		errors: [{ messageId: patternMessageId }],
	},
	// A destructure mixing a mock with plain data is reported once, and the
	// plain binding is never named as the mock.
	{
		code: unindent`
			const { getData: mockGetData, name: label } = makeThing({ getData: jest.fn(), name: "x" });
			it("works", () => {
				expect(mockGetData).toHaveBeenCalled();
				expect(label).toBe("x");
			});
		`,
		errors: [{ messageId: patternMessageId }],
	},
	// A mock created by an immediately-invoked function runs right away, so the
	// deferral that protects a factory does not apply.
	{
		code: unindent`
			const mocks = (() => ({ run: jest.fn() }))();
			it("works", () => {
				expect(mocks.run).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mocks" }, messageId }],
	},
	// A `describe` body outlives each test inside it, so its mocks are shared.
	{
		code: unindent`
			describe("group", () => {
				const mockFn = jest.fn();
				it("works", () => {
					expect(mockFn).toHaveBeenCalled();
				});
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
	// A parameterized suite roots at `describe` all the same.
	{
		code: unindent`
			describe.each([1, 2])("group %i", (value) => {
				const mockFn = jest.fn();
				it("works", () => {
					expect(mockFn).toHaveBeenCalledWith(value);
				});
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
	// Reassigning at module scope creates the mock once all the same, so it is
	// not the per-test rebuild the hook form earns its exemption with.
	{
		code: unindent`
			let mockFn = jest.fn();
			mockFn = jest.fn();
			it("works", () => {
				expect(mockFn).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
	// A spy records calls just as a mock function does.
	{
		code: unindent`
			const spy = jest.spyOn(logger, "warn");
			it("works", () => {
				expect(spy).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "spy" }, messageId }],
	},
	// A mock nested in an object literal is still created at module scope.
	{
		code: unindent`
			const mockLogger = { info: jest.fn(), warn: jest.fn() };
			it("works", () => {
				expect(mockLogger.info).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockLogger" }, messageId }],
	},
	// A mock nested in a call argument is found by the same walk.
	{
		code: unindent`
			const mockResourceManager = fromPartial({ getData: jest.fn() });
			it("works", () => {
				expect(mockResourceManager.getData).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockResourceManager" }, messageId }],
	},
	// A configured mock is reached through the chained call.
	{
		code: unindent`
			import { vi } from "vitest";
			const mockFn = vi.fn().mockReturnValue(1);
			it("works", () => {
				expect(mockFn).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
	// Bun's bare `mock` creates a mock function too.
	{
		code: unindent`
			import { mock } from "bun:test";
			const mockRun = mock(() => {});
			it("works", () => {
				expect(mockRun).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockRun" }, messageId }],
	},
	// An exported binding is module scope all the same.
	{
		code: unindent`
			export const mockFn = jest.fn();
			it("works", () => {
				expect(mockFn).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
	// Resetting the mock by hand is the very cost the rule removes.
	{
		code: unindent`
			const mockFn = jest.fn();
			beforeEach(() => {
				mockFn.mockClear();
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
	// Resolved through the re-export named by `settings.jest.globalPackage`.
	{
		code: unindent`
			import { jest } from "@rbxts/jest-globals";
			const mockFn = jest.fn();
			it("works", () => {
				expect(mockFn).toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
		settings: { jest: { globalPackage: "@rbxts/jest-globals" } },
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noSharedMocks,
	valid,
});
