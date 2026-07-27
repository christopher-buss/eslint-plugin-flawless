# Disallow exact equality checks involving floating-point-sensitive values

📝 Disallow exact equality checks involving floating-point-sensitive values.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Most decimal fractions cannot be represented exactly by JavaScript's binary
floating-point numbers. Exact equality checks involving those values can
therefore fail even when the underlying calculation is conceptually correct. Use
a tolerance or range comparison instead.

The rule reports:

- `==`, `!=`, `===`, and `!==` involving an inexact decimal, exponent literal,
  arithmetic expression, or a simple transitive `const` alias of one.
- Indirect exact checks such as `value <= 0.3 && value >= 0.3` and
  `value < 0.3 || value > 0.3`.
- Floating-point-sensitive `switch` case labels.
- `toBe` assertions made through an explicitly imported `expect` from `vitest`,
  `@jest/globals`, or `bun:test`, including `.not.toBe`.
- Node `strictEqual` and `notStrictEqual` assertions imported from `assert`,
  `assert/strict`, `node:assert`, or `node:assert/strict`. Default, namespace,
  named, and aliased imports are supported.

Decimal literals that are exactly representable in binary, such as `0.5`, are
accepted. Literal arithmetic is constant-folded, and expressions whose result is
a safe integer are accepted. Integer division is reported only when it produces
a non-exact binary fraction.

## Examples

Examples of **incorrect** code for this rule:

```ts
if (total === 0.3) {
	publish(total);
}

const expected = 0.1 + 0.2;
const matches = actual === expected;
```

```ts
import { expect } from "vitest";

expect(calculateTax()).not.toBe(0.3);
```

Examples of **correct** code for this rule:

```ts
const closeEnough = Math.abs(total - 0.3) < Number.EPSILON;
const exactAnchor = total === 0.5;
const foldedInteger = total === 1000 * 1.2;
```

## Deliberate exclusions

This rule does not use TypeScript type information and does not infer whether an
arbitrary variable contains a floating-point value. Mutable variables,
parameters, imported values, and destructured bindings are not followed.

Only the explicitly imported assertion APIs listed above are recognized.
Unimported global `expect` calls and Chai, Cypress, Playwright, or other
assertion libraries are intentionally ignored.
