# Disallow state declared outside tests and written inside them

📝 Disallow state declared outside tests and written inside them.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A binding declared outside a test lives for as long as the scope it is declared
in — the whole file, or the whole `describe` block. When a test writes to it,
the next test starts from whatever the last one left behind. Each test then
passes on its own and fails when the tests run in a different order, or
concurrently.

This rule reports a binding that is declared outside a test or hook callback and
written from inside one. "Outside" means anywhere the callback does not own: the
module, a `describe` body, a `describe.each` parameter, or a function that
registers tests. A binding declared inside the test is rebuilt on every run and
is never reported, however deeply nested the closure that writes it.

A binding counts as written when the callback:

- reassigns it: `=`, `+=`, `??=`, `++`, a destructuring assignment, or a
  `for...of` / `for...in` target;
- writes through a member of it, at any depth: `x.a = 1`, `x[key] = 1`,
  `delete x.a`, `x.a.b++`;
- calls a mutating method on it: `push`, `pop`, `shift`, `unshift`, `splice`,
  `sort`, `reverse`, `fill`, `copyWithin`, `set`, `add`, `delete`, `clear`, and
  roblox-ts's `insert`, `remove` and `unorderedRemove`;
- passes it as the first argument to `Object.assign`, `Object.defineProperty`,
  `Object.defineProperties`, `Object.setPrototypeOf`, `Reflect.set`,
  `Reflect.deleteProperty`, `Reflect.defineProperty` or
  `Reflect.setPrototypeOf`;
- references a function declared in the file that does any of the above,
  followed through other such functions and into the closures they return.

Optional chaining (`x?.push()`) and type-only wrappers (`x!`, `x as T`) do not
hide the binding. Reading a binding is always allowed — a binding no test writes
is a constant.

The callbacks checked are those passed to `it`, `test`, `fit`, `xit`, `xtest`,
`beforeEach`, `afterEach`, `beforeAll` and `afterAll`, in any callee shape
(`it.each(rows)(...)`, ``test.each`...`(...)``, `it.for(...)(...)`,
`it.skipIf(cond)(...)`, `test.only(...)`), and a named function passed in their
place (`beforeEach(resetState)`). A `describe` body is not a test: it runs once,
while the tests are collected, so a write there is not reported.

Each binding is reported once, on its declaration.

### Hooks do not make state safe

A binding rebuilt in `beforeEach` does not carry values between tests — until
someone deletes, moves or narrows the hook. The same holds for a reset in
`afterEach` (`store.clear()`, `list.length = 0`). The test still depends on a
hook it cannot see, so hooks earn no exemption. `beforeAll` and `afterAll` write
once and share the result with every test, so they are reported too.

This is stricter than `no-shared-mocks`, which allows a mock rebuilt in
`beforeEach`. Such a binding is reported by this rule.

### Limits

The rule has no type information, so a mutating method is recognized by name
only. Add your own with the `additionalMutatingMethods` option. The rule does
not follow:

- aliases: `const roots = byName.get(key) ?? []; roots.push(1)`;
- a binding passed to a function that mutates it: `fill(list)`;
- methods of objects: `helpers.reset()`;
- a value returned from a method call: `groups.get(key).push(1)`.

Imported bindings, globals (`process.argv = ...`, `console.warn = ...`),
functions, classes, enums and namespaces are not reported: their state belongs
to another module or to the runtime.

A `const` declared in a module-scope `for` loop that registers tests is
reported: it is shared by every test registered in the same iteration.

`it` and friends are resolved as globals or as imports from `"vitest"`,
`"@jest/globals"` or `"bun:test"`, with aliases working. A locally declared `it`
is ignored.

## Options

<!-- begin auto-generated rule options list -->

| Name                        | Description                                                                             | Type     |
| :-------------------------- | :-------------------------------------------------------------------------------------- | :------- |
| `additionalMutatingMethods` | Method names, besides the built-in ones, whose call mutates the object it is called on. | String[] |

<!-- end auto-generated rule options list -->

### `additionalMutatingMethods`

Method names, besides the built-in ones, whose call mutates the object it is
called on.

```js
export default [
	{
		rules: {
			"flawless/no-shared-test-state": [
				"error",
				{ additionalMutatingMethods: ["enqueue", "reset"] },
			],
		},
	},
];
```

## Settings

A project that imports the test globals from a re-export names that package with
`settings.jest.globalPackage`, as for `no-shared-mocks`. The setting replaces
the built-in sources rather than adding to them.

## Examples

Examples of **incorrect** code for this rule:

```js
let store = new Map();

beforeEach(() => {
	store = new Map();
});

it("writes", () => {
	store.set("a", 1);
	expect(store.size).toBe(1);
});
```

A helper called from each test is a `beforeEach` by another name:

```js
let calls = 0;

function track() {
	calls += 1;
}

it("tracks once", () => {
	track();
	expect(calls).toBe(1);
});

it("tracks again", () => {
	track();
	// Passes only when this test runs on its own.
	expect(calls).toBe(1);
});
```

Examples of **correct** code for this rule:

```js
function createStore() {
	return new Map();
}

it("writes", () => {
	const store = createStore();
	store.set("a", 1);
	expect(store.size).toBe(1);
});
```

State a factory creates belongs to the call, not to the file:

```js
function createTracker() {
	let calls = 0;
	return {
		calls: () => calls,
		track: () => {
			calls += 1;
		},
	};
}

it("tracks once", () => {
	const tracker = createTracker();
	tracker.track();
	expect(tracker.calls()).toBe(1);
});
```

## Further Reading

- [`no-shared-mocks`](../no-shared-mocks/documentation.md)
- [Vitest: test context](https://vitest.dev/guide/test-context)
