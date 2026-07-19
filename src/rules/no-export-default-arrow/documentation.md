# Disallow anonymous arrow functions as export default declarations

📝 Disallow anonymous arrow functions as export default declarations.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Anonymous arrow functions used as default exports appear as unnamed functions in
stack traces, profiler output, and React devtools, which makes debugging harder
than it needs to be. This rule requires the arrow to be assigned to a named
constant that is then exported.

The autofix derives the name from the file's own name:

1. The arrow becomes `const <name> = ...`.
2. `export default <name>` is appended to the end of the file.
3. The name is camelCase normally, and PascalCase when the arrow returns JSX —
   so components read as components.

Because the export is appended after the file's last token, a trailing comment
stays where the author put it rather than being pushed below the new export.

## Examples

Examples of **incorrect** code for this rule:

```tsx
// File: use-mouse.tsx
export default () => {
	const [position] = useState({ x: 0, y: 0 });
	return position;
};
```

```tsx
// File: layout.tsx
export default () => <div>Layout</div>;
```

Examples of **correct** code for this rule:

```tsx
// File: use-mouse.tsx
const useMouse = () => {
	const [position] = useState({ x: 0, y: 0 });
	return position;
};

export default useMouse;
```

```tsx
// File: layout.tsx
const Layout = () => {
	return <div>Layout</div>;
};

export default Layout;
```

## Naming convention

Names are generated from the filename stem, with `-`, `_`, and whitespace
treated as word separators:

- **Regular functions**: camelCase — `use-mouse.tsx` becomes `useMouse`.
- **Components**: PascalCase — `layout.tsx` becomes `Layout`.

A function counts as a component when any of its return values is a JSX element
or fragment.
