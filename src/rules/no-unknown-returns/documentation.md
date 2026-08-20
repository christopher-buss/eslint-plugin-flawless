# Disallow explicit return type annotations that resolve to `unknown`

📝 Disallow explicit return type annotations that resolve to `unknown`.

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A function whose declared return type is `unknown` moves a parsing decision out
of the function and onto every caller. The value crossed a boundary somewhere —
a network response, a config file, a `JSON.parse`, a foreign module — and the
signature records only that nobody has looked at it yet. Parse it where it
enters and return a named domain type, so the shape is established once instead
of re-narrowed at every call site.

The rule reports the return type annotation, not the whole function, so the fix
site is the text under the report.

## Positions

A return type can be `unknown` in three places, and all three report:

```ts
interface Options {
	encode: (item: string) => unknown; // a property
}
function loadConfig(): unknown {
	return read(); // the declaration's own return
}

function withRetry(makeError: () => unknown): void {
	retry(makeError); // a parameter
}
```

The direction of the value differs. In the first, this code hands an untyped
value to its caller; in the other two, it receives one from a function it calls.
The wording of the report follows that direction, but the verdict does not:
measured across a real monorepo, three of four parameter and property cases had
a truthful narrower type available — `() => void` where the result was
discarded, a named union where it was thrown, and a domain type where it was
serialised. Exempting those positions would suppress real improvements.

A function type — `(item: string) => unknown` or `new () => unknown` — takes the
receiving wording wherever it appears, because a type expression names a
function value supplied from elsewhere. Telling the holder of that type to parse
the value at its boundary would name a function body it does not own. An
interface method, a call signature, or a construct signature declares a contract
an implementation fulfils, so it is worded like a declaration.

One gap is worth knowing about: a method written in shorthand inside an inline
object type in a parameter —
`function make(o: { encode(item: string): unknown })` — is a member of a
declared contract, so it takes the declaration wording even though the caller is
on the receiving end. Write the member as a property
(`encode: (item: string) => unknown`) and the wording follows the value.

## Explicit annotations only

An unannotated function whose return _infers_ as `unknown` is out of scope. The
rule is about a declared contract: an inferred `unknown` usually comes from a
value further upstream, so the report would land away from the fix, and there is
far more of it. A type-aware implementation makes it tempting to read the
signature's resolved return type instead of the annotation — that would catch
inferred returns too, and is deliberately not done.

## How the type is resolved

The annotation is resolved through the type checker rather than by walking
syntax, which is what makes the rule hold up:

- **Aliases resolve across files.** A syntactic version can only see aliases
  declared at the top level of the file being linted, so moving
  `type Result = unknown` into a shared types module silences it while the code
  is unchanged. That is a worse outcome than not flagging at all, because it
  looks like compliance.
- **Generic aliases resolve too**, so `type A<T> = unknown` used as `A<string>`
  reports.
- **Unions collapse.** TypeScript absorbs `string | unknown` into `unknown`, so
  the case reports with no union walk.
- **Type parameters resolve to themselves**, so `function f<T>(): T` is silent,
  and a type parameter that shadows a file-level alias of the same name needs no
  special casing.
- **Promises are unwrapped**, so `Promise<unknown>`, `PromiseLike<unknown>`, and
  `Promise<Promise<unknown>>` all report. Only `Promise` and `PromiseLike` are
  unwrapped, not every thenable: a named domain type that happens to carry a
  `then` method is what the caller receives, so it is left alone.

Two boundaries are worth stating explicitly:

- `any` is not `unknown`. The unknown flag is tested specifically, because the
  fix for `any` is a different one.
- Only the return type itself is in scope, not `unknown` nested inside it, so
  `Array<unknown>` and `Record<string, unknown>` are silent. So is
  `NonNullable<unknown>`, which resolves to `{}`.

## Examples

Examples of **incorrect** code for this rule:

```ts
export interface Options {
	encode: (item: string) => unknown;
}

export function loadConfig(): unknown {
	return JSON.parse(readFileSync("config.json", "utf8"));
}

export async function fetchUser(id: string): Promise<unknown> {
	const response = await fetch(`/users/${id}`);
	return response.json();
}

export function withRetry(makeError: () => unknown): void {
	retry(makeError);
}
```

Examples of **correct** code for this rule:

```ts
export interface Options {
	encode: (item: string) => string;
}

interface Config {
	readonly retries: number;
}

export function loadConfig(): Config {
	return parseConfig(JSON.parse(readFileSync("config.json", "utf8")));
}

export function withRetry(makeError: () => void): void {
	retry(makeError);
}
```

## The any-function wildcard is not exempt

`(...args: never) => unknown` inside `Extract<>` or a conditional `extends`
looks like a false positive: the function is never called, so nothing reaches a
caller. It is not. `(...args: never) => void` classifies identically — verified
across functions returning values, functions returning `void`, interfaces,
records, and arrays — and `void` is the more honest type, since those sites
discard the return. The report has a truthful fix.

## Rules a fix can collide with

Narrowing a return often trips a neighbouring rule. The ones seen in practice:

- **`@typescript-eslint/no-unsafe-assignment`** — when the value being narrowed
  is fed by an `any`. Bind the _function_ to a narrower signature instead of the
  value: `const require_: (id: string) => Mod = createRequire(id)` rather than
  `const mod: Mod = createRequire(id)(id)`.
- **`@typescript-eslint/only-throw-error`** — configurations that permit
  throwing `unknown` will surface a previously hidden non-`Error` throw once the
  thrown type is named.
- **`@typescript-eslint/no-unnecessary-type-parameters`** — the generic
  alternative `m<E = unknown>(cb: () => E): R` trades one report for another
  whenever `E` is single-use.
- **`dot-notation` / `prefer-destructuring`** — a one-line
  `readMember(node, key)` accessor over a `Record<string, unknown>` exists to
  launder a computed key. Inlining it to satisfy this rule traded one error for
  ten; naming the record's value type and keeping the helper is the fix.

## When not to use it

An ambient `.d.ts` mirroring an upstream API is the one case with no code fix,
and wants an `eslint-disable` comment carrying the reason. Two notes before
reaching for one: such a file must be inside the tsconfig program for a
type-aware rule to see it at all, and a mirror is not automatically typeless.
Most of the reports in one codebase came from a single stub whose methods all
returned `unknown`; naming the checker type
(`type TCheck = (value: unknown) => boolean`) fixed every one of them with no
behaviour change.

This rule has no options.

```json
{
	"flawless/no-unknown-returns": "error"
}
```
