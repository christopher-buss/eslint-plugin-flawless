# Enforce a maximum number of lines of code in a function

📝 Enforce a maximum number of lines of code in a function.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Long functions are hard to read, hard to test, and usually doing more than one
job. This rule caps how many lines a function may span and reports the ones that
go over.

This is a port of ESLint core's
[`max-lines-per-function`](https://eslint.org/docs/latest/rules/max-lines-per-function)
(MIT, Copyright OpenJS Foundation and other contributors), with one deliberate
divergence: **the options must be given as an object.** Core also accepts a bare
integer, so `["error", 60]` is valid there; here it is not. Write
`["error", { "max": 60 }]` instead.

Diagnostics point at the function's head — `function foo`, a method's name, or
an arrow's `=>` — rather than underlining every line of the body.

## Examples

Examples of **incorrect** code with `{ "max": 3 }`:

```js
function longer() {
	const a = 1;
	const b = 2;
	return a + b;
}
```

Examples of **correct** code with `{ "max": 3 }`:

```js
function shorter() {
	return 1 + 2;
}
```

With `{ "max": 3, "skipBlankLines": true, "skipComments": true }`, blank lines
and lines holding nothing but a comment stop counting:

```js
function stillFine() {
	// This comment does not count.

	return 1 + 2;
}
```

A comment sharing a line with real code does **not** make that line skippable —
only lines that are entirely comment.

Immediately-invoked function expressions are ignored unless `IIFEs` is enabled:

```js
(function () {
	return 1;
})();
```

## Options

This rule takes an optional object:

- `max` (`integer`, default `50`) — the maximum number of lines a function may
  span.
- `skipBlankLines` (`boolean`, default `false`) — exclude lines containing only
  whitespace from the count.
- `skipComments` (`boolean`, default `false`) — exclude lines consisting solely
  of a comment from the count.
- `IIFEs` (`boolean`, default `false`) — also measure immediately-invoked
  function expressions.

<!-- begin auto-generated rule options list -->

| Name             | Description                                                               | Type    | Default |
| :--------------- | :------------------------------------------------------------------------ | :------ | :------ |
| `IIFEs`          | Whether immediately-invoked function expressions are measured.            | Boolean | `false` |
| `max`            | The maximum number of lines a function may span.                          | Integer | `50`    |
| `skipBlankLines` | Whether lines containing only whitespace are excluded from the count.     | Boolean | `false` |
| `skipComments`   | Whether lines consisting solely of a comment are excluded from the count. | Boolean | `false` |

<!-- end auto-generated rule options list -->

Example configuration:

```json
{
	"flawless/max-lines-per-function": [
		"error",
		{ "max": 60, "skipBlankLines": true, "skipComments": true }
	]
}
```
