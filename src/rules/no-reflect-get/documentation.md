# Disallow the two-argument `Reflect.get` in favour of typed property access

📝 Disallow the two-argument `Reflect.get` in favour of typed property access.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

`Reflect.get(target, key)` reads a property while telling the reader nothing
about what `target` is. Whichever type is missing the field stays unnamed, and
the decision to name it is deferred indefinitely. Plain property access states
the same intent and forces that decision now.

How unsafe the call is depends on the standard library in use, so the rule does
not claim it is unsafe on its own:

- Under the stock `lib.es5.d.ts`, `Reflect.get` returns `any`. Every read is an
  unchecked hole in the type system.
- Under [better-typescript-lib][better-typescript-lib] it returns `unknown`, so
  a guarded call site is already sound. The rule's value there is legibility,
  not safety.

Only the two-argument form is reported. `Reflect.get(target, key, receiver)`
passes a receiver that rebinds `this` for a getter, so it has no property-access
equivalent — a `Proxy` `get` trap needs it, and the rule leaves it alone.

## Reading a key off an untyped value

Most reports come from type guards, which is the one place a key must be read
off a value that has no type yet. "Parse it into a named type first" is circular
advice there, so narrow the value to a keyed record instead:

```ts
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlock(value: unknown): boolean {
	return isRecord(value) && value.tag === "block";
}
```

Once the value does have a type, name the shape and read the field off it rather
than reaching for the key by string.

## Examples

Examples of **incorrect** code for this rule:

```ts
declare const value: unknown;
declare const raw: Record<string, unknown>;
declare const err: unknown;
declare const key: string;

const isBlock = Reflect.get(value, "tag") === "block";
const name = Reflect.get(raw, "name");
const message = Reflect.get(err, key);
```

The computed method form — reading `get` off `Reflect` by string subscript —
reports the same way.

Examples of **correct** code for this rule:

```ts
declare const raw: Readonly<Record<string, unknown>>;

const name = raw.name;

const handler = {
	get(target: object, key: string, receiver: unknown): unknown {
		return Reflect.get(target, key, receiver);
	},
};
```

## When not to use it

Turn the rule off in code that is genuinely reflective — a `Proxy` handler
library, a serializer walking arbitrary objects — where no domain type exists to
name. For a single such call site, an `eslint-disable-next-line` comment
carrying the reason reads better than disabling the rule project-wide.

This rule has no options.

```json
{
	"flawless/no-reflect-get": "error"
}
```

[better-typescript-lib]: https://github.com/uhyo/better-typescript-lib
