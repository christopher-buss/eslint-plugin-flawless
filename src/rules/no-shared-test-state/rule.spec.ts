import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noSharedTestState, RULE_NAME } from "./rule";

const messageId = "sharedState";

const valid: Array<ValidTestCase> = [
	// Reads alone never leak: a binding no test writes is a constant.
	unindent`
		const config = { retries: 3 };
		const known = new Map([["a", 1]]);
		it("reads", () => {
			expect(resolve(config)).toBe(3);
			expect(known.get("a")).toBe(1);
			expect(known.has("b")).toBe(false);
			expect([...known.keys()].map(String).filter(Boolean).slice(0)).toHaveLength(1);
			known.forEach((value) => expect(value).toBe(1));
		});
	`,
	// A binding declared inside the test is rebuilt every run, however deeply
	// the closure that writes it is nested.
	unindent`
		it("counts", async () => {
			let calls = 0;
			let captured;
			const handler = vi.fn().mockImplementation(() => {
				calls += 1;
			});
			const listener = {
				onEvent(value) {
					captured = value;
				},
			};
			await new Promise((resolve) => {
				captured = resolve;
			});
			handler();
			expect(calls).toBe(1);
			expect(listener).toBeDefined();
		});
	`,
	// Writes at collection time run once, before any test does.
	unindent`
		const cases = [];
		for (let index = 0; index < 3; index += 1) {
			cases.push(index);
		}
		describe("suite", () => {
			const labels = new Set();
			labels.add("first");
			it.each(cases)("case %i", (value) => {
				expect(labels.has("first")).toBe(value >= 0);
			});
		});
	`,
	// State created by a factory belongs to the call, not to the file.
	unindent`
		function createCounter() {
			let count = 0;
			return () => {
				count += 1;
				return count;
			};
		}
		it("counts", () => {
			const next = createCounter();
			expect(next()).toBe(1);
		});
	`,
	// A pure builder writes nothing outside itself.
	unindent`
		function makeUser(overrides) {
			const user = { id: 1, name: "a" };
			user.name = "b";
			return { ...user, ...overrides };
		}
		it("builds", () => {
			expect(makeUser({ id: 2 }).id).toBe(2);
		});
	`,
	// A helper that writes module state but is only called at module scope.
	unindent`
		const registry = new Map();
		function register(name) {
			registry.set(name, true);
		}
		register("a");
		it("reads", () => {
			expect(registry.get("a")).toBe(true);
		});
	`,
	// Imported bindings and globals belong to another module or the runtime.
	unindent`
		import { logger } from "./logger";
		it("writes elsewhere", () => {
			logger.verbose = true;
			process.argv = ["node"];
			console.warn = () => {};
			globalThis.flag = true;
		});
	`,
	// Module mock and hoisted factories run once, outside every test.
	unindent`
		const state = { ready: false };
		const payloads = vi.hoisted(() => new Map());
		vi.mock("./thing", () => {
			state.ready = true;
			return { payloads };
		});
		it("reads", () => {
			expect(state.ready).toBe(true);
		});
	`,
	// Without types, only known mutating methods count; mock configuration is
	// no-shared-mocks' concern.
	unindent`
		const service = createService();
		const mockRun = vi.fn();
		it("runs", () => {
			service.start();
			mockRun.mockReturnValue(1);
			expect(service.run()).toBe(1);
		});
	`,
	// A local of the same name shadows the module binding.
	unindent`
		let store = new Map();
		it("shadows", () => {
			const store = new Map();
			store.set("a", 1);
			expect(store.size).toBe(1);
		});
	`,
	// A locally declared \`it\` is not the test global.
	unindent`
		const seen = [];
		function it(name, callback) {
			callback();
		}
		it("x", () => {
			seen.push(1);
		});
	`,
	// A namespace is not a variable binding.
	unindent`
		namespace Settings {
			export let level = 1;
		}
		it("writes", () => {
			Settings.level = 2;
		});
	`,
	// Known limits: aliasing, passing to a function, and methods on objects
	// are not followed.
	unindent`
		const byName = new Map();
		const list = [];
		const helpers = { reset: () => list.splice(0) };
		it("mutates indirectly", () => {
			const roots = byName.get("a") ?? [];
			roots.push(1);
			fill(list);
			helpers.reset();
		});
	`,
	// A method called on a value returned from the binding is not followed.
	unindent`
		const groups = new Map();
		it("mutates a member", () => {
			groups.get("a").push(1);
		});
	`,
	// Recursive helpers that write nothing terminate.
	unindent`
		function ping(depth) {
			return depth === 0 ? 0 : pong(depth - 1);
		}
		function pong(depth) {
			return depth === 0 ? 0 : ping(depth - 1);
		}
		it("terminates", () => {
			expect(ping(4)).toBe(0);
		});
	`,
	// A shadowed \`Object\` is not the global.
	unindent`
		const Object = { assign: (target) => target };
		const state = {};
		it("assigns", () => {
			Object.assign(state, { a: 1 });
		});
	`,
	// \`describe\` bodies are collection time, not a test.
	unindent`
		let count = 0;
		describe("suite", () => {
			count += 1;
			it("reads", () => {
				expect(count).toBe(1);
			});
		});
	`,
	// \`settings.jest.globalPackage\` replaces the default sources.
	{
		code: unindent`
			import { it } from "vitest";
			let count = 0;
			it("counts", () => {
				count += 1;
			});
		`,
		settings: { jest: { globalPackage: "@rbxts/jest-globals" } },
	},
];

