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
(MIT, Copyright OpenJS Foundation and other contributors), with two deliberate
divergences:

1. **By default it counts the function body, not the whole function** — see the
   [`countFrom`](#countfrom) option below. This is the reason the rule exists
   here; pass `{ "countFrom": "function" }` for exact core parity.
2. **The options must be given as an object.** Core also accepts a bare integer,
   so `["error", 60]` is valid there; here it is not. Write
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

- `countFrom` (`"body" | "function"`, default `"body"`) — where the counted
  range begins. See below.
- `max` (`integer`, default `50`) — the maximum number of lines a function may
  span.
- `skipBlankLines` (`boolean`, default `false`) — exclude lines containing only
  whitespace from the count.
- `skipComments` (`boolean`, default `false`) — exclude lines consisting solely
  of a comment from the count.
- `IIFEs` (`boolean`, default `false`) — also measure immediately-invoked
  function expressions.

### `countFrom`

`"body"` (the default) counts from the line holding the body's opening brace
through the line holding its closing brace. Lines spent purely on the signature
— destructured parameters, a long parameter list, multi-line generics or return
types, decorators — do not count against `max`. `"function"` counts the whole
function node, matching ESLint core.

Why the default differs from core: the formatter, not you, decides how a
signature wraps. These two functions have the identical body, yet core counts
the second as five lines longer purely because the destructure moved into the
parameter position:

```ts
// 6 lines under "body"; 6 under "function"
function logResult(result: BundleResultInfo): void {
	extract();
	resolve();
	generate();
	report();
}

// 6 lines under "body"; 11 under "function"
function logResult({
	declarationOutputPath,
	moduleCount,
	outputPath,
	timing,
}: BundleResultInfo): void {
	extract();
	resolve();
	generate();
	report();
}
```

Under `"body"` both count 6, so reformatting the signature never trips the
limit. Note the opening-brace line is still counted, and it is usually also the
last line of the signature (`): void {`), so exactly one signature line always
remains in the total.

<!-- begin auto-generated rule options list -->

| Name             | Description                                                                                                                 | Type    | Choices            | Default |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------ | :----------------- | :------ |
| `countFrom`      | Where the counted range begins: "body" (default) excludes the signature, "function" counts the whole node like ESLint core. | String  | `body`, `function` | `body`  |
| `IIFEs`          | Whether immediately-invoked function expressions are measured.                                                              | Boolean |                    | `false` |
| `max`            | The maximum number of lines a function may span.                                                                            | Integer |                    | `50`    |
| `skipBlankLines` | Whether lines containing only whitespace are excluded from the count.                                                       | Boolean |                    | `false` |
| `skipComments`   | Whether lines consisting solely of a comment are excluded from the count.                                                   | Boolean |                    | `false` |

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
