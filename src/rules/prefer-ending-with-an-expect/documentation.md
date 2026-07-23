# Prefer having the last statement in a test be an assertion

📝 Prefer having the last statement in a test be an assertion.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A test whose last statement is not an assertion is often unfinished: the setup
and actions are there, but the `expect` that verifies the result was never
written. This rule reports any `it`/`test` whose body does not end in an
assertion.

This is a port of
[`jest/prefer-ending-with-an-expect`](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/prefer-ending-with-an-expect.md)
(MIT), retargeted at **vitest**. `it`, `test`, and `expect` are recognised when
they are vitest globals (the default with `globals: true`) or imported from
`"vitest"`; a locally-declared `it`/`test`/`expect` is ignored. `describe` is
not a test block, and an empty test body is treated as having no ending
assertion.

The last statement is unwrapped through a trailing `await`, so
`await expect(promise).resolves.toBe(1)` satisfies the rule.

## Examples

Examples of **incorrect** code for this rule:

```js
it("updates selection", () => {
	container.setProp("selected", 2);
	// no assertion — likely unfinished
});
```

Examples of **correct** code for this rule:

```js
it("updates selection", () => {
	container.setProp("selected", 2);
	expect(container.toHTML()).toContain('<option value="2" selected>');
});
```

## Options

This rule takes an optional object:

- `assertFunctionNames` (`string[]`, default `["expect"]`) — function names,
  besides a resolved vitest `expect`, that count as an assertion when they end a
  test. Matched by name against the callee chain (no scope resolution). `*`
  matches a single dotted segment and `**` matches any run of segments, so
  `request.**.expect` accepts a chained `request(app).get("/").expect(200)`.
- `additionalTestBlockFunctions` (`string[]`, default `[]`) — callee names,
  besides a resolved vitest `it`/`test`, whose second argument is treated as a
  test body. Matched by exact dotted name, for libraries with custom test blocks
  such as `each.test`.

<!-- begin auto-generated rule options list -->

| Name                           | Description                                                                                                                | Type     | Default    |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------- | :------- | :--------- |
| `additionalTestBlockFunctions` | Callee names, besides a resolved vitest it/test, whose second argument is a test body (matched by exact dotted name).      | String[] | `[]`       |
| `assertFunctionNames`          | Function names, besides a resolved vitest expect, that count as an assertion (matched by name; \* and \*\* are wildcards). | String[] | [`expect`] |

<!-- end auto-generated rule options list -->

Example configuration:

```json
{
	"flawless/prefer-ending-with-an-expect": [
		"error",
		{ "assertFunctionNames": ["expect", "expectTypeOf"] }
	]
}
```
