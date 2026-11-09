# Disallow ignoring the result of a built-in method that has no side effects

📝 Disallow ignoring the result of a built-in method that has no side effects.

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->

## Rule details

Some built-in methods only compute a value: `trim` returns a new string, `map`
returns a new array, `Math.max` returns a number. They change nothing. When such
a call is a statement on its own, its result is lost and the call does nothing.
This is usually a bug, such as a forgotten assignment:

```ts
text.trim(); // `text` is not changed
```

or the wrong method:

```ts
list.map((item) => save(item)); // use `forEach`
```

The rule reports a call when all of these are true:

- the call is a statement on its own. `void list.map(f)`, `list?.map(f)` and
  `const x = list.map(f)` are not checked;
- the method name is static: `a.name`, `a["name"]` or ``a[`name`]``. A computed
  key such as `a[key]` is not checked;
- the receiver is one of the kinds below, and the method is pure for that kind.

### Which methods are pure

The rule reads the method lists from the library types the project loads. It has
no fixed list of array or string methods, so it works with any library that has
the same interfaces: the TypeScript lib, or a replacement such as the roblox-ts
types.

| Receiver | Type                                                          | Pure methods                                             |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| array    | `Array<T>`, `ReadonlyArray<T>`, `T[]`, `readonly T[]`, tuples | each method of `ReadonlyArray` that returns a value      |
| map      | `Map`, `ReadonlyMap`                                          | each method of `ReadonlyMap` that returns a value        |
| set      | `Set`, `ReadonlySet`                                          | each method of `ReadonlySet` that returns a value        |
| string   | `string`, string literals, their unions, templates            | each method of `String` that returns a value             |
| number   | `number`, number literals and their unions                    | each method of `Number` that returns a value             |
| date     | `Date`                                                        | every `get*` and `getUTC*` getter, and the `to*` methods |
| regexp   | `RegExp`                                                      | `test` `toString`                                        |
| `Math`   | the global `Math`                                             | each function that returns a value                       |

A readonly interface leaves out each method that mutates its receiver, and a
string or a number cannot change. So a method of these interfaces that returns a
value only computes it. A method is not pure when:

- it returns `void`, such as `forEach`;
- one of its declarations is not library code, such as an augmentation
  `declare global { interface String { … } }`;
- it takes a mutable array that it can write into, such as the roblox-ts
  `move(f, e, t, a2: Array<T>)`. An alias of `Array<T>` counts too.

`Date` and `RegExp` have no readonly interface: `setTime` returns a value and
also mutates, and a global `RegExp` moves `lastIndex` in `test`. Their pure
methods are fixed.

Library code is a TypeScript lib file, or a global declaration file from an
installed package. A package module is not library code: its exported `Map`
class is not the built-in `Map`, and its `declare global` augmentation adds no
pure methods. A local class named `Date` or a local object named `Math` is not
the library type either. An augmentation of a library type does not change the
receiver kind: `date.getTime()` is still checked when the project adds members
to `Date`.

The receiver must be exactly one of these types. A union (`string | number`,
`string | undefined`), an intersection (`string & Brand`), an enum, a boxed
`String` or `any` does not match. A non-null assertion removes `undefined`, so
`maybe!.trim()` is checked.

### Exceptions

A callback can do work, so these calls are not reported:

- A string method with a function argument, such as a `replace` replacer.
- A call with an inline callback that does work outside the callback: an
  assignment or update (`count++`) to state from outside it, or a statement such
  as `save(item);`. Such a call to `find`, `some` or `every` is a loop with an
  early exit. A call that returns an array, such as `map` or `filter`, is still
  reported: use `forEach`.

A write to a parameter or a local of the callback, such as the accumulator of
`reduce`, stays inside the callback, so the call is still reported. Work inside
a nested function does not count, and a callback passed by name is not
inspected. An expression body is a value, not a statement:
`list.some((x) => handle(x))` is reported, because the rule cannot tell it from
a predicate such as `list.some((x) => isValid(x))`. Write the loop with a block
body, or use `for...of`.

### Performance

The rule makes the method lists once for each program. It checks the method name
before it asks the type checker for the receiver type. Most method calls in
application code (`push`, `emit`, `handle`) name no listed method, so they cost
no type lookup.

## Examples

Examples of **incorrect** code for this rule:

```ts
declare const list: Array<number>;
declare const view: ReadonlyArray<number>;
declare const text: string;
declare const date: Date;
declare const cache: Map<string, number>;
declare function save(value: number): void;

list.map((item) => save(item));
list.filter(Boolean);
view.slice(1);
text.trim();
text.replace("a", "b");
date.getTime();
cache.get("key");
Math.max(1, 2);
```

Examples of **correct** code for this rule:

```ts
declare const list: Array<number>;
declare const text: string;
declare function save(value: number): void;

for (const item of list) {
	save(item);
}

const kept = list.filter(Boolean);
const trimmed = text.trim();
text.replace(/a/g, (match) => match.toUpperCase());

list.some((item) => {
	save(item);
	return item > 1;
});
```

## When not to use it

Do not use it if your code changes the built-in prototypes, so that a listed
method has a side effect. Do not use it without type information: the rule
reports nothing then.

## Options

### `pureFunctions`

Default: `[]`.

Extra library functions to treat as pure. The global `Math` is always pure. An
entry is one of:

- a bare name, such as `math`. It covers a global function of that name, and
  each function that returns a value in a global namespace of that name;
- a dotted path, such as `table.clone`. It covers that one member.

An entry matches only a global from library code. A local variable with the same
name does not match. A function is skipped when it returns `void`, or when a
call passes a function argument, because the callback can do work.

A namespace in some libraries has functions with side effects that still return
a value, such as `task.wait` or `table.freeze`. Do not list that namespace; list
its pure members as dotted paths.

For example, a roblox-ts project can list the Luau namespaces whose functions
are all pure:

```json
{
	"flawless/no-ignored-return": [
		"error",
		{
			"pureFunctions": [
				"math",
				"string",
				"bit32",
				"buffer",
				"utf8",
				"vector",
				"os"
			]
		}
	]
}
```
