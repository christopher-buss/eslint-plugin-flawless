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

Three positions are checked: a variable declaration with an initializer, a
parameter of a function expression that has a contextual type, and a catch
clause variable. Return types are not checked.

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

## Function parameters

A parameter of a function expression can get its type from the signature the
function is passed to. Writing it out again is the same restatement:

```ts
interface Item {
	id: string;
}

declare function report(message: string): void;

declare function each(callback: (item: Item) => void): void;

each((item: Item) => {
	report(item.id);
});
```

The check runs on function and arrow expressions only. A function declaration
has no contextual type, so its parameters must be annotated.

When the variable's own annotation is what supplies the context, only the
parameter is reported. Both look redundant, but removing both would leave the
parameter implicitly `any`:

```ts
type Handler = (payload: string) => void;

declare function report(message: string): void;

const handle: Handler = (payload: string) => report(payload); // only `: string` is reported
```

An annotation is left alone when it is the reason the context says what it says:

```ts
declare function wrap<T>(callback: (value: T) => T): void;

wrap((value: number) => value); // NOT reported — without it, `T` is `unknown`
```

The same applies to an overloaded callee, where the parameter types can be what
picks the overload.

## Catch clause variables

Under the `useUnknownInCatchVariables` compiler option, which `strict` turns on,
a catch variable is already `unknown`. Writing `: unknown` on it restates what
the option gives:

```ts
declare function report(value: unknown): void;

try {
	report("start");
} catch (err: unknown) {
	//     ^^^^^^^^^^^ already `unknown`
	report(err);
}
```

The other annotation TypeScript accepts here is `any`, and that one is doing
work: it opts the variable back out of `unknown`. It is left alone.

The check reads the option from the project the file belongs to. With the option
off a bare catch variable is `any`, so `: unknown` narrows it and nothing is
reported.

## Exported variables under `isolatedDeclarations`

The `isolatedDeclarations` compiler option makes the declaration emitter work
from one file's syntax alone, with no type checker to fall back on. An exported
variable must then write its type down, because the annotation is the only copy
the emitter can read:

```ts
export const RbxPathParent: unique symbol = Symbol("Parent");
//                        ^^^^^^^^^^^^^^^ NOT reported — the fix would give
//                                        error TS9010
```

Inference gives the same `unique symbol` here, so the annotation does restate
the initializer, but removing it stops the build. The check reads the option
from the project the file belongs to and stands down on every exported variable
while it is on, whether the export sits on the declaration or in a later
`export { ... }` list. Variables that stay inside the module are out of the
option's reach and are still reported.

An annotation that supplies a function's parameter types is unaffected: the
variable keeps its own annotation, so the emitter still has what it needs.

```ts
type Handler = (value: string) => void;

declare function report(value: string): void;

export const handler: Handler = (value: string) => {
	//                                  ^^^^^^^^ still reported
	report(value);
};
```

## Known limitations

- Variable declarations are checked for `const` and `let` with a plain
  identifier only. Destructuring patterns and class properties are out of scope,
  as are return types.
- Object and array literal initializers are skipped. There the annotation also
  governs excess property checking and literal widening, which is
  [`flawless/no-known-value-widening`](../no-known-value-widening/documentation.md)'s
  subject.
- A `let` whose initializer is a union of literals is skipped, because widening
  a union is a real change rather than the widening TypeScript would apply.
- An optional parameter is skipped. The contextual type carries `| undefined`
  that the written annotation does not, so the two never compare as identical.
- Under `isolatedDeclarations` no exported variable is reported, even when the
  initializer is a literal the emitter could have read on its own.
- The fix can leave a type import with no remaining use. Pair the rule with an
  unused-import rule, or `noUnusedLocals` will fail the build.

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
