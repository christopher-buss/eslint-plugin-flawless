# Disallow the shorthand fragment syntax in favour of a named fragment

📝 Disallow the shorthand fragment syntax in favour of a named fragment.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Disallows the shorthand fragment syntax `<>...</>`, requiring an explicit named
fragment element such as `<Fragment>...</Fragment>` instead. A named fragment is
easier to search for and, in environments where the fragment export is not a
global (for example `@rbxts/react`), avoids relying on implicit shorthand
support.

This re-implements the "never" policy of the removed
`@eslint-react/jsx-shorthand-fragment` rule.

## Examples

Examples of **incorrect** code for this rule:

```tsx
const element = <>{children}</>;
```

Examples of **correct** code for this rule:

```tsx
const element = <Fragment>{children}</Fragment>;
```

## Options

This rule takes an optional string as its first option: the identifier used for
the named fragment element. It defaults to `"Fragment"`.

<!-- begin auto-generated rule options list -->

<!-- end auto-generated rule options list -->

Example configuration with options:

```json
{
	"flawless/jsx-shorthand-fragment": ["error", "Fragment"]
}
```
