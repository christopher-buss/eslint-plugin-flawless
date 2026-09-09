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

## Factory functions

When a same-file helper closes over one of the imports, the autofix threads the
whole context through the helper and annotates its new parameter as
`context: TestContext` in TypeScript files:

```ts
import { it, type TestContext } from "vitest";

function registerCleanup(context: TestContext): void {
	context.onTestFinished(() => cleanup());
}

it("cleans up", (context) => {
	registerCleanup(context);
});
```

The fix follows calls through multiple local helpers. It is withheld when
changing the helper signature cannot be shown to be local and safe—for example,
when the helper is exported, escapes as a value, has a rest parameter, or is
called outside a test or another tracked helper.

If a helper only receives an imported API as an argument, its signature does not
need to change. The test callback simply destructures that API and passes the
local binding as before.

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

This rule has no options.
