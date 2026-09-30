# Disallow copying an iterable into an array only to `filter` or `map` it

📝 Disallow copying an iterable into an array only to `filter` or `map` it.

🔧💡 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix)
and manually fixable by
[editor suggestions](https://eslint.org/docs/latest/use/core-concepts#rule-suggestions).

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

`[...set].filter(isOpen).map(toName)` builds three arrays: the copy, the
filtered array, and the mapped one. Only the last is used. Iterator helpers do
the same work on the iterable itself and build one array at most, with
`.toArray()`, where an array is actually needed:

```ts
set.values().filter(isOpen).map(toName).toArray();
```

The rule reports a `filter`/`map` chain, in either order and of any length, only
when its first receiver copies an iterable into an array:

- `[...x]`, with exactly one spread element and nothing else
- `Array.from(x)`, with exactly one argument. A second argument maps while
  copying, which is out of scope.

`x` must be a non-array iterable, confirmed with the type checker. A `Map`, a
`Set`, an iterator such as `map.keys()`, a generator, or any type with a
`[Symbol.iterator]` method qualifies. A union qualifies when every member is
iterable and at least one is not an array, so `[...(maybeMap ?? [])]` reports.

Not reported:

- a chain on an array: `array.filter(…).map(…)`. It makes one extra array, and
  is normal code.
- a copy of an array: `[...array].filter(…)`. It drops only one copy, which is
  not the subject of this rule, and the fix would be the array chain above.
- `any`, `unknown`, a type parameter, and a union with a member that is not
  iterable (including `undefined`)
- a string. Spreading one into characters is its own idiom.
- a chain behind a type assertion: `([...set] as Array<T>).map(…)`

This fills a gap in
[`unicorn/prefer-iterator-helpers`](https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/prefer-iterator-helpers.md),
which reports a copy followed by `every`, `find`, `forEach`, `some`, or
`reduce`, but not by `filter` or `map`.

## Examples

Examples of **incorrect** code for this rule:

```ts
const names = [...users.values()]
	.filter((user) => user.active)
	.map((user) => user.name);

const weights = new Map(
	[...graph.nodes].map(([id, node]) => [id, node.weight]),
);

const keys = Array.from(map.keys()).filter((key) => key !== "");
```

Examples of **correct** code for this rule:

```ts
const names = users
	.values()
	.filter((user) => user.active)
	.map((user) => user.name)
	.toArray();

const weights = new Map(
	graph.nodes.entries().map(([id, node]) => [id, node.weight]),
);

// An eager chain on an array is fine.
const labels = items
	.map((item) => item.label)
	.filter((label): label is string => label !== undefined);
```

## Fixes

The fix removes the copy and chains on an iterator:

| Copied iterable           | Replacement                          |
| ------------------------- | ------------------------------------ |
| `Map`, `ReadonlyMap`      | `x.entries()`, which a spread yields |
| `Set`, `ReadonlySet`      | `x.values()`, which a spread yields  |
| an iterator with helpers  | `x`                                  |
| anything else, or a union | `Iterator.from(x)`                   |

`Iterator.from` reads the same `[Symbol.iterator]` a spread reads, so
`[...(maybeMap ?? [])]` becomes `Iterator.from(maybeMap ?? [])`. That keeps the
expression and its type. The alternatives are worse: `?? new Map()` infers
`Map<any, any>`, and an early return changes the control flow around the
expression. A union of iterators also goes through `Iterator.from`, because
TypeScript cannot call an overloaded `filter` on a union of iterator types.

Where the result goes decides whether `.toArray()` is added:

- `new Map(…)`, `new Set(…)`, `new WeakMap(…)`, `new WeakSet(…)`, a single
  argument to `Array.from(…)`, and a spread into an array or a call take any
  iterable, so no `.toArray()` is added.
- A `for...of` head also takes any iterable. See the note on order below.
- Everywhere else, including a variable, a return, a further method such as
  `.join()`, and an object spread, gets `.toArray()`, so the result stays an
  array.

### Autofix or suggestion

An iterator helper is lazy. The eager chain runs every `filter` callback, then
every `map` callback. The lazy chain runs both for the first element, then both
for the second, and so on. This order is only visible when code with an effect
runs during the chain. So the rule applies an autofix only when all of these are
true, and offers a suggestion in all other cases:

- **Each callback is an inline function with no visible effects.** A body or a
  parameter default with a call, `new`, an assignment, `++`/`--`, `delete`,
  `await`, `yield`, `throw`, a spread, a `for...of`, a class, or a tagged
  template is treated as having effects. Member reads and implicit conversions
  can reach a getter or `valueOf`; like every syntactic purity check, the rule
  accepts them.
- **Iterating the source runs no user code.** Only the built-in `Map`, `Set`,
  `ReadonlyMap`, `ReadonlySet`, arrays, and their built-in iterators qualify. A
  generator runs its body on each step, which then interleaves with the
  callbacks. A user iterable, including a subclass of `Map`, can override its
  iterator. Both get a suggestion.
- **The result does not go into a `for...of` head.** The loop body runs between
  the callbacks, and a body that changes the source (`set.delete(n)`) changes
  the result. The copy may exist on purpose as a snapshot.
- **A last `map` that gets `.toArray()` has no contextual type.** An eager `map`
  infers its result from the target type, such as an annotated variable, a
  return, or a parameter. A callback returning `[key, value]` then infers a
  tuple. The helper `map` behind `.toArray()` does not get that context, so the
  tuple widens to an array and the fixed code can fail to type-check.

A callback that can throw is a residual difference: if two callbacks would throw
on different elements, the eager and the lazy chain throw different errors. The
rule does not try to prove that a member read cannot throw.

### No fix and no suggestion

Some calls have no iterator helper equivalent, so the rule reports without a fix
or a suggestion:

- **A `thisArg`.** Iterator helpers take one argument.
- **A callback that reads the array.** Iterator helpers call the callback with
  `(value, counter)`. A third parameter, a rest parameter, or a read of
  `arguments` in a `function` expression gets nothing, or a different length.
- **Optional chaining** anywhere in the chain.
- **A comment in the removed text**, such as `[/* note */ ...set]`. A comment
  inside the iterable itself is kept.
- **A shadowed `Iterator`**, when the fix needs `Iterator.from`.
- **An ASI hazard.** When the replacement starts with `(` and the token before
  it ends an expression, the replacement would continue the previous line. A
  TypeScript non-null `!`, a `#private` name, and the `>` of a JSX element count
  as ending an expression.

A callback passed by reference, such as `.filter(Boolean)`, gets a suggestion:
the rule cannot see whether it reads a third argument.

### Semantics that do not change

- **Index.** The counter that an iterator helper passes is the index in its own
  input, which is the index in the intermediate array of the eager chain. A
  second parameter such as `(name, index) => …` keeps its value.
- **Type guards.** `IteratorObject.filter` has a type-guard overload, so
  `.filter((v): v is string => …)` narrows the same way.
- **Parentheses.** A parenthesized copy keeps its parentheses:
  `([...set]).map(f)` becomes `(set.values()).map(f).toArray()`. An iterable
  that needs parentheses to take a member access gets them: `[...(a ?? b)]`
  becomes `(a ?? b).values()`.

## Options

### `iteratorHelpers`

Default: `true`.

Set it to `false` for targets without iterator helpers, such as roblox-ts. The
rule still reports, because the chain still builds arrays that nothing uses. The
message then names one `for...of` loop over the iterable as the fix, and the
rule offers no autofix or suggestion.

```json
{
	"flawless/no-materialized-filter-map": ["error", { "iteratorHelpers": false }]
}
```

## When not to use it

Iterator helpers need ES2025 at runtime, and TypeScript's `esnext` (or `es2025`)
lib for their types. If the target has neither, set `iteratorHelpers` to `false`
or turn the rule off.

## Further reading

A narrowed port of
[`no-array-filter-map`](https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/skills/install-anti-slop/assets/anti-slop/rules/no-array-filter-map.ts)
in `anti-slop`. The upstream rule reports every adjacent `filter`/`map` pair on
an array. This rule reports only a chain on a copied iterable.
