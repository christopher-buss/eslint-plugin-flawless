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

`expect` is resolved the way vitest and jest test helpers are: an `expect` used
as a global (the default with vitest's `globals: true` or jest's injected
globals) or imported from `"vitest"`, `"@jest/globals"`, or `"bun:test"` is
recognised, and aliases work. A locally-declared `expect` is ignored. The
property access is otherwise syntactic — a non-computed `expect.hasAssertions()`
call.

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
_replaces_ the built-in sources rather than adding to them, so an `expect`
imported from `"vitest"` is no longer recognised once it is set. A global
`expect` stays recognised either way.

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
