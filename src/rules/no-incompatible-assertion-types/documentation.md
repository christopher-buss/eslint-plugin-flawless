# Disallow equality assertions whose operands have types that can never be equal

📝 Disallow equality assertions whose operands have types that can never be
equal.

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A strict or deep equality assertion between two values whose types can never be
equal always has the same result. `expect(count).toBe("1")` always fails when
`count` is a `number`, and `expect(count).not.toBe("1")` always passes. Such an
assertion usually compares the wrong value, or a value of the wrong type.

The rule reads the type of each operand from TypeScript, widens literal types
(`1` to `number`), and puts each union member in one of these families:
`string`, `number`, `boolean`, `bigint`, `symbol`, `null`, `undefined`, or
`object`. Enum members go in the family of their values. The rule reports when
no member of one operand shares a family with a member of the other.

The rule does not report when:

- An operand has an `any`, `unknown`, or type parameter member, or a member that
  is not in a family above.
- An operand has an `object`, `null`, or `undefined` member.
- An operand reads a variable (directly or through a member chain such as
  `user.id` or `user?.id`) that another write can change. This is so when a
  write has a type that is not in a family above (for example
  `value = readAny()`), or when the write is an increment or decrement
  (`value++`).
- An operand calls a method of a variable after the file assigns a function to a
  property of that variable with `=` (`api.get = () => ...`). A test that
  replaces a method can make the method return a value of a different type.

The rule checks these assertions:

- `toBe`, `toEqual`, and `toStrictEqual` called as `expect(actual).matcher(x)`
  or `expect(actual).not.matcher(x)`, with exactly one argument to `expect` and
  to the matcher. `expect` is the global `expect` (Vitest `globals: true` or
  Jest injected globals) or an `expect` imported from `vitest`, `@jest/globals`,
  or `bun:test`, with or without an alias. A local `expect` binding is ignored.
  A project that imports the test globals from a re-export names that package
  with `settings.jest.globalPackage` (the same setting `eslint-plugin-jest`
  reads, e.g. `{ jest: { globalPackage: "@rbxts/jest-globals" } }`). The setting
  takes a single package name and _replaces_ the three built-in sources.
- Node `strictEqual`, `notStrictEqual`, `deepStrictEqual`, and
  `notDeepStrictEqual` imported from `assert`, `assert/strict`, `node:assert`,
  or `node:assert/strict`, through a default, namespace, or named import. The
  `strict` object (`import { strict as assert } from "node:assert"` or
  `assert.strict.deepEqual(...)`) is also checked. `deepEqual` and
  `notDeepEqual` count only from `assert/strict`, `node:assert/strict`, or the
  `strict` object: elsewhere they compare loosely. `equal`, `notEqual`, and `ok`
  are ignored.

The rule needs type information. Without it (for example under oxlint), the rule
does nothing.

## Examples

Examples of **incorrect** code for this rule:

```ts
import { expect } from "vitest";

declare const count: number;

expect(count).toBe("1");
expect(count).not.toEqual(true);
```

```ts
import assert from "node:assert";

declare const label: string;

assert.strictEqual(label, 1);
```

Examples of **correct** code for this rule:

```ts
import { expect } from "vitest";

declare const count: number;
declare const either: number | string;

expect(count).toBe(1);
expect(either).toBe("1");
```

```ts
import assert from "node:assert";

declare const count: number;

// `equal` and `deepEqual` from `node:assert` compare loosely.
assert.equal(count, "1");
```

## Deliberate exclusions

- Chai, Cypress, Jasmine, Playwright, and other assertion libraries are not
  checked.
- An `assert` object that is not imported (for example, a parameter of a test
  callback) is not checked.
- `const assert = require("node:assert")` and
  `import assert = require("node:assert")` are not checked.
- The `.resolves` and `.rejects` modifiers and the `expect.soft` and
  `expect.poll` variants are not checked.

Related: SonarJS S5845.
