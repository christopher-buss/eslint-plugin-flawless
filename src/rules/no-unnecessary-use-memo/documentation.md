# Disallow unnecessary usage of 'useMemo'

📝 Disallow unnecessary usage of 'useMemo'.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Disallows `useMemo` calls that cannot provide any benefit. A `useMemo` with an
empty dependency array that does not reference anything from the component scope
never re-computes and never changes, so the memoization is pure overhead: the
value can be computed in the component body or hoisted out of the component
entirely. When the memoized value is used inside a single `useEffect`, the
computation can instead be moved into that effect and the dependency arrays
merged.

This re-implements `react-x/no-unnecessary-use-memo`, which
[`eslint-plugin-react-x` removed](https://github.com/Rel1cx/eslint-react/pull/1695)
because the React Compiler makes it redundant. Ecosystems without the Compiler
(such as Roblox / `@rbxts/react`) still benefit from it.

Hook detection is delegated to `@eslint-react/core`, so the rule recognises
`useMemo` regardless of how it is imported (named import, namespace, `require`).
To detect a non-default React module, configure the import source:

```json
{
	"settings": {
		"react-x": {
			"importSource": "@rbxts/react"
		}
	}
}
```

## Examples

Examples of **incorrect** code for this rule:

```tsx
import type { ReactNode } from "react";
import { useMemo } from "react";

function MyComponent(): ReactNode {
	// Empty deps, no reference to the component scope: memoization is pointless.
	const style = useMemo(() => ({ fontFamily: "mono" }), []);
	return <Button sx={style} />;
}
```

```tsx
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";

function MyComponent({ someNumbers }): ReactNode {
	// `total` is only used inside one effect.
	const total = useMemo(() => sum(someNumbers), [someNumbers]);

	useEffect(() => {
		console.log(total);
	}, [total]);

	return <div>Hello World!</div>;
}
```

Examples of **correct** code for this rule:

```tsx
import type { ReactNode } from "react";

const style = { fontFamily: "mono" };

function MyComponent(): ReactNode {
	return <Button sx={style} />;
}
```

```tsx
import type { ReactNode } from "react";
import { useEffect } from "react";

function MyComponent({ someNumbers }): ReactNode {
	useEffect(() => {
		const total = sum(someNumbers);
		console.log(total);
	}, [someNumbers]);

	return <div>Hello World!</div>;
}
```

## Further Reading

- [React Docs: `useMemo`](https://react.dev/reference/react/useMemo)
- [React Docs: `useEffect`](https://react.dev/reference/react/useEffect)
