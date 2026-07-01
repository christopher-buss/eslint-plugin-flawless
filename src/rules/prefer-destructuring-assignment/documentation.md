# Enforce destructuring assignment for component props

📝 Enforce destructuring assignment for component props.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Reports member access on a component's props parameter (`props.foo`) and nudges
you to destructure props instead. Destructuring keeps every prop a component
reads visible at its signature, avoids the repetitive `props.` prefix, and plays
better with React tooling.

This re-implements `react-x/prefer-destructuring-assignment`, which
`eslint-plugin-react-x`
[deprecated and removed in v5.0.0](https://www.eslint-react.xyz/docs/rules/prefer-destructuring-assignment)
(citing low usage). Component detection is delegated to `@eslint-react/core`, so
only functions recognised as React components are checked — plain callbacks such
as `items.map((item) => item.value)` are left alone.

Only the first parameter (props) is inspected; despite the name, the removed
upstream rule never checked a second (context) parameter, and this port keeps
that behaviour.

## Autofix

Unlike the removed upstream rule, this port can automatically rewrite the props
parameter into a destructuring pattern:

```tsx
import type { ReactNode } from "react";

function App(props): ReactNode {
	return <div id={props.id} />;
}

// becomes

function App({ id }): ReactNode {
	return <div id={id} />;
}
```

The fix is only offered when it is unambiguously safe. It is **not** applied
(the code is reported but left untouched) when:

- `props` is used other than as a member access (e.g. `{...props}`, or passed on
  to another function), since destructuring the parameter away would break that
  use.
- A property is accessed dynamically (`props[key]`), which has no static name to
  destructure.
- A destructured name would collide with an existing binding in the component
  (e.g. `const data = props.data`).

## Examples

Examples of **incorrect** code for this rule:

```tsx
import type { ReactNode } from "react";

interface MyComponentProps {
	items: Array<string>;
}

function MyComponent(props: MyComponentProps): ReactNode {
	const items = props.items;
	return <div>{items}</div>;
}
```

```tsx
import type { ReactNode } from "react";

function MyComponent(props): ReactNode {
	return <div>{props.items}</div>;
}
```

Examples of **correct** code for this rule:

```tsx
import type { ReactNode } from "react";

function MyComponent({ items }): ReactNode {
	return <div>{items}</div>;
}
```

```tsx
import type { ReactNode } from "react";

function MyComponent(props): ReactNode {
	const { items } = props;
	return <div>{items}</div>;
}
```

```tsx
import type { ReactNode } from "react";

function MyComponent({ items, ...rest }): ReactNode {
	return <div {...rest}>{items}</div>;
}
```

## Further Reading

- [MDN: Destructuring assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment)
- [React Docs: Passing props to a component](https://react.dev/learn/passing-props-to-a-component#step-2-read-props-inside-the-child-component)
