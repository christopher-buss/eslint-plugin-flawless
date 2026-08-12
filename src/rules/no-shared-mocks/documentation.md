# Disallow mocks created once and shared between tests

📝 Disallow mocks created once and shared between tests.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A mock function created at module scope is created once for the whole file. It
records every call from every test and keeps whatever implementation the last
test gave it. The file therefore only behaves if each test remembers to reset it
by hand — and nothing enforces that. Forget once and a test reads state left
behind by an earlier one, so it passes on its own and fails when the tests run
in a different order.

This rule reports a binding that outlives the tests reading it and whose
initializer creates a mock — `jest.fn()`, `vi.fn()`, `jest.spyOn()`,
`vi.spyOn()`, or bun's `mock()` and `spyOn()`. That means a binding at module
scope, and one in a `describe` body, which is created once and then shared by
every test in the block. The mock is found wherever it sits in the initializer,
so a tuple destructure, an object of mocks, a chained `.mockReturnValue(...)`, a
mock passed as a call argument, and a mock returned from an immediately-invoked
function are all reported. Move the creation into a factory function that each
test calls, and the mock starts clean every time.

When the declaration destructures, the report lands on the whole binding pattern
rather than on one name, since a mock reached through an opaque initializer
cannot be attributed to a single binding.

A mock is **not** reported when it is created inside a function — a factory, a
test body, or a hook body — since that is the shape the rule asks for. A binding
reassigned to a fresh mock from inside a hook is left alone for the same reason,
whether or not it was initialized at the declaration:

```js
let mockFunc = jest.fn();

beforeEach(() => {
	mockFunc = jest.fn();
});
```

The rule cannot tell a factory from a callback that runs immediately, so a mock
created inside one that is passed elsewhere — `[1, 2].map(() => jest.fn())` —
goes unreported.

### The `jest.mock()` exemption

A module mock factory is hoisted above the rest of the file, so it cannot close
over anything but a module-scope binding. A mock referenced **only** from a
`jest.mock()` / `vi.mock()` factory (or their `doMock` variants, or bun's
`mock.module()`) is therefore treated as plumbing and is not reported. Reference
the same binding from a test and it becomes shared state again.

`jest` and `vi` are resolved the way vitest and jest test helpers are: used as a
global (the default with vitest's `globals: true` or jest's injected globals) or
imported from `"vitest"`, `"@jest/globals"`, or `"bun:test"`, with aliases
working. A locally-declared `jest` is ignored. Bun's bare `mock` and `spyOn` are
only recognised through a real import, since those names are too common to claim
as globals.

## Settings

A project that imports the test globals from a re-export names that package with
`settings.jest.globalPackage`, the same setting `eslint-plugin-jest` reads:

```js
export default [
	{
		settings: {
			jest: { globalPackage: "@rbxts/jest-globals" },
		},
	},
];
```

As in `eslint-plugin-jest`, the setting takes a single package name and
_replaces_ the built-in sources rather than adding to them, so a `jest` imported
from `"vitest"` is no longer recognised once it is set. A global `jest` stays
recognised either way.

## Examples

Examples of **incorrect** code for this rule:

```js
const mockResolve = jest.fn();

it("resolves the ref", () => {
	mockResolve.mockReturnValue(1);
	expect(resolve()).toBe(1);
});

it("counts the calls", () => {
	// Passes only because the test above happened to run first.
	expect(mockResolve).toHaveBeenCalledOnce();
});
```

A `describe` body is shared by every test inside it, so the same leak applies:

```js
describe("resolver", () => {
	const mockResolve = jest.fn();

	it("resolves the ref", () => {
		mockResolve.mockReturnValue(1);
		expect(resolve()).toBe(1);
	});

	it("counts the calls", () => {
		expect(mockResolve).toHaveBeenCalledOnce();
	});
});
```

Examples of **correct** code for this rule:

```js
function setupResolver() {
	const mockResolve = jest.fn();
	return { mockResolve, resolver: createResolver(mockResolve) };
}

it("resolves the ref", () => {
	const { mockResolve, resolver } = setupResolver();
	mockResolve.mockReturnValue(1);
	expect(resolver()).toBe(1);
});

it("counts the calls", () => {
	const { mockResolve, resolver } = setupResolver();
	resolver();
	expect(mockResolve).toHaveBeenCalledOnce();
});
```

A mock wired into a hoisted module mock factory, and used nowhere else, is
allowed:

```js
const mockHookFunction = jest.fn();

jest.mock("./replicator", () => ({ hook: mockHookFunction }));
```

## Further Reading

- [`jest.fn()`](https://jestjs.io/docs/jest-object#jestfnimplementation)
- [`vi.fn()`](https://vitest.dev/api/vi#vi-fn)
- [`jest.mock()`](https://jestjs.io/docs/jest-object#jestmockmodulename-factory-options)
