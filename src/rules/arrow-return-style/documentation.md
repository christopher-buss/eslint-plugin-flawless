# Enforce arrow function return style based on line length

📝 Enforce arrow function return style based on line length.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Port of
[`arrow-return-style-x/arrow-return-style`](https://github.com/christopher-buss/eslint-plugin-arrow-return-style-x),
re-specified to fix its measurement bugs and infinite auto-fix loops.

Arrow functions should use an implicit return (`() => value`) when the whole
resulting line fits within `maxLen`, and an explicit block
(`() => { return value; }`) when it does not. The decisive measurement is the
**full line the fixer would emit** — indentation, declaration prefix, arrow,
body, and trailing punctuation — never the arrow in isolation. Formatting truth
for boundary decisions comes from
[oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) (prettier-conformant),
consulted through a synchronous worker.

Multiline object bodies prefer the explicit block form: a multiline implicit
object is converted to a block, and an explicit block containing a multiline
literal is left alone. Multiline array bodies are formatter-owned and never
touched — oxfmt freely collapses and expands arrays, so converting them would
fight the formatter. The rule never collapses a multiline literal onto one line
either; that is the formatter's job.

## Options

- `maxLen` (`number`, default `80`) — maximum emitted line length before an
  explicit return is required. Tabs expand to `tabWidth` columns when measuring,
  mirroring the formatter's `printWidth` accounting.
- `tabWidth` (`number`, default `4`) — columns a tab occupies in length
  measurement.
- `useOxfmt` (`boolean | { printWidth?: number }`, default `true`) — consult
  oxfmt for boundary decisions; `printWidth` defaults to `maxLen`.
- `jsxAlwaysUseExplicitReturn` (`boolean`, default `false`) — always require
  explicit returns for JSX bodies.
- `namedExportsAlwaysUseExplicitReturn` (`boolean`, default `true`) — always
  require explicit returns for arrows assigned to named exports.
- `objectReturnStyle` (`"off" | "complex-explicit" | "always-explicit"`, default
  `"complex-explicit"`) — require explicit returns for object/array bodies:
  never, only when complex (spreads plus computed keys, multiple call
  expressions, or more than `maxObjectProperties` members), or always.
- `maxObjectProperties` (`number`, default `4`) — property/element count above
  which an object or array body counts as complex.

## Examples

Examples of **incorrect** code for this rule:

```ts
const foo = () => {
	return "foo";
};

const bar = () =>
	veryLongCallThatMakesThisLineFarExceedTheConfiguredMaximumLength(argument);
```

Examples of **correct** code for this rule:

```ts
const foo = () => "foo";

const bar = () => {
	return veryLongCallThatMakesThisLineFarExceedTheConfiguredMaximumLength(
		argument,
	);
};
```
