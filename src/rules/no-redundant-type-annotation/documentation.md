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
clause variable. A function's return type is checked only when an option asks
for it; see [Return types](#return-types).

### When an annotation is doing work

| The annotation                            | Example                                   |
| :---------------------------------------- | :---------------------------------------- |
| widens a literal                          | `const count: number = 5`                 |
| narrows away `any`                        | `const value: unknown = JSON.parse(text)` |
| is `any` itself                           | `const value: any = getUnknown()`         |
| is `never` (an exhaustiveness check)      | `const unreachable: never = shape`        |
| supplies a parameter's contextual type    | `const fn: Handler = event => ...`        |
| types a function-valued variable          | `let onClose: () => void = () => {}`      |
| types a function's return value or `this` | `const getTag: () => "div" = () => "div"` |
| pins a generic's type argument            | `const value: string = pick()`            |
| names an alias TypeScript erases          | `const id: UserId = getString()`          |

Each of these changes meaning if it is removed, so none of them is reported.

A variable initialized directly with an arrow function or function expression is
never reported. Other rules read its annotation as the function's signature:
`func-style` with `allowTypeAnnotation` allows the function expression only on a
typed variable, and `explicit-function-return-type` counts the annotation as the
return type.

In other places, such as a callback argument or a conditional of functions, a
function's return value is checked only where the context can change it. Without
a context a single returned literal widens (`() => "div"` becomes
`() => string`), but a union of literals does not. A returned object or array
literal, and any generator, is always skipped, even when the annotation really
is redundant.

A variable whose initializer passes a callback with untyped parameters is
reported when the callback gets its context from the receiver or from a
signature that is not generic:

```ts
type Option = "a" | "b";
declare const options: ReadonlyArray<{ value: Option }>;

const values: Array<Option> = options.map(({ value }) => value); // reported
```

When a generic or overloaded call can give the callback its context from the
annotation, as `filter` and `reduce` can, the variable is reported only if the
verifier proves that the removal of its annotation alone is safe (see below).
This also applies to a callback that has no untyped parameters, but returns a
value whose type the context shapes, such as `items.map(() => "a")`, and to a
callback that a conditional or a sequence passes to the call, or that a tagged
template substitution passes to its tag.

The same holds for a non-empty array literal of plain values. Without the
annotation, an element can lose its literal type, and the array is not a tuple
or readonly:

```ts
declare function read(): number;

const open: Array<number> = [-1]; // reported
const values: Array<number> = [read(), 2]; // reported

const tuple: [number] = [-1]; // not reported: it becomes number[]
const flags: Array<-1 | 0> = [-1]; // not reported: it becomes number[]
const list: ReadonlyArray<number> = [-1]; // not reported: it becomes number[]
```

An array literal is never reported when it is empty, or when an element or a
spread operand is an object, array, or function literal, or a generic call whose
type argument the annotation infers:

```ts
declare function make<T>(): T;

const items: Array<number> = [make()]; // NOT reported — without it, `T` is `unknown`
```

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

The rule skips any call, `new` expression, or tagged template whose signature is
generic and whose return type involves one of its own type parameters, unless
the call site writes its type arguments out, or every type parameter appears in
one of the signature's parameter types that receives an argument other than an
object or array literal. Such a literal can leave out what infers the type
parameter, as `Array.from({ length })` does. The arguments then infer the type
parameters before the context is consulted, so
`const value: string = first(items)` is checked. A mention behind an alias, a
mapped type, or a conditional type is not seen, so such a call is still skipped.

Such a call as an argument is checked when the outer callee has no generic
signature, or the outer call writes its type arguments out. The parameter type
then gives the argument its context, and the annotation cannot reach it:

```ts
interface Removal {
	readonly name: string;
}

declare function createRemoval(name: string, names: Set<string>): Removal;

const removal: Removal = createRemoval("a", new Set(["b"])); // reported
```

These are filters that save work; the verifier described below decides every
removal.

### Named types are preserved

An alias to an object, function, union, or array keeps its name in the type
system, so removing a matching annotation loses nothing. This includes a generic
alias with type arguments, such as `Readonly<Record<string, number>>`. An alias
to a primitive does not:

```ts
type UserId = string;

declare function getId(): UserId;

const id: UserId = getId(); // NOT reported — the fix would leave `string`
```

This also applies to an alias that you import, with or without a new name.

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

The check runs on function and arrow expressions, including object literal
methods. A method takes its context from the property of the same name in the
object's contextual type. A function declaration has no contextual type, so its
parameters must be annotated.

A rest parameter whose type is a tuple gives each position its element. A
parameter is paired only with a required element that has only required elements
before it. An optional element or a rest element is not reported. A callback
rest parameter at the start of the tuple is compared with the whole tuple; a
callback rest parameter after the start is not reported:

```ts
declare function handle(
	listener: (...args: [chunk: string, size: number]) => void,
): void;

handle((chunk: string, size: number) => chunk.length + size); // both are reported

declare function stream(
	listener: (...args: [chunk: string, ...sizes: Array<number>]) => void,
): void;

stream((chunk, size: number) => chunk.length + size); // NOT reported — `size` is in the rest element
```

A contextual type of `undefined` or `null` gives no signature, so those members
are dropped first: an optional callback property counts as its function type. A
union of different function types, or a method in an object whose context is a
union, is not reported.

A parameter is reported only when the rule can prove where its context comes
from, and that the fix cannot change it. The search climbs from the function
through array elements, object properties, spreads, conditional branches,
logical operands, a sequence's last expression, `!`, and `as const`, and out of
a function that returns it when that function has no return type of its own. It
must then reach an anchor:

- a variable's, class property's, or parameter's written type;
- a `satisfies`, `as`, or `<T>` assertion;
- a function's written return type;
- an argument of a call, `new`, `super`, tagged template, or JSX element whose
  callee has exactly one signature and no type parameters to infer, or whose
  type arguments are written out.

Any other position ends the search without an anchor, and the parameter is not
reported. An unfamiliar shape costs a missed report, never a wrong fix.

When the variable's own annotation is what supplies the context, only the
parameter is reported. Both look redundant, but removing both would leave the
parameter implicitly `any`. This holds wherever the annotation reaches the
parameter, and for an outer parameter's annotation that types a default value:

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

An overloaded callee gives the callback the context of the overload that the
call resolves to. The parameter types can be what picks that overload. When no
overload is generic, and the callback is a direct argument of the call, the rule
reports a parameter only when the verifier proves that its removal alone is safe
(see below):

```ts
interface Emitter {
	once(event: "exit", listener: (code: null | number) => void): this;
	once(event: "data", listener: (chunk: string) => void): this;
}

declare const emitter: Emitter;
declare function report(value: unknown): void;

emitter.once("exit", (code: null | number) => report(code)); // reported — `"exit"` picks the overload

declare function on(handler: (payload: number) => void): void;
declare function on(handler: (payload: string) => void): void;

on((payload: string) => report(payload)); // NOT reported — without it, the first overload resolves
```

An overload that types the parameter as `any`, such as a catch-all
`(...args: Array<any>) => void`, gives no type to compare, so a callback that
resolves to it is not reported. A generic overloaded callee is left alone.

A function that a callback returns is also left alone:

```ts
declare function map<T, R>(items: Array<T>, callback: (item: T) => R): Array<R>;

map([1], () => (text: string) => text.length); // NOT reported — without it, `text` is implicitly `any`
```

A generic callee is left alone unless the function is a direct argument of a
call with one signature, and each of the callback's parameter types is the same
before and after the call's type arguments are inferred, and so is its `this`
type. An array method's callback has a `this` typed by the `thisArg` type
parameter, so a `function` callback there is left alone. An arrow cannot bind
`this`, so its `this` type is not compared:
`list.flatMap((item: string) => [item])` is checked. The rule holds for
`promise.catch((reason: unknown) => reason)`, where `reason` names no type
parameter, so it is checked; the verifier decides whether the removal is safe.

A generator's `yield` counts as a return. The inferring call can also be a
generic class's `new`, a tagged template, or a generic JSX component:

```ts
declare class Box<T> {
	public readonly value: T;

	constructor(value: T);
}

const box = new Box((text: string) => text); // NOT reported — without it, `text` is implicitly `any`
```

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

## Return types

With an option on, a function's return type is reported when the body already
returns exactly that type:

```ts
declare const cond: boolean;
const kinds = new Set<string>();

const classify = (): null | Set<string> => (cond ? kinds : null); // reported

function getKinds(): Set<string> {
	//              ^^^^^^^^^^^^^ reported
	return kinds;
}
```

Both options are off by default, because
[`explicit-function-return-type`](https://typescript-eslint.io/rules/explicit-function-return-type)
may require these same annotations. `checkReturnTypes` checks every function.
`allowExpressions` checks only the function expressions that
`explicit-function-return-type` with `allowExpressions: true` lets omit: a
function expression whose direct parent is not a variable declarator, a class
method or property, or `export default`. A callback, an object property value,
and a function directly inside `as` or `satisfies` count as expressions. Set it
to match that rule.

`checkReturnTypes` costs more. It asks the type checker for the type of every
annotated function's return values, which can type-check bodies that nothing
else in the lint would. In a large project that runs no other typed rules, this
can add seconds to every lint. `allowExpressions` checks far fewer functions and
has no measurable cost.

A return type is left alone when it is doing work:

| The return type                        | Example                                      |
| :------------------------------------- | :------------------------------------------- |
| widens a returned literal              | `const lit = (): "a" => "a"`                 |
| types a returned literal or `new`      | `const empty = (): Set<string> => new Set()` |
| breaks a recursion (TS7023)            | `const visit = (n: number): boolean => ...`  |
| is `undefined` on a body with no value | `const none = (): undefined => {}`           |
| is a type predicate or `asserts`       | `function isString(v: unknown): v is string` |
| is `any` or `never`                    | `function fail(): never { throw error; }`    |
| names an alias TypeScript erases       | `function getId(): UserId { return text; }`  |

Overloads, generators, getters and setters, and a body whose end may be reached
after a returned value are also left alone. A body that returns no value infers
`void`, so `function run(): void { log(); }` is reported. An `async` function's
`Promise<T>` is compared with the awaited returned values.

Under `isolatedDeclarations` the emitter reads an exported function's return
type, so a function that is exported, that an exported declaration reads (see
below), or that is a method of an exported class keeps it (TS9007).

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
`export { ... }` list. It also stands down on a variable that an exported
declaration mentions, in a position the emitter prints:

- a `typeof` query, such as `export type T = typeof config`
- a computed key of an interface or type literal member
- `export default config` or `export = config`
- an enum member initializer
- a class `extends` clause

The emitter prints no other read. A variable read only by top-level code, such
as `start(config)`, or only inside function bodies or static blocks, is still
reported:

```ts
const config: Config = loadConfig();
//          ^^^^^^^^ reported
start(config);
```

A function or class follows the same positions, and a class also keeps its
return types when an emitted declaration names it as a type.

A file with no `import` or `export` is a script. Its top-level declarations are
global and the emitter prints all of them, so they keep their annotations.

The option reaches parameters too. When the emitter types an exported value from
its syntax (an exported variable without an annotation, a default export, or a
class property without one), a function's parameters inside it must be
annotated, and `satisfies` does not change that:

```ts
export const handlers = {
	format: (text: string) => text.trim(),
	//             ^^^^^^^^ NOT reported — the fix would give error TS9011
} satisfies Record<string, (text: string) => string>;
```

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

## Verification before reporting

Candidates that pass the checks above are rechecked with their annotations
removed in a temporary TypeScript program. The program reads unchanged source
files from the parser's program, including unsaved editor buffers. The rule
compares declaration, expression, and use-site types for the combined ESLint
fix. Types that print the same but name different declarations, such as a
shadowed interface, compare as different. Union members and ordinary object
properties compare in any order.

Removals that can influence one another are also checked one at a time, for
editors that apply a single fix. Two removals are coupled when their regions
overlap or one statement uses both bindings. A variable's region is its
statement. A parameter's region is its function, or the call or JSX element that
receives the function, because that call can infer its type arguments from the
parameter. A `const` that aliases a condition also uses each later reference
that it can narrow (see below). If combined removals fail, every failing removal
that is not coupled is restored at once. Among coupled removals, one annotation
is restored first, since restoring a context provider can make the others safe;
the remaining removals are then checked again.

Arbitrary subsets of several fixes are not exhaustively checked.

Loop candidates also trigger queries in the function, or file, that contains
their outermost loop before type comparison, to expose control-flow inference
cycles. Loop replay is enabled for TypeScript 5.9 and 6.0; other supported
versions retain loop annotations because their checker query order has not been
validated. Under `declaration` or `composite`, serialized inferred types outside
function bodies and static blocks are checked for references to inaccessible or
shadowed names. These targeted checks supplement the existing conservative
guards; they do not run complete compiler diagnostics or declaration emit.

TypeScript narrows through a `const` used as a condition only when the `const`
has no annotation, as in `const ok = typeof v === "string"; if (ok) v.length`.
For a `const` candidate, the verifier also compares the types of the
identifiers, `this`, and property and element accesses that its initializer
reads, at each later use to the end of the enclosing function or file, also
after the block or `for` statement of the `const`. A removal that changes how
such a use narrows is not reported. A `let` does not narrow this way.

Assertion functions and receivers used by assertion calls keep their variable or
parameter annotations. TypeScript requires explicitly typed call targets even
when the inferred callable type would otherwise be identical.

Verification creates at most twelve speculative programs per lint of a file,
plus one for each candidate that needs proof and whose removal is checked alone.
A candidate needs proof when it is a variable whose callback argument needs the
verifier, or a parameter of a callback that an overloaded callee types (see
above). There is at most one check alone per candidate and at most ten combined
checks, so never more than twenty. At most ten candidate annotations are
verified in that pass. Candidates that need proof are selected first. Each one
is reported only when its removal alone is safe. A coupled one gets that check
before the combined check. An uncoupled one gets it when a combined check finds
a problem with it, because the coupling does not follow all data flow. So
candidates of other kinds do not change whether it is reported, unless the
compiler fails during a check, which leaves every annotation alone. It carries a
fix only when the combined fix is verified too. A report without a fix then
means that this removal alone is safe. The removal of a coupled annotation can
make it unsafe, and the next lint then withdraws the report. Candidates past the
limit of ten are still reported but carry no fix, except a candidate that needs
proof, which is not reported; `eslint --fix` repeats its fix passes, and each
pass verifies further candidates after earlier fixes have been applied. If the
compiler fails during verification, the annotations are left alone and not
reported. Files with no candidates create no speculative program. Speculative
programs reuse the parser program's resolved project references, module
resolution cache, and file system lookups.

Verification needs the parser and this plugin to load the same copy of
`typescript`. TypeScript numbers nodes and symbols with module-level counters,
so a second copy would corrupt the parser's checker. With two copies, candidates
are reported without a fix, and a candidate that needs proof is not reported.
Install a single TypeScript version to enable the fix. Before TypeScript 5.3,
`parserOptions.projectService` loads `typescript/lib/tsserverlibrary`, which is
a separate copy of the compiler; use `parserOptions.project` there to enable the
fix.

The fix keeps the comments inside an annotation:
`const x: /* note */ string = getS();` becomes `const x /* note */ = getS();`.
On an arrow function's return type, a comment that spans a line break moves
after the `=>`, because a line break before `=>` is a syntax error.

## Known limitations

- Variable declarations are checked for `const` and `let` with a plain
  identifier only. Destructuring patterns and class properties are out of scope.
- Object literal initializers are skipped, and so are the array literals that
  [When an annotation is doing work](#when-an-annotation-is-doing-work) lists as
  never reported. There the annotation also governs excess property checking and
  literal widening, which is
  [`flawless/no-known-value-widening`](../no-known-value-widening/documentation.md)'s
  subject.
- `let` widens a literal type only when the initializer writes the literal in
  place (`let x = "a"` is `string`, but `let x = a` keeps `a`'s `"a"`), and the
  checker does not tell the two apart. So a `let` is compared against the
  widened type only for a literal or enum member written right there, and is
  skipped when any other initializer's type would widen, including a union of
  literals.
- A variable whose initializer reads the variable itself, or reads another
  annotated variable from inside a nested function, is skipped. Without the
  annotations the cycle leaves it implicitly `any`.
- A `unique symbol` initializer is skipped: without the annotation the variable
  widens to `symbol`.
- A parameter whose context arrives through a position the anchor search does
  not follow, such as an assignment, a delegating `yield*`, an `await`, or an
  immediately invoked function with an untyped parameter, is not reported.
- An optional parameter is skipped. The contextual type carries `| undefined`
  that the written annotation does not, so the two never compare as identical.
- Under `isolatedDeclarations` no exported variable is reported, even when the
  initializer is a literal the emitter could have read on its own.
- The fix can leave a type import with no remaining use. Pair the rule with an
  unused-import rule, or `noUnusedLocals` will fail the build.
- Verification uses the current file's project and TypeScript version. Other
  tsconfigs, changes to importing files, and edits made by other rules in the
  same fix pass are outside this check. Full before-and-after compiler
  diagnostics remain part of the rule's test suite.

## Options

<!-- begin auto-generated rule options list -->

| Name               | Description                                                                                                            | Type    | Default |
| :----------------- | :--------------------------------------------------------------------------------------------------------------------- | :------ | :------ |
| `allowExpressions` | Check the return types of function expressions that `explicit-function-return-type` with `allowExpressions` lets omit. | Boolean | `false` |
| `checkReturnTypes` | Check the return type of every function.                                                                               | Boolean | `false` |

<!-- end auto-generated rule options list -->

```json
{
	"flawless/no-redundant-type-annotation": [
		"error",
		{ "allowExpressions": true }
	]
}
```

## Further reading

- [typescript-eslint#12088](https://github.com/typescript-eslint/typescript-eslint/issues/12088)
  — the upstream `no-unnecessary-type-annotations` proposal this rule follows.
- [typescript-eslint#295](https://github.com/typescript-eslint/typescript-eslint/issues/295#issuecomment-688526380)
  — why comparing a type against its own annotation is harder than it looks.
