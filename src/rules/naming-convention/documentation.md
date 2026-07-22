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

## Options

This rule is a fork of
[`@typescript-eslint/naming-convention`](https://typescript-eslint.io/rules/naming-convention)
and accepts the same selector-based options. The extensions unique to this fork
are documented below.

### `types`

Each entry in a selector's `types` array is one of:

- a built-in type modifier: `"array"`, `"boolean"`, `"function"`, `"number"`,
  `"string"` (matched against the widened TS type, as upstream), or
- a **type-reference matcher**: `{ from?: string, name: string }`.

A type-reference matcher matches when the value's type resolves to a symbol
named `name` — checked against the type's `aliasSymbol` first, then its
`symbol`, recursing through union and intersection members. A union type
satisfies the selector when every arm matches at least one entry in `types` (not
necessarily the same one).

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

For sorting purposes, strict matchers (`from` + `name`) take priority over loose
matchers (`name` only), and both take priority over the built-in type modifiers.

The `TypeMatcher` and `TypeReference` types are exported from the package root
so consumers can strongly type their config.

## Further Reading

(Optional: Links to relevant roblox-ts documentation, GitHub issues, or related
concepts.)
