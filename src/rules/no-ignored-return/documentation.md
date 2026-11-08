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
- the receiver type is one of the kinds below, and the method is in its table.

| Receiver | Type                                               | Methods                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| array    | `Array<T>` / `T[]`                                 | `concat` `entries` `filter` `find` `findIndex` `findLast` `findLastIndex` `includes` `indexOf` `join` `keys` `lastIndexOf` `map` `reduce` `reduceRight` `slice` `toLocaleString` `toString` `values`                                                                                                                                                                                                                                                               |
| date     | `Date`                                             | every `get*` and `getUTC*` getter, `getTimezoneOffset` `getYear` `toDateString` `toGMTString` `toISOString` `toJSON` `toLocaleDateString` `toLocaleString` `toLocaleTimeString` `toString` `toTimeString` `toUTCString`                                                                                                                                                                                                                                            |
| math     | `Math`                                             | every `Math` function, `random` included                                                                                                                                                                                                                                                                                                                                                                                                                           |
| number   | `number`, number literals and their unions         | `toExponential` `toFixed` `toLocaleString` `toPrecision` `toString`                                                                                                                                                                                                                                                                                                                                                                                                |
| regexp   | `RegExp`                                           | `test` `toString`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| string   | `string`, string literals, their unions, templates | `charAt` `charCodeAt` `codePointAt` `concat` `endsWith` `includes` `indexOf` `lastIndexOf` `localeCompare` `match` `normalize` `padEnd` `padStart` `repeat` `replace` `search` `slice` `split` `startsWith` `substr` `substring` `toLocaleLowerCase` `toLocaleUpperCase` `toLowerCase` `toString` `toUpperCase` `trim` `valueOf`, and the HTML wrappers `anchor` `big` `blink` `bold` `fixed` `fontcolor` `fontsize` `italics` `link` `small` `strike` `sub` `sup` |

The receiver must be exactly one of these types. A union (`string | number`,
`string | undefined`), an intersection (`string & Brand`), an enum, a boxed
`String`, a `ReadonlyArray`, a tuple or `any` does not match. A non-null
assertion removes `undefined`, so `maybe!.trim()` is checked. The array, date,
math and regexp kinds match by type name, so a local class named `Date` also
matches.

### Exceptions

A callback can do work, so two calls with a callback are not reported:

- `replace` whose second argument has a function type, such as an inline arrow
  or a variable declared as `(m: string) => string`. The type must print as one
  function type. A union of function types, a type alias name, a callable
  interface or an overloaded function is still reported.
- `find`, `findIndex`, `findLast` or `findLastIndex` whose first argument is an
  inline function that assigns to a variable. Such a call is a loop with an
  early exit. An assignment inside a nested function does not count, and a
  callback passed by name is not inspected.

### Performance

The rule checks the method name before it asks the type checker for the receiver
type. Most method calls in application code (`push`, `set`, `emit`) name no
table method, so they cost no type lookup.

## Examples

Examples of **incorrect** code for this rule:

```ts
declare const list: Array<number>;
declare const text: string;
declare const date: Date;
declare function save(value: number): void;

list.map((item) => save(item));
list.filter(Boolean);
text.trim();
text.replace("a", "b");
date.getTime();
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

let found = 0;
list.find((item) => {
	found = item;
	return item > 1;
});
```

## When not to use it

Do not use it if your code changes the built-in prototypes, so that a method in
the tables has a side effect. Do not use it without type information: the rule
reports nothing then.

## Options

This rule has no options.

```json
{
	"flawless/no-ignored-return": "error"
}
```
