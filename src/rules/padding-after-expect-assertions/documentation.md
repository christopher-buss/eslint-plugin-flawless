# Enforce a blank line after `expect.assertions` and `expect.hasAssertions`

📝 Enforce a blank line after `expect.assertions` and `expect.hasAssertions`.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

`expect.assertions(n)` and `expect.hasAssertions()` are bookkeeping — they
declare how the test will be counted, not what it asserts. Separating that
declaration from the expectations with a blank line makes the body of the test
easier to scan.

This rule requires a blank line after such a statement whenever another
statement follows it. It works for both Jest and Vitest, since it only inspects
the `expect.assertions` / `expect.hasAssertions` call itself.

The padding rules shipped by `eslint-plugin-jest` and `@vitest/eslint-plugin`
cannot express this. Their `padding-around-expect-groups` matches a statement by
its first token, so `expect.assertions(2)` and `expect(x).toBe(2)` are both
treated as "expect" statements and are explicitly allowed to sit together with
no blank line. This rule fills that gap without contradicting them: those rules
only ever _require_ padding, never forbid it, so the two coexist.

Padding _before_ the assertion is intentionally not enforced —
`prefer-expect-assertions` already requires it to be the first statement of the
test.

## Examples

Examples of **incorrect** code for this rule:

```ts
it("divides two numbers", () => {
	expect.assertions(1);
	expect(divide(10, 2)).toBe(5);
});
```

Examples of **correct** code for this rule:

```ts
it("divides two numbers", () => {
	expect.assertions(1);

	expect(divide(10, 2)).toBe(5);
});
```

Consecutive expectations still need no blank line between them:

```ts
it("divides two numbers", () => {
	expect.assertions(2);

	expect(divide(10, 2)).toBe(5);
	expect(divide(9, 3)).toBe(3);
});
```

## Autofix

The fix inserts a single blank line after the assertion statement. A trailing
comment on the same line keeps its position (the blank line lands after it), and
existing extra blank lines are left as they are — the rule requires _at least_
one blank line, not exactly one.

## Further Reading

- [`vitest/prefer-expect-assertions`](https://github.com/vitest-dev/eslint-plugin-vitest/blob/main/docs/rules/prefer-expect-assertions.md)
- [`vitest/padding-around-expect-groups`](https://github.com/vitest-dev/eslint-plugin-vitest/blob/main/docs/rules/padding-around-expect-groups.md)
