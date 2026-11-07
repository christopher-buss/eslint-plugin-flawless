# Limit comments by word count

📝 Limit comments by word count.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A long comment often restates what the code already says. This rule reports a
comment group that holds more words than the configured maximum. Keep only the
context that the code cannot express.

Line comments on consecutive lines, with only whitespace between them, form one
group. A blank line, code, or a block comment starts a new group. A block
comment is always a group of its own.

A word is a run of non-whitespace characters. In a block comment, one `*` gutter
at the start of each line is not a word.

These comments are not checked:

- The first group in the file, when only whitespace or a shebang comes before
  it. This is the file header.
- A lone `/** ... */` block, when `ignoreJSDoc` is on (the default).

## Examples

Examples of **incorrect** code for this rule, with `{ "maximumWords": 8 }`:

```ts
export const retries = 3;

// Retry three times because the upstream service sometimes drops the first
// request after a cold start, and two retries were not always enough.
export const timeout = 500;
```

Examples of **correct** code for this rule, with `{ "maximumWords": 8 }`:

```ts
export const retries = 3;

// The upstream service drops requests on cold start.
export const timeout = 500;
```

## Options

<!-- begin auto-generated rule options list -->

| Name           | Description                                             | Type    | Default |
| :------------- | :------------------------------------------------------ | :------ | :------ |
| `ignoreJSDoc`  | Whether a lone `/** ... */` block is exempt.            | Boolean | `true`  |
| `maximumWords` | The maximum number of words one comment group may hold. | Integer | `50`    |

<!-- end auto-generated rule options list -->

```json
{
	"flawless/max-comment-length": [
		"error",
		{ "ignoreJSDoc": true, "maximumWords": 50 }
	]
}
```
