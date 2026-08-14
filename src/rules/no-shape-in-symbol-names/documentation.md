# Disallow the term 'shape' in declared symbol names

📝 Disallow the term 'shape' in declared symbol names.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

`shape` names the structure of a value, not the thing the value is. A
`UserShape` is a user, a `configShape` is a configuration, and a `shape`
parameter is whatever the function actually draws. The word survives in code
because it is a safe thing to write when the domain role is not yet decided —
which is exactly when a name should carry that role instead.

The rule matches the substring `shape` without regard to case, so `Shape`,
`SHAPE_COUNT`, and `reshape` all report.

## Declared names only

Only names this file declares are reported, because renaming is the only fix
this rule offers and a name owned elsewhere cannot be renamed here.

Reported:

- variable, function, class, parameter, and caught-error bindings
- class members, including private ones and parameter properties
- object literal keys
- interfaces, type aliases, enums, enum members, type members, type parameters,
  and namespaces
- `import` locals the author chose: a default import, a namespace import, and
  the `as` half of `import { Circle as Shape }`
- the `as` half of an export: `export { outline as shape }` and
  `export * as shapes from "..."`

Not reported:

- member reads and writes: `geometry.shape`, `data?.shape`, `THREE.Shape`
- an import or re-export without `as`, which keeps the name its package chose
- an object pattern key, whose name comes from the value being destructured —
  its binding is reported instead, so `const { shape: outline } = props` is the
  fix for `const { shape } = props`
- JSX: `<Shape />` and `<Canvas shape="round" />` reference a component and
  props declared elsewhere, so the report lands on the declaration instead

## Examples

Examples of **incorrect** code for this rule:

```ts
interface UserShape {
	id: string;
}

function draw(shape: UserShape): string {
	return shape.id;
}
```

Examples of **correct** code for this rule:

```ts
// Names owned elsewhere are left alone.
import { Shape } from "three";

interface User {
	id: string;
}

function draw(user: User): string {
	return user.id;
}

const path = new Shape();
const { shape: outline } = props;
```

This rule has no options.

```json
{
	"flawless/no-shape-in-symbol-names": "error"
}
```

## Further reading

Ported from
[`no-shape-in-symbol-names`](https://github.com/dmmulroy/anti-slop/blob/main/src/rules/no-shape-in-symbol-names.ts)
in `anti-slop`, narrowed to declared names.
