# Disallow `Reflect.set` with a compile-time-fixed key in favour of a plain assignment

📝 Disallow `Reflect.set` with a compile-time-fixed key in favour of a plain
assignment.

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->

📝 Disallow `Reflect.set` with a literal key in favour of a plain assignment.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

`Reflect.set(target, "key", value)` writes a field the target type does not
declare, and the string argument keeps that fact out of the type.
`target.key = value` says the same thing where the compiler can check it.

`Reflect.set` also swallows failures. It returns `false` when the write does not
happen — a read-only property, a frozen object, a rejecting `Proxy` trap —
instead of throwing, and call sites never read that boolean. The plain
assignment `target.key = value` throws in strict mode, so the same failure
surfaces instead of passing silently.

A key is reported when it is fixed at compile time. That is a string literal, a
number literal, or a template literal with no expressions in the source, or a
key whose type is one of these:

- a string or number literal type, such as `const key = "_coverage"`;
- a template literal type with no holes;
- a `unique symbol`, such as `const BRAND = Symbol.for("pkg/brand")`;
- a union whose every member is one of the above, such as `"a" | "b"`. Each
  member names a field the target can declare, so `target[key] = value` works.

The type check needs type information. Without it (oxlint, or a file outside the
program) the rule reports only keys spelled in the source.

### Why a wide key stays clean

Reads and writes are not symmetric here. Narrowing a value to
`Record<string, unknown>` makes any dynamic read sound, so a `Reflect.get`
always has a replacement. Writing an `unknown` into a typed field is unsound,
and TypeScript refuses it — so a dynamic write has no honest replacement to move
to. A key typed `string`, `symbol`, `PropertyKey`, or a union with any such
member names no field to declare. A filtered key-copy loop is the real case, and
it must stay clean without a disable comment:

```ts
for (const [key, value] of Object.entries(source)) {
	if (allowed.has(key)) {
		Reflect.set(destination, key, value);
	}
}
```

## Symbol keys

A `Symbol.for` brand written with `Reflect.set` is the usual symbol case:

```ts
const BRAND = Symbol.for("pkg/brand");

export class Conflict extends Error {
	constructor() {
		super();
		Reflect.set(this, BRAND, true);
	}
}
```

Declaring the field `[BRAND]` does not work on an exported class under
`--isolatedDeclarations`. Every computed member on a class or object literal
errors with TS9038, whether the symbol is inferred, annotated `unique symbol`,
or `declare`d, and whether the member has an explicit type or not.

Replace the symbol brand with a declared, string-named field, and have the guard
check it after `in`:

```ts
export class Conflict extends Error {
	public readonly isConflict = true;
}

function isConflict(value: unknown): value is Conflict {
	return (
		value instanceof Error && "isConflict" in value && value.isConflict === true
	);
}
```

A string key still matches across duplicate package instances, which is the
usual reason to use `Symbol.for`. Type-only brands, such as type-fest's `Tagged`
or `Opaque`, do not replace it: a runtime guard on `unknown` has no field to
read.

## The naming-convention dodge

This plugin's own [`naming-convention`](../naming-convention/documentation.md)
rule is part of why `Reflect.set` appears at all. A wire-format key such as
`_coverage` is a lint error when declared as a type property, but invisible as a
string argument to `Reflect.set`. The same dodge takes three shapes:

```ts
Reflect.set(payload, "_coverage", report);

const patch: Partial<Record<"_coverage", Report>> = { _coverage: report };

const key = "_coverage";
const alsoPatch = { [key]: report };
```

The fix is not a disable comment on each site. Either rename the field, or —
when the wire format fixes the name — declare it and let the naming rule allow
it:

```json
{
	"flawless/naming-convention": [
		"error",
		{ "selector": "typeProperty", "leadingUnderscore": "allow" }
	]
}
```

## Examples

Examples of **incorrect** code for this rule:

```ts
declare const argv: object;
declare const config: object;
declare const value: unknown;

Reflect.set(argv, "_timing", true);
Reflect.set(config, "projects", value);
Reflect.set(argv, 0, value);

const key = "_coverage";
Reflect.set(argv, key, value);

const BRAND = Symbol.for("pkg/brand");
Reflect.set(argv, BRAND, true);
```

Examples of **correct** code for this rule:

```ts
declare const target: { timing: boolean };
declare const key: string;
declare const symbolKey: symbol;
declare const value: unknown;
declare const receiver: unknown;

target.timing = true;

Reflect.set(target, key, value);
Reflect.set(target, symbolKey, value);
Reflect.set(target, key, value, receiver);
```

## When not to use it

A test that deliberately builds a value violating its declared type is the usual
holdout. Prefer a helper that says so — [shoehorn][shoehorn]'s `fromAny`, for
example — over a `Reflect.set` that hides the violation. Where no such helper
fits, disable the rule on that line with the reason attached.

This rule has no options.

```json
{
	"flawless/no-reflect-set": "error"
}
```

[shoehorn]: https://github.com/total-typescript/shoehorn
