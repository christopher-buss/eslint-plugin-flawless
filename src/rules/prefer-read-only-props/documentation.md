# Enforce that function component props are read-only

📝 Enforce that function component props are read-only.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

This rule enforces that the props of a function component are read-only. A
component must never mutate its own props, so declaring them read-only both
documents that contract and lets the compiler enforce it.

Component detection is delegated to `@eslint-react/core`, matching the rest of
this plugin. For every detected function component, the type of the first
parameter (the props) is inspected. If any property is mutable, the component is
reported. Properties React manages itself (`children`, `key`, `ref`) are always
treated as read-only, as are types already wrapped in `Readonly<>` (and similar
read-only aliases), unions/intersections whose members are all read-only, and
properties inherited as `readonly` from a base type.

Because it reads type information, this rule requires
[type-aware linting](https://typescript-eslint.io/getting-started/typed-linting)
and does not run under oxlint.

The autofix has two styles, chosen by [`fixStyle`](#fixstyle). By default
(`"wrap"`) it wraps the props type in `Readonly<>`, which makes every top-level
property read-only in a single edit. This fix is only offered when the props
type is written explicitly — as a parameter annotation, or as the type argument
of an `FC` / `forwardRef` / `memo` form. When no such type node can be located
(for example, props inferred with no annotation), the component is reported
without a fix.

With `"modifier"`, the fix instead adds a `readonly` modifier to each mutable
property (`interface Props { name: string }` →
`interface Props { readonly name: string }`). Every property must be reachable
and editable here: inline type literals and props declared by a same-file
`interface` or `type` are rewritten in place; when any property is declared in
another file, or the props type is a union/intersection or contains a method
signature, the component is reported without a fix.

## Examples

Examples of **incorrect** code for this rule:

```tsx
import type { ReactNode } from "react";

interface Props {
	name: string;
}

function Greeting(props: Props): ReactNode {
	return <h1>{props.name}</h1>;
}
```

Examples of **correct** code for this rule:

```tsx
import type { ReactNode } from "react";

interface Props {
	readonly name: string;
}

function Greeting(props: Props): ReactNode {
	return <h1>{props.name}</h1>;
}

// Or wrap the whole type:
function Farewell(props: Readonly<Props>): ReactNode {
	return <h1>{props.name}</h1>;
}
```

## Options

This rule accepts an options object:

```jsonc
{
	"flawless/prefer-read-only-props": [
		"error",
		{
			// How the autofix makes props read-only. Default: "wrap".
			"fixStyle": "modifier",
			// Utility type the autofix wraps props in. Default: "Readonly".
			"wrapperType": "Immutable",
			// Module to import `wrapperType` from when it is not global.
			"importSource": "~/types",
		},
	],
}
```

### `fixStyle`

How the autofix makes props read-only. `"wrap"` (the default) wraps the props
type in [`wrapperType`](#wrappertype); `"modifier"` adds a `readonly` modifier
to each mutable property instead. See [Rule details](#rule-details) for exactly
when each style produces a fix.

`"modifier"` ignores `wrapperType` and `importSource` — it inserts no wrapper,
so there is nothing to name or import. Note that when it modifies a shared
same-file `interface` or `type`, that declaration becomes read-only for every
consumer, not only the component being linted; this is the intended effect of
the modifier style.

### `wrapperType`

The utility type the autofix wraps props in. Defaults to the global
`Readonly<>`, which makes only top-level properties read-only. Set it to a
deep-readonly type such as `Immutable` when you want nested props to be
immutable too — mutating a nested prop object or array is as much a contract
violation as reassigning a top-level prop.

The configured name is also treated as an already-read-only wrapper during
detection, so props already annotated `Immutable<Props>` are recognized in O(1)
via their alias symbol, without walking the (potentially recursive) type.

Detection itself stays shallow: a component is reported only when a top-level
property is mutable. A deep wrapper therefore strengthens the fix without
forcing a rewrite of props that are already flatly read-only.

### `importSource`

The module to import `wrapperType` from. When set, the autofix inserts a type
import (merging into an existing named import from the same module when one
exists) so the emitted wrapper does not reference an undeclared type. Omit it
for globally available wrappers like the default `Readonly`.

## Further Reading

- [`@typescript-eslint/prefer-readonly-parameter-types`](https://typescript-eslint.io/rules/prefer-readonly-parameter-types)
- [`Readonly<Type>` utility type](https://www.typescriptlang.org/docs/handbook/utility-types.html#readonlytype)
