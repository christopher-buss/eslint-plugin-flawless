# Disallow em dashes in source text

📝 Disallow em dashes in source text.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

An em dash (U+2014) splices two thoughts into one long sentence. Two shorter
sentences, or a comma, usually read better. This rule reports each sentence in
the source text that contains an em dash: comments, strings, template literals,
JSX text, and code alike.

A sentence runs back from the dash to the previous line break or `.`, `!`, `?`,
and forward to the next line break or terminator. Surrounding whitespace is
trimmed. A sentence with several em dashes reports once.

The rule runs on any parser that yields a `Program` root: JS/TS, and also
`yaml-eslint-parser`, `toml-eslint-parser`, and `jsonc-eslint-parser`. En dashes
(U+2013) and hyphens are not reported.

The rule scans raw source text, so an em dash in code also reports, such as in a
regex or a `replaceAll` argument. There, write the dash as a `\u` escape (code
point 2014) or add a disable comment.

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
```

## When not to use it

Turn the rule off for files where an em dash is content rather than style, such
as typography tests or locale data.

This rule has no options.

```json
{
	"flawless/no-em-dash": "error"
}
```
