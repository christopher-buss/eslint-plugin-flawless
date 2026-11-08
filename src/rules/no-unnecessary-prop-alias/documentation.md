# Disallow unnecessary aliases when destructuring component props

📝 Disallow unnecessary aliases when destructuring component props.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

An alias in the destructured props of a component hides the public name of the
prop. A reader must map `configuredOptions` back to `options` to know which prop
it is. This rule reports such aliases when the prop name could be used instead.

Component detection is delegated to `@eslint-react/core`, as in the other React
rules of this plugin. The rule checks:

- the destructured props parameter: `function Panel({ options: o })`;
- destructuring from the props parameter: `const { options: o } = props`;
- destructuring from a rest of the props: `const { options: o } = rest`.

Other destructuring is not props, so the rule ignores it: imports, exports, hook
results, service objects, test helpers, and objects that a prop holds.

An alias is necessary, and the rule does not report it, when:

- the alias renders a component-valued prop as JSX, and the prop name starts
  with a lowercase letter (`label: Label` with `<Label />`);
- another binding has the prop name where the alias lives or is used, or the
  component reads an outer binding with the prop name;
- the prop name cannot be a binding name (`for`, `class`, `"aria-label"`, or a
  computed key).

A local fallback for the alias does not make the alias necessary. A fallback is
a local in the same scope as the alias, made with `??`, `||`, `&&` or `?:`, and
the code reads the alias only there. In the first example below, `options` is
such a fallback, so it can read the prop directly. Other locals with the prop
name, such as `const [value, setValue] = useState(initialValue)`, keep the
alias.

The rule has no autofix. To remove an alias can need more than a rename, as in
the fallback case.

Examples of **incorrect** code for this rule:

```tsx
function Panel({ options: configuredOptions }: PanelProps): ReactNode {
	const options = configuredOptions ?? defaultOptions;
	const { padding, spacing } = options;
	return <div style={{ gap: spacing, padding }} />;
}

function Title({ level, ...rest }: TitleProps): ReactNode {
	const { text: providedText = "Untitled" } = rest;
	return <h1 aria-level={level}>{providedText}</h1>;
}

function Field({ Icon: IconComponent }: FieldProps): ReactNode {
	return <IconComponent />;
}
```

Examples of **correct** code for this rule:

```tsx
function Panel({ options }: PanelProps): ReactNode {
	const { padding, spacing } = options ?? defaultOptions;
	return <div style={{ gap: spacing, padding }} />;
}

function Title({ text = "Untitled" }: TitleProps): ReactNode {
	return <h1>{text}</h1>;
}

// Needed to render a component-valued prop.
function Field({ label: Label }: FieldProps): ReactNode {
	return <Label />;
}

// Needed because `id` is already a local binding.
function Row({ id: rowId }: RowProps): ReactNode {
	const { id } = useContext(RowContext);
	return <div data-id={id} data-row={rowId} />;
}
```

## Limitations

- Class components (`this.props`) are not checked.
- Only `const { ... } = props` declarations are checked (also through `as`, `!`
  and `satisfies`). Destructuring assignments (`({ a: b } = props)`) and nested
  patterns are not.

## Options

<!-- begin auto-generated rule options list -->

| Name              | Description                                                                                    | Type    | Default |
| :---------------- | :--------------------------------------------------------------------------------------------- | :------ | :------ |
| `reportConflicts` | Also report an alias that avoids a name conflict, and ask to rename the other binding instead. | Boolean | `false` |

<!-- end auto-generated rule options list -->

### `reportConflicts`

When `true`, the rule also reports an alias that avoids a name conflict. The
message asks you to rename the other binding, so that the prop keeps its public
name. The default is `false`.

The option does not change these cases, because a rename of another binding
cannot remove the alias:

- an alias that renders a component-valued prop as JSX (`label: Label`);
- a key that cannot be a binding name (`for`, `"aria-label"`, a computed key).

Examples of **incorrect** code with `{ "reportConflicts": true }`:

```tsx
import { value } from "./store";

function Input({ value: inputValue }: InputProps): ReactNode {
	return <input defaultValue={value} value={inputValue} />;
}

function Row({ id: rowId }: RowProps): ReactNode {
	const { id } = useContext(RowContext);
	return <div data-id={id} data-row={rowId} />;
}
```

Examples of **correct** code with `{ "reportConflicts": true }`:

```tsx
import { value as storedValue } from "./store";

function Input({ value }: InputProps): ReactNode {
	return <input defaultValue={storedValue} value={value} />;
}

function Row({ id }: RowProps): ReactNode {
	const { id: contextId } = useContext(RowContext);
	return <div data-id={contextId} data-row={id} />;
}
```

```json
{
	"flawless/no-unnecessary-prop-alias": ["error", { "reportConflicts": true }]
}
```
