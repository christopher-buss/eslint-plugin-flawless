# Prefer test-bound Vitest APIs from the local test context

📝 Prefer test-bound Vitest APIs from the local test context.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Vitest exposes `expect`, `onTestFailed`, and `onTestFinished` both as module
imports and on each test's context. This rule requires the context form inside
tests. The context form makes the API explicitly test-bound and is safe for
concurrent tests, including snapshot assertions.

The rule recognises `it` and `test` imported from `"vitest"`, aliases of those
imports, modifiers such as `.concurrent`, and test functions created with
`test.extend`. Existing custom fixture destructuring is preserved.

This expands the idea behind Vitest's
[`require-local-test-context-for-concurrent-snapshots`](https://github.com/vitest-dev/eslint-plugin-vitest/blob/main/docs/rules/require-local-test-context-for-concurrent-snapshots.md)
rule from concurrent snapshot matchers to every use of the three APIs that have
an equivalent test-context property.

## Test callbacks

The autofix destructures the fixtures in the test's parameter list, so a test
can keep `expect.assertions(n)` or `expect.hasAssertions()` as its first
statement. An existing `context` parameter that the test only reads through
plain properties (`context.task`, `context.onTestFinished`) is turned into a
destructuring pattern too. If the context escapes as a whole value, or a new
binding would shadow a name the test already uses, the fix falls back to
`context.expect`.

## Factory functions

When a same-file helper closes over one of the imports, the autofix gives the
helper one parameter per fixture it uses, typed from `TestContext` in TypeScript
files, and passes the test's bindings through:

```ts
import { it, type TestContext } from "vitest";

function registerCleanup(onTestFinished: TestContext["onTestFinished"]): void {
	onTestFinished(() => cleanup());
}

it("cleans up", ({ onTestFinished }) => {
	registerCleanup(onTestFinished);
});
```

The fix follows calls through multiple local helpers. It is withheld when
changing the helper signature cannot be shown to be local and safe—for example,
when the helper is exported, escapes as a value, has a rest parameter, or is
called outside a test or another tracked helper.

If a helper only receives an imported API as an argument, its signature does not
need to change. The test callback simply destructures that API and passes the
local binding as before.

A helper that already takes a `context: TestContext` parameter keeps it; the fix
reads the fixtures from it.

## Parameterised tests

`test.for` is supported because Vitest passes its test context as the second
callback argument. `test.each` is intentionally ignored: its callback receives
only the table values, not a test context.

## Examples

Examples of **incorrect** code for this rule:

```ts
import { expect, it, onTestFinished } from "vitest";

it("works", () => {
	onTestFinished(() => cleanup());
	expect(1 + 2).toBe(3);
});
```

Examples of **correct** code for this rule:

```ts
import { it } from "vitest";

it("works", ({ expect, onTestFinished }) => {
	onTestFinished(() => cleanup());
	expect(1 + 2).toBe(3);
});
```

## Options

<!-- begin auto-generated rule options list -->

| Name        | Description                                                                                                                                                                          | Type    |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------ |
| `maxParams` | Most parameters a helper may have after the autofix threads fixtures through it. Past this, the fixtures go in one object parameter; if that also does not fit, the fix is withheld. | Integer |

<!-- end auto-generated rule options list -->

### `maxParams`

The most parameters a helper may have after the fix. Set it to match your
`max-params` limit. When one parameter per fixture would go past it, the
fixtures go in one object parameter instead:

```ts
function check(
	left: number,
	right: number,
	{ expect, onTestFinished }: Pick<TestContext, "expect" | "onTestFinished">,
): void {
	onTestFinished(() => cleanup());
	expect(left).toBe(right);
}
```

If even that parameter does not fit, the rule reports without a fix. There is no
limit by default.

```js
export default [
	{
		rules: {
			"flawless/prefer-vitest-local-context": ["error", { maxParams: 3 }],
		},
	},
];
```