const invalid: Array<InvalidTestCase> = [
	// A test that reassigns a module binding hands its value to the next test.
	{
		code: unindent`
			let current;
			it("sets", () => {
				current = "a";
			});
			it("reads", () => {
				expect(current).toBeUndefined();
			});
		`,
		errors: [{ data: { name: "current" }, line: 1, messageId }],
	},
	// Rebuilding in \`beforeEach\` is one deletion away from leaking.
	{
		code: unindent`
			let store = new Map();
			beforeEach(() => {
				store = new Map();
			});
			it("writes", () => {
				store.set("a", 1);
				expect(store.size).toBe(1);
			});
		`,
		errors: [{ data: { name: "store" }, messageId }],
	},
	// Suite-level hooks write once and share the result with every test.
	{
		code: unindent`
			let connection;
			let closed = false;
			beforeAll(() => {
				connection = connect();
			});
			afterAll(() => {
				closed = true;
			});
			it("uses", () => {
				expect(connection).toBeDefined();
			});
		`,
		errors: [
			{ data: { name: "connection" }, messageId },
			{ data: { name: "closed" }, messageId },
		],
	},
	// A reset in \`afterEach\` does not stop the test's write from being shared.
	{
		code: unindent`
			const seen = new Set();
			afterEach(() => {
				seen.clear();
			});
			it("adds", () => {
				seen.add(1);
			});
		`,
		errors: [{ data: { name: "seen" }, messageId }],
	},
	// Counters, compound and logical assignment all reassign.
	{
		code: unindent`
			let calls = 0;
			let total = 0;
			let cached;
			it("counts", () => {
				calls++;
				total += 2;
				cached ??= load();
			});
		`,
		errors: [
			{ data: { name: "calls" }, messageId },
			{ data: { name: "total" }, messageId },
			{ data: { name: "cached" }, messageId },
		],
	},
	// Writes through a member, at any depth.
	{
		code: unindent`
			const a = {};
			const b = {};
			const c = {};
			const d = { n: 0 };
			const e = {};
			const f = { items: { list: [] } };
			const g = [];
			it("writes members", () => {
				a.name = "x";
				b[key] = 1;
				delete c.name;
				d.n++;
				e.value ??= 1;
				f.items.list.push(1);
				g.length = 0;
			});
		`,
		errors: [
			{ data: { name: "a" }, messageId },
			{ data: { name: "b" }, messageId },
			{ data: { name: "c" }, messageId },
			{ data: { name: "d" }, messageId },
			{ data: { name: "e" }, messageId },
			{ data: { name: "f" }, messageId },
			{ data: { name: "g" }, messageId },
		],
	},
	// Optional chaining and type-only wrappers leave the receiver unchanged.
	{
		code: unindent`
			let a: Array<number> | undefined = [];
			const b: Array<number> | undefined = [];
			const c: unknown = [];
			const d = {} as { items?: Array<number> };
			it("writes", () => {
				a?.push(1);
				b!.push(1);
				(c as Array<number>).push(1);
				d.items!.splice(0);
			});
		`,
		errors: [
			{ data: { name: "a" }, messageId },
			{ data: { name: "b" }, messageId },
			{ data: { name: "c" }, messageId },
			{ data: { name: "d" }, messageId },
		],
	},
	// Computed method names that are string literals count too.
	{
		code: unindent`
			const list = [];
			it("writes", () => {
				list["push"](1);
			});
		`,
		errors: [{ data: { name: "list" }, messageId }],
	},
	// Destructuring and loop targets write each binding they name.
	{
		code: unindent`
			let first;
			let second;
			let third;
			let item;
			const target = {};
			it("unpacks", () => {
				[first, ...second] = [1, 2];
				({ value: third = 0 } = { value: 3 });
				for (item of [1]) {}
				[target.value] = [1];
			});
		`,
		errors: [
			{ data: { name: "first" }, messageId },
			{ data: { name: "second" }, messageId },
			{ data: { name: "third" }, messageId },
			{ data: { name: "item" }, messageId },
			{ data: { name: "target" }, messageId },
		],
	},
	// A \`describe\` body is shared by every test in it, nested blocks included.
	{
		code: unindent`
			describe("outer", () => {
				let outer = 0;
				describe("inner", () => {
					let inner = 0;
					it("writes", () => {
						outer += 1;
						inner += 1;
					});
				});
			});
		`,
		errors: [
			{ data: { name: "outer" }, messageId },
			{ data: { name: "inner" }, messageId },
		],
	},
	// A closure created in the test runs on its behalf.
	{
		code: unindent`
			let calls = 0;
			const seen = [];
			const pending = new Set();
			it("writes from closures", ({ onTestFinished }) => {
				vi.fn().mockImplementation(() => {
					calls += 1;
				});
				[1, 2].forEach((value) => seen.push(value));
				pending.add(1);
				onTestFinished(() => pending.delete(1));
			});
		`,
		errors: [
			{ data: { name: "calls" }, messageId },
			{ data: { name: "seen" }, messageId },
			{ data: { name: "pending" }, messageId },
		],
	},
	// Every callee shape of a test resolves to its root.
	{
		code: unindent`
			let a = 0;
			let b = 0;
			let c = 0;
			let d = 0;
			let e = 0;
			let f = 0;
			it.each([1, 2])("each %i", () => {
				a += 1;
			});
			test.each\`
				value
				\${1}
			\`("table $value", () => {
				b += 1;
			});
			it.for([1])("for %i", () => {
				c += 1;
			});
			it.skipIf(false)("skip if", () => {
				d += 1;
			});
			test.only("only", () => {
				e += 1;
			});
			test.concurrent("concurrent", { timeout: 10 }, () => {
				f += 1;
			});
		`,
		errors: [
			{ data: { name: "a" }, messageId },
			{ data: { name: "b" }, messageId },
			{ data: { name: "c" }, messageId },
			{ data: { name: "d" }, messageId },
			{ data: { name: "e" }, messageId },
			{ data: { name: "f" }, messageId },
		],
	},
	// A hand-rolled setup helper is a \`beforeEach\` by another name; each
	// binding is reported once however many tests call it.
	{
		code: unindent`
			let mocks;
			let seams;
			function setupDefaults() {
				mocks = createMocks();
				seams = toSeams(mocks);
			}
			it("one", () => {
				setupDefaults();
			});
			it("two", () => {
				setupDefaults();
			});
		`,
		errors: [
			{ data: { name: "mocks" }, messageId },
			{ data: { name: "seams" }, messageId },
		],
	},
	// Helpers are followed through other helpers, through values, and into
	// the closures they return.
	{
		code: unindent`
			let directoryCounter = 0;
			let argvCounter = 0;
			const bytesByPath = new Map();
			function nextName() {
				directoryCounter += 1;
				return String(directoryCounter);
			}
			const createDirectory = () => makeDirectory(nextName());
			function nextArgvDirectory() {
				argvCounter += 1;
				return String(argvCounter);
			}
			function argvHandler() {
				return (path, bytes) => {
					bytesByPath.set(path, bytes);
				};
			}
			it("uses helpers", () => {
				createDirectory();
				run({ mkdtemp: nextArgvDirectory, onWrite: argvHandler() });
			});
		`,
		errors: [
			{ data: { name: "directoryCounter" }, messageId },
			{ data: { name: "argvCounter" }, messageId },
			{ data: { name: "bytesByPath" }, messageId },
		],
	},
	// A hook given a named function runs that function.
	{
		code: unindent`
			const output = [];
			function cleanOutput() {
				output.splice(0);
			}
			beforeEach(cleanOutput);
		`,
		errors: [{ data: { name: "output" }, messageId }],
	},
	// Mutually recursive helpers terminate and still report.
	{
		code: unindent`
			let depth = 0;
			function ping(n) {
				depth += 1;
				return n === 0 ? 0 : pong(n - 1);
			}
			function pong(n) {
				return n === 0 ? 0 : ping(n - 1);
			}
			it("recurses", () => {
				pong(3);
			});
		`,
		errors: [{ data: { name: "depth" }, messageId }],
	},
	// TestEZ wraps the tests in an exported function; its locals are shared.
	{
		code: unindent`
			export = () => {
				let completed = 0;
				it("counts", () => {
					completed += 1;
				});
			};
		`,
		errors: [{ data: { name: "completed" }, messageId }],
	},
	// A parameterized suite's parameter is shared by the tests inside it.
	{
		code: unindent`
			describe.each([[[]]])("suite", (items) => {
				it("pushes", () => {
					items.push(1);
				});
			});
		`,
		errors: [{ data: { name: "items" }, messageId }],
	},
	// Global statics that mutate their first argument.
	{
		code: unindent`
			const state = {};
			const target = {};
			it("assigns", () => {
				Object.assign(state, { a: 1 });
				Reflect.set(target, "a", 1);
			});
		`,
		errors: [
			{ data: { name: "state" }, messageId },
			{ data: { name: "target" }, messageId },
		],
	},
	// An alias of a global is a binding this file owns.
	{
		code: unindent`
			describe("order", () => {
				const orderGlobal = globalThis as { order?: Array<string> };
				beforeEach(() => {
					orderGlobal.order = [];
				});
				afterEach(() => {
					delete orderGlobal.order;
				});
			});
		`,
		errors: [{ data: { name: "orderGlobal" }, messageId }],
	},
	// \`var\` leaks all the same, and only the written half of a destructure is
	// reported.
	{
		code: unindent`
			var legacy = 0;
			let { read, written } = load();
			it("writes", () => {
				legacy = 1;
				written = read;
			});
		`,
		errors: [
			{ data: { name: "legacy" }, messageId },
			{ data: { name: "written" }, line: 2, messageId },
		],
	},
	// An aliased import resolves to the test global.
	{
		code: unindent`
			import { it as check } from "vitest";
			let count = 0;
			check("counts", () => {
				count += 1;
			});
		`,
		errors: [{ data: { name: "count" }, messageId }],
	},
	// With \`settings.jest.globalPackage\`, that package's \`it\` is the test.
	{
		code: unindent`
			import { it } from "@rbxts/jest-globals";
			let count = 0;
			it("counts", () => {
				count += 1;
			});
		`,
		errors: [{ data: { name: "count" }, messageId }],
		settings: { jest: { globalPackage: "@rbxts/jest-globals" } },
	},
	// roblox-ts array methods mutate too.
	{
		code: unindent`
			const list = [];
			it("inserts", () => {
				list.insert(0, 1);
				list.unorderedRemove(0);
			});
		`,
		errors: [{ data: { name: "list" }, messageId }],
	},
	// Extra mutating methods come from the options.
	{
		code: unindent`
			const queue = createQueue();
			it("enqueues", () => {
				queue.enqueue(1);
			});
		`,
		errors: [{ data: { name: "queue" }, messageId }],
		options: [{ additionalMutatingMethods: ["enqueue"] }],
	},
	// A mock rebuilt in \`beforeEach\` is shared state here, even though
	// no-shared-mocks allows it.
	{
		code: unindent`
			let mockFn = vi.fn();
			beforeEach(() => {
				mockFn = vi.fn();
			});
			it("calls", () => {
				expect(mockFn).not.toHaveBeenCalled();
			});
		`,
		errors: [{ data: { name: "mockFn" }, messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noSharedTestState,
	valid,
});
