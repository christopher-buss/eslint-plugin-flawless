# Disallow em dashes in comments, strings, JSX text, and Markdown prose

📝 Disallow em dashes in comments, strings, JSX text, and Markdown prose.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

An em dash (U+2014) splices two thoughts into one long sentence. Two shorter
sentences, or a comma, usually read better. This rule reports each prose
sentence that contains an em dash.

The rule checks prose only:

- **JS/TS** (ESLint and oxlint): comments, string literals (including JSX
  attribute strings), template literal text, and JSX text. Dashes elsewhere,
  such as in a regex literal, are not reported.
- **Markdown** (ESLint only, with the `markdown/commonmark` or `markdown/gfm`
  language from `@eslint/markdown`): text in paragraphs, headings, and table
  cells, plus image alt text and link, image, and definition titles. Code
  blocks, inline code, HTML, and autolinks are not reported. An alt text or
  title whose source holds escapes or entities is skipped.

A sentence runs back from the dash to the previous line break or `.`, `!`, `?`,
and forward to the next line break or terminator. It never leaves the comment,
string, or Markdown block that holds the dash; comment markers, quotes, a JSDoc
`*` gutter, and surrounding whitespace stay out of the range. In Markdown, a
sentence spans emphasis and links, `>` blockquote markers stay out of the range,
and an escaped terminator such as `\.` does not end a sentence. A sentence with
several em dashes reports once. En dashes (U+2013) and hyphens are not reported.

## Examples

Examples of **incorrect** code for this rule:

```ts
// Fetch the user — then cache it.
const label = "Saved — reload to see changes";
```

Examples of **correct** code for this rule:

```ts
// Fetch the user, then cache it.
const label = "Saved. Reload to see changes.";
const separator = /—/u;
```

## When not to use it

Turn the rule off for files where an em dash is content rather than style, such
as typography tests or locale data. For a string that must hold the character,
write it as a `\u` escape (code point 2014).

This rule has no options.

```json
{
	"flawless/no-em-dash": "error"
}
```
