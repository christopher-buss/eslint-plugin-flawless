# Prefer named imports for React runtime values and the React namespace for React types

📝 Prefer named imports for React runtime values and the React namespace for
React types.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Enforces a single, direction-aware convention for how React is referenced,
splitting the policy by whether the reference is a runtime value or a type:

- **Runtime (value) access is banned on the React namespace.** Write
  `useEffect()` instead of `React.useEffect()`; the named export is imported for
  you.
- **Types must go through the React namespace.** Write `React.ReactNode` instead
  of importing `ReactNode` by name; the bare named type import is removed.

Agents and people frequently reach for the namespace binding
(`import React from "…"; React.useEffect()`) out of habit. This rule pushes
runtime code toward named imports (better tree-shaking and grep-ability) while
keeping types on the namespace (where `React.ReactNode` reads unambiguously and
never collides with a local name).

The two directions are separable purely by node kind, so no type information is
required: runtime access is a `MemberExpression`, a bare type is a
`TSTypeReference` whose name is a plain identifier, and an already-correct
`React.ReactNode` type is a qualified name that is left untouched.

### Import source

The module specifier is taken from the shared
[`@eslint-react`](https://eslint-react.xyz) setting
`settings["react-x"].importSource` (default `"react"`). A declaration matches
when its source equals that value or is a subpath of it (so `@rbxts/react` and
`@rbxts/react/jsx-runtime` both count, but a sibling like `@rbxts/react-roblox`
does not). When the setting is a bare npm scope (`"@rbxts"`, as Roblox configs
set it) the React package is resolved to `<scope>/react`, so unrelated packages
in the same scope stay untouched. There is no rule-level override — the
`react-x` setting is the single source of truth.

```js
// eslint.config.js
export default [
	{
		settings: { "react-x": { importSource: "@rbxts/react" } },
	},
];
```

## Examples

### Runtime values

Examples of **incorrect** code — a runtime value accessed through the namespace:

```tsx
import React from "react";

function useValue(): number {
	return React.useMemo(() => 1, []);
}
```

Examples of **correct** code — a named runtime import:

```tsx
import { useMemo } from "react";

function useValue(): number {
	return useMemo(() => 1, []);
}
```

### Types

Examples of **incorrect** code — a bare named type import:

```tsx
import type { ReactNode } from "react";

function wrap(node: ReactNode): ReactNode {
	return node;
}
```

Examples of **correct** code — a type through the namespace:

```tsx
import React from "react";

function wrap(node: React.ReactNode): React.ReactNode {
	return node;
}
```

## Autofix

Both directions are fully autofixable.

Runtime access strips the `React.` qualifier and ensures a named value import of
the accessed member — reusing an existing named import, extending a default
import (`import React from "…"` → `import React, { useEffect } from "…"`), or
inserting a new statement when only a namespace import exists. The `React`
import itself is never removed, so a JSX pragma stays valid.

Type access qualifies the reference with the file's React namespace (adding
`import React from "…"` when none exists) and removes the now-redundant named
type import. Removal is conservative: the specifier is dropped only when every
reference to it is a convertible type reference, so a binding also used as a
value is left in place for unused-import tooling to handle.

### Convergence

When several edits target the import region in one pass, ESLint applies the
non-conflicting ones and re-lints; specifier existence is always checked against
the original text, so repeated passes are idempotent and converge on the fixed
form.

## Options

This rule has no options. Both directions are always enforced.

<!-- begin auto-generated rule options list -->

<!-- end auto-generated rule options list -->
