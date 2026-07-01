# Disallow unnecessary usage of 'useCallback'

📝 Disallow unnecessary usage of 'useCallback'.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Disallows `useCallback` calls that cannot provide any benefit. A `useCallback`
with an empty dependency array that does not reference anything from the
component scope always returns the same function, so the memoization is pure
overhead: the function can be created in the component body or hoisted out of
the component entirely. When the memoized function is used inside a single
`useEffect`, it can instead be moved into that effect and the dependency arrays
merged.

This re-implements `react-x/no-unnecessary-use-callback`, which
[`eslint-plugin-react-x` removed](https://github.com/Rel1cx/eslint-react/pull/1695)
because the React Compiler makes it redundant. Ecosystems without the Compiler
(such as Roblox / `@rbxts/react`) still benefit from it.

Hook detection is delegated to `@eslint-react/core`, so the rule recognises
`useCallback` regardless of how it is imported (named import, namespace,
`require`). To detect a non-default React module, configure the import source:

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
import { useCallback } from "react";

function MyComponent(): ReactNode {
	// Empty deps, no reference to the component scope: memoization is pointless.
	const onClick = useCallback(() => {
		console.log("clicked");
	}, []);

	return <Button onClick={onClick} />;
}
```

```tsx
import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";

function MyComponent({ items }): ReactNode {
	// `update` is only used inside one effect.
	const update = useCallback(() => setCount(items.length), [items]);

	useEffect(() => {
		update();
	}, [update]);

	return <div>{items.length}</div>;
}
```

Examples of **correct** code for this rule:

```tsx
import type { ReactNode } from "react";

function handleClick(): void {
	console.log("clicked");
}

function MyComponent(): ReactNode {
	return <Button onClick={handleClick} />;
}
```

```tsx
import type { ReactNode } from "react";
import { useEffect } from "react";

function MyComponent({ items }): ReactNode {
	useEffect(() => {
		setCount(items.length);
	}, [items]);

	return <div>{items.length}</div>;
}
```

## Further Reading

- [React Docs: `useCallback`](https://react.dev/reference/react/useCallback)
- [React Docs: `useEffect`](https://react.dev/reference/react/useEffect)
