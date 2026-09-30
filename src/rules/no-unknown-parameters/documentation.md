# Disallow `unknown` function parameters outside type-predicate subjects and recorded error causes

📝 Disallow `unknown` function parameters outside type-predicate subjects and
recorded error causes.

<!-- end auto-generated rule header -->

## Rule details

Parse, don't validate. `unknown` belongs at the I/O boundary, where a schema or
parser turns raw input into a domain type. A function parameter typed `unknown`,
or a union that contains it, moves that unparsed input into the core: every
caller may pass anything, and the body must narrow before it can use the value.

Accept a named domain type instead, and run the expected schema or parser at the
boundary before you call the function.

Every function-like node and signature is checked: function declarations and
expressions, arrow functions, methods, `declare` functions, overload and
abstract signatures, interface methods, call and construct signatures, and
function and constructor types. A parameter property, a rest parameter, a
parameter with a default value, and a destructured parameter are checked too.

## Exemptions

### Type-predicate subjects

A type guard is where narrowing happens, so it must accept the raw value. The
parameter named in `x is T` or `asserts x is T` is exempt, and so is a
`this: unknown` parameter under `this is T`. Other parameters of the same guard
still report.

### Recorded error causes

A function that wraps a caught error takes the cause as `unknown`, because
`catch` gives it that type. The name `cause` alone exempts nothing. A plain
`cause` parameter (a default value is fine) is exempt only when the value itself
reaches one of these positions in the function's body:

- `new …(message, { cause })`: the `cause` of an options object passed straight
  to a construction. Any constructor counts;
- `super(message, { cause })`;
- `error.cause = cause`: a plain `=` assignment to a `.cause` member;
- a constructor parameter property named `cause`, which is the same assignment
  to `this.cause`.

Type-only wrappers do not change the value, so `{ cause } as ErrorOptions`,
`{ cause } satisfies ErrorOptions`, `{ cause: cause as Error }`, and
`{ cause: cause! }` count too.

The rule uses scope analysis, so a different variable named `cause` in a nested
scope does not count. The parameter must also keep the caller's value: any write
to it in the body, a nested function included, removes the exemption.

These forms do not record the value, and report:

- reading, logging, or converting the value: `console.log(cause)`,
  `String(cause)`, `cause instanceof Error` alone;
- `{ cause: String(cause) }`, or any other changed value;
- `{ cause }` returned, or passed to a plain call: `make(message, { cause })`;
- `{ cause }` nested deeper than the options object:
  `new Error(message, { details: { cause } })`;
- a different key: `new Error(message, { reason: cause })`;
- a compound assignment: `error.cause ??= cause`;
- a reassigned parameter: `cause = String(cause)` or `cause += ""` before the
  value is recorded;
- `Object.assign(error, { cause })`; write `error.cause = cause`;
- a destructured `{ cause }: unknown` or a rest `...cause: unknown` parameter.

A signature without a body has nowhere to record a cause, so `cause: unknown`
reports on a `declare function`, an abstract method, an interface method, and a
function type. An overload signature is the one exception: it defers to the
implementation with the same name in the same scope, and is exempt when the
implementation's parameter at the same position is a `cause` parameter that
records the value. A method `wrap` and a private method `#wrap` are different
methods.

## Examples

Examples of **incorrect** code for this rule:

```ts
interface Wrapper {
	wrap(cause: unknown): Error;
}

function loadConfig(raw: unknown): Config {
	return configSchema.parse(raw);
}

function logError(cause: unknown): void {
	console.log(cause);
}

function isString(value: unknown, context: unknown): value is string {
	return typeof value === "string";
}
```

Examples of **correct** code for this rule:

```ts
class WrapError extends Error {
	constructor(message: string, cause: unknown) {
		super(message, { cause });
	}
}

function loadConfig(config: Config): void {
	start(config);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function toError(cause: unknown): Error {
	return cause instanceof Error ? cause : new Error(String(cause), { cause });
}

function attach(error: Error, cause: unknown): void {
	error.cause = cause;
}

function wrap(cause: unknown): Error;
function wrap(cause: unknown): Error {
	return new Error("wrapped", { cause });
}
```

This rule has no options.

```json
{
	"flawless/no-unknown-parameters": "error"
}
```

## Further reading

Ported from
[`no-unknown-parameters`](https://github.com/dmmulroy/anti-slop/blob/main/src/rules/no-unknown-parameters.ts)
in `anti-slop`. Upstream exempts any parameter named `cause`; this port exempts
it only when the value is recorded as an error cause.
