# Disallow unsafe object dictionary value types

📝 Disallow unsafe object dictionary value types.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

An object dictionary promises that every property has the declared value type.
Using `unknown`, `any`, `object`, or `{}` as that value type avoids making a
useful promise: callers must either narrow every value or bypass the type system
before using it. A union containing one of those escape hatches has the same
problem.

Use the concrete type that owns the values. For external data, validate it at
the boundary and expose the validator's output type. For intentionally
heterogeneous data, prefer a discriminated union or a recursive JSON value type.

The rule follows file-local type aliases, generic substitutions, empty
interfaces, mapped types, and the built-in `Record`, `Readonly`, `Partial`,
`Required`, `NonNullable`, `Pick`, and `Omit` utility types. It does not require
TypeScript type information.

The rule does not report types inside a generic's `extends` constraint, such as
`<T extends Record<string, unknown>>`. A constraint only sets a lower limit on
what callers can pass: `T` keeps the precise type of each caller's argument, so
the escape hatch never reaches the values that the code reads. A type parameter
default, such as `<T = Record<string, unknown>>`, is still reported, because it
becomes the real type when a caller does not give one.

## Examples

Examples of **incorrect** code for this rule:

```ts
type ExternalConfig = Record<string, unknown>;
type Metadata = Record<string, object>;
// eslint-disable-next-line ts/no-empty-object-type -- Example of the unsafe contract.
type Values<Key extends string> = Record<Key, {}>;
```

Examples of **correct** code for this rule:

```ts
interface User {
	id: string;
	name: string;
}

type UsersById = Readonly<Record<string, User>>;

type JSONValue = boolean | JSONArray | JSONObject | null | number | string;
interface JSONArray extends Array<JSONValue> {}
interface JSONObject {
	[key: string]: JSONValue;
}

function keysOf<T extends Record<string, unknown>>(value: T): Array<keyof T> {
	return Object.keys(value) as Array<keyof T>;
}
```

This rule has no options.

```json
{
	"flawless/no-unsafe-dictionary-type": "error"
}
```
