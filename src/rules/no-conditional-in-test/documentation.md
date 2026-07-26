# Disallow conditional logic in tests

📝 Disallow conditional logic in tests.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A test that branches on runtime state does not test a single, deterministic
behavior: depending on which path runs, the assertions that execute (if any)
differ, and a test can silently pass without checking anything. This rule
reports conditional logic — `if`, `switch`, ternaries, and logical expressions
(`&&`/`||`/`??`) — directly inside a vitest `it`/`test` body, including inside
any functions declared there.

One exception: `&&` in the arguments of an assertion (`expect(…)`, `assert(…)`,
`assert.ok(…)`, `expect(x).toBe(…)`) is allowed. It is a compound condition
rather than a branch — both operands feed the single outcome the assertion
checks, and nothing that would otherwise have been asserted is skipped, so
`assert(typeof body === "object" && "timeout" in body)` reads as one assertion.
`||` and `??` stay reported even there, because they pick between values and so
hide which operand was actually tested. The exception does not cross a function
boundary: a `&&` inside a callback passed to an assertion
(`expect(() => f(a && b)).toThrow()`) runs on the callback's terms, not the
assertion's, and is still reported. An assertion callee is recognised by the
identifier its chain is rooted at (`expect`/`assert`, or a vitest import aliased
to one), so `assert` from `node:assert` counts.

Only the test body counts. A test block modifier's arguments — `skipIf`,
`runIf`, `each`, or a computed key such as `it[flag ? "only" : "skip"]` — decide
whether and how the test runs rather than what it does, so a conditional there
is allowed: `it.skipIf(isWindows || isCI)("works", …)` is the intended way to
express that, and rewriting it would not make the test any less conditional.

This is a port of
[`jest/no-conditional-in-test`](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-conditional-in-test.md)
(MIT), retargeted at **vitest** with wider coverage than
`eslint-plugin-vitest`'s equivalent (which only flags `if`). `it`/`test` are
recognised as vitest globals (the default with `globals: true`) or when imported
from `"vitest"`; a locally-declared `it`/`test` is ignored. `describe` blocks
and lifecycle hooks (`beforeEach`, `afterEach`, …) are not test bodies, so
conditional setup there is allowed.

Optional chaining (`?.`) is allowed by default. Setting `allowOptionalChaining`
to `false` reports it and **auto-fixes** it to a non-null assertion, since an
optional chain is itself a conditional (`a?.b` short-circuits when `a` is
nullish): `a?.b` becomes `a!.b`, `a?.[0]` becomes `a![0]`, and `fn?.()` becomes
`fn!()`. This fix changes runtime behavior — a nullish value now throws instead
of yielding `undefined` — which is the intent in a test: assert the value exists
rather than branch on it. The `!` non-null assertion is TypeScript syntax.

## Examples

Examples of **incorrect** code for this rule:

```js
it("reads a user", () => {
	if (user.admin) {
		expect(user.role).toBe("admin");
	}
});

test("computes a label", () => {
	expect(flag ? "on" : "off").toBe("on");
});

it("reads a body", () => {
	// `||` hides which operand was asserted.
	assert(body.timeout || body.deadline);
});
```

Examples of **correct** code for this rule:

```js
it("reads a user", () => {
	expect(user.role).toBe("admin");
});

// `&&` in an assertion is one compound condition, not a branch.
it("reads a body", () => {
	assert(typeof submitBody === "object" && "timeout" in submitBody);
});

// A modifier's arguments decide whether the test runs, not what it checks.
it.skipIf(isWindows || isCI)("reads a socket", () => {
	expect(socket.path).toBe("/tmp/app.sock");
});

// Conditional setup outside the test body is fine.
describe("admin", () => {
	beforeEach(() => {
		if (needsSeed) {
			seed();
		}
	});
});
```

## Options

This rule takes an optional object:

- `allowOptionalChaining` (`boolean`, default `true`) — allow optional chaining
  (`?.`) in tests. When `false`, optional chains are reported and auto-fixed to
  a non-null assertion (`a?.b` → `a!.b`).
- `additionalTestBlockFunctions` (`string[]`, default `[]`) — callee names,
  besides a resolved vitest `it`/`test`, whose call is treated as a test block.
  Matched by exact dotted name, for libraries with custom test blocks such as
  `each.test`.

<!-- begin auto-generated rule options list -->

| Name                           | Description                                                                                                              | Type     | Default |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------- | :------- | :------ |
| `additionalTestBlockFunctions` | Callee names, besides a resolved vitest it/test, whose call is a test block (matched by exact dotted name).              | String[] | `[]`    |
| `allowOptionalChaining`        | Allow optional chaining (?.) in tests. When false, it is reported and auto-fixed to a non-null assertion (a?.b -> a!.b). | Boolean  | `true`  |

<!-- end auto-generated rule options list -->

Example configuration:

```json
{
	"flawless/no-conditional-in-test": [
		"error",
		{ "allowOptionalChaining": false }
	]
}
```
