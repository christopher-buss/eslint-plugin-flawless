# Prefer `expect.assertions(<count>)` over `expect.hasAssertions()`

📝 Prefer `expect.assertions(<count>)` over `expect.hasAssertions()`.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Both vitest and jest offer two ways to assert that a test actually ran its
expectations. `expect.hasAssertions()` checks that _at least one_ assertion ran,
while `expect.assertions(n)` checks that _exactly `n`_ ran. The counted form is
the stronger guarantee: it catches an expectation that was skipped by an early
return, an untaken branch, or a loop that never iterated — cases where
`hasAssertions()` is still satisfied by the other assertions.

This rule reports any `expect.hasAssertions()` call and asks you to replace it
with the counted form. It does not add or rewrite the count for you — you supply
the number that matches the test.

Detection is purely syntactic: any non-computed `expect.hasAssertions()` call is
flagged, whether `expect` is a global or imported from `"vitest"` or
`"@jest/globals"`. A locally shadowed `expect` is not resolved, so the rare
`const expect = ...; expect.hasAssertions()` is still reported; disable it
inline if needed.

## Examples

Examples of **incorrect** code for this rule:

```js
it("divides", () => {
	expect.hasAssertions();
	expect(divide(10, 2)).toBe(5);
});
```

Examples of **correct** code for this rule:

```js
it("divides", () => {
	expect.assertions(1);
	expect(divide(10, 2)).toBe(5);
});
```
