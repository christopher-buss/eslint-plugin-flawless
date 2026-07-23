# Enforce naming conventions for everything across a codebase

📝 Enforce naming conventions for everything across a codebase.

💭 This rule requires
[type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

(Detailed explanation of what the rule does, why it exists in the context of
roblox-ts, and potential pitfalls it prevents.)

## Examples

Examples of **incorrect** code for this rule:

```js
// Code that violates the rule
function badExample() {
	// ...
}
```

Examples of **correct** code for this rule:

```js
// Code that adheres to the rule
function goodExample() {
	// ...
}
```

## Names dictated by a contextual type

`objectLiteralProperty` and `objectLiteralMethod` members are automatically
exempt from naming validation when the enclosing object literal has a contextual
type that declares the member. In that case the name is not the author's choice
— it is required by the declared type, which is itself validated at its
declaration site (via `typeProperty` / `typeMethod`). This is not configurable.

```ts
// Correct — names are required by UserInputService:
const userInputService = {
	GetPropertyChangedSignal() {
		return signal;
	},
	PreferredInput: options.preferred ?? Enum.PreferredInput.KeyboardAndMouse,
} satisfies Partial<UserInputService>;
```

The contextual type can come from `satisfies`, an `as` assertion, a variable /
parameter / return type annotation, a call-argument position, or an enclosing
literal (nested object literals inherit it).

Notes:

- Object literals **without** a contextual type are validated as before
  (including `as const` — a `const` assertion provides no contextual type; see
  `objectStyleEnum` below for how bare `as const` objects are validated
  instead).
- The contextual type must actually **declare** the member: `Record<string, T>`
  (a bare index signature) does not dictate any specific name and exempts
  nothing, while `Record<"ExactName", T>` does.
- Generic inference from the literal itself (e.g. `identity({ Name: 1 })` with
  `identity<T>(x: T): T`) does not exempt — the names still originate from the
  literal.
- Object-literal `get` / `set` accessors are validated as `classicAccessor` and
  are not exempted.
- Requires type information; without a TS program the rule behaves as before.

## Foreign contracts: renaming is never the fix

Some names aren't the author's to choose — they're dictated by a shape owned
elsewhere: a wire format, a third-party API, a TypeScript type the code has to
conform to. This rule treats every such case as a **declaration of a foreign
contract**, made explicit through a specific syntax:

- a contextual type for object literals (see above),
- `satisfies` for const data (`objectStyleEnum`, below),
- `@external` for type declarations (below).

Renaming the offending identifier, or reaching for `eslint-disable`, is never
the intended fix for these cases — declaring the contract is. The sections below
cover the escapes unique to this fork.

### `objectStyleEnum`

A **bare** const-asserted object literal —

```ts
const Colors = { Blue: "blue", Red: "red" } as const;
```

— is treated as an `objectStyleEnum`: a common alternative to TypeScript's
`enum`. The container binding is validated by the `objectStyleEnum` selector,
and its **top-level keys** are validated as `enumMember` (not
`objectLiteralProperty`) — so a camelCase-keyed lookup table can't be "fixed" by
renaming the container to look like an enum; the keys still have to pass as enum
members. Keys of a _nested_ object value are ordinary `objectLiteralProperty`
names, since foreign formats don't nest inside a real enum's members.

A type annotation on the binding (`const x: T = {...} as const`) does **not**
opt out — it's still an `objectStyleEnum`. Only `satisfies` does, because
`satisfies` is this rule's designated foreign-contract escape: it declares that
the object conforms to an externally-owned type, so the fix for an awkward key
is to declare that conformance rather than rename:

```ts
// Before — objectStyleEnum, `exec`/`spawn` must pass as enumMembers:
const OPTIONS_ARG_POSITION = { exec: 1, spawn: 2 } as const;

// After — `satisfies` declares the foreign contract; the object is a plain
// `variable` and its properties are plain `objectLiteralProperty` members:
const OPTIONS_ARG_POSITION = { exec: 1, spawn: 2 } as const satisfies Record<
	string,
	1 | 2
>;
```

Violation messages for `objectStyleEnum` names (container and keys) append a
pointer to this escape.

### `constAsserted` modifier

The `variable` selector accepts a `constAsserted` modifier: true when the
variable's initializer is a const-asserted object expression, bare
(`{...} as const`) or `satisfies`-wrapped (`{...} as const satisfies T`). In
practice this targets the `satisfies`-wrapped form, since bare const assertions
are claimed by the `objectStyleEnum` validator first. Use it to pin a format on
const-asserted data objects specifically:

```ts
const namingConventionOptions = [
	{
		format: ["UPPER_CASE"],
		modifiers: ["constAsserted"],
		selector: "variable",
	},
	{ format: ["camelCase"], selector: "variable" },
];
```

### `@external` tag

A JSDoc `@external` tag skips naming validation for `typeProperty` /
`typeMethod` members whose name comes from a foreign wire format:

- On an `interface` or `type` alias declaration, it exempts **all** of that
  declaration's members, including members of type literals nested inside it
  (foreign formats nest).
- On a single property, it exempts just that member.

The type's own name is unaffected either way — it's still validated via
`typeLike`.

```ts
/**
 * @external
 */
interface WireFormat {
	get_name(): string;
	user_id: string;
}

interface Config {
	DisplayName: string;
	/** @external */
	user_id: string;
}
```

## Options

This rule is a fork of
[`@typescript-eslint/naming-convention`](https://typescript-eslint.io/rules/naming-convention)
and accepts the same selector-based options. The extensions unique to this fork
are documented below.

### `types`

Each entry in a selector's `types` array is one of:

- a built-in type modifier: `"array"`, `"boolean"`, `"function"`, `"number"`,
  `"string"` (matched against the widened TS type, as upstream), or
- a **type-reference matcher**: `{ from?: string, name?: string, returns?: … }`
  with at least one of `name` / `returns` present.

A type-reference matcher matches when the value's type resolves to a symbol
named `name` — checked against the type's `aliasSymbol` first, then its
`symbol`, recursing through union and intersection members. A union type
satisfies the selector when every arm matches at least one entry in `types` (not
necessarily the same one).

`returns` holds a nested type-reference matcher applied to call-signature return
types: the value's type matches when at least one of its call signatures returns
a type satisfying the nested matcher. This covers values whose type is an
_anonymous_ function type — there is no symbol name to match, but the return
type is a named reference. The canonical case is React components typed
`(props: P) => React.ReactNode`:

```ts
const componentNaming = [
	{
		format: ["StrictPascalCase"],
		selector: ["variable", "parameter"],
		types: [{ returns: { name: "ReactNode", from: "@rbxts/react" } }],
	},
];
```

When `name` and `returns` are both present, both must hold. Unlike upstream,
`types` is also accepted on the `function` and method (`classMethod`,
`objectLiteralMethod`, `typeMethod`, `method`) selectors, where the matched type
is the function's own type — combined with `returns` this lets e.g. interface
methods acting as component factories carry their own format.

`from` is optional. When supplied, the matched symbol's declaration must also
live in a file the specifier resolves to:

- **Bare package specifier** (e.g. `@rbxts/jecs`): substring match on
  `/node_modules/<from>/` against the declaration's source file path. Works for
  flat and pnpm-style layouts. Out of scope: Yarn PnP (no `node_modules` on
  disk), vendored packages outside `node_modules`, and `@types/*` ambient
  packages.
- **Path-form** (`.` / `/` / drive-letter prefix): compared against the
  normalized declaration path with `.d.ts` / `.ts` / `.tsx` stripped. Relative
  and POSIX-absolute specifiers match as a path suffix; Windows absolute paths
  require exact equality.

This lets variables typed as known library types get their own format rules
without per-line `eslint-disable` directives:

```ts
const namingConventionOptions = [
	{
		format: ["PascalCase"],
		modifiers: ["const"],
		selector: "variable",
		types: [
			// strict (module + name)
			{ name: "Entity", from: "@rbxts/jecs" },
			{ name: "Pair", from: "@rbxts/jecs" },
			// loose name-only match
			{ name: "MyLocalType" },
		],
	},
];
```

For sorting purposes, strict matchers (a `from` constraint at any depth,
including inside `returns`) take priority over loose matchers (no `from`), and
both take priority over the built-in type modifiers.

The `TypeMatcher` and `TypeReference` types are exported from the package root
so consumers can strongly type their config.

## Further Reading

(Optional: Links to relevant roblox-ts documentation, GitHub issues, or related
concepts.)
