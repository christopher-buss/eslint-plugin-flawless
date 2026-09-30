# Prefer `mockThrow` / `mockThrowOnce` over a mock implementation that only throws

📝 Prefer `mockThrow` / `mockThrowOnce` over a mock implementation that only
throws.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Vitest 4.1 added `mockThrow(value)` and `mockThrowOnce(value)` for a mock that
should throw. This rule reports a `mockImplementation` or
`mockImplementationOnce` whose implementation does nothing but throw, and fixes
it to the dedicated method:

```ts
mock.mockImplementation(() => {
	throw new Error("offline");
});
// becomes
mock.mockThrow(new Error("offline"));
```

The receiver is not checked to be a mock; any `.mockImplementation(...)` call is
considered, as in `eslint-plugin-jest` and `eslint-plugin-vitest`. Optional
calls (`mock?.mockImplementation(...)`) and string-keyed access
(`mock["mockImplementation"](...)`) are handled too.

> [!NOTE]
>
> `mockThrow` and `mockThrowOnce` need Vitest 4.1 or later.

### When the rule stays silent

Every report is autofixed. The rule therefore reports only when the rewrite
cannot change what the test does, and stays silent otherwise.

`mockThrow(value)` evaluates `value` once, when the mock is set up. The
implementation evaluates it on every call, which may be much later. The two
agree only when the thrown value has no side effects and reads nothing that can
change in between. The rule accepts:

- literals, and template literals built from accepted values;
- `const` bindings and classes declared before the call, parameters and `catch`
  bindings that are never reassigned, function declarations, imports, and
  globals such as `Error`;
- object and array literals of accepted values, without spreads or methods;
- `new Callee(...)` with an accepted callee and accepted arguments.

It stays silent for anything else, including:

- calls (`makeError()`) and member accesses (`state.error`, `errors[i]`), which
  can run a getter or read a value that changes later;
- `let` and `var` bindings, and any binding assigned after its declaration;
- a binding declared after the call, which the eager argument would read in its
  temporal dead zone — as would any outer binding read from inside a hoisted
  `vi.mock()` or `vi.hoisted()` factory, or from a function declaration (which
  can be called before the binding is initialized);
- `this`, `arguments`, and `new.target`, which mean something else once moved
  out of the implementation.

The implementation itself must be a single `throw` statement. The rule also
stays silent for an `async` function (which rejects instead of throwing), a
generator (which throws only once iterated), an implementation that reads its
parameters, and one whose parameters have defaults or destructuring (which run
before the `throw`).

`vi.fn(() => { throw error; })` is not reported. `mockReset()` — and
`vi.resetAllMocks()` or the `mockReset` config option — restores an
implementation passed to `vi.fn()`, but clears one set by `mockThrow`, so
`vi.fn().mockThrow(error)` would stop throwing after a reset.

### Comments

Comments in the implementation are kept: the fix moves them in front of the
thrown value. When one is a line comment, the argument is laid out on its own
lines.

### Caveat: one value for every call

A `new Error(...)` thrown from an implementation is a fresh error on every call,
with a stack trace that points at the call. After the fix, every call throws the
same error, whose stack trace points at the setup. The rule still reports this
case: a test that depends on the stack trace, or on each call throwing a
distinct object, is rare. Keep the implementation — and disable the rule on that
line — if yours does.

## Examples

Examples of **incorrect** code for this rule:

```ts
vi.fn().mockImplementation(() => {
	throw new Error("offline");
});

vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
	throw new Error("missing");
});

const error = new TypeError("nope");
mock.mockImplementation(function () {
	throw error;
});
```

Examples of **correct** code for this rule:

```ts
vi.fn().mockThrow(new Error("offline"));

vi.spyOn(fs, "readFileSync").mockThrowOnce(new Error("missing"));

// A fresh error from a factory on every call.
mock.mockImplementation(() => {
	throw makeError();
});

// The implementation reads its arguments.
mock.mockImplementation((path) => {
	throw new Error(`missing: ${path}`);
});

// An async function rejects rather than throws.
mock.mockImplementation(async () => {
	throw new Error("offline");
});
```

## Further Reading

- [Vitest: `mockThrow`](https://vitest.dev/api/mock#mockthrow)
- [eslint-plugin-vitest#949](https://github.com/vitest-dev/eslint-plugin-vitest/pull/949),
  the upstream rule this is ported from
