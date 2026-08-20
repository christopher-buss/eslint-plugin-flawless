# Disallow type annotations that restate the initializer's own type

📝 Disallow type annotations that restate the initializer's own type.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A variable with an initializer already has a type. Writing that same type again
in an annotation adds a second place to edit and tells the reader nothing the
initializer did not:

```ts
declare function parse(): unknown;

const payload: unknown = parse();
//           ^^^^^^^^^ the initializer is already `unknown`
```

The rule reports only when removing the annotation leaves the variable with
**exactly** the type it has now. It is not a style rule about explicit types in
general: an annotation that widens, narrows, names, or protects anything is left
alone.

### When an annotation is doing work

| The annotation                         | Example                                   |
| :------------------------------------- | :---------------------------------------- |
| widens a literal                       | `const count: number = 5`                 |
| narrows away `any`                     | `const value: unknown = JSON.parse(text)` |
| is `any` itself                        | `const value: any = getUnknown()`         |
| supplies a parameter's contextual type | `const fn: Handler = event => ...`        |
| pins a generic's type argument         | `const value: string = pick()`            |
| names an alias TypeScript erases       | `const id: UserId = getString()`          |

Each of these changes meaning if it is removed, so none of them is reported.

### `any` is never redundant

`any` is mutually assignable with every type, so a structural comparison alone
would call `const value: unknown = JSON.parse(text)` a restatement. It is the
opposite: the annotation is the only thing keeping `any` from spreading. The
rule looks for `any` at every depth of the initializer's type — including inside
type arguments, unions, and intersections — and stays quiet when it finds one.

The reverse case is reported. When the initializer is genuinely `unknown`, the
annotation adds nothing:

```ts
declare function getUnknown(): unknown;

const value: unknown = getUnknown(); // reported
```

### Generic calls

An annotation can be the reason a call has the type it has. TypeScript feeds the
contextual type into inference, so the annotation and the initializer agree by
construction:

```ts
declare function pick<T = number>(): T;

const value: string = pick(); // NOT reported — without the annotation, `T` is `number`
```

The rule skips any call or `new` expression whose signature is generic and whose
declared return type mentions one of its own type parameters, unless the call
site writes its type arguments out. That is deliberately conservative: it also
skips cases such as `const names: Array<string> = items.map(toName)`, where the
annotation really is redundant.

### Named types are preserved

An alias to an object, function, union, or array keeps its name in the type
system, so removing a matching annotation loses nothing. An alias to a primitive
does not:

```ts
type UserId = string;

declare function getId(): UserId;

const id: UserId = getId(); // NOT reported — the fix would leave `string`
```

## Examples

Examples of **incorrect** code for this rule:

```ts
interface Owner {
	id: string;
}

declare function getUnknown(): unknown;

declare function getString(): string;

declare function getOwner(): Owner;

const value: unknown = getUnknown();
const label: string = getString();
const owner: Owner = getOwner();

let text: string = getString();
text = getString();
```

Examples of **correct** code for this rule:

```ts
declare function parse(): any;
declare function getString(): string;
declare function pick<T = number>(): T;

const value = getString();
const parsed: unknown = parse();
const maybe: string | undefined = getString();
const pinned: string = pick();
```

## Known limitations

- Only `const` and `let` declarations with a plain identifier are checked.
  Destructuring patterns, class properties, function parameters, and return
  types are out of scope.
- Object and array literal initializers are skipped. There the annotation also
  governs excess property checking and literal widening, which is
  [`flawless/no-known-value-widening`](../no-known-value-widening/documentation.md)'s
  subject.
- A `let` whose initializer is a union of literals is skipped, because widening
  a union is a real change rather than the widening TypeScript would apply.

This rule has no options.

```json
{
	"flawless/no-redundant-type-annotation": "error"
}
```

## Further reading

- [typescript-eslint#12088](https://github.com/typescript-eslint/typescript-eslint/issues/12088)
  — the upstream `no-unnecessary-type-annotations` proposal this rule follows.
- [typescript-eslint#295](https://github.com/typescript-eslint/typescript-eslint/issues/295#issuecomment-688526380)
  — why comparing a type against its own annotation is harder than it looks.
