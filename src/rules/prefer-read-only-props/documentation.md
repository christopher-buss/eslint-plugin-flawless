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

The autofix wraps the props type in `Readonly<>`, which makes every top-level
property read-only in a single edit. The fix is only offered when the props type
is written explicitly — as a parameter annotation, or as the type argument of an
`FC` / `forwardRef` / `memo` form. When no such type node can be located (for
example, props inferred with no annotation), the component is reported without a
fix.

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

## Further Reading

- [`@typescript-eslint/prefer-readonly-parameter-types`](https://typescript-eslint.io/rules/prefer-readonly-parameter-types)
- [`Readonly<Type>` utility type](https://www.typescriptlang.org/docs/handbook/utility-types.html#readonlytype)
