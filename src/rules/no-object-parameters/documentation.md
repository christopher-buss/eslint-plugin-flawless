# Disallow function parameters that accept any object shape

📝 Disallow function parameters that accept any object shape.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

`object`, `{}`, and an open dictionary such as `Record<string, unknown>` say
only that a value is not a primitive. A parameter typed that way accepts every
shape, so the function body cannot read a single property without a cast, and
callers get no help from the compiler.

Take the type the owner of the data already declares. When the value comes from
outside the program (a network response, a config file, user input), decode it
at that boundary and pass the decoded type inwards.

A parameter is reported when its type is, or resolves to:

- the `object` keyword;
- the empty type literal `{}`;
- a type made only of index signatures whose value type is `unknown`, `any`,
  `object`, or `{}` — `{ [key: string]: unknown }`;
- `Record<K, V>` with one of those same value types.

A dictionary with a real value type (`Record<string, string>`) is left alone, as
is a type literal that declares at least one named property.

## Type aliases

The rule follows non-generic type aliases, so an alias to one of the above is
reported at the parameter that uses it. Names resolve in their own lexical
scope, so the nearest declaration wins — including a declaration that is not an
alias at all:

```ts
type Payload = object;

function outer(): void {
	// ✓ this Payload shadows the outer one
	// eslint-disable-next-line ts/no-shadow -- The point of the example.
	interface Payload {
		id: string;
	}

	function inner(payload: Payload): void {
		send(payload.id);
	}
}
```

A generic alias is skipped, because its arguments decide the final shape. Alias
resolution is syntactic, so an alias imported from another file is not followed.
For dictionary value types specifically, the sibling rule
[`no-unsafe-dictionary-type`](../no-unsafe-dictionary-type/documentation.md)
analyses them in far more depth, anywhere they appear.

## Examples

Examples of **incorrect** code for this rule:

```ts
type Payload = object;

interface Handler {
	handle(payload: object): void;
}

// eslint-disable-next-line ts/no-empty-object-type -- Example of the open shape.
function handle(payload: {}): void {
	send(payload);
}

function store(payload: Payload): void {
	send(payload);
}

function index(entries: Record<string, unknown>): void {
	send(entries);
}
```

Examples of **correct** code for this rule:

```ts
interface Payload {
	id: string;
}

function handle(payload: Payload): void {
	send(payload.id);
}

function index(entries: Record<string, Payload>): void {
	send(entries);
}

function decode(raw: unknown): Payload {
	return payloadSchema.parse(raw);
}
```

This rule has no options.

```json
{
	"flawless/no-object-parameters": "error"
}
```
