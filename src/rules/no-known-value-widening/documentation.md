# Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence

📝 Disallow syntactically established values from flowing into explicitly broad
or anonymous target types that discard useful evidence.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

An object literal, an array literal, a class expression, a `new` expression —
each of these already tells the compiler exactly what it is. Annotating it with
`unknown`, `object`, or `Record<string, unknown>` throws that away, and every
later read has to cast the evidence back in.

The rule is syntactic: it reports only where a **known** value meets an
**explicitly broad** target type. It never needs type information, and it never
guesses about values that come from a call, a parameter, or an import.

### What counts as a known value

An expression whose type is established by its own syntax:

- an object, array, or template literal;
- a plain literal or a unary expression;
- a function, arrow function, or class expression;
- a `new` expression;
- an identifier bound by a `const` that is never reassigned, whose initializer
  is itself known. The chain is followed as far as it goes.

Anything else — a call, a parameter, an imported binding, a `let` that is
written more than once — is treated as external, and is left alone.

### What counts as a widening target

| Target                                             | Reported as         |
| :------------------------------------------------- | :------------------ |
| `unknown`                                          | `unknown`           |
| `object`                                           | `object`            |
| an index signature, mapped type, or `Record<K, V>` | `open dictionary`   |
| a generic alias resolving to a dictionary          | `generic container` |
| an inline type literal with named properties       | `anonymous object`  |

A named contract is **not** a widening target. An interface, or an alias that
resolves to a real shape, is the owner type the value is meant to satisfy, so it
is left alone. `Readonly`, `Partial`, `Required`, and `NonNullable` are
transparent: the wrapped type decides.

Naming a dictionary does not make it a contract, though. An alias resolving to
`unknown`, `object`, or an open dictionary is reported at the site that uses it:

```ts
type Registry = Record<string, Command>;

const commands: Registry = { start: startCommand }; // still an open dictionary
```

Through an alias, a mapped type is judged by its key. `[Key in string]` and
`[Key in PropertyKey]` constrain nothing and are reported; `[Key in Level]`,
where `Level` is a named union of literals, states exactly which properties
exist and is a contract. Written inline at the annotation, any mapped type
widens — an inline one restates a shape the initializer already establishes.

The rule checks variable declarators, assignments back to an annotated binding,
class properties, `return` statements and concise arrow bodies, and `as` / angle
bracket assertions. In an assertion chain only the outermost assertion is
reported, since it is the one that decides the final type.

## The dictionary accumulator

`{}` seeding a dictionary is exempt, wherever the seed appears:

```ts
// ✓ without the annotation the empty literal infers `{}`, and no key could
// ever be written to it
const counts: Record<string, number> = {};

class Counters {
	public counts: Record<string, number> = {};
}

function makeCounts(): Record<string, number> {
	return {};
}
```

A populated literal gets no such exemption — `{ root: 1 }` establishes its own
keys, so the annotation is what discards them.

## Examples

Examples of **incorrect** code for this rule:

```ts
const owner: unknown = { id: "1" };

const settings: object = { retries: 3 };

const registry: Record<string, unknown> = { root: 1 };

const point: { x: number; y: number } = { x: 1, y: 2 };

const asUnknown = { id: "1" } as unknown;

function makeOwner(): unknown {
	return { id: "1" };
}
```

Examples of **correct** code for this rule:

```ts
interface Owner {
	id: string;
}

// ✓ inference keeps every bit of evidence
const owner = { id: "1" };

// ✓ checked against the contract without being widened to it
const checked = { id: "1" } satisfies Owner;

// ✓ a named owner contract
const named: Owner = { id: "1" };

// ✓ an accumulator seed
const counts: Record<string, number> = {};

// ✓ genuinely external data, decoded at its boundary
const decoded: Owner = ownerSchema.parse(await response.json());
```

## When not to use it

A codebase that deliberately annotates every binding, contract or not, will find
the `anonymous object` reports noisy. The sibling rules
[`no-object-parameters`](../no-object-parameters/documentation.md) and
[`no-unsafe-dictionary-type`](../no-unsafe-dictionary-type/documentation.md)
cover the parameter and dictionary-value halves of the same problem without
touching initializers.

This rule has no options.

```json
{
	"flawless/no-known-value-widening": "error"
}
```
