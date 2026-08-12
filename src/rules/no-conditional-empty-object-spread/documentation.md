# Disallow conditional empty-object spreads

📝 Disallow conditional empty-object spreads.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Conditional empty-object spreads hide a choice between omitting a property and
creating it. That distinction matters to `Object.keys`, the `in` operator,
subsequent object spreads, and TypeScript projects using
`exactOptionalPropertyTypes`.

Use a direct property when an explicit `undefined` value is acceptable. When the
property must remain absent, build the base object first and add the property in
a separate statement.

This rule deliberately has no automatic fix because those two replacements have
different runtime and type-system behavior.

## Examples

Examples of **incorrect** code for this rule:

```js
const options = {
	...(timeout !== undefined ? { timeout } : {}),
};
```

Examples of **correct** code for this rule:

```js
const valueOptions = { timeout };

const spawnOptions = {};
if (timeout !== undefined) {
	spawnOptions.timeout = timeout;
}
```

This rule has no options.

```json
{
	"flawless/no-conditional-empty-object-spread": "error"
}
```
