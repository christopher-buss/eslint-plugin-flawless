# Disallow `Reflect.set` with a literal key in favour of a plain assignment

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

Only a literal key is reported: a string literal, a number literal, or a
template literal with no expressions.

### Why a computed key stays clean

Reads and writes are not symmetric here. Narrowing a value to
`Record<string, unknown>` makes any dynamic read sound, so a `Reflect.get`
always has a replacement. Writing an `unknown` into a typed field is unsound,
and TypeScript refuses it — so a dynamic write has no honest replacement to move
to. A filtered key-copy loop is the real case, and it must stay clean without a
disable comment:

```ts
for (const [key, value] of Object.entries(source)) {
	if (allowed.has(key)) {
		Reflect.set(destination, key, value);
	}
}
```

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
```

Examples of **correct** code for this rule:

```ts
declare const target: { timing: boolean };
declare const key: string;
declare const value: unknown;
declare const receiver: unknown;

target.timing = true;

Reflect.set(target, key, value);
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
