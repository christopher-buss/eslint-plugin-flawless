# Enforce a consistent fragment form: the shorthand `<>...</>` or a named fragment

📝 Enforce a consistent fragment form: the shorthand `<>...</>` or a named
fragment.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Enforces a single fragment form throughout the codebase. The `mode` option picks
which form:

- `"syntax"` (default) requires the shorthand `<>...</>`, rewriting named
  fragments such as `<Fragment>` and `<React.Fragment>` back to the shorthand.
- `"element"` requires a named fragment (`<Fragment>...</Fragment>` by default),
  rewriting the shorthand `<>...</>` to it. A named fragment is easier to search
  for and, in environments where the fragment export is not a global (for
  example `@rbxts/react`), avoids relying on implicit shorthand support.

This re-implements both policies of the removed
`@eslint-react/jsx-shorthand-fragment` rule.

A fragment carrying attributes (for example a `key`) cannot be written with the
shorthand, so `"syntax"` mode leaves those named fragments untouched.

## Examples

### `"syntax"` mode (default)

Examples of **incorrect** code:

```tsx
const element = <Fragment>{children}</Fragment>;
const other = <React.Fragment>{children}</React.Fragment>;
```

Examples of **correct** code:

```tsx
const element = <>{children}</>;
const keyed = <Fragment key="a">{children}</Fragment>;
```

### `"element"` mode

Examples of **incorrect** code:

```tsx
const element = <>{children}</>;
```

Examples of **correct** code:

```tsx
const element = <Fragment>{children}</Fragment>;
```

## Options

This rule takes an optional object:

- `mode` (`"syntax" | "element"`, default `"syntax"`) — the fragment form to
  enforce.
- `fragmentName` (`string`, default `"Fragment"`) — the identifier used for the
  named fragment element in `"element"` mode. May be a member expression such as
  `"React.Fragment"`. In `"syntax"` mode it is additionally recognized
  (alongside `Fragment` and `React.Fragment`) as a named fragment to rewrite.

<!-- begin auto-generated rule options list -->

| Name           | Description                                                                                      | Type   | Choices             | Default    |
| :------------- | :----------------------------------------------------------------------------------------------- | :----- | :------------------ | :--------- |
| `fragmentName` | The identifier to use for the named fragment element in "element" mode.                          | String |                     | `Fragment` |
| `mode`         | Which form to enforce: "syntax" (shorthand `<>...</>`, default) or "element" (a named fragment). | String | `element`, `syntax` | `syntax`   |

<!-- end auto-generated rule options list -->

Example configuration enforcing named fragments:

```json
{
	"flawless/jsx-shorthand-fragment": [
		"error",
		{ "mode": "element", "fragmentName": "Fragment" }
	]
}
```
